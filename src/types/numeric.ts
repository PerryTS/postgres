// Arbitrary-precision decimal wrapper for the Postgres `numeric` type.
//
// The spec requires us to never degrade numeric to `float` (§3.4 of
// tusk-spec.md). JavaScript's built-in `number` is IEEE 754 float and
// can't represent values like 99999999999999.99 losslessly, so we wrap
// the value in a `Decimal` class backed by the canonical decimal string.
//
// For v1, arithmetic operations are deliberately not provided — the
// driver's job is to preserve fidelity end-to-end, not to become a
// math library. Consumers that need arithmetic can convert via `.toString()`
// into any of the standard libraries (decimal.js, bignumber.js, big.js).
// If Tusk (or another consumer) later needs on-the-fly arithmetic we can
// plug in perry-stdlib's `rust_decimal` under the hood without changing
// the public API.

/** Internal sign marker carried in the Postgres binary format. */
const POSITIVE = 0x0000;
const NEGATIVE = 0x4000;
const NAN = 0xc000;
const PINF = 0xd000; // PG 14+
const NINF = 0xf000; // PG 14+

/**
 * Exact decimal value. Immutable. `.toString()` returns the canonical
 * form (e.g. `"-0.000123"`, `"NaN"`, `"Infinity"`, `"-Infinity"`).
 */
export class Decimal {
    private readonly _s: string;

    constructor(s: string) {
        this._s = s;
    }

    toString(): string {
        return this._s;
    }

    toJSON(): string {
        return this._s;
    }

    /** Lossy conversion to a JS number. Opt-in — use it only when you're
     *  certain the value fits. */
    toNumber(): number {
        return Number(this._s);
    }

    /** True iff the value is the special NaN marker. */
    isNaN(): boolean {
        return this._s === 'NaN';
    }

    isFinite(): boolean {
        return this._s !== 'NaN' && this._s !== 'Infinity' && this._s !== '-Infinity';
    }
}

// ─── Text format ─────────────────────────────────────────────────────────────

/** Text format is already the canonical decimal string, with "NaN" / "Infinity"
 *  as possible values. We pass it through unchanged. */
export function decodeNumericText(buf: Buffer): Decimal {
    return new Decimal(buf.toString('utf8'));
}

/** Text encoding is literal. The server accepts any standard decimal
 *  syntax; we emit exactly what's in the Decimal. */
export function encodeNumericText(value: Decimal | string | number | bigint): Buffer {
    if (value instanceof Decimal) {
        return Buffer.from(value.toString(), 'utf8');
    }
    if (typeof value === 'bigint') {
        return Buffer.from(value.toString(), 'utf8');
    }
    return Buffer.from(String(value), 'utf8');
}

// ─── Binary format ───────────────────────────────────────────────────────────

/**
 * Decode the Postgres binary numeric format into a Decimal.
 *
 * Layout:
 *   int16 ndigits   number of base-10000 digits
 *   int16 weight    position of the first digit (power of 10000)
 *   int16 sign      0x0000 +, 0x4000 -, 0xC000 NaN, 0xD000 +∞, 0xF000 -∞
 *   int16 dscale    display scale (digits after decimal point)
 *   int16[] digits  each in [0, 9999]
 *
 * The representation is redundant — `dscale` can ask for more trailing
 * zeros than `digits` provides, or fewer. We emit the canonical decimal
 * string that matches what the server would have produced in text format.
 */
export function decodeNumericBinary(buf: Buffer): Decimal {
    const ndigits = buf.readInt16BE(0);
    const weight = buf.readInt16BE(2);
    const sign = buf.readUInt16BE(4);
    const dscale = buf.readInt16BE(6);

    if (sign === NAN) {
        return new Decimal('NaN');
    }
    if (sign === PINF) {
        return new Decimal('Infinity');
    }
    if (sign === NINF) {
        return new Decimal('-Infinity');
    }

    if (ndigits === 0) {
        // Zero. Emit either "0" or "0.000..." depending on dscale.
        if (dscale === 0) {
            return new Decimal('0');
        }
        return new Decimal('0.' + '0'.repeat(dscale));
    }

    // Render all the base-10000 digits as ascii, then place the decimal point.
    //
    // Each digit represents 4 decimal digits. `weight` says where the
    // first digit sits (weight=0 means first digit is the ones place
    // of a base-10000 representation, i.e., units/thousands).
    const digits: number[] = new Array(ndigits);
    for (let i = 0; i < ndigits; i++) {
        digits[i] = buf.readInt16BE(8 + i * 2);
    }

    // Integer part — digits with weight >= 0.
    let intPart = '';
    if (weight >= 0) {
        intPart = String(digits[0]);
        for (let i = 1; i <= weight; i++) {
            const d = i < ndigits ? digits[i] : 0;
            intPart += pad4(d);
        }
    } else {
        intPart = '0';
    }

    // Fractional part — digits with weight < 0, padded out to dscale.
    let fracPart = '';
    if (dscale > 0) {
        // Collect raw fractional characters.
        let frac = '';
        // Leading zeros from a weight < -1 shift.
        if (weight < -1) {
            frac += '0'.repeat(4 * (-weight - 1));
        }
        const firstFracIdx = weight >= 0 ? weight + 1 : 0;
        for (let i = firstFracIdx; i < ndigits; i++) {
            frac += pad4(digits[i]);
        }
        // Pad or trim to exactly `dscale` chars.
        if (frac.length < dscale) {
            frac += '0'.repeat(dscale - frac.length);
        } else if (frac.length > dscale) {
            frac = frac.substring(0, dscale);
        }
        fracPart = frac;
    }

    let out = fracPart.length > 0 ? intPart + '.' + fracPart : intPart;
    if (sign === NEGATIVE) {
        out = '-' + out;
    }
    return new Decimal(out);
}

/** `  23` → `"0023"` etc. */
function pad4(n: number): string {
    if (n >= 1000) return String(n);
    if (n >= 100) return '0' + String(n);
    if (n >= 10) return '00' + String(n);
    return '000' + String(n);
}

/**
 * Encode a Decimal / bigint / number / string as a Postgres binary numeric.
 * The encoder accepts the canonical string representation and converts
 * to base-10000 digits. `Infinity` / `NaN` are encoded via the sign word.
 */
export function encodeNumericBinary(value: Decimal | string | number | bigint): Buffer {
    const s = value instanceof Decimal ? value.toString() : String(value);

    if (s === 'NaN') {
        return encodeHeader(0, 0, NAN, 0);
    }
    if (s === 'Infinity') {
        return encodeHeader(0, 0, PINF, 0);
    }
    if (s === '-Infinity') {
        return encodeHeader(0, 0, NINF, 0);
    }

    let negative = false;
    let body = s;
    if (body.startsWith('-')) {
        negative = true;
        body = body.substring(1);
    } else if (body.startsWith('+')) {
        body = body.substring(1);
    }

    // Reject exponential notation here — caller should normalize first if
    // they're producing it. Accept only digits + optional dot.
    if (body.indexOf('e') >= 0 || body.indexOf('E') >= 0) {
        throw new Error('encodeNumericBinary: exponential notation not supported — pass canonical decimal string');
    }

    const dot = body.indexOf('.');
    const intStr = (dot < 0 ? body : body.substring(0, dot)).replace(/^0+(?=\d)/, '');
    const fracStrRaw = dot < 0 ? '' : body.substring(dot + 1);
    const dscale = fracStrRaw.length;

    // Strip trailing zeros from the working representation so we don't
    // emit extra digits, but remember the requested dscale for the header.
    let fracStr = fracStrRaw.replace(/0+$/, '');

    // All-zero value → special zero encoding.
    const intIsZero = intStr === '' || /^0+$/.test(intStr);
    if (intIsZero && fracStr === '') {
        return encodeHeader(0, 0, negative ? NEGATIVE : POSITIVE, dscale);
    }

    // Pad integer part to a multiple of 4 on the LEFT so digit groups align.
    const intPad = (4 - (intStr.length % 4)) % 4;
    const intPadded = '0'.repeat(intPad) + intStr;
    // Pad fractional part to a multiple of 4 on the RIGHT.
    const fracPad = (4 - (fracStr.length % 4)) % 4;
    const fracPadded = fracStr + '0'.repeat(fracPad);

    const digits: number[] = [];
    for (let i = 0; i < intPadded.length; i += 4) {
        digits.push(parseInt(intPadded.substring(i, i + 4), 10));
    }
    for (let i = 0; i < fracPadded.length; i += 4) {
        digits.push(parseInt(fracPadded.substring(i, i + 4), 10));
    }
    // Strip leading zero-groups from the integer side; adjust weight.
    let firstNonZero = 0;
    while (firstNonZero < digits.length - 1 && digits[firstNonZero] === 0) {
        firstNonZero++;
    }
    const trimmed = digits.slice(firstNonZero);
    const intGroups = intPadded.length / 4 - firstNonZero;
    const weight = intGroups - 1;

    // Strip trailing zero-groups from the fractional side.
    while (trimmed.length > 0 && trimmed[trimmed.length - 1] === 0 && trimmed.length > intGroups) {
        trimmed.pop();
    }

    const header = encodeHeader(trimmed.length, weight, negative ? NEGATIVE : POSITIVE, dscale);
    const out = Buffer.alloc(header.length + trimmed.length * 2);
    header.copy(out, 0);
    for (let i = 0; i < trimmed.length; i++) {
        out.writeInt16BE(trimmed[i], header.length + i * 2);
    }
    return out;
}

function encodeHeader(ndigits: number, weight: number, sign: number, dscale: number): Buffer {
    const out = Buffer.alloc(8);
    out.writeInt16BE(ndigits, 0);
    out.writeInt16BE(weight, 2);
    out.writeUInt16BE(sign, 4);
    out.writeInt16BE(dscale, 6);
    return out;
}
