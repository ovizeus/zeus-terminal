'use strict';
/**
 * [2026-11-28] Un „telefon" software pentru teste: face exact ce face un passkey real (cheie P-256,
 * attestation 'none', semnatura ECDSA peste authenticatorData || sha256(clientDataJSON)), ca biblioteca
 * REALA @simplewebauthn/server sa verifice criptografia cap-coada, fara browser.
 */
const crypto = require('crypto');

// CBOR minimal: intregi, siruri de octeti, text, map-uri (doar ce cere WebAuthn)
function _head(major, n) {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
    const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
}
function cbor(v) {
    if (typeof v === 'number') return v >= 0 ? _head(0, v) : _head(1, -1 - v);
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.concat([_head(2, v.length), Buffer.from(v)]);
    if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([_head(3, b.length), b]); }
    if (v instanceof Map) {
        const parts = [_head(5, v.size)];
        for (const [k, val] of v) parts.push(cbor(k), cbor(val));
        return Buffer.concat(parts);
    }
    throw new Error('cbor: tip nesuportat');
}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };

function createSoftAuthenticator({ rpID, origin, counterStart = 0, synced = false }) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const credId = crypto.randomBytes(16);
    const id = credId.toString('base64url');
    let counter = counterStart;
    const flagsBase = synced ? 0x18 : 0;   // BE|BS = passkey sincronizat

    function _client(type, challenge, o) {
        return Buffer.from(JSON.stringify({ type, challenge, origin: o || origin, crossOrigin: false }));
    }

    function register(options, opts = {}) {
        const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
        const flags = 0x01 | (opts.noUV ? 0 : 0x04) | 0x40 | flagsBase;
        const authData = Buffer.concat([
            sha256(Buffer.from(opts.rpID || rpID)), Buffer.from([flags]), u32(counter),
            Buffer.alloc(16), Buffer.from([0, credId.length]), credId, cbor(cose),
        ]);
        const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
        return {
            id, rawId: id, type: 'public-key', clientExtensionResults: {},
            response: {
                clientDataJSON: _client('webauthn.create', options.challenge, opts.origin).toString('base64url'),
                attestationObject: attestationObject.toString('base64url'),
                transports: ['internal', 'hybrid'],
            },
        };
    }

    function sign(options, opts = {}) {
        if (!opts.replay) counter += synced ? 0 : 1;
        const flags = 0x01 | (opts.noUV ? 0 : 0x04) | flagsBase;
        const authData = Buffer.concat([sha256(Buffer.from(opts.rpID || rpID)), Buffer.from([flags]), u32(counter)]);
        const clientDataJSON = _client('webauthn.get', options.challenge, opts.origin);
        const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), privateKey);
        return {
            id, rawId: id, type: 'public-key', clientExtensionResults: {},
            response: {
                clientDataJSON: clientDataJSON.toString('base64url'),
                authenticatorData: authData.toString('base64url'),
                signature: signature.toString('base64url'),
                userHandle: opts.userHandle,
            },
        };
    }

    return { id, register, sign, get counter() { return counter; } };
}

module.exports = { createSoftAuthenticator, cbor };
