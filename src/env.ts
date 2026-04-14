// libpq environment-variable support. Apps that already work with
// `psql` / `node-postgres` set these and expect them to be picked up
// transparently. `resolveConnectOptions` merges (in order of precedence):
//
//   1. Explicit fields in the input options.
//   2. Fields parsed from `url` / `connectionString`.
//   3. Environment variables (PGHOST, PGPORT, PGUSER, PGPASSWORD,
//      PGDATABASE, PGAPPNAME, PGCONNECT_TIMEOUT, PGSSLMODE).
//   4. Driver defaults (host=localhost, port=5432, user=OS-user or "postgres").

import type { ConnectOptions } from './connection';
import { parseConnectionString } from './url';

export interface ResolveOptionsInput extends Partial<ConnectOptions> {
    /** libpq-style connection URL. Explicit fields in the input win. */
    url?: string;
    /** Alias for `url`. */
    connectionString?: string;
}

/**
 * Merge an incomplete options bag with environment-variable defaults and
 * produce a complete `ConnectOptions`. Throws if required fields
 * (`host`, `user`, `database`) remain unset after all sources are applied.
 */
export function resolveConnectOptions(input: ResolveOptionsInput = {}): ConnectOptions {
    const urlText = input.url !== undefined ? input.url : input.connectionString;
    const fromUrl = urlText !== undefined ? parseConnectionString(urlText) : undefined;
    const env = readEnv();

    const host =
        pick(input.host, fromUrl?.host, env.PGHOST, 'localhost') as string;
    const portStr =
        pick(
            input.port !== undefined ? String(input.port) : undefined,
            fromUrl !== undefined ? String(fromUrl.port) : undefined,
            env.PGPORT,
            '5432'
        ) as string;
    const port = parseInt(portStr, 10);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
        throw new Error('resolveConnectOptions: invalid port: ' + portStr);
    }

    const userMaybe = pick(input.user, fromUrl?.user, env.PGUSER);
    if (userMaybe === undefined || userMaybe.length === 0) {
        throw new Error(
            'resolveConnectOptions: user is required (set `user` or PGUSER env)'
        );
    }
    const user: string = userMaybe;

    const databaseMaybe = pick(input.database, fromUrl?.database, env.PGDATABASE, user);
    if (databaseMaybe === undefined || databaseMaybe.length === 0) {
        throw new Error(
            'resolveConnectOptions: database is required (set `database` or PGDATABASE env)'
        );
    }
    const database: string = databaseMaybe;

    const password = pick(input.password, fromUrl?.password, env.PGPASSWORD);
    const applicationName = pick(
        input.applicationName,
        fromUrl?.applicationName,
        env.PGAPPNAME
    );

    const connectTimeoutMsStr = env.PGCONNECT_TIMEOUT;
    const connectTimeoutMs =
        input.connectTimeoutMs !== undefined ? input.connectTimeoutMs :
        fromUrl?.connectTimeoutMs !== undefined ? fromUrl.connectTimeoutMs :
        connectTimeoutMsStr !== undefined ? parseInt(connectTimeoutMsStr, 10) * 1000 :
        undefined;

    const ssl = resolveSsl(input.ssl, fromUrl?.ssl, env.PGSSLMODE);

    return {
        host: host,
        port: port,
        user: user,
        database: database,
        password: password,
        applicationName: applicationName,
        connectTimeoutMs: connectTimeoutMs,
        ssl: ssl,
    };
}

// ─── Internals ───────────────────────────────────────────────────────────────

function pick<T>(...candidates: (T | undefined)[]): T | undefined {
    for (let i = 0; i < candidates.length; i++) {
        const v = candidates[i];
        if (v !== undefined) {
            // Treat empty string as "present" iff callers passed it explicitly.
            // Only skip over `undefined`.
            return v;
        }
    }
    return undefined;
}

function resolveSsl(
    explicit: ConnectOptions['ssl'] | undefined,
    fromUrl: ConnectOptions['ssl'] | undefined,
    env: string | undefined
): ConnectOptions['ssl'] {
    if (explicit !== undefined) {
        return explicit;
    }
    if (fromUrl !== undefined) {
        return fromUrl;
    }
    if (env === undefined) {
        return undefined;
    }
    if (env === 'disable' || env === 'require' || env === 'verify-ca' || env === 'verify-full') {
        return { mode: env };
    }
    throw new Error('resolveConnectOptions: unknown PGSSLMODE=' + env);
}

interface EnvVars {
    PGHOST?: string;
    PGPORT?: string;
    PGUSER?: string;
    PGPASSWORD?: string;
    PGDATABASE?: string;
    PGAPPNAME?: string;
    PGCONNECT_TIMEOUT?: string;
    PGSSLMODE?: string;
}

function readEnv(): EnvVars {
    // Guard for environments without `process` (e.g. a minimal Perry build
    // without the node-compat shim). Empty strings are treated as unset so
    // PG* being declared but empty doesn't override actual defaults.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    const env: Record<string, string | undefined> = g.process !== undefined && g.process.env !== undefined
        ? g.process.env
        : {};
    const out: EnvVars = {};
    const keep = (k: keyof EnvVars): void => {
        const v = env[k];
        if (typeof v === 'string' && v.length > 0) {
            out[k] = v;
        }
    };
    keep('PGHOST');
    keep('PGPORT');
    keep('PGUSER');
    keep('PGPASSWORD');
    keep('PGDATABASE');
    keep('PGAPPNAME');
    keep('PGCONNECT_TIMEOUT');
    keep('PGSSLMODE');
    return out;
}
