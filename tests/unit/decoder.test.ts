// Unit tests for the server→client message decoders. Each test builds a
// canonical payload by hand (matching the Postgres wire spec), feeds it
// to the decoder, and checks the structured result.

import { test, expect } from 'bun:test';
import {
    decodeRowDescription,
    decodeDataRow,
    decodeCommandComplete,
    decodeReadyForQuery,
    decodeParameterStatus,
    decodeBackendKeyData,
    decodeAuthentication,
    decodeNotification,
    decodeErrorFields,
    parsePgError,
    parsePgNotice,
} from '../../src';

function cstring(s: string): Buffer {
    return Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);
}

function int16(n: number): Buffer {
    const b = Buffer.alloc(2);
    b.writeInt16BE(n, 0);
    return b;
}

function int32(n: number): Buffer {
    const b = Buffer.alloc(4);
    b.writeInt32BE(n, 0);
    return b;
}

// ─── RowDescription ─────────────────────────────────────────────────────────

test('RowDescription decodes N fields with every per-field attribute', () => {
    const payload = Buffer.concat([
        int16(2),
        cstring('id'),        int32(12345),  int16(1),   int32(23),   int16(4),    int32(-1),   int16(1),
        cstring('comment'),   int32(0),      int16(0),   int32(25),   int16(-1),   int32(-1),   int16(0),
    ]);

    const fields = decodeRowDescription(payload);
    expect(fields.length).toBe(2);

    expect(fields[0].name).toBe('id');
    expect(fields[0].tableOid).toBe(12345);
    expect(fields[0].columnAttrNum).toBe(1);
    expect(fields[0].typeOid).toBe(23);
    expect(fields[0].typeSize).toBe(4);
    expect(fields[0].typeModifier).toBe(-1);
    expect(fields[0].formatCode).toBe(1);

    expect(fields[1].name).toBe('comment');
    expect(fields[1].tableOid).toBe(0);
    expect(fields[1].columnAttrNum).toBe(0);
    expect(fields[1].typeOid).toBe(25);
    expect(fields[1].typeSize).toBe(-1);
    expect(fields[1].formatCode).toBe(0);
});

test('RowDescription handles zero columns', () => {
    const payload = Buffer.concat([int16(0)]);
    expect(decodeRowDescription(payload)).toEqual([]);
});

// ─── DataRow ────────────────────────────────────────────────────────────────

test('DataRow decodes mixed lengths and NULL columns', () => {
    const payload = Buffer.concat([
        int16(3),
        int32(1),  Buffer.from([0x41]),
        int32(-1),
        int32(5),  Buffer.from('hello', 'utf8'),
    ]);
    const row = decodeDataRow(payload);
    expect(row.length).toBe(3);
    expect(row[0]!.toString('utf8')).toBe('A');
    expect(row[1]).toBeNull();
    expect(row[2]!.toString('utf8')).toBe('hello');
});

// ─── CommandComplete ────────────────────────────────────────────────────────

test('CommandComplete extracts row count from common tag formats', () => {
    const cases: [string, number][] = [
        ['SELECT 5', 5],
        ['SELECT 0', 0],
        ['INSERT 0 3', 3],
        ['UPDATE 7', 7],
        ['DELETE 2', 2],
        ['BEGIN', 0],
        ['COMMIT', 0],
    ];
    for (let i = 0; i < cases.length; i++) {
        const [tag, expected] = cases[i];
        const cc = decodeCommandComplete(cstring(tag));
        expect(cc.tag).toBe(tag);
        expect(cc.rowCount).toBe(expected);
    }
});

// ─── ReadyForQuery ──────────────────────────────────────────────────────────

test('ReadyForQuery decodes all three transaction statuses', () => {
    expect(decodeReadyForQuery(Buffer.from([0x49]))).toBe('idle');
    expect(decodeReadyForQuery(Buffer.from([0x54]))).toBe('in-transaction');
    expect(decodeReadyForQuery(Buffer.from([0x45]))).toBe('in-failed-transaction');
    expect(() => decodeReadyForQuery(Buffer.from([0x00]))).toThrow();
});

// ─── ParameterStatus / BackendKeyData ───────────────────────────────────────

test('ParameterStatus decodes name/value pair', () => {
    const payload = Buffer.concat([cstring('server_version'), cstring('16.2')]);
    expect(decodeParameterStatus(payload)).toEqual({
        name: 'server_version',
        value: '16.2',
    });
});

test('BackendKeyData decodes pid + secret', () => {
    const payload = Buffer.concat([int32(12345), int32(0x11223344)]);
    expect(decodeBackendKeyData(payload)).toEqual({
        pid: 12345,
        secretKey: 0x11223344,
    });
});

// ─── Authentication ─────────────────────────────────────────────────────────

test('Authentication decodes AuthOK', () => {
    const r = decodeAuthentication(int32(0));
    expect(r.kind).toBe('ok');
});

test('Authentication decodes cleartext / md5 / kerberos / gss / sspi', () => {
    expect(decodeAuthentication(int32(3)).kind).toBe('cleartext-password');

    const md5 = decodeAuthentication(Buffer.concat([int32(5), Buffer.from([1, 2, 3, 4])]));
    expect(md5.kind).toBe('md5-password');
    if (md5.kind === 'md5-password') {
        expect(md5.salt.equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
    }

    expect(decodeAuthentication(int32(2)).kind).toBe('kerberos-v5');
    expect(decodeAuthentication(int32(7)).kind).toBe('gss');
    expect(decodeAuthentication(int32(9)).kind).toBe('sspi');
});

test('Authentication decodes SASL mechanism list', () => {
    const payload = Buffer.concat([
        int32(10),
        cstring('SCRAM-SHA-256'),
        cstring('SCRAM-SHA-256-PLUS'),
        cstring(''),
    ]);
    const r = decodeAuthentication(payload);
    expect(r.kind).toBe('sasl');
    if (r.kind === 'sasl') {
        expect(r.mechanisms).toEqual(['SCRAM-SHA-256', 'SCRAM-SHA-256-PLUS']);
    }
});

test('Authentication decodes SASL continue and final', () => {
    const cont = decodeAuthentication(Buffer.concat([int32(11), Buffer.from('r=abc', 'utf8')]));
    expect(cont.kind).toBe('sasl-continue');
    if (cont.kind === 'sasl-continue') {
        expect(cont.data.toString('utf8')).toBe('r=abc');
    }
    const fin = decodeAuthentication(Buffer.concat([int32(12), Buffer.from('v=xyz', 'utf8')]));
    expect(fin.kind).toBe('sasl-final');
});

test('Authentication surfaces unknown subtypes', () => {
    const r = decodeAuthentication(int32(99));
    expect(r.kind).toBe('unknown');
    if (r.kind === 'unknown') {
        expect(r.subtype).toBe(99);
    }
});

// ─── NotificationResponse ───────────────────────────────────────────────────

test('Notification decodes pid + channel + payload', () => {
    const payload = Buffer.concat([int32(42), cstring('jobs'), cstring('{"id":1}')]);
    expect(decodeNotification(payload)).toEqual({
        pid: 42,
        channel: 'jobs',
        payload: '{"id":1}',
    });
});

// ─── Error / Notice fields ──────────────────────────────────────────────────

test('decodeErrorFields parses the canonical ErrorResponse layout', () => {
    // S=ERROR, V=ERROR, C=42601, M=syntax error at or near "foo", P=1, F=scan.l, L=1101, R=scanner_yyerror
    const payload = Buffer.concat([
        Buffer.from([0x53]), cstring('ERROR'),
        Buffer.from([0x56]), cstring('ERROR'),
        Buffer.from([0x43]), cstring('42601'),
        Buffer.from([0x4D]), cstring('syntax error at or near "foo"'),
        Buffer.from([0x50]), cstring('1'),
        Buffer.from([0x46]), cstring('scan.l'),
        Buffer.from([0x4C]), cstring('1101'),
        Buffer.from([0x52]), cstring('scanner_yyerror'),
        Buffer.from([0]),
    ]);

    const fields = decodeErrorFields(payload);
    expect(fields.severity).toBe('ERROR');
    expect(fields.severityNonLocalized).toBe('ERROR');
    expect(fields.code).toBe('42601');
    expect(fields.message).toBe('syntax error at or near "foo"');
    expect(fields.position).toBe('1');
    expect(fields.file).toBe('scan.l');
    expect(fields.line).toBe('1101');
    expect(fields.routine).toBe('scanner_yyerror');
});

test('parsePgError produces a working Error with all fields', () => {
    const payload = Buffer.concat([
        Buffer.from([0x53]), cstring('ERROR'),
        Buffer.from([0x43]), cstring('42P01'),
        Buffer.from([0x4D]), cstring('relation "nope" does not exist'),
        Buffer.from([0]),
    ]);
    const err = parsePgError(payload);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('relation "nope" does not exist');
    expect(err.code).toBe('42P01');
    expect(err.severity).toBe('ERROR');
});

test('parsePgNotice produces a PgNotice with just the fields', () => {
    const payload = Buffer.concat([
        Buffer.from([0x53]), cstring('NOTICE'),
        Buffer.from([0x4D]), cstring('CREATE TABLE will create implicit sequence'),
        Buffer.from([0]),
    ]);
    const n = parsePgNotice(payload);
    expect(n.severity).toBe('NOTICE');
    expect(n.message).toBe('CREATE TABLE will create implicit sequence');
});

test('decodeErrorFields ignores unknown field codes', () => {
    const payload = Buffer.concat([
        Buffer.from([0x4D]), cstring('known'),
        Buffer.from([0x5A]), cstring('unknown-ignored'), // 'Z' is not a documented field code
        Buffer.from([0]),
    ]);
    const fields = decodeErrorFields(payload);
    expect(fields.message).toBe('known');
});
