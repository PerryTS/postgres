// node-postgres's libpq binding. Same workloads, same Postgres,
// same stats — cross-reference for the "native C driver from a JS
// host" ceiling.
//
// Runs on Node and Bun (both load `.node` N-API addons). Does NOT run
// on Perry-native because Perry can't load dynamically-linked C
// addons; the whole motivation for @perryts/postgres being a pure-TS
// driver is that `pg-native` is structurally unavailable on AOT
// targets. The run-all driver skips this runner on Perry.

import Client from 'pg-native';
import {
    DEFAULT_ITERATIONS, DEFAULT_WARMUP, WORKLOADS,
} from './workloads';
import { computeStats, now, printRow } from './stats';

function connect(client: Client): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const conninfo = [
            'host=' + (process.env.PGHOST ?? '127.0.0.1'),
            'port=' + (process.env.PGPORT ?? '5432'),
            'user=' + (process.env.PGUSER ?? 'perch_test'),
            process.env.PGPASSWORD ? 'password=' + process.env.PGPASSWORD : '',
            'dbname=' + (process.env.PGDATABASE ?? 'perch_test'),
        ].filter(Boolean).join(' ');
        client.connect(conninfo, (err) => err ? reject(err) : resolve());
    });
}

function query(client: Client, sql: string, params: unknown[] | undefined): Promise<unknown[]> {
    return new Promise<unknown[]>((resolve, reject) => {
        if (params === undefined) {
            client.query(sql, (err, rows) => err ? reject(err) : resolve(rows as unknown[]));
        } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            client.query(sql, params as any[], (err, rows) =>
                err ? reject(err) : resolve(rows as unknown[])
            );
        }
    });
}

function endClient(client: Client): Promise<void> {
    return new Promise<void>((resolve) => {
        client.end(() => resolve());
    });
}

async function main(): Promise<void> {
    const client = new Client();
    await connect(client);

    // Label differs by host — Bun and Node both link the same pg-native
    // .node but the timing can differ because the N-API bridge and
    // event loop cost isn't the same.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isBun = typeof (globalThis as any).Bun !== 'undefined';
    const label = isBun ? 'pg-native         bun' : 'pg-native         node';
    console.log('# ' + label);

    for (const wl of WORKLOADS) {
        for (let i = 0; i < DEFAULT_WARMUP; i++) {
            await query(client, wl.sql, wl.params);
        }
        const samples: number[] = new Array(DEFAULT_ITERATIONS);
        for (let i = 0; i < DEFAULT_ITERATIONS; i++) {
            const t0 = now();
            const rows = await query(client, wl.sql, wl.params);
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

    await endClient(client);
}

main().then(() => {
    process.exit(0);
}).catch((e) => {
    console.log('bench-pg-native: ERROR ' + String(e));
    process.exit(1);
});
