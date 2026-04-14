// MD5 challenge authentication (Postgres AuthenticationMD5Password).
//
// Server sends 4 random salt bytes. Client responds with a PasswordMessage
// whose payload is the null-terminated string:
//
//     "md5" + md5_hex(  md5_hex(password + user) + salt_bytes  )
//
// Legacy protocol — kept working because many older managed DBs still
// require it. SCRAM-SHA-256 is preferred on PG 10+.
//
// Crypto APIs (createHash) are available on both Perry's stdlib (via
// perry-stdlib::crypto) and Node, so this file runs unchanged on both.

import { createHash } from 'crypto';

/**
 * Compute the "md5..."-prefixed password string the server expects.
 * Pass the raw salt Buffer directly — do not hex-encode it first.
 */
export function computeMD5Password(user: string, password: string, salt: Buffer): string {
    const inner = md5Hex(Buffer.from(password + user, 'utf8'));
    const outer = md5Hex(Buffer.concat([Buffer.from(inner, 'utf8'), salt]));
    return 'md5' + outer;
}

function md5Hex(input: Buffer): string {
    return createHash('md5').update(input).digest('hex');
}
