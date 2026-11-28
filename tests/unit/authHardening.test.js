'use strict';
// [2026-11-27] Etapa 1 de securitate (dupa atacul cu boti 13–27 nov): inscriere, resetare, Turnstile, admin.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-auth-hardening';

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const PW = 'Str0ng-Passw0rd!x';
const HASH = bcrypt.hashSync(PW, 4);
const mkUsers = () => ({
    'admin@example.com': { id: 1, email: 'admin@example.com', role: 'admin', status: 'active', token_version: 0, approved: 1, access_level: 'full', password_hash: HASH },
    'user@example.com': { id: 2, email: 'user@example.com', role: 'user', status: 'active', token_version: 0, approved: 1, access_level: 'viewer', password_hash: HASH },
    'support@example.com': { id: 4, email: 'support@example.com', role: 'user', staff_role: 'support', status: 'active', token_version: 0, approved: 1, access_level: 'viewer', password_hash: HASH },
    'staffadmin@example.com': { id: 5, email: 'staffadmin@example.com', role: 'user', staff_role: 'admin', status: 'active', token_version: 0, approved: 1, access_level: 'viewer', password_hash: HASH },
    'pending@example.com': { id: 3, email: 'pending@example.com', role: 'user', status: 'active', token_version: 0, approved: 0, access_level: 'viewer', password_hash: HASH },
});

function build(st) {
    jest.resetModules();
    const byId = (id) => Object.values(st.users).find((u) => u.id === id) || null;
    // Sabloanele reale, dar trimiterea prinsa: codurile trec prin `codeEmail`.
    jest.doMock('../../server/services/accountEmails', () => {
        const real = jest.requireActual('../../server/services/accountEmails');
        return { ...real, sendAccountEmail: async (kind, to, opts) => { st.mails.push([kind, to, (opts && opts.data) || null]); return !st.mailFails; } };
    });
    jest.doMock('nodemailer', () => ({ createTransport: () => ({ sendMail: async (m) => { st.codes.push(m); } }) }));
    jest.doMock('../../server/services/database', () => ({
        findUserByEmail: (e) => st.users[e] || null,
        findUserById: byId,
        listUsers: () => Object.values(st.users),
        countUsers: () => Object.keys(st.users).length,
        createUser: (email, hash, role, approved) => { const id = 100 + Object.keys(st.users).length; st.users[email] = { id, email, role, approved: approved ? 1 : 0, status: 'active', token_version: 0, password_hash: hash }; return id; },
        addPasswordHistory: () => {}, getPasswordHistory: () => [], setUserTermsConsent: () => {},
        findUserByReferralCode: () => null, setReferredBy: () => {},
        updatePassword: (id, h) => { byId(id).password_hash = h; },
        clearTempPasswordMeta: () => {}, setTempPasswordMeta: () => {},
        bumpTokenVersion: (id) => { byId(id).token_version++; },
        approveUser: (email) => { st.users[email].approved = 1; },
        setAccessLevel: (id, level) => { byId(id).access_level = level; },
        setUserStatus: (id, status) => { byId(id).status = status; },
        banUser: (id, until) => { byId(id).banned_until = until; },
        unbanUser: (id) => { byId(id).banned_until = null; },
        atomicEmailUpdate: (id, email) => { const u = byId(id); delete st.users[u.email]; u.email = email; st.users[email] = u; return { ok: true }; },
        disconnectExchange: (id) => { (st.disconnected = st.disconnected || []).push(id); },
        deleteUser: (email) => { delete st.users[email]; },
        loginAttemptGet: (k, key) => st.attempts[k + '|' + key] || null, loginAttemptUpsert: (k, key, count, reset_at) => { st.attempts[k + '|' + key] = { count, reset_at }; },
        setStaffRole: (id, r) => { byId(id).staff_role = r; },
        passkeyDeleteAll: (id) => { const n = (st.passkeyCount && st.passkeyCount[id]) || 0; if (st.passkeyCount) st.passkeyCount[id] = 0; return n; },
        setAntiPhishing: (id, w) => { byId(id).anti_phishing = w; },
        getAntiPhishingByEmail: (e) => (st.users[e] ? st.users[e].anti_phishing || null : null),
        recentSignIns: (uid, n) => (st.signins || []).filter((x) => x.user_id === uid).slice(0, n),
        listAuditLog: (limit, offset) => ({ rows: [], total: 0, limit, offset }),
        getSystemSetting: (k) => (k in st.settings ? st.settings[k] : null), setSystemSetting: (k, v) => { st.settings[k] = v; },
        auditLog: (uid, action, details) => { st.audits.push(action); },
        prepare: () => ({ run: () => ({}), get: () => null, all: () => [] }),
    }));
    // 2FA: cine il are pornit (st.totp[uid] = codul valid de 6 cifre), ca sa controlam login-ul
    jest.doMock('../../server/services/twoFactor', () => ({
        isEnabled: (uid) => !!(st.totp && st.totp[uid]),
        verifyLogin: (uid, code) => (st.totp && st.totp[uid] && String(code).replace(/\s/g, '') === st.totp[uid])
            ? { ok: true, method: 'totp' } : { ok: false },
        adminReset: (uid) => { const had = !!(st.totp && st.totp[uid]); if (had) delete st.totp[uid]; return had; },
    }));
    jest.doMock('../../server/services/securitySentinel', () => ({
        dailyReport: () => ({ hours: 24, failedSignIns: 3, resetRequests: 1, signUps: 0, blockedSignUps: 0, signIns: 2, topFailIps: [] }),
        summary: () => ({ alertsSent: 1 }),
    }));
    jest.doMock('../../server/services/pwnedPasswords', () => ({ isPwned: async (pw) => (st.pwned ? st.pwned.includes(pw) : false) }));
    jest.doMock('../../server/services/newSignIn', () => ({
        shouldNotify: (uid, ip) => !!(st.knownIps && st.knownIps[uid] && !st.knownIps[uid].includes(ip)),
        deviceOf: () => 'Chrome on Android',
    }));
    // [2026-11-28] passkey: criptografia e testata in passkeys.test.js; aici controlam doar rezultatul
    jest.doMock('../../server/services/passkeys', () => ({ live: () => ({
        config: () => ({ enabled: !!(st.passkey && st.passkey.enabled) }),
        authenticationOptions: async () => ({ ok: true, challengeId: 'cid', options: { challenge: 'ch' } }),
        authenticationVerify: async (cid, resp) => (st.passkey && st.passkey.result) || { ok: false, error: 'unknown' },
    }) }));
    jest.doMock('../../server/middleware/sessionAuth', () => ({ getActiveSessions: () => [], createAdminIdleGuard: () => (_q, _r, n) => n(), resetActivity: () => {} }));
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json()); app.use(cookieParser());
    app.use('/auth', require('../../server/routes/auth.js'));
    return app;
}
const cookieOf = (u) => 'zeus_token=' + jwt.sign({ id: u.id, email: u.email, role: u.role, tokenVersion: u.token_version }, process.env.JWT_SECRET, { expiresIn: '5m' });
const flush = () => new Promise((r) => setImmediate(r));
const codeFrom = (m) => (String(m.text).match(/Code: (\d{6})/) || [])[1];

let st, app, env;
beforeEach(() => {
    env = { SMTP_HOST: process.env.SMTP_HOST, SMTP_USER: process.env.SMTP_USER, SMTP_PASS: process.env.SMTP_PASS };
    Object.assign(process.env, { SMTP_HOST: 'smtp.test', SMTP_USER: 'box@example.com', SMTP_PASS: 'x' });
    st = { users: mkUsers(), mails: [], codes: [], attempts: {}, settings: {}, audits: [] };
    app = build(st);
});
afterEach(() => { for (const k of Object.keys(env)) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; } });

const as = (email) => {
    const u = st.users[email];
    return { post: (url, body) => request(app).post(url).set('Cookie', cookieOf(u)).set('X-Zeus-Request', '1').send(body || {}) };
};

const reg = (email, ip) => request(app).post('/auth/register').set('X-Forwarded-For', ip || '1.1.1.1').set('X-Zeus-Request', '1')
    .send({ email, password: PW, termsAcceptedAt: '2026-11-27T10:00:00Z', termsVersion: '1' });
const forgot = (email) => request(app).post('/auth/forgot-password/request').set('X-Zeus-Request', '1').send({ email });

describe('authGuard — adrese temporare si de boti', () => {
    const G = require('../../server/services/authGuard');
    test('domeniile temporare, si subdomeniile lor', () => {
        expect(G.isDisposableEmail('a@mailinator.com')).toBe(true);
        expect(G.isDisposableEmail('a@guerrillamailblock.com')).toBe(true);
        expect(G.isDisposableEmail('a@x.mailinator.com')).toBe(true);
        expect(G.isDisposableEmail('a@gmail.com')).toBe(false);
        expect(G.isDisposableEmail('a@tuta.io')).toBe(false);
    });
    test('prefixul verify_ al botilor', () => {
        expect(G.isSuspiciousSignupEmail('verify_direct_123@gmail.com')).toBe(true);
        expect(G.isSuspiciousSignupEmail('Verify_Final@outlook.com')).toBe(true);
        expect(G.isSuspiciousSignupEmail('verifyme@gmail.com')).toBe(false);
        expect(G.isSuspiciousSignupEmail('ion@gmail.com')).toBe(false);
    });
});

describe('inscrierea', () => {
    test('adresa temporara: raspuns identic, dar NU se creeaza contul si nu pleaca niciun email', async () => {
        const r = await reg('bot1@mailinator.com');
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ ok: true, pending: true });
        expect(st.users['bot1@mailinator.com']).toBeUndefined();
        expect(st.mails).toEqual([]);
        expect(st.audits).toContain('REGISTER_BLOCKED_SUSPICIOUS');
    });
    test('max 3 inscrieri pe IP in 10 minute — a patra primeste 429', async () => {
        process.env.MAX_USERS = '100';
        for (let i = 0; i < 3; i++) expect((await reg(`ok${i}@example.org`, '9.9.9.9')).status).toBe(200);
        expect((await reg('ok4@example.org', '9.9.9.9')).status).toBe(429);
        expect((await reg('ok5@example.org', '8.8.8.8')).status).toBe(200);
        delete process.env.MAX_USERS;
    });
    test('inscrierile oprite din admin → 403, fara cont', async () => {
        st.settings.registration_open = '0';
        const r = await reg('new@example.org');
        expect(r.status).toBe(403);
        expect(st.users['new@example.org']).toBeUndefined();
    });
});

describe('resetarea parolei', () => {
    test('cont BLOCAT: raspuns generic, fara cod trimis', async () => {
        st.users['user@example.com'].status = 'blocked';
        const r = await forgot('user@example.com');
        expect(r.body.ok).toBe(true);
        expect(st.codes).toEqual([]);
    });
    test('cel mult 3 coduri pe CONT pe ora, indiferent de IP', async () => {
        for (let i = 0; i < 5; i++) await request(app).post('/auth/forgot-password/request').set('X-Forwarded-For', '7.7.7.' + i).set('X-Zeus-Request', '1').send({ email: 'user@example.com' });
        expect(st.codes.length).toBe(3);
    });
    test('codul cerut INAINTE de schimbarea emailului nu mai merge dupa schimbare', async () => {
        await forgot('user@example.com');
        const oldCode = (String(st.codes[0].text).match(/Code: (\d{6})/) || [])[1];
        await as('user@example.com').post('/auth/change-email/request', { currentPassword: PW, newEmail: 'nou@example.org' });
        const chCode = (String(st.codes[st.codes.length - 1].text).match(/Code: (\d{6})/) || [])[1];
        await as('user@example.com').post('/auth/change-email/confirm', { code: chCode });
        expect(st.users['nou@example.org']).toBeTruthy();
        const r = await request(app).post('/auth/forgot-password/confirm').set('X-Zeus-Request', '1')
            .send({ email: 'user@example.com', code: oldCode, newPassword: 'An0ther-Str0ng-Pass!' });
        expect(r.status).toBe(400);
        expect(st.users['nou@example.org'].password_hash).toBe(HASH);
    });
});

describe('Turnstile (captcha Cloudflare)', () => {
    afterEach(() => { delete process.env.TURNSTILE_SECRET; jest.restoreAllMocks(); });
    test('fara cheie configurata: nu se cere (comportamentul de azi)', async () => {
        expect((await reg('t1@example.org')).status).toBe(200);
    });
    test('cu cheie: fara token → 403 la inscriere, login si resetare', async () => {
        process.env.TURNSTILE_SECRET = 'x';
        expect((await reg('t2@example.org')).status).toBe(403);
        expect((await request(app).post('/auth/login').set('X-Zeus-Request', '1').send({ email: 'user@example.com', password: PW })).status).toBe(403);
        expect((await forgot('user@example.com')).status).toBe(403);
    });
    test('cu cheie si token valid → trece', async () => {
        process.env.TURNSTILE_SECRET = 'x';
        jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
        const r = await request(app).post('/auth/register').set('X-Zeus-Request', '1')
            .send({ email: 't3@example.org', password: PW, termsAcceptedAt: '2026-11-27T10:00:00Z', termsVersion: '1', turnstileToken: 'tok' });
        expect(r.status).toBe(200);
    });
    test('cu cheie si serviciul Cloudflare cade → blocheaza (fail-closed)', async () => {
        process.env.TURNSTILE_SECRET = 'x';
        jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
        const r = await request(app).post('/auth/register').set('X-Zeus-Request', '1')
            .send({ email: 't4@example.org', password: PW, termsAcceptedAt: '2026-11-27T10:00:00Z', termsVersion: '1', turnstileToken: 'tok' });
        expect(r.status).toBe(403);
    });
});

describe('admin: inscrieri on/off si stergerea conturilor blocate', () => {
    test('doar adminul poate opri/porni inscrierile', async () => {
        expect((await as('user@example.com').post('/auth/admin/registration', { open: false })).status).toBe(403);
        const r = await as('admin@example.com').post('/auth/admin/registration', { open: false });
        expect(r.body).toMatchObject({ ok: true, open: false });
        expect(st.settings.registration_open).toBe('0');
        expect(st.audits).toContain('ADMIN_REGISTRATION_TOGGLE');
    });
    test('stergerea in masa: doar conturile BLOCATE, cu confirmare scrisa, auditata', async () => {
        st.users['user@example.com'].status = 'blocked';
        st.users['bot@mailinator.com'] = { id: 50, email: 'bot@mailinator.com', role: 'user', status: 'blocked', approved: 0 };
        expect((await as('admin@example.com').post('/auth/admin/delete-blocked', {})).status).toBe(400);
        const r = await as('admin@example.com').post('/auth/admin/delete-blocked', { confirm: 'DELETE BLOCKED' });
        expect(r.body).toMatchObject({ ok: true, deleted: 2 });
        expect(st.users['user@example.com']).toBeUndefined();
        expect(st.users['pending@example.com']).toBeTruthy();
        expect(st.users['admin@example.com']).toBeTruthy();
        expect(st.audits).toContain('ADMIN_DELETE_BLOCKED');
    });
    test('un user obisnuit nu poate sterge', async () => {
        expect((await as('user@example.com').post('/auth/admin/delete-blocked', { confirm: 'DELETE BLOCKED' })).status).toBe(403);
    });
});

describe('emailurile de cont nu pleaca spre adrese temporare', () => {
    test('blocarea in masa a unui bot nu-i trimite „suspended"', async () => {
        jest.resetModules();
        const AE = jest.requireActual('../../server/services/accountEmails');
        const sent = [];
        const ok = await AE.sendAccountEmail('suspended', 'bot@mailinator.com', { transport: { sendMail: async (m) => sent.push(m) } });
        expect(ok).toBe(false);
        expect(sent).toEqual([]);
    });
});

describe('cheia PUBLICA Turnstile pentru pagina', () => {
    afterEach(() => { delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET; });
    test('fara chei → siteKey null; cu ambele → doar cheia publica (secretul NU pleaca niciodata)', async () => {
        expect((await request(app).get('/auth/turnstile-config')).body).toEqual({ siteKey: null });
        process.env.TURNSTILE_SITE_KEY = '0x4AAAA-public'; process.env.TURNSTILE_SECRET = '0x4AAAA-secret';
        const r = await request(app).get('/auth/turnstile-config');
        expect(r.body).toEqual({ siteKey: '0x4AAAA-public' });
        expect(JSON.stringify(r.body)).not.toMatch(/secret/);
    });
    test('cheia publica fara secret → null (altfel pagina ar cere tokenuri pe care serverul nu le verifica)', async () => {
        process.env.TURNSTILE_SITE_KEY = '0x4AAAA-public';
        expect((await request(app).get('/auth/turnstile-config')).body).toEqual({ siteKey: null });
    });
});

// [2026-11-27] Etapa 2 — login cu 2FA din aplicatie: IN LOCUL codului pe email.
describe('login cu 2FA (aplicatie de autentificare)', () => {
    const login = () => request(app).post('/auth/login').send({ email: 'admin@example.com', password: PW });
    const verify = (code) => request(app).post('/auth/verify-code').send({ email: 'admin@example.com', code });
    test('fara 2FA: ca inainte — cod pe email, method=email', async () => {
        const r = await login();
        expect(r.body.needsCode).toBe(true);
        expect(r.body.method).toBe('email');
        expect(st.codes).toHaveLength(1);
    });
    test('cu 2FA: NU pleaca niciun email, se cere codul din aplicatie', async () => {
        st.totp = { 1: '424242' };
        const r = await login();
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ ok: true, needsCode: true, method: 'totp' });
        expect(st.codes).toHaveLength(0);
    });
    test('cu 2FA: codul din aplicatie deschide sesiunea', async () => {
        st.totp = { 1: '424242' };
        await login();
        const v = await verify('424242');
        expect(v.status).toBe(200);
        expect(String(v.headers['set-cookie'])).toContain('zeus_token=');
        expect(st.audits).toContain('LOGIN_SUCCESS');
    });
    test('cu 2FA: un cod gresit NU deschide sesiunea si se numara incercarea', async () => {
        st.totp = { 1: '424242' };
        await login();
        const v = await verify('111111');
        expect(v.status).toBe(401);
        expect(String(v.headers['set-cookie'] || '')).not.toContain('zeus_token=');
        expect(st.audits).toContain('LOGIN_2FA_FAILED');
    });
    test('cu 2FA: un cod venit pe EMAIL inainte nu mai merge (emailul spart nu ajunge)', async () => {
        await login();                                   // fara 2FA → cod pe email
        const emailCode = codeFrom(st.codes[0]);
        st.totp = { 1: '424242' };
        await login();                                   // acum 2FA e pornit → inlocuieste codul de email
        expect((await verify(emailCode)).status).toBe(401);
    });
    test('cu 2FA: dupa coduri gresite repetate nici codul corect nu mai deschide sesiunea', async () => {
        st.totp = { 1: '424242' };
        await login();
        let r;
        for (let i = 0; i < 6; i++) r = await verify('111111');
        expect(r.status).toBe(429);
        // si limita existenta pe IP (3 / 15 min) opreste mai devreme; ce conteaza: nici codul corect nu mai deschide
        const after = await verify('424242');
        expect(after.status).not.toBe(200);
        expect(String(after.headers['set-cookie'] || '')).not.toContain('zeus_token=');
    });
    test('cod de rezerva (XXXXX-XXXXX) ajunge la verificare, nu e taiat la 6 caractere', async () => {
        st.totp = { 1: 'ABCDE-FGHJK' };
        await login();
        expect((await verify('ABCDE-FGHJK')).status).toBe(200);
    });
});

// [2026-11-27] Etapa 3 — raportul de securitate din admin
describe('GET /auth/admin/security-report', () => {
    const get = (email) => request(app).get('/auth/admin/security-report').set('Cookie', cookieOf(st.users[email]));
    test('doar admin', async () => {
        expect((await get('user@example.com')).status).toBe(403);
    });
    test('admin → cifrele pe 24 h + alertele trimise azi', async () => {
        const r = await get('admin@example.com');
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ ok: true, report: { hours: 24, failedSignIns: 3 }, sentinel: { alertsSent: 1 } });
    });
});

// [2026-11-27] Revizie I-1 — telefon + coduri de rezerva pierdute: adminul poate scoate 2FA de pe ALT cont
describe('POST /auth/admin/reset-2fa', () => {
    const post = (email, body) => request(app).post('/auth/admin/reset-2fa').set('Cookie', cookieOf(st.users[email])).set('X-Zeus-Request', '1').send(body);
    test('doar admin', async () => {
        st.totp = { 2: '111111' };
        expect((await post('user@example.com', { email: 'user@example.com', confirm: 'RESET 2FA' })).status).toBe(403);
        expect(st.totp[2]).toBe('111111');
    });
    test('cere confirmarea scrisa', async () => {
        st.totp = { 2: '111111' };
        expect((await post('admin@example.com', { email: 'user@example.com' })).status).toBe(400);
        expect(st.totp[2]).toBe('111111');
    });
    test('pe alt cont: scoate 2FA, audit + email catre cont', async () => {
        st.totp = { 2: '111111' };
        const r = await post('admin@example.com', { email: 'user@example.com', confirm: 'RESET 2FA' });
        expect(r.status).toBe(200);
        expect(st.totp[2]).toBeUndefined();
        expect(st.audits).toContain('ADMIN_RESET_2FA');
        await flush();
        expect(st.mails).toContainEqual(['two_factor_disabled', 'user@example.com', null]);
    });
    test('pe PROPRIUL cont → refuzat (o sesiune furata de admin nu scoate 2FA-ul adminului)', async () => {
        st.totp = { 1: '424242' };
        expect((await post('admin@example.com', { email: 'admin@example.com', confirm: 'RESET 2FA' })).status).toBe(400);
        expect(st.totp[1]).toBe('424242');
    });
    test('cont fara 2FA → 404, nimic auditat ca reset', async () => {
        st.totp = {};
        expect((await post('admin@example.com', { email: 'user@example.com', confirm: 'RESET 2FA' })).status).toBe(404);
        expect(st.audits).not.toContain('ADMIN_RESET_2FA');
    });
});

// [2026-11-27] Revizie M-1 — o incercare 2FA ramasa, apoi 2FA oprit: login-ul NU refoloseste „codul null"
test('dupa oprirea 2FA in timpul unui login, se trimite un cod de email NOU, valid', async () => {
    st.totp = { 1: '424242' };
    await request(app).post('/auth/login').send({ email: 'admin@example.com', password: PW });
    st.totp = {};
    const r = await request(app).post('/auth/login').send({ email: 'admin@example.com', password: PW });
    expect(r.body.method).toBe('email');
    const code = codeFrom(st.codes[st.codes.length - 1]);
    expect(code).toMatch(/^\d{6}$/);
    expect((await request(app).post('/auth/verify-code').send({ email: 'admin@example.com', code })).status).toBe(200);
});

// [2026-11-27] Etapa 2 — roluri reale de staff, verificate pe server; staff fara 2FA = refuzat
describe('roluri de staff pe rutele de admin', () => {
    const get = (email, url) => request(app).get(url).set('Cookie', cookieOf(st.users[email]));
    const post = (email, url, body) => request(app).post(url).set('Cookie', cookieOf(st.users[email])).set('X-Zeus-Request', '1').send(body || {});
    beforeEach(() => { st.totp = { 4: '111111', 5: '222222' }; });
    test('support CU 2FA vede lista de conturi si auditul', async () => {
        expect((await get('support@example.com', '/auth/admin/users')).status).toBe(200);
        expect((await get('support@example.com', '/auth/admin/audit')).status).toBe(200);
    });
    test('support FARA 2FA → 403 cu motivul spus', async () => {
        st.totp = {};
        const r = await get('support@example.com', '/auth/admin/users');
        expect(r.status).toBe(403);
        expect(r.body.error).toMatch(/two-factor/i);
    });
    test('support NU poate bloca, sterge, schimba flag-uri sau inscrieri', async () => {
        expect((await post('support@example.com', '/auth/admin/block', { email: 'user@example.com' })).status).toBe(403);
        expect((await post('support@example.com', '/auth/admin/delete', { email: 'user@example.com' })).status).toBe(403);
        expect((await post('support@example.com', '/auth/admin/registration', { open: false })).status).toBe(403);
        expect(st.users['user@example.com'].status).toBe('active');
    });
    test('staff admin poate bloca un user, dar NU reseta parola sau 2FA (preluare de cont) si NU flags', async () => {
        expect((await post('staffadmin@example.com', '/auth/admin/block', { email: 'user@example.com', blocked: true })).status).toBe(200);
        expect((await post('staffadmin@example.com', '/auth/admin/reset-password', { email: 'user@example.com' })).status).toBe(403);
        expect((await post('staffadmin@example.com', '/auth/admin/reset-2fa', { email: 'user@example.com', confirm: 'RESET 2FA' })).status).toBe(403);
        expect((await post('staffadmin@example.com', '/auth/admin/flags', { key: 'X', value: true })).status).toBe(403);
    });
    test('user obisnuit → 403 peste tot', async () => {
        expect((await get('user@example.com', '/auth/admin/users')).status).toBe(403);
    });
    test('Super Admin neschimbat: totul merge, fara sa i se ceara 2FA', async () => {
        st.totp = {};
        expect((await get('admin@example.com', '/auth/admin/users')).status).toBe(200);
        expect((await get('admin@example.com', '/auth/admin/registration')).status).toBe(200);
    });
});

describe('POST /auth/admin/staff-role (doar Super Admin)', () => {
    const post = (email, body) => request(app).post('/auth/admin/staff-role').set('Cookie', cookieOf(st.users[email])).set('X-Zeus-Request', '1').send(body);
    beforeEach(() => { st.totp = { 4: '111111', 5: '222222' }; });
    test('Super Admin da rolul support unui user → salvat + audit', async () => {
        const r = await post('admin@example.com', { email: 'user@example.com', staffRole: 'support' });
        expect(r.status).toBe(200);
        expect(st.users['user@example.com'].staff_role).toBe('support');
        expect(st.audits).toContain('ADMIN_STAFF_ROLE');
    });
    test('null scoate rolul', async () => {
        expect((await post('admin@example.com', { email: 'support@example.com', staffRole: null })).status).toBe(200);
        expect(st.users['support@example.com'].staff_role).toBeNull();
    });
    test('rol necunoscut → 400', async () => {
        expect((await post('admin@example.com', { email: 'user@example.com', staffRole: 'superadmin' })).status).toBe(400);
    });
    test('pe propriul cont sau pe un Super Admin → 400', async () => {
        expect((await post('admin@example.com', { email: 'admin@example.com', staffRole: 'support' })).status).toBe(400);
    });
    test('staff admin NU poate da roluri (nicio escaladare)', async () => {
        const r = await post('staffadmin@example.com', { email: 'user@example.com', staffRole: 'admin' });
        expect(r.status).toBe(403);
        expect(st.users['user@example.com'].staff_role).toBeUndefined();
    });
});

// [2026-11-27] Staff nu atinge conturile de admin sau de staff; stergerea unui admin nu mai deconecteaza cheile
describe('tintele protejate', () => {
    const post = (email, url, body) => request(app).post(url).set('Cookie', cookieOf(st.users[email])).set('X-Zeus-Request', '1').send(body || {});
    beforeEach(() => { st.totp = { 4: '111111', 5: '222222' }; });
    test.each(['block', 'ban', 'force-logout', 'suspend', 'note', 'access-level', 'delete'])('staff admin pe contul Super Adminului: %s → 403', async (a) => {
        const r = await post('staffadmin@example.com', '/auth/admin/' + a, { email: 'admin@example.com', block: true, duration: '1h', note: 'x', level: 'viewer', reason: 'x' });
        expect(r.status).toBe(403);
        expect(st.users['admin@example.com'].status).toBe('active');
    });
    test('staff admin pe un alt membru staff → 403', async () => {
        expect((await post('staffadmin@example.com', '/auth/admin/block', { email: 'support@example.com', block: true })).status).toBe(403);
    });
    test('STERGEREA unui admin (chiar de catre Super Admin) e refuzata INAINTE sa atinga cheile de exchange', async () => {
        st.users['admin2@example.com'] = { id: 6, email: 'admin2@example.com', role: 'admin', status: 'active', token_version: 0, approved: 1, password_hash: HASH };
        const r = await post('admin@example.com', '/auth/admin/delete', { email: 'admin2@example.com' });
        expect(r.status).toBe(400);
        expect(st.disconnected || []).not.toContain(6);
    });
});

// [2026-11-27] /auth/me: rolul din BAZA (era din token) + rolul de staff si permisiunile, pentru panou
describe('/auth/me si rolurile', () => {
    const me = (u) => request(app).get('/auth/me').set('Cookie', cookieOf(u));
    test('admin retrogradat in baza → /me spune user, fara permisiuni', async () => {
        const tok = { ...st.users['admin@example.com'] };            // tokenul spune admin
        st.users['admin@example.com'].role = 'user';
        const r = await me(tok);
        expect(r.body.role).toBe('user');
        expect(r.body.permissions).toEqual([]);
    });
    test('support: staffRole + permisiunile lui', async () => {
        const r = await me(st.users['support@example.com']);
        expect(r.body).toMatchObject({ role: 'user', staffRole: 'support', permissions: ['users.view', 'audit.view', 'security.sessions', 'monitoring.view'] });
    });
    test('Super Admin: toate permisiunile', async () => {
        const r = await me(st.users['admin@example.com']);
        expect(r.body.role).toBe('admin');
        expect(r.body.permissions).toContain('settings.flags');
    });
});

test('lista de conturi din admin poarta rolul de staff (pentru pagina Roles)', async () => {
    const r = await request(app).get('/auth/admin/users').set('Cookie', cookieOf(st.users['admin@example.com']));
    const sup = r.body.users.find((u) => u.email === 'support@example.com');
    expect(sup.staffRole).toBe('support');
    expect(r.body.users.find((u) => u.email === 'user@example.com').staffRole).toBeNull();
});

// [2026-11-27] extra 3 — email la intrarea de pe un IP nou
describe('email la intrare de pe IP nou', () => {
    const loginAndVerify = async () => {
        await request(app).post('/auth/login').send({ email: 'admin@example.com', password: PW });
        const code = codeFrom(st.codes[st.codes.length - 1]);
        return request(app).post('/auth/verify-code').set('User-Agent', 'x').send({ email: 'admin@example.com', code });
    };
    test('IP nou → email new_sign_in cu IP-ul si dispozitivul', async () => {
        st.knownIps = { 1: ['82.77.10.140'] };
        expect((await loginAndVerify()).status).toBe(200);
        await flush();
        const m = st.mails.find((x) => x[0] === 'new_sign_in');
        expect(m).toBeTruthy();
        expect(m[1]).toBe('admin@example.com');
        expect(m[2]).toMatchObject({ device: 'Chrome on Android' });
    });
    test('IP cunoscut → fara email', async () => {
        st.knownIps = {};
        await loginAndVerify();
        await flush();
        expect(st.mails.find((x) => x[0] === 'new_sign_in')).toBeUndefined();
    });
});

// [2026-11-27] extra 2 — ultimele intrari + „deconecteaza-te de peste tot in afara de aici"
describe('sesiuni: ultimele intrari si deconectarea celorlalte', () => {
    test('ultimele intrari ale contului PROPRIU, cu dispozitivul', async () => {
        st.signins = [{ user_id: 1, ip: '9.9.9.9', created_at: '2026-11-27 20:00:00', details: '{"device":"Chrome on Android"}' }, { user_id: 2, ip: '8.8.8.8', created_at: 'x', details: '{}' }];
        const r = await request(app).get('/auth/security/recent-signins').set('Cookie', cookieOf(st.users['admin@example.com']));
        expect(r.status).toBe(200);
        expect(r.body.signins).toEqual([{ ip: '9.9.9.9', at: '2026-11-27 20:00:00', device: 'Chrome on Android' }]);
    });
    test('fara sesiune → 401', async () => {
        expect((await request(app).get('/auth/security/recent-signins')).status).toBe(401);
    });
    test('logout-others: versiunea tokenului creste, sesiunea curenta primeste token NOU, audit', async () => {
        const u = st.users['user@example.com'];
        const old = cookieOf(u);
        const r = await request(app).post('/auth/security/logout-others').set('Cookie', old).set('X-Zeus-Request', '1').send({});
        expect(r.status).toBe(200);
        expect(u.token_version).toBe(1);
        const set = String(r.headers['set-cookie']);
        expect(set).toContain('zeus_token=');
        const tok = set.match(/zeus_token=([^;]+)/)[1];
        expect(jwt.verify(tok, process.env.JWT_SECRET).tokenVersion).toBe(1);
        expect(st.audits).toContain('SESSIONS_REVOKED');
    });
    test('un token deja revocat nu poate folosi logout-others', async () => {
        const u = st.users['user@example.com'];
        const old = cookieOf(u);
        u.token_version = 5;
        expect((await request(app).post('/auth/security/logout-others').set('Cookie', old).set('X-Zeus-Request', '1').send({})).status).toBe(401);
    });
});

// [2026-11-27] extra 6 — parole cunoscute ca furate refuzate la inscriere / schimbare / resetare
describe('parole furate (Have I Been Pwned)', () => {
    const BAD = 'Password1234X';
    test('inscriere cu o parola furata → 400, contul nu se creeaza', async () => {
        st.pwned = [BAD];
        const r = await request(app).post('/auth/register').send({ email: 'nou@example.com', password: BAD, termsAcceptedAt: new Date().toISOString(), termsVersion: '1' });
        expect(r.status).toBe(400);
        expect(r.body.error).toMatch(/data breach/i);
        expect(st.users['nou@example.com']).toBeUndefined();
    });
    test('resetare de parola cu o parola furata → 400', async () => {
        st.pwned = [BAD];
        await request(app).post('/auth/forgot-password/request').send({ email: 'user@example.com' });
        const code = codeFrom(st.codes[st.codes.length - 1]);
        const r = await request(app).post('/auth/forgot-password/confirm').send({ email: 'user@example.com', code, newPassword: BAD });
        expect(r.status).toBe(400);
        expect(r.body.error).toMatch(/data breach/i);
    });
});

// [2026-11-27] extra 4 — cod anti-phishing
describe('cod anti-phishing', () => {
    const post = (u, body) => request(app).post('/auth/security/anti-phishing').set('Cookie', cookieOf(u)).set('X-Zeus-Request', '1').send(body);
    test('se seteaza, se citeste, apare in emailul cu codul de login', async () => {
        const u = st.users['admin@example.com'];
        expect((await post(u, { code: 'Blue Fox' })).status).toBe(200);
        expect((await request(app).get('/auth/security/anti-phishing').set('Cookie', cookieOf(u))).body.code).toBe('Blue Fox');
        await request(app).post('/auth/login').send({ email: 'admin@example.com', password: PW });
        const m = st.codes[st.codes.length - 1];
        expect(m.text).toContain('Your anti-phishing code: Blue Fox');
    });
    test('cuvant invalid (HTML) → 400, nimic salvat', async () => {
        const u = st.users['user@example.com'];
        expect((await post(u, { code: '<script>' })).status).toBe(400);
        expect(u.anti_phishing).toBeUndefined();
    });
    test('gol → sters', async () => {
        const u = st.users['user@example.com'];
        await post(u, { code: 'tiger' });
        expect((await post(u, { code: '' })).status).toBe(200);
        expect(u.anti_phishing).toBeNull();
    });
});

// [2026-11-27] Gasit pe drum: 12 rute de cont acceptau un token REVOCAT (dupa schimbarea parolei, „Sign out
// everywhere else", force-logout): /me, /pin/*, /change-password/*, /change-email/*, /close-account/*.
describe('token revocat pe rutele de cont', () => {
    const paths = [['get', '/auth/me'], ['get', '/auth/pin/status'], ['post', '/auth/pin/set'], ['post', '/auth/change-password/request'],
        ['post', '/auth/change-email/request'], ['post', '/auth/close-account/request']];
    test.each(paths)('%s %s cu token revocat → 401', async (m, url) => {
        const u = st.users['user@example.com'];
        const old = cookieOf(u);
        u.token_version = 3;
        const r = await request(app)[m](url).set('Cookie', old).set('X-Zeus-Request', '1').send({});
        expect(r.status).toBe(401);
    });
    test('cont suspendat/blocat → 401 si pe /me', async () => {
        const u = st.users['user@example.com'];
        u.status = 'blocked';
        expect((await request(app).get('/auth/me').set('Cookie', cookieOf(u))).status).toBe(401);
    });
    test('token valid → /me merge ca inainte', async () => {
        expect((await request(app).get('/auth/me').set('Cookie', cookieOf(st.users['user@example.com']))).status).toBe(200);
    });
});

describe('[2026-11-28] intrare cu passkey', () => {
    const pk = (url, body) => request(app).post(url).set('X-Zeus-Request', '1').send(body || {});
    test('stins (PASSKEY_ENABLED lipsa): config spune enabled:false, rutele 404', async () => {
        expect((await request(app).get('/auth/passkey/config')).body).toEqual({ ok: true, enabled: false });
        expect((await pk('/auth/passkey/options')).status).toBe(404);
        expect((await pk('/auth/passkey/verify', { challengeId: 'cid', response: {} })).status).toBe(404);
    });
    test('pornit: options da provocarea; un passkey valid deschide sesiunea, fara parola si fara cod', async () => {
        st.passkey = { enabled: true, result: { ok: true, userId: 2, passkeyId: 7 } };
        const o = await pk('/auth/passkey/options');
        expect(o.body).toMatchObject({ ok: true, challengeId: 'cid' });
        const r = await pk('/auth/passkey/verify', { challengeId: 'cid', response: { id: 'x' } });
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ ok: true, email: 'user@example.com', role: 'user' });
        const cookie = (r.headers['set-cookie'] || []).find((c) => c.startsWith('zeus_token='));
        expect(cookie).toBeTruthy();
        const tok = jwt.verify(cookie.split(';')[0].slice('zeus_token='.length), process.env.JWT_SECRET);
        expect(tok).toMatchObject({ id: 2, role: 'user', tokenVersion: 0 });
        expect(st.audits).toContain('LOGIN_SUCCESS');
    });
    test('rolul din sesiune vine din BAZA (adminul primeste admin)', async () => {
        st.passkey = { enabled: true, result: { ok: true, userId: 1, passkeyId: 1 } };
        const r = await pk('/auth/passkey/verify', { challengeId: 'cid', response: { id: 'x' } });
        expect(r.body.role).toBe('admin');
    });
    test('passkey invalid → 401, fara cookie, cu audit pe cont', async () => {
        st.passkey = { enabled: true, result: { ok: false, error: 'invalid', userId: 2 } };
        const r = await pk('/auth/passkey/verify', { challengeId: 'cid', response: { id: 'x' } });
        expect(r.status).toBe(401);
        expect((r.headers['set-cookie'] || []).some((c) => c.startsWith('zeus_token='))).toBe(false);
        expect(st.audits).toContain('LOGIN_PASSKEY_FAILED');
    });
    test('passkey necunoscut → 401 cu indrumare', async () => {
        st.passkey = { enabled: true, result: { ok: false, error: 'unknown' } };
        const r = await pk('/auth/passkey/verify', { challengeId: 'cid', response: { id: 'x' } });
        expect(r.status).toBe(401);
        expect(r.body.error).toMatch(/not registered/);
    });
    test('cont blocat / neaprobat / suspendat → fara sesiune, chiar cu passkey valid', async () => {
        st.passkey = { enabled: true, result: { ok: true, userId: 2, passkeyId: 7 } };
        st.users['user@example.com'].status = 'blocked';
        expect((await pk('/auth/passkey/verify', { challengeId: 'cid', response: {} })).status).toBe(403);
        st.users['user@example.com'].status = 'active';
        st.users['user@example.com'].status = 'banned'; st.users['user@example.com'].banned_until = '9999-12-31T00:00:00Z';
        const b = await pk('/auth/passkey/verify', { challengeId: 'cid', response: {} });
        expect(b.status).toBe(403);
        expect((b.headers['set-cookie'] || []).some((c) => c.startsWith('zeus_token='))).toBe(false);
        st.passkey.result = { ok: true, userId: 3, passkeyId: 8 };   // pending@ — neaprobat
        expect((await pk('/auth/passkey/verify', { challengeId: 'cid', response: {} })).status).toBe(403);
    });
    test('limita pe IP: dupa 20 de incercari in 15 min → 429', async () => {
        st.passkey = { enabled: true, result: { ok: false, error: 'invalid', userId: 2 } };
        let last;
        for (let i = 0; i < 21; i++) last = await pk('/auth/passkey/verify', { challengeId: 'cid', response: {} });
        expect(last.status).toBe(429);
    });
    test('intrarea cu passkey trimite emailul de IP nou', async () => {
        st.passkey = { enabled: true, result: { ok: true, userId: 2, passkeyId: 7 } };
        st.knownIps = { 2: ['9.9.9.9'] };
        await pk('/auth/passkey/verify', { challengeId: 'cid', response: {} });
        await flush();
        expect(st.mails.some((m) => m[0] === 'new_sign_in')).toBe(true);
    });
    test('[revizie] intrarile reusite nu consuma bugetul pe IP (un birou cu acelasi IP intra des)', async () => {
        st.passkey = { enabled: true, result: { ok: true, userId: 2, passkeyId: 7 } };
        for (let i = 0; i < 25; i++) {
            expect((await pk('/auth/passkey/options')).status).toBe(200);
            expect((await pk('/auth/passkey/verify', { challengeId: 'cid', response: {} })).status).toBe(200);
        }
    });
    test('[revizie] resetarea parolei pe email sterge passkey-urile (ce a lasat un hot nu supravietuieste)', async () => {
        st.passkeyCount = { 2: 2 };
        await forgot('user@example.com');
        const code = (String(st.codes[0].text).match(/Code: (\d{6})/) || [])[1];
        const r = await request(app).post('/auth/forgot-password/confirm').set('X-Zeus-Request', '1')
            .send({ email: 'user@example.com', code, newPassword: 'An0ther-Str0ng-Pass!' });
        expect(r.status).toBe(200);
        expect(st.passkeyCount[2]).toBe(0);
        expect(st.audits).toContain('PASSKEYS_CLEARED');
    });
    test('[revizie] resetarea parolei de catre admin sterge si ea passkey-urile', async () => {
        st.passkeyCount = { 2: 1 };
        const r = await as('admin@example.com').post('/auth/admin/reset-password', { email: 'user@example.com' });
        expect(r.status).toBe(200);
        expect(st.passkeyCount[2]).toBe(0);
    });
});
