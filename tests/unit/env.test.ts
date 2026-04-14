import { afterEach, beforeEach, test, expect } from 'bun:test';
import { resolveConnectOptions } from '../../src';

const PG_KEYS = [
    'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE',
    'PGAPPNAME', 'PGCONNECT_TIMEOUT', 'PGSSLMODE',
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
    for (const k of PG_KEYS) {
        saved[k] = process.env[k];
        delete process.env[k];
    }
});
afterEach(() => {
    for (const k of PG_KEYS) {
        if (saved[k] === undefined) {
            delete process.env[k];
        } else {
            process.env[k] = saved[k];
        }
    }
});

test('explicit options pass straight through', () => {
    const r = resolveConnectOptions({
        host: 'h', port: 5555, user: 'u', database: 'd', password: 'p',
    });
    expect(r).toMatchObject({ host: 'h', port: 5555, user: 'u', database: 'd', password: 'p' });
});

test('URL fills in everything when no explicit fields', () => {
    const r = resolveConnectOptions({ url: 'postgres://u:p@h:6543/db?sslmode=require' });
    expect(r.host).toBe('h');
    expect(r.port).toBe(6543);
    expect(r.user).toBe('u');
    expect(r.password).toBe('p');
    expect(r.database).toBe('db');
    expect(r.ssl).toEqual({ mode: 'require' });
});

test('explicit fields beat URL fields', () => {
    const r = resolveConnectOptions({
        url: 'postgres://urlu@urlh/urldb',
        user: 'realuser', host: 'realhost',
    });
    expect(r.user).toBe('realuser');
    expect(r.host).toBe('realhost');
    expect(r.database).toBe('urldb');
});

test('env vars fill in remaining fields', () => {
    process.env.PGHOST = 'envhost';
    process.env.PGPORT = '7777';
    process.env.PGUSER = 'envuser';
    process.env.PGDATABASE = 'envdb';
    process.env.PGSSLMODE = 'verify-ca';
    const r = resolveConnectOptions();
    expect(r.host).toBe('envhost');
    expect(r.port).toBe(7777);
    expect(r.user).toBe('envuser');
    expect(r.database).toBe('envdb');
    expect(r.ssl).toEqual({ mode: 'verify-ca' });
});

test('database defaults to user when neither database nor PGDATABASE is set', () => {
    process.env.PGUSER = 'alice';
    const r = resolveConnectOptions();
    expect(r.user).toBe('alice');
    expect(r.database).toBe('alice');
});

test('throws when user is missing everywhere', () => {
    expect(() => resolveConnectOptions()).toThrow(/user/);
});

test('PGCONNECT_TIMEOUT seconds → connectTimeoutMs', () => {
    process.env.PGUSER = 'u';
    process.env.PGCONNECT_TIMEOUT = '7';
    const r = resolveConnectOptions();
    expect(r.connectTimeoutMs).toBe(7000);
});
