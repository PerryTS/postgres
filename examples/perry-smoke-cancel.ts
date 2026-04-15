// Perry-native cancel smoke. Fires `SELECT pg_sleep(30)` (which would
// otherwise block for half a minute) and calls `conn.cancel()` ~100ms
// later. The query promise should reject with a PgError carrying
// SQLSTATE 57014 (query_canceled) within ~1s.
//
// Build:
//   /Users/amlug/projects/perry/perry/target/release/perry compile \
//       examples/perry-smoke-cancel.ts -o /tmp/perry-pg-smoke-cancel
// Run:
//   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=perch_test \
//   PGPASSWORD=AZfRSy1RiRokYA8Z5ecaer5N PGDATABASE=perch_test \
//       /tmp/perry-pg-smoke-cancel

import { connect, Connection } from '../src';

async function main(): Promise<void> {
    console.log('perry-smoke-cancel: connecting...');
    const conn: Connection = await connect({
        host: process.env.PGHOST !== undefined ? process.env.PGHOST : '127.0.0.1',
        port: process.env.PGPORT !== undefined ? parseInt(process.env.PGPORT, 10) : 5432,
        user: process.env.PGUSER !== undefined ? process.env.PGUSER : 'perch_test',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE !== undefined ? process.env.PGDATABASE : 'perch_test',
    });
    console.log('perry-smoke-cancel: connected, backend_pid=' + conn.backendPid);

    const startMs = Date.now();
    // Fire the long-running query — do NOT await yet, we need to schedule
    // the cancel before its result lands.
    const slow = conn.query('SELECT pg_sleep(30)');

    // Schedule the cancel ~100ms in the future. The exact delay isn't
    // important; we just need the server to have already started executing
    // pg_sleep so the cancel hits a real query, not the empty queue.
    setTimeout(() => {
        console.log('perry-smoke-cancel: sending cancel...');
        conn.cancel().then(() => {
            console.log('perry-smoke-cancel: cancel flushed');
        }).catch((e) => {
            console.log('perry-smoke-cancel: cancel failed: ' + String(e));
        });
    }, 100);

    let code: string = '';
    let kind: string = '';
    try {
        await slow;
        kind = 'no-error';
    } catch (e) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pg = e as any;
        if (pg !== null && pg !== undefined && pg.name === 'PgError') {
            kind = 'PgError';
            code = pg.code !== undefined ? pg.code : 'no-code';
        } else {
            kind = 'non-pg-error';
            code = String(e);
        }
    }
    const elapsedMs = Date.now() - startMs;
    console.log('perry-smoke-cancel: caught kind=' + kind + ' code=' + code + ' elapsed_ms=' + elapsedMs);

    if (kind !== 'PgError' || code !== '57014') {
        console.log('perry-smoke-cancel: FAIL (expected PgError 57014)');
        await conn.close();
        process.exit(1);
    }
    if (elapsedMs > 5000) {
        console.log('perry-smoke-cancel: FAIL (cancel took too long)');
        await conn.close();
        process.exit(1);
    }

    await conn.close();
    console.log('perry-smoke-cancel: OK');
}

main().then(() => {
    process.exit(0);
}).catch((e) => {
    console.log('perry-smoke-cancel: ERROR ' + String(e));
    process.exit(1);
});
