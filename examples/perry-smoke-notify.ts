// Perry-native NOTICE + LISTEN/NOTIFY smoke. Two paths:
//
//   - NOTICE: server-emitted info (e.g. `RAISE NOTICE 'foo'` in PL/pgSQL).
//     Comes through the Connection's `'notice'` event.
//   - NOTIFY: pub/sub. One conn does `LISTEN chan`, another does
//     `NOTIFY chan, 'payload'`. The listener should receive a
//     `Notification` via the `'notification'` event.
//
// Build:
//   /Users/amlug/projects/perry/perry/target/release/perry compile \
//       examples/perry-smoke-notify.ts -o /tmp/perry-pg-smoke-notify
// Run:
//   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=perch_test \
//   PGPASSWORD=AZfRSy1RiRokYA8Z5ecaer5N PGDATABASE=perch_test \
//       /tmp/perry-pg-smoke-notify

import { connect, Connection } from '../src';

interface ConnOpts {
    host: string;
    port: number;
    user: string;
    password: string | undefined;
    database: string;
}

function envOpts(): ConnOpts {
    return {
        host: process.env.PGHOST !== undefined ? process.env.PGHOST : '127.0.0.1',
        port: process.env.PGPORT !== undefined ? parseInt(process.env.PGPORT, 10) : 5432,
        user: process.env.PGUSER !== undefined ? process.env.PGUSER : 'perch_test',
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE !== undefined ? process.env.PGDATABASE : 'perch_test',
    };
}

async function main(): Promise<void> {
    // ── NOTICE path ─────────────────────────────────────────────────────
    console.log('perry-smoke-notify: connecting (notice path)...');
    const noticeConn: Connection = await connect(envOpts());

    let noticeMsg: string = '';
    noticeConn.on('notice', (n) => {
        noticeMsg = n.message !== undefined ? n.message : '<no-msg>';
        console.log('perry-smoke-notify: NOTICE received: ' + noticeMsg);
    });

    // RAISE NOTICE inside a DO block — guaranteed to emit a NoticeResponse
    // ('N') frame on the same channel as the SELECT response.
    await noticeConn.query("DO $$ BEGIN RAISE NOTICE 'hello-from-perry'; END $$");
    console.log('perry-smoke-notify: notice captured=' + noticeMsg);
    if (noticeMsg !== 'hello-from-perry') {
        console.log('perry-smoke-notify: FAIL — notice handler did not fire');
        await noticeConn.close();
        process.exit(1);
    }
    await noticeConn.close();

    // ── NOTIFY / LISTEN path ────────────────────────────────────────────
    console.log('perry-smoke-notify: connecting (listener)...');
    const listener: Connection = await connect(envOpts());
    let received: string = '';
    let receivedChan: string = '';
    listener.on('notification', (n) => {
        receivedChan = n.channel;
        received = n.payload;
        console.log('perry-smoke-notify: NOTIFY received chan=' + receivedChan + ' payload=' + received);
    });
    await listener.query('LISTEN perry_smoke_chan');
    console.log('perry-smoke-notify: listening...');

    console.log('perry-smoke-notify: connecting (publisher)...');
    const publisher: Connection = await connect(envOpts());
    await publisher.query("NOTIFY perry_smoke_chan, 'pong-from-perry'");
    await publisher.close();

    // The async notification is delivered on the listener's connection
    // shortly after the NOTIFY commits. Poll briefly with a low-impact
    // SELECT to make sure the listener processes any pending bytes.
    const startMs = Date.now();
    while (received === '' && (Date.now() - startMs) < 5000) {
        await listener.query('SELECT 1');
    }

    if (received !== 'pong-from-perry' || receivedChan !== 'perry_smoke_chan') {
        console.log('perry-smoke-notify: FAIL — notification not received (chan=' + receivedChan + ' payload=' + received + ')');
        await listener.close();
        process.exit(1);
    }

    await listener.close();
    console.log('perry-smoke-notify: OK');
}

main().then(() => {
    process.exit(0);
}).catch((e) => {
    console.log('perry-smoke-notify: ERROR ' + String(e));
    process.exit(1);
});
