'use strict';
// [2026-11-22] Notificari importante pe telefon: intrari/iesiri AT, miscari mari de pret, siguranta —
// adunate pe sfert de ora (nu abundente), oprite/pornite din Alerts.
const path = require('path');
const fs = require('fs');
const os = require('os');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-ev-'));
process.env.ZEUS_DB_PATH = path.join(DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../server/services/database');
const NE = require('../../server/services/notifyEvents');
const ND = require('../../server/services/notifyDevices');

const T0 = Date.parse('2026-11-22T10:00:00Z');
beforeEach(() => {
    db.prepare('DELETE FROM notify_events').run();
    db.prepare('DELETE FROM notify_prefs').run();
    db.prepare('DELETE FROM notify_devices').run();
    db.prepare('DELETE FROM support_messages').run();
    db.prepare('DELETE FROM users').run();
    for (const id of [1, 2]) db.prepare("INSERT INTO users (id, email, password_hash, role, approved, status) VALUES (?, ?, 'x', 'user', 1, 'active')").run(id, `u${id}@t.local`);
    NE._resetForTest();
    ND.register(1);
});
afterAll(() => { try { db.close(); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} });

test('implicit totul pornit; alegerile se salveaza si se citesc', () => {
    expect(NE.getPrefs(1)).toEqual({ support: true, price: true, atEntry: true, atExit: true, safety: true });
    expect(NE.setPrefs(1, { atEntry: false, price: 'nu' })).toMatchObject({ atEntry: false, price: true });
    expect(NE.getPrefs(1).atEntry).toBe(false);
});

test('NU abundente: intrarile din acelasi sfert de ora se aduna intr-o singura notificare', () => {
    NE.push(1, 'atEntry', 'DEMO LONG BTC @ $60000', T0);
    NE.push(1, 'atEntry', 'DEMO SHORT ETH @ $1680', T0 + 60_000);
    NE.push(1, 'atEntry', 'DEMO LONG SOL @ $70', T0 + 120_000);
    const ev = NE.forUser(1, null, T0 + 130_000);
    expect(ev).toHaveLength(1);
    expect(ev[0].title).toBe('Auto-trade: 3 entries');
    expect(ev[0].body.split('\n')[0]).toBe('DEMO LONG SOL @ $70');
    // sfertul urmator = notificare noua
    NE.push(1, 'atEntry', 'DEMO LONG XRP', T0 + 16 * 60_000);
    expect(NE.forUser(1, null, T0 + 17 * 60_000)).toHaveLength(2);
});

test('fara telefon inregistrat nu se scrie nimic; dupa o ora evenimentul iese', () => {
    expect(NE.push(2, 'atExit', 'x', T0)).toBe(false);
    NE.push(1, 'atExit', 'DEMO LONG BTC +$12.40 · DSL_PL · 20 min', T0);
    expect(NE.forUser(1, null, T0 + 59 * 60_000)).toHaveLength(1);
    expect(NE.forUser(1, null, T0 + 61 * 60_000)).toHaveLength(0);
});

test('casuta oprita = nimic pe telefon, iar cifra de pe iconita nu-l numara', () => {
    NE.push(1, 'atEntry', 'DEMO LONG BTC', Date.now());
    NE.push(1, 'safety', 'Kill switch ON', Date.now());
    NE.setPrefs(1, { atEntry: false });
    const p = ND.pending(1, false);
    expect(p.items.map((i) => i.kind)).toEqual(['safety']);
    expect(p.badge).toBe(1);
});

test('Support & admin oprit: raspunsurile suportului nu mai vin', () => {
    db.prepare("INSERT INTO support_messages (user_id, sender, message) VALUES (1, 'admin', 'hi')").run();
    expect(ND.pending(1, false).badge).toBe(1);
    NE.setPrefs(1, { support: false });
    expect(ND.pending(1, false)).toEqual({ badge: 0, items: [] });
});

test('pret: ±3% intr-o ora → o notificare pentru toti; o data la 3 ore pe moneda', () => {
    let t = T0;
    for (let i = 0; i <= 60; i++) { NE.onPrice('BTCUSDT', 60000 + i * 10, t); t += 60_000; }   // +1% — nimic
    expect(NE.forUser(1, null, t)).toHaveLength(0);
    const line = NE.onPrice('BTCUSDT', 62500, t);                                                 // ~ +4%
    expect(line).toMatch(/^BTC ▲ \+4\.\d% in 1h — now \$62,500$/);
    expect(NE.forUser(1, null, t)[0]).toMatchObject({ kind: 'price', title: 'Big price move' });
    // in urmatoarele 3 ore: nu se repeta
    for (let i = 1; i <= 30; i++) expect(NE.onPrice('BTCUSDT', 65000 + i * 100, t + i * 60_000)).toBeNull();
    NE.setPrefs(1, { price: false });
    expect(NE.forUser(1, null, t)).toHaveLength(0);
});

test('motorul AT apeleaza notificarile doar in try/catch (nu poate atinge tranzactionarea)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../server/services/serverAT.js'), 'utf8');
    expect(src).toMatch(/function _phone\(userId, kind, line\) \{ try \{ require\('\.\/notifyEvents'\)\.push\(userId, kind, line\); \} catch \(_\) \{/);
    for (const k of ['atEntry', 'atExit', 'safety']) expect(src).toMatch(new RegExp(`_phone\\([^)]*'${k}'`));
});

// [2026-11-27] Securitate etapa 3 — alertele Sentinel (doar adminilor): tipul `security`, MEREU pornit,
// fara casuta in prefs (o alerta de atac nu trebuie sa poata fi stinsa din greseala).
test('security: ajunge pe telefon chiar daca toate casutele sunt oprite; nu apare in prefs', () => {
    NE.setPrefs(1, { support: false, price: false, atEntry: false, atExit: false, safety: false });
    expect(NE.push(1, 'security', 'Admin sign-in from a new IP: 203.0.113.9', Date.now())).toBe(true);
    const p = ND.pending(1, false);   // exact ce primeste telefonul
    expect(p.items.map((i) => i.kind)).toEqual(['security']);
    expect(p.items[0].title).toBe('Security alert');
    expect(Object.keys(NE.getPrefs(1))).not.toContain('security');
    NE.setPrefs(1, { security: false });
    expect(Object.keys(NE.getPrefs(1))).not.toContain('security');
});
