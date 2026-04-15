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

// Parallel arrays instead of `Map<number, Codec>`: under Perry, a
// `new Map()` instance backing a module-level `const` ends up
// per-importer rather than singleton — `Map.set` calls from one module
// don't surface in `Map.get` calls from another, while primitive
// module-level state (numbers, plain arrays) does stay shared. So we
// use two parallel arrays and a linear `indexOf` lookup. The registry
// has ~50 entries, so the cost is irrelevant.
// Codec registry. Linear scan over ~50 entries (no Map — Map instances
// from `new Map()` don't reliably round-trip across module boundaries
// under Perry).
//
// KNOWN PERRY LIMITATION: even with module-level arrays, `registerType()`
// calls made from one importer of this file don't surface in `getCodec()`
// calls made from another importer. The Perry AOT compiler currently
// gives every importer its own private copy of any module-level
// declaration (heap objects AND primitives in some cases). On Node/Bun
// this works as expected — the registry is a process-wide singleton.
// On Perry-native, only OIDs whose raw postgres text representation
// matches the codec's decoded form happen to "work" because the
// fallback (`buf.toString('utf8')`) coincides with the right output.
// The proper fix lives in the Perry compiler (canonicalise module
// identity before consulting the module cache).
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
