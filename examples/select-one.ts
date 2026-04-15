// Minimal end-to-end demo: connect to a Postgres, run `SELECT 1`, print the row.
//
// Usage (against a real server):
//   PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=... \
//     PGDATABASE=postgres bun run examples/select-one.ts
//
// Usage (against the in-process mock — no Postgres required):
//   bun run examples/select-one.ts
//
// The demo is intentionally unadorned: every piece is part of the package's
// public API. Copy-paste as a starting point.

import { connect } from '../src';
import { startMockServer } from '../tests/integration/mock-server';

async function main(): Promise<void> {
    const host = process.env.PGHOST;
    const port = process.env.PGPORT;
    const user = process.env.PGUSER;
    const password = process.env.PGPASSWORD;
    const database = process.env.PGDATABASE;

    let connectOpts: Parameters<typeof connect>[0];
    let shutdownMock: (() => Promise<void>) | null = null;

    if (host !== undefined && port !== undefined && user !== undefined && database !== undefined) {
        connectOpts = {
            host: host,
            port: parseInt(port, 10),
            user: user,
            database: database,
            password: password,
        };
        console.log('connecting to real Postgres at ' + host + ':' + port);
    } else {
        const mock = await startMockServer({ authMode: 'trust' });
        shutdownMock = mock.close;
        connectOpts = {
            host: '127.0.0.1',
            port: mock.port,
            user: 'perry',
            database: 'perry_test',
        };
        console.log('no PGHOST set — using in-process mock server on port ' + mock.port);
    }

    const conn = await connect(connectOpts);
    console.log('connected; backend_pid=' + conn.backendPid);
    console.log('server_version: ' + conn.parameter('server_version'));

    const r = await conn.query('SELECT 1 AS n');
    console.log('command: ' + r.command);
    console.log('fields:  ' + r.fields.map((f) => f.name + ':' + f.typeOid).join(', '));
    console.log('rows:    ' + r.rows.length);
    for (let i = 0; i < r.rowsArray.length; i++) {
        const cells = r.rowsArray[i].map((v) => (v === null ? 'NULL' : String(v)));
        console.log('  ' + cells.join(' | '));
    }

    await conn.close();
    if (shutdownMock !== null) {
        await shutdownMock();
    }
}

main().catch((e) => {
    console.error('ERROR:', e);
    process.exit(1);
});
