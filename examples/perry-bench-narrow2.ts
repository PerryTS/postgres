// Find the exact size threshold for the iter-2 silent SIGSEGV.

import { connect, Connection } from '../src';

async function bench(conn: Connection, label: string, sql: string): Promise<boolean> {
    console.log('--- ' + label);
    for (let i = 0; i < 3; i++) {
        try {
            const r = await conn.query(sql);
            console.log('  iter ' + i + ' OK rows=' + r.rows.length);
        } catch (e) {
            console.log('  iter ' + i + ' threw: ' + String(e));
            return false;
        }
    }
    return true;
}

async function main(): Promise<void> {
    const conn: Connection = await connect({
        host: process.env.PGHOST !== undefined ? process.env.PGHOST : '127.0.0.1',
        port: process.env.PGPORT !== undefined ? parseInt(process.env.PGPORT, 10) : 55432,
        user: process.env.PGUSER !== undefined ? process.env.PGUSER : 'perch_test',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE !== undefined ? process.env.PGDATABASE : 'perch_test',
    });

    function intCols(n: number): string {
        const parts: string[] = [];
        for (let i = 0; i < n; i++) {
            parts.push('(g*' + (i + 1) + ')::int4 AS c' + i);
        }
        return parts.join(', ');
    }

    function sql(rows: number, ncols: number): string {
        return 'SELECT ' + intCols(ncols) + ' FROM generate_series(1, ' + rows + ') g';
    }

    // Single huge query — does it crash on iter 0?
    await bench(conn, '20000 rows × 1 col (only)', sql(20000, 1));
    await bench(conn, '100000 rows × 1 col (only)', sql(100000, 1));

    await conn.close();
    console.log('OK');
}

main().then(() => {
    process.exit(0);
}).catch((e) => {
    console.log('ERROR ' + String(e));
    process.exit(1);
});
