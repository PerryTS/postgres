// Perry-native TLS smoke. Same shape as perry-smoke.ts but goes through
// the SSLRequest → 'S' → in-place TLS upgrade path (Perry's
// `socket.upgradeToTLS`). Verifies that a query runs after the upgrade
// and confirms via pg_stat_ssl that the connection is actually encrypted.
//
// Build:
//   cd /Users/amlug/projects/perry/postgres
//   /Users/amlug/projects/perry/perry/target/release/perry compile \
//       examples/perry-smoke-tls.ts -o /tmp/perry-pg-smoke-tls
//
// Run (PG via ssh tunnel; same creds as perry-smoke.ts):
//   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=perch_test \
//   PGPASSWORD=AZfRSy1RiRokYA8Z5ecaer5N PGDATABASE=perch_test \
//       /tmp/perry-pg-smoke-tls

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
    console.log('perry-smoke-tls: connecting (sslmode=require)...');
    const conn: Connection = await connect({
        host: process.env.PGHOST !== undefined ? process.env.PGHOST : '127.0.0.1',
        port: process.env.PGPORT !== undefined ? parseInt(process.env.PGPORT, 10) : 5432,
        user: process.env.PGUSER !== undefined ? process.env.PGUSER : 'perch_test',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE !== undefined ? process.env.PGDATABASE : 'perch_test',
        ssl: { mode: 'require' },
    });
    console.log('perry-smoke-tls: connected, backend_pid=' + conn.backendPid);

    // Confirm the connection is actually encrypted by asking the server.
    // pg_stat_ssl.ssl is a bool column; pg_stat_ssl.version names the TLS
    // version in use. If the upgrade silently fell back to plaintext,
    // ssl=false would surface here.
    const r1 = await conn.query(
        'SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()'
    );
    console.log('perry-smoke-tls: pg_stat_ssl rows=' + r1.rows.length);
    printRows(r1);

    // Round-trip a parameterised extended query to make sure the
    // post-handshake transport path works for Parse/Bind/Execute, not
    // just simple-protocol queries.
    const r2 = await conn.query(
        'SELECT $1::int4 AS x, $2::text AS s',
        [7, 'over-tls']
    );
    console.log('perry-smoke-tls: extended: rows=' + r2.rows.length);
    printRows(r2);

    await conn.close();
    console.log('perry-smoke-tls: OK');
}

main().then(() => {
    process.exit(0);
}).catch((e) => {
    console.log('perry-smoke-tls: ERROR ' + (e !== null ? String(e) : 'unknown'));
    process.exit(1);
});
