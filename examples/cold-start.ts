// Startup-cost benchmark: measures time-to-first-query-result from
// process launch. Every invocation is a fresh process, no warmup —
// this is what a CLI tool, a short cron job, or a serverless
// function pays on every run. The opposite benchmark from
// `bench/bench-this.ts`, which amortizes startup over 50 steady-state
// iterations.

import { connect } from '../src';

const LAUNCHED_AT = Date.now();

async function main(): Promise<void> {
    const tConnectStart = Date.now();
    const conn = await connect({
        host: process.env.PGHOST !== undefined ? process.env.PGHOST : '127.0.0.1',
        port: process.env.PGPORT !== undefined ? parseInt(process.env.PGPORT, 10) : 5432,
        user: process.env.PGUSER !== undefined ? process.env.PGUSER : 'perch_test',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE !== undefined ? process.env.PGDATABASE : 'perch_test',
    });
    const tQueryStart = Date.now();
    const r = await conn.query('SELECT 1 AS n');
    const tQueryEnd = Date.now();
    await conn.close();

    // Print each phase in ms since process launch.
    console.log('process-startup: ' + (tConnectStart - LAUNCHED_AT) + 'ms');
    console.log('connect-handshake: ' + (tQueryStart - tConnectStart) + 'ms');
    console.log('first-query: ' + (tQueryEnd - tQueryStart) + 'ms');
    console.log('total-wall: ' + (tQueryEnd - LAUNCHED_AT) + 'ms');
    console.log('row-count: ' + r.rows.length);
}

main().then(() => {
    process.exit(0);
}).catch((e) => {
    console.log('cold-start: ERROR ' + String(e));
    process.exit(1);
});
