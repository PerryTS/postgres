import { test, expect } from 'bun:test';
import { parseConnectionString } from '../../src';

test('parses canonical postgres:// URL', () => {
    const p = parseConnectionString('postgres://alice:secret@db.example.com:6543/myapp');
    expect(p.host).toBe('db.example.com');
    expect(p.port).toBe(6543);
    expect(p.user).toBe('alice');
    expect(p.password).toBe('secret');
    expect(p.database).toBe('myapp');
});

test('accepts postgresql:// alias', () => {
    const p = parseConnectionString('postgresql://localhost/mydb');
    expect(p.host).toBe('localhost');
    expect(p.port).toBe(5432);
    expect(p.user).toBe('');
    expect(p.database).toBe('mydb');
});

test('decodes percent-encoded user/password/database', () => {
    const p = parseConnectionString('postgres://us%20er:p%40ss@host/db%26name');
    expect(p.user).toBe('us er');
    expect(p.password).toBe('p@ss');
    expect(p.database).toBe('db&name');
});

test('parses IPv6 host with port', () => {
    const p = parseConnectionString('postgres://user@[::1]:5433/db');
    expect(p.host).toBe('::1');
    expect(p.port).toBe(5433);
});

test('parses IPv6 host without port', () => {
    const p = parseConnectionString('postgres://user@[::1]/db');
    expect(p.host).toBe('::1');
    expect(p.port).toBe(5432);
});

test('extracts known query parameters', () => {
    const p = parseConnectionString(
        'postgres://u@h/db?sslmode=verify-full&application_name=tusk&connect_timeout=15'
    );
    expect(p.ssl).toEqual({ mode: 'verify-full' });
    expect(p.applicationName).toBe('tusk');
    expect(p.connectTimeoutMs).toBe(15000);
});

test('preserves unknown query keys in extras', () => {
    const p = parseConnectionString('postgres://u@h/db?foo=bar&baz=qux');
    expect(p.extras).toEqual({ foo: 'bar', baz: 'qux' });
});

test('throws on bad scheme / port / sslmode', () => {
    expect(() => parseConnectionString('mysql://u@h/db')).toThrow();
    expect(() => parseConnectionString('postgres://u@h:abc/db')).toThrow();
    expect(() => parseConnectionString('postgres://u@h/db?sslmode=funky')).toThrow();
});
