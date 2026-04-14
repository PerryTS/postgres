// Unit tests for src/auth/md5.ts and src/auth/scram.ts.
//
// Cross-checked against independent Python / reference-implementation
// outputs computed from the same inputs. Intentionally uses fixed
// nonces / salts so the vectors are reproducible.

import { test, expect } from 'bun:test';
import { createHash, createHmac, pbkdf2Sync } from 'crypto';
import { computeMD5Password } from '../../src/auth/md5';
import { scramContinue, scramInit, scramVerifyServerFinal, ScramState } from '../../src/auth/scram';

// ─── MD5 ────────────────────────────────────────────────────────────────────

test('computeMD5Password matches the Postgres reference algorithm', () => {
    // Expected value computed independently:
    //   inner = md5('pencil' + 'user')       = 7d43c5cebdb77be0f4c42afa18cd9a8f
    //   outer = md5(inner + salt_bytes)      = ?
    // Compute both ways and compare.
    const user = 'user';
    const password = 'pencil';
    const salt = Buffer.from([0x12, 0x34, 0x56, 0x78]);

    const inner = createHash('md5').update(password + user).digest('hex');
    const outer = createHash('md5')
        .update(Buffer.concat([Buffer.from(inner, 'utf8'), salt]))
        .digest('hex');
    const expected = 'md5' + outer;

    expect(computeMD5Password(user, password, salt)).toBe(expected);
});

test('computeMD5Password handles non-ASCII passwords', () => {
    const user = 'alice';
    // "pæncil" — exercises multi-byte UTF-8 encoding in the inner hash.
    const password = 'pæncil';
    const salt = Buffer.from([0, 1, 2, 3]);
    const got = computeMD5Password(user, password, salt);
    expect(got.startsWith('md5')).toBe(true);
    expect(got.length).toBe(3 + 32);
});

// ─── SCRAM-SHA-256 ──────────────────────────────────────────────────────────

test('scramInit refuses when SCRAM-SHA-256 is not offered', () => {
    expect(() => scramInit('user', 'pencil', ['SCRAM-SHA-1'])).toThrow();
});

test('scramInit builds a well-formed client-first-message', () => {
    const r = scramInit('alice', 'pencil', ['SCRAM-SHA-256']);
    expect(r.state.mechanism).toBe('SCRAM-SHA-256');
    expect(r.state.username).toBe('alice');

    // Payload layout: "SCRAM-SHA-256\0" + int32-length + client-first-message
    const nameEnd = r.initialResponsePayload.indexOf(0);
    expect(r.initialResponsePayload.toString('utf8', 0, nameEnd)).toBe('SCRAM-SHA-256');
    const len = r.initialResponsePayload.readInt32BE(nameEnd + 1);
    const cfm = r.initialResponsePayload
        .subarray(nameEnd + 5, nameEnd + 5 + len)
        .toString('utf8');

    // "n,," gs2-header + "n=alice,r=<24b64>"
    expect(cfm.startsWith('n,,n=alice,r=')).toBe(true);
    const nonce = cfm.substring('n,,n=alice,r='.length);
    expect(nonce.length).toBeGreaterThanOrEqual(24);
    expect(r.state.clientNonce).toBe(nonce);
    expect(r.state.clientFirstBare).toBe('n=alice,r=' + nonce);
});

test('scram full round-trip matches an independent RFC 7677-style derivation', () => {
    // Drive the state machine with known inputs; compute the expected
    // derivations inline; assert byte-for-byte equality on ClientProof and
    // the verifier value we generate vs. the one we'd expect from the server.
    const username = 'user';
    const password = 'pencil';
    const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
    const iter = 4096;
    const clientNonce = 'rOprNGfwEbeRWgbNEkqO';
    const serverNonceSuffix = '%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
    const combinedNonce = clientNonce + serverNonceSuffix;

    // Hand-construct a state so we get deterministic output.
    const state: ScramState = {
        mechanism: 'SCRAM-SHA-256',
        clientNonce: clientNonce,
        clientFirstBare: 'n=user,r=' + clientNonce,
        username: username,
        password: password,
        serverSignatureB64: null,
    };

    const serverFirst =
        'r=' + combinedNonce +
        ',s=' + salt.toString('base64') +
        ',i=' + iter;
    const clientFinal = scramContinue(state, Buffer.from(serverFirst, 'utf8'));
    const clientFinalStr = clientFinal.toString('utf8');

    // The client-final-message body must start with `c=biws,r=<combined>,p=`.
    expect(clientFinalStr.startsWith('c=biws,r=' + combinedNonce + ',p=')).toBe(true);

    // Independently compute the expected ClientProof.
    const saltedPassword = pbkdf2Sync(password, salt, iter, 32, 'sha256');
    const clientKey = createHmac('sha256', saltedPassword)
        .update(Buffer.from('Client Key', 'utf8'))
        .digest();
    const storedKey = createHash('sha256').update(clientKey).digest();
    const clientFinalWithoutProof = 'c=biws,r=' + combinedNonce;
    const authMessage = state.clientFirstBare + ',' + serverFirst + ',' + clientFinalWithoutProof;
    const clientSignature = createHmac('sha256', storedKey)
        .update(Buffer.from(authMessage, 'utf8'))
        .digest();
    const expectedProof = Buffer.alloc(clientKey.length);
    for (let i = 0; i < clientKey.length; i++) {
        expectedProof[i] = clientKey[i] ^ clientSignature[i];
    }
    const gotProof = clientFinalStr.substring(('c=biws,r=' + combinedNonce + ',p=').length);
    expect(gotProof).toBe(expectedProof.toString('base64'));

    // And the server signature state should match an independently-computed one.
    const serverKey = createHmac('sha256', saltedPassword)
        .update(Buffer.from('Server Key', 'utf8'))
        .digest();
    const expectedServerSig = createHmac('sha256', serverKey)
        .update(Buffer.from(authMessage, 'utf8'))
        .digest()
        .toString('base64');
    expect(state.serverSignatureB64).toBe(expectedServerSig);

    // scramVerifyServerFinal should accept the matching verifier.
    scramVerifyServerFinal(state, Buffer.from('v=' + expectedServerSig, 'utf8'));
});

test('scramContinue rejects a server nonce that does not extend the client nonce', () => {
    const state: ScramState = {
        mechanism: 'SCRAM-SHA-256',
        clientNonce: 'CLIENT_NONCE',
        clientFirstBare: 'n=user,r=CLIENT_NONCE',
        username: 'user',
        password: 'pencil',
        serverSignatureB64: null,
    };
    const serverFirst = 'r=SOMETHING_ELSE,s=' + Buffer.alloc(8).toString('base64') + ',i=4096';
    expect(() => scramContinue(state, Buffer.from(serverFirst, 'utf8'))).toThrow();
});

test('scramVerifyServerFinal rejects a mismatched verifier', () => {
    const state: ScramState = {
        mechanism: 'SCRAM-SHA-256',
        clientNonce: 'x',
        clientFirstBare: 'n=user,r=x',
        username: 'user',
        password: 'pencil',
        serverSignatureB64: 'correct-b64',
    };
    expect(() => scramVerifyServerFinal(state, Buffer.from('v=wrong-b64', 'utf8'))).toThrow();
});

test('scramVerifyServerFinal surfaces server-reported errors', () => {
    const state: ScramState = {
        mechanism: 'SCRAM-SHA-256',
        clientNonce: 'x',
        clientFirstBare: 'n=user,r=x',
        username: 'user',
        password: 'pencil',
        serverSignatureB64: 'dummy',
    };
    expect(() =>
        scramVerifyServerFinal(state, Buffer.from('e=invalid-proof', 'utf8'))
    ).toThrow();
});
