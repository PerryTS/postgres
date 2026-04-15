// Shared benchmark workload definitions. All benchmark drivers
// (`bench-this.ts`, `bench-pg.ts`, `bench-postgres-js.ts`, the Rust
// crate) execute identical SQL against the same Postgres so the
// numbers are comparable. The work the SERVER does is the same in
// every run — what we're measuring is round-trip time + driver
// decode + driver protocol overhead.
//
// Numbers ordering: this list is the canonical order; keep
// `WORKLOAD_NAMES` synchronised.

export interface Workload {
    /** Short label for the output table. */
    name: string;
    /** Human description. */
    description: string;
    /** SQL to execute on each iteration. */
    sql: string;
    /** Optional positional parameters for extended-protocol workloads. */
    params: unknown[] | undefined;
    /** Expected row count — runners assert this so a misconfigured run
     *  surfaces as a hard failure rather than a fast-but-wrong number. */
    expectedRows: number;
}

const WIDE_COLS = (() => {
    const cols: string[] = [];
    for (let i = 0; i < 20; i++) {
        const j = i % 4;
        if (j === 0) {
            cols.push(`(n * ${i + 1})::int8 AS c${i}`);
        } else if (j === 1) {
            cols.push(`('row-' || n || '-c${i}')::text AS c${i}`);
        } else if (j === 2) {
            cols.push(`(n::numeric / ${i + 1})::numeric(20,5) AS c${i}`);
        } else {
            cols.push(`(n % 2 = 0)::bool AS c${i}`);
        }
    }
    return cols.join(', ');
})();

export const WORKLOADS: Workload[] = [
    {
        name: 'tiny',
        description: 'SELECT 1 — overhead floor',
        sql: 'SELECT 1',
        params: undefined,
        expectedRows: 1,
    },
    {
        name: 'param-1row',
        description: 'extended protocol, 1 param, 1 row',
        sql: 'SELECT $1::int4 AS x, $1::text AS s, ($1 % 2 = 0)::bool AS b',
        params: [42],
        expectedRows: 1,
    },
    {
        name: 'medium-1k-x-20',
        description: '1000 rows × 20 mixed-type columns',
        sql: `SELECT ${WIDE_COLS} FROM generate_series(1, 1000) AS n`,
        params: undefined,
        expectedRows: 1000,
    },
    {
        name: 'large-10k-x-20',
        description: '10000 rows × 20 mixed-type columns',
        sql: `SELECT ${WIDE_COLS} FROM generate_series(1, 10000) AS n`,
        params: undefined,
        expectedRows: 10000,
    },
];

/** Default timed iterations per workload. */
export const DEFAULT_ITERATIONS = 50;
/** Default warm-up iterations (discarded) before timing starts. */
export const DEFAULT_WARMUP = 5;

/**
 * Per-host iteration overrides. Empty by default; populate when a
 * specific host can't sustain the default iteration count for a
 * workload (e.g. a known runtime bug).
 *
 * Perry's GC fixes (v0.5.25 #34, v0.5.26 #35, v0.5.28 #36 — module-
 * level globals were never registered as GC roots, so `CONN_STATES`
 * could get swept mid-decode) have closed every blocker we saw
 * building the driver. Perry now runs every workload at the default
 * iteration count.
 */
export const PERRY_ITERATIONS_OVERRIDE = new Map<string, number>([]);
export const PERRY_WARMUP_OVERRIDE = new Map<string, number>([]);
