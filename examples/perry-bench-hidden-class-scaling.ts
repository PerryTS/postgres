// Show how per-row cost scales with column count — if the bottleneck
// is the linear keys_array scan inside js_object_set_field_by_name,
// per-row time grows O(N²) with property count (N properties each
// requires scanning 0..N-1 existing keys). A hidden-class / inline-
// cache design is O(N).

function nowMs(): number {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (g.performance !== undefined && typeof g.performance.now === 'function') {
        return g.performance.now();
    }
    return Date.now();
}

const NAMES: string[] = [];
for (let i = 0; i < 80; i++) NAMES.push('c' + i);

function build(nrows: number, ncols: number): number {
    // Warmup
    for (let w = 0; w < 3; w++) {
        const out: Record<string, unknown>[] = new Array(nrows);
        for (let i = 0; i < nrows; i++) {
            const o: Record<string, unknown> = {};
            for (let j = 0; j < ncols; j++) {
                o[NAMES[j]] = i * j;
            }
            out[i] = o;
        }
        if (out.length !== nrows) throw new Error('bad');
    }
    const ITERS = 5;
    const t0 = nowMs();
    for (let w = 0; w < ITERS; w++) {
        const out: Record<string, unknown>[] = new Array(nrows);
        for (let i = 0; i < nrows; i++) {
            const o: Record<string, unknown> = {};
            for (let j = 0; j < ncols; j++) {
                o[NAMES[j]] = i * j;
            }
            out[i] = o;
        }
        if (out.length !== nrows) throw new Error('bad');
    }
    return (nowMs() - t0) / ITERS;
}

// Hold row count constant at 10000; sweep column count.
const COLS = [5, 10, 20, 40, 80];
for (let k = 0; k < COLS.length; k++) {
    const ncols = COLS[k];
    const t = build(10000, ncols);
    const perCell = (t * 1000) / (10000 * ncols);
    console.log(
        'cols=' + String(ncols).padStart(2)
        + '  total=' + t.toFixed(2).padStart(7) + ' ms'
        + '  per-cell=' + perCell.toFixed(2).padStart(5) + ' µs'
    );
}
