# @perry/postgres benchmark suite

Cross-host, cross-driver, cross-language benchmarks comparing this
driver against the Node.js and Rust Postgres ecosystems.

## What's in the matrix

Six runners, all hitting the same Postgres with the same four
workloads and the same timing harness:

| Runner | File | Runs on | What it is |
| ------ | ---- | ------- | ---------- |
| `@perry/postgres` | `bench-this.ts` | Node / Bun / Perry-native | This driver |
| `pg` | `bench-pg.ts` | Node | node-postgres, pure JS |
| `pg-native` | `bench-pg-native.ts` | Node only¹ | libpq via N-API |
| `postgres.js` | `bench-postgres-js.ts` | Node | porsager/postgres |
| `tokio-postgres` | `bench-rust/` | Rust release binary | Full async Rust driver |

¹ `pg-native` doesn't ship a Bun-ABI prebuilt binary and Perry-native
  can't load `.node` addons. See the Performance section of the main
  [README](../README.md) for the full story.

## Workloads

Defined in [`workloads.ts`](./workloads.ts):

| Name | SQL shape | Purpose |
| ---- | --------- | ------- |
| `tiny` | `SELECT 1` | Per-call overhead floor |
| `param-1row` | `SELECT $1::int4, $1::text, ($1 % 2 = 0)::bool` | Extended protocol with a bound parameter |
| `medium-1k-x-20` | 1000 rows × 20 mixed-type columns | Realistic analytics shape |
| `large-10k-x-20` | 10000 rows × 20 mixed-type columns | Stress the row-decode path |

Columns cycle through `int8 / text / numeric / bool` so every cell
exercises a different codec.

## Running it

### 1. Start Postgres

The bench assumes Postgres 16 listening on `127.0.0.1:55432` with a
database called `bench` that your local user can connect to without a
password. Easiest path on macOS:

```bash
brew install postgresql@16
/opt/homebrew/opt/postgresql@16/bin/pg_ctl \
    -D /opt/homebrew/var/postgresql@16 \
    -l /tmp/pg-bench.log -o "-p 55432" start
/opt/homebrew/opt/postgresql@16/bin/createdb -h /tmp -p 55432 bench
```

Or point the bench at any other server by setting `PGHOST`, `PGPORT`,
`PGUSER`, `PGPASSWORD`, `PGDATABASE` in the environment.

### 2. Install dependencies

```bash
cd bench
npm install        # pulls pg, postgres, pg-native, tsx
```

For the Rust runner you'll also need a stable Rust toolchain:

```bash
rustup default stable   # if not already installed
```

### 3. Run a single runner

```bash
# From the repo root:
PGHOST=127.0.0.1 PGPORT=55432 PGUSER=$(whoami) PGDATABASE=bench \
    node --import tsx bench/bench-this.ts         # driver on Node
PATH=~/.bun/bin:$PATH PGHOST=…                    bun bench/bench-this.ts         # driver on Bun

/Users/amlug/projects/perry/perry/target/release/perry \
    compile bench/bench-this.ts -o /tmp/bench-this
PGHOST=…                                          /tmp/bench-this                  # driver on Perry-native

PGHOST=…                                          node --import tsx bench/bench-pg.ts            # pg
PGHOST=…                                          node --import tsx bench/bench-postgres-js.ts   # postgres.js
PGHOST=…                                          node --import tsx bench/bench-pg-native.ts     # pg-native
PGHOST=…                                          bench/bench-rust/target/release/bench-rust     # rust
```

Each runner prints one line per workload in the canonical format the
summary table uses.

### 4. Run the whole matrix

```bash
PATH=~/.bun/bin:~/.cargo/bin:$PATH \
PGHOST=127.0.0.1 PGPORT=55432 PGUSER=$(whoami) PGDATABASE=bench \
    bench/run-all.sh
```

Outputs:

- `bench/results/all.txt` — raw per-run output (gitignored; regenerated every time)
- `bench/results/summary.md` — sorted table across all drivers (committed so the latest numbers show up in the repo)

The script skips any runner whose prerequisites aren't present (bun
missing, cargo missing, perry missing) — so you can run a partial
matrix without installing every stack.

## Tuning

- `DEFAULT_ITERATIONS` / `DEFAULT_WARMUP` in [`workloads.ts`](./workloads.ts) — 50 / 5 by default. Bump for lower-variance runs.
- Per-workload Perry overrides: leave empty unless you hit a known runtime regression (the comment in `workloads.ts` links to the upstream issue when one is active).

## Interpreting the output

Every row reports `min / p50 / p95 / mean` — prefer **`min`** for
driver-cost comparison (least noise) and **`p50`** for realistic
steady-state. Mean is there for sanity; p95 catches GC-pause
sensitivity.

Full analysis with notes on `pg-native` being slower than pure-JS
`pg`, the Perry-native fix chain, and the Rust decode-cost story is
in the main [README](../README.md#performance) under "Performance".
