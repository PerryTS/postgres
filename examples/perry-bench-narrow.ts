// Narrow PerryTS/perry#36 to the specific wrapper. Runs three 1000-row
// 20-column workloads in sequence — int8-only, numeric-only, text-only.
// Whichever one fails on iter 1 identifies the culprit type.

import { connect, Connection } from '../src';

async function bench(conn: Connection, label: string, sql: string): Promise<void> {
    console.log('--- ' + label);
    for (let i = 0; i < 3; i++) {
        console.log('  iter ' + i + ' before');
        const r = await conn.query(sql);
        console.log('  iter ' + i + ' after, rows=' + r.rows.length);
    }
}

async function main(): Promise<void> {
    const conn: Connection = await connect({
        host: process.env.PGHOST !== undefined ? process.env.PGHOST : '127.0.0.1',
        port: process.env.PGPORT !== undefined ? parseInt(process.env.PGPORT, 10) : 55432,
        user: process.env.PGUSER !== undefined ? process.env.PGUSER : 'perch_test',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE !== undefined ? process.env.PGDATABASE : 'perch_test',
    });

    function cols(typ: string, count: number): string {
        const parts: string[] = [];
        for (let i = 0; i < count; i++) {
            if (typ === 'int8') {
                parts.push('(n*' + (i + 1) + ')::int8 AS c' + i);
            } else if (typ === 'numeric') {
                parts.push('(n::numeric/' + (i + 1) + ')::numeric(20,5) AS c' + i);
            } else if (typ === 'text') {
                parts.push("('row-'||n||'-c" + i + "')::text AS c" + i);
            } else if (typ === 'bool') {
                parts.push('(n%2=0)::bool AS c' + i);
            } else if (typ === 'int4') {
                parts.push('(n*' + (i + 1) + ')::int4 AS c' + i);
            }
        }
        return 'SELECT ' + parts.join(', ') + ' FROM generate_series(1, 1000) AS n';
    }

    await bench(conn, 'all int4 (no wrapper)', cols('int4', 20));
    await bench(conn, 'all bool (no wrapper)', cols('bool', 20));
    await bench(conn, 'all text (string only)', cols('text', 20));
    await bench(conn, 'all int8 (BigInt wrapper)', cols('int8', 20));
    await bench(conn, 'all numeric (Decimal wrapper)', cols('numeric', 20));

    await conn.close();
    console.log('OK');
}

main().then(() => {
    process.exit(0);
}).catch((e) => {
    console.log('ERROR ' + String(e));
    process.exit(1);
});
