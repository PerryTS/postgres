#!/usr/bin/env bash
# Run every benchmark variant against the same Postgres and write
# results/all.txt + results/summary.md. Idempotent — overwrites both
# files on every run.
#
# Variants:
#   1. @perryts/postgres on Bun
#   2. @perryts/postgres on Node
#   3. @perryts/postgres compiled to Perry-native binary
#   4. pg              on Node
#   5. postgres.js     on Node
#
# Postgres credentials come from PGHOST/PGPORT/PGUSER/PGPASSWORD/
# PGDATABASE just like every other example in this repo. The script
# honors them through the env it runs each variant in.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="${ROOT}/bench"
OUT="${BENCH}/results"
mkdir -p "${OUT}"

PERRY="${PERRY:-/Users/amlug/projects/perry/perry/target/release/perry}"
BUN="${BUN:-${HOME}/.bun/bin/bun}"

ALL="${OUT}/all.txt"
: > "${ALL}"

run() {
    local label="$1"; shift
    echo "▸ ${label}" | tee -a "${ALL}"
    if "$@" >> "${ALL}" 2>&1; then
        echo "  ok" | tee -a "${ALL}"
    else
        echo "  FAILED (exit $?)" | tee -a "${ALL}"
    fi
    echo "" >> "${ALL}"
}

# 1. @perryts/postgres on Bun
if [[ -x "${BUN}" ]]; then
    run "@perryts/postgres on Bun" "${BUN}" "${BENCH}/bench-this.ts"
else
    echo "▸ @perryts/postgres on Bun — SKIPPED (bun not at ${BUN})" | tee -a "${ALL}"
fi

# 2. @perryts/postgres on Node
run "@perryts/postgres on Node" node --import tsx "${BENCH}/bench-this.ts"

# 3. @perryts/postgres compiled to Perry-native
if [[ -x "${PERRY}" ]]; then
    PERRY_BIN="$(mktemp -t bench-this.XXXXXX)"
    if "${PERRY}" compile "${BENCH}/bench-this.ts" -o "${PERRY_BIN}" >> "${ALL}" 2>&1; then
        run "@perryts/postgres on Perry (native)" "${PERRY_BIN}"
    else
        echo "▸ @perryts/postgres on Perry — compile FAILED" | tee -a "${ALL}"
    fi
    rm -f "${PERRY_BIN}"
else
    echo "▸ @perryts/postgres on Perry — SKIPPED (perry not at ${PERRY})" | tee -a "${ALL}"
fi

# 4. pg on Node
run "pg on Node" node --import tsx "${BENCH}/bench-pg.ts"

# 5. postgres.js on Node
run "postgres.js on Node" node --import tsx "${BENCH}/bench-postgres-js.ts"

# 5a. pg-native (libpq) on Node. Bun and Perry are structurally
# excluded: Bun can load N-API addons but `pg-native` doesn't ship a
# prebuilt binary for Bun's ABI and building from source requires
# a node-gyp + Python toolchain; Perry-native can't load dynamically-
# linked C addons at all (that's why @perryts/postgres is pure TS).
# Record the Node number for the "native C driver ceiling from a JS
# host" comparison.
run "pg-native on Node" node --import tsx "${BENCH}/bench-pg-native.ts"

# 6. tokio-postgres (Rust). Build only if cargo is on PATH; runs the
# release binary so optimisation level matches the JS hot paths.
if command -v cargo >/dev/null 2>&1; then
    if (cd "${BENCH}/bench-rust" && cargo build --release --quiet) >> "${ALL}" 2>&1; then
        run "tokio-postgres (Rust release)" "${BENCH}/bench-rust/target/release/bench-rust"
    else
        echo "▸ tokio-postgres (Rust release) — build FAILED" | tee -a "${ALL}"
    fi
else
    echo "▸ tokio-postgres (Rust release) — SKIPPED (cargo not on PATH)" | tee -a "${ALL}"
fi

# Build the comparison table from the captured output. The grep keeps
# only lines that look like data rows (start with the driver label
# followed by a workload name), so the noise from compile output and
# sectioning headers stays out of the summary.
SUMMARY="${OUT}/summary.md"
{
    echo "# Benchmark results"
    echo ""
    date
    echo ""
    echo "PG: \`${PGHOST:-127.0.0.1}:${PGPORT:-5432}/${PGDATABASE:-perch_test}\`"
    echo ""
    echo '```'
    grep -E '^(@perryts/postgres|pg |postgres.js|tokio-postgres|pg-native)' "${ALL}" || true
    echo '```'
} > "${SUMMARY}"

echo ""
echo "▶ raw output: ${ALL}"
echo "▶ summary  : ${SUMMARY}"
