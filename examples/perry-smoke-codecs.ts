// Perry-native codec verification. Decodes one row containing every
// non-trivial built-in type from the registry and asserts the value
// the driver hands back is what we expect. Catches Perry-specific
// quirks in any codec (UUID parsing, JSON via JSON.parse, bytea hex
// path, datetime epoch math, array text parsing, etc.).
//
// Build:
//   /Users/amlug/projects/perry/perry/target/release/perry compile \
//       examples/perry-smoke-codecs.ts -o /tmp/perry-pg-smoke-codecs
// Run:
//   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=perch_test \
//   PGPASSWORD=AZfRSy1RiRokYA8Z5ecaer5N PGDATABASE=perch_test \
//       /tmp/perry-pg-smoke-codecs

import { connect, Connection } from '../src';

let failed: number = 0;

function check(label: string, actual: string, expected: string): void {
    if (actual === expected) {
        console.log('  OK  ' + label + ' = ' + actual);
        return;
    }
    failed++;
    console.log('  FAIL ' + label);
    console.log('       got:      [' + actual + ']');
    console.log('       expected: [' + expected + ']');
}

function repr(v: unknown): string {
    if (v === null) {
        return 'NULL';
    }
    if (v === undefined) {
        return 'undefined';
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = v as any;
    if (typeof v === 'object') {
        // Arrays — recurse element-by-element.
        if (Array.isArray(v)) {
            const parts: string[] = [];
            for (let i = 0; i < v.length; i++) {
                parts.push(repr((v as unknown[])[i]));
            }
            return '[' + parts.join(',') + ']';
        }
        // Typed wrappers used by the codec layer. We deliberately read
        // the underlying string field directly rather than calling
        // `.toString()` — Perry's runtime doesn't always dispatch
        // `.toString()` on values typed as `unknown`/`any` to the
        // class-defined override; it falls through to the default
        // Object.prototype.toString and we get '[object Object]'.
        // Field names by codec output type:
        //   PgDate                                 → .value
        //   PgTime / PgTimestamp / PgInterval     → .raw
        //   Decimal                                → ._s
        if (typeof a.value === 'string') {
            return a.value;
        }
        if (typeof a.raw === 'string') {
            return a.raw;
        }
        if (typeof a._s === 'string') {
            return a._s;
        }
        return JSON.stringify(v);
    }
    return String(v);
}

async function main(): Promise<void> {
    console.log('perry-smoke-codecs: connecting...');
    const conn: Connection = await connect({
        host: process.env.PGHOST !== undefined ? process.env.PGHOST : '127.0.0.1',
        port: process.env.PGPORT !== undefined ? parseInt(process.env.PGPORT, 10) : 5432,
        user: process.env.PGUSER !== undefined ? process.env.PGUSER : 'perch_test',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE !== undefined ? process.env.PGDATABASE : 'perch_test',
    });
    // Pin the timezone so timestamptz output is deterministic across
    // hosts. Without this the SET-default of the cluster (often UTC,
    // but in our tunnel it's Asia/Jerusalem) would shift the output.
    await conn.query("SET TIME ZONE 'UTC'");

    // ── Scalars ─────────────────────────────────────────────────────────
    //
    // Each row picks a value with at least one Perry-relevant property
    // (negative number, large bigint, multi-byte UTF-8, escape chars,
    // microsecond fraction, etc.).
    const r1 = await conn.query(
        "SELECT "
        + " (-32768)::int2 AS i2,"
        + " (-2147483648)::int4 AS i4,"
        + " 9223372036854775807::int8 AS i8,"
        + " 3.14159::float4 AS f4,"
        + " 2.718281828459045::float8 AS f8,"
        + " (-12345.67890)::numeric(20,5) AS num,"
        + " false::bool AS b,"
        + " 'café \"quoted\" \\path'::text AS txt,"
        + " '11112222-3333-4444-5555-666677778888'::uuid AS u,"
        + " '\\x0001fffe'::bytea AS by,"
        + " '{\"k\":[1,null,true],\"n\":3.14}'::json AS j,"
        + " '{\"a\":1}'::jsonb AS jb,"
        + " '2023-08-15'::date AS d,"
        + " '12:34:56.789'::time AS t,"
        + " '12:34:56.789+02:30'::timetz AS tz,"
        + " '2023-08-15 12:34:56.789'::timestamp AS ts,"
        + " '2023-08-15 12:34:56.789+00'::timestamptz AS tstz,"
        + " '1 day 02:03:04.5'::interval AS iv"
    );

    const row = r1.rowsArray[0];
    if (row === undefined) {
        console.log('perry-smoke-codecs: FAIL no row returned');
        await conn.close();
        process.exit(1);
    }

    // i2, i4, i8 — int8 stays a string in the driver because JS number
    // can't represent the full int64 range; int2/int4 return as JS number.
    check('int2  ', repr(row[0]), '-32768');
    check('int4  ', repr(row[1]), '-2147483648');
    check('int8  ', repr(row[2]), '9223372036854775807');
    check('float4', repr(row[3]), '3.14159');
    check('float8', repr(row[4]), '2.718281828459045');
    check('numeric', repr(row[5]), '-12345.67890');
    check('bool  ', repr(row[6]), 'false');
    check('text  ', repr(row[7]), 'café "quoted" \\path');
    check('uuid  ', repr(row[8]), '11112222-3333-4444-5555-666677778888');
    // bytea decodes to a Buffer; .toString() gives hex via our codec, but
    // String(Buffer) gives utf8. We check the hex form explicitly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byteaVal = row[9] as any;
    check('bytea ', byteaVal.toString('hex'), '0001fffe');
    // json comes back as a parsed JS object — stringify for comparison.
    check('json  ', JSON.stringify(row[10]), '{"k":[1,null,true],"n":3.14}');
    check('jsonb ', JSON.stringify(row[11]), '{"a":1}');
    // date / time / timetz / timestamp / timestamptz / interval — toString
    // exposes the canonical text form from the codec.
    check('date  ', repr(row[12]), '2023-08-15');
    check('time  ', repr(row[13]), '12:34:56.789');
    check('timetz', repr(row[14]), '12:34:56.789+02:30');
    check('ts    ', repr(row[15]), '2023-08-15 12:34:56.789');
    check('tstz  ', repr(row[16]), '2023-08-15 12:34:56.789+00');
    check('iv    ', repr(row[17]), '1 day 02:03:04.5');

    // ── Arrays ──────────────────────────────────────────────────────────
    //
    // Postgres returns array literals as text by default; arrayCodec parses
    // and recursively decodes each element using the element OID's codec.
    const r2 = await conn.query(
        "SELECT "
        + " ARRAY[1,2,3]::int4[] AS i4a,"
        + " ARRAY[1,NULL,3]::int4[] AS i4na,"
        + " ARRAY['a','b,c','d\"e']::text[] AS ta,"
        + " ARRAY['11112222-3333-4444-5555-666677778888'::uuid] AS ua,"
        + " ARRAY['2023-08-15'::date,'2024-01-01'::date] AS da"
    );
    const r2row = r2.rowsArray[0];
    if (r2row === undefined) {
        console.log('perry-smoke-codecs: FAIL no array row');
        await conn.close();
        process.exit(1);
    }

    // arrays are decoded recursively — element repr depends on the element
    // codec. JSON.stringify is a fast way to flatten the structure.
    check('int4[]   ', JSON.stringify(r2row[0]), '[1,2,3]');
    check('int4[null]', JSON.stringify(r2row[1]), '[1,null,3]');
    check('text[]   ', JSON.stringify(r2row[2]), '["a","b,c","d\\"e"]');
    // uuid[] elements are strings (uuid codec returns strings)
    check('uuid[]   ', JSON.stringify(r2row[3]), '["11112222-3333-4444-5555-666677778888"]');
    // date[] elements are PgDate objects with .value. We deliberately
    // read the field directly — `.toString()` on an array element typed
    // as `unknown` doesn't dispatch through the codec's class method
    // on Perry. Reaching for `.value` exercises the data path that
    // matters: that the codec produced PgDate instances with the
    // canonical text in place.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dArr = r2row[4] as any[];
    const dStr = dArr.length === 2
        ? (dArr[0].value + ',' + dArr[1].value)
        : 'wrong-length';
    check('date[]   ', dStr, '2023-08-15,2024-01-01');

    await conn.close();

    if (failed > 0) {
        console.log('perry-smoke-codecs: FAIL ' + failed + ' check(s) failed');
        process.exit(1);
    }
    console.log('perry-smoke-codecs: OK (all checks passed)');
}

main().then(() => {
    process.exit(0);
}).catch((e) => {
    console.log('perry-smoke-codecs: ERROR ' + String(e));
    process.exit(1);
});
