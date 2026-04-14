// Postgres built-in type OIDs. Values are stable across every released
// server version — pg_type is part of the bootstrap catalog and these
// specific entries haven't changed since v7.
//
// Grouped by category. Each scalar type is followed by its 1-dimensional
// array type (the `_type` entries).

// ─── Integers ────────────────────────────────────────────────────────────────

export const OID_INT2 = 21;
export const OID_INT4 = 23;
export const OID_INT8 = 20;

export const OID_INT2_ARRAY = 1005;
export const OID_INT4_ARRAY = 1007;
export const OID_INT8_ARRAY = 1016;

// ─── Floating point ──────────────────────────────────────────────────────────

export const OID_FLOAT4 = 700;
export const OID_FLOAT8 = 701;

export const OID_FLOAT4_ARRAY = 1021;
export const OID_FLOAT8_ARRAY = 1022;

// ─── Exact numeric ───────────────────────────────────────────────────────────

export const OID_NUMERIC = 1700;
export const OID_NUMERIC_ARRAY = 1231;

// ─── Boolean ─────────────────────────────────────────────────────────────────

export const OID_BOOL = 16;
export const OID_BOOL_ARRAY = 1000;

// ─── Text-family ─────────────────────────────────────────────────────────────

export const OID_TEXT = 25;
export const OID_VARCHAR = 1043;
/** Fixed-length padded CHAR(n) — `bpchar` internally. */
export const OID_BPCHAR = 1042;
/** `name` — 63-byte identifier type used by catalog columns. */
export const OID_NAME = 19;

export const OID_TEXT_ARRAY = 1009;
export const OID_VARCHAR_ARRAY = 1015;
export const OID_BPCHAR_ARRAY = 1014;
export const OID_NAME_ARRAY = 1003;

// ─── Binary ──────────────────────────────────────────────────────────────────

export const OID_BYTEA = 17;
export const OID_BYTEA_ARRAY = 1001;

// ─── UUID ────────────────────────────────────────────────────────────────────

export const OID_UUID = 2950;
export const OID_UUID_ARRAY = 2951;

// ─── JSON ────────────────────────────────────────────────────────────────────

export const OID_JSON = 114;
export const OID_JSONB = 3802;

export const OID_JSON_ARRAY = 199;
export const OID_JSONB_ARRAY = 3807;

// ─── Date / time ─────────────────────────────────────────────────────────────

export const OID_DATE = 1082;
export const OID_TIME = 1083;
export const OID_TIMETZ = 1266;
export const OID_TIMESTAMP = 1114;
export const OID_TIMESTAMPTZ = 1184;
export const OID_INTERVAL = 1186;

export const OID_DATE_ARRAY = 1182;
export const OID_TIME_ARRAY = 1183;
export const OID_TIMETZ_ARRAY = 1270;
export const OID_TIMESTAMP_ARRAY = 1115;
export const OID_TIMESTAMPTZ_ARRAY = 1185;
export const OID_INTERVAL_ARRAY = 1187;

// ─── Format codes ────────────────────────────────────────────────────────────

export const FORMAT_TEXT = 0;
export const FORMAT_BINARY = 1;
