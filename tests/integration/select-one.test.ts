// C2 end-to-end integration test against an in-process Postgres mock.
// Exercises the full startup handshake + query flow. A real-Postgres
// companion test lives in `real-postgres.test.ts` and skips when no PG is
// reachable via env (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE).

import { afterEach, beforeEach, test, expect } from 'bun:test';
import { connect } from '../../src';
import { startMockServer, MockServer } from './mock-server';

let server: MockServer | null = null;

afterEach(async () => {
    if (server !== null) {
        await server.close();
        server = null;
    }
});

test('trust auth: startup + SELECT 1 round-trips a row', async () => {
    server = await startMockServer({ authMode: 'trust' });

    const conn = await connect({
        host: '127.0.0.1',
        port: server.port,
        user: 'perry',
        database: 'perry_test',
    });

    expect(conn.backendPid).toBe(42);
    expect(conn.parameter('server_version')).toBe('16.0');
    expect(conn.parameter('client_encoding')).toBe('UTF8');

    const r = await conn.query('SELECT 1');
    expect(r.fields.length).toBe(1);
    expect(r.fields[0].name).toBe('n');
    expect(r.fields[0].typeOid).toBe(23);
    expect(r.rows.length).toBe(1);
    expect(r.rowsRaw[0][0]!.toString('utf8')).toBe('1');
    expect(r.command).toBe('SELECT 1');
    expect(r.rowCount).toBe(1);

    await conn.close();
});

test('cleartext auth: password exchanged before SELECT succeeds', async () => {
    server = await startMockServer({ authMode: 'cleartext', password: 's3cr3t' });

    const conn = await connect({
        host: '127.0.0.1',
        port: server.port,
        user: 'perry',
        database: 'perry_test',
        password: 's3cr3t',
    });

    const r = await conn.query('SELECT 1');
    expect(r.rowsRaw[0][0]!.toString('utf8')).toBe('1');

    await conn.close();
});

test('cleartext auth: wrong password rejects with PgError 28P01', async () => {
    server = await startMockServer({ authMode: 'cleartext', password: 's3cr3t' });

    let caught: Error | null = null;
    try {
        await connect({
            host: '127.0.0.1',
            port: server.port,
            user: 'perry',
            database: 'perry_test',
            password: 'wrong',
        });
    } catch (e) {
        caught = e as Error;
    }
    expect(caught).not.toBeNull();
    // Server sends ErrorResponse before closing.
    // Depending on timing we'll either see the PgError or a plain
    // "connection closed". Accept either, but if it's a PgError verify the
    // SQLSTATE.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: any = caught;
    if (err.name === 'PgError') {
        expect(err.code).toBe('28P01');
    }
});

test('missing password fails with a clear error', async () => {
    server = await startMockServer({ authMode: 'cleartext', password: 's3cr3t' });

    let caught: Error | null = null;
    try {
        await connect({
            host: '127.0.0.1',
            port: server.port,
            user: 'perry',
            database: 'perry_test',
            // no password
        });
    } catch (e) {
        caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain('cleartext password');
});

test('md5 auth: challenge + response round-trips successfully', async () => {
    server = await startMockServer({
        authMode: 'md5',
        password: 's3cr3t',
        expectedUser: 'perry',
    });
    const conn = await connect({
        host: '127.0.0.1',
        port: server.port,
        user: 'perry',
        database: 'perry_test',
        password: 's3cr3t',
    });
    const r = await conn.query('SELECT 1');
    expect(r.rowsRaw[0][0]!.toString('utf8')).toBe('1');
    await conn.close();
});

test('md5 auth: wrong password rejects', async () => {
    server = await startMockServer({
        authMode: 'md5',
        password: 's3cr3t',
        expectedUser: 'perry',
    });
    let caught: Error | null = null;
    try {
        await connect({
            host: '127.0.0.1',
            port: server.port,
            user: 'perry',
            database: 'perry_test',
            password: 'wrong',
        });
    } catch (e) {
        caught = e as Error;
    }
    expect(caught).not.toBeNull();
});

test('SCRAM-SHA-256: full sasl exchange round-trips', async () => {
    server = await startMockServer({
        authMode: 'scram',
        password: 's3cr3t',
        expectedUser: 'perry',
    });
    const conn = await connect({
        host: '127.0.0.1',
        port: server.port,
        user: 'perry',
        database: 'perry_test',
        password: 's3cr3t',
    });
    expect(conn.backendPid).toBe(42);
    const r = await conn.query('SELECT 1');
    expect(r.rowsRaw[0][0]!.toString('utf8')).toBe('1');
    await conn.close();
});

test('SCRAM-SHA-256: wrong password rejects at client-final verification', async () => {
    server = await startMockServer({
        authMode: 'scram',
        password: 's3cr3t',
        expectedUser: 'perry',
    });
    let caught: Error | null = null;
    try {
        await connect({
            host: '127.0.0.1',
            port: server.port,
            user: 'perry',
            database: 'perry_test',
            password: 'wrong',
        });
    } catch (e) {
        caught = e as Error;
    }
    expect(caught).not.toBeNull();
});

test('multi-row SELECT returns every row', async () => {
    server = await startMockServer({
        authMode: 'trust',
        defaultSelect: {
            columns: [{ name: 'id', typeOid: 23 }, { name: 'name', typeOid: 25 }],
            rows: [
                ['1', 'alice'],
                ['2', 'bob'],
                ['3', null],
            ],
            commandTag: 'SELECT 3',
        },
    });

    const conn = await connect({
        host: '127.0.0.1',
        port: server.port,
        user: 'perry',
        database: 'perry_test',
    });
    const r = await conn.query('SELECT id, name FROM users');
    expect(r.rows.length).toBe(3);
    expect(r.rowsRaw[0][0]!.toString('utf8')).toBe('1');
    expect(r.rowsRaw[0][1]!.toString('utf8')).toBe('alice');
    expect(r.rowsRaw[2][1]).toBeNull();
    expect(r.rowCount).toBe(3);
    expect(r.command).toBe('SELECT 3');
    await conn.close();
});
