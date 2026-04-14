// C4 TLS integration. Exercises the full SSLRequest → 'S' or 'N' →
// optional handshake → Startup flow through the same public `connect()`
// surface. A self-signed cert is generated once per test process.

import { afterEach, beforeAll, test, expect } from 'bun:test';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from '../../src';
import { startMockServer, MockServer } from './mock-server';

// Bun 1.3.5 has a bug in `tls.connect({socket})` / `new tls.TLSSocket(socket)`:
// the handshake silently stalls — no 'secure' / 'error' / 'close' event fires.
// Node (tested on v25) is fine, and the Perry path (A2) is proven separately
// in /Users/amlug/projects/perry/perry/test-files/test_net_upgrade_tls.ts.
// We skip the handshake-requiring tests on Bun and run the full matrix under
// Node via `bun run test:tls:node` (see package.json).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isBun = typeof (globalThis as any).Bun !== 'undefined';
const tlsTest = isBun ? test.skip : test;

const CERT_PATH = join(tmpdir(), 'perry_pg_driver_tls.crt');
const KEY_PATH = join(tmpdir(), 'perry_pg_driver_tls.key');

let cert: Buffer;
let key: Buffer;
let server: MockServer | null = null;

beforeAll(() => {
    if (!existsSync(CERT_PATH) || !existsSync(KEY_PATH)) {
        execSync(
            `openssl req -x509 -newkey rsa:2048 -keyout ${KEY_PATH} -out ${CERT_PATH} ` +
            `-days 30 -nodes -subj '/CN=127.0.0.1' ` +
            `-addext 'subjectAltName=IP:127.0.0.1'`,
            { stdio: 'ignore' }
        );
    }
    cert = readFileSync(CERT_PATH);
    key = readFileSync(KEY_PATH);
});

afterEach(async () => {
    if (server !== null) {
        await server.close();
        server = null;
    }
});

test('sslmode=disable: no SSLRequest sent, plain startup succeeds', async () => {
    server = await startMockServer({ authMode: 'trust' });
    const conn = await connect({
        host: '127.0.0.1',
        port: server.port,
        user: 'perry',
        database: 'perry_test',
        ssl: { mode: 'disable' },
    });
    const r = await conn.query('SELECT 1');
    expect(r.rowsRaw[0][0]!.toString('utf8')).toBe('1');
    await conn.close();
});

tlsTest('sslmode=require: server accepts TLS and the query runs over TLS', async () => {
    server = await startMockServer({
        authMode: 'trust',
        ssl: 'accept',
        tlsCert: cert,
        tlsKey: key,
    });
    const conn = await connect({
        host: '127.0.0.1',
        port: server.port,
        user: 'perry',
        database: 'perry_test',
        ssl: { mode: 'require' }, // encrypt but do not verify
    });
    const r = await conn.query('SELECT 1');
    expect(r.rowsRaw[0][0]!.toString('utf8')).toBe('1');
    expect(conn.backendPid).toBe(42);
    await conn.close();
});

test('sslmode=require against a server that refuses TLS fails clearly', async () => {
    server = await startMockServer({ authMode: 'trust', ssl: 'refuse' });
    let caught: Error | null = null;
    try {
        await connect({
            host: '127.0.0.1',
            port: server.port,
            user: 'perry',
            database: 'perry_test',
            ssl: { mode: 'require' },
        });
    } catch (e) {
        caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain('does not support SSL');
});

tlsTest('sslmode=verify-full against a self-signed cert fails verification', async () => {
    server = await startMockServer({
        authMode: 'trust',
        ssl: 'accept',
        tlsCert: cert,
        tlsKey: key,
    });
    let caught: Error | null = null;
    try {
        await connect({
            host: '127.0.0.1',
            port: server.port,
            user: 'perry',
            database: 'perry_test',
            ssl: { mode: 'verify-full' },
        });
    } catch (e) {
        caught = e as Error;
    }
    expect(caught).not.toBeNull();
    // Message shape is platform-specific; either Node's error text or the
    // Perry-side "tls handshake:" wrapping counts.
    const msg = caught!.message.toLowerCase();
    const verifyError =
        msg.includes('self signed') ||
        msg.includes('self-signed') ||
        msg.includes('certificate') ||
        msg.includes('unable to') ||
        msg.includes('verify');
    expect(verifyError).toBe(true);
});

tlsTest('auth over TLS: SCRAM-SHA-256 after an encrypted upgrade', async () => {
    server = await startMockServer({
        authMode: 'scram',
        password: 's3cr3t',
        expectedUser: 'perry',
        ssl: 'accept',
        tlsCert: cert,
        tlsKey: key,
    });
    const conn = await connect({
        host: '127.0.0.1',
        port: server.port,
        user: 'perry',
        database: 'perry_test',
        password: 's3cr3t',
        ssl: { mode: 'require' },
    });
    const r = await conn.query('SELECT 1');
    expect(r.rowsRaw[0][0]!.toString('utf8')).toBe('1');
    await conn.close();
});
