'use strict';
// [2026-11-28] Passkey — serviciul, cu biblioteca REALA @simplewebauthn/server si un „telefon" software.
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createSoftAuthenticator } = require('../helpers/softAuthenticator');

const RP = 'zeus-terminal.com';
const ORIGIN = 'https://zeus-terminal.com';
const ENV = { PASSKEY_ENABLED: 'true' };
let db, mod;
beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-passkey-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    db = require('../../server/services/database');
    mod = require('../../server/services/passkeys');
});
let uid = 500;
function svc(extra) { return mod.createPasskeys({ db, env: ENV, ...extra }); }
async function enroll(pk, id, a, name) {
    const o = await pk.registrationOptions(id, `u${id}@x.ro`);
    return pk.registrationVerify(id, a.register(o.options), name);
}

describe('config', () => {
    test('stins implicit; origini implicite = domeniul + admin', () => {
        const c = mod.config({});
        expect(c.enabled).toBe(false);
        expect(c.rpID).toBe(RP);
        expect(c.origins).toEqual([ORIGIN, 'https://www.zeus-terminal.com', 'https://admin.zeus-terminal.com']);
        expect(mod.config({ PASSKEY_ENABLED: 'true' }).enabled).toBe(true);
    });
});

describe('inregistrare (criptografie reala)', () => {
    test('optiunile cer passkey rezident + verificarea utilizatorului (amprenta/PIN)', async () => {
        const o = await svc().registrationOptions(++uid, 'a@x.ro');
        expect(o.ok).toBe(true);
        expect(o.options.rp.id).toBe(RP);
        expect(o.options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
        expect(o.options.attestation).toBe('none');
    });
    test('un passkey valid se salveaza cu cheia PUBLICA si numele dat', async () => {
        const pk = svc(); const id = ++uid; const a = createSoftAuthenticator({ rpID: RP, origin: ORIGIN });
        const r = await enroll(pk, id, a, 'My phone');
        expect(r.ok).toBe(true);
        const list = pk.list(id);
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('My phone');
        expect(db.passkeyByCredential(a.id).user_id).toBe(id);
    });
    test('fara provocare (sau provocarea folosita deja) → refuz', async () => {
        const pk = svc(); const id = ++uid; const a = createSoftAuthenticator({ rpID: RP, origin: ORIGIN });
        const o = await pk.registrationOptions(id, 'x@x.ro');
        const resp = a.register(o.options);
        expect((await pk.registrationVerify(id, resp)).ok).toBe(true);
        expect(await pk.registrationVerify(id, resp)).toEqual({ ok: false, error: 'expired' });
    });
    test('provocarea altui cont nu merge (legata de cont)', async () => {
        const pk = svc(); const a = createSoftAuthenticator({ rpID: RP, origin: ORIGIN });
        const id1 = ++uid; const id2 = ++uid;
        const o = await pk.registrationOptions(id1, 'x@x.ro');
        expect((await pk.registrationVerify(id2, a.register(o.options))).ok).toBe(false);
    });
    test('site fals (alta origine) → refuz: phishing-ul nu poate inregistra', async () => {
        const pk = svc(); const id = ++uid; const a = createSoftAuthenticator({ rpID: RP, origin: 'https://zeus-terminal.co' });
        const o = await pk.registrationOptions(id, 'x@x.ro');
        expect(await pk.registrationVerify(id, a.register(o.options))).toEqual({ ok: false, error: 'invalid' });
        expect(pk.list(id)).toHaveLength(0);
    });
    test('fara verificarea utilizatorului (fara amprenta/PIN) → refuz', async () => {
        const pk = svc(); const id = ++uid; const a = createSoftAuthenticator({ rpID: RP, origin: ORIGIN });
        const o = await pk.registrationOptions(id, 'x@x.ro');
        expect((await pk.registrationVerify(id, a.register(o.options, { noUV: true }))).ok).toBe(false);
    });
    test('provocare expirata (peste 5 minute) → refuz', async () => {
        let t = 1_000_000; const pk = svc({ now: () => t }); const id = ++uid;
        const a = createSoftAuthenticator({ rpID: RP, origin: ORIGIN });
        const o = await pk.registrationOptions(id, 'x@x.ro');
        t += mod.CHALLENGE_TTL_MS + 1;
        expect(await pk.registrationVerify(id, a.register(o.options))).toEqual({ ok: false, error: 'expired' });
    });
    test('maxim 10 passkey-uri pe cont', async () => {
        const pk = svc(); const id = ++uid;
        for (let i = 0; i < mod.MAX_PER_USER; i++) expect((await enroll(pk, id, createSoftAuthenticator({ rpID: RP, origin: ORIGIN }))).ok).toBe(true);
        expect(await pk.registrationOptions(id, 'x@x.ro')).toEqual({ ok: false, error: 'too_many' });
    });
    test('numele e curatat (fara tag-uri / control) si scurtat', () => {
        expect(mod.cleanName('<b>Tel</b>\n', 'X')).toBe('bTel/b');
        expect(mod.cleanName('', 'Passkey 1')).toBe('Passkey 1');
        expect(mod.cleanName('a'.repeat(90), 'X')).toHaveLength(40);
    });
});

describe('intrare (criptografie reala)', () => {
    test('passkey-ul inregistrat intra; contul corect e intors', async () => {
        const pk = svc(); const id = ++uid; const a = createSoftAuthenticator({ rpID: RP, origin: ORIGIN });
        await enroll(pk, id, a);
        const o = await pk.authenticationOptions();
        expect(o.ok).toBe(true);
        expect(o.options.userVerification).toBe('required');
        const r = await pk.authenticationVerify(o.challengeId, a.sign(o.options));
        expect(r).toMatchObject({ ok: true, userId: id });
        expect(pk.list(id)[0].lastUsedAt).toBeGreaterThan(0);
    });
    test('aceeasi provocare nu se poate folosi de doua ori', async () => {
        const pk = svc(); const id = ++uid; const a = createSoftAuthenticator({ rpID: RP, origin: ORIGIN });
        await enroll(pk, id, a);
        const o = await pk.authenticationOptions();
        expect((await pk.authenticationVerify(o.challengeId, a.sign(o.options))).ok).toBe(true);
        expect(await pk.authenticationVerify(o.challengeId, a.sign(o.options))).toEqual({ ok: false, error: 'expired' });
    });
    test('semnatura de pe un site fals → refuz', async () => {
        const pk = svc(); const id = ++uid; const a = createSoftAuthenticator({ rpID: RP, origin: ORIGIN });
        await enroll(pk, id, a);
        const o = await pk.authenticationOptions();
        expect((await pk.authenticationVerify(o.challengeId, a.sign(o.options, { origin: 'https://evil.example' }))).ok).toBe(false);
    });
    test('cheia altcuiva (nesalvata la noi) → refuz', async () => {
        const pk = svc(); const stranger = createSoftAuthenticator({ rpID: RP, origin: ORIGIN });
        const o = await pk.authenticationOptions();
        expect(await pk.authenticationVerify(o.challengeId, stranger.sign(o.options))).toEqual({ ok: false, error: 'unknown' });
    });
    test('semnatura facuta cu alta cheie pe acelasi id → refuz', async () => {
        const pk = svc(); const id = ++uid; const a = createSoftAuthenticator({ rpID: RP, origin: ORIGIN });
        await enroll(pk, id, a);
        const o = await pk.authenticationOptions();
        const forged = createSoftAuthenticator({ rpID: RP, origin: ORIGIN }).sign(o.options);
        forged.id = a.id; forged.rawId = a.id;
        expect((await pk.authenticationVerify(o.challengeId, forged)).ok).toBe(false);
    });
    test('contor care nu creste (cheie clonata) → refuz', async () => {
        const pk = svc(); const id = ++uid; const a = createSoftAuthenticator({ rpID: RP, origin: ORIGIN });
        await enroll(pk, id, a);
        const o1 = await pk.authenticationOptions();
        expect((await pk.authenticationVerify(o1.challengeId, a.sign(o1.options))).ok).toBe(true);
        const o2 = await pk.authenticationOptions();
        expect((await pk.authenticationVerify(o2.challengeId, a.sign(o2.options, { replay: true }))).ok).toBe(false);
    });
    test('passkey sincronizat (contor mereu 0, iCloud/Google) intra de fiecare data', async () => {
        const pk = svc(); const id = ++uid; const a = createSoftAuthenticator({ rpID: RP, origin: ORIGIN, synced: true });
        await enroll(pk, id, a);
        expect(pk.list(id)[0].synced).toBe(true);
        for (let i = 0; i < 3; i++) {
            const o = await pk.authenticationOptions();
            expect((await pk.authenticationVerify(o.challengeId, a.sign(o.options))).ok).toBe(true);
        }
    });
    test('fara amprenta/PIN la intrare → refuz', async () => {
        const pk = svc(); const id = ++uid; const a = createSoftAuthenticator({ rpID: RP, origin: ORIGIN });
        await enroll(pk, id, a);
        const o = await pk.authenticationOptions();
        expect((await pk.authenticationVerify(o.challengeId, a.sign(o.options, { noUV: true }))).ok).toBe(false);
    });
    test('passkey sters nu mai intra', async () => {
        const pk = svc(); const id = ++uid; const a = createSoftAuthenticator({ rpID: RP, origin: ORIGIN });
        const r = await enroll(pk, id, a);
        expect(pk.remove(id + 1, r.id)).toBe(false);   // altcineva nu-l poate sterge
        expect(pk.remove(id, r.id)).toBe(true);
        const o = await pk.authenticationOptions();
        expect((await pk.authenticationVerify(o.challengeId, a.sign(o.options))).ok).toBe(false);
    });
    test('plafonul de provocari tine memoria sub control', async () => {
        const pk = svc();
        for (let i = 0; i < mod.MAX_CHALLENGES; i++) pk._challenges.set('auth:x' + i, { challenge: 'c', expiresAt: Date.now() + 60_000 });
        const o = await pk.authenticationOptions();
        expect(o.ok).toBe(true);                                   // plin → cea mai veche iese, nu refuz
        expect(pk._challenges.size).toBe(mod.MAX_CHALLENGES);
        expect(pk._challenges.has('auth:x0')).toBe(false);
    });
});
