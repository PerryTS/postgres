// A tiny in-process Postgres mock server. Speaks just enough of the wire
// protocol to drive the client's startup → auth → query loop end-to-end
// without requiring a real Postgres. Two canned scripts are supported:
//   - trust:     AuthOK → ParameterStatus+ → BackendKeyData → ReadyForQuery
//                For each inbound Query, respond with a single-column
//                single-row RowDescription/DataRow/CommandComplete/ReadyForQuery.
//   - cleartext: same as trust but first answers AuthenticationCleartextPassword,
//                validates the password, then proceeds.
//
// Payloads are hand-built with the driver's own writer where convenient
// (CommandComplete uses cstring) but server→client encoding is mostly
// inline since we don't have server-side builders in the driver package.

import * as net from 'node:net';
import * as tls from 'node:tls';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import {
    BACKEND_AUTH,
    BACKEND_BACKEND_KEY_DATA,
    BACKEND_BIND_COMPLETE,
    BACKEND_COMMAND_COMPLETE,
    BACKEND_DATA_ROW,
    BACKEND_NO_DATA,
    BACKEND_PARAMETER_STATUS,
    BACKEND_PARSE_COMPLETE,
    BACKEND_READY_FOR_QUERY,
    BACKEND_ROW_DESCRIPTION,
    FRONTEND_BIND,
    FRONTEND_DESCRIBE,
    FRONTEND_EXECUTE,
    FRONTEND_PARSE,
    FRONTEND_PASSWORD,
    FRONTEND_QUERY,
    FRONTEND_SYNC,
    FRONTEND_TERMINATE,
    writeFrame,
} from '../../src';

export interface MockServerOptions {
    authMode: 'trust' | 'cleartext' | 'md5' | 'scram';
    /** Password the server will accept when `authMode !== 'trust'`. */
    password?: string;
    /** Username expected (for md5/scram challenge construction). Defaults to 'perry'. */
    expectedUser?: string;
    /** Canned response for SELECT 1. Default is one row, one column "n" = 1. */
    selectOne?: CannedResponse;
    /** Override for every other SELECT — same shape. */
    defaultSelect?: CannedResponse;
    /**
     * How to respond to the client's SSLRequest:
     *   - `undefined` / `'refuse'` → reply 'N' (server does not support TLS).
     *   - `'reject'`                → reply 'N' (same as refuse, explicit).
     *   - `'accept'`                → reply 'S' and do a server-side TLS handshake
     *                                 using the provided `tlsCert` / `tlsKey` PEMs;
     *                                 further protocol bytes go over TLS.
     */
    ssl?: 'refuse' | 'reject' | 'accept';
    /** PEM-encoded server cert (required when `ssl === 'accept'`). */
    tlsCert?: string | Buffer;
    /** PEM-encoded server key (required when `ssl === 'accept'`). */
    tlsKey?: string | Buffer;
    /**
     * If set, queries matching `/pg_sleep\(/` stall for this many ms
     * before the mock sends CommandComplete. Lets integration tests
     * exercise the cancel path deterministically.
     */
    simulatedSleepMs?: number;
}

export interface CannedResponse {
    columns: { name: string; typeOid: number }[];
    rows: (string | null)[][];
    commandTag: string;
}

const DEFAULT_SELECT_ONE: CannedResponse = {
    columns: [{ name: 'n', typeOid: 23 }],
    rows: [['1']],
    commandTag: 'SELECT 1',
};

const DEFAULT_SELECT_OTHER: CannedResponse = {
    columns: [{ name: 'msg', typeOid: 25 }],
    rows: [['hello']],
    commandTag: 'SELECT 1',
};

export interface MockServer {
    port: number;
    close(): Promise<void>;
}

export function startMockServer(opts: MockServerOptions): Promise<MockServer> {
    // Reset the backend-PID counter on every server start so tests that
    // assert on a specific PID (`expect(conn.backendPid).toBe(42)`) stay
    // deterministic regardless of cross-test ordering.
    NEXT_BACKEND_PID = 42;
    return new Promise((resolve, reject) => {
        const server = net.createServer((sock) => {
            handleConnection(sock, opts);
        });
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (addr === null || typeof addr === 'string') {
                reject(new Error('unexpected address shape'));
                return;
            }
            resolve({
                port: addr.port,
                close: () =>
                    new Promise<void>((res) => {
                        server.close(() => res());
                    }),
            });
        });
        server.on('error', reject);
    });
}

// ─── Per-connection state machine ────────────────────────────────────────────

type Stage =
    | 'awaiting-ssl-or-startup' // first frame can be SSLRequest OR StartupMessage
    | 'awaiting-startup'        // SSLRequest was refused or accepted; now expect Startup
    | 'awaiting-password'       // cleartext / md5
    | 'awaiting-sasl-initial'   // sent AuthSASL, waiting for client-first
    | 'awaiting-sasl-final'     // sent AuthSASLContinue, waiting for client-final
    | 'ready'
    | 'closed';

const SSL_REQUEST_CODE = 80877103;
const CANCEL_REQUEST_CODE = 80877102;

/**
 * Per-process registry of active backends, keyed by PID. Lets a fresh
 * CancelRequest connection find the target connection's cancel handler.
 * Mirrors what real Postgres keeps in its postmaster — in our mock it's
 * just enough to make `conn.cancel()` observable.
 */
interface RegisteredBackend {
    secretKey: number;
    /** Called with the ErrorResponse the target should emit + transition. */
    cancelInFlight(): void;
}
const BACKEND_REGISTRY = new Map<number, RegisteredBackend>();
let NEXT_BACKEND_PID = 42;

interface ScramServerState {
    clientNonce: string;
    serverNonce: string;
    combinedNonce: string;
    salt: Buffer;
    iter: number;
    clientFirstBare: string;
    serverFirst: string;
}

function handleConnection(plainSock: net.Socket, opts: MockServerOptions): void {
    let sock: net.Socket | tls.TLSSocket = plainSock;
    let buf = Buffer.alloc(0);
    let stage: Stage = 'awaiting-ssl-or-startup';
    let md5Salt: Buffer | null = null;
    let scramState: ScramServerState | null = null;
    const expectedUser =
        opts.expectedUser !== undefined ? opts.expectedUser : 'perry';

    // Extended-protocol bookkeeping: last Parse'd SQL and last Bind'd params.
    let parsedSql = '';
    let boundParams: (Buffer | null)[] = [];

    // Per-connection identity for the cancel registry.
    const backendPid = NEXT_BACKEND_PID;
    NEXT_BACKEND_PID += 1;
    const secretKey = (Math.random() * 0x7fffffff) | 0;

    // Long-query simulation state: when a sleep is pending, this callback
    // fires either when the timer elapses (query completes normally) or
    // when a CancelRequest arrives (query aborts with SQLSTATE 57014).
    let sleepTimer: ReturnType<typeof setTimeout> | null = null;
    let sleepResolver: null | ((aborted: boolean) => void) = null;

    const cancelInFlight = (): void => {
        if (sleepResolver !== null) {
            if (sleepTimer !== null) {
                clearTimeout(sleepTimer);
                sleepTimer = null;
            }
            const resolve = sleepResolver;
            sleepResolver = null;
            resolve(true);
        }
    };
    BACKEND_REGISTRY.set(backendPid, { secretKey: secretKey, cancelInFlight: cancelInFlight });

    // Track the active 'data' listener so we can detach it when swapping
    // from the plain socket to the TLSSocket after SSLRequest negotiation.
    // Leaving both listeners attached would double-consume encrypted bytes.
    let currentDataHandler: ((chunk: Buffer) => void) | null = null;

    const attachData = (s: net.Socket | tls.TLSSocket): void => {
        const handler = (chunk: Buffer): void => {
            buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
            buf = drain(buf);
        };
        currentDataHandler = handler;
        s.on('data', handler);
    };

    const detachDataFrom = (s: net.Socket | tls.TLSSocket): void => {
        if (currentDataHandler !== null) {
            s.removeListener('data', currentDataHandler);
            currentDataHandler = null;
        }
    };

    attachData(sock);
    sock.on('close', () => {
        stage = 'closed';
        BACKEND_REGISTRY.delete(backendPid);
    });
    sock.on('error', () => {
        stage = 'closed';
        BACKEND_REGISTRY.delete(backendPid);
    });

    function drain(b: Buffer): Buffer {
        let offset = 0;
        while (offset < b.length) {
            if (stage === 'awaiting-ssl-or-startup' || stage === 'awaiting-startup') {
                if (b.length - offset < 8) {
                    break;
                }
                const total = b.readInt32BE(offset);
                if (b.length - offset < total) {
                    break;
                }
                const code = b.readInt32BE(offset + 4);
                offset += total;

                if (stage === 'awaiting-ssl-or-startup' && code === CANCEL_REQUEST_CODE) {
                    // CancelRequest layout: [len=16][code][pid:int32][secret:int32].
                    // Signal the target backend and close — no reply.
                    if (total === 16) {
                        const pid = b.readInt32BE(offset - 8);
                        const secret = b.readInt32BE(offset - 4);
                        const target = BACKEND_REGISTRY.get(pid);
                        if (target !== undefined && target.secretKey === secret) {
                            target.cancelInFlight();
                        }
                    }
                    sock.end();
                    stage = 'closed';
                    return Buffer.alloc(0);
                }

                if (stage === 'awaiting-ssl-or-startup' && code === SSL_REQUEST_CODE) {
                    // Handle SSLRequest (8 bytes total).
                    if (opts.ssl === 'accept' && opts.tlsCert !== undefined && opts.tlsKey !== undefined) {
                        sock.write(Buffer.from([0x53])); // 'S'
                        // Detach the plain-socket data listener BEFORE wrapping
                        // in TLSSocket — otherwise both the plain listener and
                        // the TLS internals race for the same encrypted bytes.
                        detachDataFrom(plainSock);
                        const tlsSock = new tls.TLSSocket(plainSock, {
                            isServer: true,
                            cert: opts.tlsCert,
                            key: opts.tlsKey,
                        });
                        sock = tlsSock;
                        buf = Buffer.alloc(0);
                        stage = 'awaiting-startup';
                        attachData(tlsSock);
                        tlsSock.on('close', () => { stage = 'closed'; });
                        tlsSock.on('error', () => { stage = 'closed'; });
                        return Buffer.alloc(0);
                    }
                    // Refuse TLS — reply 'N' and continue on the plain socket.
                    sock.write(Buffer.from([0x4E])); // 'N'
                    stage = 'awaiting-startup';
                    continue;
                }

                // StartupMessage.
                if (opts.authMode === 'cleartext') {
                    sendAuthCleartext();
                    stage = 'awaiting-password';
                } else if (opts.authMode === 'md5') {
                    md5Salt = randomBytes(4);
                    sendAuthMd5(md5Salt);
                    stage = 'awaiting-password';
                } else if (opts.authMode === 'scram') {
                    sendAuthSasl(['SCRAM-SHA-256']);
                    stage = 'awaiting-sasl-initial';
                } else {
                    sendAuthOk();
                    sendStartupTail();
                    stage = 'ready';
                }
            } else {
                if (b.length - offset < 5) {
                    break;
                }
                const type = b.readUInt8(offset);
                const lenSelf = b.readInt32BE(offset + 1);
                const total = 1 + lenSelf;
                if (b.length - offset < total) {
                    break;
                }
                const payload = b.subarray(offset + 5, offset + total);
                offset += total;

                if (stage === 'awaiting-password') {
                    handlePassword(payload);
                } else if (stage === 'awaiting-sasl-initial') {
                    handleSaslInitial(payload);
                } else if (stage === 'awaiting-sasl-final') {
                    handleSaslFinal(payload);
                } else if (stage === 'ready') {
                    if (type === FRONTEND_QUERY) {
                        handleQuery(payload);
                    } else if (type === FRONTEND_PARSE) {
                        handleParse(payload);
                    } else if (type === FRONTEND_BIND) {
                        handleBind(payload);
                    } else if (type === FRONTEND_DESCRIBE) {
                        handleDescribe();
                    } else if (type === FRONTEND_EXECUTE) {
                        handleExecute();
                    } else if (type === FRONTEND_SYNC) {
                        sendReadyForQuery();
                    } else if (type === FRONTEND_TERMINATE) {
                        sock.end();
                        stage = 'closed';
                        return b.subarray(offset);
                    }
                }
            }
        }
        return offset > 0 ? b.subarray(offset) : b;
    }

    function handlePassword(payload: Buffer): void {
        const end = payload.indexOf(0);
        const actual = payload.toString('utf8', 0, end >= 0 ? end : payload.length);
        let ok = false;
        if (opts.authMode === 'cleartext') {
            ok = opts.password !== undefined && actual === opts.password;
        } else if (opts.authMode === 'md5') {
            // Recompute the expected "md5..." token and compare.
            if (opts.password !== undefined && md5Salt !== null) {
                const inner = createHash('md5')
                    .update(opts.password + expectedUser)
                    .digest('hex');
                const outer = createHash('md5')
                    .update(Buffer.concat([Buffer.from(inner, 'utf8'), md5Salt]))
                    .digest('hex');
                ok = actual === 'md5' + outer;
            }
        }
        if (ok) {
            sendAuthOk();
            sendStartupTail();
            stage = 'ready';
        } else {
            sendErrorResponse('28P01', 'password authentication failed');
            sock.end();
            stage = 'closed';
        }
    }

    function handleSaslInitial(payload: Buffer): void {
        // Layout: mechanism-name\0 + int32 len + client-first-message bytes.
        const nameEnd = payload.indexOf(0);
        const mechanism = payload.toString('utf8', 0, nameEnd);
        if (mechanism !== 'SCRAM-SHA-256') {
            sendErrorResponse('28000', 'unsupported SASL mechanism: ' + mechanism);
            sock.end();
            stage = 'closed';
            return;
        }
        const len = payload.readInt32BE(nameEnd + 1);
        const cfm = payload.toString('utf8', nameEnd + 5, nameEnd + 5 + len);
        // Strip gs2-header "n,,"
        if (!cfm.startsWith('n,,')) {
            sendErrorResponse('28000', 'malformed SCRAM gs2-header');
            sock.end();
            stage = 'closed';
            return;
        }
        const clientFirstBare = cfm.substring(3);
        // Parse client-first-bare: n=<user>,r=<nonce>
        const attrs = parseScramAttrs(clientFirstBare);
        const clientNonce = attrs.get('r');
        if (clientNonce === undefined) {
            sendErrorResponse('28000', 'client-first-message missing r=');
            sock.end();
            stage = 'closed';
            return;
        }
        const serverNonce = randomBytes(18).toString('base64');
        const combinedNonce = clientNonce + serverNonce;
        const salt = randomBytes(16);
        const iter = 4096;
        const serverFirst =
            'r=' + combinedNonce + ',s=' + salt.toString('base64') + ',i=' + iter;
        scramState = {
            clientNonce: clientNonce,
            serverNonce: serverNonce,
            combinedNonce: combinedNonce,
            salt: salt,
            iter: iter,
            clientFirstBare: clientFirstBare,
            serverFirst: serverFirst,
        };
        sendAuthSaslContinue(Buffer.from(serverFirst, 'utf8'));
        stage = 'awaiting-sasl-final';
    }

    function handleSaslFinal(payload: Buffer): void {
        if (scramState === null || opts.password === undefined) {
            sock.end();
            stage = 'closed';
            return;
        }
        const cfm = payload.toString('utf8');
        const attrs = parseScramAttrs(cfm);
        const proofB64 = attrs.get('p');
        const channelBinding = attrs.get('c');
        const nonce = attrs.get('r');
        if (proofB64 === undefined || channelBinding !== 'biws' || nonce !== scramState.combinedNonce) {
            sendErrorResponse('28000', 'invalid client-final-message');
            sock.end();
            stage = 'closed';
            return;
        }
        // Recompute the expected proof using the known password.
        const saltedPassword = pbkdf2Sync(
            opts.password,
            scramState.salt,
            scramState.iter,
            32,
            'sha256'
        );
        const clientKey = createHmac('sha256', saltedPassword)
            .update(Buffer.from('Client Key', 'utf8'))
            .digest();
        const storedKey = createHash('sha256').update(clientKey).digest();
        const clientFinalWithoutProof = 'c=biws,r=' + scramState.combinedNonce;
        const authMessage =
            scramState.clientFirstBare + ',' + scramState.serverFirst + ',' + clientFinalWithoutProof;
        const clientSignature = createHmac('sha256', storedKey)
            .update(Buffer.from(authMessage, 'utf8'))
            .digest();
        const expectedProof = Buffer.alloc(clientKey.length);
        for (let i = 0; i < clientKey.length; i++) {
            expectedProof[i] = clientKey[i] ^ clientSignature[i];
        }
        if (proofB64 !== expectedProof.toString('base64')) {
            sendErrorResponse('28P01', 'SCRAM authentication failed');
            sock.end();
            stage = 'closed';
            return;
        }
        const serverKey = createHmac('sha256', saltedPassword)
            .update(Buffer.from('Server Key', 'utf8'))
            .digest();
        const serverSignature = createHmac('sha256', serverKey)
            .update(Buffer.from(authMessage, 'utf8'))
            .digest();
        sendAuthSaslFinal(Buffer.from('v=' + serverSignature.toString('base64'), 'utf8'));
        sendAuthOk();
        sendStartupTail();
        stage = 'ready';
    }

    function parseScramAttrs(s: string): Map<string, string> {
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

    function handleQuery(payload: Buffer): void {
        const end = payload.indexOf(0);
        const sql = payload
            .toString('utf8', 0, end >= 0 ? end : payload.length)
            .trim()
            .toLowerCase();
        const canned = pickResponse(sql, []);
        sendRowDescription(canned.columns);
        for (const row of canned.rows) {
            sendDataRow(row);
        }
        const needsSleep = opts.simulatedSleepMs !== undefined
            && opts.simulatedSleepMs > 0
            && /pg_sleep\s*\(/.test(sql);
        if (needsSleep) {
            waitWithCancelCheck(opts.simulatedSleepMs!, (aborted) => {
                if (aborted) {
                    sendQueryCanceled();
                } else {
                    sendCommandComplete(canned.commandTag);
                }
                sendReadyForQuery();
            });
        } else {
            sendCommandComplete(canned.commandTag);
            sendReadyForQuery();
        }
    }

    /** Run `done(aborted)` after `ms` OR immediately on CancelRequest. */
    function waitWithCancelCheck(ms: number, done: (aborted: boolean) => void): void {
        sleepResolver = (aborted: boolean): void => {
            done(aborted);
        };
        sleepTimer = setTimeout(() => {
            if (sleepResolver !== null) {
                const resolve = sleepResolver;
                sleepResolver = null;
                sleepTimer = null;
                resolve(false);
            }
        }, ms);
    }

    // ── Extended-protocol handlers (Parse/Bind/Describe/Execute/Sync) ─────

    function handleParse(payload: Buffer): void {
        // Payload: name\0 sql\0 nParamOids:int16 (oid:int32)*
        const nameEnd = payload.indexOf(0);
        const sqlStart = nameEnd + 1;
        const sqlEnd = payload.indexOf(0, sqlStart);
        parsedSql = payload.toString('utf8', sqlStart, sqlEnd);
        sock.write(writeFrame(BACKEND_PARSE_COMPLETE, Buffer.alloc(0)));
    }

    function handleBind(payload: Buffer): void {
        // Walk the Bind frame to capture parameter values for echo modes.
        let pos = 0;
        const portalEnd = payload.indexOf(0, pos);
        pos = portalEnd + 1;
        const stmtEnd = payload.indexOf(0, pos);
        pos = stmtEnd + 1;
        const nFmt = payload.readInt16BE(pos);
        pos += 2 + nFmt * 2;
        const nVals = payload.readInt16BE(pos);
        pos += 2;
        const captured: (Buffer | null)[] = new Array(nVals);
        for (let i = 0; i < nVals; i++) {
            const len = payload.readInt32BE(pos);
            pos += 4;
            if (len === -1) {
                captured[i] = null;
            } else {
                captured[i] = Buffer.from(payload.subarray(pos, pos + len));
                pos += len;
            }
        }
        boundParams = captured;
        sock.write(writeFrame(BACKEND_BIND_COMPLETE, Buffer.alloc(0)));
    }

    function handleDescribe(): void {
        // Emit a RowDescription shaped to whatever the eventual Execute
        // will return. For the param-echo path we mirror the types the
        // client asked for via the SQL template's ::type casts; for
        // unknown shapes we fall back to a single text column.
        const canned = pickResponse(parsedSql.toLowerCase(), boundParams);
        if (canned.columns.length === 0) {
            sock.write(writeFrame(BACKEND_NO_DATA, Buffer.alloc(0)));
        } else {
            sendRowDescription(canned.columns);
        }
    }

    function handleExecute(): void {
        const canned = pickResponse(parsedSql.toLowerCase(), boundParams);
        for (const row of canned.rows) {
            sendDataRow(row);
        }
        sendCommandComplete(canned.commandTag);
        // Note: ReadyForQuery is sent on receipt of Sync, not Execute.
    }

    // Decide what to send back given the SQL (lower-cased) and bound params.
    // Special paths:
    //   - "select $1::<type>"  → echo the first param as a single column
    //     of the requested type OID. Type name → OID mapping covers the
    //     common cases C5 tests exercise.
    //   - "select 1"           → canned one-column "n"=1.
    //   - everything else      → opts.defaultSelect or single-column "hello".
    function pickResponse(sql: string, params: (Buffer | null)[]): CannedResponse {
        // Echo: SELECT $1::<type>
        const m = sql.match(/^\s*select\s+\$1::([a-z0-9_]+)\s*;?\s*$/);
        if (m !== null && params.length >= 1) {
            const typeName = m[1];
            const oid = typeNameToOid(typeName);
            const cell = params[0] === null ? null : params[0].toString('utf8');
            return {
                columns: [{ name: '?column?', typeOid: oid }],
                rows: [[cell]],
                commandTag: 'SELECT 1',
            };
        }
        if (sql === 'select 1' || sql === 'select 1;') {
            return opts.selectOne !== undefined ? opts.selectOne : DEFAULT_SELECT_ONE;
        }
        return opts.defaultSelect !== undefined ? opts.defaultSelect : DEFAULT_SELECT_OTHER;
    }

    function typeNameToOid(name: string): number {
        if (name === 'int2') return 21;
        if (name === 'int4' || name === 'integer') return 23;
        if (name === 'int8' || name === 'bigint') return 20;
        if (name === 'float4' || name === 'real') return 700;
        if (name === 'float8' || name === 'double precision') return 701;
        if (name === 'bool' || name === 'boolean') return 16;
        if (name === 'text') return 25;
        if (name === 'varchar') return 1043;
        if (name === 'bytea') return 17;
        if (name === 'uuid') return 2950;
        if (name === 'json') return 114;
        if (name === 'jsonb') return 3802;
        if (name === 'numeric') return 1700;
        if (name === 'date') return 1082;
        if (name === 'time') return 1083;
        if (name === 'timestamp') return 1114;
        if (name === 'timestamptz') return 1184;
        return 25; // text fallback
    }

    // ── Protocol writers (server → client) ────────────────────────────────

    function sendAuthCleartext(): void {
        const payload = Buffer.alloc(4);
        payload.writeInt32BE(3, 0);
        sock.write(writeFrame(BACKEND_AUTH, payload));
    }

    function sendAuthMd5(salt: Buffer): void {
        const payload = Buffer.alloc(4 + 4);
        payload.writeInt32BE(5, 0);
        salt.copy(payload, 4);
        sock.write(writeFrame(BACKEND_AUTH, payload));
    }

    function sendAuthSasl(mechanisms: string[]): void {
        const parts: Buffer[] = [Buffer.alloc(4)];
        parts[0].writeInt32BE(10, 0);
        for (const m of mechanisms) {
            parts.push(Buffer.from(m + '\0', 'utf8'));
        }
        parts.push(Buffer.from([0])); // terminating empty mechanism
        sock.write(writeFrame(BACKEND_AUTH, Buffer.concat(parts)));
    }

    function sendAuthSaslContinue(data: Buffer): void {
        const payload = Buffer.concat([Buffer.alloc(4), data]);
        payload.writeInt32BE(11, 0);
        sock.write(writeFrame(BACKEND_AUTH, payload));
    }

    function sendAuthSaslFinal(data: Buffer): void {
        const payload = Buffer.concat([Buffer.alloc(4), data]);
        payload.writeInt32BE(12, 0);
        sock.write(writeFrame(BACKEND_AUTH, payload));
    }

    function sendAuthOk(): void {
        const payload = Buffer.alloc(4);
        payload.writeInt32BE(0, 0);
        sock.write(writeFrame(BACKEND_AUTH, payload));
    }

    function sendStartupTail(): void {
        sendParameterStatus('server_version', '16.0');
        sendParameterStatus('TimeZone', 'UTC');
        sendParameterStatus('client_encoding', 'UTF8');
        sendBackendKeyData(backendPid, secretKey);
        sendReadyForQuery();
    }

    function sendParameterStatus(name: string, value: string): void {
        const n = Buffer.from(name + '\0', 'utf8');
        const v = Buffer.from(value + '\0', 'utf8');
        sock.write(writeFrame(BACKEND_PARAMETER_STATUS, Buffer.concat([n, v])));
    }

    function sendBackendKeyData(pid: number, secret: number): void {
        const payload = Buffer.alloc(8);
        payload.writeInt32BE(pid, 0);
        payload.writeInt32BE(secret, 4);
        sock.write(writeFrame(BACKEND_BACKEND_KEY_DATA, payload));
    }

    function sendQueryCanceled(): void {
        // ErrorResponse with SQLSTATE 57014 — matches what a real PG emits
        // when a query is canceled via CancelRequest.
        const fields: Buffer[] = [
            Buffer.from([0x53]), Buffer.from('ERROR\0', 'utf8'),
            Buffer.from([0x43]), Buffer.from('57014\0', 'utf8'),
            Buffer.from([0x4D]), Buffer.from('canceling statement due to user request\0', 'utf8'),
            Buffer.from([0]),
        ];
        sock.write(writeFrame(0x45, Buffer.concat(fields))); // 'E'
    }

    function sendReadyForQuery(): void {
        sock.write(writeFrame(BACKEND_READY_FOR_QUERY, Buffer.from([0x49])));
    }

    function sendRowDescription(cols: { name: string; typeOid: number }[]): void {
        const parts: Buffer[] = [];
        const count = Buffer.alloc(2);
        count.writeInt16BE(cols.length, 0);
        parts.push(count);
        for (const col of cols) {
            parts.push(Buffer.from(col.name + '\0', 'utf8'));
            const tail = Buffer.alloc(18);
            tail.writeInt32BE(0, 0);      // tableOid
            tail.writeInt16BE(0, 4);      // columnAttrNum
            tail.writeInt32BE(col.typeOid, 6);
            tail.writeInt16BE(-1, 10);    // typeSize (variable)
            tail.writeInt32BE(-1, 12);    // typeModifier
            tail.writeInt16BE(0, 16);     // format = text
            parts.push(tail);
        }
        sock.write(writeFrame(BACKEND_ROW_DESCRIPTION, Buffer.concat(parts)));
    }

    function sendDataRow(cells: (string | null)[]): void {
        const parts: Buffer[] = [];
        const count = Buffer.alloc(2);
        count.writeInt16BE(cells.length, 0);
        parts.push(count);
        for (const c of cells) {
            if (c === null) {
                const n = Buffer.alloc(4);
                n.writeInt32BE(-1, 0);
                parts.push(n);
            } else {
                const val = Buffer.from(c, 'utf8');
                const len = Buffer.alloc(4);
                len.writeInt32BE(val.length, 0);
                parts.push(len, val);
            }
        }
        sock.write(writeFrame(BACKEND_DATA_ROW, Buffer.concat(parts)));
    }

    function sendCommandComplete(tag: string): void {
        const payload = Buffer.from(tag + '\0', 'utf8');
        sock.write(writeFrame(BACKEND_COMMAND_COMPLETE, payload));
    }

    function sendErrorResponse(code: string, message: string): void {
        const parts: Buffer[] = [
            Buffer.from([0x53]), Buffer.from('ERROR\0', 'utf8'),
            Buffer.from([0x43]), Buffer.from(code + '\0', 'utf8'),
            Buffer.from([0x4D]), Buffer.from(message + '\0', 'utf8'),
            Buffer.from([0]),
        ];
        sock.write(writeFrame(0x45 /* 'E' */, Buffer.concat(parts)));
    }
}
