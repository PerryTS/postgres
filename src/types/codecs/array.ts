// 1-dimensional array codecs. Multi-dim arrays are explicitly out of
// scope per tusk-spec.md §3.4 — a `jsonb` column covers that need better.
//
// Text format: `{a,b,c}` with NULL encoded as the literal four-character
// string `NULL`. Quoted elements wrap in double quotes and escape `"`/`\`.
//
// Binary format: fixed header + per-element length-prefixed bytes.
//   int32 ndim
//   int32 hasnull (0 or 1)
//   int32 element_oid
//   for each dimension:
//     int32 length
//     int32 lower_bound
//   for each element:
//     int32 length (-1 = NULL)
//     bytes
//
// We only emit / consume 1-d arrays, but we accept multi-d on decode by
// flattening (consumers can inspect the element oid via RowDescription).

import type { Codec } from '../registry';
import { decodeValue, encodeValue } from '../registry';
import { FORMAT_BINARY, FORMAT_TEXT } from '../oids';

// ─── Text decode / encode ────────────────────────────────────────────────────

export function decodeArrayText(elementOid: number, buf: Buffer): unknown[] {
    const s = buf.toString('utf8');
    if (s.length === 0 || (s.charAt(0) !== '{' && s.charAt(0) !== '[')) {
        return [];
    }
    // Skip leading `[m:n]=` dim-range prefix when present (non-default
    // lower bounds produce it).
    let start = 0;
    if (s.charAt(0) === '[') {
        const eq = s.indexOf('=');
        if (eq > 0) {
            start = eq + 1;
        }
    }
    const { values } = parseArrayBody(s, start, elementOid);
    return values;
}

/** Recursive parser — handles braces, quoted strings, escapes, NULLs. */
function parseArrayBody(
    s: string,
    start: number,
    elementOid: number
): { values: unknown[]; end: number } {
    if (s.charAt(start) !== '{') {
        return { values: [], end: start };
    }
    const out: unknown[] = [];
    let i = start + 1;
    while (i < s.length && s.charAt(i) !== '}') {
        if (s.charAt(i) === ',') {
            i++;
            continue;
        }
        if (s.charAt(i) === '{') {
            // Nested sub-array — flatten.
            const inner = parseArrayBody(s, i, elementOid);
            for (let k = 0; k < inner.values.length; k++) {
                out.push(inner.values[k]);
            }
            i = inner.end + 1;
            continue;
        }
        // Element — either a quoted string or a bareword until `,` or `}`.
        let raw: string;
        if (s.charAt(i) === '"') {
            let j = i + 1;
            let acc = '';
            while (j < s.length) {
                const c = s.charAt(j);
                if (c === '\\' && j + 1 < s.length) {
                    acc += s.charAt(j + 1);
                    j += 2;
                    continue;
                }
                if (c === '"') {
                    break;
                }
                acc += c;
                j += 1;
            }
            raw = acc;
            i = j + 1;
            out.push(decodeValue(elementOid, FORMAT_TEXT, Buffer.from(raw, 'utf8')));
            continue;
        }
        // Bareword.
        let j = i;
        while (j < s.length && s.charAt(j) !== ',' && s.charAt(j) !== '}') {
            j++;
        }
        raw = s.substring(i, j);
        i = j;
        if (raw === 'NULL') {
            out.push(null);
        } else {
            out.push(decodeValue(elementOid, FORMAT_TEXT, Buffer.from(raw, 'utf8')));
        }
    }
    return { values: out, end: i };
}

export function encodeArrayText(elementOid: number, values: (unknown | null)[]): Buffer {
    const parts: string[] = ['{'];
    for (let i = 0; i < values.length; i++) {
        if (i > 0) {
            parts.push(',');
        }
        const v = values[i];
        if (v === null) {
            parts.push('NULL');
        } else {
            const bytes = encodeValue(elementOid, FORMAT_TEXT, v);
            parts.push(quoteArrayElement(bytes.toString('utf8')));
        }
    }
    parts.push('}');
    return Buffer.from(parts.join(''), 'utf8');
}

function quoteArrayElement(s: string): string {
    // Quote when the element contains special characters, is empty, or
    // matches the literal 'NULL'.
    let needsQuote = s.length === 0 || s === 'NULL';
    if (!needsQuote) {
        for (let i = 0; i < s.length; i++) {
            const c = s.charAt(i);
            if (c === ',' || c === '{' || c === '}' || c === '"' || c === '\\' || c === ' ') {
                needsQuote = true;
                break;
            }
        }
    }
    if (!needsQuote) {
        return s;
    }
    let escaped = '';
    for (let i = 0; i < s.length; i++) {
        const c = s.charAt(i);
        if (c === '"' || c === '\\') {
            escaped += '\\';
        }
        escaped += c;
    }
    return '"' + escaped + '"';
}

// ─── Binary decode / encode ──────────────────────────────────────────────────

export function decodeArrayBinary(elementOid: number, buf: Buffer): unknown[] {
    const ndim = buf.readInt32BE(0);
    // const hasNull = buf.readInt32BE(4);
    const _declaredOid = buf.readInt32BE(8);
    let pos = 12;
    let total = ndim === 0 ? 0 : 1;
    for (let d = 0; d < ndim; d++) {
        const len = buf.readInt32BE(pos);
        total *= len;
        pos += 8; // length + lower_bound
    }
    const out: unknown[] = new Array(total);
    for (let i = 0; i < total; i++) {
        const len = buf.readInt32BE(pos);
        pos += 4;
        if (len === -1) {
            out[i] = null;
        } else {
            out[i] = decodeValue(elementOid, FORMAT_BINARY, buf.subarray(pos, pos + len));
            pos += len;
        }
    }
    return out;
}

export function encodeArrayBinary(elementOid: number, values: (unknown | null)[]): Buffer {
    const elements: Buffer[] = [];
    let hasNull = 0;
    for (let i = 0; i < values.length; i++) {
        if (values[i] === null) {
            hasNull = 1;
            elements.push(Buffer.alloc(0));
        } else {
            elements.push(encodeValue(elementOid, FORMAT_BINARY, values[i]));
        }
    }
    // ndim=1, hasnull, element_oid, (len=N, lower=1), per-element (int32 len + bytes)
    let elementSize = 0;
    for (let i = 0; i < elements.length; i++) {
        elementSize += 4 + (values[i] === null ? 0 : elements[i].length);
    }
    const out = Buffer.alloc(20 + elementSize);
    out.writeInt32BE(1, 0);               // ndim
    out.writeInt32BE(hasNull, 4);         // hasnull
    out.writeInt32BE(elementOid, 8);      // element oid
    out.writeInt32BE(values.length, 12);  // dim length
    out.writeInt32BE(1, 16);              // lower bound
    let pos = 20;
    for (let i = 0; i < elements.length; i++) {
        if (values[i] === null) {
            out.writeInt32BE(-1, pos);
            pos += 4;
        } else {
            out.writeInt32BE(elements[i].length, pos);
            pos += 4;
            elements[i].copy(out, pos);
            pos += elements[i].length;
        }
    }
    return out;
}

// ─── Factory: build a Codec<unknown[]> bound to a specific element OID ───────

export function arrayCodec(name: string, oid: number, elementOid: number): Codec<unknown[]> {
    return {
        oid: oid,
        name: name,
        text: {
            decode(buf: Buffer): unknown[] {
                return decodeArrayText(elementOid, buf);
            },
            encode(v: unknown[]): Buffer {
                return encodeArrayText(elementOid, v);
            },
        },
        binary: {
            decode(buf: Buffer): unknown[] {
                return decodeArrayBinary(elementOid, buf);
            },
            encode(v: unknown[]): Buffer {
                return encodeArrayBinary(elementOid, v);
            },
        },
    };
}
