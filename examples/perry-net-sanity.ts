// Sanity test: raw net.Socket from the perry-smoke.ts side. Confirms
// that the Perry runtime delivers socket events while the main thread
// is awaiting a Promise (the shape `connect()` uses internally).

// No setInterval keepalive: tests whether js_net_has_active_handles
// correctly keeps the runtime pumping while a socket is connecting.
import * as net from 'net';

console.log('sanity: connecting to 127.0.0.1:5432 (no keepalive)');

const sock = net.createConnection('127.0.0.1', 5432);

sock.on('connect', () => {
    console.log('sanity: connected');
    process.exit(0);
});
sock.on('error', (e: string) => {
    console.log('sanity FAIL: ' + e);
    process.exit(1);
});
