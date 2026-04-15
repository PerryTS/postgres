// node-postgres benchmark runner. Same workloads, same Postgres,
// same stats — drop-in alternative to bench-this for category-2
// "different driver, same JS host" comparison.

import pg from 'pg';
import {
    DEFAULT_ITERATIONS, DEFAULT_WARMUP, WORKLOADS,
} from './workloads';
import { computeStats, now, printRow } from './stats';

async function main(): Promise<void> {
    const client = new pg.Client({
        host: process.env.PGHOST ?? '127.0.0.1',
        port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
        user: process.env.PGUSER ?? 'perch_test',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE ?? 'perch_test',
    });
    await client.connect();

    const label = 'pg                node';
    console.log('# ' + label);

    for (const wl of WORKLOADS) {
        for (let i = 0; i < DEFAULT_WARMUP; i++) {
            await client.query(wl.sql, wl.params);
        }
        const samples: number[] = new Array(DEFAULT_ITERATIONS);
        for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
            const t0 = now();
            const r = await client.query(wl.sql, wl.params);
            const t1 = now();
            if (r.rowCount !== wl.expectedRows && r.rows.length !== wl.expectedRows) {
                throw new Error(
                    'workload ' + wl.name + ' expected ' + wl.expectedRows
                    + ' rows, got ' + r.rows.length
                );
            }
            samples[i] = t1 - t0;
        }
        printRow(label, wl.name, computeStats(samples));
    }

    await client.end();
}

main().then(() => {
    process.exit(0);
}).catch((e) => {
    console.log('bench-pg: ERROR ' + String(e));
    process.exit(1);
});
