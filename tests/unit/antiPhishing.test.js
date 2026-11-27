'use strict';
// [2026-11-27] Securitate extra 4 — cod anti-phishing (ca la Binance): un cuvant ales de utilizator apare in
// FIECARE email Zeus catre el; un email fara cuvant = fals.
const fs = require('fs'); const os = require('os'); const path = require('path');
let db, ae;
beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-antiphish-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    db = require('../../server/services/database');
    ae = require('../../server/services/accountEmails');
});

test('validare: 3–20 litere/cifre/spatiu/liniuta; altceva (HTML, prea lung) refuzat; gol = sters', () => {
    expect(ae.cleanAntiPhishing('Blue Fox-7')).toBe('Blue Fox-7');
    expect(ae.cleanAntiPhishing('  tiger  ')).toBe('tiger');
    expect(ae.cleanAntiPhishing('<b>x</b>')).toBeUndefined();
    expect(ae.cleanAntiPhishing('ab')).toBeUndefined();
    expect(ae.cleanAntiPhishing('a'.repeat(21))).toBeUndefined();
    expect(ae.cleanAntiPhishing('')).toBeNull();
});
test('withAntiPhishing pune cuvantul in text si in html, primul lucru vazut', () => {
    const m = ae.withAntiPhishing({ subject: 's', text: 'Hello', html: '<html><body><p>Hello</p></body></html>' }, 'Blue Fox');
    expect(m.text.startsWith('Your anti-phishing code: Blue Fox')).toBe(true);
    expect(m.html).toMatch(/<body>[\s\S]*Blue Fox[\s\S]*<p>Hello<\/p>/);
});
test('fara cuvant → emailul ramane neschimbat', () => {
    const m0 = { subject: 's', text: 't', html: '<p>t</p>' };
    expect(ae.withAntiPhishing(m0, null)).toEqual(m0);
});
test('sendAccountEmail pune cuvantul contului in email', async () => {
    db.db.prepare("INSERT INTO users (id, email, password_hash, role, approved, status) VALUES (901, 'ap@x.ro', 'x', 'user', 1, 'active')").run();
    db.setAntiPhishing(901, 'Blue Fox');
    const sent = [];
    const ok = await ae.sendAccountEmail('password_changed', 'ap@x.ro', { transport: { sendMail: async (m) => { sent.push(m); } } });
    expect(ok).toBe(true);
    expect(sent[0].text).toContain('Your anti-phishing code: Blue Fox');
    expect(sent[0].html).toContain('Blue Fox');
});
