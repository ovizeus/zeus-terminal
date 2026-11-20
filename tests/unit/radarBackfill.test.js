'use strict';
// [2026-11-20] Tranzactiile din trecut, refacute din deciziile serverului + lumanari.
jest.mock('../../server/services/serverBrain', () => ({
    _calcConfluence: () => ({ bullDirs: 3, bearDirs: 1, score: 70 }),
    getSTC: () => ({ confMin: 65 }),
}));
const B = require('../../server/services/radarBackfill');

const T0 = 1_700_000_000_000;
const bars5 = Array.from({ length: 200 }, (_, i) => ({ time: T0 - 150 * 300_000 + i * 300_000, open: 100, high: 101, low: 99, close: 100 + (i % 4) * 0.2, volume: 10 + (i % 3) }));
const bars1 = Array.from({ length: 400 }, (_, i) => ({ time: T0 - 10 * 60_000 + i * 60_000, open: 100, high: 100, low: 100, close: 100 + i * 0.01, volume: 1, q: 1000, tb: 750 }));
const oiHist = Array.from({ length: 20 }, (_, i) => ({ time: T0 - 15 * 60_000 + i * 300_000, v: 1000 + i * 10 }));
const lsHist = Array.from({ length: 20 }, (_, i) => ({ time: T0 - 15 * 60_000 + i * 300_000, v: 3 }));
const pos = { seq: 77, symbol: 'BTCUSDT', side: 'LONG', price: 100, sl: 98, tp: 104, lev: 5, size: 100, ts: T0, closeTs: T0 + 30 * 60_000 };
const compute = () => ({ adx: 30, stDir: 'bull', regime: 'TREND', atr: 1, rsi: 60 });
const confluence = () => ({ bullDirs: 3, bearDirs: 1, score: 70 });

describe('radarBackfill — cadre refacute numai din date reale', () => {
    test('un cadru la 30 s, de la 5 min inainte de intrare pana la iesire; pozitia doar dupa intrare', () => {
        const fr = B.buildFrames({ bars5, bars1, decisions: [], pos, thr: 65, compute, confluence });
        expect(fr[0].t).toBe(T0 - 5 * 60_000);
        expect(fr[fr.length - 1].t).toBeLessThanOrEqual(pos.closeTs);
        expect(fr.length).toBe(71);                            // 35 min / 30 s + 1
        expect(fr.filter((f) => !f.p)).toHaveLength(10);       // cele 5 minute dinainte
        expect(fr.find((f) => f.p).p.pct).toBeCloseTo(((bars1[9].close - 100) / 100) * 5 * 100, 1);
    });
    test('[b397] FLOW/DELTA din taker buy, OI si SENTIMENT din istoricul oficial; doar IMBALANCE ramane gol', () => {
        const fr = B.buildFrames({ bars5, bars1, decisions: [], pos, thr: 65, compute, confluence, oiHist, lsHist });
        const f = fr[20];
        expect(f.rt[1]).toBeCloseTo(1, 3);                    // DELTA: 75% cumparare → |50%| / 50
        expect(f.rt[2]).not.toBeNull();                       // FLOW
        const io = oiHist.filter((x) => x.time <= f.t); const a1 = io[io.length - 1].v, a0 = io[io.length - 2].v;
        expect(f.rt[3]).toBeCloseTo(((a1 - a0) / a0) * 100 / 2, 3); // OI: fata de valoarea de acum 5 min
        expect(f.rt[9]).toBeCloseTo(0.5, 3);                  // SENTIMENT: L/S 3
        expect(f.rt[7]).toBeNull();                           // IMBALANCE: cartea din trecut nu exista
        expect(f.rt[0]).not.toBeNull();                       // TREND
        expect(f.rt[11]).not.toBeNull();                      // LIQ
    });
    test('fara istoric (lumanari vechi fara taker buy, fara OI/LS): axele raman goale, nu inventate', () => {
        const old = bars1.map((b) => ({ ...b, q: NaN, tb: NaN }));
        const fr = B.buildFrames({ bars5, bars1: old, decisions: [], pos, thr: 65, compute, confluence });
        for (const i of [1, 2, 3, 7, 9]) expect(fr[20].rt[i]).toBeNull();
    });
    test('cu decizie in ultimele 90 s: valorile si portile deciziei; OI-ul inghetat din decizii NU se foloseste', () => {
        const decisions = [
            { ts: T0 - 60_000, d: { rsi5m: 70, adx: 40, stDir: 'bull', confBullDirs: 4, confBearDirs: 1, confScore: 90, fr: 0.0001, oi: 1000, regime: 'TREND', atr: 1, gateReasons: [] } },
            { ts: T0 - 30_000, d: { rsi5m: 72, adx: 41, stDir: 'bull', confBullDirs: 4, confBearDirs: 1, confScore: 95, fr: 0.0001, oi: 1010, regime: 'TREND', atr: 1, gateReasons: ['cooldown'] } },
        ];
        const fr = B.buildFrames({ bars5, bars1, decisions, pos, thr: 65, compute, confluence });
        const f = fr.find((x) => x.t === T0);
        expect(f.c).toBe(95);
        expect(f.f).toEqual([2]);                              // COOL pica
        expect(f.rt[3]).toBeNull();                            // OI din decizii era inghetat (bug raportat) → nu se foloseste; fara istoric oficial aici
    });
    test('entryFrom: forma, starea dinainte si marcajul „reconstructed"', () => {
        const fr = B.buildFrames({ bars5, bars1, decisions: [], pos, thr: 65, compute, confluence });
        const e = B.entryFrom(fr, pos, { env: 'DEMO', thr: 65, profile: 'swing', regime: 'TREND', coins: ['BTCUSDT'] });
        expect(e).toMatchObject({ v: 3, seq: 77, symbol: 'BTCUSDT', side: 'LONG', env: 'DEMO', conf: 70, thr: 65, reconstructed: true, source: 'server', preFrames: 10 });
        expect(e.entryShape).toHaveLength(12);
        expect(['CALM', 'ALERT', 'NERVOUS', 'HESITANT']).toContain(e.pre);
    });
    test('tranzactie lunga: pasul creste ca sa ramana sub 3.600 de cadre', () => {
        const long = { ...pos, closeTs: T0 + 48 * 3600_000 };
        const b5 = Array.from({ length: 800 }, (_, i) => ({ ...bars5[0], time: T0 - 150 * 300_000 + i * 300_000 }));
        const fr = B.buildFrames({ bars5: b5, bars1, decisions: [], pos: long, thr: 65, compute, confluence });
        expect(fr.length).toBeLessThanOrEqual(3600);
    });
});
