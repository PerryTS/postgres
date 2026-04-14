// Connection lifecycle and the simple-query protocol path.
//
// State lives in a module-level Map keyed by integer connection id, not on
// the Connection instance itself. This is the pattern required by Perry's
// AOT constraints: closures (e.g. the socket `'data'` callback) capture
// variables by value, so `this.foo = x` inside an event handler wouldn't
// propagate back to the instance. Every mutation goes through
// `CONN_STATES.get(id)` instead.
//
// C2 scope: startup handshake + cleartext auth + simple `query(sql)`. SCRAM
// and MD5 land in C3; extended query protocol + type codecs in C5.

import {
    BACKEND_AUTH,
    BACKEND_BACKEND_KEY_DATA,
    BACKEND_COMMAND_COMPLETE,
    BACKEND_DATA_ROW,
    BACKEND_EMPTY_QUERY_RESPONSE,
    BACKEND_ERROR_RESPONSE,
    BACKEND_NOTICE_RESPONSE,
    BACKEND_PARAMETER_STATUS,
    BACKEND_READY_FOR_QUERY,
    BACKEND_ROW_DESCRIPTION,
} from './protocol/messages';
import { FrameView } from './protocol/framing';
import { MessageReader } from './protocol/reader';
import {
    writeBind,
    writeDescribe,
    writeExecute,
    writeParse,
    writePasswordMessage,
    writePasswordRaw,
    writeQuery,
    writeSSLRequest,
    writeStartupMessage,
    writeSync,
    writeTerminate,
} from './protocol/writer';
import {
    AuthenticationRequest,
    BackendKeyData,
    decodeAuthentication,
    decodeBackendKeyData,
    decodeCommandComplete,
    decodeDataRow,
    decodeParameterStatus,
    decodeReadyForQuery,
    decodeRowDescription,
    FieldDescription,
    RawRow,
    TxnStatus,
} from './protocol/decoder';
import './types/default-codecs';
import { decodeValue, encodeValue } from './types/registry';
import { FORMAT_TEXT } from './types/oids';
import {
    BACKEND_BIND_COMPLETE,
    BACKEND_CLOSE_COMPLETE,
    BACKEND_NO_DATA,
    BACKEND_PARAMETER_DESCRIPTION,
    BACKEND_PARSE_COMPLETE,
    BACKEND_PORTAL_SUSPENDED,
} from './protocol/messages';
import { PgError, parsePgError } from './error';
import { parsePgNotice, PgNotice } from './notice';
import { openSocket, Socket } from './transport/net-socket';
import { upgradeToTls } from './transport/upgrade-tls';
import { computeMD5Password } from './auth/md5';
import { scramContinue, scramInit, scramVerifyServerFinal, ScramState } from './auth/scram';
import { sendCancelRequest } from './cancel';
import { decodeNotification, Notification } from './protocol/decoder';
import { BACKEND_NOTIFICATION } from './protocol/messages';
import { isSqlQuery, type SqlQuery } from './sql';
import { resolveConnectOptions, type ResolveOptionsInput } from './env';

// ─── Public types ────────────────────────────────────────────────────────────

export interface ConnectOptions {
    host: string;
    port: number;
    user: string;
    database: string;
    /** Cleartext password for trust / cleartext auth paths. MD5 + SCRAM in C3. */
    password?: string;
    /** Sent as the Postgres `application_name` GUC — shows up in pg_stat_activity. */
    applicationName?: string;
    /** Milliseconds to wait for the TCP connect + startup handshake. */
    connectTimeoutMs?: number;
    /**
     * TLS configuration. Semantics mirror libpq `sslmode`:
     *   - `disable`     — never try TLS, fail if the only path is TLS.
     *   - `require`     — send SSLRequest; encrypt but do NOT verify the cert.
     *                     Fail if the server refuses TLS.
     *   - `verify-ca`   — encrypt and verify cert chain (treated the same as
     *                     verify-full in C4; a chain-only mode is a future add).
     *   - `verify-full` — encrypt and verify chain + hostname.
     * Default when `ssl` is omitted: no TLS (`disable`-like).
     */
    ssl?: { mode: 'disable' | 'require' | 'verify-ca' | 'verify-full' };
}

export interface QueryResult<T = Record<string, unknown>> {
    /** Column metadata: name, OID, type modifier, table OID, attnum, format. */
    fields: FieldDescription[];
    /**
     * Each row as an object keyed by column name, with values decoded
     * through the type registry. This is the "obvious" shape most consumers
     * want. Integers become `number`, int8 becomes `bigint`, `numeric`
     * becomes a `Decimal`, etc. See the registry in src/types/ for details.
     */
    rows: T[];
    /**
     * Same data as `rows` but in positional form — `unknown[][]`. Useful
     * for queries whose columns overlap on name (joins that return two
     * columns called `id`, for example) or for perf-sensitive loops that
     * avoid the per-row object allocation.
     */
    rowsArray: unknown[][];
    /**
     * Raw per-cell byte buffers as they arrived on the wire. `null` for
     * SQL NULL. Use when you need to round-trip bytes exactly (Tusk's
     * grid renderer reaches for this for bytea / jsonb previews).
     */
    rowsRaw: RawRow[];
    /** Raw command tag: "SELECT 5", "INSERT 0 3", "BEGIN", … */
    command: string;
    /** Rows affected, parsed from the command tag (0 when not applicable). */
    rowCount: number;
}

/** @deprecated Use `result.rowsArray` — kept for backward compatibility. */
export function rowsDecoded(result: QueryResult): unknown[][] {
    return result.rowsArray;
}

/** @deprecated Use `result.rows` — kept for backward compatibility. */
export function toObjects(result: QueryResult): Record<string, unknown>[] {
    return result.rows as Record<string, unknown>[];
}

// ─── Internal connection state ───────────────────────────────────────────────

type ConnectionStatus =
    | 'connecting'       // TCP in flight, not yet handshaking
    | 'ssl-requesting'   // SSLRequest sent, waiting for 1-byte response
    | 'ssl-upgrading'    // 'S' received, TLS handshake in progress
    | 'authenticating'   // Startup / auth exchange
    | 'ready'            // idle, ready for queries
    | 'querying'         // query in flight
    | 'closed';

interface PendingQuery {
    resolve: (r: QueryResult) => void;
    reject: (e: Error) => void;
    fields: FieldDescription[];
    rowsRaw: RawRow[];
    commandTag: string;
    rowCount: number;
    error: PgError | null;
}

interface StartupGate {
    resolve: (c: Connection) => void;
    reject: (e: Error) => void;
    settled: boolean;
}

interface ConnState {
    id: number;
    sock: Socket;
    opts: ConnectOptions;
    reader: MessageReader;
    status: ConnectionStatus;
    backendPid: number;
    secretKey: number;
    paramStatus: Record<string, string>;
    txnStatus: TxnStatus;
    startupGate: StartupGate | null;
    pending: PendingQuery | null;
    noticeHandlers: Array<(n: PgNotice) => void>;
    paramHandlers: Array<(k: string, v: string) => void>;
    errorHandlers: Array<(e: Error) => void>;
    notificationHandlers: Array<(n: Notification) => void>;
    connection: Connection;
    /** SCRAM-SHA-256 state once AuthenticationSASL arrives. */
    scram: ScramState | null;
    /** Stable reference to the current 'data' listener so we can
     *  remove it before a TLS upgrade (Node requires this to avoid
     *  racing the TLS engine for handshake bytes). */
    dataListener: (chunk: Buffer) => void;
}

let NEXT_CONN_ID = 1;
const CONN_STATES = new Map<number, ConnState>();

// ─── Connection class ────────────────────────────────────────────────────────

export class Connection {
    private readonly _id: number;

    // Populated as BackendKeyData / ParameterStatus arrive during startup.
    public backendPid: number = 0;
    public secretKey: number = 0;

    constructor(id: number) {
        this._id = id;
    }

    /** Internal — module-level code uses this to reach the state map. */
    _stateId(): number {
        return this._id;
    }

    /** Server-reported parameter (e.g. `server_version`, `TimeZone`). */
    parameter(name: string): string | undefined {
        const st = CONN_STATES.get(this._id);
        if (st === undefined) {
            return undefined;
        }
        return st.paramStatus[name];
    }

    /**
     * Run a query and return the full result. Accepts three shapes:
     *
     *   conn.query('SELECT 1')                       // simple protocol
     *   conn.query('SELECT $1::int4', [42])          // extended protocol
     *   conn.query(sql`SELECT $1::int4`, [42])       // template tag
     *   conn.query(sql`SELECT * FROM t WHERE id = ${id}`)  // params embedded
     *
     * With `params` omitted and the string simple, we use the Postgres
     * simple query protocol ('Q' — good for DDL, SET, multi-statement text).
     * Otherwise we use the extended protocol (Parse/Bind/Execute/Sync)
     * with text-format parameter encoding. Typed `paramOids` pin the
     * Postgres type for each placeholder; when omitted the server infers.
     */
    query<T = Record<string, unknown>>(
        sql: string | SqlQuery,
        params?: unknown[],
        paramOids?: number[]
    ): Promise<QueryResult<T>> {
        let text: string;
        let effectiveParams: unknown[] | undefined = params;
        if (isSqlQuery(sql)) {
            text = sql.text;
            if (effectiveParams === undefined) {
                effectiveParams = sql.params;
            }
        } else {
            text = sql;
        }
        if (effectiveParams === undefined) {
            return runSimpleQuery(this._id, text) as Promise<QueryResult<T>>;
        }
        return runExtendedQuery(
            this._id,
            text,
            effectiveParams,
            paramOids !== undefined ? paramOids : []
        ) as Promise<QueryResult<T>>;
    }

    /**
     * Run `cb` inside a `BEGIN` / `COMMIT` block. If `cb` throws, the
     * connection is rolled back and the error propagates. Nested calls
     * are NOT supported — use explicit SAVEPOINT queries inside `cb` if
     * you need nested transaction semantics.
     */
    async transaction<T>(cb: (conn: Connection) => Promise<T>): Promise<T> {
        await this.query('BEGIN');
        try {
            const result = await cb(this);
            await this.query('COMMIT');
            return result;
        } catch (e) {
            try {
                await this.query('ROLLBACK');
            } catch (_rollbackErr) {
                // Ignore rollback errors — the original error is what the
                // caller needs to see, and ROLLBACK can fail if the connection
                // is already dead.
            }
            throw e;
        }
    }

    /** Clean shutdown. Sends Terminate ('X'), then closes the socket. */
    close(): Promise<void> {
        return closeConnection(this._id);
    }

    /**
     * Send a Postgres CancelRequest on a separate fresh TCP connection.
     * The in-flight query (if any) rejects with a `PgError` carrying
     * SQLSTATE `57014` once the server processes the cancel. Fire-and-forget
     * — resolves when we've flushed the 16-byte request, not when the
     * server has actually acted (there's no server reply on the cancel
     * channel).
     *
     * Safe to call when no query is running — the server's cancel handler
     * is a no-op if the target backend is idle.
     */
    cancel(): Promise<void> {
        const st = CONN_STATES.get(this._id);
        if (st === undefined) {
            return Promise.resolve();
        }
        return sendCancelRequest(st.opts.host, st.opts.port, st.backendPid, st.secretKey);
    }

    on(event: 'notice', cb: (n: PgNotice) => void): void;
    on(event: 'parameter', cb: (k: string, v: string) => void): void;
    on(event: 'error', cb: (e: Error) => void): void;
    on(event: 'notification', cb: (n: Notification) => void): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, cb: (...args: any[]) => void): void {
        const st = CONN_STATES.get(this._id);
        if (st === undefined) {
            return;
        }
        if (event === 'notice') {
            st.noticeHandlers.push(cb as (n: PgNotice) => void);
        } else if (event === 'parameter') {
            st.paramHandlers.push(cb as (k: string, v: string) => void);
        } else if (event === 'error') {
            st.errorHandlers.push(cb as (e: Error) => void);
        } else if (event === 'notification') {
            st.notificationHandlers.push(cb as (n: Notification) => void);
        }
    }
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Open a connection, run the startup handshake and authentication, and
 * resolve once the server reports ReadyForQuery. Rejects with a `PgError`
 * (server-side failure) or plain `Error` (socket / local) otherwise.
 *
 * Accepts three input shapes, all equivalent:
 *
 *   - Explicit options:   `connect({ host, port, user, database, ... })`
 *   - URL / DSN:          `connect('postgres://user:pw@host:5432/db')`
 *   - URL + overrides:    `connect({ url: 'postgres://...', password: '...' })`
 *
 * When fields are missing from the explicit options / URL, they fall back
 * to the libpq environment variables (PGHOST, PGPORT, PGUSER, PGPASSWORD,
 * PGDATABASE, PGAPPNAME, PGSSLMODE, PGCONNECT_TIMEOUT).
 */
export function connect(
    input: string | ConnectOptions | ResolveOptionsInput
): Promise<Connection> {
    const opts: ConnectOptions =
        typeof input === 'string'
            ? resolveConnectOptions({ url: input })
            : isFullyResolved(input)
            ? (input as ConnectOptions)
            : resolveConnectOptions(input);
    return new Promise<Connection>((resolve, reject) => {
        const id = NEXT_CONN_ID;
        NEXT_CONN_ID += 1;

        const sock = openSocket(opts.host, opts.port);
        const conn = new Connection(id);

        const dataListener = (chunk: Buffer): void => {
            onSocketData(id, chunk);
        };
        const state: ConnState = {
            id: id,
            sock: sock,
            opts: opts,
            reader: new MessageReader(),
            status: 'connecting',
            backendPid: 0,
            secretKey: 0,
            paramStatus: {},
            txnStatus: 'idle',
            startupGate: { resolve: resolve, reject: reject, settled: false },
            pending: null,
            noticeHandlers: [],
            paramHandlers: [],
            errorHandlers: [],
            notificationHandlers: [],
            connection: conn,
            scram: null,
            dataListener: dataListener,
        };
        CONN_STATES.set(id, state);

        const connectTimeoutMs = opts.connectTimeoutMs !== undefined ? opts.connectTimeoutMs : 10000;
        let handshakeTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
            failStartup(id, new Error('connection timeout after ' + connectTimeoutMs + 'ms'));
        }, connectTimeoutMs);
        const clearHandshakeTimer = (): void => {
            if (handshakeTimer !== null) {
                clearTimeout(handshakeTimer);
                handshakeTimer = null;
            }
        };

        // Per Perry AOT, these callbacks don't touch `this`; they look up
        // state by id from the module-level map.
        sock.on('connect', () => {
            onSocketConnect(id);
        });
        sock.on('data', dataListener);
        sock.on('error', (err: Error | string) => {
            clearHandshakeTimer();
            onSocketError(id, err);
        });
        sock.on('close', () => {
            clearHandshakeTimer();
            onSocketClose(id);
        });
        // Clear the timer as soon as startup settles either way.
        const origResolve = state.startupGate!.resolve;
        const origReject = state.startupGate!.reject;
        state.startupGate!.resolve = (c: Connection) => {
            clearHandshakeTimer();
            origResolve(c);
        };
        state.startupGate!.reject = (e: Error) => {
            clearHandshakeTimer();
            origReject(e);
        };
    });
}

// ─── Socket event handlers (module-level per Perry constraints) ──────────────

function onSocketConnect(id: number): void {
    const st = CONN_STATES.get(id);
    if (st === undefined) {
        if (process.env.PERRY_PG_TRACE !== undefined) console.log('[pg] no state for id=' + id);
        return;
    }
    if (st.opts.ssl !== undefined && st.opts.ssl.mode !== 'disable') {
        // Postgres negotiates TLS mid-stream: send SSLRequest on plain TCP,
        // read one byte ('S' or 'N'), then upgrade if 'S'.
        st.status = 'ssl-requesting';
        st.sock.write(writeSSLRequest());
        return;
    }
    sendStartup(id);
}

/** Send the StartupMessage and transition into the auth phase. */
function sendStartup(id: number): void {
    const st = CONN_STATES.get(id);
    if (st === undefined) {
        return;
    }
    st.status = 'authenticating';

    const params: Record<string, string> = {
        user: st.opts.user,
        database: st.opts.database,
    };
    if (st.opts.applicationName !== undefined) {
        params.application_name = st.opts.applicationName;
    }
    // `client_encoding=UTF8` is the default on all modern servers, but
    // we pin it so text decoding is predictable in the codec layer.
    params.client_encoding = 'UTF8';

    st.sock.write(writeStartupMessage(params));
}

function onSocketData(id: number, chunk: Buffer): void {
    const st = CONN_STATES.get(id);
    if (st === undefined) {
        return;
    }
    if (st.status === 'ssl-requesting') {
        handleSSLNegotiationByte(id, chunk);
        return;
    }
    const frames = st.reader.feed(chunk);
    if (process.env.PERRY_PG_TRACE !== undefined) console.log('[pg] frames decoded=' + frames.length);
    for (let i = 0; i < frames.length; i++) {
        handleFrame(id, frames[i]);
    }
}

/**
 * The server's reply to SSLRequest is a single byte:
 *   0x53 'S' — "starting TLS"; client must begin a TLS handshake.
 *   0x4E 'N' — "plain only"; client either falls back or fails.
 *
 * Any bytes beyond the first belong to the TLS handshake (on 'S') and
 * are handled by the TLS layer, not here — we just start the upgrade.
 */
function handleSSLNegotiationByte(id: number, chunk: Buffer): void {
    const st = CONN_STATES.get(id);
    if (st === undefined || chunk.length === 0) {
        return;
    }
    const first = chunk.readUInt8(0);
    if (first === 0x53) {
        st.status = 'ssl-upgrading';
        const mode = st.opts.ssl !== undefined ? st.opts.ssl.mode : 'disable';
        const verify = mode === 'verify-ca' || mode === 'verify-full';
        // Detach our plain-socket 'data' listener BEFORE the upgrade: on
        // Node, tls.connect({socket}) otherwise races our listener for
        // the raw TLS handshake bytes and the handshake never completes.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sockAny = st.sock as any;
        if (typeof sockAny.removeListener === 'function') {
            sockAny.removeListener('data', st.dataListener);
        } else if (typeof sockAny.off === 'function') {
            sockAny.off('data', st.dataListener);
        }
        upgradeToTls(st.sock, { servername: st.opts.host, verify: verify })
            .then((newSock) => {
                onUpgradeComplete(id, newSock);
            })
            .catch((err: Error) => {
                failStartup(id, err);
                st.sock.destroy();
            });
        return;
    }
    if (first === 0x4E) {
        // Server refuses TLS. Fail iff the caller required it; in practice
        // we only reach this code path when ssl was requested, so always fail.
        const mode = st.opts.ssl !== undefined ? st.opts.ssl.mode : 'disable';
        const err = new Error(
            "server does not support SSL but sslmode='" + mode + "'"
        );
        failStartup(id, err);
        st.sock.destroy();
        return;
    }
    failStartup(id, new Error('unexpected SSL negotiation byte: 0x' + first.toString(16)));
    st.sock.destroy();
}

/**
 * Called once `upgradeToTls` resolves. On Node the returned socket is a
 * different object (a TLSSocket wrapping the plain socket), so we must
 * rewire listeners. On Perry the same handle is reused and no rewiring
 * is needed.
 */
function onUpgradeComplete(id: number, newSock: Socket): void {
    const st = CONN_STATES.get(id);
    if (st === undefined) {
        return;
    }
    if (newSock !== st.sock) {
        // Node path: TLSSocket is a different object. Rewire every listener.
        st.sock = newSock;
        newSock.on('data', st.dataListener);
        newSock.on('error', (err: Error | string) => {
            onSocketError(id, err);
        });
        newSock.on('close', () => {
            onSocketClose(id);
        });
    } else {
        // Perry path: same handle, re-attach our 'data' listener since we
        // detached it before the upgrade.
        newSock.on('data', st.dataListener);
    }
    sendStartup(id);
}

function onSocketError(id: number, err: Error | string): void {
    const asError = typeof err === 'string' ? new Error(err) : err;
    failStartup(id, asError);
    const st = CONN_STATES.get(id);
    if (st !== undefined) {
        for (let i = 0; i < st.errorHandlers.length; i++) {
            st.errorHandlers[i](asError);
        }
        if (st.pending !== null) {
            const p = st.pending;
            st.pending = null;
            p.reject(asError);
        }
    }
}

function onSocketClose(id: number): void {
    const st = CONN_STATES.get(id);
    if (st === undefined) {
        return;
    }
    if (st.status !== 'closed') {
        st.status = 'closed';
    }
    // Surface as an error to anyone waiting on startup or a query.
    const err = new Error('connection closed');
    failStartup(id, err);
    if (st.pending !== null) {
        const p = st.pending;
        st.pending = null;
        p.reject(err);
    }
    CONN_STATES.delete(id);
}

// ─── Frame dispatch ──────────────────────────────────────────────────────────

function handleFrame(id: number, frame: FrameView): void {
    const st = CONN_STATES.get(id);
    if (st === undefined) {
        return;
    }
    const t = frame.type;
    if (t === BACKEND_AUTH) {
        handleAuth(id, decodeAuthentication(frame.payload));
    } else if (t === BACKEND_BACKEND_KEY_DATA) {
        handleBackendKeyData(id, decodeBackendKeyData(frame.payload));
    } else if (t === BACKEND_PARAMETER_STATUS) {
        handleParameterStatus(id, frame.payload);
    } else if (t === BACKEND_READY_FOR_QUERY) {
        handleReadyForQuery(id, frame.payload);
    } else if (t === BACKEND_ROW_DESCRIPTION) {
        handleRowDescription(id, frame.payload);
    } else if (t === BACKEND_DATA_ROW) {
        handleDataRow(id, frame.payload);
    } else if (t === BACKEND_COMMAND_COMPLETE) {
        handleCommandComplete(id, frame.payload);
    } else if (t === BACKEND_EMPTY_QUERY_RESPONSE) {
        handleEmptyQuery(id);
    } else if (
        t === BACKEND_PARSE_COMPLETE
        || t === BACKEND_BIND_COMPLETE
        || t === BACKEND_CLOSE_COMPLETE
        || t === BACKEND_NO_DATA
        || t === BACKEND_PARAMETER_DESCRIPTION
        || t === BACKEND_PORTAL_SUSPENDED
    ) {
        // Informational — no data to collect, no state to advance here.
        // ParseComplete / BindComplete / CloseComplete fire for the
        // extended protocol; the query completes when ReadyForQuery arrives.
        // PortalSuspended is for row-by-row pagination (maxRows > 0) —
        // not exercised by runExtendedQuery (which uses maxRows=0).
    } else if (t === BACKEND_ERROR_RESPONSE) {
        handleErrorResponse(id, frame.payload);
    } else if (t === BACKEND_NOTICE_RESPONSE) {
        handleNoticeResponse(id, frame.payload);
    } else if (t === BACKEND_NOTIFICATION) {
        handleNotification(id, frame.payload);
    }
    // Unrecognized message types are ignored — forward-compat with future
    // Postgres versions that add new response types.
}

// ─── Startup / auth ──────────────────────────────────────────────────────────

function handleAuth(id: number, auth: AuthenticationRequest): void {
    const st = CONN_STATES.get(id);
    if (st === undefined) {
        return;
    }
    if (auth.kind === 'ok') {
        // Server accepted. Await further ParameterStatus / BackendKeyData /
        // ReadyForQuery before resolving the startup promise.
        return;
    }
    if (auth.kind === 'cleartext-password') {
        if (st.opts.password === undefined) {
            failStartup(id, new Error('server requires cleartext password but none provided'));
            st.sock.destroy();
            return;
        }
        st.sock.write(writePasswordMessage(st.opts.password));
        return;
    }
    if (auth.kind === 'md5-password') {
        if (st.opts.password === undefined) {
            failStartup(id, new Error('server requires md5 password but none provided'));
            st.sock.destroy();
            return;
        }
        const md5 = computeMD5Password(st.opts.user, st.opts.password, auth.salt);
        st.sock.write(writePasswordMessage(md5));
        return;
    }
    if (auth.kind === 'sasl') {
        if (st.opts.password === undefined) {
            failStartup(id, new Error('server requires SCRAM password but none provided'));
            st.sock.destroy();
            return;
        }
        try {
            const init = scramInit(st.opts.user, st.opts.password, auth.mechanisms);
            st.scram = init.state;
            st.sock.write(writePasswordRaw(init.initialResponsePayload));
        } catch (e) {
            failStartup(id, e as Error);
            st.sock.destroy();
        }
        return;
    }
    if (auth.kind === 'sasl-continue') {
        if (st.scram === null) {
            failStartup(id, new Error('SASL continue received before SASL init'));
            st.sock.destroy();
            return;
        }
        try {
            const clientFinal = scramContinue(st.scram, auth.data);
            st.sock.write(writePasswordRaw(clientFinal));
        } catch (e) {
            failStartup(id, e as Error);
            st.sock.destroy();
        }
        return;
    }
    if (auth.kind === 'sasl-final') {
        if (st.scram === null) {
            failStartup(id, new Error('SASL final received before SASL init'));
            st.sock.destroy();
            return;
        }
        try {
            scramVerifyServerFinal(st.scram, auth.data);
        } catch (e) {
            failStartup(id, e as Error);
            st.sock.destroy();
        }
        return;
    }
    if (auth.kind === 'kerberos-v5' || auth.kind === 'gss' || auth.kind === 'sspi') {
        failStartup(id, new Error('auth method "' + auth.kind + '" is not supported'));
        st.sock.destroy();
        return;
    }
    if (auth.kind === 'unknown') {
        failStartup(id, new Error('unknown authentication subtype ' + auth.subtype));
        st.sock.destroy();
        return;
    }
}

function handleBackendKeyData(id: number, data: BackendKeyData): void {
    const st = CONN_STATES.get(id);
    if (st === undefined) {
        return;
    }
    st.backendPid = data.pid;
    st.secretKey = data.secretKey;
    st.connection.backendPid = data.pid;
    st.connection.secretKey = data.secretKey;
}

function handleParameterStatus(id: number, payload: Buffer): void {
    const st = CONN_STATES.get(id);
    if (st === undefined) {
        return;
    }
    const p = decodeParameterStatus(payload);
    st.paramStatus[p.name] = p.value;
    for (let i = 0; i < st.paramHandlers.length; i++) {
        st.paramHandlers[i](p.name, p.value);
    }
}

function handleReadyForQuery(id: number, payload: Buffer): void {
    const st = CONN_STATES.get(id);
    if (st === undefined) {
        return;
    }
    st.txnStatus = decodeReadyForQuery(payload);

    if (st.status === 'authenticating') {
        st.status = 'ready';
        if (st.startupGate !== null && !st.startupGate.settled) {
            st.startupGate.settled = true;
            st.startupGate.resolve(st.connection);
            st.startupGate = null;
        }
        return;
    }
    if (st.status === 'querying' && st.pending !== null) {
        const p = st.pending;
        st.pending = null;
        st.status = 'ready';
        if (p.error !== null) {
            p.reject(p.error);
        } else {
            p.resolve(buildQueryResult(p.fields, p.rowsRaw, p.commandTag, p.rowCount));
        }
    }
}

/** Build the public `QueryResult` shape from raw accumulated rows. Decodes
 *  each cell via the type registry once and caches on the result. */
function buildQueryResult(
    fields: FieldDescription[],
    rowsRaw: RawRow[],
    command: string,
    rowCount: number
): QueryResult {
    const rowsArray: unknown[][] = new Array(rowsRaw.length);
    const rowsObj: Record<string, unknown>[] = new Array(rowsRaw.length);
    for (let i = 0; i < rowsRaw.length; i++) {
        const raw = rowsRaw[i];
        const arr: unknown[] = new Array(raw.length);
        const obj: Record<string, unknown> = {};
        for (let j = 0; j < raw.length; j++) {
            const cell = raw[j];
            let value: unknown;
            if (cell === null) {
                value = null;
            } else {
                const f = fields[j];
                value = decodeValue(f.typeOid, f.formatCode, cell);
            }
            arr[j] = value;
            if (j < fields.length) {
                obj[fields[j].name] = value;
            }
        }
        rowsArray[i] = arr;
        rowsObj[i] = obj;
    }
    return {
        fields: fields,
        rows: rowsObj,
        rowsArray: rowsArray,
        rowsRaw: rowsRaw,
        command: command,
        rowCount: rowCount,
    };
}

// ─── Query lifecycle ─────────────────────────────────────────────────────────

function runSimpleQuery(id: number, sql: string): Promise<QueryResult> {
    return new Promise<QueryResult>((resolve, reject) => {
        const st = CONN_STATES.get(id);
        if (st === undefined) {
            reject(new Error('connection closed'));
            return;
        }
        if (st.status !== 'ready') {
            reject(new Error('connection not ready (status=' + st.status + ')'));
            return;
        }
        st.status = 'querying';
        st.pending = {
            resolve: resolve,
            reject: reject,
            fields: [],
            rowsRaw: [],
            commandTag: '',
            rowCount: 0,
            error: null,
        };
        st.sock.write(writeQuery(sql));
    });
}

/**
 * Extended-protocol round trip. Sends Parse + Bind + Describe + Execute + Sync
 * in one flush; server reply sequence is:
 *   ParseComplete (1) → BindComplete (2) →
 *   (RowDescription | NoData) → DataRow* → CommandComplete → ReadyForQuery
 *
 * Parameters are encoded in text format (stable across every type in the
 * registry). Callers that need binary can set paramOids + use typed values.
 */
function runExtendedQuery(
    id: number,
    sql: string,
    params: unknown[],
    paramOids: number[]
): Promise<QueryResult> {
    return new Promise<QueryResult>((resolve, reject) => {
        const st = CONN_STATES.get(id);
        if (st === undefined) {
            reject(new Error('connection closed'));
            return;
        }
        if (st.status !== 'ready') {
            reject(new Error('connection not ready (status=' + st.status + ')'));
            return;
        }
        // Encode parameters — null preserved, rest goes through the registry
        // in text format. When a caller supplies paramOids we honour them;
        // otherwise we pass 0 ("unspecified") and let Postgres infer.
        const encoded: (Buffer | null)[] = new Array(params.length);
        for (let i = 0; i < params.length; i++) {
            const v = params[i];
            if (v === null || v === undefined) {
                encoded[i] = null;
            } else {
                const oid = i < paramOids.length ? paramOids[i] : 0;
                encoded[i] = oid === 0
                    ? Buffer.from(String(v), 'utf8')
                    : encodeValue(oid, FORMAT_TEXT, v);
            }
        }

        st.status = 'querying';
        st.pending = {
            resolve: resolve,
            reject: reject,
            fields: [],
            rowsRaw: [],
            commandTag: '',
            rowCount: 0,
            error: null,
        };

        // Unnamed statement / portal — Postgres optimizes this path.
        const flush = Buffer.concat([
            writeParse('', sql, paramOids),
            writeBind({
                portalName: '',
                stmtName: '',
                paramFormats: [],       // all text
                paramValues: encoded,
                resultFormats: [],      // all text — predictable, supports every type
            }),
            writeDescribe('P', ''),     // describe the portal → emits RowDescription / NoData
            writeExecute('', 0),        // 0 = no row limit
            writeSync(),
        ]);
        st.sock.write(flush);
    });
}

function handleRowDescription(id: number, payload: Buffer): void {
    const st = CONN_STATES.get(id);
    if (st === undefined || st.pending === null) {
        return;
    }
    st.pending.fields = decodeRowDescription(payload);
}

function handleDataRow(id: number, payload: Buffer): void {
    const st = CONN_STATES.get(id);
    if (st === undefined || st.pending === null) {
        return;
    }
    st.pending.rowsRaw.push(decodeDataRow(payload));
}

function handleCommandComplete(id: number, payload: Buffer): void {
    const st = CONN_STATES.get(id);
    if (st === undefined || st.pending === null) {
        return;
    }
    const cc = decodeCommandComplete(payload);
    st.pending.commandTag = cc.tag;
    st.pending.rowCount = cc.rowCount;
}

function handleEmptyQuery(id: number): void {
    const st = CONN_STATES.get(id);
    if (st === undefined || st.pending === null) {
        return;
    }
    st.pending.commandTag = '';
    st.pending.rowCount = 0;
}

function handleErrorResponse(id: number, payload: Buffer): void {
    const st = CONN_STATES.get(id);
    if (st === undefined) {
        return;
    }
    const err = parsePgError(payload);
    if (st.pending !== null) {
        st.pending.error = err;
        // Don't reject yet — we still need to wait for ReadyForQuery, which
        // is what restores the connection to a usable state after an error.
        return;
    }
    if (st.status === 'authenticating' && st.startupGate !== null && !st.startupGate.settled) {
        st.startupGate.settled = true;
        st.startupGate.reject(err);
        st.startupGate = null;
        return;
    }
    for (let i = 0; i < st.errorHandlers.length; i++) {
        st.errorHandlers[i](err);
    }
}

function handleNoticeResponse(id: number, payload: Buffer): void {
    const st = CONN_STATES.get(id);
    if (st === undefined) {
        return;
    }
    const notice = parsePgNotice(payload);
    for (let i = 0; i < st.noticeHandlers.length; i++) {
        st.noticeHandlers[i](notice);
    }
}

function handleNotification(id: number, payload: Buffer): void {
    const st = CONN_STATES.get(id);
    if (st === undefined) {
        return;
    }
    const notification = decodeNotification(payload);
    for (let i = 0; i < st.notificationHandlers.length; i++) {
        st.notificationHandlers[i](notification);
    }
}

// ─── Shutdown ────────────────────────────────────────────────────────────────

function closeConnection(id: number): Promise<void> {
    return new Promise<void>((resolve) => {
        const st = CONN_STATES.get(id);
        if (st === undefined) {
            resolve();
            return;
        }
        if (st.status === 'closed') {
            resolve();
            return;
        }
        let resolved = false;
        st.sock.on('close', () => {
            if (!resolved) {
                resolved = true;
                resolve();
            }
        });
        try {
            st.sock.write(writeTerminate());
        } catch (_e) {
            // Ignore — the socket may already be half-closed.
        }
        st.sock.end();
        // Belt-and-braces timer — if 'close' never fires (unlikely), resolve
        // after a short delay so callers don't hang forever.
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                resolve();
            }
        }, 500);
    });
}

/**
 * True when `input` already has the required ConnectOptions fields set.
 * Lets `connect()` skip the env/URL merge when the caller is explicit,
 * keeping the simple-options path a pure no-op.
 */
function isFullyResolved(input: ConnectOptions | ResolveOptionsInput): boolean {
    const maybeFull = input as Partial<ConnectOptions> & {
        url?: string;
        connectionString?: string;
    };
    return (
        maybeFull.url === undefined
        && maybeFull.connectionString === undefined
        && typeof maybeFull.host === 'string'
        && typeof maybeFull.port === 'number'
        && typeof maybeFull.user === 'string'
        && typeof maybeFull.database === 'string'
    );
}

function failStartup(id: number, err: Error): void {
    const st = CONN_STATES.get(id);
    if (st === undefined) {
        return;
    }
    if (st.startupGate !== null && !st.startupGate.settled) {
        st.startupGate.settled = true;
        st.startupGate.reject(err);
        st.startupGate = null;
    }
}
