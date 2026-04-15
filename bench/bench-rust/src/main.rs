// tokio-postgres benchmark — same workloads, same Postgres, same
// stats shape as the JS / Perry runners, so a single text table
// compares all five drivers side by side.
//
// The workloads are duplicated here in plain SQL strings rather than
// imported from `bench/workloads.ts` because Rust isn't going to read
// TypeScript. Keep them in lockstep with that file by hand.
//
// Build:
//   cargo build --release --manifest-path bench/bench-rust/Cargo.toml
// Run:
//   PGHOST=127.0.0.1 PGPORT=55432 PGUSER=$(whoami) PGDATABASE=bench \
//       bench/bench-rust/target/release/bench-rust

use std::env;
use std::time::Instant;
use tokio_postgres::{NoTls, Row};
use rust_decimal::Decimal;

// Mixed-type column layout matches `bench/workloads.ts`:
//   col % 4 == 0 → int8     → i64
//   col % 4 == 1 → text     → String
//   col % 4 == 2 → numeric  → rust_decimal::Decimal
//   col % 4 == 3 → bool     → bool
//
// Decoding every cell into an owned value mirrors what the JS / Perry
// runners do at result-build time, so the timings compare apples to
// apples (vs the lazy `row.get` approach that would just measure
// protocol throughput).

const DEFAULT_ITERATIONS: usize = 50;
const DEFAULT_WARMUP: usize = 5;

struct Workload {
    name: &'static str,
    sql: String,
    has_param: bool,
    expected_rows: usize,
}

fn workloads() -> Vec<Workload> {
    let mut wide_cols = String::new();
    for i in 0..20u32 {
        if i > 0 {
            wide_cols.push_str(", ");
        }
        match i % 4 {
            0 => wide_cols.push_str(&format!("(n * {})::int8 AS c{}", i + 1, i)),
            1 => wide_cols.push_str(&format!("('row-' || n || '-c{}')::text AS c{}", i, i)),
            2 => wide_cols.push_str(&format!("(n::numeric / {})::numeric(20,5) AS c{}", i + 1, i)),
            _ => wide_cols.push_str(&format!("(n % 2 = 0)::bool AS c{}", i)),
        }
    }
    vec![
        Workload {
            name: "tiny",
            sql: "SELECT 1".into(),
            has_param: false,
            expected_rows: 1,
        },
        Workload {
            name: "param-1row",
            sql: "SELECT $1::int4 AS x, $1::text AS s, ($1 % 2 = 0)::bool AS b".into(),
            has_param: true,
            expected_rows: 1,
        },
        Workload {
            name: "medium-1k-x-20",
            sql: format!(
                "SELECT {} FROM generate_series(1, 1000) AS n",
                wide_cols
            ),
            has_param: false,
            expected_rows: 1000,
        },
        Workload {
            name: "large-10k-x-20",
            sql: format!(
                "SELECT {} FROM generate_series(1, 10000) AS n",
                wide_cols
            ),
            has_param: false,
            expected_rows: 10000,
        },
    ]
}

fn fmt_ms(ms: f64) -> String {
    if ms < 1.0 {
        format!("{}µs", (ms * 1000.0).round() as u64)
    } else if ms < 10.0 {
        format!("{:.2}ms", ms)
    } else {
        format!("{:.1}ms", ms)
    }
}

fn print_row(driver: &str, workload: &str, samples: &mut [f64]) {
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = samples.len();
    let min = samples[0];
    let median = if n % 2 == 0 {
        (samples[n / 2 - 1] + samples[n / 2]) / 2.0
    } else {
        samples[(n - 1) / 2]
    };
    let p95_idx = ((n as f64) * 0.95) as usize;
    let p95 = samples[p95_idx.min(n - 1)];
    let mean: f64 = samples.iter().sum::<f64>() / (n as f64);
    println!(
        "{:<22}{:<20}n={:<5} min {:<10} p50 {:<10} p95 {:<10} mean {:<10}",
        driver,
        workload,
        n,
        fmt_ms(min),
        fmt_ms(median),
        fmt_ms(p95),
        fmt_ms(mean),
    );
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let host = env::var("PGHOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port: u16 = env::var("PGPORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(5432);
    let user = env::var("PGUSER").unwrap_or_else(|_| "perch_test".into());
    let password = env::var("PGPASSWORD").unwrap_or_default();
    let database = env::var("PGDATABASE").unwrap_or_else(|_| "perch_test".into());

    let mut config = tokio_postgres::Config::new();
    config
        .host(&host)
        .port(port)
        .user(&user)
        .dbname(&database);
    if !password.is_empty() {
        config.password(&password);
    }

    let (client, connection) = config.connect(NoTls).await?;
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("connection error: {}", e);
        }
    });

    let driver = "tokio-postgres   rust";
    println!("# {}", driver);

    for wl in workloads() {
        let stmt = client.prepare(&wl.sql).await?;
        // Warm-up.
        for _ in 0..DEFAULT_WARMUP {
            let rows = run(&client, &stmt, wl.has_param).await?;
            consume_rows(&rows, wl.expected_rows);
        }
        // Timed. Includes the per-cell decode pass — without it
        // tokio-postgres would only measure protocol + row-collect
        // because `Row` decodes lazily (`row.get::<_, T>` parses on
        // demand). The JS / Perry drivers decode every cell into an
        // owned value at result-build time, so to compare like-for-
        // like we have to consume each cell here too.
        let mut samples: Vec<f64> = Vec::with_capacity(DEFAULT_ITERATIONS);
        for _ in 0..DEFAULT_ITERATIONS {
            let t0 = Instant::now();
            let rows = run(&client, &stmt, wl.has_param).await?;
            consume_rows(&rows, wl.expected_rows);
            let elapsed = t0.elapsed().as_secs_f64() * 1000.0;
            samples.push(elapsed);
        }
        print_row(driver, wl.name, &mut samples);
    }
    Ok(())
}

async fn run(
    client: &tokio_postgres::Client,
    stmt: &tokio_postgres::Statement,
    has_param: bool,
) -> Result<Vec<Row>, tokio_postgres::Error> {
    if has_param {
        let v: i32 = 42;
        client.query(stmt, &[&v]).await
    } else {
        client.query(stmt, &[]).await
    }
}

/// Walk every cell of every row so the per-cell decode cost shows up
/// in the timing window. The 1-col / 3-col workloads are decoded as
/// (i32, String, bool); the 20-col mixed workloads use the schema
/// documented at the top of this file. The `std::hint::black_box`
/// calls keep the optimiser from eliding the reads — without them
/// release-mode dead-code analysis would skip the work entirely.
fn consume_rows(rows: &[Row], expected: usize) {
    assert_eq!(rows.len(), expected);
    if rows.is_empty() {
        return;
    }
    let ncols = rows[0].len();
    if ncols == 1 {
        // `tiny`: SELECT 1 returns one int4 column.
        for row in rows {
            let v: i32 = row.get(0);
            std::hint::black_box(v);
        }
        return;
    }
    if ncols == 3 {
        // `param-1row`: x int4, s text, b bool.
        for row in rows {
            let x: i32 = row.get(0);
            let s: String = row.get(1);
            let b: bool = row.get(2);
            std::hint::black_box((x, s, b));
        }
        return;
    }
    // 20-col mixed (medium / large).
    for row in rows {
        for j in 0..ncols {
            match j % 4 {
                0 => {
                    let v: i64 = row.get(j);
                    std::hint::black_box(v);
                }
                1 => {
                    let v: String = row.get(j);
                    std::hint::black_box(v);
                }
                2 => {
                    let v: Decimal = row.get(j);
                    std::hint::black_box(v);
                }
                _ => {
                    let v: bool = row.get(j);
                    std::hint::black_box(v);
                }
            }
        }
    }
}
