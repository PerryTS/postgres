// Minimal reproducer for the Perry hidden-class / inline-cache gap.
// No external deps — compile with `perry compile` and run directly.
//
// Builds 10000 plain-object row literals with 20 properties each,
// all rows sharing the same property-name sequence — the canonical
// shape V8's hidden-class machinery optimizes into a monomorphic IC.
//
// On V8 / JSC this is a few milliseconds.
// On Perry (0.5.29) it's ~50x slower because every `obj[name] = v`
// goes through `js_object_set_field_by_name` which does a linear
// scan over the keys_array to find or append the slot.

function nowMs(): number {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (g.performance !== undefined && typeof g.performance.now === 'function') {
        return g.performance.now();
    }
    return Date.now();
}

const NAMES: string[] = [
    'c0','c1','c2','c3','c4','c5','c6','c7','c8','c9',
    'c10','c11','c12','c13','c14','c15','c16','c17','c18','c19',
];
const NROWS = 10000;
const NCOLS = 20;

function build(): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = new Array(NROWS);
    for (let i = 0; i < NROWS; i++) {
        const o: Record<string, unknown> = {};
        for (let j = 0; j < NCOLS; j++) {
            o[NAMES[j]] = i * j;
        }
        out[i] = o;
    }
    return out;
}

// Warmup
for (let w = 0; w < 3; w++) {
    const r = build();
    if (r.length !== NROWS) throw new Error('bad');
}

const ITERS = 10;
const t0 = nowMs();
for (let w = 0; w < ITERS; w++) {
    const r = build();
    if (r.length !== NROWS) throw new Error('bad');
}
const elapsed = (nowMs() - t0) / ITERS;
console.log('10000 x 20 dynamic-key obj build: ' + elapsed.toFixed(2) + ' ms/iter');
