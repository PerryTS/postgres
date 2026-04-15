// Sequential reader over a Buffer, tracking position. Used by message
// decoders (RowDescription, DataRow, ErrorResponse, …) that walk a
// payload field by field.

export class BufferCursor {
    public pos: number;
    public readonly buf: Buffer;

    constructor(buf: Buffer, startPos: number = 0) {
        this.buf = buf;
        this.pos = startPos;
    }

    readUInt8(): number {
        const v = this.buf.readUInt8(this.pos);
        this.pos += 1;
        return v;
    }

    readInt16BE(): number {
        const v = this.buf.readInt16BE(this.pos);
        this.pos += 2;
        return v;
    }

    readInt32BE(): number {
        const v = this.buf.readInt32BE(this.pos);
        this.pos += 4;
        return v;
    }

    readUInt32BE(): number {
        const v = this.buf.readUInt32BE(this.pos);
        this.pos += 4;
        return v;
    }

    readBytes(n: number): Buffer {
        // Subarray, not Buffer.from(subarray) — the slice shares memory
        // with `this.buf`, which the caller is still responsible for
        // keeping alive until done with the slice. For bulk decoders
        // (row → 20 cells × 10k rows = 200k slices on a single result)
        // skipping the per-cell memcpy is a measurable win, and the
        // underlying frame buffer falls out of scope naturally once the
        // QueryResult is no longer referenced.
        const slice = this.buf.subarray(this.pos, this.pos + n);
        this.pos += n;
        return slice;
    }

    readCString(): string {
        // Use readUInt8 instead of bracket indexing: Perry's native codegen
        // doesn't lower `buf[i]` for Buffer receivers — it reads as undefined
        // and the scan walks off the end.
        let end = this.pos;
        while (end < this.buf.length && this.buf.readUInt8(end) !== 0) {
            end++;
        }
        if (end >= this.buf.length) {
            throw new Error('readCString: no null terminator');
        }
        const v = this.buf.toString('utf8', this.pos, end);
        this.pos = end + 1;
        return v;
    }

    remaining(): number {
        return this.buf.length - this.pos;
    }

    done(): boolean {
        return this.pos >= this.buf.length;
    }
}
