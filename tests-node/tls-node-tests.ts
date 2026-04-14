// TLS integration suite for the Node runner — mirrors tls.test.ts but uses
// `node:test` instead of `bun:test`. Needed because Bun 1.3.5 has a bug in
// `tls.connect({socket})` (silent handshake stall), so we run the tests
// that require a real TLS handshake under Node.
//
// Run with: `npm run test:tls:node` (or `bun run test:tls:node`).

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from '../src/index.ts';
import { startMockServer, type MockServer } from '../tests/integration/mock-server.ts';

const CERT_PATH = join(tmpdir(), 'perry_pg_driver_tls.crt');
const KEY_PATH = join(tmpdir(), 'perry_pg_driver_tls.key');

let cert: Buffer;
let key: Buffer;
let server: MockServer | null = null;

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

async function closeServer() {
    if (server !== null) {
        await server.close();
        server = null;
    }
}

test('sslmode=disable: no SSLRequest, plain startup succeeds', async () => {
    try {
        server = await startMockServer({ authMode: 'trust' });
        const conn = await connect({
            host: '127.0.0.1',
            port: server.port,
            user: 'perry',
            database: 'perry_test',
            ssl: { mode: 'disable' },
        });
        const r = await conn.query('SELECT 1');
        assert.equal(r.rows[0][0]!.toString('utf8'), '1');
        await conn.close();
    } finally {
        await closeServer();
    }
});

test('sslmode=require: server accepts TLS, query runs over TLS', async () => {
    try {
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
            ssl: { mode: 'require' },
        });
        const r = await conn.query('SELECT 1');
        assert.equal(r.rows[0][0]!.toString('utf8'), '1');
        assert.equal(conn.backendPid, 42);
        await conn.close();
    } finally {
        await closeServer();
    }
});

test('sslmode=require against a server that refuses TLS fails clearly', async () => {
    try {
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
        assert.notEqual(caught, null);
        assert.match(caught!.message, /does not support SSL/);
    } finally {
        await closeServer();
    }
});

test('sslmode=verify-full against a self-signed cert fails verification', async () => {
    try {
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
        await closeServer();
    }
});

test('auth over TLS: SCRAM-SHA-256 after an encrypted upgrade', async () => {
    try {
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
        assert.equal(r.rows[0][0]!.toString('utf8'), '1');
        await conn.close();
    } finally {
        await closeServer();
    }
});

after(closeServer);
