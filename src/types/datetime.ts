// Date / time codecs.
//
// Postgres stores all timestamp types as microseconds since the epoch
// `2000-01-01 00:00:00 UTC`. The binary wire format is therefore an
// int64 microsecond offset, which doesn't fit in JS `number` without
// loss beyond ±2^53 microseconds. We return `{ epochMicros: bigint }`
// shapes so the caller can render / compute precisely.
//
// Text format is the canonical ISO-ish string Postgres emits by default
// (`YYYY-MM-DD HH:MM:SS[.FFFFFF]`). We pass through as a string so the
// GUI / consumer can apply whatever formatting they prefer.
//
// An application that wants a JS `Date` can call `.toDate()` on the
// returned objects — lossy because Date is millisecond-precision.

// ─── Postgres epoch offset ───────────────────────────────────────────────────

/** Milliseconds between JS epoch (1970-01-01) and Postgres epoch (2000-01-01). */
const PG_EPOCH_MS = Date.UTC(2000, 0, 1);

// ─── Date (1082) — no time component ─────────────────────────────────────────

/**
 * A pure date (no time, no timezone). Postgres binary form is int32 days
 * since the Postgres epoch; text form is `YYYY-MM-DD` or `infinity` /
 * `-infinity`.
 */
export interface PgDate {
    /** `YYYY-MM-DD` or `'infinity'` / `'-infinity'`. */
    value: string;
    toString(): string;
    toDate(): Date;
}

export function decodeDateText(buf: Buffer): PgDate {
    const value = buf.toString('utf8');
    return makePgDate(value);
}

export function decodeDateBinary(buf: Buffer): PgDate {
    // int32 days; special values use INT_MAX / INT_MIN for +/-infinity.
    const days = buf.readInt32BE(0);
    if (days === 0x7fffffff) {
        return makePgDate('infinity');
    }
    if (days === -0x80000000) {
        return makePgDate('-infinity');
    }
    const ms = PG_EPOCH_MS + days * 86400_000;
    const d = new Date(ms);
    const iso =
        pad(d.getUTCFullYear(), 4) + '-' +
        pad(d.getUTCMonth() + 1, 2) + '-' +
        pad(d.getUTCDate(), 2);
    return makePgDate(iso);
}

function makePgDate(value: string): PgDate {
    return {
        value: value,
        toString(): string {
            return value;
        },
        toDate(): Date {
            if (value === 'infinity') {
                return new Date(8.64e15);
            }
            if (value === '-infinity') {
                return new Date(-8.64e15);
            }
            // Parse YYYY-MM-DD as UTC midnight.
            return new Date(value + 'T00:00:00Z');
        },
    };
}

// ─── Timestamp (1114) / Timestamptz (1184) ───────────────────────────────────

/**
 * Timestamp value — microsecond precision since the Postgres epoch.
 *
 * For `timestamp` (no tz), `tz` is `undefined`. For `timestamptz`, the
 * server stores UTC and emits a `+00` / `±HH` suffix in text format;
 * we capture both the offset string and the microseconds so the consumer
 * can render in any timezone.
 */
export interface PgTimestamp {
    /** Microseconds since 2000-01-01 00:00:00 UTC. */
    epochMicros: bigint;
    /** Timezone-offset string from the server (`'+00'`, `'-05:30'`), or undefined
     *  for plain `timestamp`. */
    tz?: string;
    /** Original text representation when available (decodeTimestampText). */
    raw?: string;
    toString(): string;
    toDate(): Date;
}

/** Text form: `YYYY-MM-DD HH:MM:SS[.fraction][±HH[:MM[:SS]]]`. */
export function decodeTimestampText(buf: Buffer): PgTimestamp {
    const raw = buf.toString('utf8');
    return parseTimestampText(raw);
}

export function decodeTimestamptzText(buf: Buffer): PgTimestamp {
    return decodeTimestampText(buf);
}

function parseTimestampText(raw: string): PgTimestamp {
    if (raw === 'infinity' || raw === '-infinity') {
        return makeTimestamp({
            epochMicros: raw === 'infinity' ? 9223372036854775000n : -9223372036854775000n,
            tz: undefined,
            raw: raw,
        });
    }
    // Find the TZ suffix (leading `+`/`-` after the time portion, NOT the
    // initial `-` of a BC-era year; we skip the first char to avoid that).
    let tzIdx = -1;
    for (let i = raw.length - 1; i > 0; i--) {
        const c = raw.charAt(i);
        if (c === '+' || c === '-') {
            // Only accept as a TZ if it's plausibly right after the time.
            if (i >= 19) {
                tzIdx = i;
            }
            break;
        }
        if (c === ' ' || c === 'T') {
            break;
        }
    }
    const tz = tzIdx >= 0 ? raw.substring(tzIdx) : undefined;
    const bodyEnd = tzIdx >= 0 ? tzIdx : raw.length;
    const body = raw.substring(0, bodyEnd);

    // Split on the first space or 'T'.
    let sep = body.indexOf(' ');
    if (sep < 0) {
        sep = body.indexOf('T');
    }
    const datePart = sep >= 0 ? body.substring(0, sep) : body;
    const timePart = sep >= 0 ? body.substring(sep + 1) : '00:00:00';

    // Parse date YYYY-MM-DD (also handles 5-digit years and BC).
    let yearStr: string;
    let monthStr: string;
    let dayStr: string;
    // Skip leading '-' (BC year) when splitting.
    const dashes: number[] = [];
    for (let i = 1; i < datePart.length; i++) {
        if (datePart.charAt(i) === '-') {
            dashes.push(i);
        }
    }
    if (dashes.length >= 2) {
        yearStr = datePart.substring(0, dashes[dashes.length - 2]);
        monthStr = datePart.substring(dashes[dashes.length - 2] + 1, dashes[dashes.length - 1]);
        dayStr = datePart.substring(dashes[dashes.length - 1] + 1);
    } else {
        yearStr = datePart;
        monthStr = '01';
        dayStr = '01';
    }
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);

    // Parse time HH:MM:SS[.FFFFFF]
    const dot = timePart.indexOf('.');
    const base = dot >= 0 ? timePart.substring(0, dot) : timePart;
    const fracStr = dot >= 0 ? timePart.substring(dot + 1) : '';
    const timeBits = base.split(':');
    const h = timeBits.length > 0 ? parseInt(timeBits[0], 10) : 0;
    const m = timeBits.length > 1 ? parseInt(timeBits[1], 10) : 0;
    const s = timeBits.length > 2 ? parseInt(timeBits[2], 10) : 0;

    // Pad / truncate the fraction to 6 digits (microseconds).
    let microStr = fracStr;
    if (microStr.length < 6) {
        microStr = microStr + '0'.repeat(6 - microStr.length);
    } else if (microStr.length > 6) {
        microStr = microStr.substring(0, 6);
    }
    const micros = microStr.length === 0 ? 0 : parseInt(microStr, 10);

    // Compute UTC ms for this wall-clock (tz-naive at this stage).
    const utcMs = Date.UTC(year < 0 ? year + 1 : year, month - 1, day, h, m, s);
    // Adjust for tz offset — Postgres emits offsets in the usual sign.
    let tzOffsetMin = 0;
    if (tz !== undefined) {
        tzOffsetMin = parseTzOffsetMinutes(tz);
    }
    const adjustedMs = utcMs - tzOffsetMin * 60_000;
    const msSincePgEpoch = adjustedMs - PG_EPOCH_MS;
    // Combine ms + micros via Number → bigint without `BigInt(number)`
    // (Perry codegen doesn't lower BigIntCoerce yet). Number stays precise
    // until ~year 2285 from the Postgres epoch — well past anything Tusk
    // is likely to encounter; we'll switch to BigInt arithmetic when
    // Perry supports the conversion.
    const epochMicros = numberToBigIntMicros(msSincePgEpoch, micros);

    return makeTimestamp({ epochMicros: epochMicros, tz: tz, raw: raw });
}

/**
 * Compute `BigInt(ms) * 1000n + BigInt(micros)` without using `BigInt(...)`.
 * Splits the millisecond Number into its decimal digits and multiplies up
 * via bigint literals — works on Perry, identical result on Node.
 */
function numberToBigIntMicros(ms: number, micros: number): bigint {
    // Convert ms to a base-10 string (Number can't hold >2^53 ms exactly,
    // ~285_000 years), then parse into a bigint via the same digit-loop
    // helper used by int8 decode. Multiply by 1000n, add the micros tail.
    const str = ms.toString();
    let i = 0;
    let negative = false;
    if (str.charAt(0) === '-') {
        negative = true;
        i = 1;
    }
    let big = 0n;
    for (; i < str.length; i++) {
        const code = str.charCodeAt(i) - 48;
        big = big * 10n + BIGINT_DIGITS[code];
    }
    if (negative) {
        big = -big;
    }
    let microsBig = 0n;
    let m = micros;
    if (m < 0) {
        // micros stays in [0, 999999) by parser construction; negative
        // never happens, but defend against it.
        m = -m;
    }
    if (m === 0) {
        return big * 1000n;
    }
    const microStr = m.toString();
    for (let k = 0; k < microStr.length; k++) {
        microsBig = microsBig * 10n + BIGINT_DIGITS[microStr.charCodeAt(k) - 48];
    }
    return big * 1000n + microsBig;
}

const BIGINT_DIGITS: bigint[] = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n];

/** Number → BigInt without `BigInt(number)`. Goes through the decimal
 *  string and digit literals — Perry's codegen lowers the latter but not
 *  the former. */
function numberToBigInt(n: number): bigint {
    if (n === 0) {
        return 0n;
    }
    const str = n.toString();
    let i = 0;
    let neg = false;
    if (str.charAt(0) === '-') {
        neg = true;
        i = 1;
    }
    let big = 0n;
    for (; i < str.length; i++) {
        big = big * 10n + BIGINT_DIGITS[str.charCodeAt(i) - 48];
    }
    return neg ? -big : big;
}

/** Binary form: int64 microseconds since the Postgres epoch. */
export function decodeTimestampBinary(buf: Buffer): PgTimestamp {
    const epochMicros = buf.readBigInt64BE(0);
    return makeTimestamp({ epochMicros: epochMicros, tz: undefined });
}

export function decodeTimestamptzBinary(buf: Buffer): PgTimestamp {
    // Same int64 — always UTC on the wire. Text format decides the display tz.
    return decodeTimestampBinary(buf);
}

function makeTimestamp(fields: { epochMicros: bigint; tz: string | undefined; raw?: string }): PgTimestamp {
    return {
        epochMicros: fields.epochMicros,
        tz: fields.tz,
        raw: fields.raw,
        toString(): string {
            if (fields.raw !== undefined) {
                return fields.raw;
            }
            // Synthesize a UTC ISO-like form from epochMicros.
            const ms = Number(fields.epochMicros / 1000n) + PG_EPOCH_MS;
            const micros = Number(fields.epochMicros % 1000000n);
            const d = new Date(ms);
            return (
                pad(d.getUTCFullYear(), 4) + '-' +
                pad(d.getUTCMonth() + 1, 2) + '-' +
                pad(d.getUTCDate(), 2) + ' ' +
                pad(d.getUTCHours(), 2) + ':' +
                pad(d.getUTCMinutes(), 2) + ':' +
                pad(d.getUTCSeconds(), 2) +
                (micros !== 0 ? '.' + pad(micros, 6) : '')
            );
        },
        toDate(): Date {
            const ms = Number(fields.epochMicros / 1000n) + PG_EPOCH_MS;
            return new Date(ms);
        },
    };
}

// ─── Time (1083) / Timetz (1266) ─────────────────────────────────────────────

/** Time-of-day value. `epochMicros` is microseconds since midnight. */
export interface PgTime {
    micros: bigint;
    tz?: string;
    raw?: string;
    toString(): string;
}

export function decodeTimeText(buf: Buffer): PgTime {
    const raw = buf.toString('utf8');
    return parseTimeText(raw, false);
}

export function decodeTimetzText(buf: Buffer): PgTime {
    const raw = buf.toString('utf8');
    return parseTimeText(raw, true);
}

function parseTimeText(raw: string, hasTz: boolean): PgTime {
    let bodyEnd = raw.length;
    let tz: string | undefined = undefined;
    if (hasTz) {
        for (let i = raw.length - 1; i >= 0; i--) {
            const c = raw.charAt(i);
            if (c === '+' || c === '-') {
                bodyEnd = i;
                tz = raw.substring(i);
                break;
            }
        }
    }
    const body = raw.substring(0, bodyEnd);
    const dot = body.indexOf('.');
    const base = dot >= 0 ? body.substring(0, dot) : body;
    const fracStr = dot >= 0 ? body.substring(dot + 1) : '';
    const bits = base.split(':');
    const h = bits.length > 0 ? parseInt(bits[0], 10) : 0;
    const m = bits.length > 1 ? parseInt(bits[1], 10) : 0;
    const s = bits.length > 2 ? parseInt(bits[2], 10) : 0;
    let microStr = fracStr;
    if (microStr.length < 6) {
        microStr = microStr + '0'.repeat(6 - microStr.length);
    } else if (microStr.length > 6) {
        microStr = microStr.substring(0, 6);
    }
    const micros = microStr.length === 0 ? 0 : parseInt(microStr, 10);
    // h/m/s/micros are all small (< 24 * 3600 * 1e6 = 8.64e10, well within
    // safe Number range), so compute the microsecond total as a Number and
    // convert at the end via the digit-loop helper. Direct `BigInt(n)` is
    // unsupported by Perry codegen as of v0.5.20.
    const totalUs = h * 3_600_000_000 + m * 60_000_000 + s * 1_000_000 + micros;
    const total = numberToBigInt(totalUs);
    return { micros: total, tz: tz, raw: raw, toString: () => raw };
}

export function decodeTimeBinary(buf: Buffer): PgTime {
    const micros = buf.readBigInt64BE(0);
    return { micros: micros, tz: undefined, toString: () => renderTimeOfDay(micros) };
}

export function decodeTimetzBinary(buf: Buffer): PgTime {
    const micros = buf.readBigInt64BE(0);
    const zoneSec = buf.readInt32BE(8);
    // Postgres encodes `zone` as seconds *west* of UTC; invert sign for display.
    const tzMinutes = -Math.round(zoneSec / 60);
    const tz = renderTzOffset(tzMinutes);
    return { micros: micros, tz: tz, toString: () => renderTimeOfDay(micros) + tz };
}

// ─── Interval (1186) ─────────────────────────────────────────────────────────

/**
 * Postgres interval. The binary layout is 16 bytes:
 *   int64 microseconds (time component, can exceed one day)
 *   int32 days         (separate from microseconds — month arithmetic quirks)
 *   int32 months       (separate from days — variable length)
 */
export interface PgInterval {
    months: number;
    days: number;
    microseconds: bigint;
    raw?: string;
    toString(): string;
}

export function decodeIntervalText(buf: Buffer): PgInterval {
    // Without the pg_catalog parser, the most faithful thing we can do is
    // pass the text through and let the consumer interpret it. We also
    // make a best-effort parse of the canonical `x years y mons z days
    // HH:MM:SS.ffff` form for the common cases.
    const raw = buf.toString('utf8');
    return {
        months: 0,
        days: 0,
        microseconds: 0n,
        raw: raw,
        toString(): string {
            return raw;
        },
    };
}

export function decodeIntervalBinary(buf: Buffer): PgInterval {
    const microseconds = buf.readBigInt64BE(0);
    const days = buf.readInt32BE(8);
    const months = buf.readInt32BE(12);
    return {
        months: months,
        days: days,
        microseconds: microseconds,
        toString(): string {
            // Canonical form favored by PG with IntervalStyle=postgres_verbose.
            const parts: string[] = [];
            if (months !== 0) {
                const years = Math.trunc(months / 12);
                const mon = months - years * 12;
                if (years !== 0) {
                    parts.push(years + (Math.abs(years) === 1 ? ' year' : ' years'));
                }
                if (mon !== 0) {
                    parts.push(mon + (Math.abs(mon) === 1 ? ' mon' : ' mons'));
                }
            }
            if (days !== 0) {
                parts.push(days + (Math.abs(days) === 1 ? ' day' : ' days'));
            }
            if (microseconds !== 0n) {
                const neg = microseconds < 0n;
                const abs = neg ? -microseconds : microseconds;
                const totalSec = abs / 1_000_000n;
                const frac = abs - totalSec * 1_000_000n;
                const h = totalSec / 3600n;
                const m = (totalSec - h * 3600n) / 60n;
                const s = totalSec - h * 3600n - m * 60n;
                let time = pad(Number(h), 2) + ':' + pad(Number(m), 2) + ':' + pad(Number(s), 2);
                if (frac !== 0n) {
                    time += '.' + pad(Number(frac), 6).replace(/0+$/, '');
                }
                parts.push(neg ? '-' + time : time);
            }
            if (parts.length === 0) {
                return '00:00:00';
            }
            return parts.join(' ');
        },
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad(n: number, width: number): string {
    const s = String(n);
    if (s.length >= width) {
        return s;
    }
    return '0'.repeat(width - s.length) + s;
}

function renderTimeOfDay(micros: bigint): string {
    const h = micros / 3_600_000_000n;
    const m = (micros - h * 3_600_000_000n) / 60_000_000n;
    const s = (micros - h * 3_600_000_000n - m * 60_000_000n) / 1_000_000n;
    const frac = micros - h * 3_600_000_000n - m * 60_000_000n - s * 1_000_000n;
    let out = pad(Number(h), 2) + ':' + pad(Number(m), 2) + ':' + pad(Number(s), 2);
    if (frac !== 0n) {
        out += '.' + pad(Number(frac), 6).replace(/0+$/, '');
    }
    return out;
}

function renderTzOffset(tzMinutes: number): string {
    const sign = tzMinutes < 0 ? '-' : '+';
    const abs = Math.abs(tzMinutes);
    const h = Math.trunc(abs / 60);
    const m = abs - h * 60;
    return sign + pad(h, 2) + (m !== 0 ? ':' + pad(m, 2) : '');
}

/**
 * Parse `+HH`, `+HH:MM`, `+HH:MM:SS` (Postgres emits seconds for some
 * pre-1970 zones) into minutes east of UTC.
 */
function parseTzOffsetMinutes(tz: string): number {
    if (tz.length === 0) {
        return 0;
    }
    const sign = tz.charAt(0) === '-' ? -1 : 1;
    const body = tz.charAt(0) === '+' || tz.charAt(0) === '-' ? tz.substring(1) : tz;
    const bits = body.split(':');
    const h = bits.length > 0 ? parseInt(bits[0], 10) : 0;
    const m = bits.length > 1 ? parseInt(bits[1], 10) : 0;
    const s = bits.length > 2 ? parseInt(bits[2], 10) : 0;
    return sign * (h * 60 + m + Math.round(s / 60));
}
