// NoticeResponse — same field encoding as ErrorResponse, different severity.
// Server emits notices for things like `SET` taking effect, implicit
// transactions committing, NOTICE-level RAISE from PL/pgSQL, warnings.

import { decodeErrorFields, PgErrorFields } from './error';

export interface PgNotice extends PgErrorFields {}

/** Parse the payload of a NoticeResponse ('N') into structured fields. */
export function parsePgNotice(payload: Buffer): PgNotice {
    return decodeErrorFields(payload);
}
