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
     * frame that can now be parsed.
     *
     * Returned `payload` values are SUBARRAY views into the underlying
     * chunk — they share its memory until JS GC collects both. Safe to
     * retain across subsequent `feed` calls because reassigning
     * `this.buf` doesn't invalidate previous slices: each held slice
     * keeps the original ArrayBuffer alive on its own. Skipping the
     * old per-frame `Buffer.from(...)` copy is significant on bulk
     * results — for a 10k-row response that's 10k+ saved memmoves.
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
            out.push(frame);
            offset += frame.consumed;
        }

        if (offset > 0) {
            // Keep the leftover partial frame as its own copy so the
            // (potentially much larger) consumed prefix can be GC'd.
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
