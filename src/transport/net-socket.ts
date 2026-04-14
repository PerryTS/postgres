// Cross-environment socket adapter. Perry and Node/Bun both ship a
// Node-compatible `net` module, but `createConnection` has a slightly
// different signature on each side:
//
//   - Perry (perry-stdlib):  net.createConnection(host, port)
//   - Node (node:net):       net.createConnection({ host, port })
//
// This file is the only place in the driver that cares. Everything else
// consumes the returned `Socket` interface, which is the common subset of
// the two event-emitter surfaces (`'connect' | 'data' | 'error' | 'close'`,
// plus `.write`, `.end`, `.destroy`).

import * as net from 'net';

/**
 * The common socket surface used throughout the driver.
 * We intentionally avoid leaking either platform's richer types
 * (Node's `net.Socketet` / Perry's handle-based Socketet) so swap-out stays
 * simple.
 */
export interface Socket {
    write(buf: Buffer): boolean | void;
    end(): void;
    destroy(): void;
    on(event: 'connect', cb: () => void): void;
    on(event: 'data', cb: (buf: Buffer) => void): void;
    on(event: 'error', cb: (err: Error | string) => void): void;
    on(event: 'close', cb: () => void): void;
    /**
     * Detach a previously-attached 'data' listener. Needed before a TLS
     * upgrade on Node — otherwise the plain socket's listener and Node's
     * internal TLS read path race for the same bytes and the handshake
     * stalls. Perry's event model doesn't require detach/reattach, but we
     * expose the method there too as a no-op so callers don't need to
     * branch.
     */
    removeDataListener?(cb: (buf: Buffer) => void): void;
    /**
     * Perry-only: Postgres-style TLS upgrade on an existing socket.
     * On Node, callers should branch to `tls.connect({ socket, ... })`
     * via `src/transport/upgrade-tls.ts`.
     */
    upgradeToTLS?(servername: string, verify: 0 | 1): Promise<void>;
}

/** True when running under Node.js or Bun (both expose `process.versions.node`). */
function isNodeLike(): boolean {
    // The indirection keeps Perry's compiler from seeing bare `process` as
    // a required global — we probe defensively.
    const g = globalThis as { process?: { versions?: { node?: string } } };
    return g.process !== undefined
        && g.process.versions !== undefined
        && typeof g.process.versions.node === 'string';
}

/**
 * Open a plain TCP socket. Returns immediately — `'connect'` fires
 * asynchronously once the handshake completes.
 *
 * Perry and Node both expose `net.createConnection`, but with different
 * signatures (Perry: `(host, port)`; Node: `({host, port})`). We branch
 * at the call site rather than via a single `(net as any)` indirection
 * because Perry's HIR pattern-matches the literal `net.createConnection`
 * call shape to dispatch to its FFI; an `as any` cast would route it
 * through generic JS-style dispatch and skip the native module lookup.
 */
export function openSocket(host: string, port: number): Socket {
    if (isNodeLike()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (net as any).createConnection({ host: host, port: port }) as Socket;
    }
    return net.createConnection(host as never, port as never) as unknown as Socket;
}
