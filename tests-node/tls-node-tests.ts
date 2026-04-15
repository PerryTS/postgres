// TLS integration suite for the Node runner — mirrors tls.test.ts but uses
// `node:test` instead of `bun:test`. Needed because Bun 1.3.5 has a bug in
// `tls.connect({socket})` (silent handshake stall), so we run the tests
// that require a real TLS handshake under Node.
//
// Run with: `npm run test:tls:node` (or `bun run test:tls:node`).
//
// Cleanup contract: each test scopes its own `server` and `conn` to
// locals and closes both in a `finally` block. We deliberately do NOT
// share a single module-level `server` variable — it's tempting but
// dangerous: a failing assertion bypasses the in-test `conn.close()`,
// the TCP connection stays open, and `server.close()` then waits
// forever for the connection to drain. The whole node:test run hangs
// with no diagnostic output. The per-test scope keeps a hung test from
// taking down the suite.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Connection } from '../src/index.ts';
import { connect } from '../src/index.ts';
import { startMockServer, type MockServer } from '../tests/integration/mock-server.ts';

const CERT_PATH = join(tmpdir(), 'perry_pg_driver_tls.crt');
const KEY_PATH = join(tmpdir(), 'perry_pg_driver_tls.key');

let cert: Buffer;
let key: Buffer;

before(() => {
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

/**
 * Best-effort cleanup helper. Closes the connection (if any) before the
 * server, so `server.close()` doesn't block on a still-open client. Each
 * close is wrapped in its own try/catch — a failure tearing down the conn
 * shouldn't prevent the server from also being torn down.
 */
async function teardown(conn: Connection | null, server: MockServer | null): Promise<void> {
    if (conn !== null) {
        try { await conn.close(); } catch { /* already closed */ }
    }
    if (server !== null) {
        try { await server.close(); } catch { /* already closed */ }
    }
}

test('sslmode=disable: no SSLRequest, plain startup succeeds', async () => {
    let server: MockServer | null = null;
    let conn: Connection | null = null;
    try {
        server = await startMockServer({ authMode: 'trust' });
        conn = await connect({
            host: '127.0.0.1',
            port: server.port,
            user: 'perry',
            database: 'perry_test',
            ssl: { mode: 'disable' },
        });
        const r = await conn.query('SELECT 1');
        assert.equal(r.rowsRaw[0][0]!.toString('utf8'), '1');
    } finally {
        await teardown(conn, server);
    }
});

test('sslmode=require: server accepts TLS, query runs over TLS', async () => {
    let server: MockServer | null = null;
    let conn: Connection | null = null;
    try {
        server = await startMockServer({
            authMode: 'trust',
            ssl: 'accept',
            tlsCert: cert,
            tlsKey: key,
        });
        conn = await connect({
            host: '127.0.0.1',
            port: server.port,
            user: 'perry',
            database: 'perry_test',
            ssl: { mode: 'require' },
        });
        const r = await conn.query('SELECT 1');
        assert.equal(r.rowsRaw[0][0]!.toString('utf8'), '1');
        assert.equal(conn.backendPid, 42);
    } finally {
        await teardown(conn, server);
    }
});

test('sslmode=require against a server that refuses TLS fails clearly', async () => {
    let server: MockServer | null = null;
    let caught: Error | null = null;
    try {
        server = await startMockServer({ authMode: 'trust', ssl: 'refuse' });
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
        assert.notEqual(caught, null);
        assert.match(caught!.message, /does not support SSL/);
    } finally {
        await teardown(null, server);
    }
});

test('sslmode=verify-full against a self-signed cert fails verification', async () => {
    let server: MockServer | null = null;
    let caught: Error | null = null;
    try {
        server = await startMockServer({
            authMode: 'trust',
            ssl: 'accept',
            tlsCert: cert,
            tlsKey: key,
        });
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
        assert.notEqual(caught, null);
        // Node's wording for a self-signed cert verification error.
        const msg = caught!.message.toLowerCase();
        assert.ok(
            msg.includes('self signed') ||
            msg.includes('self-signed') ||
            msg.includes('certificate') ||
            msg.includes('unable to') ||
            msg.includes('verify'),
            'expected a verification-related error, got: ' + caught!.message
        );
    } finally {
        await teardown(null, server);
    }
});

test('auth over TLS: SCRAM-SHA-256 after an encrypted upgrade', async () => {
    let server: MockServer | null = null;
    let conn: Connection | null = null;
    try {
        server = await startMockServer({
            authMode: 'scram',
            password: 's3cr3t',
            expectedUser: 'perry',
            ssl: 'accept',
            tlsCert: cert,
            tlsKey: key,
        });
        conn = await connect({
            host: '127.0.0.1',
            port: server.port,
            user: 'perry',
            database: 'perry_test',
            password: 's3cr3t',
            ssl: { mode: 'require' },
        });
        const r = await conn.query('SELECT 1');
        assert.equal(r.rowsRaw[0][0]!.toString('utf8'), '1');
    } finally {
        await teardown(conn, server);
    }
});
