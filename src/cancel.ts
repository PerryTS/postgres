// CancelRequest — the Postgres cancellation primitive.
//
// Cancel goes over a *separate* fresh TCP connection to the same host:port.
// The 16-byte request carries the backend PID and secret key of the
// connection whose current query should be interrupted. Both values come
// from BackendKeyData ('K') which the server sent during startup.
//
// Important properties:
//   - Fire-and-forget. The server never replies. We send the bytes, flush,
//     close our end. The target query may already have finished — that's
//     a legal no-op on the server side.
//   - No authentication. Any client with (host, port, pid, secret) can
//     cancel. The secret key's randomness is the only protection.
//   - Always plain TCP. Even when the original connection is TLS, libpq
//     sends the cancel in plaintext because the payload is tiny and the
//     server expects it that way. We match that convention.

import { writeCancelRequest } from './protocol/writer';
import { openSocket } from './transport/net-socket';

/**
 * Send a CancelRequest and wait only until the bytes are flushed and our
 * end of the socket is closed. Rejects only on local I/O errors (refused
 * connection, DNS failure, etc.) — never on "query was already done" or
 * "pid/secret mismatch", because the server doesn't tell us.
 */
export function sendCancelRequest(
    host: string,
    port: number,
    backendPid: number,
    secretKey: number
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (backendPid === 0) {
            // Startup never completed → no PID to cancel against.
            resolve();
            return;
        }
        const sock = openSocket(host, port);
        let settled = false;
        const settle = (err: Error | null): void => {
            if (settled) {
                return;
            }
            settled = true;
            if (err !== null) {
                reject(err);
            } else {
                resolve();
            }
        };
        sock.on('connect', () => {
            try {
                sock.write(writeCancelRequest(backendPid, secretKey));
                sock.end();
            } catch (e) {
                settle(e as Error);
            }
        });
        sock.on('close', () => {
            settle(null);
        });
        sock.on('error', (e: Error | string) => {
            settle(typeof e === 'string' ? new Error(e) : e);
        });
    });
}
