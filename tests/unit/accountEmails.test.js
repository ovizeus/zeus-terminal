'use strict';
// Emailurile de cont. [2026-11-13] cererea si aprobarea; [2026-11-14] codurile
// cu scop, confirmarile de schimbare, accesul, suspendarea, raspunsul la suport.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-account-emails';

const E = require('../../server/services/accountEmails');
const ADDR = 'ana@example.com';

const ALL = {
    registered: E.registrationEmail(ADDR),
    approved: E.approvalEmail(ADDR),
    code_login: E.codeEmail('login', '123456', 5),
    code_close: E.codeEmail('close_account', '123456', 5),
    password_changed: E.passwordChangedEmail(ADDR, { at: Date.UTC(2026, 10, 14, 9, 30) }),
    password_reset: E.passwordResetEmail(ADDR, { at: Date.UTC(2026, 10, 14, 9, 30) }),
    admin_password_reset: E.adminPasswordResetEmail(ADDR),
    account_closed: E.accountClosedEmail(ADDR),
    email_changed: E.emailChangedEmail(ADDR),
    access_full: E.accessFullEmail(ADDR),
    suspended: E.suspendedEmail(ADDR, {}),
    suspended_until: E.suspendedEmail(ADDR, { until: '2026-11-21T10:00:00.000Z' }),
    restored: E.restoredEmail(ADDR),
    support_reply: E.supportReplyEmail(ADDR, { message: 'Hello, your chart is fixed.' }),
};

describe('reguli care tin pentru TOATE emailurile', () => {
    test.each(Object.entries(ALL))('%s: subiect cu numele aplicatiei, text si html, semnat „Zeus Terminal team"', (_k, m) => {
        expect(m.subject.startsWith('Zeus Terminal — ')).toBe(true);
        expect(m.text.trim().endsWith('\n\nZeus Terminal team')).toBe(true);
        expect(m.html).toContain('Zeus Terminal team');
        expect(m.text).not.toContain('The Zeus Terminal team');
        expect(m.text.length).toBeGreaterThan(60);
    });
    test.each(Object.entries(ALL))('%s: fara emoji in subiect si fara text in romana', (_k, m) => {
        expect(m.subject).toMatch(/^[\x20-\x7E—]+$/);
        expect(m.text).not.toMatch(/\b(parola|contul|trimis|este|pentru|echipa)\b/i);
    });
    test.each(Object.entries(ALL))('%s: ⛔ nicio promisiune de termen sau de lansare', (_k, m) => {
        // „one hour" si „5 minutes" sunt durate reale ale sistemului, nu promisiuni.
        // …iar „as soon as your account is approved" spune ordinea, nu un termen.
        const t = m.text.replace(/works for one hour|expires in \d+ minutes|as soon as/g, '');
        expect(t).not.toMatch(/within \d|in \d+ (hours?|days?)|tomorrow|next week|soon\b/i);
    });
    test.each(Object.entries(ALL))('%s: ⛔ html-ul nu are nimic neescapat din afara', (_k, m) => {
        expect(m.html).not.toMatch(/<script|onerror=|javascript:/i);
    });
});

describe('cererea si aprobarea', () => {
    test('inregistrare: aprobarea e MANUALA si urmeaza un al doilea email', () => {
        const t = ALL.registered.text;
        expect(ALL.registered.subject).toBe('Zeus Terminal — we received your request');
        expect(t).toContain(ADDR);
        expect(t).toMatch(/approved manually/);
        expect(t).toMatch(/second email/);
        expect(t).toMatch(/did not request this account/);
    });
    test('aprobare: linkul de intrare, ce e deschis si ce e sub lacat', () => {
        expect(ALL.approved.subject).toBe('Zeus Terminal — your access is approved');
        expect(ALL.approved.text).toContain('https://zeus-terminal.com/login.html');
        expect(ALL.approved.html).toContain('href="https://zeus-terminal.com/login.html"');
        expect(ALL.approved.text).toMatch(/locked until public launch/);
    });
});

describe('codurile spun PENTRU CE sunt', () => {
    const subj = (p) => E.codeEmail(p, '123456', 5).subject;
    test('cinci scopuri, cinci subiecte diferite', () => {
        const all = ['login', 'change_password', 'change_email', 'forgot_password', 'close_account'].map(subj);
        expect(new Set(all).size).toBe(5);
        expect(all).toEqual([
            'Zeus Terminal — your sign-in code',
            'Zeus Terminal — confirm your password change',
            'Zeus Terminal — confirm your new email address',
            'Zeus Terminal — your password reset code',
            'Zeus Terminal — confirm closing your account',
        ]);
    });
    test('⛔ codul pentru INCHIDEREA contului nu mai scrie „login"', () => {
        const m = E.codeEmail('close_account', '654321', 5);
        expect(m.text).not.toMatch(/sign-in code|login/i);
        expect(m.text).toMatch(/close your Zeus Terminal account/);
        expect(m.text).toMatch(/cannot be undone/);
    });
    test('codul apare in text si in html, cu durata reala', () => {
        const m = E.codeEmail('login', '482913', 5);
        expect(m.text).toContain('Code: 482913');
        expect(m.html).toContain('482913');
        expect(m.text).toContain('expires in 5 minutes');
        expect(E.codeEmail('login', '482913', 10).text).toContain('expires in 10 minutes');
        expect(m.text).toMatch(/Never share this code/);
    });
    test('un scop necunoscut cade pe login, nu pe un email gol', () => {
        expect(subj('ceva')).toBe('Zeus Terminal — your sign-in code');
    });
});

describe('confirmarile', () => {
    test('parola schimbata: cand, ca celelalte sesiuni au fost inchise, si ce faci daca n-ai fost tu', () => {
        const t = ALL.password_changed.text;
        expect(ALL.password_changed.subject).toBe('Zeus Terminal — your password was changed');
        expect(t).toContain('2026-11-14 09:30 UTC');
        expect(t).toMatch(/Every other session was signed out/);
        expect(t).toMatch(/If this was not you/);
        expect(t).toContain('https://zeus-terminal.com/support.html');
    });
    test('parola resetata din „forgot password"', () => {
        expect(ALL.password_reset.subject).toBe('Zeus Terminal — your password was reset');
        expect(ALL.password_reset.text).toMatch(/using a code sent to this address/);
        expect(ALL.password_reset.text).toMatch(/If this was not you/);
    });
    test('⛔ resetarea facuta de echipa NU contine nicio parola', () => {
        const m = ALL.admin_password_reset;
        expect(m.subject).toBe('Zeus Terminal — your password was reset by our team');
        expect(m.text).toMatch(/our team will give it to you directly/);
        expect(m.text).toMatch(/works for one hour/);
        expect(m.text).toMatch(/Forgot password/);
        // functia nici nu primeste parola: nu are de unde s-o scrie
        expect(E.adminPasswordResetEmail.length).toBe(1);
    });
    test('cont inchis: nu promite ca s-au sters date', () => {
        const t = ALL.account_closed.text;
        expect(ALL.account_closed.subject).toBe('Zeus Terminal — your account has been closed');
        expect(t).toMatch(/closed at your request/);
        expect(t).not.toMatch(/all (your )?data (has been|was) (deleted|erased|removed)/i);
    });
    test('⛔ anuntul catre adresa veche nu spune care e adresa noua', () => {
        const m = E.emailChangedEmail('old@example.com', { newEmail: 'new@example.com' });
        expect(m.text).not.toContain('new@example.com');
        expect(m.html).not.toContain('new@example.com');
        expect(m.text).toMatch(/no longer linked to the account/);
    });
});

describe('accesul si suportul', () => {
    test('acces complet: ce s-a deschis', () => {
        expect(ALL.access_full.subject).toBe('Zeus Terminal — you now have full access');
        expect(ALL.access_full.text).toMatch(/AutoTrade, manual trading, ARES, DSL and OMEGA/);
    });
    test('suspendare: cu data cand exista, fara data cand nu', () => {
        expect(ALL.suspended_until.text).toContain('suspended until 2026-11-21 10:00 UTC');
        expect(ALL.suspended.text).not.toMatch(/until/);
        expect(ALL.suspended.text).toContain('https://zeus-terminal.com/support.html');
    });
    test('reactivare', () => {
        expect(ALL.restored.subject).toBe('Zeus Terminal — your account is active again');
    });
    test('raspuns la suport: cu mesajul, scurtat daca e lung, escapat', () => {
        expect(ALL.support_reply.text).toContain('"Hello, your chart is fixed."');
        const long = E.supportReplyEmail(ADDR, { message: 'x'.repeat(5000) });
        expect(long.text.length).toBeLessThan(1200);
        expect(long.text).toContain('…');
        const evil = E.supportReplyEmail(ADDR, { message: '<img src=x onerror=alert(1)>' });
        expect(evil.html).not.toContain('<img');
        expect(evil.html).toContain('&lt;img');
    });
});

describe('expeditorul si adresa publica', () => {
    const withEnv = (vars, fn) => {
        const old = {};
        for (const k of Object.keys(vars)) { old[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
        try { return fn(); } finally { for (const k of Object.keys(old)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
    };
    test('o adresa goala primeste numele „Zeus Terminal"', () => {
        expect(withEnv({ SMTP_FROM: 'box@example.com', SMTP_USER: 'u@example.com' }, E.fromHeader)).toBe('Zeus Terminal <box@example.com>');
        expect(withEnv({ SMTP_FROM: undefined, SMTP_USER: 'u@example.com' }, E.fromHeader)).toBe('Zeus Terminal <u@example.com>');
    });
    test('un nume deja pus ramane neatins', () => {
        expect(withEnv({ SMTP_FROM: 'Zeus <noreply@zeus-terminal.com>' }, E.fromHeader)).toBe('Zeus <noreply@zeus-terminal.com>');
    });
    test('⛔ o valoare stricata nu e impachetata intr-un antet inventat', () => {
        expect(withEnv({ SMTP_FROM: 'a@b.io\r\nBcc: x@y.z', SMTP_USER: undefined }, E.fromHeader)).not.toMatch(/^Zeus Terminal </);
        expect(withEnv({ SMTP_FROM: undefined, SMTP_USER: undefined }, E.fromHeader)).toBe('');
    });
    test('adresa publica vine din mediu doar daca e un https curat', () => {
        expect(withEnv({ APP_PUBLIC_URL: 'https://beta.zeus-terminal.com/' }, E.appUrl)).toBe('https://beta.zeus-terminal.com');
        for (const bad of ['http://x.io', 'javascript:alert(1)', 'https://x.io/path?a=1', '']) {
            expect(withEnv({ APP_PUBLIC_URL: bad }, E.appUrl)).toBe('https://zeus-terminal.com');
        }
    });
});

describe('sendAccountEmail — nu blocheaza si nu arunca', () => {
    const mk = (fail) => { const sent = []; return { sent, transport: { sendMail: async (m) => { if (fail) throw new Error('smtp down'); sent.push(m); } } }; };
    beforeEach(() => E._resetThrottleForTest());

    test('trimite emailul potrivit, doar destinatarului', async () => {
        const t = mk();
        expect(await E.sendAccountEmail('registered', ' Ana@Example.com ', t)).toBe(true);
        expect(await E.sendAccountEmail('password_changed', ADDR, t)).toBe(true);
        expect(t.sent.map((m) => [m.to, m.subject])).toEqual([
            [ADDR, 'Zeus Terminal — we received your request'],
            [ADDR, 'Zeus Terminal — your password was changed'],
        ]);
        for (const m of t.sent) { expect(m.cc).toBeUndefined(); expect(m.bcc).toBeUndefined(); }
    });
    test('datele ajung la sablon (data suspendarii)', async () => {
        const t = mk();
        await E.sendAccountEmail('suspended', ADDR, { ...t, data: { until: '2026-11-21T10:00:00.000Z' } });
        expect(t.sent[0].text).toContain('until 2026-11-21 10:00 UTC');
    });
    test('⛔ SMTP cazut: intoarce false, nu arunca', async () => {
        await expect(E.sendAccountEmail('approved', ADDR, mk(true))).resolves.toBe(false);
    });
    test('⛔ tip necunoscut sau adresa stricata: nu trimite nimic', async () => {
        const t = mk();
        for (const kind of ['rejected', 'constructor', 'toString', '']) expect(await E.sendAccountEmail(kind, ADDR, t)).toBe(false);
        for (const addr of ['not-an-email', '', 'a@b.io\nBcc: x@y.z']) expect(await E.sendAccountEmail('approved', addr, t)).toBe(false);
        expect(t.sent).toEqual([]);
    });
    test('⛔ sub teste, fara transport dat explicit, nu pleaca nimic', async () => {
        expect(await E.sendAccountEmail('approved', ADDR)).toBe(false);
    });
    test('raspunsurile de la suport: cel mult un email la 10 minute pe adresa', async () => {
        const t = mk();
        const at = (ms) => ({ ...t, data: { message: 'hi' }, now: 1_000_000 + ms });
        expect(await E.sendAccountEmail('support_reply', ADDR, at(0))).toBe(true);
        expect(await E.sendAccountEmail('support_reply', ADDR, at(60_000))).toBe(false);
        expect(await E.sendAccountEmail('support_reply', 'altul@example.com', at(60_000))).toBe(true);   // alt om: nu e franat
        expect(await E.sendAccountEmail('support_reply', ADDR, at(E.SUPPORT_THROTTLE_MS + 1))).toBe(true);
        // franarea e doar pentru suport: confirmarile de securitate pleaca mereu
        expect(await E.sendAccountEmail('password_changed', ADDR, at(1))).toBe(true);
        expect(await E.sendAccountEmail('password_changed', ADDR, at(2))).toBe(true);
        expect(t.sent.length).toBe(5);
    });
});
