// Public API of @perry/postgres. Stable surface; sub-modules are
// importable but not part of the semver contract.
//
// Future additions (as milestones C2–C7 land):
//   - `connect(opts)` returning a `Connection` with query / prepare /
//     cancel / close + NOTICE / parameter / error events.
//   - `Decimal` wrapper over perry-stdlib's `rust_decimal` for numeric fidelity.
//   - Type codec registry (`registerType`) and the 20 built-in codecs.
//   - Structured `PgError` with full ErrorResponse field set.

// Wire framing (C1)
export {
    parseFrame,
    writeFrame,
    writeTypelessFrame,
} from './protocol/framing';
export type { FrameView } from './protocol/framing';

// Message builders (C1)
export {
    writeStartupMessage,
    writeSSLRequest,
    writeCancelRequest,
    writeQuery,
    writeParse,
    writeBind,
    writeExecute,
    writeDescribe,
    writeClose,
    writeSync,
    writeFlush,
    writeTerminate,
    writePasswordMessage,
    writePasswordRaw,
} from './protocol/writer';
export type { BindParams } from './protocol/writer';

// Inbound accumulator (C1)
export { MessageReader } from './protocol/reader';

// Protocol constants (C1)
export * from './protocol/messages';

// Connection + public API (C2)
export { connect, Connection, rowsDecoded, toObjects } from './connection';
export type { ConnectOptions, QueryResult } from './connection';

// Higher-level usability (v0.2)
export { parseConnectionString } from './url';
export type { ParsedConnectionString } from './url';
export { resolveConnectOptions } from './env';
export type { ResolveOptionsInput } from './env';
export { sql, raw, isSqlQuery } from './sql';
export type { SqlQuery } from './sql';
export { Pool, createPool } from './pool';
export type { PoolOptions } from './pool';

// Type system (C5)
export * from './types/oids';
export { Decimal } from './types/numeric';
export { getCodec, registerType, decodeValue, encodeValue, hasBinaryCodec } from './types/registry';
export type { Codec, TextCodec, BinaryCodec } from './types/registry';
export type { PgDate, PgTime, PgTimestamp, PgInterval } from './types/datetime';

// Server-message decoders (C2) — useful for tests / tools that want to
// inspect individual payloads without driving a real connection.
export {
    decodeRowDescription,
    decodeDataRow,
    decodeCommandComplete,
    decodeReadyForQuery,
    decodeParameterStatus,
    decodeBackendKeyData,
    decodeAuthentication,
    decodeNotification,
} from './protocol/decoder';
export type {
    FieldDescription,
    RawRow,
    CommandCompleteTag,
    TxnStatus,
    ParameterStatus,
    BackendKeyData,
    AuthenticationRequest,
    Notification,
} from './protocol/decoder';

// Errors + notices (C2)
export { PgError, decodeErrorFields, parsePgError } from './error';
export type { PgErrorFields } from './error';
export { parsePgNotice } from './notice';
export type { PgNotice } from './notice';

// Cancel (C6)
export { sendCancelRequest } from './cancel';

// Utilities
export { BufferCursor } from './util/buffer-cursor';
export { cstringByteLen, encodeCString, decodeCString } from './util/cstring';
