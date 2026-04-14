// Simple connection pool. Keeps up to `max` connections open, hands them
// out on demand, returns them to the idle set on release. Connections
// idle longer than `idleTimeoutMs` are torn down. `acquireTimeoutMs`
// caps the wait time when the pool is full.
//
// Deliberately small: this is enough for most application workloads and
// mirrors the shape of node-postgres' pg.Pool. For advanced needs
// (pre-warming, load balancing, pgbouncer tuning) callers should manage
// connections directly or extend this class.

import { Connection, connect, type ConnectOptions, type QueryResult } from './connection';
import { resolveConnectOptions, type ResolveOptionsInput } from './env';
import type { SqlQuery } from './sql';

export interface PoolOptions extends ResolveOptionsInput {
    /** Maximum number of open connections. Default 10. */
    max?: number;
    /** Milliseconds a connection can sit idle before the pool closes it.
     *  Default 30_000. Set 0 to disable. */
    idleTimeoutMs?: number;
    /** Milliseconds a `.acquire()` call will wait when the pool is full.
     *  Default 30_000. */
    acquireTimeoutMs?: number;
}

interface IdleEntry {
    conn: Connection;
    idleSince: number;
    idleTimer: ReturnType<typeof setTimeout> | null;
}

interface Waiter {
    resolve: (conn: Connection) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * A pooled Postgres client. Callers usually interact through `pool.query()`
 * (acquire + query + release in one go); for multi-statement sequences
 * see `pool.withConnection()` and `pool.transaction()`.
 */
export class Pool {
    private readonly opts: ConnectOptions;
    private readonly max: number;
    private readonly idleTimeoutMs: number;
    private readonly acquireTimeoutMs: number;

    private open = 0;              // total currently-open connections
    private idle: IdleEntry[] = [];
    private waiting: Waiter[] = [];
    private closed = false;

    constructor(options: PoolOptions) {
        this.opts = resolveConnectOptions(options);
        this.max = options.max !== undefined ? options.max : 10;
        this.idleTimeoutMs = options.idleTimeoutMs !== undefined ? options.idleTimeoutMs : 30_000;
        this.acquireTimeoutMs = options.acquireTimeoutMs !== undefined ? options.acquireTimeoutMs : 30_000;
    }

    /** Acquire, run a query, release. The common case. */
    async query<T = Record<string, unknown>>(
        sql: string | SqlQuery,
        params?: unknown[],
        paramOids?: number[]
    ): Promise<QueryResult<T>> {
        const conn = await this.acquire();
        try {
            return await conn.query<T>(sql, params, paramOids);
        } finally {
            this.release(conn);
        }
    }

    /** Run `cb` with a pooled connection that will be released when `cb`
     *  resolves or rejects. */
    async withConnection<T>(cb: (conn: Connection) => Promise<T>): Promise<T> {
        const conn = await this.acquire();
        try {
            return await cb(conn);
        } finally {
            this.release(conn);
        }
    }

    /** Acquire, run `cb` inside a transaction, release. */
    async transaction<T>(cb: (conn: Connection) => Promise<T>): Promise<T> {
        const conn = await this.acquire();
        try {
            return await conn.transaction(cb);
        } finally {
            this.release(conn);
        }
    }

    /**
     * Hand the caller a connection from the idle set (or open a new one,
     * up to `max`). When the pool is at capacity, wait for a release up
     * to `acquireTimeoutMs`.
     */
    async acquire(): Promise<Connection> {
        if (this.closed) {
            throw new Error('Pool: closed');
        }
        // Fast path: an idle connection is waiting.
        const entry = this.idle.shift();
        if (entry !== undefined) {
            if (entry.idleTimer !== null) {
                clearTimeout(entry.idleTimer);
            }
            return entry.conn;
        }
        if (this.open < this.max) {
            this.open += 1;
            try {
                return await connect(this.opts);
            } catch (e) {
                this.open -= 1;
                throw e;
            }
        }
        // Pool is full — queue until a release or timeout.
        return new Promise<Connection>((resolve, reject) => {
            const timer = setTimeout(() => {
                // Find and drop this waiter; reject.
                for (let i = 0; i < this.waiting.length; i++) {
                    if (this.waiting[i].timer === timer) {
                        this.waiting.splice(i, 1);
                        break;
                    }
                }
                reject(new Error('Pool.acquire timed out after ' + this.acquireTimeoutMs + 'ms'));
            }, this.acquireTimeoutMs);
            this.waiting.push({ resolve: resolve, reject: reject, timer: timer });
        });
    }

    /**
     * Return a connection to the pool. If other callers are waiting, the
     * connection is handed directly to the oldest waiter; otherwise it
     * joins the idle set with an idle-timeout watchdog.
     */
    release(conn: Connection): void {
        if (this.closed) {
            // Pool shut down while this conn was out; just close it.
            conn.close().catch(() => {});
            this.open -= 1;
            return;
        }
        const waiter = this.waiting.shift();
        if (waiter !== undefined) {
            clearTimeout(waiter.timer);
            waiter.resolve(conn);
            return;
        }
        const entry: IdleEntry = {
            conn: conn,
            idleSince: Date.now(),
            idleTimer: null,
        };
        if (this.idleTimeoutMs > 0) {
            entry.idleTimer = setTimeout(() => this.reapIdle(entry), this.idleTimeoutMs);
        }
        this.idle.push(entry);
    }

    private reapIdle(entry: IdleEntry): void {
        const idx = this.idle.indexOf(entry);
        if (idx < 0) {
            return;
        }
        this.idle.splice(idx, 1);
        entry.conn.close().catch(() => {});
        this.open -= 1;
    }

    /** Close every connection (idle + in-flight). Resolves when the pool
     *  is fully drained. */
    async end(): Promise<void> {
        this.closed = true;
        // Reject any pending waiters — they'll never be served.
        for (const w of this.waiting) {
            clearTimeout(w.timer);
            w.reject(new Error('Pool: ended'));
        }
        this.waiting = [];
        const toClose = this.idle.slice();
        this.idle = [];
        await Promise.all(
            toClose.map((entry) => {
                if (entry.idleTimer !== null) {
                    clearTimeout(entry.idleTimer);
                }
                this.open -= 1;
                return entry.conn.close().catch(() => {});
            })
        );
    }

    /** Pool stats. Useful for metrics / health checks. */
    size(): { total: number; idle: number; waiting: number } {
        return { total: this.open, idle: this.idle.length, waiting: this.waiting.length };
    }
}

/** Convenience factory matching the rest of the public API shape. */
export function createPool(options: PoolOptions): Pool {
    return new Pool(options);
}
