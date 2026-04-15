// SCRAM-SHA-256 client (RFC 5802 + RFC 7677).
//
// Three-step exchange driven by the server's Authentication* messages:
//
//   1. Server sends AuthenticationSASL with a mechanism list.
//      Client picks SCRAM-SHA-256 and replies with a SASLInitialResponse
//      whose body is:
//          mechanism-name\0
//          int32 len-of-client-first
//          client-first-message = "n,,n=<saslname>,r=<client-nonce>"
//
//   2. Server replies with AuthenticationSASLContinue carrying
//      `r=<combined-nonce>,s=<salt-b64>,i=<iter-count>`.
//      Client derives SaltedPassword via PBKDF2-HMAC-SHA256 and sends
//      SASLResponse with `c=biws,r=<combined-nonce>,p=<proof-b64>`.
//
//   3. Server replies with AuthenticationSASLFinal carrying `v=<sig-b64>`.
//      Client verifies the server signature, then expects an
//      AuthenticationOK to end the exchange.
//
// Channel-binding (SCRAM-SHA-256-PLUS) is deliberately not implemented —
// the Postgres server only requires it for clients that advertise support,
// and verify-full TLS gives us comparable man-in-the-middle protection.
//
// Crypto primitives come from `crypto.{createHash,createHmac,pbkdf2Sync,randomBytes}`,
// all of which are available on both Perry's stdlib and Node.

// Perry's crypto codegen only recognizes the namespace-import form
// (`crypto.crypto.createHash(...)`) as the target of its chain-collapse and
// `.digest()` Buffer-return routing. Named imports go through a
// different path that returns a hex string even when we want raw bytes.
// Using `import * as crypto` keeps the one source file on both Node and
// Perry without a fork.
import * as crypto from 'crypto';

export interface ScramState {
    mechanism: 'SCRAM-SHA-256';
    /** The nonce the client sent; server must echo it as the prefix of `r=`. */
    clientNonce: string;
    /** The raw "n=user,r=nonce" string — a component of AuthMessage. */
    clientFirstBare: string;
    username: string;
    password: string;
    /** Populated by `scramContinue`; checked by `scramVerifyServerFinal`. */
    serverSignatureB64: string | null;
}

export interface ScramInitResult {
    state: ScramState;
    /** Payload for a raw 'p' (PasswordMessage) frame — layout per spec:
     *  mechanism-name\0 + int32 len + client-first-message bytes. */
    initialResponsePayload: Buffer;
}

/**
 * Kick off a SCRAM-SHA-256 exchange. `mechanisms` comes from the
 * AuthenticationSASL message and must contain "SCRAM-SHA-256".
 */
export function scramInit(
    username: string,
    password: string,
    mechanisms: string[]
): ScramInitResult {
    if (!mechanisms.includes('SCRAM-SHA-256')) {
        throw new Error(
            'server does not offer SCRAM-SHA-256 (offered: ' + mechanisms.join(',') + ')'
        );
    }
    // 18 bytes of randomness → 24 base64 characters. Matches libpq's
    // default and fits comfortably under the 255-char server-side cap.
    const clientNonce = crypto.randomBytes(18).toString('base64');
    const clientFirstBare = 'n=' + saslName(username) + ',r=' + clientNonce;

    // The `gs2-header` is "n,," — no channel binding, no authzid. Base64
    // of that string is literally "biws", which is what we echo back in
    // `c=biws` in the client-final-message.
    const clientFirstMessage = 'n,,' + clientFirstBare;
    const clientFirstBytes = Buffer.from(clientFirstMessage, 'utf8');

    const mechBytes = Buffer.from('SCRAM-SHA-256\0', 'utf8');
    const lenHeader = Buffer.alloc(4);
    lenHeader.writeInt32BE(clientFirstBytes.length, 0);
    const initialResponsePayload = Buffer.concat([mechBytes, lenHeader, clientFirstBytes]);

    return {
        state: {
            mechanism: 'SCRAM-SHA-256',
            clientNonce: clientNonce,
            clientFirstBare: clientFirstBare,
            username: username,
            password: password,
            serverSignatureB64: null,
        },
        initialResponsePayload: initialResponsePayload,
    };
}

/**
 * Handle AuthenticationSASLContinue. Returns the raw payload for the next
 * 'p' frame — the client-final-message. The state is updated in place with
 * the expected server signature (checked later in `scramVerifyServerFinal`).
 */
export function scramContinue(state: ScramState, serverFirst: Buffer): Buffer {
    const serverFirstStr = serverFirst.toString('utf8');
    const attrs = parseAttrs(serverFirstStr);

    const combinedNonce = attrs.get('r');
    const saltB64 = attrs.get('s');
    const iterStr = attrs.get('i');
    if (combinedNonce === undefined || saltB64 === undefined || iterStr === undefined) {
        throw new Error('malformed server-first-message: ' + serverFirstStr);
    }
    if (!combinedNonce.startsWith(state.clientNonce)) {
        throw new Error('server nonce does not extend client nonce');
    }
    const iter = parseInt(iterStr, 10);
    if (isNaN(iter) || iter < 1) {
        throw new Error('invalid iteration count: ' + iterStr);
    }
    const salt = Buffer.from(saltB64, 'base64');

    // Per RFC 5802 §3:
    //   SaltedPassword  = PBKDF2(HMAC-SHA-256, password, salt, iter, 32)
    //   ClientKey       = HMAC-SHA-256(SaltedPassword, "Client Key")
    //   StoredKey       = SHA-256(ClientKey)
    //   AuthMessage     = client-first-bare + "," + server-first + "," + client-final-no-proof
    //   ClientSignature = HMAC-SHA-256(StoredKey, AuthMessage)
    //   ClientProof     = ClientKey XOR ClientSignature
    //   ServerKey       = HMAC-SHA-256(SaltedPassword, "Server Key")
    //   ServerSignature = HMAC-SHA-256(ServerKey, AuthMessage)
    const saltedPassword = crypto.pbkdf2Sync(state.password, salt, iter, 32, 'sha256');
    const clientKey = hmacSha256(saltedPassword, Buffer.from('Client Key', 'utf8'));
    const storedKey = sha256(clientKey);

    const clientFinalWithoutProof = 'c=biws,r=' + combinedNonce;
    const authMessage =
        state.clientFirstBare + ',' + serverFirstStr + ',' + clientFinalWithoutProof;

    const clientSignature = hmacSha256(storedKey, Buffer.from(authMessage, 'utf8'));
    const clientProof = xorBuffers(clientKey, clientSignature);

    const serverKey = hmacSha256(saltedPassword, Buffer.from('Server Key', 'utf8'));
    const serverSignature = hmacSha256(serverKey, Buffer.from(authMessage, 'utf8'));
    state.serverSignatureB64 = serverSignature.toString('base64');

    const clientFinal = clientFinalWithoutProof + ',p=' + clientProof.toString('base64');
    return Buffer.from(clientFinal, 'utf8');
}

/**
 * Handle AuthenticationSASLFinal. Verifies that the server proved it
 * knows the shared secret by returning the same ServerSignature we derived.
 * Throws on mismatch — connection should be aborted.
 */
export function scramVerifyServerFinal(state: ScramState, serverFinal: Buffer): void {
    const attrs = parseAttrs(serverFinal.toString('utf8'));
    const serverErr = attrs.get('e');
    if (serverErr !== undefined) {
        throw new Error('SCRAM error from server: ' + serverErr);
    }
    const verifier = attrs.get('v');
    if (verifier === undefined) {
        throw new Error('server-final-message has no verifier attribute');
    }
    if (state.serverSignatureB64 === null) {
        throw new Error('scramVerifyServerFinal called before scramContinue');
    }
    if (!stringEqual(verifier, state.serverSignatureB64)) {
        throw new Error('server signature verification failed');
    }
}

/**
 * Explicit byte-by-byte string equality. Perry's `===` on strings produced
 * by different origins (Map.get of a substring vs a toString('base64')
 * result) doesn't always collapse to value equality — the comparison
 * falls through to pointer identity and returns false even when the
 * UTF-16 contents are identical. Node/bun honor value equality directly,
 * so this helper is a no-op on those runtimes.
 */
function stringEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a.charCodeAt(i) !== b.charCodeAt(i)) {
            return false;
        }
    }
    return true;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function sha256(data: Buffer): Buffer {
    return crypto.createHash('sha256').update(data).digest();
}

function hmacSha256(key: Buffer, data: Buffer): Buffer {
    return crypto.createHmac('sha256', key).update(data).digest();
}

function xorBuffers(a: Buffer, b: Buffer): Buffer {
    // Use readUInt8/writeUInt8 rather than bracket indexing: Perry's
    // native codegen doesn't lower `buf[i]` for Buffer receivers (reads
    // as undefined, writes are no-ops).
    const len = a.length < b.length ? a.length : b.length;
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
        out.writeUInt8(a.readUInt8(i) ^ b.readUInt8(i), i);
    }
    return out;
}

/**
 * Parse `k1=v1,k2=v2,…` into a Map. Values can contain `=` (they're everything
 * from the first `=` to the next `,`).
 */
function parseAttrs(s: string): Map<string, string> {
    const out = new Map<string, string>();
    let start = 0;
    for (let i = 0; i <= s.length; i++) {
        if (i === s.length || s.charAt(i) === ',') {
            const part = s.substring(start, i);
            const eq = part.indexOf('=');
            if (eq > 0) {
                out.set(part.substring(0, eq), part.substring(eq + 1));
            }
            start = i + 1;
        }
    }
    return out;
}

/**
 * Escape SCRAM attribute characters in a username per RFC 5802 §5.1:
 *   '='  → '=3D'
 *   ','  → '=2C'
 * (SASLprep normalization — RFC 4013 — is deliberately skipped; it's
 *  unnecessary for ASCII usernames, which is the overwhelming majority,
 *  and neither libpq nor node-postgres apply it either.)
 */
function saslName(username: string): string {
    let out = '';
    for (let i = 0; i < username.length; i++) {
        const c = username.charAt(i);
        if (c === '=') {
            out = out + '=3D';
        } else if (c === ',') {
            out = out + '=2C';
        } else {
            out = out + c;
        }
    }
    return out;
}
