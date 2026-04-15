// Tiny stats helpers shared by all benchmark drivers. Keep math
// trivial — we want the comparison to be meaningful, not the
// reporting code itself to be a benchmark target.

/**
 * Sub-ms wall clock in milliseconds. Uses `performance.now()` where
 * available (Node, Bun, browsers — and Perry implements it on its
 * stdlib). Falls back to `Date.now()` (1ms resolution) on whatever
 * weird host doesn't expose either. Returns ms as a float.
 */
export function now(): number {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (g.performance !== undefined && typeof g.performance.now === 'function') {
        return g.performance.now();
    }
    return Date.now();
}

export interface Stats {
    n: number;
    min: number;
    median: number;
    p95: number;
    mean: number;
}

export function computeStats(samplesMs: number[]): Stats {
    const sorted = samplesMs.slice().sort((a, b) => a - b);
    const n = sorted.length;
    const median = n % 2 === 0
        ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
        : sorted[(n - 1) / 2];
    const p95Idx = Math.min(n - 1, Math.floor(n * 0.95));
    const sum = sorted.reduce((a, b) => a + b, 0);
    return {
        n: n,
        min: sorted[0],
        median: median,
        p95: sorted[p95Idx],
        mean: sum / n,
    };
}

export function fmtMs(ms: number): string {
    if (ms < 1) {
        return (ms * 1000).toFixed(0) + 'µs';
    }
    if (ms < 10) {
        return ms.toFixed(2) + 'ms';
    }
    return ms.toFixed(1) + 'ms';
}

/** Print one workload's results as a single line. */
export function printRow(driver: string, workload: string, s: Stats): void {
    const cells = [
        driver.padEnd(20),
        workload.padEnd(18),
        ('n=' + s.n).padEnd(6),
        ('min ' + fmtMs(s.min)).padEnd(13),
        ('p50 ' + fmtMs(s.median)).padEnd(13),
        ('p95 ' + fmtMs(s.p95)).padEnd(13),
        ('mean ' + fmtMs(s.mean)).padEnd(14),
    ];
    console.log(cells.join('  '));
}
