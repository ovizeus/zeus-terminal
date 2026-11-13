'use strict';
// [2026-11-13] Emailurile de cont: „am primit cererea" si „accesul a fost aprobat".
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-account-emails';

const { registrationEmail, approvalEmail, sendAccountEmail, appUrl } = require('../../server/services/accountEmails');

describe('continutul emailurilor', () => {
    const reg = registrationEmail('ana@example.com');
    const app = approvalEmail('ana@example.com');

    test('inregistrare: confirma cererea, spune ca aprobarea e MANUALA si ca urmeaza al doilea email', () => {
        expect(reg.subject).toBe('Zeus Terminal — we received your request');
        expect(reg.text).toContain('ana@example.com');
        expect(reg.text).toMatch(/approved manually/);
        expect(reg.text).toMatch(/second email/);
        expect(reg.text).toMatch(/in beta/);
        expect(reg.text).toMatch(/did not request this account/);
        expect(reg.text.trim().endsWith('\n\nZeus Terminal team')).toBe(true);
    });

    test('aprobare: poate intra acum, cu linkul de login, si stie ce e deschis si ce e sub lacat', () => {
        expect(app.subject).toBe('Zeus Terminal — your access is approved');
        expect(app.text).toContain('https://zeus-terminal.com/login.html');
        expect(app.html).toContain('href="https://zeus-terminal.com/login.html"');
        expect(app.text).toMatch(/chart, indicators, market data and the liquidation map/);
        expect(app.text).toMatch(/locked until public launch/);
        expect(app.text).toMatch(/Support inside the app/);
    });

    test('⛔ niciun termen promis, in niciunul', () => {
        for (const m of [reg, app]) {
            expect(m.text).not.toMatch(/\b\d+\s*(hours?|days?|h)\b|within|tomorrow|next week|20\d\d/i);
        }
    });

    test('⛔ adresa nu poate injecta HTML in email', () => {
        const evil = registrationEmail('<img src=x onerror=alert(1)>@x.io');
        expect(evil.html).not.toContain('<img');
        expect(evil.html).toContain('&lt;img');
    });

    test('adresa publica vine din mediu doar daca e un https curat', () => {
        const old = process.env.APP_PUBLIC_URL;
        try {
            process.env.APP_PUBLIC_URL = 'https://beta.zeus-terminal.com/';
            expect(appUrl()).toBe('https://beta.zeus-terminal.com');
            for (const bad of ['http://x.io', 'javascript:alert(1)', 'https://x.io/path?a=1', '']) {
                process.env.APP_PUBLIC_URL = bad;
                expect(appUrl()).toBe('https://zeus-terminal.com');
            }
        } finally { if (old === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = old; }
    });
});

describe('sendAccountEmail — nu blocheaza si nu arunca', () => {
    const mk = (fail) => { const sent = []; return { sent, transport: { sendMail: async (m) => { if (fail) throw new Error('smtp down'); sent.push(m); } } }; };

    test('trimite emailul potrivit, doar destinatarului', async () => {
        const t = mk();
        expect(await sendAccountEmail('registered', ' Ana@Example.com ', t)).toBe(true);
        expect(await sendAccountEmail('approved', 'ana@example.com', t)).toBe(true);
        expect(t.sent.map((m) => [m.to, m.subject])).toEqual([
            ['ana@example.com', 'Zeus Terminal — we received your request'],
            ['ana@example.com', 'Zeus Terminal — your access is approved'],
        ]);
        for (const m of t.sent) { expect(m.cc).toBeUndefined(); expect(m.bcc).toBeUndefined(); }
    });

    test('⛔ SMTP cazut: intoarce false, nu arunca', async () => {
        await expect(sendAccountEmail('approved', 'ana@example.com', mk(true))).resolves.toBe(false);
    });

    test('⛔ tip necunoscut sau adresa stricata: nu trimite nimic', async () => {
        const t = mk();
        expect(await sendAccountEmail('rejected', 'ana@example.com', t)).toBe(false);
        expect(await sendAccountEmail('approved', 'not-an-email', t)).toBe(false);
        expect(await sendAccountEmail('approved', '', t)).toBe(false);
        expect(await sendAccountEmail('approved', 'a@b.io\nBcc: x@y.z', t)).toBe(false);
        expect(t.sent).toEqual([]);
    });
});

// ── Legarea in rute: CAND pleaca fiecare email ─────────────────────────────
describe('rutele trimit emailul o singura data, la momentul potrivit', () => {
    const request = require('supertest');
    const express = require('express');
    const cookieParser = require('cookie-parser');
    const jwt = require('jsonwebtoken');
    const ADMIN = { id: 1, email: 'admin@example.com', role: 'admin', status: 'active', token_version: 0, approved: 1 };

    function build(st) {
        jest.resetModules();
        jest.doMock('../../server/services/accountEmails', () => ({
            sendAccountEmail: async (kind, to) => { st.mails.push([kind, to]); return !st.mailFails; },   // ca functia reala: false la esec, niciodata exceptie
        }));
        jest.doMock('../../server/services/database', () => ({
            findUserByEmail: (e) => st.users[e] || null,
            findUserById: (id) => Object.values(st.users).find((u) => u.id === id) || null,
            listUsers: () => Object.values(st.users),
            countUsers: () => Object.keys(st.users).length,
            createUser: (email, hash, role, approved) => { const id = 100 + Object.keys(st.users).length; st.users[email] = { id, email, role, approved: approved ? 1 : 0, status: 'active', token_version: 0 }; return id; },
            addPasswordHistory: () => {}, setUserTermsConsent: () => {}, findUserByReferralCode: () => null, setReferredBy: () => {},
            approveUser: (email) => { st.users[email].approved = 1; },
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
    const adminCookie = () => 'zeus_token=' + jwt.sign({ id: 1, email: ADMIN.email, role: 'admin', tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const register = (app, email) => request(app).post('/auth/register').set('X-Zeus-Request', '1')
        .send({ email, password: 'Str0ng-Passw0rd!x', termsAcceptedAt: new Date().toISOString(), termsVersion: '2026-04-30-v1.1' });
    const approve = (app, email) => request(app).post('/auth/admin/approve').set('Cookie', adminCookie()).set('X-Zeus-Request', '1').send({ email });
    const flush = () => new Promise((r) => setImmediate(r));

    test('un cont NOU primeste „am primit cererea"; aceeasi adresa a doua oara nu mai primeste nimic', async () => {
        const st = { users: { [ADMIN.email]: { ...ADMIN } }, mails: [] };
        const app = build(st);
        const r1 = await register(app, 'new@example.com');
        expect([r1.status, r1.body.pending]).toEqual([200, true]);
        await flush();
        expect(st.mails).toEqual([['registered', 'new@example.com']]);
        const r2 = await register(app, 'new@example.com');
        expect(r2.body).toEqual(r1.body);                 // acelasi raspuns: nu se poate afla ca adresa exista
        await flush();
        expect(st.mails.length).toBe(1);                  // …si niciun email in plus
    });

    test('⛔ inregistrarea reuseste chiar daca emailul nu pleaca', async () => {
        const st = { users: { [ADMIN.email]: { ...ADMIN } }, mails: [], mailFails: true };
        const r = await register(build(st), 'new2@example.com');
        expect([r.status, r.body.pending]).toEqual([200, true]);
        expect(st.users['new2@example.com']).toBeTruthy();
    });

    test('aprobarea trimite „aprobat" o singura data — a doua apasare nu mai trimite', async () => {
        const st = { users: { [ADMIN.email]: { ...ADMIN }, 'p@example.com': { id: 7, email: 'p@example.com', role: 'user', approved: 0, status: 'active', token_version: 0 } }, mails: [] };
        const app = build(st);
        expect((await approve(app, 'p@example.com')).status).toBe(200);
        await flush();
        expect(st.mails).toEqual([['approved', 'p@example.com']]);
        expect((await approve(app, 'p@example.com')).status).toBe(200);
        await flush();
        expect(st.mails.length).toBe(1);
    });

    test('⛔ aprobarea reuseste chiar daca emailul nu pleaca', async () => {
        const st = { users: { [ADMIN.email]: { ...ADMIN }, 'q@example.com': { id: 8, email: 'q@example.com', role: 'user', approved: 0, status: 'active', token_version: 0 } }, mails: [], mailFails: true };
        const r = await approve(build(st), 'q@example.com');
        expect(r.status).toBe(200);
        expect(st.users['q@example.com'].approved).toBe(1);
    });
});
