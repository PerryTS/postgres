// Extended-query-protocol integration tests. Exercises the full
// Parse/Bind/Describe/Execute/Sync round-trip plus typed parameter
// encoding through the codec registry, end to end against the mock
// Postgres.

import { afterEach, test, expect } from 'bun:test';
import {
    connect,
    Decimal,
    OID_INT4,
    OID_NUMERIC,
    OID_TEXT,
    OID_UUID,
    rowsDecoded,
    toObjects,
} from '../../src';
import { startMockServer, MockServer } from './mock-server';

let server: MockServer | null = null;

afterEach(async () => {
    if (server !== null) {
        await server.close();
        server = null;
    }
});

test('query(sql, []) goes through extended protocol and still returns canned rows', async () => {
    server = await startMockServer({ authMode: 'trust' });
    const conn = await connect({
        host: '127.0.0.1', port: server.port,
        user: 'perry', database: 'perry_test',
    });
    const r = await conn.query('SELECT 1', []);
    expect(r.rows.length).toBe(1);
    expect(r.rowsRaw[0][0]!.toString('utf8')).toBe('1');
    expect(r.command).toBe('SELECT 1');
    await conn.close();
});

test('parameterized SELECT $1::int4 round-trips an int through the codec', async () => {
    server = await startMockServer({ authMode: 'trust' });
    const conn = await connect({
        host: '127.0.0.1', port: server.port,
        user: 'perry', database: 'perry_test',
    });
    const r = await conn.query('SELECT $1::int4', [42], [OID_INT4]);
    expect(r.fields.length).toBe(1);
    expect(r.fields[0].typeOid).toBe(OID_INT4);
    const decoded = rowsDecoded(r);
    expect(decoded[0][0]).toBe(42);
    await conn.close();
});

test('parameterized SELECT $1::numeric preserves precision via Decimal', async () => {
    server = await startMockServer({ authMode: 'trust' });
    const conn = await connect({
        host: '127.0.0.1', port: server.port,
        user: 'perry', database: 'perry_test',
    });
    const huge = new Decimal('12345678901234567890.0987654321');
    const r = await conn.query('SELECT $1::numeric', [huge], [OID_NUMERIC]);
    const decoded = rowsDecoded(r);
    expect(decoded[0][0]).toBeInstanceOf(Decimal);
    expect((decoded[0][0] as Decimal).toString()).toBe('12345678901234567890.0987654321');
    await conn.close();
});

test('parameterized SELECT $1::uuid round-trips a uuid string', async () => {
    server = await startMockServer({ authMode: 'trust' });
    const conn = await connect({
        host: '127.0.0.1', port: server.port,
        user: 'perry', database: 'perry_test',
    });
    const id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const r = await conn.query('SELECT $1::uuid', [id], [OID_UUID]);
    const decoded = rowsDecoded(r);
    expect(decoded[0][0]).toBe(id);
    await conn.close();
});

test('parameterized SELECT $1::text handles non-ASCII text', async () => {
    server = await startMockServer({ authMode: 'trust' });
    const conn = await connect({
        host: '127.0.0.1', port: server.port,
        user: 'perry', database: 'perry_test',
    });
    const r = await conn.query('SELECT $1::text', ['héllo τέλος'], [OID_TEXT]);
    const decoded = rowsDecoded(r);
    expect(decoded[0][0]).toBe('héllo τέλος');
    await conn.close();
});

test('toObjects maps columns to names', async () => {
    server = await startMockServer({
        authMode: 'trust',
        defaultSelect: {
            columns: [{ name: 'id', typeOid: OID_INT4 }, { name: 'name', typeOid: OID_TEXT }],
            rows: [['1', 'alice'], ['2', null]],
            commandTag: 'SELECT 2',
        },
    });
    const conn = await connect({
        host: '127.0.0.1', port: server.port,
        user: 'perry', database: 'perry_test',
    });
    const r = await conn.query('SELECT id, name FROM users', []);
    const objs = toObjects(r);
    expect(objs).toEqual([{ id: 1, name: 'alice' }, { id: 2, name: null }]);
    await conn.close();
});

test('null parameters encode as SQL NULL', async () => {
    server = await startMockServer({ authMode: 'trust' });
    const conn = await connect({
        host: '127.0.0.1', port: server.port,
        user: 'perry', database: 'perry_test',
    });
    const r = await conn.query('SELECT $1::int4', [null], [OID_INT4]);
    expect(r.rowsRaw[0][0]).toBeNull();
    await conn.close();
});

test('multiple parameterized queries on the same connection', async () => {
    server = await startMockServer({ authMode: 'trust' });
    const conn = await connect({
        host: '127.0.0.1', port: server.port,
        user: 'perry', database: 'perry_test',
    });
    const a = await conn.query('SELECT $1::int4', [1], [OID_INT4]);
    const b = await conn.query('SELECT $1::int4', [2], [OID_INT4]);
    const c = await conn.query('SELECT $1::int4', [3], [OID_INT4]);
    expect(rowsDecoded(a)[0][0]).toBe(1);
    expect(rowsDecoded(b)[0][0]).toBe(2);
    expect(rowsDecoded(c)[0][0]).toBe(3);
    await conn.close();
});
