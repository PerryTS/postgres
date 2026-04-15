// Bypass `connect()`'s Promise wrapper. Drive the wire protocol directly
// from top-level code so we can isolate whether the issue is the wrapping
// (Promise / closure-in-function) vs. the protocol itself.

import * as net from 'net';
import {
    MessageReader,
    writeStartupMessage,
    BACKEND_AUTH,
    BACKEND_READY_FOR_QUERY,
    BACKEND_BACKEND_KEY_DATA,
    BACKEND_PARAMETER_STATUS,
} from '../src';

console.log('toplevel: connecting');

const sock = net.createConnection('127.0.0.1', 5432);
const reader = new MessageReader();

sock.on('connect', () => {
    console.log('toplevel: connected, sending startup');
    sock.write(writeStartupMessage({
        user: process.env.PGUSER !== undefined ? process.env.PGUSER : 'perch_test',
        database: process.env.PGDATABASE !== undefined ? process.env.PGDATABASE : 'perch_test',
        client_encoding: 'UTF8',
    }));
});

sock.on('data', (buf: Buffer) => {
    console.log('toplevel: data ' + buf.length + ' bytes');
    const frames = reader.feed(buf);
    console.log('toplevel: ' + frames.length + ' frames');
    for (let i = 0; i < frames.length; i++) {
        const t = frames[i].type;
        const tName =
            t === BACKEND_AUTH ? 'AUTH' :
            t === BACKEND_BACKEND_KEY_DATA ? 'KEY_DATA' :
            t === BACKEND_PARAMETER_STATUS ? 'PARAM' :
            t === BACKEND_READY_FOR_QUERY ? 'READY' :
            'type=' + t;
        console.log('toplevel:   frame ' + i + ' ' + tName + ' payload=' + frames[i].payload.length);
        if (t === BACKEND_READY_FOR_QUERY) {
            console.log('toplevel: READY received — exit');
            process.exit(0);
        }
    }
});

sock.on('error', (e: string) => {
    console.log('toplevel: error ' + e);
    process.exit(1);
});

sock.on('close', () => {
    console.log('toplevel: closed');
    process.exit(2);
});
