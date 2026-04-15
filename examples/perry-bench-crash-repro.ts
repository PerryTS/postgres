// Minimal repro for the residual Perry crash that survives PerryTS/perry#34
// and #35: after ANY number of small queries, exactly one bulk query
// (1000 rows × 20 mixed-type columns) succeeds and the SECOND silently
// exits with no error and no completion log. The 10000-row variant
// dies on the first attempt.
//
// No need for the SSH tunnel — point at any local Postgres.
//
// Build:
//   /Users/amlug/projects/perry/perry/target/release/perry compile \
//       examples/perry-bench-crash-repro.ts -o /tmp/perry-crash-repro
// Run:
//   PGHOST=127.0.0.1 PGPORT=55432 PGUSER=$(whoami) PGDATABASE=bench \
//       /tmp/perry-crash-repro

import { connect, Connection } from '../src';

// Identical schema to bench/workloads.ts medium-1k-x-20: 5 int8, 5 text,
// 5 numeric, 5 bool, alternating column-by-column. ~25k wrapper-object
// allocations per call (5000 BigInt + 5000 Decimal + 5000 string + 5000
// boolean primitives + 1000 row objects).
const SQL = (() => {
    const cols: string[] = [];
    for (let i = 0; i < 20; i++) {
        const j = i % 4;
        if (j === 0) {
            cols.push('(n * ' + (i + 1) + ')::int8 AS c' + i);
        } else if (j === 1) {
            cols.push("('row-' || n || '-c" + i + "')::text AS c" + i);
        } else if (j === 2) {
            cols.push('(n::numeric / ' + (i + 1) + ')::numeric(20,5) AS c' + i);
        } else {
            cols.push('(n % 2 = 0)::bool AS c' + i);
        }
    }
    return 'SELECT ' + cols.join(', ') + ' FROM generate_series(1, 1000) AS n';
})();

async function main(): Promise<void> {
    console.log('crash-repro: connecting...');
    const conn: Connection = await connect({
        host: process.env.PGHOST !== undefined ? process.env.PGHOST : '127.0.0.1',
        port: process.env.PGPORT !== undefined ? parseInt(process.env.PGPORT, 10) : 55432,
        user: process.env.PGUSER !== undefined ? process.env.PGUSER : 'perch_test',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE !== undefined ? process.env.PGDATABASE : 'perch_test',
    });
    console.log('crash-repro: connected, backend_pid=' + conn.backendPid);

    for (let i = 0; i < 5; i++) {
        console.log('crash-repro: iter ' + i + ' before query');
        const r = await conn.query(SQL);
        console.log('crash-repro: iter ' + i + ' after query, rows=' + r.rows.length);
    }

    await conn.close();
    console.log('crash-repro: OK');
}

main().then(() => {
    process.exit(0);
}).catch((e) => {
    console.log('crash-repro: ERROR ' + String(e));
    process.exit(1);
});
