// Absolute minimum: connect, run one query, exit. The process wall
// time from launch to exit is what matters — we measure it with
// `/usr/bin/time` externally rather than inside the script.

import { connect } from '../src';

async function main(): Promise<void> {
    const conn = await connect({
        host: process.env.PGHOST !== undefined ? process.env.PGHOST : '127.0.0.1',
        port: process.env.PGPORT !== undefined ? parseInt(process.env.PGPORT, 10) : 5432,
        user: process.env.PGUSER !== undefined ? process.env.PGUSER : 'perch_test',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE !== undefined ? process.env.PGDATABASE : 'perch_test',
    });
    await conn.query('SELECT 1');
    // Deliberate: no conn.close() — process.exit() below tears the
    // socket down. Keeping this script under a millisecond of
    // driver-driven teardown lets `/usr/bin/time` isolate the
    // startup + connect + query cost cleanly. Real apps should
    // still call close() on long-running connections.
}

main().then(() => {
    process.exit(0);
}).catch(() => {
    process.exit(1);
});
