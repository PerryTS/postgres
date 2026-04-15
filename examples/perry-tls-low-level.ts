// Minimal Perry-native repro: TCP → SSLRequest → 'S' → upgradeToTLS →
// StartupMessage → read first frame. Bypasses the driver entirely so we
// can isolate whether stdlib's upgradeToTLS works against this Postgres
// vs. whether the bug is in the driver's wiring.
//
// Build:
//   /Users/amlug/projects/perry/perry/target/release/perry compile \
//       examples/perry-tls-low-level.ts -o /tmp/perry-pg-tls-low
// Run:
//   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=perch_test \
//   PGPASSWORD=AZfRSy1RiRokYA8Z5ecaer5N PGDATABASE=perch_test \
//       /tmp/perry-pg-tls-low

import * as net from 'net';

const HOST = process.env.PGHOST !== undefined ? process.env.PGHOST : '127.0.0.1';
const PORT = process.env.PGPORT !== undefined ? parseInt(process.env.PGPORT, 10) : 5432;
const USER = process.env.PGUSER !== undefined ? process.env.PGUSER : 'perch_test';
const DB = process.env.PGDATABASE !== undefined ? process.env.PGDATABASE : 'perch_test';

const SSL_REQUEST_CODE = 80877103; // 0x04D2_162F

function buildSSLRequest(): Buffer {
    const buf = Buffer.alloc(8);
    buf.writeInt32BE(8, 0);
    buf.writeInt32BE(SSL_REQUEST_CODE, 4);
    return buf;
}

function buildStartup(user: string, database: string): Buffer {
    // protocol_version=196608, params=user, database, client_encoding
    const params = [
        ['user', user],
        ['database', database],
        ['client_encoding', 'UTF8'],
    ];
    let bodyLen = 4 + 4 + 1; // length + version + final null
    for (let i = 0; i < params.length; i++) {
        bodyLen += params[i][0].length + 1 + params[i][1].length + 1;
    }
    const buf = Buffer.alloc(bodyLen);
    buf.writeInt32BE(bodyLen, 0);
    buf.writeInt32BE(196608, 4);
    let off = 8;
    for (let i = 0; i < params.length; i++) {
        const k = params[i][0];
        const v = params[i][1];
        for (let j = 0; j < k.length; j++) { buf.writeUInt8(k.charCodeAt(j), off++); }
        buf.writeUInt8(0, off++);
        for (let j = 0; j < v.length; j++) { buf.writeUInt8(v.charCodeAt(j), off++); }
        buf.writeUInt8(0, off++);
    }
    buf.writeUInt8(0, off++);
    return buf;
}

let stage: string = 'init';
let upgraded: boolean = false;
let postUpgradeBytes: number = 0;

const sock = net.createConnection(HOST as never, PORT as never);

sock.on('connect', () => {
    console.log('low: tcp connect');
    stage = 'ssl-requesting';
    sock.write(buildSSLRequest());
});

sock.on('data', async (buf: Buffer) => {
    if (!upgraded) {
        const first = buf.readUInt8(0);
        console.log('low: ssl-byte=' + String.fromCharCode(first) + ' (0x' + first.toString(16) + ')');
        if (first !== 0x53) {
            console.log('low: server refuses SSL');
            sock.end();
            return;
        }
        upgraded = true;
        stage = 'upgrading';
        console.log('low: calling upgradeToTLS...');
        // Cast to any to access upgradeToTLS without the driver's Socket wrapper.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sAny = sock as any;
        await sAny.upgradeToTLS(HOST, 0);
        console.log('low: upgradeToTLS returned');
        stage = 'startup';
        sock.write(buildStartup(USER, DB));
    } else {
        postUpgradeBytes += buf.length;
        const t = buf.readUInt8(0);
        console.log('low: post-upgrade frame type=' + String.fromCharCode(t) + ' (' + buf.length + ' bytes)');
        if (postUpgradeBytes > 0) {
            // Got at least one frame — TLS path works.
            console.log('low: OK');
            sock.end();
        }
    }
});

sock.on('error', (e: Error | string) => {
    console.log('low: ERROR ' + String(e));
    process.exit(1);
});

sock.on('close', () => {
    console.log('low: close (stage=' + stage + ')');
    process.exit(0);
});
