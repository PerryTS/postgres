// Tight-loop timing: 1000 SELECT 1 queries, measure ONLY the total
// wall time, divide out. Sidesteps any per-call granularity issue
// in whatever clock Perry's `Date.now()` is reading from.

import { connect } from '../src';

async function main(): Promise<void> {
    const conn = await connect({
        host: process.env.PGHOST !== undefined ? process.env.PGHOST : '127.0.0.1',
        port: process.env.PGPORT !== undefined ? parseInt(process.env.PGPORT, 10) : 5432,
        user: process.env.PGUSER !== undefined ? process.env.PGUSER : 'perch_test',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE !== undefined ? process.env.PGDATABASE : 'perch_test',
    });

    // Warm-up.
    for (let i = 0; i < 100; i++) {
        await conn.query('SELECT 1');
    }

    const N = 1000;
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
        await conn.query('SELECT 1');
    }
    const elapsed = Date.now() - t0;

    console.log(
        'SELECT 1 × ' + N
        + ': total=' + elapsed + 'ms'
        + '  avg=' + (elapsed * 1000 / N).toFixed(1) + 'µs'
    );
}

main().then(() => process.exit(0)).catch((e) => {
    console.log('ERROR ' + String(e));
    process.exit(1);
});
