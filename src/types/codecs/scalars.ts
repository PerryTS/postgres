// Simple scalar codecs: integers, floats, bool, text-family, bytea, uuid,
// json/jsonb. Each type gets text + binary paths where sensible.

import type { Codec } from '../registry';

// ─── Integers ────────────────────────────────────────────────────────────────

/** int2/int4 both fit in a safe JS number. */
function intScalarCodec(name: string, byteWidth: 2 | 4): Codec<number> {
    return {
        oid: 0,
        name: name,
        text: {
            decode(buf: Buffer): number {
                return parseInt(buf.toString('utf8'), 10);
            },
            encode(v: number): Buffer {
                return Buffer.from(String(v), 'utf8');
            },
        },
        binary: {
            decode(buf: Buffer): number {
                if (byteWidth === 2) {
                    return buf.readInt16BE(0);
                }
                return buf.readInt32BE(0);
            },
            encode(v: number): Buffer {
                const out = Buffer.alloc(byteWidth);
                if (byteWidth === 2) {
                    out.writeInt16BE(v, 0);
                } else {
                    out.writeInt32BE(v, 0);
                }
                return out;
            },
        },
    };
}

export const int2Codec = intScalarCodec('int2', 2);
export const int4Codec = intScalarCodec('int4', 4);

/** int8 exceeds safe JS number range — always returned as bigint.
 *
 *  The text-format decoder used to build the bigint by per-digit
 *  arithmetic (`n = n * 10n + DIGIT[code]`) because Perry didn't lower
 *  `BigInt(string)`. Since Perry 0.5.24 (PerryTS/perry#33) the
 *  constructor works on the AOT target too, and a single `BigInt(s)`
 *  call is dramatically faster on every host (one runtime parse vs
 *  ~9–19 separate bigint arithmetic ops per value, plus per-digit
 *  garbage). For a 10000-row × 5-int8-column result that's a measured
 *  >2× speedup on bulk decode. */
export const int8Codec: Codec<bigint> = {
    oid: 20,
    name: 'int8',
    text: {
        decode(buf: Buffer): bigint {
            return BigInt(buf.toString('utf8'));
        },
        encode(v: bigint): Buffer {
            return Buffer.from(v.toString(), 'utf8');
        },
    },
    binary: {
        decode(buf: Buffer): bigint {
            return buf.readBigInt64BE(0);
        },
        encode(v: bigint): Buffer {
            const out = Buffer.alloc(8);
            out.writeBigInt64BE(v, 0);
            return out;
        },
    },
};

// ─── Floats ──────────────────────────────────────────────────────────────────

/** float4 / float8 both safely map to a JS number (float8 IS a double). */
function floatCodec(name: string, byteWidth: 4 | 8): Codec<number> {
    return {
        oid: 0,
        name: name,
        text: {
            decode(buf: Buffer): number {
                const s = buf.toString('utf8');
                if (s === 'NaN') return NaN;
                if (s === 'Infinity') return Infinity;
                if (s === '-Infinity') return -Infinity;
                return parseFloat(s);
            },
            encode(v: number): Buffer {
                if (Number.isNaN(v)) return Buffer.from('NaN', 'utf8');
                if (v === Infinity) return Buffer.from('Infinity', 'utf8');
                if (v === -Infinity) return Buffer.from('-Infinity', 'utf8');
                return Buffer.from(String(v), 'utf8');
            },
        },
        binary: {
            decode(buf: Buffer): number {
                return byteWidth === 4 ? buf.readFloatBE(0) : buf.readDoubleBE(0);
            },
            encode(v: number): Buffer {
                const out = Buffer.alloc(byteWidth);
                if (byteWidth === 4) {
                    out.writeFloatBE(v, 0);
                } else {
                    out.writeDoubleBE(v, 0);
                }
                return out;
            },
        },
    };
}

export const float4Codec = floatCodec('float4', 4);
export const float8Codec = floatCodec('float8', 8);

// ─── Boolean ─────────────────────────────────────────────────────────────────

export const boolCodec: Codec<boolean> = {
    oid: 16,
    name: 'bool',
    text: {
        decode(buf: Buffer): boolean {
            // Server emits 't' / 'f'. Use `readUInt8` not `buf[0]` —
            // Perry doesn't expose Buffer indexed access.
            return buf.length > 0 && buf.readUInt8(0) === 0x74;
        },
        encode(v: boolean): Buffer {
            return Buffer.from(v ? 't' : 'f', 'utf8');
        },
    },
    binary: {
        decode(buf: Buffer): boolean {
            return buf.length > 0 && buf[0] === 1;
        },
        encode(v: boolean): Buffer {
            return Buffer.from([v ? 1 : 0]);
        },
    },
};

// ─── Text family (text, varchar, bpchar, name) ───────────────────────────────

/** All text-family types share the same bytes-in, string-out codec. */
export const textCodec: Codec<string> = {
    oid: 25,
    name: 'text',
    text: {
        decode(buf: Buffer): string {
            return buf.toString('utf8');
        },
        encode(v: string): Buffer {
            return Buffer.from(v, 'utf8');
        },
    },
    binary: {
        decode(buf: Buffer): string {
            return buf.toString('utf8');
        },
        encode(v: string): Buffer {
            return Buffer.from(v, 'utf8');
        },
    },
};

// ─── bytea ───────────────────────────────────────────────────────────────────

export const byteaCodec: Codec<Buffer> = {
    oid: 17,
    name: 'bytea',
    text: {
        decode(buf: Buffer): Buffer {
            // Postgres emits either `\x<hex>` (default since 9.0) or the
            // legacy octal escape form. Support both.
            const s = buf.toString('utf8');
            if (s.startsWith('\\x')) {
                return Buffer.from(s.substring(2), 'hex');
            }
            return decodeByteaEscaped(s);
        },
        encode(v: Buffer): Buffer {
            // Hex form is the simplest and always accepted.
            return Buffer.from('\\x' + v.toString('hex'), 'utf8');
        },
    },
    binary: {
        decode(buf: Buffer): Buffer {
            return Buffer.from(buf);
        },
        encode(v: Buffer): Buffer {
            return Buffer.from(v);
        },
    },
};

function decodeByteaEscaped(s: string): Buffer {
    const out: number[] = [];
    let i = 0;
    while (i < s.length) {
        if (s.charAt(i) === '\\') {
            if (i + 3 < s.length && isOctal(s.charAt(i + 1)) && isOctal(s.charAt(i + 2)) && isOctal(s.charAt(i + 3))) {
                out.push(parseInt(s.substring(i + 1, i + 4), 8));
                i += 4;
                continue;
            }
            if (i + 1 < s.length && s.charAt(i + 1) === '\\') {
                out.push(0x5c);
                i += 2;
                continue;
            }
        }
        out.push(s.charCodeAt(i));
        i += 1;
    }
    return Buffer.from(out);
}

function isOctal(c: string): boolean {
    return c >= '0' && c <= '7';
}

// ─── UUID ────────────────────────────────────────────────────────────────────

export const uuidCodec: Codec<string> = {
    oid: 2950,
    name: 'uuid',
    text: {
        decode(buf: Buffer): string {
            return buf.toString('utf8');
        },
        encode(v: string): Buffer {
            return Buffer.from(v, 'utf8');
        },
    },
    binary: {
        decode(buf: Buffer): string {
            const h = buf.toString('hex');
            return (
                h.substring(0, 8) + '-' +
                h.substring(8, 12) + '-' +
                h.substring(12, 16) + '-' +
                h.substring(16, 20) + '-' +
                h.substring(20, 32)
            );
        },
        encode(v: string): Buffer {
            // Strip dashes, expect 32 hex chars.
            let cleaned = '';
            for (let i = 0; i < v.length; i++) {
                const c = v.charAt(i);
                if (c !== '-') {
                    cleaned += c;
                }
            }
            return Buffer.from(cleaned, 'hex');
        },
    },
};

// ─── JSON / JSONB ────────────────────────────────────────────────────────────

/** `json` — raw UTF-8 text in both formats. We parse into a JS value on
 *  decode so consumers get the usual "just works" shape. */
export const jsonCodec: Codec<unknown> = {
    oid: 114,
    name: 'json',
    text: {
        decode(buf: Buffer): unknown {
            return JSON.parse(buf.toString('utf8'));
        },
        encode(v: unknown): Buffer {
            return Buffer.from(JSON.stringify(v), 'utf8');
        },
    },
    binary: {
        decode(buf: Buffer): unknown {
            return JSON.parse(buf.toString('utf8'));
        },
        encode(v: unknown): Buffer {
            return Buffer.from(JSON.stringify(v), 'utf8');
        },
    },
};

/** `jsonb` — same as json except binary format has a leading version byte
 *  (currently always 0x01). Text format is identical to json. */
export const jsonbCodec: Codec<unknown> = {
    oid: 3802,
    name: 'jsonb',
    text: {
        decode(buf: Buffer): unknown {
            return JSON.parse(buf.toString('utf8'));
        },
        encode(v: unknown): Buffer {
            return Buffer.from(JSON.stringify(v), 'utf8');
        },
    },
    binary: {
        decode(buf: Buffer): unknown {
            if (buf.length === 0 || buf[0] !== 1) {
                throw new Error('jsonb: unexpected version byte');
            }
            return JSON.parse(buf.toString('utf8', 1));
        },
        encode(v: unknown): Buffer {
            const body = Buffer.from(JSON.stringify(v), 'utf8');
            const out = Buffer.alloc(1 + body.length);
            out[0] = 1;
            body.copy(out, 1);
            return out;
        },
    },
};

// ─── Unknown / void ──────────────────────────────────────────────────────────

/** Generic text passthrough — used as a fallback and for explicit unknown types. */
export const rawTextCodec: Codec<string> = {
    oid: 0,
    name: 'raw-text',
    text: {
        decode(buf: Buffer): string {
            return buf.toString('utf8');
        },
        encode(v: string): Buffer {
            return Buffer.from(v, 'utf8');
        },
    },
};
