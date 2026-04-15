// OID → codec registry.
//
// Every column in a RowDescription carries a type OID. Row decoding looks
// up the OID here to pick the right decoder. Unknown OIDs fall back to a
// raw-text codec so the GUI can still display the value (Tusk spec §3.4:
// "Unknown types must round-trip safely as text — the GUI should be able
// to display any column from any table without the driver panicking").

import { FORMAT_BINARY, FORMAT_TEXT } from './oids';

// ─── Codec shape ─────────────────────────────────────────────────────────────

export interface TextCodec<T> {
    decode(buf: Buffer): T;
    encode(value: T): Buffer;
}

export interface BinaryCodec<T> {
    decode(buf: Buffer): T;
    encode(value: T): Buffer;
}

export interface Codec<T = unknown> {
    /** Primary OID this codec covers. Aliases (varchar→text) register separately. */
    oid: number;
    /** Human-readable name for diagnostics. */
    name: string;
    /** Always available — text is the fallback format on the wire. */
    text: TextCodec<T>;
    /** Optional; omit for types that only round-trip via text. */
    binary?: BinaryCodec<T>;
}

// ─── Registry ────────────────────────────────────────────────────────────────

// Codec registry — parallel arrays + linear `indexOf`. ~50 entries, so
// the cost vs `Map<number, Codec>` is irrelevant.
//
// History: this file used to use `new Map()` until the per-importer
// module-instance bug at PerryTS/perry#32 made it unreliable on the
// AOT target (each importer of `registry.ts` got its own copy, so
// `Map.set` from one importer never showed up in `Map.get` from
// another). That's fixed in Perry ≥ 0.5.23, so the Map could come
// back; we keep the arrays because they're simpler, equally fast at
// this size, and don't paper over a real risk if module identity ever
// regresses.
const REGISTRY_OIDS: number[] = [];
const REGISTRY_CODECS: Codec<unknown>[] = [];

/**
 * Register a codec. Multiple OIDs can share a codec (e.g. text / varchar /
 * bpchar all use the text codec); call this once per OID.
 */
export function registerType<T>(oid: number, codec: Codec<T>): void {
    const idx = REGISTRY_OIDS.indexOf(oid);
    if (idx >= 0) {
        REGISTRY_CODECS[idx] = codec as Codec<unknown>;
        return;
    }
    REGISTRY_OIDS.push(oid);
    REGISTRY_CODECS.push(codec as Codec<unknown>);
}

export function getCodec(oid: number): Codec<unknown> | undefined {
    const idx = REGISTRY_OIDS.indexOf(oid);
    if (idx < 0) {
        return undefined;
    }
    return REGISTRY_CODECS[idx];
}

/**
 * Decode a single column value with the codec registered for `oid` in
 * the given wire format. If no codec is registered, fall back to a
 * raw-text decode (the driver never panics on unknown OIDs — that's a
 * spec requirement for Tusk).
 */
export function decodeValue(oid: number, format: number, buf: Buffer): unknown {
    const codec = getCodec(oid);
    if (codec === undefined) {
        return buf.toString('utf8');
    }
    if (format === FORMAT_BINARY) {
        if (codec.binary === undefined) {
            // Codec doesn't support binary — this only happens if the
            // caller explicitly requested binary result format for a
            // text-only type. Surface as hex so the caller sees the raw bytes.
            return buf.toString('hex');
        }
        return codec.binary.decode(buf);
    }
    return codec.text.decode(buf);
}

/**
 * OIDs whose `'rich'`-mode decoder allocates a per-cell wrapper that
 * `'minimal'` mode skips in favour of the raw Postgres text. Defining
 * the set here (instead of inline in `pickDecoder`) keeps the choice
 * easy to audit and easy to extend (e.g. arrays of these types).
 *
 * Heuristic: include any OID where the rich-mode decode allocates a
 * `bigint`, `Decimal`, or `PgDate`/`PgTime`/`PgTimestamp`/`PgInterval`
 * wrapper. Skip int2/int4/float (cheap primitives), text-family
 * (already strings), bool (primitive), bytea (raw bytes are the
 * typical consumer shape), uuid (canonical string), json/jsonb
 * (parsed values are the typical consumer shape).
 */
import * as O from './oids';
const MINIMAL_TEXT_OIDS = new Set<number>([
    O.OID_INT8,
    O.OID_NUMERIC,
    O.OID_DATE, O.OID_TIME, O.OID_TIMETZ,
    O.OID_TIMESTAMP, O.OID_TIMESTAMPTZ,
    O.OID_INTERVAL,
]);

/**
 * Resolve once and return a `(buf) => unknown` thunk specialised for a
 * single (oid, format) pair. Hot path callers (the row decoder in
 * connection.ts) call `pickDecoder` once per result column at the top
 * of `buildQueryResult` so the per-cell loop is just a function
 * invocation instead of a registry lookup + format branch + fallback
 * check on every cell.
 *
 * Format and codec are baked into the returned closure. The unknown-OID
 * raw-text fallback and the binary-without-binary-codec fallback both
 * resolve at construction, not per cell.
 *
 * `minimal` (default false): if true, OIDs in `MINIMAL_TEXT_OIDS` skip
 * their wrapper allocation and return the raw Postgres text instead —
 * matches `node-postgres`'s default behaviour. Halves bulk-decode wall
 * time on result sets dominated by int8 / numeric / date-family
 * columns; the trade is the consumer has to parse / interpret the
 * value themselves.
 */
export function pickDecoder(
    oid: number,
    format: number,
    minimal: boolean = false
): (buf: Buffer) => unknown {
    if (minimal && format !== FORMAT_BINARY && MINIMAL_TEXT_OIDS.has(oid)) {
        return decodeAsUtf8;
    }
    const codec = getCodec(oid);
    if (codec === undefined) {
        return decodeAsUtf8;
    }
    if (format === FORMAT_BINARY) {
        if (codec.binary === undefined) {
            return decodeAsHex;
        }
        const dec = codec.binary.decode;
        return (b: Buffer): unknown => dec(b);
    }
    const dec = codec.text.decode;
    return (b: Buffer): unknown => dec(b);
}

function decodeAsUtf8(b: Buffer): string {
    return b.toString('utf8');
}
function decodeAsHex(b: Buffer): string {
    return b.toString('hex');
}

/**
 * Encode a parameter value for a given OID in the given format. Returns
 * the bytes to put in a Bind message's value slot. Throws if the OID has
 * no codec — caller should route unknown types through `encodeUnknown`
 * (text formatting via toString).
 */
export function encodeValue(oid: number, format: number, value: unknown): Buffer {
    const codec = getCodec(oid);
    if (codec === undefined) {
        if (format === FORMAT_TEXT) {
            return Buffer.from(String(value), 'utf8');
        }
        throw new Error('encodeValue: no codec registered for OID ' + oid);
    }
    if (format === FORMAT_BINARY) {
        if (codec.binary === undefined) {
            throw new Error(
                'encodeValue: codec for ' + codec.name + ' (OID ' + oid + ') has no binary encoder'
            );
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return codec.binary.encode(value as any);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return codec.text.encode(value as any);
}

/** True iff the given OID has a binary codec registered. */
export function hasBinaryCodec(oid: number): boolean {
    const codec = getCodec(oid);
    return codec !== undefined && codec.binary !== undefined;
}
