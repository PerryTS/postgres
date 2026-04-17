# @perry/postgres examples

Each `.ts` file in this directory is a standalone, runnable program —
no test harness, no framework. Compile with Perry for a native
binary, or run with `node --import tsx` / `bun` to use the driver
under a JS host.

## End-to-end smokes

These exercise the driver's public API against a real Postgres and
print a short pass/fail line. They double as reference code for
application authors.

| File | What it does |
| ---- | ------------ |
| [`perry-smoke.ts`](./perry-smoke.ts) | Baseline: connect, auth, simple + extended queries, type codecs, error path, transaction |
| [`perry-smoke-tls.ts`](./perry-smoke-tls.ts) | `sslmode=require` + in-place TLS upgrade, SCRAM over TLS |
| [`perry-smoke-cancel.ts`](./perry-smoke-cancel.ts) | `conn.cancel()` against a long-running `pg_sleep(30)` |
| [`perry-smoke-close.ts`](./perry-smoke-close.ts) | `conn.close()` timing — FIN vs belt-and-braces timer |
| [`perry-smoke-notify.ts`](./perry-smoke-notify.ts) | `NOTICE` (`RAISE NOTICE`) + `LISTEN` / `NOTIFY` pub/sub |
| [`perry-smoke-codecs.ts`](./perry-smoke-codecs.ts) | Round-trip every built-in scalar + array codec |
| [`perry-smoke-bulk.ts`](./perry-smoke-bulk.ts) | 1000-row × 20-column projection with timing |

### Running a smoke

```bash
# Node / Bun:
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=you PGPASSWORD=pw PGDATABASE=db \
    node --import tsx examples/perry-smoke.ts

PATH=~/.bun/bin:$PATH PGHOST=… bun examples/perry-smoke.ts

# Perry-native (AOT-compiled binary):
/path/to/perry compile examples/perry-smoke.ts -o /tmp/perry-smoke
PGHOST=… /tmp/perry-smoke
```

All smokes honour the standard libpq environment variables
(`PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE`).

## Microbenchmarks (diagnostic)

Not user-facing — these isolate specific hot paths that surfaced
during Perry's perf work. Useful if you're investigating a regression.

| File | Target |
| ---- | ------ |
| [`perry-smoke-bulk.ts`](./perry-smoke-bulk.ts) | 1000×20 end-to-end wall time |
| [`perry-bench-hidden-class.ts`](./perry-bench-hidden-class.ts) | 10000×20 pure-JS dynamic-key obj build (no Postgres) |
| [`perry-bench-hidden-class-scaling.ts`](./perry-bench-hidden-class-scaling.ts) | Sweeps column count 5 → 80 to show O(N) vs O(N²) shape |

See `bench/` for the apples-to-apples matrix against `pg`,
`postgres.js`, `pg-native`, and `tokio-postgres`.

## Historical upstream-bug reproducers

Kept as a paper trail from the Perry fix chain — none of these
should still reproduce a crash on Perry ≥ 0.5.87, but they're useful
if a similar regression shows up.

| File | Upstream issue |
| ---- | -------------- |
| [`perry-bench-crash-repro.ts`](./perry-bench-crash-repro.ts) | PerryTS/perry#36 — module-level globals as GC roots |
| [`perry-bench-narrow.ts`](./perry-bench-narrow.ts), [`perry-bench-narrow2.ts`](./perry-bench-narrow2.ts) | Narrowing repros for the above |
| [`perry-tls-low-level.ts`](./perry-tls-low-level.ts) | Driver-free SSL upgrade test (from the TLS bring-up) |
| [`perry-driver-toplevel.ts`](./perry-driver-toplevel.ts) | Minimal connect + query without the example harness |
| [`perry-net-sanity.ts`](./perry-net-sanity.ts) | TCP round-trip against any postgres host |
| [`select-one.ts`](./select-one.ts) | Simplest possible `SELECT 1` |
