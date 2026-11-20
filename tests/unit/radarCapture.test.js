'use strict';
// [2026-11-20] Radarul pe server: inregistrarea intrarilor (poza, replay, deja vu, sablon
// si cu telefonul inchis). Testul cap-coada simuleaza o pozitie care se deschide si se inchide.

const flat = Array.from({ length: 60 }, (_, i) => ({ time: i, open: 100, high: 101, low: 99, close: 100, volume: 10 }));
let OPEN = [];
jest.mock('../../server/services/serverState', () => ({
    getConfiguredSymbols: () => ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
    getSnapshotForSymbol: () => ({ price: 100, priceTs: Date.now(), rsi: { '5m': 60 }, adx: 20, fr: 0.0001, oi: 10, oiPrev: 10, indicators: { stDir: 'bull', regime: 'TREND' } }),
    getBarsForSymbol: () => flat,
}));
jest.mock('../../server/services/serverBrain', () => ({
    _calcConfluence: () => ({ bullDirs: 4, bearDirs: 1, score: 88 }),
    getSTC: () => ({ confMin: 65, profile: 'swing' }),
}));
jest.mock('../../server/services/serverAT', () => ({ getAllOpenLite: () => OPEN }));
jest.mock('../../server/services/marketFeed', () => ({ on: () => {}, subscribeForRef: () => Promise.resolve(true), releaseRef: () => {} }));

const RC = require('../../server/services/radarCapture');
const db = require('../../server/services/database').db;

describe('radarCapture — functii pure', () => {
    test('normalizeCoins: colturile se pastreaza, maxim 3, gunoiul devine colt gol', () => {
        expect(RC.normalizeCoins(['btcusdt', '', 'SOLUSDT'])).toEqual(['BTCUSDT', '', 'SOLUSDT']);
        expect(RC.normalizeCoins(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'])).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
        expect(RC.normalizeCoins(['x;drop', ''])).toBeNull();
        expect(RC.normalizeCoins('BTCUSDT')).toBeNull();
    });
    test('gatesFrom: motivele serverului pe portile radarului; SPREAD/NEWS/NOOPP necunoscute', () => {
        const g = RC.gatesFrom(['conf_low', 'cooldown', 'adx_low', 'session_block:asia', 'max_pos']);
        expect(g.failing).toEqual([0, 2, 4, 6]);
        expect(g.unknown).toEqual([1, 3, 5]);
        expect(RC.gatesFrom(null).unknown).toHaveLength(7);
    });
    test('thinFrames: o tranzactie lunga e rarita la mijloc, capetele raman intregi', () => {
        const fr = Array.from({ length: 10000 }, (_, i) => ({ t: i }));
        const out = RC.thinFrames(fr);
        expect(out.length).toBe(3600);
        expect(out[0].t).toBe(0); expect(out[899].t).toBe(899);
        expect(out[out.length - 1].t).toBe(9999);
        expect(RC.thinFrames(fr.slice(0, 50))).toHaveLength(50);
    });
    test('progressOf ca in aplicatie; entryShapeOf pune podeaua 0,1 pe lipsuri', () => {
        expect(RC.progressOf('LONG', 100, 105, 95, 110)).toBe(0.5);
        expect(RC.progressOf('SHORT', 100, 102.5, 105, 90)).toBe(-0.5);
        expect(RC.progressOf('LONG', 100, 105, 0, 110)).toBeNull();
        expect(RC.entryShapeOf([0.5, null, 2])).toEqual([0.5, 0.1, 1]);
    });
});

describe('radarCapture — starea de dinainte de intrare (regulile din aplicatie)', () => {
    test('lentilele converg spre valoare; un salt brusc le face sa se contrazica', () => {
        const still = Array.from({ length: 60 }, () => ({ rt: Array(12).fill(0.5) }));
        expect(RC.lensesOf(still).sl[0]).toBeCloseTo(0.5, 3);
        const jump = still.concat([{ rt: Array(12).fill(0.95) }]);
        const L = RC.lensesOf(jump);
        expect(RC.preMoodOf(Array(12).fill(0.95), L.sl, 40, 65, [])).toBe('NERVOUS');
    });
    test('HESITANT / ALERT / CALM ca in brainDerived', () => {
        const rt = Array(12).fill(0.5), sl = rt.slice();
        expect(RC.preMoodOf(rt, sl, 60, 65, [2])).toBe('HESITANT');
        expect(RC.preMoodOf(rt, sl, 56, 65, [])).toBe('ALERT');
        expect(RC.preMoodOf(rt, sl, 40, 65, [])).toBe('CALM');
        expect(RC.preMoodOf(rt, sl, null, 65, [2])).toBe('CALM');
    });
});

describe('radarCapture — o intrare cu telefonul inchis, cap-coada', () => {
    beforeAll(() => { db.exec('DELETE FROM brain_captures; DELETE FROM brain_radar_prefs;'); RC._resetForTest(); });
    afterAll(() => RC.stop());

    test('preferinte: implicit BTC/ETH/SOL; salvate in baza, pe colturi', () => {
        expect(RC.coinsFor(7)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
        expect(RC.setCoins(7, ['BTCUSDT', '', 'SOLUSDT'])).toEqual(['BTCUSDT', '', 'SOLUSDT']);
        expect(JSON.parse(db.prepare('SELECT coins FROM brain_radar_prefs WHERE user_id = 7').get().coins)).toEqual(['BTCUSDT', '', 'SOLUSDT']);
        expect(RC.setCoins(7, ['junk'])).toBeNull();
    });

    test('pozitie pe moneda radarului → inregistrare cu forma de la intrare; ETH (scos de pe radar) nu', () => {
        for (let i = 0; i < 3; i++) RC._tickForTest();
        OPEN = [
            { userId: 7, seq: 501, symbol: 'BTCUSDT', side: 'LONG', mode: 'demo', env: 'DEMO', price: 100, sl: 95, tp: 110, size: 100, lev: 5, ts: Date.now() },
            { userId: 7, seq: 502, symbol: 'ETHUSDT', side: 'LONG', mode: 'demo', env: 'DEMO', price: 100, sl: 95, tp: 110, size: 100, lev: 5, ts: Date.now() },
        ];
        RC._tickForTest(); RC._tickForTest();
        const list = RC.listCaptures(7);
        expect(list.map((c) => c.seq)).toEqual([501]);
        const e = list[0].entry;
        expect(e.entryShape).toHaveLength(12);
        expect(e).toMatchObject({ symbol: 'BTCUSDT', side: 'LONG', env: 'DEMO', conf: 88, thr: 65, profile: 'swing', source: 'server', late: false, pre: 'ALERT' });
        expect(e.preFrames).toBeGreaterThan(0);                    // secundele dinaintea intrarii
    });

    test('la iesire: inregistrarea se inchide, cadrele (cu PnL) se citesc din baza', () => {
        OPEN = [];
        RC._tickForTest();
        const row = db.prepare('SELECT status, n_frames FROM brain_captures WHERE user_id = 7 AND seq = 501').get();
        expect(row.status).toBe('closed');
        const r = RC.getFrames(7, 501);
        expect(r.frames.length).toBe(row.n_frames);
        const withPos = r.frames.filter((f) => f.p);
        expect(withPos.length).toBeGreaterThan(0);
        expect(withPos[0].p).toMatchObject({ pct: 0, prog: 0, noTp: false });
        expect(r.frames[0]).toMatchObject({ c: 88, h: 65 });
        expect(r.frames[0].rt).toHaveLength(12);
    });

    test('liveFor: axele de acum pentru afisaj; simbol invalid ignorat', () => {
        const a = RC.liveFor(['BTCUSDT', 'bad;sym']);
        expect(Object.keys(a)).toEqual(['BTCUSDT']);
        expect(a.BTCUSDT.rt).toHaveLength(12);
        expect(a.BTCUSDT.score).toBe(88);
    });
});
