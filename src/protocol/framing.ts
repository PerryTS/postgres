// Frame-level encoding and decoding. A Postgres message has two shapes:
//
//   Typed frame (every message except Startup/Cancel/SSL/GSS):
//     [type: u8] [length: int32, self-inclusive (= payload.length + 4)] [payload]
//
//   Typeless frame (Startup, Cancel, SSL, GSS):
//     [length: int32, self-inclusive (= total buffer length)] [payload]
//
// This file deals only in bytes. Payload interpretation lives in writer.ts
// (outgoing) and the individual message decoders (incoming).

export interface FrameView {
    /** Single-byte message type (0x51 = 'Q', 0x44 = 'D', …). See messages.ts. */
    type: number;
    /** Message payload, not including the type byte or the length prefix. */
    payload: Buffer;
    /** Total bytes consumed from the source buffer — advance by this much. */
    consumed: number;
}

/**
 * Parse a single typed message frame from `buf` starting at `offset`.
 * Returns null iff the buffer doesn't yet contain a complete frame.
 *
 * The returned `payload` is a view (subarray) into `buf` — copy it if the
 * caller plans to hold it past the next buffer mutation. `MessageReader`
 * does this defensive copy for consumers.
 */
export function parseFrame(buf: Buffer, offset: number): FrameView | null {
    const available = buf.length - offset;
    // Need at least the 1-byte type and the 4-byte length prefix.
    if (available < 5) {
        return null;
    }
    const type = buf.readUInt8(offset);
    const lengthIncludingSelf = buf.readInt32BE(offset + 1);
    if (lengthIncludingSelf < 4) {
        throw new Error(
            'parseFrame: invalid length ' + lengthIncludingSelf + ' (must be >= 4)'
        );
    }
    // Total frame size = 1 (type) + length field value. The length value
    // counts itself but not the type byte.
    const total = 1 + lengthIncludingSelf;
    if (available < total) {
        return null;
    }
    const payload = buf.subarray(offset + 5, offset + total);
    return { type: type, payload: payload, consumed: total };
}

/**
 * Build a typed frame around `payload`.
 * Layout: [type: u8][length: int32 = payload.length + 4][payload].
 */
export function writeFrame(type: number, payload: Buffer): Buffer {
    const out = Buffer.alloc(1 + 4 + payload.length);
    out.writeUInt8(type, 0);
    out.writeInt32BE(4 + payload.length, 1);
    if (payload.length > 0) {
        payload.copy(out, 5);
    }
    return out;
}

/**
 * Build a typeless frame (StartupMessage, CancelRequest, SSLRequest, GSSENCRequest).
 * Layout: [length: int32 = total][payload].
 */
export function writeTypelessFrame(payload: Buffer): Buffer {
    const total = 4 + payload.length;
    const out = Buffer.alloc(total);
    out.writeInt32BE(total, 0);
    if (payload.length > 0) {
        payload.copy(out, 4);
    }
    return out;
}
