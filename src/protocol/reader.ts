// Inbound message accumulator. Owns a small byte buffer, receives chunks
// from the underlying socket's `'data'` event, and yields complete typed
// message frames as soon as they're available.
//
// Any trailing incomplete bytes are retained for the next `feed` call.

import { parseFrame, FrameView } from './framing';

export class MessageReader {
    private buf: Buffer = Buffer.alloc(0);

    /**
     * Append `chunk` to the internal buffer and return every complete
     * frame that can now be parsed. The returned payloads are independent
     * copies — safe to retain across subsequent `feed` calls.
     */
    feed(chunk: Buffer): FrameView[] {
        if (this.buf.length === 0) {
            // Fast path: no pending bytes, process `chunk` in place.
            this.buf = chunk;
        } else {
            this.buf = Buffer.concat([this.buf, chunk]);
        }

        const out: FrameView[] = [];
        let offset = 0;
        while (offset < this.buf.length) {
            const frame = parseFrame(this.buf, offset);
            if (frame === null) {
                break;
            }
            out.push({
                type: frame.type,
                payload: Buffer.from(frame.payload),
                consumed: frame.consumed,
            });
            offset += frame.consumed;
        }

        if (offset > 0) {
            this.buf = offset < this.buf.length
                ? Buffer.from(this.buf.subarray(offset))
                : Buffer.alloc(0);
        }
        return out;
    }

    /** True iff the internal buffer still contains a partial message. */
    hasPending(): boolean {
        return this.buf.length > 0;
    }

    /** Discard any buffered bytes. Useful on reconnect. */
    reset(): void {
        this.buf = Buffer.alloc(0);
    }
}
