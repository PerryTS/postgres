# @perry/postgres

A pure-TypeScript Postgres driver that speaks the wire protocol directly —
no `libpq`, no native addons, no runtime FFI. It runs unchanged on
**Node.js**, **Bun**, and [**Perry**](https://github.com/PerryTS/perry),
where the same TypeScript source is **ahead-of-time compiled to a native
binary via LLVM** — giving you a real standalone executable that talks to
Postgres with no JS runtime attached.

> Perry is a TypeScript-to-native compiler: it lowers a strict subset of TS
> through LLVM into a statically-linked binary. `@perry/postgres` is the
> reference driver used by [**Tusk**](https://github.com/TuskQuery) (the
> Perry-native Postgres GUI), and the showcase for Perry's systems
> capabilities — every socket read, TLS handshake, and crypto op goes
> through perry-stdlib rather than a Rust or C shim.

```bash
bun add @perry/postgres
npm install @perry/postgres
pnpm add @perry/postgres
```

```ts
import { connect, sql } from '@perry/postgres';

const conn = await connect('postgres://alice:secret@db.example.com:5432/myapp');

const { rows } = await conn.query<{ id: number; name: string }>(
  sql`SELECT id, name FROM users WHERE active = ${true}`
);
for (const user of rows) console.log(user.id, user.name);

await conn.close();
```

## Why another Postgres driver?

Most Node drivers wrap `libpq` or ship a platform-specific `.node` addon.
That's a non-starter for two use cases we care about:

1. **Compiling to a native binary with Perry.** Perry produces a
   statically-linked executable via LLVM; there is no Node runtime at
   execution time, so any driver that assumes V8 / N-API / `require('pg-native')`
   is unusable. `@perry/postgres` uses only APIs that exist on both
   Perry's stdlib and Node core (`Buffer`, `net.Socket`, `crypto.*`,
   `tls.connect`), so the same TypeScript source runs on a JS runtime
   *and* compiles to a native binary.

2. **Driving a GUI** (Tusk). ORMs lose column metadata and coerce
   types for ergonomics. A database client has to render `numeric(30,8)`
   exactly, surface `attnum` / `tableOid` so users can edit-in-place, and
   expose `NOTICE`, `ParameterStatus`, backend PIDs, and structured
   `ErrorResponse` fields. This driver returns raw rows **plus** full
   column descriptors, and never silently coerces.

## Features

- **Wire protocol v3** — Postgres 13 through 17 in CI; the protocol
  itself has been stable since 7.4.
- **Authentication** — SCRAM-SHA-256, MD5, cleartext, trust.
- **TLS** — `sslmode=disable | require | verify-ca | verify-full`, mid-stream
  upgrade handled transparently on both Perry and Node.
- **Simple and extended query** — `Query`, `Parse` / `Bind` / `Execute` / `Sync`,
  portals, `Describe`.
- **20 type codecs** — integers, floats, `numeric` (precision-preserving
  `Decimal`), booleans, text family, `bytea`, `uuid`, `json`, `jsonb`,
  the full date/time family with microsecond precision, and 1-d arrays of
  any of the above — both text and binary formats.
- **Structured `PgError`** — every documented `ErrorResponse` field:
  SQLSTATE, position, detail, hint, schema/table/column/constraint.
- **Cancel protocol** — fresh socket + PID/secret handshake; the connection
  remains reusable afterwards.
- **Events** — `NOTICE`, `ParameterStatus`, `LISTEN` / `NOTIFY`.
- **Connection pool**, **transactions**, and a `sql` tagged-template helper.
- **libpq URLs and `PG*` env vars** — `DATABASE_URL`, `PGHOST`, `PGPORT`,
  `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE`, `PGAPPNAME`,
  `PGCONNECT_TIMEOUT` all work out of the box.
- **Zero native dependencies**. Pure TypeScript over `Buffer`, `node:net`,
  `node:tls`, and `node:crypto`. Nothing to rebuild per platform.
- **No lossy `numeric` coercion**. Values land in a `Decimal` wrapper that
  round-trips exact string form — none of the `9999999999.99 → 9999999999.989999`
  drift common to float-backed drivers.

## Runtime targets

| Runtime          | Status   | Notes                                                                                                                                 |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Perry** (AOT → native) ≥ 0.5.24 | supported | Same source, compiled via LLVM. TLS upgrade uses `socket.upgradeToTLS` from perry-stdlib. No JS runtime at execution time. Every built-in codec round-trips correctly (verified end-to-end against real Postgres via `examples/perry-smoke-codecs.ts`). |
| **Node.js ≥ 22** | supported | Uses `node:net`, `node:tls`, `node:crypto`, `Buffer`.                                                                                 |
| **Bun ≥ 1.3**    | supported | Fully works except a known Bun bug in `tls.connect({socket})` for in-place upgrade; the corresponding tests run on Node via `npm run test:tls:node`. |

The only API divergence across these runtimes is the mid-stream TLS upgrade.
It's isolated in [`src/transport/upgrade-tls.ts`](./src/transport/upgrade-tls.ts)
— a ~15-line feature-detect. Nothing else in the driver knows or cares
which runtime it's on.

## Quickstart

### Connecting

```ts
import { connect } from '@perry/postgres';

// 1. libpq-format URL.
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

// 3. URL with targeted overrides.
const conn = await connect({
  url: process.env.DATABASE_URL!,
  password: process.env.DB_PASSWORD, // overrides the URL's password
});

// 4. Bare options + env vars.
//    PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE /
//    PGSSLMODE / PGAPPNAME / PGCONNECT_TIMEOUT fill in missing fields.
const conn = await connect({ user: 'alice' });
```

### Queries

```ts
// Simple query — any DDL / SET / multi-statement text.
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

// Dynamic identifiers. ONLY for caller-controlled values — never user input.
import { raw } from '@perry/postgres';
await conn.query(sql`SELECT * FROM ${raw(tableName)} WHERE id = ${id}`);
```

### Result shape

```ts
const r = await conn.query('SELECT id, name FROM users');

r.rows;       // [{ id: 1, name: 'alice' }, ...]   ← decoded objects
r.rowsArray;  // [[1, 'alice'], ...]               ← decoded positional
r.rowsRaw;    // [[<Buffer>, <Buffer>], ...]       ← raw wire bytes (GUI-grade)
r.fields;     // [{ name, typeOid, formatCode, tableOid, attnum, typmod, ... }]
r.command;    // 'SELECT 2'
r.rowCount;   // 2
```

`r.rows` is the obvious shape for application code. `r.rowsRaw` is what
Tusk's grid uses when it wants to render bytes byte-for-byte without a
round-trip through `Buffer`.

### Type fidelity

| Postgres type                                         | TypeScript value                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| `int2`, `int4`                                        | `number`                                                               |
| `int8`                                                | `bigint` — always. `int8` exceeds `Number.MAX_SAFE_INTEGER`.           |
| `float4`, `float8`                                    | `number` — `NaN`, `Infinity`, `-Infinity` all round-trip.              |
| `numeric`                                             | `Decimal` — string-backed; `.toString()`, `.toNumber()`. Exact.        |
| `bool`                                                | `boolean`                                                              |
| `text`, `varchar`, `bpchar`, `name`                   | `string`                                                               |
| `bytea`                                               | `Buffer` — both hex and legacy octal text formats decoded.             |
| `uuid`                                                | canonical lowercase string with dashes                                 |
| `json`, `jsonb`                                       | parsed JS value                                                        |
| `date`, `time`, `timetz`, `timestamp`, `timestamptz`, `interval` | typed objects with `.toString()`, `.toDate()`, microsecond fields      |
| 1-d arrays of any of the above                        | `Array<T>` with `null` for SQL NULLs                                   |

Perry-native caveat: wrapper types (`Decimal`, `PgDate`, `PgTime`,
`PgTimestamp`, `PgInterval`) decode correctly but `String(value)` /
`value.toString()` currently doesn't dispatch to the wrapper's
overridden method on Perry. Read the underlying field directly
(`v.value` for `PgDate`, `v.raw` on `PgTime` / `PgTimestamp` /
`PgInterval`, `v._s` for `Decimal`) — that's what
`examples/perry-smoke-codecs.ts` does. On Node and Bun, `toString()`
works as expected.

```ts
import { Decimal } from '@perry/postgres';

const r = await conn.query('SELECT $1::numeric', ['99999999999999.99']);
r.rows[0]['?column?'] instanceof Decimal;  // true
String(r.rows[0]['?column?']);              // '99999999999999.99' — exact
```

### Transactions

```ts
const orderId = await conn.transaction(async (tx) => {
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

// Multi-statement — borrow the connection yourself.
await pool.withConnection(async (conn) => {
  await conn.query('SET search_path TO app');
  return conn.query('SELECT * FROM widgets');
});

// Pooled transaction.
await pool.transaction(async (tx) => {
  await tx.query(sql`UPDATE accounts SET balance = balance - ${amt} WHERE id = ${from}`);
  await tx.query(sql`UPDATE accounts SET balance = balance + ${amt} WHERE id = ${to}`);
});

pool.size();       // { total, idle, waiting }
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
// `conn` is reusable — ReadyForQuery restored.
```

### Errors

```ts
import { PgError } from '@perry/postgres';

try {
  await conn.query('SELECT * FROM nope');
} catch (e) {
  if (e instanceof PgError) {
    e.code;        // '42P01'
    e.severity;    // 'ERROR'
    e.message;     // 'relation "nope" does not exist'
    e.position;    // '15'
    e.hint;        // ...
    e.detail;      // ...
    e.schema;      // table / column / constraint fields, etc.
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

### Custom type codecs

```ts
import { registerType } from '@perry/postgres';

registerType<{ x: number; y: number }>(POINT_OID, {
  oid: POINT_OID,
  name: 'point',
  text: {
    decode(buf) {
      const [x, y] = buf.toString().slice(1, -1).split(',').map(Number);
      return { x: x, y: y };
    },
    encode(v) {
      return Buffer.from(`(${v.x},${v.y})`);
    },
  },
});
```

## Architecture

```
src/
├── protocol/             wire framing + message writer/reader
├── auth/                 SCRAM-SHA-256, MD5, cleartext
├── transport/            net.Socket wrapper + Perry-vs-Node TLS upgrade
├── types/                OID → codec registry, 20 built-in codecs
├── error.ts              structured PgError
├── notice.ts             NoticeResponse parsing
├── cancel.ts             fresh-socket CancelRequest
├── url.ts                libpq connection-string parser
├── env.ts                PG* environment-variable resolver
├── sql.ts                `sql` tagged template + `raw()` escape hatch
├── pool.ts               Connection pool
├── register-defaults.ts  registers every built-in codec; called once from connect()
├── connection.ts         Connection: lifecycle, simple + extended query
└── index.ts              public barrel exports
```

### Perry AOT constraints

Every source file respects the subset Perry's compiler can lower to LLVM:

- No `?.` or `??` — use explicit `if (x === undefined)` branching.
- No `obj[variable]` dynamic key access.
- No `for...of` over arrays — use `for (let i = 0; i < arr.length; i++)`.
- No regex — `indexOf` / char-code checks.
- No `{ key }` shorthand — write `{ key: key }`.
- No capturing `this.method` in closures — module-level `Map<id, State>`
  holds connection state, with named module-level handlers.

These read like quirks in a JS runtime, but they are what makes the same
source compile to a single-binary native executable on Perry.

## Related projects

- **[PerryTS/perry](https://github.com/PerryTS/perry)** — the TypeScript-to-native
  compiler (LLVM backend) and runtime / stdlib.
- **[TuskQuery](https://github.com/TuskQuery)** — Tusk, the Perry-native Postgres
  GUI that consumes this driver.

## Performance

Numbers from `bench/run-all.sh` against a local Postgres 16 (`127.0.0.1:55432`,
unix socket loopback, no SSH tunnel — RTT removed from the picture).
50 timed iterations + 5 warmups per workload. p50 wall time:

| workload     | @perry/postgres node | @perry/postgres bun | @perry/postgres perry-native¹ | pg (node)   | pg-native (node)² | postgres.js (node) | tokio-postgres (rust) |
| ------------ | -------------------- | ------------------- | ----------------------------- | ----------- | ----------------- | ------------------ | --------------------- |
| `SELECT 1`   | 82µs                 | 87µs                | 2.5 ms                        | 82µs        | 77µs              | 85µs               | 80µs                  |
| param 1-row  | 138µs                | 63µs                | 2.0 ms                        | 132µs       | 77µs              | 137µs              | 80µs                  |
| 1000 × 20    | 3.6 ms               | 3.4 ms              | 11.0 ms                       | **2.5 ms**  | 4.1 ms            | 3.0 ms             | 2.8 ms                |
| 10000 × 20   | 36.0 ms              | 33.3 ms             | 100 ms                        | **22.1 ms** | 38.0 ms           | 28.7 ms            | 26.5 ms               |

¹ Perry-native runs via `perry compile src/…/bench-this.ts`. The
  2–3 ms per-call floor is the AOT runtime's `Promise` / `async` /
  FFI overhead — Node and Bun amortise that into ~100µs per call
  via V8's / JSC's deopt-free hot paths. Bulk decode converged to
  within ~2.8× of Node after the v0.5.30 hidden-class IC work
  (standalone 10k×20 dynamic-key object build actually **beats**
  Node at 3.3 ms vs 8.5 ms; the Postgres-path gap is all
  protocol-frame decoding + per-cell wrapper allocation, not
  object-shape cost).

  Requires Perry ≥ 0.5.87. Prior fix chain: #32 / #33 / #34 / #35 /
  #36 / #37 / #68 / #70 / #71 / #72 / #73.

² `pg-native` is the libpq N-API binding. Only runs on **Node** in
  practice: Perry-native can't load dynamically-linked C addons (this
  driver exists precisely because that's a dead end for AOT targets),
  and Bun requires a from-source rebuild against its own ABI v137
  which isn't in the standard install flow.

  Counter-intuitively, pg-native is **~1.8× slower** than `pg` (pure
  JS) on bulk decode (37 ms vs 21 ms on 10k × 20). The N-API
  boundary-crossing per row + per-cell marshalling into V8 objects
  costs more than pg's stay-in-V8 text-format parser. C-speed inner
  loops don't help when every parsed value still has to become a JS
  heap object.

### Perry-native journey

The Perry-native column changed dramatically across 0.5.29 → 0.5.87:

| workload      | 0.5.29     | 0.5.87    | change  |
| ------------- | ---------- | --------- | ------- |
| `SELECT 1`    | 3.0 ms     | 2.5 ms    | -17%    |
| param 1-row   | 3.0 ms     | 2.0 ms    | -33%    |
| 1000 × 20     | 42 ms      | 11 ms     | **-74%** |
| 10000 × 20    | 764 ms     | 100 ms    | **-87%** |

The big wins came from:

1. **Hidden-class inline caches** for `obj[name] = value` writes (v0.5.30
   closed [#37](https://github.com/PerryTS/perry/issues/37) which I filed
   during this work). The linear-scan property set was O(N²) per row; the
   IC transition-cache made it O(N). Alone closes most of the gap.
2. **Escape-analysis scalar replacement** of non-escaping object literals
   (v0.5.76 #66) — 10k row objects that never escape their iteration
   frame stay on the stack.
3. **GC root-scanning fixes** across v0.5.25–v0.5.28 that unblocked
   iteration past the first query at all.

Notes:

- **`pg` is fastest by a meaningful margin** because it returns `int8`
  / `numeric` / `date` / `time` / `timestamp` as raw strings unless
  the caller opts into a parser — no `bigint`, no `Decimal`, no
  `PgDate` per cell. Most of our remaining gap is the wrapper-allocation
  cost on those types. We chose to wrap by default because the GUI use
  case (Tusk) needs them typed; if you don't, those wrappers are pure
  overhead — pass `parseTypes: 'minimal'` to `connect()` to opt out
  and get the same string-as-default shape `pg` uses (~5% off our
  default on mixed workloads, ~20% off on result sets dominated by
  int8 / numeric / date columns):

  ```ts
  const conn = await connect({
    host: 'db.example.com',
    user: 'app',
    database: 'myapp',
    parseTypes: 'minimal',  // int8/numeric/date/time/timestamp/interval → string
  });
  ```
- **`postgres.js`** sits between us and `pg`; same reason it's slower
  than `pg` (some parsing) and same reason it's faster than us (less
  parsing). We're within ~1.1–1.3× of it on bulk results — typically
  faster on Bun, slightly slower on Node.
- **`tokio-postgres` (Rust release build with `rust_decimal`)** is in
  the same range as `postgres.js` on bulk results: 26.7 ms on
  10000×20 vs our 34.9 ms (Node) / 32.5 ms (Bun). The bench reads
  every cell into an owned `i64` / `String` / `Decimal` / `bool` so
  the lazy `row.get<T>` path doesn't make Rust look unfairly fast.
  On tiny queries Rust wins by a wide margin (35µs vs ~60µs) because
  there's no V8 JIT warm-up tax. Bulk decoding, where most consumers
  live, is dominated by the codec choices — language matters less
  than what you parse into.
- **Perry-native** has a constant ~3 ms per query overhead vs ~100µs
  on the JS hosts — that's the AOT runtime's promise / async / FFI
  per-call cost rather than anything driver-level. Bulk decode is
  currently ~10–20× slower than the JS hosts on bulk results (42 ms
  vs 3.5 ms on 1000×20; 764 ms vs 36 ms on 10000×20) — every row
  builds a wrapper-heavy object chain in Perry's arena GC and there's
  real per-cell cost there the JS JITs optimise out. Correctness
  landed first across PerryTS/perry #32 / #33 / #34 / #35 / #36
  (module-level globals weren't registered as GC roots, so
  `CONN_STATES` was getting swept mid-decode). Speed is landing in
  increments — 0.5.29 shipped a ~14% cut on the 10k-row workload by
  gating the shape-clone on a `GC_FLAG_SHAPE_SHARED` bit and moving
  the accessor-descriptor `String` allocation to a lazy path.
  Requires Perry ≥ 0.5.29.

Reproduce: see [`bench/README.md`](./bench/README.md) for the full
setup (local Postgres, `npm install`, optional Rust toolchain) and
per-runner invocations. Short version:

```bash
cd bench && npm install && cd -
PGHOST=127.0.0.1 PGPORT=55432 PGUSER=$(whoami) PGDATABASE=bench \
    bench/run-all.sh
```

## Examples

Every file under [`examples/`](./examples/) is a standalone program
that compiles under Perry AND runs under Node / Bun unchanged — point
at any Postgres with the libpq environment variables and they work.
See [`examples/README.md`](./examples/README.md) for the full list.
Quick smokes if you just want to verify the driver works for you:

```bash
# Node / Bun:
PGHOST=… node --import tsx examples/perry-smoke.ts
PATH=~/.bun/bin:$PATH PGHOST=… bun examples/perry-smoke.ts

# Perry-native:
/path/to/perry compile examples/perry-smoke.ts -o /tmp/perry-smoke
PGHOST=… /tmp/perry-smoke
```

`perry-smoke.ts` covers the entire public API surface — connect,
auth, simple + extended queries, type codecs, error handling,
transactions — in ~100 lines. It's the canonical "does this driver
work for me" smoke.

## Testing

```bash
bun test                   # everything
bun test tests/unit        # pure unit tests (no DB)
bun test tests/integration # docker-compose matrix
npm run test:tls:node      # TLS suite on Node (Bun has a known tls.connect bug)
```

## Status

**v0.2.0** — pre-1.0. The public surface is stable but not frozen. The
driver passes the in-process mock-server matrix end-to-end. A
real-Postgres Docker matrix (13 / 14 / 15 / 16 / 17) is the next milestone.

## License

MIT.
