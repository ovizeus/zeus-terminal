'use strict';
// [2026-11-22] „Zeus se incarca foarte greu": aceleasi 105 tranzactii, care nu se pot reface
// (fara cadre), erau refacute DE LA ZERO la fiecare pornire si zilnic — serverul ingheta ~24 s
// de fiecare data, 12 minute. Acum o tranzactie incercata fara rezultat se tine minte.
const path = require('path');
const fs = require('fs');
const os = require('os');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-tried-'));
process.env.ZEUS_DB_PATH = path.join(DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';
jest.mock('../../server/services/serverBrain', () => ({ _calcConfluence: () => ({}), getSTC: () => ({ confMin: 65 }) }));
jest.mock('../../server/services/radarCapture', () => ({ coinsFor: () => ['BTCUSDT', 'ETHUSDT'] }));

const { db } = require('../../server/services/database');
const B = require('../../server/services/radarBackfill');

const NOW = Date.parse('2026-11-22T08:00:00Z');
const txt = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
function closed(uid, seq, daysAgo, sym = 'BTCUSDT') {
    const d = { seq, symbol: sym, side: 'LONG', price: 100, ts: NOW - daysAgo * 864e5, closeTs: NOW - daysAgo * 864e5 + 3600e3, closePnl: 1, closeReason: 'DSL_PL', env: 'DEMO' };
    db.prepare('INSERT INTO at_closed (data, closed_at, user_id) VALUES (?, ?, ?)').run(JSON.stringify(d), txt(NOW - daysAgo * 864e5), uid);
}
beforeAll(() => {
    for (const uid of [1, 2]) db.prepare('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(uid, `u${uid}@test.local`, 'x');
});
beforeEach(() => {
    db.prepare('DELETE FROM at_closed').run();
    db.prepare('DELETE FROM radar_backfill_tried').run();
});
afterAll(() => { try { db.close(); } catch (_) {} try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} });

test('o tranzactie incercata fara rezultat NU mai intra in lista la pornirea urmatoare', () => {
    closed(1, 101, 2); closed(1, 102, 3);
    expect(B.pending(NOW).map((x) => x.d.seq).sort()).toEqual([101, 102]);
    B._markTried(1, 101, 'no_frames');
    expect(B.pending(NOW).map((x) => x.d.seq)).toEqual([102]);
    expect(db.prepare('SELECT reason FROM radar_backfill_tried WHERE user_id=1 AND seq=101').get().reason).toBe('no_frames');
});

test('„ultimele 30 de zile" chiar inseamna 30 de zile (closed_at e TEXT, nu numar)', () => {
    closed(1, 201, 5); closed(1, 202, 45);
    expect(B.pending(NOW).map((x) => x.d.seq)).toEqual([201]);
});

test('tine minte pe CONT: aceeasi secventa la alt cont nu e sarita', () => {
    closed(1, 301, 1); closed(2, 301, 1);
    B._markTried(1, 301, 'no_env_or_price');
    expect(B.pending(NOW).map((x) => x.uid)).toEqual([2]);
});

test('deciziile se citesc dupa CONT (index user_id, ts), nu ale tuturor conturilor pe moneda', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../server/services/radarBackfill.js'), 'utf8');
    expect(src).toMatch(/FROM brain_decisions INDEXED BY idx_bd_user_ts WHERE user_id = \? AND symbol = \?/);
    expect(src).toMatch(/if \(!frames\.length\) \{ _stats\.skipped\+\+; _markTried\(uid, seq, 'no_frames'\)/);
});

test('refacerea ruleaza noaptea (01:00 UTC), nu imediat dupa pornire', () => {
    expect(B.msUntilNextRun(Date.parse('2026-11-22T08:22:00Z'))).toBe(Date.parse('2026-11-23T01:00:00Z') - Date.parse('2026-11-22T08:22:00Z'));
    expect(B.msUntilNextRun(Date.parse('2026-11-22T00:30:00Z'))).toBe(30 * 60_000);
});
