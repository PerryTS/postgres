// Connection-string parsing. Accepts the two libpq URL shapes:
//
//   postgres://user:password@host:port/database?option=value&...
//   postgresql://user:password@host:port/database?option=value&...
//
// Also accepts `postgres://host/db` without credentials, and query-string
// options map directly onto the same options objects the driver already
// consumes (`sslmode`, `application_name`, `connect_timeout`).
//
// Everything else on the URL is ignored — consumers who need the full
// libpq option set can supplement with explicit `ConnectOptions` fields.
//
// Not implemented (deliberately, for now): key=value "DSN" strings
// (`host=localhost dbname=postgres`), libpq service files, unix-socket
// hosts. All three are easy to add later if consumers ask.

import type { ConnectOptions } from './connection';

export interface ParsedConnectionString {
    host: string;
    port: number;
    user: string;
    database: string;
    password?: string;
    applicationName?: string;
    connectTimeoutMs?: number;
    ssl?: ConnectOptions['ssl'];
    /** Any query-string keys we didn't recognize — preserved so callers can
     *  decide what to do with them (e.g., log, error). */
    extras: Record<string, string>;
}

/**
 * Parse a libpq-style URL into a flat ConnectOptions-compatible bag.
 * Throws for malformed URLs. `user` / `database` default to empty string;
 * the caller should supply a fallback (usually via `resolveConnectOptions`).
 */
export function parseConnectionString(input: string): ParsedConnectionString {
    const trimmed = input.trim();
    if (!trimmed.startsWith('postgres://') && !trimmed.startsWith('postgresql://')) {
        throw new Error(
            "parseConnectionString: expected URL to start with postgres:// or postgresql://, got: " +
            JSON.stringify(input)
        );
    }

    // Strip the scheme, leaving userinfo@host[:port]/db[?query].
    const schemeEnd = trimmed.indexOf('://');
    const rest = trimmed.substring(schemeEnd + 3);

    let userinfo = '';
    let hostPortDb = rest;
    const at = findUnescaped(rest, '@');
    if (at >= 0) {
        userinfo = rest.substring(0, at);
        hostPortDb = rest.substring(at + 1);
    }

    // Split off ?query.
    let query = '';
    const q = hostPortDb.indexOf('?');
    if (q >= 0) {
        query = hostPortDb.substring(q + 1);
        hostPortDb = hostPortDb.substring(0, q);
    }

    // Split off /database.
    let hostPort = hostPortDb;
    let database = '';
    const slash = hostPortDb.indexOf('/');
    if (slash >= 0) {
        hostPort = hostPortDb.substring(0, slash);
        database = decodeComponent(hostPortDb.substring(slash + 1));
    }

    // Parse host:port.
    let host = 'localhost';
    let port = 5432;
    if (hostPort.length > 0) {
        // IPv6 `[::1]:5432` form.
        if (hostPort.startsWith('[')) {
            const closeBracket = hostPort.indexOf(']');
            if (closeBracket < 0) {
                throw new Error('parseConnectionString: unclosed IPv6 bracket');
            }
            host = hostPort.substring(1, closeBracket);
            if (closeBracket + 1 < hostPort.length && hostPort.charAt(closeBracket + 1) === ':') {
                port = parseInt(hostPort.substring(closeBracket + 2), 10);
            }
        } else {
            const colon = hostPort.lastIndexOf(':');
            if (colon >= 0) {
                host = decodeComponent(hostPort.substring(0, colon));
                port = parseInt(hostPort.substring(colon + 1), 10);
            } else {
                host = decodeComponent(hostPort);
            }
        }
    }
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
        throw new Error('parseConnectionString: invalid port: ' + hostPort);
    }

    // Parse user:password.
    let user = '';
    let password: string | undefined = undefined;
    if (userinfo.length > 0) {
        const colon = userinfo.indexOf(':');
        if (colon >= 0) {
            user = decodeComponent(userinfo.substring(0, colon));
            password = decodeComponent(userinfo.substring(colon + 1));
        } else {
            user = decodeComponent(userinfo);
        }
    }

    // Parse query parameters.
    const extras: Record<string, string> = {};
    let applicationName: string | undefined = undefined;
    let connectTimeoutMs: number | undefined = undefined;
    let ssl: ConnectOptions['ssl'] = undefined;

    if (query.length > 0) {
        const pairs = query.split('&');
        for (let i = 0; i < pairs.length; i++) {
            const eq = pairs[i].indexOf('=');
            if (eq < 0) {
                continue;
            }
            const key = decodeComponent(pairs[i].substring(0, eq));
            const value = decodeComponent(pairs[i].substring(eq + 1));
            if (key === 'sslmode') {
                if (value === 'disable' || value === 'require'
                    || value === 'verify-ca' || value === 'verify-full') {
                    ssl = { mode: value };
                } else {
                    throw new Error('parseConnectionString: unknown sslmode=' + value);
                }
            } else if (key === 'application_name') {
                applicationName = value;
            } else if (key === 'connect_timeout') {
                // libpq uses seconds; our internal type is ms.
                const secs = parseInt(value, 10);
                if (Number.isFinite(secs) && secs > 0) {
                    connectTimeoutMs = secs * 1000;
                }
            } else {
                extras[key] = value;
            }
        }
    }

    return {
        host: host,
        port: port,
        user: user,
        database: database,
        password: password,
        applicationName: applicationName,
        connectTimeoutMs: connectTimeoutMs,
        ssl: ssl,
        extras: extras,
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** `@` or `:` may appear percent-encoded inside userinfo — we only split
 *  on the raw character. */
function findUnescaped(s: string, ch: string): number {
    for (let i = 0; i < s.length; i++) {
        if (s.charAt(i) === ch) {
            return i;
        }
    }
    return -1;
}

function decodeComponent(s: string): string {
    // decodeURIComponent throws on malformed escapes; we pass through on
    // failure so at least the value still makes it through in a readable form.
    try {
        return decodeURIComponent(s);
    } catch (_e) {
        return s;
    }
}
