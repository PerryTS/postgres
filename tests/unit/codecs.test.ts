// Unit tests for the type codec registry + every built-in codec.
// Run in isolation via `bun test tests/unit/codecs.test.ts`.

import { test, expect } from 'bun:test';
import {
    Decimal,
    decodeValue,
    encodeValue,
    getCodec,
    hasBinaryCodec,
    FORMAT_BINARY,
    FORMAT_TEXT,
    OID_BOOL,
    OID_BYTEA,
    OID_DATE,
    OID_FLOAT4,
    OID_FLOAT8,
    OID_INT2,
    OID_INT4,
    OID_INT8,
    OID_INT4_ARRAY,
    OID_INTERVAL,
    OID_JSON,
    OID_JSONB,
    OID_NUMERIC,
    OID_TEXT,
    OID_TEXT_ARRAY,
    OID_TIME,
    OID_TIMESTAMP,
    OID_TIMESTAMPTZ,
    OID_UUID,
    OID_VARCHAR,
} from '../../src';

// ─── Registry fallback ──────────────────────────────────────────────────────

test('decodeValue falls back to utf-8 text for unknown OIDs (spec §3.4)', () => {
    expect(decodeValue(999999, FORMAT_TEXT, Buffer.from('hello', 'utf8'))).toBe('hello');
});

test('hasBinaryCodec is false for text-only / non-registered types', () => {
    expect(hasBinaryCodec(999999)).toBe(false);
    expect(hasBinaryCodec(OID_INT4)).toBe(true);
});

// ─── Integers ───────────────────────────────────────────────────────────────

test('int2/4 codecs round-trip in both formats', () => {
    for (const oid of [OID_INT2, OID_INT4]) {
        const v = oid === OID_INT2 ? 32000 : 2_000_000_000;
        const t = encodeValue(oid, FORMAT_TEXT, v);
        expect(decodeValue(oid, FORMAT_TEXT, t)).toBe(v);
        const b = encodeValue(oid, FORMAT_BINARY, v);
        expect(decodeValue(oid, FORMAT_BINARY, b)).toBe(v);
    }
});

test('int8 round-trips as bigint (larger than Number.MAX_SAFE_INTEGER)', () => {
    const v = 9_223_372_036_854_775_000n;
    const t = encodeValue(OID_INT8, FORMAT_TEXT, v);
    expect(decodeValue(OID_INT8, FORMAT_TEXT, t)).toBe(v);
    const b = encodeValue(OID_INT8, FORMAT_BINARY, v);
    expect(decodeValue(OID_INT8, FORMAT_BINARY, b)).toBe(v);
});

// ─── Floats ─────────────────────────────────────────────────────────────────

test('float4/8 handle NaN, Infinity, -Infinity, normal values', () => {
    for (const oid of [OID_FLOAT4, OID_FLOAT8]) {
        const normal = oid === OID_FLOAT4 ? 1.5 : 1.23456789e-30;
        expect(decodeValue(oid, FORMAT_TEXT, encodeValue(oid, FORMAT_TEXT, normal))).toBeCloseTo(normal);
        expect(decodeValue(oid, FORMAT_BINARY, encodeValue(oid, FORMAT_BINARY, normal))).toBeCloseTo(normal);
        expect(decodeValue(oid, FORMAT_TEXT, Buffer.from('NaN', 'utf8'))).toBeNaN();
        expect(decodeValue(oid, FORMAT_TEXT, Buffer.from('Infinity', 'utf8'))).toBe(Infinity);
        expect(decodeValue(oid, FORMAT_TEXT, Buffer.from('-Infinity', 'utf8'))).toBe(-Infinity);
    }
});

// ─── Boolean ────────────────────────────────────────────────────────────────

test('bool decodes t/f text and 0/1 binary', () => {
    expect(decodeValue(OID_BOOL, FORMAT_TEXT, Buffer.from('t', 'utf8'))).toBe(true);
    expect(decodeValue(OID_BOOL, FORMAT_TEXT, Buffer.from('f', 'utf8'))).toBe(false);
    expect(decodeValue(OID_BOOL, FORMAT_BINARY, Buffer.from([1]))).toBe(true);
    expect(decodeValue(OID_BOOL, FORMAT_BINARY, Buffer.from([0]))).toBe(false);
    expect(encodeValue(OID_BOOL, FORMAT_TEXT, true).toString('utf8')).toBe('t');
    expect(encodeValue(OID_BOOL, FORMAT_BINARY, false)[0]).toBe(0);
});

// ─── Text family ────────────────────────────────────────────────────────────

test('text / varchar are byte-identical', () => {
    const v = 'héllo — τέλος';
    for (const oid of [OID_TEXT, OID_VARCHAR]) {
        expect(decodeValue(oid, FORMAT_TEXT, encodeValue(oid, FORMAT_TEXT, v))).toBe(v);
        expect(decodeValue(oid, FORMAT_BINARY, encodeValue(oid, FORMAT_BINARY, v))).toBe(v);
    }
});

// ─── bytea ──────────────────────────────────────────────────────────────────

test('bytea round-trips binary + hex text + octal-escaped legacy text', () => {
    const raw = Buffer.from([0, 1, 2, 0x5c, 0xff, 0x7e]);
    // Binary round-trip
    const roundBin = decodeValue(OID_BYTEA, FORMAT_BINARY, encodeValue(OID_BYTEA, FORMAT_BINARY, raw)) as Buffer;
    expect(roundBin.equals(raw)).toBe(true);
    // Hex text form ("\x...")
    const hexText = encodeValue(OID_BYTEA, FORMAT_TEXT, raw);
    expect(hexText.toString('utf8').startsWith('\\x')).toBe(true);
    const hexDecoded = decodeValue(OID_BYTEA, FORMAT_TEXT, hexText) as Buffer;
    expect(hexDecoded.equals(raw)).toBe(true);
    // Legacy octal-escaped text form (what older pg_dumps emit).
    const legacy = Buffer.from('\\000\\001\\002\\\\\\377~', 'utf8');
    const legacyDecoded = decodeValue(OID_BYTEA, FORMAT_TEXT, legacy) as Buffer;
    expect(legacyDecoded.equals(raw)).toBe(true);
});

// ─── UUID ───────────────────────────────────────────────────────────────────

test('uuid text/binary formats produce identical canonical strings', () => {
    const canonical = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    expect(decodeValue(OID_UUID, FORMAT_TEXT, Buffer.from(canonical, 'utf8'))).toBe(canonical);
    const binary = Buffer.from(canonical.replace(/-/g, ''), 'hex');
    expect(decodeValue(OID_UUID, FORMAT_BINARY, binary)).toBe(canonical);
});

// ─── JSON / JSONB ───────────────────────────────────────────────────────────

test('json round-trips and parses into JS values', () => {
    const v = { hello: [1, 2, 3], world: null, deep: { x: 1.5 } };
    for (const oid of [OID_JSON, OID_JSONB]) {
        const t = encodeValue(oid, FORMAT_TEXT, v);
        expect(decodeValue(oid, FORMAT_TEXT, t)).toEqual(v);
        const b = encodeValue(oid, FORMAT_BINARY, v);
        expect(decodeValue(oid, FORMAT_BINARY, b)).toEqual(v);
    }
});

test('jsonb binary format carries the mandatory version byte 0x01', () => {
    const b = encodeValue(OID_JSONB, FORMAT_BINARY, { a: 1 });
    expect(b[0]).toBe(1);
});

// ─── Numeric ────────────────────────────────────────────────────────────────

test('Decimal preserves precision that Number would lose', () => {
    const lossyAsNumber = '99999999999999.99';
    const dec = new Decimal(lossyAsNumber);
    expect(dec.toString()).toBe(lossyAsNumber);
    expect(Number(dec.toString())).not.toBe(Number(lossyAsNumber) + 0.01); // still-lossy sanity
});

test('numeric text format is passthrough', () => {
    const s = '-12345.6789';
    const d = decodeValue(OID_NUMERIC, FORMAT_TEXT, Buffer.from(s, 'utf8'));
    expect(d).toBeInstanceOf(Decimal);
    expect(d!.toString()).toBe(s);
});

test('numeric binary round-trips including precision, sign, zero, NaN, ±Infinity', () => {
    const cases = [
        '0', '1', '-1', '1234567890', '-1234567890',
        '0.1', '0.00001', '-0.00001',
        '12345.6789', '-12345.6789',
        '12345678901234567890.1234567890',
        '-99999999999999.99',
        'NaN', 'Infinity', '-Infinity',
    ];
    for (const s of cases) {
        const buf = encodeValue(OID_NUMERIC, FORMAT_BINARY, new Decimal(s));
        const back = decodeValue(OID_NUMERIC, FORMAT_BINARY, buf) as Decimal;
        expect(back.toString()).toBe(s);
    }
});

test('numeric binary decode handles the canonical server byte layout', () => {
    // Hand-crafted bytes for 1234.5 — 1 digit "1234" (weight 0) + 1 digit
    // "5000" (weight -1, dscale=1 so emit first digit of fraction).
    // Layout: ndigits=2, weight=0, sign=+, dscale=1, [1234, 5000].
    const buf = Buffer.alloc(12);
    buf.writeInt16BE(2, 0);
    buf.writeInt16BE(0, 2);
    buf.writeUInt16BE(0x0000, 4);
    buf.writeInt16BE(1, 6);
    buf.writeInt16BE(1234, 8);
    buf.writeInt16BE(5000, 10);
    const d = decodeValue(OID_NUMERIC, FORMAT_BINARY, buf) as Decimal;
    expect(d.toString()).toBe('1234.5');
});

// ─── Date / Time ────────────────────────────────────────────────────────────

test('date binary decodes int32 days since PG epoch', () => {
    // Postgres epoch = 2000-01-01. 31 days later = 2000-02-01.
    const buf = Buffer.alloc(4);
    buf.writeInt32BE(31, 0);
    const d = decodeValue(OID_DATE, FORMAT_BINARY, buf) as { toString(): string };
    expect(d.toString()).toBe('2000-02-01');
});

test('date text decodes YYYY-MM-DD and recognizes ±infinity', () => {
    const d = decodeValue(OID_DATE, FORMAT_TEXT, Buffer.from('2024-06-15', 'utf8')) as { toString(): string };
    expect(d.toString()).toBe('2024-06-15');
    const inf = decodeValue(OID_DATE, FORMAT_TEXT, Buffer.from('infinity', 'utf8')) as { toString(): string };
    expect(inf.toString()).toBe('infinity');
});

test('timestamp binary decodes int64 microseconds since PG epoch', () => {
    const oneDay = 86_400_000_000n;
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(oneDay, 0);
    const t = decodeValue(OID_TIMESTAMP, FORMAT_BINARY, buf) as {
        epochMicros: bigint;
        toString(): string;
    };
    expect(t.epochMicros).toBe(oneDay);
});

test('timestamptz text keeps the tz suffix as raw for the consumer to render', () => {
    const raw = '2024-06-15 12:34:56.789012+02';
    const t = decodeValue(OID_TIMESTAMPTZ, FORMAT_TEXT, Buffer.from(raw, 'utf8')) as {
        tz?: string;
        raw?: string;
    };
    expect(t.tz).toBe('+02');
    expect(t.raw).toBe(raw);
});

test('time binary decodes microseconds since midnight', () => {
    const micros = (12n * 3600n + 34n * 60n + 56n) * 1_000_000n + 500_000n;
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(micros, 0);
    const t = decodeValue(OID_TIME, FORMAT_BINARY, buf) as { micros: bigint; toString(): string };
    expect(t.micros).toBe(micros);
    expect(t.toString()).toBe('12:34:56.5');
});

test('interval binary decodes month/day/micros fields', () => {
    // 1 year 2 mons 3 days 04:05:06.000007
    const buf = Buffer.alloc(16);
    const micros = (4n * 3600n + 5n * 60n + 6n) * 1_000_000n + 7n;
    buf.writeBigInt64BE(micros, 0);
    buf.writeInt32BE(3, 8);
    buf.writeInt32BE(14, 12);
    const iv = decodeValue(OID_INTERVAL, FORMAT_BINARY, buf) as {
        months: number;
        days: number;
        microseconds: bigint;
        toString(): string;
    };
    expect(iv.months).toBe(14);
    expect(iv.days).toBe(3);
    expect(iv.microseconds).toBe(micros);
    expect(iv.toString()).toContain('1 year 2 mons 3 days');
});

// ─── Arrays ─────────────────────────────────────────────────────────────────

test('int4 array text decode handles the canonical {1,2,3} form with NULLs', () => {
    const v = decodeValue(OID_INT4_ARRAY, FORMAT_TEXT, Buffer.from('{1,2,NULL,4}', 'utf8')) as unknown[];
    expect(v).toEqual([1, 2, null, 4]);
});

test('text array decode handles quoting and escapes', () => {
    const payload = Buffer.from('{"hello, world","a\\\\b","NULL",NULL,unquoted}', 'utf8');
    const v = decodeValue(OID_TEXT_ARRAY, FORMAT_TEXT, payload) as unknown[];
    expect(v).toEqual(['hello, world', 'a\\b', 'NULL', null, 'unquoted']);
});

test('int4 array binary round-trips', () => {
    const values = [1, 2, null, 4];
    const enc = encodeValue(OID_INT4_ARRAY, FORMAT_BINARY, values);
    const dec = decodeValue(OID_INT4_ARRAY, FORMAT_BINARY, enc) as unknown[];
    expect(dec).toEqual(values);
});

test('text array encode quotes commas, braces, and empty strings', () => {
    const enc = encodeValue(OID_TEXT_ARRAY, FORMAT_TEXT, ['a,b', '', 'ok', null, '{x}']);
    expect(enc.toString('utf8')).toBe('{"a,b","",ok,NULL,"{x}"}');
});

// ─── Registry surface ───────────────────────────────────────────────────────

test('getCodec returns the codec for every registered OID', () => {
    for (const oid of [OID_INT4, OID_NUMERIC, OID_TEXT, OID_BYTEA, OID_TIMESTAMPTZ, OID_INT4_ARRAY]) {
        expect(getCodec(oid)).not.toBeUndefined();
    }
});

// ─── pickDecoder + parseTypes: 'minimal' ────────────────────────────────────

import { pickDecoder } from '../../src/types/registry';

test("pickDecoder rich mode wraps int8 / numeric / date types", () => {
    expect(pickDecoder(OID_INT8, FORMAT_TEXT)(Buffer.from('123', 'utf8'))).toBe(123n);
    const num = pickDecoder(OID_NUMERIC, FORMAT_TEXT)(Buffer.from('1.5', 'utf8')) as Decimal;
    expect(num.toString()).toBe('1.5');
    expect(typeof pickDecoder(OID_DATE, FORMAT_TEXT)(Buffer.from('2024-01-15', 'utf8'))).toBe('object');
});

test("pickDecoder minimal mode returns raw text for int8 / numeric / date", () => {
    expect(pickDecoder(OID_INT8, FORMAT_TEXT, true)(Buffer.from('123', 'utf8'))).toBe('123');
    expect(pickDecoder(OID_NUMERIC, FORMAT_TEXT, true)(Buffer.from('1.5', 'utf8'))).toBe('1.5');
    expect(pickDecoder(OID_DATE, FORMAT_TEXT, true)(Buffer.from('2024-01-15', 'utf8'))).toBe('2024-01-15');
    expect(pickDecoder(OID_INTERVAL, FORMAT_TEXT, true)(Buffer.from('1 day', 'utf8'))).toBe('1 day');
});

test("pickDecoder minimal does NOT affect text / bool / int4 / json / arrays", () => {
    expect(pickDecoder(OID_INT4, FORMAT_TEXT, true)(Buffer.from('42', 'utf8'))).toBe(42);
    expect(pickDecoder(OID_BOOL, FORMAT_TEXT, true)(Buffer.from('t', 'utf8'))).toBe(true);
    expect(pickDecoder(OID_TEXT, FORMAT_TEXT, true)(Buffer.from('hi', 'utf8'))).toBe('hi');
    expect(pickDecoder(OID_JSON, FORMAT_TEXT, true)(Buffer.from('{"a":1}', 'utf8'))).toEqual({ a: 1 });
});

test("pickDecoder minimal is ignored in binary format (binary already parsed)", () => {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(42n);
    expect(pickDecoder(OID_INT8, FORMAT_BINARY, true)(buf)).toBe(42n);
});
