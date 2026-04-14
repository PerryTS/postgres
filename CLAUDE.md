# @perry/postgres

Pure-TypeScript Postgres wire-protocol driver. Sibling of **Tusk** (the GUI
that consumes it). Published independently as `@perry/postgres` and usable by
any Perry or Node.js program that wants to talk to Postgres.

## Positioning

- **Showcase of Perry's systems-programming capability.** No native Rust
  crate in this package; all capabilities come from perry-stdlib
  (`net.Socket`, `tls.connect`, `socket.upgradeToTLS`, `crypto.*`, `Buffer`).
- **Runs unchanged on Node.js / Bun.** The only API surface that differs
  between Perry and Node is TLS upgrade; a one-function adapter handles it.
  Everything else (Buffer, crypto, net.Socket events, big-endian reads) is
  Node-compatible by construction.
- **Shaped for a GUI**, not an ORM. Returns raw rows plus full column
  metadata (OID, typmod, tableOid, attnum, format). Exposes NOTICE,
  structured ErrorResponse, backend PID, parameter status.

## Architecture

```
TypeScript driver
    │
    ├── src/protocol/   wire framing + message writer/reader (C1)
    ├── src/auth/       SCRAM-SHA-256, MD5, cleartext        (C3)
    ├── src/types/      OID → codec registry, 20 types       (C5)
    ├── src/error.ts    structured PgError                   (C6)
    ├── src/notice.ts   NoticeResponse                       (C6)
    ├── src/cancel.ts   fresh socket + CancelRequest         (C6)
    ├── src/connection.ts  Connection: lifecycle, queries    (C2+)
    └── src/index.ts    public barrel exports
```

## Milestones (mirror the plan in /Users/amlug/.claude/plans/vivid-sleeping-shore.md)

- **C1** — Wire framing round-trip unit tests green (no socket required). ✓
- **C2** — TCP + Startup + cleartext + `SELECT 1`. ✓
- **C3** — SCRAM-SHA-256 + MD5. ✓
- **C4** — TLS via `socket.upgradeToTLS` + sslmode. ✓
- **C5** — Extended query + 20 type codecs (binary + text). ✓
- **C6** — Cancel + structured ErrorResponse. ✓
- **0.2 polish** — URL parser, env vars, sql tag, transactions, pool. ✓ ← current
- **C7** — PG 13–17 docker matrix green. Package publishable.

## Node.js compatibility contract

Code under `src/` must only use APIs available both in Perry's stdlib and
Node.js core:

- `Buffer` (same API on both), `Buffer.concat`, big-endian read/write.
- `net.createConnection(host, port)` with `.on('connect'|'data'|'error'|'close')`.
- `crypto.createHash / createHmac / pbkdf2Sync / randomBytes / ...`.
- `process.hrtime.bigint()` or equivalent for timings — avoid; defer to consumer.

The one divergence is TLS upgrade:

- Perry: `socket.upgradeToTLS(servername, verify)` returns a Promise.
- Node: `tls.connect({ socket, servername, rejectUnauthorized })` returns a new TLSSocket.

`src/transport/upgrade-tls.ts` (added in C4) is a ~15-line adapter that
feature-detects and picks the right path. No other code in the driver needs
to know about the difference.

## Perry AOT constraints (apply to all source files)

Per the hone CLAUDE.md conventions:

- No `?.` optional chaining — use explicit `if (x === undefined)` / `if (x === null)`.
- No `??` nullish coalescing — use explicit branching.
- No `obj[variable]` dynamic key access — use `if/else if` or switch.
- No `/regex/.test()` — use `indexOf` or char-code checks.
- No `{ key }` ES6 shorthand — write `{ key: key }`.
- No `for...of` on arrays — use `for (let i = 0; i < arr.length; i++)`.
- No `setTimeout` self-recursion — use `setInterval`.
- No closures capturing instance methods as `this.method` — store state in
  module-level `Map<id, State>` and use named module-level handlers.

## Testing

```bash
bun test                # all tests
bun test tests/unit     # pure unit tests (no DB)
bun test tests/integration  # docker-compose matrix (future: C7)
```
