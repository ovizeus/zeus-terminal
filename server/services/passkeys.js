'use strict';
/**
 * [2026-11-28] Passkey (WebAuthn) — intrare cu amprenta / fata / PIN-ul dispozitivului.
 *
 * De ce e mai sigur decat parola + cod: cheia privata nu paraseste telefonul/calculatorul si e legata de
 * domeniul zeus-terminal.com — un site fals (phishing) NU o poate folosi, iar serverul tine doar cheia
 * publica (o baza furata nu deschide niciun cont). Nu cere nicio cheie API: verificarea e locala.
 *
 * Reguli:
 *   - adaugarea cere sesiune + PAROLA (+ codul 2FA daca e pornit) — o sesiune furata nu poate lasa in urma
 *     o usa permanenta; fiecare adaugare/stergere → audit + email;
 *   - userVerification 'required': passkey-ul cere amprenta/PIN, deci valoreaza parola + al doilea factor;
 *   - fiecare provocare (challenge) se foloseste O SINGURA DATA si expira in 5 minute;
 *   - stins pana cand PASSKEY_ENABLED=true.
 */
const crypto = require('crypto');

const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_CHALLENGES = 5000;          // plafon de memorie: provocarile de login vin de la oricine
const MAX_PER_USER = 10;
const NAME_MAX = 40;

function config(env) {
    const e = env || process.env;
    const rpID = String(e.PASSKEY_RP_ID || 'zeus-terminal.com').trim();
    const origins = String(e.PASSKEY_ORIGINS || `https://${rpID},https://www.${rpID},https://admin.${rpID}`)
        .split(',').map((s) => s.trim()).filter(Boolean);
    return { enabled: String(e.PASSKEY_ENABLED || '').toLowerCase() === 'true', rpID, origins, rpName: 'Zeus Terminal' };
}

const b64u = {
    enc: (buf) => Buffer.from(buf).toString('base64url'),
    dec: (s) => new Uint8Array(Buffer.from(String(s), 'base64url')),
};

/** identificator stabil, ne-secret, per cont (managerii de parole grupeaza passkey-urile aceluiasi cont) */
function userHandle(uid) { return new Uint8Array(crypto.createHash('sha256').update('zeus-passkey-user:' + uid).digest()); }

function cleanName(name, fallback) {
    const s = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, NAME_MAX);
    return s || fallback;
}

/**
 * @param deps { db, lib, env?, now? } — lib = @simplewebauthn/server (injectat in teste)
 */
function createPasskeys(deps) {
    const { db } = deps;
    const lib = deps.lib || require('@simplewebauthn/server');
    const clock = deps.now || (() => Date.now());
    const cfg = () => config(deps.env);
    const challenges = new Map();   // key → { challenge, expiresAt }

    function _put(key, challenge) {
        const t = clock();
        if (challenges.size >= MAX_CHALLENGES) {
            for (const [k, v] of challenges) if (v.expiresAt <= t) challenges.delete(k);
            // [2026-11-28] revizie: plin → cea mai VECHE iese (Map pastreaza ordinea); un val de boti nu mai
            // poate tine login-ul blocat cu „Busy" — provocarea unui om real traieste destul cat sa fie folosita
            while (challenges.size >= MAX_CHALLENGES) challenges.delete(challenges.keys().next().value);
        }
        challenges.set(key, { challenge, expiresAt: t + CHALLENGE_TTL_MS });
        return true;
    }
    /** citeste SI sterge — o provocare nu se poate folosi de doua ori */
    function _take(key) {
        const c = challenges.get(key);
        challenges.delete(key);
        if (!c || c.expiresAt <= clock()) return null;
        return c.challenge;
    }

    function list(uid) {
        return db.passkeyList(uid).map((r) => ({
            id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at || null,
            synced: r.backed_up === 1,
        }));
    }

    async function registrationOptions(uid, email) {
        const c = cfg();
        if (db.passkeyCount(uid) >= MAX_PER_USER) return { ok: false, error: 'too_many' };
        const options = await lib.generateRegistrationOptions({
            rpName: c.rpName, rpID: c.rpID,
            userID: userHandle(uid), userName: String(email || 'user'), userDisplayName: String(email || 'Zeus user'),
            attestationType: 'none',
            excludeCredentials: db.passkeyList(uid).map((r) => ({ id: r.credential_id, transports: _transports(r) })),
            authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        });
        if (!_put('reg:' + uid, options.challenge)) return { ok: false, error: 'busy' };
        return { ok: true, options };
    }

    async function registrationVerify(uid, response, name) {
        const c = cfg();
        const expectedChallenge = _take('reg:' + uid);
        if (!expectedChallenge) return { ok: false, error: 'expired' };
        if (db.passkeyCount(uid) >= MAX_PER_USER) return { ok: false, error: 'too_many' };
        let v;
        try {
            v = await lib.verifyRegistrationResponse({
                response, expectedChallenge, expectedOrigin: c.origins, expectedRPID: c.rpID, requireUserVerification: true,
            });
        } catch (_) { return { ok: false, error: 'invalid' }; }
        if (!v || !v.verified || !v.registrationInfo || !v.registrationInfo.credential) return { ok: false, error: 'invalid' };
        const cred = v.registrationInfo.credential;
        if (db.passkeyByCredential(cred.id)) return { ok: false, error: 'exists' };
        const n = db.passkeyCount(uid) + 1;
        const id = db.passkeyAdd({
            user_id: uid, credential_id: cred.id, public_key: b64u.enc(cred.publicKey), counter: Number(cred.counter) || 0,
            transports: JSON.stringify(Array.isArray(cred.transports) ? cred.transports : (response && response.response && response.response.transports) || []),
            name: cleanName(name, 'Passkey ' + n), device_type: String(v.registrationInfo.credentialDeviceType || ''),
            backed_up: v.registrationInfo.credentialBackedUp ? 1 : 0, created_at: clock(),
        });
        return { ok: true, id: Number(id) };
    }

    async function authenticationOptions() {
        const c = cfg();
        const options = await lib.generateAuthenticationOptions({ rpID: c.rpID, allowCredentials: [], userVerification: 'required' });
        const challengeId = crypto.randomBytes(18).toString('base64url');
        if (!_put('auth:' + challengeId, options.challenge)) return { ok: false, error: 'busy' };
        return { ok: true, challengeId, options };
    }

    /** → { ok, userId, passkeyId } ; contul (activ/aprobat) il verifica ruta */
    async function authenticationVerify(challengeId, response) {
        const c = cfg();
        const expectedChallenge = _take('auth:' + String(challengeId || ''));
        if (!expectedChallenge) return { ok: false, error: 'expired' };
        const credId = response && typeof response.id === 'string' ? response.id : '';
        const row = credId ? db.passkeyByCredential(credId) : null;
        if (!row) return { ok: false, error: 'unknown' };
        let v;
        try {
            v = await lib.verifyAuthenticationResponse({
                response, expectedChallenge, expectedOrigin: c.origins, expectedRPID: c.rpID, requireUserVerification: true,
                credential: { id: row.credential_id, publicKey: b64u.dec(row.public_key), counter: row.counter, transports: _transports(row) },
            });
        } catch (_) { return { ok: false, error: 'invalid', userId: row.user_id }; }
        if (!v || !v.verified) return { ok: false, error: 'invalid', userId: row.user_id };
        const newCounter = Number(v.authenticationInfo && v.authenticationInfo.newCounter) || 0;
        // contor care nu creste = posibila clona a cheii → refuz (passkey-urile sincronizate raman pe 0)
        if (!db.passkeyTouch(row.id, newCounter, clock())) return { ok: false, error: 'counter', userId: row.user_id };
        return { ok: true, userId: row.user_id, passkeyId: row.id };
    }

    function remove(uid, id) { return db.passkeyDelete(uid, Number(id)) === 1; }

    return { list, registrationOptions, registrationVerify, authenticationOptions, authenticationVerify, remove, config: cfg, _challenges: challenges };
}

function _transports(r) { try { const a = JSON.parse(r.transports || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } }

let _live = null;
function live() {
    if (!_live) _live = createPasskeys({ db: require('./database') });
    return _live;
}

module.exports = { createPasskeys, live, config, userHandle, cleanName, CHALLENGE_TTL_MS, MAX_PER_USER, MAX_CHALLENGES };
