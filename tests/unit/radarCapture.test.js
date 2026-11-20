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
let OI = 1000;
const LISTEN = {}; const SUBS = [];
jest.mock('../../server/services/marketFeed', () => ({
    on: (ev, fn) => { (LISTEN[ev] = LISTEN[ev] || []).push(fn); },
    subscribeForRef: (sym, ref) => { SUBS.push(sym + '@' + ref); return Promise.resolve(true); },
    releaseRef: () => {}, fetchOpenInterest: () => Promise.resolve(OI),
}));

const GW = [];
jest.mock('../../server/services/binanceGateway', () => ({
    fetch: (url) => {
        GW.push(url);
        const body = url.includes('/depth') ? { bids: [['50.1', '30']], asks: [['50.3', '10']] } : [{ longShortRatio: '3' }];
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    },
}));
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
    test('profileOf: profilul din setarile aplicatiei, pe mediu (brain.demo / brain.live), apoi cel general', () => {
        const st = { profile: 'fast', brain: { demo: { profile: 'swing' }, live: { profile: 'defensive' } } };
        expect(RC.profileOf(st, 'DEMO')).toBe('swing');
        expect(RC.profileOf(st, 'REAL')).toBe('defensive');
        expect(RC.profileOf({ profile: 'fast' }, 'TESTNET')).toBe('fast');
        expect(RC.profileOf(null, 'DEMO')).toBeNull();
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
    test('[2026-11-21] CONFUSED = voturi egale (>= 2); NERVOUS la pragul calibrat 0,013', () => {
        const rt = Array(12).fill(0.5);
        expect(RC.preMoodOf(rt, rt, 40, 65, [], 2, 2)).toBe('CONFUSED');
        expect(RC.preMoodOf(rt, rt, 40, 65, [], 1, 1)).toBe('CALM');
        expect(RC.preMoodOf(rt, Array(12).fill(0.48), 40, 65, [], 3, 1)).toBe('NERVOUS');   // 0,02 > 0,013
        expect(RC.preMoodOf(rt, Array(12).fill(0.495), 40, 65, [], 3, 1)).toBe('CALM');    // 0,005
        expect(RC.preMoodOf(rt, rt, 60, 65, [2], 2, 2)).toBe('HESITANT');                  // poarta pica bate CONFUSED
    });
    test('[2026-11-21] lentilele tin cont de timpul dintre cadre: 30 s nu e o secunda', () => {
        const f = (t, v) => ({ t, rt: Array(12).fill(v) });
        const oneSec = RC.lensesOf([f(0, 0.2), f(1000, 0.8)]).sl[0];
        const thirty = RC.lensesOf([f(0, 0.2), f(30000, 0.8)]).sl[0];
        expect(thirty).toBeGreaterThan(oneSec);              // dupa 30 s lentila lenta e mult mai aproape de 0,8
        expect(thirty).toBeGreaterThan(0.75);
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
        expect(e).toMatchObject({ symbol: 'BTCUSDT', side: 'LONG', env: 'DEMO', conf: 88, thr: 65, source: 'server', late: false, pre: 'ALERT' });
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

    test('[bug OI] serverState nu reimprospateaza OI: radarul isi tine perechea si axa OI apare', async () => {
        jest.useFakeTimers({ now: Date.now(), doNotFake: ['nextTick', 'setImmediate'] });
        try {
            const flush = () => new Promise((r) => setImmediate(r));
            jest.setSystemTime(Date.now() + 61_000);
            RC._tickForTest(); await flush(); await flush();      // prima citire: OI = 1000
            OI = 1010; jest.setSystemTime(Date.now() + 61_000);
            RC._tickForTest(); await flush(); await flush();      // a doua: 1000 → 1010
            RC._tickForTest();
            const oiAxis = RC.liveFor(['BTCUSDT']).BTCUSDT.rt[3];
            expect(oiAxis).toBeCloseTo(0.5, 3);          // +1% / 2
        } finally { jest.useRealTimers(); }
    });

    test('moneda din afara serverState (ZEC): abonata pe radar|uid, lumanarile ei din flux, axe calculate', () => {
        RC.start();                                         // leaga ascultatorii marketFeed
        RC.setCoins(9, ['BTCUSDT', 'ETHUSDT', 'ZECUSDT']);
        RC._tickForTest();
        expect(SUBS).toContain('ZECUSDT@radar|9');
        expect(SUBS.some((x) => x.startsWith('BTCUSDT'))).toBe(false);   // BTC e deja in serverState
        const bars = Array.from({ length: 60 }, (_, i) => ({ time: i, open: 50, high: 51, low: 49, close: 50 + (i % 3) * 0.1, volume: 5 }));
        for (const fn of LISTEN.kline || []) fn({ symbol: 'ZECUSDT', timeframe: '5m', initial: true, bars });
        for (const fn of LISTEN.price || []) fn({ symbol: 'ZECUSDT', price: 50.2 });
        RC._tickForTest();
        const a = RC.liveFor(['ZECUSDT']).ZECUSDT;
        expect(a).not.toBeNull();
        expect(a.rt[4]).not.toBeNull();                      // VOLUME din lumanarile proprii ale radarului
        expect(require('../../server/services/serverState').getConfiguredSymbols()).not.toContain('ZECUSDT');
        // cartea si L/S ajung la urmatorul pas
        return new Promise((r) => setImmediate(r)).then(() => new Promise((r) => setImmediate(r))).then(() => {
            expect(GW.some((u) => u.includes('depth?symbol=ZECUSDT'))).toBe(true);
            expect(GW.some((u) => u.includes('globalLongShortAccountRatio?symbol=ZECUSDT'))).toBe(true);
            RC._tickForTest();
            const b = RC.liveFor(['ZECUSDT']).ZECUSDT;
            expect(b.rt[7]).not.toBeNull();                  // IMBALANCE
            expect(b.rt[9]).toBeCloseTo(0.5, 3);             // SENTIMENT: L/S 3 → 75% long
            RC.stop();
        });
    });
});

