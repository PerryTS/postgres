// Register every built-in codec in the global registry. Imported for its
// side effects by `src/index.ts` so the registry is primed before any
// query runs.

import { registerType } from './registry';
import * as O from './oids';
import {
    boolCodec,
    byteaCodec,
    float4Codec,
    float8Codec,
    int2Codec,
    int4Codec,
    int8Codec,
    jsonCodec,
    jsonbCodec,
    textCodec,
    uuidCodec,
} from './codecs/scalars';
import {
    decodeDateBinary, decodeDateText,
    decodeIntervalBinary, decodeIntervalText,
    decodeTimeBinary, decodeTimeText,
    decodeTimestampBinary, decodeTimestampText,
    decodeTimestamptzBinary, decodeTimestamptzText,
    decodeTimetzBinary, decodeTimetzText,
    PgDate, PgInterval, PgTime, PgTimestamp,
} from './datetime';
import {
    decodeNumericBinary, decodeNumericText,
    encodeNumericBinary, encodeNumericText,
    Decimal,
} from './numeric';
import { arrayCodec } from './codecs/array';
import type { Codec } from './registry';

// ─── Scalar registrations ────────────────────────────────────────────────────

registerType(O.OID_INT2, { ...int2Codec, oid: O.OID_INT2, name: 'int2' });
registerType(O.OID_INT4, { ...int4Codec, oid: O.OID_INT4, name: 'int4' });
registerType(O.OID_INT8, int8Codec);
registerType(O.OID_FLOAT4, { ...float4Codec, oid: O.OID_FLOAT4, name: 'float4' });
registerType(O.OID_FLOAT8, { ...float8Codec, oid: O.OID_FLOAT8, name: 'float8' });
registerType(O.OID_BOOL, boolCodec);
registerType(O.OID_BYTEA, byteaCodec);
registerType(O.OID_UUID, uuidCodec);
registerType(O.OID_JSON, jsonCodec);
registerType(O.OID_JSONB, jsonbCodec);

// Text family — same bytes, same codec, different OIDs.
registerType(O.OID_TEXT, textCodec);
registerType(O.OID_VARCHAR, { ...textCodec, oid: O.OID_VARCHAR, name: 'varchar' });
registerType(O.OID_BPCHAR, { ...textCodec, oid: O.OID_BPCHAR, name: 'bpchar' });
registerType(O.OID_NAME, { ...textCodec, oid: O.OID_NAME, name: 'name' });

// ─── Numeric ─────────────────────────────────────────────────────────────────

const numericCodec: Codec<Decimal | string | number | bigint> = {
    oid: O.OID_NUMERIC,
    name: 'numeric',
    text: {
        decode: decodeNumericText,
        encode: encodeNumericText,
    },
    binary: {
        decode: decodeNumericBinary,
        encode: encodeNumericBinary,
    },
};
registerType(O.OID_NUMERIC, numericCodec);

// ─── Date / time ─────────────────────────────────────────────────────────────

registerType<PgDate>(O.OID_DATE, {
    oid: O.OID_DATE,
    name: 'date',
    text: {
        decode: decodeDateText,
        encode: (v: PgDate): Buffer => Buffer.from(v.toString(), 'utf8'),
    },
    binary: {
        decode: decodeDateBinary,
        encode: (_v: PgDate): Buffer => {
            throw new Error('date binary encode not implemented — send as text');
        },
    },
});
registerType<PgTime>(O.OID_TIME, {
    oid: O.OID_TIME,
    name: 'time',
    text: {
        decode: decodeTimeText,
        encode: (v: PgTime): Buffer => Buffer.from(v.toString(), 'utf8'),
    },
    binary: {
        decode: decodeTimeBinary,
        encode: (_v: PgTime): Buffer => {
            throw new Error('time binary encode not implemented — send as text');
        },
    },
});
registerType<PgTime>(O.OID_TIMETZ, {
    oid: O.OID_TIMETZ,
    name: 'timetz',
    text: {
        decode: decodeTimetzText,
        encode: (v: PgTime): Buffer => Buffer.from(v.toString(), 'utf8'),
    },
    binary: {
        decode: decodeTimetzBinary,
        encode: (_v: PgTime): Buffer => {
            throw new Error('timetz binary encode not implemented — send as text');
        },
    },
});
registerType<PgTimestamp>(O.OID_TIMESTAMP, {
    oid: O.OID_TIMESTAMP,
    name: 'timestamp',
    text: {
        decode: decodeTimestampText,
        encode: (v: PgTimestamp): Buffer => Buffer.from(v.toString(), 'utf8'),
    },
    binary: {
        decode: decodeTimestampBinary,
        encode: (_v: PgTimestamp): Buffer => {
            throw new Error('timestamp binary encode not implemented — send as text');
        },
    },
});
registerType<PgTimestamp>(O.OID_TIMESTAMPTZ, {
    oid: O.OID_TIMESTAMPTZ,
    name: 'timestamptz',
    text: {
        decode: decodeTimestamptzText,
        encode: (v: PgTimestamp): Buffer => Buffer.from(v.toString(), 'utf8'),
    },
    binary: {
        decode: decodeTimestamptzBinary,
        encode: (_v: PgTimestamp): Buffer => {
            throw new Error('timestamptz binary encode not implemented — send as text');
        },
    },
});
registerType<PgInterval>(O.OID_INTERVAL, {
    oid: O.OID_INTERVAL,
    name: 'interval',
    text: {
        decode: decodeIntervalText,
        encode: (v: PgInterval): Buffer => Buffer.from(v.toString(), 'utf8'),
    },
    binary: {
        decode: decodeIntervalBinary,
        encode: (_v: PgInterval): Buffer => {
            throw new Error('interval binary encode not implemented — send as text');
        },
    },
});

// ─── Array registrations ─────────────────────────────────────────────────────

registerType(O.OID_INT2_ARRAY, arrayCodec('_int2', O.OID_INT2_ARRAY, O.OID_INT2));
registerType(O.OID_INT4_ARRAY, arrayCodec('_int4', O.OID_INT4_ARRAY, O.OID_INT4));
registerType(O.OID_INT8_ARRAY, arrayCodec('_int8', O.OID_INT8_ARRAY, O.OID_INT8));
registerType(O.OID_FLOAT4_ARRAY, arrayCodec('_float4', O.OID_FLOAT4_ARRAY, O.OID_FLOAT4));
registerType(O.OID_FLOAT8_ARRAY, arrayCodec('_float8', O.OID_FLOAT8_ARRAY, O.OID_FLOAT8));
registerType(O.OID_BOOL_ARRAY, arrayCodec('_bool', O.OID_BOOL_ARRAY, O.OID_BOOL));
registerType(O.OID_BYTEA_ARRAY, arrayCodec('_bytea', O.OID_BYTEA_ARRAY, O.OID_BYTEA));
registerType(O.OID_UUID_ARRAY, arrayCodec('_uuid', O.OID_UUID_ARRAY, O.OID_UUID));
registerType(O.OID_JSON_ARRAY, arrayCodec('_json', O.OID_JSON_ARRAY, O.OID_JSON));
registerType(O.OID_JSONB_ARRAY, arrayCodec('_jsonb', O.OID_JSONB_ARRAY, O.OID_JSONB));
registerType(O.OID_TEXT_ARRAY, arrayCodec('_text', O.OID_TEXT_ARRAY, O.OID_TEXT));
registerType(O.OID_VARCHAR_ARRAY, arrayCodec('_varchar', O.OID_VARCHAR_ARRAY, O.OID_VARCHAR));
registerType(O.OID_BPCHAR_ARRAY, arrayCodec('_bpchar', O.OID_BPCHAR_ARRAY, O.OID_BPCHAR));
registerType(O.OID_NAME_ARRAY, arrayCodec('_name', O.OID_NAME_ARRAY, O.OID_NAME));
registerType(O.OID_NUMERIC_ARRAY, arrayCodec('_numeric', O.OID_NUMERIC_ARRAY, O.OID_NUMERIC));
registerType(O.OID_DATE_ARRAY, arrayCodec('_date', O.OID_DATE_ARRAY, O.OID_DATE));
registerType(O.OID_TIME_ARRAY, arrayCodec('_time', O.OID_TIME_ARRAY, O.OID_TIME));
registerType(O.OID_TIMETZ_ARRAY, arrayCodec('_timetz', O.OID_TIMETZ_ARRAY, O.OID_TIMETZ));
registerType(O.OID_TIMESTAMP_ARRAY, arrayCodec('_timestamp', O.OID_TIMESTAMP_ARRAY, O.OID_TIMESTAMP));
registerType(O.OID_TIMESTAMPTZ_ARRAY, arrayCodec('_timestamptz', O.OID_TIMESTAMPTZ_ARRAY, O.OID_TIMESTAMPTZ));
registerType(O.OID_INTERVAL_ARRAY, arrayCodec('_interval', O.OID_INTERVAL_ARRAY, O.OID_INTERVAL));
