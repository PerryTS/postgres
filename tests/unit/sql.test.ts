import { test, expect } from 'bun:test';
import { sql, raw, isSqlQuery } from '../../src';

test('static template produces text + empty params', () => {
    const q = sql`SELECT 1`;
    expect(q.text).toBe('SELECT 1');
    expect(q.params).toEqual([]);
    expect(isSqlQuery(q)).toBe(true);
});

test('interpolations become positional placeholders', () => {
    const id = 42;
    const name = "O'Malley";
    const q = sql`SELECT * FROM users WHERE id = ${id} AND name = ${name}`;
    expect(q.text).toBe('SELECT * FROM users WHERE id = $1 AND name = $2');
    expect(q.params).toEqual([42, "O'Malley"]);
});

test('nested SqlQuery fragments are renumbered correctly', () => {
    const inner = sql`x = ${1} OR y = ${2}`;
    const outer = sql`SELECT * FROM t WHERE ${inner} AND z = ${3}`;
    expect(outer.text).toBe('SELECT * FROM t WHERE x = $1 OR y = $2 AND z = $3');
    expect(outer.params).toEqual([1, 2, 3]);
});

test('raw() inserts unparameterized SQL', () => {
    const col = 'created_at';
    const q = sql`SELECT * FROM t ORDER BY ${raw(col)} DESC LIMIT ${10}`;
    expect(q.text).toBe('SELECT * FROM t ORDER BY created_at DESC LIMIT $1');
    expect(q.params).toEqual([10]);
});

test('isSqlQuery rejects non-SqlQuery values', () => {
    expect(isSqlQuery('hello')).toBe(false);
    expect(isSqlQuery({ text: 'x', params: [] })).toBe(false);
    expect(isSqlQuery(null)).toBe(false);
    expect(isSqlQuery(undefined)).toBe(false);
});

test('null and undefined params survive interpolation', () => {
    const q = sql`UPDATE t SET a = ${null}, b = ${undefined}`;
    expect(q.text).toBe('UPDATE t SET a = $1, b = $2');
    expect(q.params).toEqual([null, undefined]);
});
