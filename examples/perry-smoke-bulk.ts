// Perry-native bulk-decode timing. Spec gating case from tusk:
// "1000 rows × 20 columns must round-trip in well under a second".
//
// Generates a 20-column projection over generate_series(1, 1000),
// times the full request → ReadyForQuery cycle on the driver side,
// and reports per-row + per-cell elapsed time. Run alongside the
// same binary on Node (`bun run examples/perry-smoke-bulk.ts`) for
// a baseline comparison.
//
// Build:
//   /Users/amlug/projects/perry/perry/target/release/perry compile \
//       examples/perry-smoke-bulk.ts -o /tmp/perry-pg-smoke-bulk
// Run (Perry native + Node baseline):
//   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=perch_test \
//   PGPASSWORD=AZfRSy1RiRokYA8Z5ecaer5N PGDATABASE=perch_test \
//       /tmp/perry-pg-smoke-bulk
//   bun run examples/perry-smoke-bulk.ts

import { connect, Connection } from '../src';

const ROWS = 1000;
const COLS = 20;

async function main(): Promise<void> {
    const conn: Connection = await connect({
        host: process.env.PGHOST !== undefined ? process.env.PGHOST : '127.0.0.1',
        port: process.env.PGPORT !== undefined ? parseInt(process.env.PGPORT, 10) : 5432,
        user: process.env.PGUSER !== undefined ? process.env.PGUSER : 'perch_test',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE !== undefined ? process.env.PGDATABASE : 'perch_test',
    });

    // Build the column list. Mix of cheap (int8) + slightly more
    // expensive (text formatting + numeric) types — close to a real
    // analytical projection. Seed with the row index so the values
    // are unique, not all zeros (no compression on the wire).
    const cols: string[] = [];
    for (let i = 0; i < COLS; i++) {
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
    const sql =
        'SELECT ' + cols.join(', ')
        + ' FROM generate_series(1, ' + ROWS + ') AS n';

    // Warm-up: run the query once and discard timing — protocol Parse +
    // statement plan caches on the server side.
    await conn.query(sql);

    // Timed run.
    const startMs = Date.now();
    const r = await conn.query(sql);
    const elapsedMs = Date.now() - startMs;

    const cellCount = r.rows.length * (r.rows.length > 0 ? r.fields.length : 0);
    const usPerRow = (elapsedMs * 1000) / Math.max(1, r.rows.length);
    const usPerCell = (elapsedMs * 1000) / Math.max(1, cellCount);

    console.log('perry-smoke-bulk: rows=' + r.rows.length + ' cols=' + r.fields.length);
    console.log('perry-smoke-bulk: total=' + elapsedMs + 'ms  ('
        + Math.round(usPerRow) + ' µs/row, '
        + Math.round(usPerCell) + ' µs/cell)');

    // Spot-check a couple cells to confirm decoding produced the expected
    // shape (catches a regression where rows are returned but values are
    // garbage). Use rowsArray for index access (rows[] is keyed by name).
    const first = r.rowsArray[0];
    const last = r.rowsArray[r.rows.length - 1];
    console.log('perry-smoke-bulk: first row c0=' + String(first[0]) + ' c1=' + String(first[1]));
    console.log('perry-smoke-bulk: last  row c0=' + String(last[0]) + ' c1=' + String(last[1]));

    await conn.close();
    console.log('perry-smoke-bulk: OK');
}

main().then(() => {
    process.exit(0);
}).catch((e) => {
    console.log('perry-smoke-bulk: ERROR ' + String(e));
    process.exit(1);
});
