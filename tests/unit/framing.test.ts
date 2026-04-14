// Round-trip and canonical-byte-layout tests for the wire framing layer.
// Covers every outgoing message type built in src/protocol/writer.ts plus
// the inbound accumulator in src/protocol/reader.ts.
//
// No socket is required — these tests run against pure Buffer manipulation.

import { test, expect } from 'bun:test';
import {
    parseFrame,
    writeFrame,
    writeTypelessFrame,
    writeStartupMessage,
    writeSSLRequest,
    writeCancelRequest,
    writeQuery,
    writeTerminate,
    writeSync,
    writeFlush,
    writePasswordMessage,
    writePasswordRaw,
    writeParse,
    writeBind,
    writeExecute,
    writeDescribe,
    writeClose,
    FRONTEND_QUERY,
    FRONTEND_PARSE,
    FRONTEND_BIND,
    FRONTEND_EXECUTE,
    FRONTEND_DESCRIBE,
    FRONTEND_CLOSE,
    FRONTEND_SYNC,
    FRONTEND_FLUSH,
    FRONTEND_TERMINATE,
    FRONTEND_PASSWORD,
    PROTOCOL_VERSION,
    SSL_REQUEST_CODE,
    CANCEL_REQUEST_CODE,
    MessageReader,
    decodeCString,
} from '../../src';

// ─── framing primitives ──────────────────────────────────────────────────────

test('writeFrame + parseFrame round-trip arbitrary payloads', () => {
    const payload = Buffer.from('hello world', 'utf8');
    const frame = writeFrame(0x51, payload);

    expect(frame.length).toBe(1 + 4 + payload.length);
    expect(frame[0]).toBe(0x51);
    expect(frame.readInt32BE(1)).toBe(4 + payload.length);

    const parsed = parseFrame(frame, 0);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe(0x51);
    expect(parsed!.payload.toString('utf8')).toBe('hello world');
    expect(parsed!.consumed).toBe(frame.length);
});

test('parseFrame returns null for incomplete buffers', () => {
    const frame = writeFrame(0x51, Buffer.from('hi', 'utf8'));

    expect(parseFrame(frame.subarray(0, 0), 0)).toBeNull();
    expect(parseFrame(frame.subarray(0, 3), 0)).toBeNull(); // no length field yet
    expect(parseFrame(frame.subarray(0, 5), 0)).toBeNull(); // length but no payload
    expect(parseFrame(frame, 0)).not.toBeNull();
});

test('parseFrame respects non-zero offsets', () => {
    const a = writeFrame(0x51, Buffer.from('A', 'utf8'));
    const b = writeFrame(0x51, Buffer.from('B', 'utf8'));
    const combined = Buffer.concat([a, b]);

    const parsedA = parseFrame(combined, 0)!;
    expect(parsedA.payload.toString('utf8')).toBe('A');

    const parsedB = parseFrame(combined, parsedA.consumed)!;
    expect(parsedB.payload.toString('utf8')).toBe('B');
});

test('parseFrame rejects implausible lengths', () => {
    const buf = Buffer.alloc(5);
    buf.writeUInt8(0x51, 0);
    buf.writeInt32BE(3, 1); // length < 4 is invalid (must include self)
    expect(() => parseFrame(buf, 0)).toThrow();
});

test('writeTypelessFrame layout is length-prefixed with no type byte', () => {
    const payload = Buffer.from([1, 2, 3, 4]);
    const frame = writeTypelessFrame(payload);
    expect(frame.length).toBe(4 + payload.length);
    expect(frame.readInt32BE(0)).toBe(frame.length);
    expect(frame.subarray(4).equals(payload)).toBe(true);
});

// ─── startup / SSL / cancel ──────────────────────────────────────────────────

test('StartupMessage matches Postgres v3 canonical layout', () => {
    const startup = writeStartupMessage({ user: 'alice', database: 'postgres' });

    expect(startup.readInt32BE(0)).toBe(startup.length);
    expect(startup.readInt32BE(4)).toBe(PROTOCOL_VERSION);

    // "user\0alice\0database\0postgres\0\0" after the 8-byte header.
    const body = startup.subarray(8);
    const expected = Buffer.concat([
        Buffer.from('user\0', 'utf8'),
        Buffer.from('alice\0', 'utf8'),
        Buffer.from('database\0', 'utf8'),
        Buffer.from('postgres\0', 'utf8'),
        Buffer.from([0]),
    ]);
    expect(body.equals(expected)).toBe(true);
});

test('StartupMessage handles empty params (just the trailing null)', () => {
    const startup = writeStartupMessage({});
    expect(startup.length).toBe(9); // 4 length + 4 version + 1 null
    expect(startup.readInt32BE(0)).toBe(9);
    expect(startup.readInt32BE(4)).toBe(PROTOCOL_VERSION);
    expect(startup[8]).toBe(0);
});

test('SSLRequest is exactly 8 bytes with the magic code', () => {
    const ssl = writeSSLRequest();
    expect(ssl.length).toBe(8);
    expect(ssl.readInt32BE(0)).toBe(8);
    expect(ssl.readInt32BE(4)).toBe(SSL_REQUEST_CODE);
});

test('CancelRequest carries backend pid + secret key', () => {
    const req = writeCancelRequest(12345, 0x11223344);
    expect(req.length).toBe(16);
    expect(req.readInt32BE(0)).toBe(16);
    expect(req.readInt32BE(4)).toBe(CANCEL_REQUEST_CODE);
    expect(req.readInt32BE(8)).toBe(12345);
    expect(req.readInt32BE(12)).toBe(0x11223344);
});

// ─── simple query / lifecycle ────────────────────────────────────────────────

test('Query frame carries a null-terminated SQL string', () => {
    const sql = "SELECT 'hello' WHERE 1 = 1";
    const msg = writeQuery(sql);
    const parsed = parseFrame(msg, 0)!;

    expect(parsed.type).toBe(FRONTEND_QUERY);
    expect(parsed.payload[parsed.payload.length - 1]).toBe(0);
    expect(parsed.payload.toString('utf8', 0, parsed.payload.length - 1)).toBe(sql);
});

test('Terminate / Sync / Flush are 5-byte empty-payload frames', () => {
    for (const built of [writeTerminate(), writeSync(), writeFlush()]) {
        expect(built.length).toBe(5);
        expect(built.readInt32BE(1)).toBe(4); // length field = 4 (self only)
    }
    expect(writeTerminate()[0]).toBe(FRONTEND_TERMINATE);
    expect(writeSync()[0]).toBe(FRONTEND_SYNC);
    expect(writeFlush()[0]).toBe(FRONTEND_FLUSH);
});

// ─── password / SASL ─────────────────────────────────────────────────────────

test('PasswordMessage (cleartext / md5) terminates the password with \\0', () => {
    const msg = writePasswordMessage('s3cr3t');
    const parsed = parseFrame(msg, 0)!;
    expect(parsed.type).toBe(FRONTEND_PASSWORD);
    expect(parsed.payload[parsed.payload.length - 1]).toBe(0);
    expect(parsed.payload.toString('utf8', 0, parsed.payload.length - 1)).toBe('s3cr3t');
});

test('writePasswordRaw is byte-for-byte (SASL continuation)', () => {
    const saslBytes = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const msg = writePasswordRaw(saslBytes);
    const parsed = parseFrame(msg, 0)!;
    expect(parsed.type).toBe(FRONTEND_PASSWORD);
    expect(parsed.payload.equals(saslBytes)).toBe(true);
});

// ─── extended query ──────────────────────────────────────────────────────────

test('Parse encodes name + sql + param types', () => {
    const msg = writeParse('', 'SELECT $1::int4', [23]); // 23 = int4 OID
    const parsed = parseFrame(msg, 0)!;
    expect(parsed.type).toBe(FRONTEND_PARSE);

    // name is empty string → just a null byte
    expect(parsed.payload[0]).toBe(0);
    const name = decodeCString(parsed.payload, 0);
    expect(name.value).toBe('');

    const sql = decodeCString(parsed.payload, name.next);
    expect(sql.value).toBe('SELECT $1::int4');

    let pos = sql.next;
    expect(parsed.payload.readInt16BE(pos)).toBe(1);
    pos += 2;
    expect(parsed.payload.readInt32BE(pos)).toBe(23);
});

test('Parse with no param types encodes a zero count', () => {
    const msg = writeParse('stmt42', 'SELECT 1', []);
    const parsed = parseFrame(msg, 0)!;
    const name = decodeCString(parsed.payload, 0);
    expect(name.value).toBe('stmt42');
    const sql = decodeCString(parsed.payload, name.next);
    expect(sql.value).toBe('SELECT 1');
    expect(parsed.payload.readInt16BE(sql.next)).toBe(0);
});

test('Bind encodes formats + values + result-formats, including NULL', () => {
    const msg = writeBind({
        portalName: '',
        stmtName: 'stmt1',
        paramFormats: [1],
        paramValues: [Buffer.from([0, 0, 0, 42]), null],
        resultFormats: [1, 1],
    });
    const parsed = parseFrame(msg, 0)!;
    expect(parsed.type).toBe(FRONTEND_BIND);

    const p = parsed.payload;
    const portal = decodeCString(p, 0);
    expect(portal.value).toBe('');
    const stmt = decodeCString(p, portal.next);
    expect(stmt.value).toBe('stmt1');

    let pos = stmt.next;
    // 1 param format
    expect(p.readInt16BE(pos)).toBe(1); pos += 2;
    expect(p.readInt16BE(pos)).toBe(1); pos += 2;
    // 2 param values
    expect(p.readInt16BE(pos)).toBe(2); pos += 2;
    // value 0: 4 bytes, int32 42
    expect(p.readInt32BE(pos)).toBe(4); pos += 4;
    expect(p.readInt32BE(pos)).toBe(42); pos += 4;
    // value 1: -1 = NULL
    expect(p.readInt32BE(pos)).toBe(-1); pos += 4;
    // 2 result formats
    expect(p.readInt16BE(pos)).toBe(2); pos += 2;
    expect(p.readInt16BE(pos)).toBe(1); pos += 2;
    expect(p.readInt16BE(pos)).toBe(1);
});

test('Bind with no params still emits the zero-count int16', () => {
    const msg = writeBind({
        portalName: '',
        stmtName: '',
        paramFormats: [],
        paramValues: [],
        resultFormats: [],
    });
    const parsed = parseFrame(msg, 0)!;
    // empty portal (\0) + empty stmt (\0) + 3 zero int16 counts = 2 + 6 = 8
    expect(parsed.payload.length).toBe(2 + 6);
});

test('Execute encodes portal + max rows', () => {
    const msg = writeExecute('mycursor', 100);
    const parsed = parseFrame(msg, 0)!;
    expect(parsed.type).toBe(FRONTEND_EXECUTE);

    const name = decodeCString(parsed.payload, 0);
    expect(name.value).toBe('mycursor');
    expect(parsed.payload.readInt32BE(name.next)).toBe(100);
});

test('Describe carries kind byte + name', () => {
    const d = writeDescribe('S', 'stmt1');
    const parsed = parseFrame(d, 0)!;
    expect(parsed.type).toBe(FRONTEND_DESCRIBE);
    expect(parsed.payload[0]).toBe('S'.charCodeAt(0));
    const name = decodeCString(parsed.payload, 1);
    expect(name.value).toBe('stmt1');
});

test('Close carries kind byte + name', () => {
    const c = writeClose('P', 'portal1');
    const parsed = parseFrame(c, 0)!;
    expect(parsed.type).toBe(FRONTEND_CLOSE);
    expect(parsed.payload[0]).toBe('P'.charCodeAt(0));
    const name = decodeCString(parsed.payload, 1);
    expect(name.value).toBe('portal1');
});

// ─── inbound accumulator ─────────────────────────────────────────────────────

test('MessageReader streams complete frames and buffers partials', () => {
    const reader = new MessageReader();
    const q1 = writeQuery('SELECT 1');
    const q2 = writeQuery('SELECT 2');
    const combined = Buffer.concat([q1, q2]);

    // Split partway through q2.
    const cutoff = q1.length + 3;
    const chunk1 = combined.subarray(0, cutoff);
    const chunk2 = combined.subarray(cutoff);

    const first = reader.feed(chunk1);
    expect(first.length).toBe(1);
    expect(first[0].type).toBe(FRONTEND_QUERY);
    expect(reader.hasPending()).toBe(true);

    const second = reader.feed(chunk2);
    expect(second.length).toBe(1);
    expect(second[0].type).toBe(FRONTEND_QUERY);
    expect(reader.hasPending()).toBe(false);
});

test('MessageReader handles byte-at-a-time delivery', () => {
    const reader = new MessageReader();
    const msg = writeQuery('SELECT 1');

    let collected: number = 0;
    for (let i = 0; i < msg.length; i++) {
        const out = reader.feed(msg.subarray(i, i + 1));
        collected += out.length;
    }
    expect(collected).toBe(1);
    expect(reader.hasPending()).toBe(false);
});

test('MessageReader detaches payloads from the internal buffer', () => {
    const reader = new MessageReader();
    const msg = writeQuery('SELECT 1');
    const [first] = reader.feed(msg);

    // Feeding more data must not mutate the payload we already returned.
    reader.feed(writeQuery('SELECT 2'));
    expect(first.payload[first.payload.length - 1]).toBe(0);
    expect(first.payload.toString('utf8', 0, first.payload.length - 1)).toBe('SELECT 1');
});

test('MessageReader.reset discards buffered bytes', () => {
    const reader = new MessageReader();
    reader.feed(Buffer.from([0x51, 0x00, 0x00])); // incomplete
    expect(reader.hasPending()).toBe(true);
    reader.reset();
    expect(reader.hasPending()).toBe(false);
});
