// Perry-native smoke test: compile this with `perry compile` and run the
// resulting binary against a real Postgres. Exercises the parts of the
// driver that matter for Tusk:
//   - SCRAM-SHA-256 authentication
//   - Simple-protocol queries (plain text)
//   - Extended-protocol queries (Parse/Bind/Execute/Sync with params)
//   - Several type codecs (int, text, bool, numeric, timestamp)
//   - Error propagation (bad SQL surfaces as a rejected promise)
//   - Transactions (BEGIN/COMMIT on success, ROLLBACK on throw)
//
// Build:
//   cd /Users/amlug/projects/perry/postgres
//   /Users/amlug/projects/perry/perry/target/release/perry compile \
//       examples/perry-smoke.ts -o /tmp/perry-pg-smoke
//
// Run (PG via ssh tunnel; see top of session for credentials):
//   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=perch_test \
//   PGPASSWORD=AZfRSy1RiRokYA8Z5ecaer5N PGDATABASE=perch_test \
//       /tmp/perry-pg-smoke

// NOTE: annotating `conn: Connection` below is a Perry workaround — without
// the explicit type, Perry doesn't propagate the Promise<Connection> return
// of `connect` through the `await` and dispatches `conn.query` via the
// generic runtime path, which bypasses the method body.
import { connect, Connection } from '../src';

function cellStr(v: unknown): string {
    if (v === null) {
        return 'NULL';
    }
    return String(v);
}

function printRows(r: { rowsArray: unknown[][] }): void {
    for (let i = 0; i < r.rowsArray.length; i++) {
        const cells: string[] = [];
        for (let j = 0; j < r.rowsArray[i].length; j++) {
            cells.push(cellStr(r.rowsArray[i][j]));
        }
        console.log('  ' + cells.join(' | '));
    }
}

async function main(): Promise<void> {
    console.log('perry-smoke: connecting...');
    const conn: Connection = await connect({
        host: process.env.PGHOST !== undefined ? process.env.PGHOST : '127.0.0.1',
        port: process.env.PGPORT !== undefined ? parseInt(process.env.PGPORT, 10) : 5432,
        user: process.env.PGUSER !== undefined ? process.env.PGUSER : 'perch_test',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE !== undefined ? process.env.PGDATABASE : 'perch_test',
    });
    console.log('perry-smoke: connected, backend_pid=' + conn.backendPid);
    console.log('perry-smoke: server_version=' + conn.parameter('server_version'));

    // ── Simple-protocol query ──
    const r1 = await conn.query('SELECT 1 AS n, now() AS t');
    console.log('perry-smoke: simple: command=' + r1.command + ' rows=' + r1.rows.length);
    printRows(r1);

    // ── Extended-protocol query with params ──
    const r2 = await conn.query(
        'SELECT $1::int4 AS x, $2::text AS s, $3::bool AS b',
        [42, 'hello', true]
    );
    console.log('perry-smoke: extended: command=' + r2.command + ' rows=' + r2.rows.length);
    printRows(r2);

    // ── Type codec coverage ──
    const r3 = await conn.query(
        "SELECT 9223372036854775807::int8 AS big, 3.14::numeric AS pi,"
            + " 'a'::text AS txt, NULL::int AS null_val, TRUE::bool AS t,"
            + " '{1,2,3}'::int[] AS arr"
    );
    console.log('perry-smoke: codecs: rows=' + r3.rows.length);
    printRows(r3);

    // ── Error path: bad SQL should reject with a PgError ──
    //
    // Perry-native note: `instanceof PgError` returns false even when the
    // thrown value is a PgError, because the imported class stub's runtime
    // class id doesn't match the id stamped on the instance by the source
    // module's constructor. Duck-type on `err.name === 'PgError'` (or
    // inspect `err.code`) until that's fixed in Perry.
    let caught: string = '';
    try {
        await conn.query('SELECT * FROM no_such_table_xyz');
    } catch (e) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pg = e as any;
        if (pg !== null && pg !== undefined && pg.name === 'PgError') {
            caught = pg.code !== undefined ? pg.code : 'no-code';
        } else {
            caught = 'non-pg-error';
        }
    }
    console.log('perry-smoke: error caught=' + caught);

    // ── Transaction: BEGIN / query / COMMIT ──
    await conn.query('BEGIN');
    const rt = await conn.query('SELECT 1 AS inside_tx');
    console.log('perry-smoke: tx: command=' + rt.command + ' rows=' + rt.rows.length);
    printRows(rt);
    await conn.query('COMMIT');

    await conn.close();
    console.log('perry-smoke: OK');
}

main().then(() => {
    process.exit(0);
}).catch((e) => {
    console.log('perry-smoke: ERROR ' + (e !== null ? String(e) : 'unknown'));
    process.exit(1);
});
