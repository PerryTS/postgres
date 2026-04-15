// porsager/postgres benchmark runner. Same workloads, same Postgres,
// same stats. postgres.js's API is a tagged template, so for the
// parameterised workload we use `sql.unsafe(text, params)` to keep
// the SQL string identical to the other runners (no template
// interpolation drift).

import postgres from 'postgres';
import {
    DEFAULT_ITERATIONS, DEFAULT_WARMUP, WORKLOADS,
} from './workloads';
import { computeStats, now, printRow } from './stats';

async function main(): Promise<void> {
    const sql = postgres({
        host: process.env.PGHOST ?? '127.0.0.1',
        port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
        user: process.env.PGUSER ?? 'perch_test',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE ?? 'perch_test',
        max: 1,
        prepare: false,
    });

    const label = 'postgres.js       node';
    console.log('# ' + label);

    for (const wl of WORKLOADS) {
        const exec = wl.params === undefined
            ? () => sql.unsafe(wl.sql)
            : () => sql.unsafe(wl.sql, wl.params as readonly any[]);

        for (let i = 0; i < DEFAULT_WARMUP; i++) {
            await exec();
        }
        const samples: number[] = new Array(DEFAULT_ITERATIONS);
        for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
            const t0 = now();
            const rows = await exec();
            const t1 = now();
            if (rows.length !== wl.expectedRows) {
                throw new Error(
                    'workload ' + wl.name + ' expected ' + wl.expectedRows
                    + ' rows, got ' + rows.length
                );
            }
            samples[i] = t1 - t0;
        }
        printRow(label, wl.name, computeStats(samples));
    }

    await sql.end();
}

main().then(() => {
    process.exit(0);
}).catch((e) => {
    console.log('bench-postgres-js: ERROR ' + String(e));
    process.exit(1);
});
