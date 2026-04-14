# @perry/postgres

Pure-TypeScript Postgres wire-protocol driver. Runs on **Perry** (compiled to
a native binary, no JS runtime) and on **Node.js** / **Bun** unchanged.

```bash
bun add @perry/postgres
# or
npm install @perry/postgres
```

```ts
import { connect, sql } from '@perry/postgres';

const conn = await connect('postgres://alice:secret@db.example.com:5432/myapp');

const { rows } = await conn.query<{ id: number; name: string }>(
  sql`SELECT id, name FROM users WHERE active = ${true}`
);
for (const user of rows) {
  console.log(user.id, user.name);
}

await conn.close();
```

## Features

- Postgres wire protocol v3 — works against every supported server (13–17 in
  CI, but the protocol itself has been stable since 7.4)
- **SCRAM-SHA-256**, MD5, cleartext, trust authentication
- **TLS** with `sslmode=disable | require | verify-ca | verify-full`
- **Simple** and **extended** query protocols (Parse / Bind / Execute / Sync)
- **20 type codecs** — integers, floats, `numeric` (precision-preserving),
  booleans, text family, `bytea`, `uuid`, `json`/`jsonb`, all date/time types,
  1-d arrays — text and binary formats
- Structured `PgError` with every documented field — SQLSTATE, position,
  detail, hint, schema/table/column/constraint, …
- `NOTICE`, `ParameterStatus`, `LISTEN/NOTIFY` events
- **Cancel protocol** on a separate fresh connection (handles the
  Postgres-style PID + secret key handshake)
- **Connection pool**, **transactions**, `sql` tagged-template helper
- libpq URLs and PG\* environment variables — works with `DATABASE_URL`
- **Zero native dependencies** when running on Node.js / Bun. The driver is
  pure TypeScript on top of `node:net`, `node:tls`, `node:crypto`, `Buffer`
- **No `numeric → float` lossy coercion** — values land in a `Decimal` wrapper
  that round-trips precisely

## Quickstart

### Connecting

```ts
import { connect } from '@perry/postgres';

// 1. Connection URL (libpq format).
const conn = await connect('postgres://user:pw@host:5432/db?sslmode=verify-full');

// 2. Explicit options.
const conn = await connect({
  host: 'localhost',
  port: 5432,
  user: 'alice',
  database: 'myapp',
  password: 'secret',
  ssl: { mode: 'verify-full' },
  applicationName: 'tusk',
  connectTimeoutMs: 10_000,
});

// 3. URL with overrides.
const conn = await connect({
  url: process.env.DATABASE_URL!,
  password: process.env.DB_PASSWORD,  // overrides the URL's password
});

// 4. Bare-options + env. PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/
//    PGSSLMODE/PGAPPNAME/PGCONNECT_TIMEOUT are read when fields are missing.
const conn = await connect({ user: 'alice' });
```

### Queries

```ts
// Simple query (any DDL / SET / multi-statement text).
await conn.query('CREATE TEMP TABLE t(id int, name text)');

// Parameterized — extended protocol.
const r = await conn.query<{ id: number; name: string | null }>(
  'SELECT id, name FROM users WHERE id = $1',
  [42]
);

// Tagged template — the typical app pattern.
import { sql } from '@perry/postgres';

const id = 42;
const r = await conn.query(sql`
  SELECT id, name FROM users WHERE id = ${id}
`);

// Composable fragments.
const where = active ? sql`WHERE active` : sql``;
const r = await conn.query(sql`SELECT * FROM users ${where} LIMIT ${10}`);

// Dynamic identifiers (the only safe escape hatch for things Postgres
// can't parameterize). Use ONLY for caller-controlled values, never user input.
import { raw } from '@perry/postgres';
await conn.query(sql`SELECT * FROM ${raw(tableName)} WHERE id = ${id}`);
```

### Result shape

```ts
const r = await conn.query('SELECT id, name FROM users');

r.rows;       // [{ id: 1, name: 'alice' }, ...]   ← decoded objects
r.rowsArray;  // [[1, 'alice'], ...]               ← decoded positional
r.rowsRaw;    // [[<Buffer>, <Buffer>], ...]       ← raw wire bytes (advanced)
r.fields;     // [{ name, typeOid, formatCode, ... }, ...]
r.command;    // 'SELECT 2'
r.rowCount;   // 2
```

`r.rows` is the obvious shape for application code. `r.rowsRaw` is what the
Tusk grid uses when it wants to render bytes byte-for-byte.

### Type fidelity

- `int2`, `int4` → `number`
- `int8` → `bigint`  (always, not `number` — `int8` exceeds `Number.MAX_SAFE_INTEGER`)
- `float4`, `float8` → `number` (NaN, Infinity, -Infinity supported)
- `numeric` → `Decimal`  (string-backed wrapper; `.toString()`, `.toNumber()`)
- `bool` → `boolean`
- `text` / `varchar` / `bpchar` / `name` → `string`
- `bytea` → `Buffer` (hex and legacy octal text formats both decoded)
- `uuid` → canonical lowercase string with dashes
- `json` / `jsonb` → parsed JS value
- `date`, `time`, `timetz`, `timestamp`, `timestamptz`, `interval` → typed
  objects with `.toString()`, `.toDate()`, microsecond-precision fields
- 1-d arrays of any of the above → `Array<T>` with `null` for SQL NULLs

```ts
import { Decimal } from '@perry/postgres';

const r = await conn.query('SELECT $1::numeric', ['99999999999999.99']);
r.rows[0]['?column?'] instanceof Decimal;  // true
String(r.rows[0]['?column?']);              // '99999999999999.99' — exact
```

### Transactions

```ts
const result = await conn.transaction(async (tx) => {
  await tx.query(sql`INSERT INTO orders (user_id) VALUES (${userId})`);
  const r = await tx.query(sql`SELECT currval('orders_id_seq') AS id`);
  return r.rows[0].id;
});
// COMMIT on resolve, ROLLBACK on throw.
```

### Connection pool

```ts
import { createPool } from '@perry/postgres';

const pool = createPool({
  url: process.env.DATABASE_URL,
  max: 20,                  // default 10
  idleTimeoutMs: 30_000,    // close idle connections after 30s
  acquireTimeoutMs: 30_000, // wait at most 30s for a slot when full
});

// Acquire + query + release in one call.
const r = await pool.query(sql`SELECT now()`);

// Multi-statement: take the connection yourself.
await pool.withConnection(async (conn) => {
  await conn.query('SET search_path TO app');
  return conn.query('SELECT * FROM widgets');
});

// Transactions on the pool.
await pool.transaction(async (tx) => {
  await tx.query(sql`UPDATE accounts SET balance = balance - ${amount} WHERE id = ${from}`);
  await tx.query(sql`UPDATE accounts SET balance = balance + ${amount} WHERE id = ${to}`);
});

// Pool stats / shutdown.
pool.size();   // { total, idle, waiting }
await pool.end();
```

### Cancelling a long query

```ts
const long = conn.query('SELECT pg_sleep(60)');
setTimeout(() => conn.cancel(), 1000);

try {
  await long;
} catch (e) {
  // PgError with code '57014' (query_canceled).
  console.error(e.code, e.message);
}
// `conn` is reusable — the protocol restored ReadyForQuery.
```

### Errors

```ts
try {
  await conn.query('SELECT * FROM nope');
} catch (e) {
  if (e instanceof PgError) {
    e.code;        // '42P01'
    e.severity;    // 'ERROR'
    e.message;     // 'relation "nope" does not exist — POSITION: 15'
    e.position;    // '15'
    e.hint;        // ...
    e.detail;      // ...
  }
}
```

### Notices and notifications

```ts
conn.on('notice', (n) => console.warn(n.severity, n.message));
conn.on('parameter', (key, value) => console.log('PG set', key, '=', value));

await conn.query('LISTEN job_done');
conn.on('notification', (n) => {
  console.log('NOTIFY received on', n.channel, ':', n.payload);
});
```

### Working with raw bytes

Tusk's grid reaches into `rowsRaw` to render `bytea` cells as hex without
decoding through Buffer twice. For most applications you'll never need it.

```ts
const r = await conn.query('SELECT data FROM blobs WHERE id = $1', [1]);
const cell = r.rowsRaw[0][0];   // Buffer | null
```

### Custom type codecs

```ts
import { registerType } from '@perry/postgres';

registerType<{ x: number; y: number }>(POINT_OID, {
  oid: POINT_OID,
  name: 'point',
  text: {
    decode(buf) {
      const [x, y] = buf.toString().slice(1, -1).split(',').map(Number);
      return { x, y };
    },
    encode(v) {
      return Buffer.from(`(${v.x},${v.y})`);
    },
  },
});
```

## Compatibility

- **Node.js** ≥ 22 (uses `Buffer`, `node:net`, `node:tls`, `node:crypto`).
- **Bun** ≥ 1.3 — fully supported except a known Bun bug in
  `tls.connect({socket})` that affects only the in-place TLS upgrade
  on Bun. The driver works; the corresponding integration tests run on
  Node via `npm run test:tls:node`.
- **Perry** — yes, that's the point. Same source, no changes; the only
  divergence is TLS upgrade and it's isolated in `src/transport/upgrade-tls.ts`.

## Status

**v0.1.0** — pre-1.0. Surface is stable but not frozen. The driver passes
the in-process mock-server matrix end-to-end. A real-Postgres CI matrix
(13/14/15/16/17 via Docker) is the next milestone.

## License

MIT.
