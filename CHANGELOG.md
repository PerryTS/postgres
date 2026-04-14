# Changelog

## 0.2.0 — Library ergonomics

Public API additions for general-purpose use. Driver internals unchanged.

### Added

- **`connect(url)`** — accepts a `postgres://` URL directly, in addition to
  the explicit-options form.
- **`resolveConnectOptions(input)`** — merges options + URL + `PG*`
  environment variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`,
  `PGDATABASE`, `PGAPPNAME`, `PGCONNECT_TIMEOUT`, `PGSSLMODE`).
- **`parseConnectionString(url)`** — public URL parser with IPv6, percent
  encoding, and query-string options (`sslmode`, `application_name`,
  `connect_timeout`).
- **`sql\`...\`` tagged template** — safe parameterized queries with
  `${value}` interpolation, composable across fragments and renumbered
  on splice. Plus `raw(text)` for unparameterized identifiers.
- **`Connection.transaction(cb)`** — wraps `BEGIN` / `COMMIT` / `ROLLBACK`,
  rolls back on throw and re-raises.
- **`createPool(opts)` / `Pool`** — connection pool with `max`,
  `idleTimeoutMs`, `acquireTimeoutMs`. Methods: `query`, `withConnection`,
  `transaction`, `end`, `size`, `acquire`, `release`.
- **`QueryResult.rows`** is now decoded objects keyed by column name.
  New `rowsArray` (positional, decoded) and `rowsRaw` (positional Buffer)
  alternates for callers who need different shapes.
- `PgError.message` now includes `DETAIL` / `HINT` / `POSITION` /
  `CONSTRAINT` suffixes so `console.error(err)` shows the full picture
  without reaching for individual fields.

### Changed

- `QueryResult.rows` shape changed from `(Buffer | null)[][]` to
  `Record<string, unknown>[]`. The old shape is available as `rowsRaw`.
  This is the only breaking change in 0.2.

### Internal

- New files: `src/url.ts`, `src/env.ts`, `src/sql.ts`, `src/pool.ts`.
- Test count: 129 pass / 0 fail / 3 skip across 12 files (was 99/8 in 0.1).

---

## 0.1.0 — Initial driver release

First fully-functional release. Covers everything in the
`/Users/amlug/projects/tusk/tusk-spec.md` driver section §3:

- Postgres wire protocol v3 (frame encode/decode, MessageReader)
- StartupMessage, SSLRequest, CancelRequest, all client→server frames
- Authentication: cleartext, MD5, SCRAM-SHA-256
- TLS via `socket.upgradeToTLS()` (Perry) and `tls.connect({socket})` (Node)
- Sslmode: disable / require / verify-ca / verify-full
- Simple query + extended query (Parse/Bind/Execute/Sync)
- 20 type codecs in text + binary, including precision-preserving `numeric`
- Structured `PgError` with full ErrorResponse field set
- `NOTICE`, `ParameterStatus`, `Notification` events
- Backend PID + secret captured; `Connection.cancel()` on a fresh connection
- Mock Postgres server for in-process integration testing
