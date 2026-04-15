// Benchmark for @perry/postgres itself. Runs on Node, Bun, AND Perry-
// native (compile via `perry compile`). Same source, same workloads,
// same output format — diff the columns to see the LLVM-vs-V8/JSC
// story.
//
// Usage:
//   bun  bench/bench-this.ts                                    # bun
//   node --import tsx bench/bench-this.ts                       # node
//   perry compile bench/bench-this.ts -o /tmp/bench && /tmp/bench  # perry-native

import { connect, Connection } from '../src/index.ts';
import {
    DEFAULT_ITERATIONS, DEFAULT_WARMUP, WORKLOADS,
    PERRY_ITERATIONS_OVERRIDE, PERRY_WARMUP_OVERRIDE,
} from './workloads';
import { computeStats, now, printRow } from './stats';

function envHost(): string {
    return process.env.PGHOST !== undefined ? process.env.PGHOST : '127.0.0.1';
}
function envPort(): number {
    return process.env.PGPORT !== undefined ? parseInt(process.env.PGPORT, 10) : 5432;
}
function envUser(): string {
    return process.env.PGUSER !== undefined ? process.env.PGUSER : 'perch_test';
}
function envDb(): string {
    return process.env.PGDATABASE !== undefined ? process.env.PGDATABASE : 'perch_test';
}
/** True when the env asked us to run with `parseTypes: 'minimal'`.
 *  The bench-this binary picks this up when comparing apples-to-apples
 *  with `pg`'s default behaviour. */
function isMinimalParse(): boolean {
    return process.env.PERRY_PG_BENCH_MINIMAL === '1';
}

function driverLabel(): string {
    const tag = isMinimalParse() ? ' (min)' : '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (g.Bun !== undefined) {
        return '@perry/postgres bun' + tag;
    }
    if (g.process !== undefined && g.process.versions !== undefined && g.process.versions.node !== undefined) {
        return '@perry/postgres node' + tag;
    }
    return '@perry/postgres perry' + tag;
}

function isPerry(): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (g.Bun !== undefined) {
        return false;
    }
    if (g.process !== undefined && g.process.versions !== undefined && g.process.versions.node !== undefined) {
        return false;
    }
    return true;
}

async function main(): Promise<void> {
    const conn: Connection = await connect({
        host: envHost(),
        port: envPort(),
        user: envUser(),
        password: process.env.PGPASSWORD,
        database: envDb(),
        parseTypes: isMinimalParse() ? 'minimal' : 'rich',
    });

    const label = driverLabel();
    console.log('# ' + label);

    const perryHost = isPerry();
    for (let w = 0; w < WORKLOADS.length; w++) {
        const wl = WORKLOADS[w];
        let iters = DEFAULT_ITERATIONS;
        let warmup = DEFAULT_WARMUP;
        if (perryHost) {
            const itOverride = PERRY_ITERATIONS_OVERRIDE.get(wl.name);
            if (itOverride !== undefined) {
                iters = itOverride;
            }
            const wmOverride = PERRY_WARMUP_OVERRIDE.get(wl.name);
            if (wmOverride !== undefined) {
                warmup = wmOverride;
            }
        }
        if (iters === 0) {
            console.log('# skipped (not supported on this host): ' + wl.name);
            continue;
        }
        // Warm-up.
        for (let i = 0; i < warmup; i++) {
            await conn.query(wl.sql, wl.params);
        }
        // Timed.
        const samples: number[] = new Array(iters);
        for (let i = 0; i < iters; i++) {
            const t0 = now();
            const r = await conn.query(wl.sql, wl.params);
            const t1 = now();
            if (r.rows.length !== wl.expectedRows) {
                throw new Error(
                    'workload ' + wl.name + ' expected ' + wl.expectedRows
                    + ' rows, got ' + r.rows.length
                );
            }
            samples[i] = t1 - t0;
        }
        printRow(label, wl.name, computeStats(samples));
    }

    await conn.close();
}

main().then(() => {
    process.exit(0);
}).catch((e) => {
    console.log('bench-this: ERROR ' + String(e));
    process.exit(1);
});
