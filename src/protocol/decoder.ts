// Server → client message decoders. Each function takes the raw payload
// from a parsed frame (see framing.ts) and returns a structured value.
//
// ErrorResponse / NoticeResponse decoding lives in ../error.ts because
// those field structures are public surface.

import { BufferCursor } from '../util/buffer-cursor';

// ─── RowDescription ('T') ────────────────────────────────────────────────────

export interface FieldDescription {
    /** Column name from the query (aliased or real). */
    name: string;
    /** Object ID of the source table, or 0 if the column is computed. */
    tableOid: number;
    /** 1-based column attnum in the source table, or 0 if computed. */
    columnAttrNum: number;
    /** OID of the column's data type. */
    typeOid: number;
    /** Data type size in bytes (negative for variable-width types). */
    typeSize: number;
    /** Type modifier (e.g. `numeric(10,2)` → packed precision+scale). */
    typeModifier: number;
    /** 0 = text format, 1 = binary format. */
    formatCode: number;
}

export function decodeRowDescription(payload: Buffer): FieldDescription[] {
    const cur = new BufferCursor(payload, 0);
    const count = cur.readInt16BE();
    const fields: FieldDescription[] = [];
    for (let i = 0; i < count; i++) {
        const name = cur.readCString();
        const tableOid = cur.readInt32BE();
        const columnAttrNum = cur.readInt16BE();
        const typeOid = cur.readInt32BE();
        const typeSize = cur.readInt16BE();
        const typeModifier = cur.readInt32BE();
        const formatCode = cur.readInt16BE();
        fields.push({
            name: name,
            tableOid: tableOid,
            columnAttrNum: columnAttrNum,
            typeOid: typeOid,
            typeSize: typeSize,
            typeModifier: typeModifier,
            formatCode: formatCode,
        });
    }
    return fields;
}

// ─── DataRow ('D') ───────────────────────────────────────────────────────────

/** A single row. Each column is either its raw bytes or `null` for SQL NULL. */
export type RawRow = (Buffer | null)[];

export function decodeDataRow(payload: Buffer): RawRow {
    const cur = new BufferCursor(payload, 0);
    const count = cur.readInt16BE();
    const row: RawRow = new Array<Buffer | null>(count);
    for (let i = 0; i < count; i++) {
        const len = cur.readInt32BE();
        if (len === -1) {
            row[i] = null;
        } else {
            row[i] = cur.readBytes(len);
        }
    }
    return row;
}

// ─── CommandComplete ('C') ───────────────────────────────────────────────────

export interface CommandCompleteTag {
    /** The raw command tag string: "SELECT 5", "INSERT 0 3", "UPDATE 7", … */
    tag: string;
    /** Rows affected, parsed out of the tag where applicable. 0 if unknown. */
    rowCount: number;
}

export function decodeCommandComplete(payload: Buffer): CommandCompleteTag {
    const cur = new BufferCursor(payload, 0);
    const tag = cur.readCString();
    const rowCount = parseRowCountFromTag(tag);
    return { tag: tag, rowCount: rowCount };
}

/**
 * Extract the row-count suffix from a command tag.
 *   "SELECT 5"     → 5
 *   "INSERT 0 3"   → 3   (first number is legacy oid, not a count)
 *   "UPDATE 2"     → 2
 *   "DELETE 0"     → 0
 *   "BEGIN"        → 0   (no count at all)
 */
function parseRowCountFromTag(tag: string): number {
    let i = tag.length - 1;
    // Walk back over trailing digits.
    let end = i;
    while (end >= 0 && tag.charCodeAt(end) >= 48 && tag.charCodeAt(end) <= 57) {
        end--;
    }
    if (end === tag.length - 1) {
        return 0; // no trailing number
    }
    const numStr = tag.substring(end + 1);
    const n = parseInt(numStr, 10);
    if (isNaN(n)) {
        return 0;
    }
    // Let unused var suppress.
    const _ = i;
    return n;
}

// ─── ReadyForQuery ('Z') ─────────────────────────────────────────────────────

export type TxnStatus = 'idle' | 'in-transaction' | 'in-failed-transaction';

export function decodeReadyForQuery(payload: Buffer): TxnStatus {
    const cur = new BufferCursor(payload, 0);
    const byte = cur.readUInt8();
    if (byte === 0x49) {
        return 'idle';
    }
    if (byte === 0x54) {
        return 'in-transaction';
    }
    if (byte === 0x45) {
        return 'in-failed-transaction';
    }
    throw new Error('decodeReadyForQuery: unknown status byte ' + byte);
}

// ─── ParameterStatus ('S') ───────────────────────────────────────────────────

export interface ParameterStatus {
    name: string;
    value: string;
}

export function decodeParameterStatus(payload: Buffer): ParameterStatus {
    const cur = new BufferCursor(payload, 0);
    const name = cur.readCString();
    const value = cur.readCString();
    return { name: name, value: value };
}

// ─── BackendKeyData ('K') ────────────────────────────────────────────────────

export interface BackendKeyData {
    pid: number;
    secretKey: number;
}

export function decodeBackendKeyData(payload: Buffer): BackendKeyData {
    const cur = new BufferCursor(payload, 0);
    const pid = cur.readInt32BE();
    const secretKey = cur.readInt32BE();
    return { pid: pid, secretKey: secretKey };
}

// ─── Authentication ('R') ────────────────────────────────────────────────────

export type AuthenticationRequest =
    | { kind: 'ok' }
    | { kind: 'cleartext-password' }
    | { kind: 'md5-password'; salt: Buffer }
    | { kind: 'sasl'; mechanisms: string[] }
    | { kind: 'sasl-continue'; data: Buffer }
    | { kind: 'sasl-final'; data: Buffer }
    | { kind: 'kerberos-v5' }       // not supported; surfaces as error in Connection
    | { kind: 'gss' }                // deferred
    | { kind: 'sspi' }               // deferred
    | { kind: 'unknown'; subtype: number };

export function decodeAuthentication(payload: Buffer): AuthenticationRequest {
    const cur = new BufferCursor(payload, 0);
    const subtype = cur.readInt32BE();
    if (subtype === 0) {
        return { kind: 'ok' };
    }
    if (subtype === 2) {
        return { kind: 'kerberos-v5' };
    }
    if (subtype === 3) {
        return { kind: 'cleartext-password' };
    }
    if (subtype === 5) {
        const salt = cur.readBytes(4);
        return { kind: 'md5-password', salt: salt };
    }
    if (subtype === 7) {
        return { kind: 'gss' };
    }
    if (subtype === 9) {
        return { kind: 'sspi' };
    }
    if (subtype === 10) {
        // SASL — payload continues with zero or more cstring mechanism names
        // terminated by an empty cstring.
        const mechanisms: string[] = [];
        while (true) {
            const m = cur.readCString();
            if (m.length === 0) {
                break;
            }
            mechanisms.push(m);
        }
        return { kind: 'sasl', mechanisms: mechanisms };
    }
    if (subtype === 11) {
        const data = cur.readBytes(cur.remaining());
        return { kind: 'sasl-continue', data: data };
    }
    if (subtype === 12) {
        const data = cur.readBytes(cur.remaining());
        return { kind: 'sasl-final', data: data };
    }
    return { kind: 'unknown', subtype: subtype };
}

// ─── NotificationResponse ('A') — LISTEN/NOTIFY ──────────────────────────────

export interface Notification {
    pid: number;
    channel: string;
    payload: string;
}

export function decodeNotification(payload: Buffer): Notification {
    const cur = new BufferCursor(payload, 0);
    const pid = cur.readInt32BE();
    const channel = cur.readCString();
    const payloadStr = cur.readCString();
    return { pid: pid, channel: channel, payload: payloadStr };
}
