// Client → server message builders. Each function returns a Buffer that
// can be handed directly to `socket.write(...)`. Message shapes follow the
// Postgres wire-protocol v3 spec.

import { writeFrame } from './framing';
import { cstringByteLen, encodeCString } from '../util/cstring';
import {
    FRONTEND_BIND,
    FRONTEND_CLOSE,
    FRONTEND_DESCRIBE,
    FRONTEND_EXECUTE,
    FRONTEND_FLUSH,
    FRONTEND_PARSE,
    FRONTEND_PASSWORD,
    FRONTEND_QUERY,
    FRONTEND_SYNC,
    FRONTEND_TERMINATE,
    CANCEL_REQUEST_CODE,
    PROTOCOL_VERSION,
    SSL_REQUEST_CODE,
} from './messages';

// ─── Typeless frames (sent before / outside the normal message stream) ───────

/**
 * StartupMessage — first message on the connection (after any TLS handshake).
 *
 * Layout: [length][protocol_version: int32][(name\0value\0)*][\0]
 *
 * `params` typically contains `user`, `database`, and optional settings like
 * `application_name` or `client_encoding`.
 */
export function writeStartupMessage(params: Record<string, string>): Buffer {
    const keys = Object.keys(params);

    let paramBytes = 0;
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const v = params[k];
        paramBytes += cstringByteLen(k) + cstringByteLen(v);
    }

    // Layout: length(4) + protocol(4) + params + trailing_null(1).
    const total = 4 + 4 + paramBytes + 1;
    const out = Buffer.alloc(total);
    out.writeInt32BE(total, 0);
    out.writeInt32BE(PROTOCOL_VERSION, 4);

    let pos = 8;
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const v = params[k];
        pos = encodeCString(k, out, pos);
        pos = encodeCString(v, out, pos);
    }
    out.writeUInt8(0, pos); // final null byte terminating the param list
    return out;
}

/**
 * SSLRequest — 8 bytes, sent over plain TCP right after connect.
 * Server responds with 'S' (supports SSL) or 'N' (plain only).
 */
export function writeSSLRequest(): Buffer {
    const out = Buffer.alloc(8);
    out.writeInt32BE(8, 0);
    out.writeInt32BE(SSL_REQUEST_CODE, 4);
    return out;
}

/**
 * CancelRequest — 16 bytes, sent on a *separate* fresh connection.
 * The backend PID and secret key come from BackendKeyData received during
 * the original connection's startup.
 */
export function writeCancelRequest(backendPid: number, secretKey: number): Buffer {
    const out = Buffer.alloc(16);
    out.writeInt32BE(16, 0);
    out.writeInt32BE(CANCEL_REQUEST_CODE, 4);
    out.writeInt32BE(backendPid, 8);
    out.writeInt32BE(secretKey, 12);
    return out;
}

// ─── Simple query protocol ───────────────────────────────────────────────────

/**
 * Query — 'Q' frame carrying a null-terminated SQL string.
 * Server replies with RowDescription / DataRow* / CommandComplete /
 * ReadyForQuery for each semicolon-separated statement.
 */
export function writeQuery(sql: string): Buffer {
    const payload = Buffer.alloc(cstringByteLen(sql));
    encodeCString(sql, payload, 0);
    return writeFrame(FRONTEND_QUERY, payload);
}

// ─── Extended query protocol ─────────────────────────────────────────────────

/**
 * Parse — 'P' statement_name\0 sql\0 n_param_types:int16 (oid:int32)*
 *
 * An empty `name` uses the unnamed prepared statement (the common case for
 * one-shot parameterized queries).
 */
export function writeParse(name: string, sql: string, paramTypeOids: number[]): Buffer {
    const len = cstringByteLen(name) + cstringByteLen(sql) + 2 + paramTypeOids.length * 4;
    const payload = Buffer.alloc(len);
    let pos = encodeCString(name, payload, 0);
    pos = encodeCString(sql, payload, pos);
    payload.writeInt16BE(paramTypeOids.length, pos);
    pos += 2;
    for (let i = 0; i < paramTypeOids.length; i++) {
        payload.writeInt32BE(paramTypeOids[i], pos);
        pos += 4;
    }
    return writeFrame(FRONTEND_PARSE, payload);
}

export interface BindParams {
    /** Empty string = unnamed portal. */
    portalName: string;
    /** Empty string = unnamed prepared statement. */
    stmtName: string;
    /**
     * Format codes for parameter values: 0 = text, 1 = binary.
     *   - length 0 → all parameters are text (default)
     *   - length 1 → the single code applies to every parameter
     *   - length N → per-parameter
     */
    paramFormats: number[];
    /**
     * Parameter values as raw bytes already in the chosen format, or `null`
     * to bind SQL NULL. The caller is responsible for type-specific
     * encoding — use the codecs in `src/types/`.
     */
    paramValues: (Buffer | null)[];
    /**
     * Format codes for each column in the result, same semantics as
     * paramFormats. Tusk typically requests binary (1) for known types
     * and text (0) as a fallback.
     */
    resultFormats: number[];
}

/**
 * Bind — 'B' portal\0 stmt\0 n_fmt:int16 (fmt:int16)* n_vals:int16
 *         (len:int32 val)* n_rfmt:int16 (rfmt:int16)*
 *
 * len = -1 encodes a SQL NULL parameter.
 */
export function writeBind(b: BindParams): Buffer {
    let len = cstringByteLen(b.portalName) + cstringByteLen(b.stmtName);
    len += 2 + b.paramFormats.length * 2;
    len += 2;
    for (let i = 0; i < b.paramValues.length; i++) {
        len += 4; // each value is prefixed with its int32 length
        const v = b.paramValues[i];
        if (v !== null) {
            len += v.length;
        }
    }
    len += 2 + b.resultFormats.length * 2;

    const payload = Buffer.alloc(len);
    let pos = encodeCString(b.portalName, payload, 0);
    pos = encodeCString(b.stmtName, payload, pos);

    payload.writeInt16BE(b.paramFormats.length, pos); pos += 2;
    for (let i = 0; i < b.paramFormats.length; i++) {
        payload.writeInt16BE(b.paramFormats[i], pos); pos += 2;
    }

    payload.writeInt16BE(b.paramValues.length, pos); pos += 2;
    for (let i = 0; i < b.paramValues.length; i++) {
        const v = b.paramValues[i];
        if (v === null) {
            payload.writeInt32BE(-1, pos); pos += 4;
        } else {
            payload.writeInt32BE(v.length, pos); pos += 4;
            v.copy(payload, pos); pos += v.length;
        }
    }

    payload.writeInt16BE(b.resultFormats.length, pos); pos += 2;
    for (let i = 0; i < b.resultFormats.length; i++) {
        payload.writeInt16BE(b.resultFormats[i], pos); pos += 2;
    }

    return writeFrame(FRONTEND_BIND, payload);
}

/**
 * Execute — 'E' portal\0 max_rows:int32
 *
 * `maxRows = 0` means "return every row". Nonzero values enable
 * row-by-row pagination via PortalSuspended.
 */
export function writeExecute(portalName: string, maxRows: number): Buffer {
    const payload = Buffer.alloc(cstringByteLen(portalName) + 4);
    const pos = encodeCString(portalName, payload, 0);
    payload.writeInt32BE(maxRows, pos);
    return writeFrame(FRONTEND_EXECUTE, payload);
}

/**
 * Describe — 'D' kind:u8 name\0
 *   kind = 'S' → describe prepared statement (returns ParameterDescription + RowDescription)
 *   kind = 'P' → describe portal               (returns RowDescription only)
 */
export function writeDescribe(kind: 'S' | 'P', name: string): Buffer {
    const payload = Buffer.alloc(1 + cstringByteLen(name));
    payload.writeUInt8(kind.charCodeAt(0), 0);
    encodeCString(name, payload, 1);
    return writeFrame(FRONTEND_DESCRIBE, payload);
}

/**
 * Close — 'C' kind:u8 name\0
 *   kind = 'S' closes a prepared statement; 'P' closes a portal.
 */
export function writeClose(kind: 'S' | 'P', name: string): Buffer {
    const payload = Buffer.alloc(1 + cstringByteLen(name));
    payload.writeUInt8(kind.charCodeAt(0), 0);
    encodeCString(name, payload, 1);
    return writeFrame(FRONTEND_CLOSE, payload);
}

// ─── Flow-control / lifecycle ────────────────────────────────────────────────

/** Sync — 'S' with no payload. Marks end of an extended-query pipeline;
 *  server replies ReadyForQuery and resets error state. */
export function writeSync(): Buffer {
    return writeFrame(FRONTEND_SYNC, Buffer.alloc(0));
}

/** Flush — 'H' with no payload. Asks server to flush pending output without
 *  ending the current transaction scope (no ReadyForQuery). */
export function writeFlush(): Buffer {
    return writeFrame(FRONTEND_FLUSH, Buffer.alloc(0));
}

/** Terminate — 'X' with no payload. Clean shutdown from the client side. */
export function writeTerminate(): Buffer {
    return writeFrame(FRONTEND_TERMINATE, Buffer.alloc(0));
}

// ─── Authentication continuation ─────────────────────────────────────────────

/**
 * Password — 'p' with payload depending on context:
 *  - AuthCleartextPassword / AuthMD5Password response: null-terminated string
 *  - AuthSASL* response: raw SASL message bytes (not null-terminated)
 *
 * This builder handles the string case (cleartext, md5). SCRAM callers
 * should use `writePasswordRaw` below.
 */
export function writePasswordMessage(password: string): Buffer {
    const payload = Buffer.alloc(cstringByteLen(password));
    encodeCString(password, payload, 0);
    return writeFrame(FRONTEND_PASSWORD, payload);
}

/**
 * Raw 'p' frame with arbitrary payload bytes — used for SASL continuation
 * messages (client_first, client_final), which do NOT get a trailing null.
 */
export function writePasswordRaw(payload: Buffer): Buffer {
    return writeFrame(FRONTEND_PASSWORD, payload);
}
