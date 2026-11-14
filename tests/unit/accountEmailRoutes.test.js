'use strict';
// [2026-11-14] CAND pleaca fiecare email de cont. Continutul e verificat in
// accountEmails.test.js; aici se verifica legarea in rute: momentul potrivit,
// o singura data, catre adresa potrivita — si ca nicio ruta nu depinde de email.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-account-email-routes';

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
        loginAttemptGet: () => null, loginAttemptUpsert: () => {},
        auditLog: () => {},
        prepare: () => ({ run: () => ({}), get: () => null, all: () => [] }),
    }));
    jest.doMock('../../server/middleware/sessionAuth', () => ({ getActiveSessions: () => [], resetActivity: () => {} }));
    const app = express();
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
    st = { users: mkUsers(), mails: [], codes: [] };
    app = build(st);
});
afterEach(() => { for (const k of Object.keys(env)) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; } });

const as = (email) => {
    const u = st.users[email];
    return { post: (url, body) => request(app).post(url).set('Cookie', cookieOf(u)).set('X-Zeus-Request', '1').send(body || {}) };
};
const kinds = () => st.mails.map((m) => m[0] + ' → ' + m[1]);

describe('codurile poarta scopul lor', () => {
    test('schimbarea parolei: cod „confirm your password change", apoi confirmarea „password_changed"', async () => {
        const U = 'user@example.com';
        expect((await as(U).post('/auth/change-password/request', { currentPassword: PW })).status).toBe(200);
        expect(st.codes.length).toBe(1);
        expect(st.codes[0].subject).toBe('Zeus Terminal — confirm your password change');
        expect(st.codes[0].from).toBe('Zeus Terminal <box@example.com>');
        expect(st.mails).toEqual([]);                       // inca nu s-a schimbat nimic
        const r = await as(U).post('/auth/change-password/confirm', { code: codeFrom(st.codes[0]), newPassword: 'An0ther-Passw0rd!y' });
        expect(r.status).toBe(200);
        await flush();
        expect(kinds()).toEqual(['password_changed → user@example.com']);
    });

    test('⛔ un cod gresit nu schimba parola si nu trimite nicio confirmare', async () => {
        const U = 'user@example.com';
        await as(U).post('/auth/change-password/request', { currentPassword: PW });
        const right = codeFrom(st.codes[0]);
        const wrong = right === '000000' ? '000001' : '000000';
        const r = await as(U).post('/auth/change-password/confirm', { code: wrong, newPassword: 'An0ther-Passw0rd!y' });
        expect(r.status).toBe(400);
        await flush();
        expect(st.mails).toEqual([]);
        expect(st.users[U].password_hash).toBe(HASH);
    });

    test('parola uitata: cod „password reset", confirmarea merge pe adresa CONTULUI', async () => {
        const U = 'user@example.com';
        await request(app).post('/auth/forgot-password/request').set('X-Zeus-Request', '1').send({ email: ' User@Example.com ' });
        expect(st.codes[0].subject).toBe('Zeus Terminal — your password reset code');
        const r = await request(app).post('/auth/forgot-password/confirm').set('X-Zeus-Request', '1')
            .send({ email: 'USER@example.com', code: codeFrom(st.codes[0]), newPassword: 'An0ther-Passw0rd!y' });
        expect(r.status).toBe(200);
        await flush();
        expect(kinds()).toEqual(['password_reset → ' + U]);
    });

    test('⛔ parola uitata pentru o adresa necunoscuta: acelasi raspuns, niciun email', async () => {
        const r = await request(app).post('/auth/forgot-password/request').set('X-Zeus-Request', '1').send({ email: 'ghost@example.com' });
        expect(r.status).toBe(200);
        expect(st.codes).toEqual([]);
        expect(st.mails).toEqual([]);
    });

    test('schimbarea emailului: codul pleaca pe adresa NOUA, anuntul pe cea VECHE', async () => {
        const U = 'user@example.com';
        await as(U).post('/auth/change-email/request', { currentPassword: PW, newEmail: 'fresh@example.com' });
        expect(st.codes[0].to).toBe('fresh@example.com');
        expect(st.codes[0].subject).toBe('Zeus Terminal — confirm your new email address');
        const r = await as(U).post('/auth/change-email/confirm', { code: codeFrom(st.codes[0]) });
        expect(r.status).toBe(200);
        expect(r.body.message).toBe('Your email address has been changed.');
        await flush();
        expect(kinds()).toEqual(['email_changed → user@example.com']);
    });

    test('inchiderea contului: cod „confirm closing your account", apoi „account_closed"', async () => {
        const U = 'user@example.com';
        await as(U).post('/auth/close-account/request', { currentPassword: PW });
        expect(st.codes[0].subject).toBe('Zeus Terminal — confirm closing your account');
        expect(st.codes[0].text).not.toMatch(/sign-in code|login/i);
        const cookie = cookieOf(st.users[U]);
        const r = await request(app).post('/auth/close-account/confirm').set('Cookie', cookie).set('X-Zeus-Request', '1').send({ code: codeFrom(st.codes[0]) });
        expect(r.status).toBe(200);
        await flush();
        expect(kinds()).toEqual(['account_closed → user@example.com']);
        expect(st.users[U]).toBeUndefined();
    });
});

describe('actiunile adminului', () => {
    const A = 'admin@example.com', U = 'user@example.com';

    test('resetare de parola: omul e anuntat, iar parola temporara NU ajunge in email', async () => {
        const r = await as(A).post('/auth/admin/reset-password', { email: U });
        expect(r.status).toBe(200);
        const temp = r.body.tempPassword;
        expect(temp.length).toBeGreaterThan(8);
        await flush();
        expect(kinds()).toEqual(['admin_password_reset → ' + U]);
        expect(JSON.stringify(st.mails)).not.toContain(temp);
    });

    test('acces complet: un email la ridicare, niciunul la a doua apasare sau la coborare', async () => {
        await as(A).post('/auth/admin/access-level', { email: U, level: 'full' });
        await as(A).post('/auth/admin/access-level', { email: U, level: 'full' });
        await as(A).post('/auth/admin/access-level', { email: U, level: 'viewer' });
        await flush();
        expect(kinds()).toEqual(['access_full → ' + U]);
    });

    test('blocare si deblocare: cate un email, o singura data fiecare', async () => {
        await as(A).post('/auth/admin/block', { email: U, block: true });
        await as(A).post('/auth/admin/block', { email: U, block: true });
        await as(A).post('/auth/admin/block', { email: U, block: false });
        await as(A).post('/auth/admin/block', { email: U, block: false });
        await flush();
        expect(kinds()).toEqual(['suspended → ' + U, 'restored → ' + U]);
    });

    test('ban cu durata poarta data; ban permanent nu', async () => {
        await as(A).post('/auth/admin/ban', { email: U, duration: '7d' });
        await as(A).post('/auth/admin/ban', { email: U, duration: 'permanent' });
        await flush();
        expect(st.mails[0][0]).toBe('suspended');
        expect(new Date(st.mails[0][2].until).getTime()).toBeGreaterThan(Date.now() + 6 * 86400000);
        expect(st.mails[1][2]).toEqual({});
    });

    test('ridicarea unui ban trimite „restored"', async () => {
        await as(A).post('/auth/admin/ban', { email: U, duration: '7d' });
        await as(A).post('/auth/admin/block', { email: U, block: false });
        await flush();
        expect(kinds()).toEqual(['suspended → ' + U, 'restored → ' + U]);
    });

    test('suspendare: un email, nu doua', async () => {
        await as(A).post('/auth/admin/suspend', { email: U });
        await as(A).post('/auth/admin/suspend', { email: U });
        await flush();
        expect(kinds()).toEqual(['suspended → ' + U]);
    });

    test('⛔ respingerea si stergerea unui cont nu trimit niciun email', async () => {
        await as(A).post('/auth/admin/reject', { email: 'pending@example.com' });
        await as(A).post('/auth/admin/delete', { email: U });
        await flush();
        expect(st.mails).toEqual([]);
    });
});

describe('⛔ nicio actiune nu depinde de email', () => {
    test('cu trimiterea cazuta, parola tot se schimba si accesul tot se ridica', async () => {
        st.mailFails = true;
        const U = 'user@example.com';
        await as(U).post('/auth/change-password/request', { currentPassword: PW });
        const r = await as(U).post('/auth/change-password/confirm', { code: codeFrom(st.codes[0]), newPassword: 'An0ther-Passw0rd!y' });
        expect(r.status).toBe(200);
        expect(st.users[U].password_hash).not.toBe(HASH);
        const g = await as('admin@example.com').post('/auth/admin/access-level', { email: U, level: 'full' });
        expect(g.status).toBe(200);
        expect(st.users[U].access_level).toBe('full');
    });
});

describe('raspunsurile serverului sunt in engleza', () => {
    test('niciun text in romana in rutele de cont', () => {
        const fs = require('fs'), path = require('path');
        for (const f of ['server/routes/auth.js', 'server/routes/exchange.js', 'server/middleware/resolveExchange.js']) {
            const src = fs.readFileSync(path.resolve(__dirname, '../..', f), 'utf8');
            const strings = [...src.matchAll(/(?:error|message|note):\s*'([^']*)'/g)].map((m) => m[1]);
            for (const s of strings) expect([f, s, /trimis|necesar|\beste\b|minim \d|deja folosit|cu succes|configureaz/i.test(s)]).toEqual([f, s, false]);
        }
    });
});

describe('raspunsul la suport', () => {
    function buildSupport(s) {
        jest.resetModules();
        jest.doMock('../../server/services/accountEmails', () => ({ sendAccountEmail: async (kind, to, opts) => { s.mails.push([kind, to, opts && opts.data]); return true; } }));
        jest.doMock('../../server/services/database', () => ({
            insertSupportMessage: (uid, sender, message) => { if (s.dbFails) throw new Error('db down'); return { id: 1, user_id: uid, sender, message }; },
            findUserById: (id) => (id === 2 ? { id: 2, email: 'user@example.com' } : null),
        }));
        const a = express();
        a.use(express.json());
        a.use((req, _res, next) => { req.user = s.user; next(); });
        a.use('/api/support', require('../../server/routes/support.js'));
        return a;
    }
    const ADMIN = { id: 1, role: 'admin' };

    test('adminul raspunde → omul primeste un email cu mesajul', async () => {
        const s = { mails: [], user: ADMIN };
        const r = await request(buildSupport(s)).post('/api/support/reply/2').send({ message: 'Fixed, try again.' });
        expect(r.status).toBe(200);
        await flush();
        expect(s.mails).toEqual([['support_reply', 'user@example.com', { message: 'Fixed, try again.' }]]);
    });
    test('⛔ un user obisnuit nu poate declansa emailul', async () => {
        const s = { mails: [], user: { id: 2, role: 'user' } };
        const r = await request(buildSupport(s)).post('/api/support/reply/2').send({ message: 'x' });
        expect(r.status).toBe(403);
        expect(s.mails).toEqual([]);
    });
    test('raspuns catre un cont care nu mai exista: fara email, fara eroare', async () => {
        const s = { mails: [], user: ADMIN };
        const r = await request(buildSupport(s)).post('/api/support/reply/99').send({ message: 'hello' });
        expect(r.status).toBe(200);
        expect(s.mails).toEqual([]);
    });
    test('⛔ daca mesajul nu s-a salvat, nu pleaca niciun email', async () => {
        const s = { mails: [], user: ADMIN, dbFails: true };
        const r = await request(buildSupport(s)).post('/api/support/reply/2').send({ message: 'hello' });
        expect(r.status).toBe(500);
        expect(s.mails).toEqual([]);
    });
});
