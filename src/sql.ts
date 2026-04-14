// Tagged-template helper for safe parameterized queries. Interpolated
// values become `$1`, `$2`, … placeholders with matching parameter
// bindings — no string concatenation in user code.
//
//   import { sql } from '@perry/postgres';
//
//   const id = 42;
//   const name = "O'Malley";
//   const rows = await conn.query(sql`
//     SELECT * FROM users WHERE id = ${id} AND name = ${name}
//   `);
//
// Composable: a SqlQuery can itself be interpolated into another
// template, and its placeholders are renumbered to fit the outer query.
// That makes building WHERE-clauses conditionally idiomatic:
//
//   const where = active ? sql`WHERE active` : sql``;
//   const result = await conn.query(sql`SELECT * FROM users ${where}`);
//
// Falls back to the positional `(sql, params)` pair consumed by
// `Connection.query` — no runtime magic beyond the template rewrite.

export interface SqlQuery {
    /** SQL text with $1, $2, … placeholders. */
    readonly text: string;
    /** Parameters, one per placeholder. */
    readonly params: unknown[];
    /** Sentinel for `isSqlQuery`. */
    readonly __perry_sql: true;
}

/** True when `value` is a SqlQuery. Runtime check works across bundles. */
export function isSqlQuery(value: unknown): value is SqlQuery {
    return (
        typeof value === 'object'
        && value !== null
        && (value as { __perry_sql?: boolean }).__perry_sql === true
    );
}

/**
 * Build a SqlQuery from a tagged template. Every `${expr}` becomes a
 * positional parameter; adjacent SqlQuery fragments are inlined with
 * their placeholders renumbered.
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlQuery {
    const parts: string[] = [];
    const params: unknown[] = [];

    for (let i = 0; i < strings.length; i++) {
        parts.push(strings[i]);
        if (i >= values.length) {
            continue;
        }
        const v = values[i];
        if (isSqlQuery(v)) {
            parts.push(renumber(v.text, params.length));
            for (let j = 0; j < v.params.length; j++) {
                params.push(v.params[j]);
            }
        } else {
            params.push(v);
            parts.push('$' + params.length);
        }
    }

    return { text: parts.join(''), params: params, __perry_sql: true };
}

/**
 * Create a raw, unparameterized SQL fragment. Use ONLY for identifiers
 * or SQL keywords the caller controls — not for user input. Postgres
 * has no syntax for parameterizing identifiers, so this is the escape
 * hatch when you need e.g. a dynamic column name.
 *
 *   const col = 'created_at';
 *   await conn.query(sql`SELECT * FROM users ORDER BY ${raw(col)} DESC`);
 */
export function raw(text: string): SqlQuery {
    return { text: text, params: [], __perry_sql: true };
}

/**
 * Rewrite `$1, $2, …` in `text` by adding `offset` to each number. Used
 * when inlining a sub-fragment into an outer template whose numbering
 * starts after the outer template's own params.
 */
function renumber(text: string, offset: number): string {
    if (offset === 0) {
        return text;
    }
    let out = '';
    let i = 0;
    while (i < text.length) {
        const c = text.charAt(i);
        if (c === '$' && i + 1 < text.length) {
            let j = i + 1;
            while (j < text.length) {
                const cj = text.charCodeAt(j);
                if (cj < 48 || cj > 57) {
                    break;
                }
                j++;
            }
            if (j > i + 1) {
                const n = parseInt(text.substring(i + 1, j), 10);
                out += '$' + (n + offset);
                i = j;
                continue;
            }
        }
        out += c;
        i++;
    }
    return out;
}
