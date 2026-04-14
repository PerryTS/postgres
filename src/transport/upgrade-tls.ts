// Perry-vs-Node branch for TLS upgrade on an existing socket.
//
// Postgres negotiates TLS mid-stream: the client writes an 8-byte
// SSLRequest over plain TCP, the server replies with a single byte
// ('S' for "yes, starting TLS" or 'N' for "plain only"), and on 'S' both
// sides perform a TLS handshake on the same socket.
//
// The two platforms expose this differently:
//   - Perry (perry-stdlib):
//         await sock.upgradeToTLS(servername, verifyFlag)
//     swaps the underlying transport from TcpStream to TlsStream in place.
//     The caller keeps the same handle; `'data'` events continue firing
//     with plaintext bytes once the handshake completes.
//
//   - Node / Bun (node:tls):
//         const tlsSock = tls.connect({ socket: plain, servername, rejectUnauthorized })
//     returns a *new* TLSSocket wrapping the plain one. The plain socket's
//     data/error/close events no longer fire on the original handle — the
//     caller must rewire listeners to `tlsSock`.
//
// This file is the only place in the driver that cares about that
// difference. Callers should treat the returned Socket as the
// authoritative handle post-upgrade, rewiring their listeners when it
// isn't referentially identical to the input (Perry case).

import type { Socket } from './net-socket';

export interface TlsUpgradeOpts {
    /**
     * Server name for SNI and (when `verify` is true) hostname validation.
     * Typically the user-supplied `host` option from ConnectOptions.
     */
    servername: string;
    /**
     * `true`  → verify the full cert chain against the system trust store
     *           plus the hostname (sslmode=verify-full).
     * `false` → accept any certificate (sslmode=require; suitable for
     *           local dev against self-signed certs, **never** for prod).
     */
    verify: boolean;
}

/**
 * Upgrade `sock` from plain TCP to TLS in place. Returns the post-upgrade
 * handle — which **may or may not** be the same object as the input:
 *
 *   - Perry:  returns the same `Socket` (transport swapped internally)
 *   - Node:   returns a new `Socket` wrapping the plain one
 *
 * If the returned handle is a different object, the caller must attach
 * its `'data' | 'error' | 'close'` listeners to the new handle.
 */
export async function upgradeToTls(sock: Socket, opts: TlsUpgradeOpts): Promise<Socket> {
    if (typeof sock.upgradeToTLS === 'function') {
        await sock.upgradeToTLS(opts.servername, opts.verify ? 1 : 0);
        return sock;
    }
    return upgradeNode(sock, opts);
}

async function upgradeNode(sock: Socket, opts: TlsUpgradeOpts): Promise<Socket> {
    const tls = await import('node:tls');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plainAny = sock as any;

    // Known Bun 1.3.5 bug: `tls.connect({socket})` and
    // `new tls.TLSSocket(socket, {isServer:false})` both silently stall the
    // handshake — no 'secure' / 'error' fires. Node works fine; Perry has
    // its own in-place upgrade at the stdlib level. We still use the stock
    // Node API here because that's the shipping target for Node consumers;
    // the tls.test.ts suite skips handshake-requiring cases on Bun.
    //
    // RFC 6066: SNI `servername` must be a DNS name — strict Node versions
    // (v22+) reject IP addresses. Omit SNI entirely when the host looks
    // like an IP. Hostname verification still works in verify-full mode
    // via the cert's subjectAltName IP: entries.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connectOpts: any = {
        socket: plainAny,
        rejectUnauthorized: opts.verify,
    };
    if (!isIpLiteral(opts.servername)) {
        connectOpts.servername = opts.servername;
    }
    const tlsSock = tls.connect(connectOpts);

    await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (err: Error | null): void => {
            if (settled) {
                return;
            }
            settled = true;
            tlsSock.removeListener('secureConnect', onSecure);
            tlsSock.removeListener('error', onError);
            if (err !== null) {
                reject(err);
            } else {
                resolve();
            }
        };
        const onSecure = (): void => {
            settle(null);
        };
        const onError = (e: Error): void => {
            settle(e);
        };
        tlsSock.once('secureConnect', onSecure);
        tlsSock.once('error', onError);
    });

    return tlsSock as unknown as Socket;
}

/**
 * Cheap RFC 6066 check — returns true for dotted-quad IPv4 or bracketed /
 * colon-bearing IPv6. Deliberately permissive: false positives just mean
 * SNI is skipped (cert verification still uses the hostname via the
 * cert's subjectAltName entries).
 */
function isIpLiteral(s: string): boolean {
    if (s.indexOf(':') >= 0) {
        return true; // IPv6
    }
    // IPv4: four dot-separated decimal octets.
    let dots = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c === 0x2e /* '.' */) {
            dots++;
        } else if (c < 0x30 || c > 0x39) {
            return false;
        }
    }
    return dots === 3;
}
