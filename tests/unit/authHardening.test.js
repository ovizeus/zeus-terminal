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
        disconnectExchange: () => {},
        deleteUser: (email) => { delete st.users[email]; },
        loginAttemptGet: (k, key) => st.attempts[k + '|' + key] || null, loginAttemptUpsert: (k, key, count, reset_at) => { st.attempts[k + '|' + key] = { count, reset_at }; },
        getSystemSetting: (k) => (k in st.settings ? st.settings[k] : null), setSystemSetting: (k, v) => { st.settings[k] = v; },
        auditLog: (uid, action, details) => { st.audits.push(action); },
        prepare: () => ({ run: () => ({}), get: () => null, all: () => [] }),
    }));
    // 2FA: cine il are pornit (st.totp[uid] = codul valid de 6 cifre), ca sa controlam login-ul
    jest.doMock('../../server/services/twoFactor', () => ({
        isEnabled: (uid) => !!(st.totp && st.totp[uid]),
        verifyLogin: (uid, code) => (st.totp && st.totp[uid] && String(code).replace(/\s/g, '') === st.totp[uid])
            ? { ok: true, method: 'totp' } : { ok: false },
    }));
    jest.doMock('../../server/services/securitySentinel', () => ({
        dailyReport: () => ({ hours: 24, failedSignIns: 3, resetRequests: 1, signUps: 0, blockedSignUps: 0, signIns: 2, topFailIps: [] }),
        summary: () => ({ alertsSent: 1 }),
    }));
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
