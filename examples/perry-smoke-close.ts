// Perry-native conn.close() timing + cleanliness check. Verifies that
// `conn.close()` actually completes (resolves) on Perry, and reports
// how long it takes — distinguishing a "the 'close' socket event fired"
// path from the 500 ms belt-and-braces fallback timer in
// `closeConnection()`.
//
// Build:
//   /Users/amlug/projects/perry/perry/target/release/perry compile \
//       examples/perry-smoke-close.ts -o /tmp/perry-pg-smoke-close
// Run:
//   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=perch_test \
//   PGPASSWORD=AZfRSy1RiRokYA8Z5ecaer5N PGDATABASE=perch_test \
//       /tmp/perry-pg-smoke-close

import { connect, Connection } from '../src';

async function main(): Promise<void> {
    console.log('perry-smoke-close: connecting...');
    const conn: Connection = await connect({
        host: process.env.PGHOST !== undefined ? process.env.PGHOST : '127.0.0.1',
        port: process.env.PGPORT !== undefined ? parseInt(process.env.PGPORT, 10) : 5432,
        user: process.env.PGUSER !== undefined ? process.env.PGUSER : 'perch_test',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE !== undefined ? process.env.PGDATABASE : 'perch_test',
    });
    console.log('perry-smoke-close: connected, backend_pid=' + conn.backendPid);

    // Run a query so the connection is fully established and the server
    // has buffered something — otherwise `close()` from a freshly-
    // authenticated socket might race with the server's pre-Ready frames.
    const r = await conn.query('SELECT 1');
    console.log('perry-smoke-close: query rows=' + r.rows.length);

    const startMs = Date.now();
    await conn.close();
    const elapsedMs = Date.now() - startMs;
    console.log('perry-smoke-close: close() returned in ' + elapsedMs + 'ms');

    // Anything ≥ 450ms means the 500ms fallback timer fired (FIN/close
    // event never bubbled up). Anything < 100ms means the 'close' event
    // wired through cleanly.
    if (elapsedMs >= 450) {
        console.log('perry-smoke-close: SLOW — likely fell back to the 500ms timer (close event missing)');
    } else {
        console.log('perry-smoke-close: FAST — close event fired correctly');
    }

    // Touching the closed conn should be safe (returns rejected promise
    // or a no-op, never crashes).
    let postCloseRejected: boolean = false;
    try {
        await conn.query('SELECT 1');
    } catch (_e) {
        postCloseRejected = true;
    }
    console.log('perry-smoke-close: post-close query rejected=' + (postCloseRejected ? 'yes' : 'no (unexpected)'));

    console.log('perry-smoke-close: OK');
}

main().then(() => {
    process.exit(0);
}).catch((e) => {
    console.log('perry-smoke-close: ERROR ' + String(e));
    process.exit(1);
});
