'use strict';
// ICHNOS: serviciul — persistare, reincarcare, retentie, interogare.
const db = require('../../server/services/database').db;
const fp = require('../../server/services/footprintService');

const T0 = Date.UTC(2026, 10, 16, 10, 0, 0);
const tr = (o) => ({ symbol: 'BTCUSDT', side: 'BUY', price: 64003, qty: 1, ts: T0 + 1000, ...o });

beforeEach(() => { fp._resetForTest(); db.prepare('DELETE FROM footprint_1m').run() })

test('tabela exista (migrarea 427)', () => {
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='footprint_1m'").get()).toBeTruthy();
});

test('doar minutele INCHISE se scriu, o singura data', () => {
    fp._onTrade(tr({}))
    fp._onTrade(tr({ ts: T0 + 61000 }))           // minutul curent (deschis)
    expect(fp.persist(T0 + 61500)).toBe(1)
    expect(fp.persist(T0 + 61500)).toBe(0)
    const row = db.prepare('SELECT * FROM footprint_1m').get()
    expect(row.t).toBe(T0)
    expect(JSON.parse(row.data).lv).toEqual([[64000, 0, 64003]])
});

test('retentia sterge ce e mai vechi de 48h, din memorie si din baza', () => {
    fp._onTrade(tr({}))
    fp.persist(T0 + 120000)
    expect(fp.prune(T0 + fp.KEEP_MS + 120000)).toBe(1)
    expect(db.prepare('SELECT COUNT(*) n FROM footprint_1m').get().n).toBe(0)
    expect(fp._store.get('BTCUSDT').size).toBe(0)
});

test('interogarea: moneda/interval nesuportate spun clar', () => {
    expect(fp.get('XRPUSDT', '5m')).toMatchObject({ ok: false, error: 'unsupported' })
    expect(fp.get('BTCUSDT', '1d')).toMatchObject({ ok: false })
    const r = fp.get('BTCUSDT', '5m')
    expect(r).toMatchObject({ ok: true, source: 'bybit', unit: 'usd', bin: 10 })
});

test('ruta e montata si e pe lista permisa a conturilor beta', () => {
    const fs = require('fs'), path = require('path')
    expect(fs.readFileSync(path.resolve(__dirname, '../../server/routes/market.js'), 'utf8')).toContain("router.get('/footprint'")
    expect(fs.readFileSync(path.resolve(__dirname, '../../server/middleware/viewerGate.js'), 'utf8')).toContain("'GET /api/market/footprint'")
});
