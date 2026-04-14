// Integration tests for the v0.2 ergonomics: transaction wrapper, pool,
// SqlQuery tagged-template input to query(), URL-based connect().

import { afterEach, test, expect } from 'bun:test';
import { connect, createPool, sql } from '../../src';
import { startMockServer, MockServer } from './mock-server';

let server: MockServer | null = null;

afterEach(async () => {
    if (server !== null) {
        await server.close();
        server = null;
    }
});

// ─── connect() with URL ─────────────────────────────────────────────────────

test('connect() accepts a postgres:// URL', async () => {
    server = await startMockServer({ authMode: 'trust' });
    const url = 'postgres://perry@127.0.0.1:' + server.port + '/perry_test';
    const conn = await connect(url);
    const r = await conn.query('SELECT 1');
    expect(r.rowsRaw[0][0]!.toString('utf8')).toBe('1');
    await conn.close();
});

// ─── sql tagged template input ──────────────────────────────────────────────

test('conn.query(sql`...`) sends the right text + params', async () => {
    server = await startMockServer({ authMode: 'trust' });
    const conn = await connect({
        host: '127.0.0.1', port: server.port,
        user: 'perry', database: 'perry_test',
    });
    const id = 42;
    const r = await conn.query(sql`SELECT $1::int4`, [id]); // params explicit
    expect(r.rowsRaw[0][0]!.toString('utf8')).toBe('42');

    // Embedded params version (nicer at the call site).
    const r2 = await conn.query<{ '?column?': number }>(sql`SELECT ${99}::int4`);
    expect(r2.rowsArray[0][0]).toBe(99);
    await conn.close();
});

// ─── decoded rows: object + positional ──────────────────────────────────────

test('result.rows is decoded objects keyed by column name', async () => {
    server = await startMockServer({
        authMode: 'trust',
        defaultSelect: {
            columns: [{ name: 'id', typeOid: 23 }, { name: 'name', typeOid: 25 }],
            rows: [['1', 'alice'], ['2', null]],
            commandTag: 'SELECT 2',
        },
    });
    const conn = await connect({
        host: '127.0.0.1', port: server.port,
        user: 'perry', database: 'perry_test',
    });
    const r = await conn.query<{ id: number; name: string | null }>('SELECT *');
    expect(r.rows).toEqual([{ id: 1, name: 'alice' }, { id: 2, name: null }]);
    expect(r.rowsArray).toEqual([[1, 'alice'], [2, null]]);
    expect(r.rowCount).toBe(2);
    await conn.close();
});

// ─── transaction() ──────────────────────────────────────────────────────────

test('conn.transaction commits when callback resolves', async () => {
    server = await startMockServer({ authMode: 'trust' });
    const conn = await connect({
        host: '127.0.0.1', port: server.port,
        user: 'perry', database: 'perry_test',
    });
    const result = await conn.transaction(async (tx) => {
        const r = await tx.query('SELECT 1');
        return r.rowsArray[0][0];
    });
    expect(result).toBe(1);
    await conn.close();
});

test('conn.transaction rolls back when callback throws', async () => {
    server = await startMockServer({ authMode: 'trust' });
    const conn = await connect({
        host: '127.0.0.1', port: server.port,
        user: 'perry', database: 'perry_test',
    });
    let caught: Error | null = null;
    try {
        await conn.transaction(async () => {
            throw new Error('boom');
        });
    } catch (e) {
        caught = e as Error;
    }
    expect(caught!.message).toBe('boom');
    // Connection still works after the rollback.
    const r = await conn.query('SELECT 1');
    expect(r.rowsArray[0][0]).toBe(1);
    await conn.close();
});

// ─── Pool ───────────────────────────────────────────────────────────────────

test('pool.query acquires + releases a connection', async () => {
    server = await startMockServer({ authMode: 'trust' });
    const pool = createPool({
        url: 'postgres://perry@127.0.0.1:' + server.port + '/perry_test',
        max: 3,
    });
    const r = await pool.query('SELECT 1');
    expect(r.rowsRaw[0][0]!.toString('utf8')).toBe('1');
    expect(pool.size().idle).toBe(1);
    await pool.end();
});

test('pool.transaction wraps a transaction on a pooled connection', async () => {
    server = await startMockServer({ authMode: 'trust' });
    const pool = createPool({
        host: '127.0.0.1', port: server.port,
        user: 'perry', database: 'perry_test',
        max: 2,
    });
    const result = await pool.transaction(async (tx) => {
        const r = await tx.query('SELECT 1');
        return r.rowsArray[0][0];
    });
    expect(result).toBe(1);
    await pool.end();
});

test('pool serializes acquires when at capacity', async () => {
    server = await startMockServer({ authMode: 'trust', simulatedSleepMs: 200 });
    const pool = createPool({
        host: '127.0.0.1', port: server.port,
        user: 'perry', database: 'perry_test',
        max: 1,
    });
    // Two concurrent queries, max=1 → second must wait for first.
    const t0 = Date.now();
    const [r1, r2] = await Promise.all([
        pool.query('SELECT pg_sleep(1)'),
        pool.query('SELECT pg_sleep(1)'),
    ]);
    const elapsed = Date.now() - t0;
    expect(r1.rowCount).toBe(1);
    expect(r2.rowCount).toBe(1);
    // Both queries took ~200ms each; serialized → ≥400ms total.
    expect(elapsed).toBeGreaterThanOrEqual(380);
    await pool.end();
});

test('pool.acquire times out when full and idle exhausted', async () => {
    server = await startMockServer({ authMode: 'trust', simulatedSleepMs: 1500 });
    const pool = createPool({
        host: '127.0.0.1', port: server.port,
        user: 'perry', database: 'perry_test',
        max: 1,
        acquireTimeoutMs: 100,
    });
    const slow = pool.query('SELECT pg_sleep(2)');
    let caught: Error | null = null;
    try {
        await pool.query('SELECT 1');
    } catch (e) {
        caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain('timed out');
    // Drain the slow query so afterEach can shut the server cleanly.
    await slow;
    await pool.end();
});
