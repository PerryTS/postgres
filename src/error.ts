// Structured PgError built from the Postgres ErrorResponse message.
// Shares field parsing with NoticeResponse (both use the same
// "field_type_byte + cstring value" layout).
//
// Field tags come from the Postgres protocol spec (§55.8):
//   S  severity (localized)
//   V  severity (non-localized, PG 9.6+)
//   C  SQLSTATE code
//   M  primary message
//   D  detail
//   H  hint
//   P  cursor position in the original query
//   p  internal position
//   q  internal query text
//   W  where — context call stack
//   s  schema name
//   t  table name
//   c  column name
//   d  data type name
//   n  constraint name
//   F  source-code filename
//   L  source-code line
//   R  source-code routine

import { BufferCursor } from './util/buffer-cursor';

export interface PgErrorFields {
    severity?: string;
    severityNonLocalized?: string;
    code?: string;
    message?: string;
    detail?: string;
    hint?: string;
    position?: string;
    internalPosition?: string;
    internalQuery?: string;
    where?: string;
    schema?: string;
    table?: string;
    column?: string;
    dataType?: string;
    constraint?: string;
    file?: string;
    line?: string;
    routine?: string;
}

/**
 * Structured Postgres error. Extends the built-in Error with every
 * field the server sent, so callers can render rich messages without
 * reparsing a string.
 *
 * The GUI consumer (Tusk) reads `.code` / `.position` / `.message` to
 * surface syntax errors in the query editor, etc.
 */
export class PgError extends Error {
    public readonly severity?: string;
    public readonly severityNonLocalized?: string;
    public readonly code?: string;
    public readonly detail?: string;
    public readonly hint?: string;
    public readonly position?: string;
    public readonly internalPosition?: string;
    public readonly internalQuery?: string;
    public readonly where?: string;
    public readonly schema?: string;
    public readonly table?: string;
    public readonly column?: string;
    public readonly dataType?: string;
    public readonly constraint?: string;
    public readonly file?: string;
    public readonly line?: string;
    public readonly routine?: string;

    constructor(fields: PgErrorFields) {
        super(composeMessage(fields));
        this.name = 'PgError';
        this.severity = fields.severity;
        this.severityNonLocalized = fields.severityNonLocalized;
        this.code = fields.code;
        this.detail = fields.detail;
        this.hint = fields.hint;
        this.position = fields.position;
        this.internalPosition = fields.internalPosition;
        this.internalQuery = fields.internalQuery;
        this.where = fields.where;
        this.schema = fields.schema;
        this.table = fields.table;
        this.column = fields.column;
        this.dataType = fields.dataType;
        this.constraint = fields.constraint;
        this.file = fields.file;
        this.line = fields.line;
        this.routine = fields.routine;
    }
}

/**
 * Compose a single-line `Error.message` from the structured fields so
 * callers that only print `err.message` still see the useful context.
 * Individual fields remain available as properties for code that wants
 * to branch on them.
 */
function composeMessage(fields: PgErrorFields): string {
    const primary = fields.message !== undefined ? fields.message : 'Postgres error';
    const trailers: string[] = [];
    if (fields.detail !== undefined) {
        trailers.push('DETAIL: ' + fields.detail);
    }
    if (fields.hint !== undefined) {
        trailers.push('HINT: ' + fields.hint);
    }
    if (fields.position !== undefined) {
        trailers.push('POSITION: ' + fields.position);
    }
    if (fields.constraint !== undefined) {
        trailers.push('CONSTRAINT: ' + fields.constraint);
    }
    if (trailers.length === 0) {
        return primary;
    }
    return primary + ' — ' + trailers.join('; ');
}

/**
 * Parse the payload of an ErrorResponse ('E') or NoticeResponse ('N')
 * message into its field map. Both messages share the same encoding —
 * a sequence of `field_type_byte + cstring value` pairs terminated by
 * a zero byte.
 */
export function decodeErrorFields(payload: Buffer): PgErrorFields {
    const cur = new BufferCursor(payload, 0);
    const out: PgErrorFields = {};
    while (!cur.done()) {
        const code = cur.readUInt8();
        if (code === 0) {
            break;
        }
        const value = cur.readCString();
        // Per-field dispatch is done with explicit if/else rather than
        // a dynamic object lookup to stay inside Perry's AOT constraints.
        if (code === 0x53) { // 'S'
            out.severity = value;
        } else if (code === 0x56) { // 'V'
            out.severityNonLocalized = value;
        } else if (code === 0x43) { // 'C'
            out.code = value;
        } else if (code === 0x4D) { // 'M'
            out.message = value;
        } else if (code === 0x44) { // 'D'
            out.detail = value;
        } else if (code === 0x48) { // 'H'
            out.hint = value;
        } else if (code === 0x50) { // 'P'
            out.position = value;
        } else if (code === 0x70) { // 'p'
            out.internalPosition = value;
        } else if (code === 0x71) { // 'q'
            out.internalQuery = value;
        } else if (code === 0x57) { // 'W'
            out.where = value;
        } else if (code === 0x73) { // 's'
            out.schema = value;
        } else if (code === 0x74) { // 't'
            out.table = value;
        } else if (code === 0x63) { // 'c'
            out.column = value;
        } else if (code === 0x64) { // 'd'
            out.dataType = value;
        } else if (code === 0x6E) { // 'n'
            out.constraint = value;
        } else if (code === 0x46) { // 'F'
            out.file = value;
        } else if (code === 0x4C) { // 'L'
            out.line = value;
        } else if (code === 0x52) { // 'R'
            out.routine = value;
        }
        // Unknown field codes are ignored; Postgres may add more over time.
    }
    return out;
}

/** Convenience: build a PgError straight from an ErrorResponse payload. */
export function parsePgError(payload: Buffer): PgError {
    return new PgError(decodeErrorFields(payload));
}
