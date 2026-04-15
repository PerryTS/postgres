// Null-terminated UTF-8 strings — the Postgres wire format for all
// textual fields in StartupMessage, Query, Parse, Error field values, etc.

/**
 * Byte length of the null-terminated UTF-8 encoding of `s`,
 * including the trailing null byte.
 *
 * Uses `Buffer.from(...).length` rather than `Buffer.byteLength(...)`
 * because Perry's codegen doesn't yet lower the latter (no `BufferByteLength`
 * expression). Allocates a temporary buffer; profile if this becomes hot.
 */
export function cstringByteLen(s: string): number {
    return Buffer.from(s, 'utf8').length + 1;
}

/**
 * Write `s` as a null-terminated UTF-8 string starting at `offset` in `buf`.
 * Returns the offset just past the null byte.
 */
export function encodeCString(s: string, buf: Buffer, offset: number): number {
    const written = buf.write(s, offset, 'utf8');
    buf.writeUInt8(0, offset + written);
    return offset + written + 1;
}

/**
 * Read a null-terminated UTF-8 string starting at `offset` in `buf`.
 * Returns the decoded string and the offset just past the null byte.
 * Throws if no null byte is found within the buffer.
 */
export function decodeCString(buf: Buffer, offset: number): { value: string; next: number } {
    // Use readUInt8 instead of `buf[end]`: Perry's native codegen doesn't
    // lower Buffer bracket indexing; it reads as undefined, the comparison
    // is always truthy, and the scan walks off the end.
    let end = offset;
    while (end < buf.length && buf.readUInt8(end) !== 0) {
        end++;
    }
    if (end >= buf.length) {
        throw new Error('decodeCString: no null terminator');
    }
    const value = buf.toString('utf8', offset, end);
    return { value: value, next: end + 1 };
}
