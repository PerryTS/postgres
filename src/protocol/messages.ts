// Postgres wire-protocol v3 message type constants. Values are the single
// ASCII byte that identifies each message type on the wire (per
// https://www.postgresql.org/docs/current/protocol-message-formats.html).

// ─── Server → client ─────────────────────────────────────────────────────────

export const BACKEND_AUTH                  = 0x52; // 'R'  Authentication*
export const BACKEND_PARAMETER_STATUS      = 0x53; // 'S'  ParameterStatus
export const BACKEND_BACKEND_KEY_DATA      = 0x4B; // 'K'  BackendKeyData
export const BACKEND_READY_FOR_QUERY       = 0x5A; // 'Z'  ReadyForQuery
export const BACKEND_ROW_DESCRIPTION       = 0x54; // 'T'  RowDescription
export const BACKEND_DATA_ROW              = 0x44; // 'D'  DataRow
export const BACKEND_COMMAND_COMPLETE      = 0x43; // 'C'  CommandComplete
export const BACKEND_ERROR_RESPONSE        = 0x45; // 'E'  ErrorResponse
export const BACKEND_NOTICE_RESPONSE       = 0x4E; // 'N'  NoticeResponse
export const BACKEND_EMPTY_QUERY_RESPONSE  = 0x49; // 'I'  EmptyQueryResponse
export const BACKEND_NO_DATA               = 0x6E; // 'n'  NoData
export const BACKEND_PARAMETER_DESCRIPTION = 0x74; // 't'  ParameterDescription
export const BACKEND_PARSE_COMPLETE        = 0x31; // '1'  ParseComplete
export const BACKEND_BIND_COMPLETE         = 0x32; // '2'  BindComplete
export const BACKEND_CLOSE_COMPLETE        = 0x33; // '3'  CloseComplete
export const BACKEND_NOTIFICATION          = 0x41; // 'A'  NotificationResponse
export const BACKEND_PORTAL_SUSPENDED      = 0x73; // 's'  PortalSuspended
export const BACKEND_COPY_IN_RESPONSE      = 0x47; // 'G'
export const BACKEND_COPY_OUT_RESPONSE     = 0x48; // 'H'
export const BACKEND_COPY_DATA             = 0x64; // 'd'
export const BACKEND_COPY_DONE             = 0x63; // 'c'

// ─── Client → server ─────────────────────────────────────────────────────────
// Some bytes overlap with server-to-client (E, D, C, S) — interpretation
// is always unambiguous because the direction is known from context.

export const FRONTEND_QUERY                = 0x51; // 'Q'  Query (simple)
export const FRONTEND_PARSE                = 0x50; // 'P'  Parse
export const FRONTEND_BIND                 = 0x42; // 'B'  Bind
export const FRONTEND_EXECUTE              = 0x45; // 'E'  Execute
export const FRONTEND_DESCRIBE             = 0x44; // 'D'  Describe
export const FRONTEND_CLOSE                = 0x43; // 'C'  Close
export const FRONTEND_SYNC                 = 0x53; // 'S'  Sync
export const FRONTEND_TERMINATE            = 0x58; // 'X'  Terminate
export const FRONTEND_FLUSH                = 0x48; // 'H'  Flush
export const FRONTEND_PASSWORD             = 0x70; // 'p'  Password / SASLInitialResponse / SASLResponse
export const FRONTEND_COPY_DATA            = 0x64; // 'd'
export const FRONTEND_COPY_DONE            = 0x63; // 'c'
export const FRONTEND_COPY_FAIL            = 0x66; // 'f'

// ─── Magic numbers used in the typeless startup / cancel / SSL frames ────────

// Protocol version 3.0 encoded as (3 << 16) | 0.
export const PROTOCOL_VERSION    = 196608;

// Packed (1234 << 16) | 5679 — SSL request sentinel.
export const SSL_REQUEST_CODE    = 80877103;

// Packed (1234 << 16) | 5678 — cancellation request sentinel.
export const CANCEL_REQUEST_CODE = 80877102;

// Packed (1234 << 16) | 5680 — GSSAPI request sentinel (not supported in v1).
export const GSS_REQUEST_CODE    = 80877104;

// ─── Authentication sub-types (the int32 following 'R' in a BACKEND_AUTH) ────

export const AUTH_OK                      = 0;
export const AUTH_KERBEROS_V5             = 2;  // deprecated, not supported
export const AUTH_CLEARTEXT_PASSWORD      = 3;
export const AUTH_MD5_PASSWORD            = 5;
export const AUTH_SCM_CREDENTIAL          = 6;  // not supported
export const AUTH_GSS                     = 7;  // deferred
export const AUTH_GSS_CONTINUE            = 8;  // deferred
export const AUTH_SSPI                    = 9;  // deferred
export const AUTH_SASL                    = 10; // SCRAM-SHA-256 entry
export const AUTH_SASL_CONTINUE           = 11;
export const AUTH_SASL_FINAL              = 12;

// ─── Transaction status byte following a ReadyForQuery ('Z') payload ─────────

export const TXN_IDLE           = 0x49; // 'I'  no active transaction
export const TXN_IN_TRANSACTION = 0x54; // 'T'  inside a transaction block
export const TXN_IN_FAILED      = 0x45; // 'E'  inside a failed transaction
