'use strict';
// [2026-11-20] Radarul pe server: formulele aplicatiei, pe sursele serverului.
const RA = require('../../server/services/radarAxes');

const bars = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const flat = bars(60, (i) => ({ time: i, open: 100, high: 101, low: 99, close: 100, volume: 10 }));

describe('radarAxes — cele 12 axe', () => {
    test('ordinea axelor e cea din aplicatie (brainAdapter AXIS_KEYS)', () => {
        expect(RA.AXIS_KEYS).toEqual(['trend', 'delta', 'flow', 'oi', 'volume', 'funding', 'volatility', 'imbalance', 'momentum', 'sentiment', 'structure', 'liquidity']);
    });

    test('fara nicio sursa: toate axele sunt null (nu inventeaza)', () => {
        const a = RA.axesFrom({});
        expect(a.rt).toHaveLength(12);
        expect(a.rt.every((v) => v === null)).toBe(true);
    });

    test('formulele aplicatiei: TREND, FUNDING, OI, SENTIMENT, IMBALANCE, DELTA', () => {
        const a = RA.axesFrom({ bars: flat, price: 100, adx: 25, stDir: 'bull', bull: 3, bear: 1,
            fr: 0.00025, oi: 102, oiPrev: 100, lsRatio: 3, bookBid: 75, bookAsk: 25, buyVol: 75, sellVol: 25, rsi: 70 });
        const v = Object.fromEntries(RA.AXIS_KEYS.map((k, i) => [k, a.rt[i]]));
        expect(v.trend).toBeCloseTo(0.5 * 0.6 + 0 + 0.1, 3);      // ADX 25/50·0,6 + panta 0 + ST in directie
        expect(v.funding).toBeCloseTo(0.5, 3);                    // 0,025% / 0,05%
        expect(v.oi).toBeCloseTo(1, 3);                           // +2% / 2
        expect(v.sentiment).toBeCloseTo(0.5, 3);                  // L/S 3 → 75% long → |0,75−0,5|/0,5
        expect(v.imbalance).toBeCloseTo(0.5, 3);                  // 75% bid
        expect(v.delta).toBeCloseTo(1, 3);                        // delta 50% / 50
        expect(v.momentum).toBeCloseTo(0.4 * 0.4 + 0.5 * 0.3, 3); // RSI 70 + (3−1)/4
    });

    test('VOLUME: volum de 2× fata de baza → smoothstep(2/3)', () => {
        const b = bars(30, (i) => ({ time: i, open: 100, high: 101, low: 99, close: 100, volume: i >= 25 ? 20 : 10 }));
        const n = (2 - 0.5) / 1.5;
        expect(RA.axesFrom({ bars: b, price: 100 }).rt[4]).toBeCloseTo(n * n * (3 - 2 * n), 3);
    });

    test('LIQ: nivel la 1% → 0,5; STRUCTURE foloseste acelasi magnet', () => {
        const a = RA.axesFrom({ bars: flat, price: 100, liqAbove: 101, liqBelow: 95 });
        expect(a.rt[11]).toBeCloseTo(0.5, 3);
        expect(a.rt[10]).not.toBeNull();
    });

    test('regimul serverului → vocabularul radarului', () => {
        expect(RA.radarRegime('TREND')).toBe('trend');
        expect(RA.radarRegime('BREAKOUT')).toBe('breakout');
        expect(RA.radarRegime('VOLATILE')).toBe('panic');
        expect(RA.radarRegime('RANGE')).toBe('range');
        expect(RA.radarRegime(null)).toBe('unknown');
    });

    test('computeAxes: aduna sursele prin dependinte (randurile cartii sunt {price, qty})', () => {
        const deps = {
            serverState: { getSnapshotForSymbol: () => ({ price: 100, rsi: { '5m': 60 }, adx: 20, fr: 0.0001, oi: 10, oiPrev: 10, indicators: { stDir: 'bull', regime: 'TREND' } }), getBarsForSymbol: () => flat },
            confluence: () => ({ bullDirs: 4, bearDirs: 1, score: 90 }),
            orderflow: { getFlow: () => ({ buyVol: 60, sellVol: 40, absorptionScore: 0 }) },
            sentiment: { getSentiment: () => ({ ls: 1 }) },
            liquidity: { getLiquidity: () => ({ nearestAbove: { price: 102 }, nearestBelow: { price: 98 } }), getOrderBook: () => ({ bids: [{ price: 99.9, qty: 3 }], asks: [{ price: 100.1, qty: 1 }] }) },
        };
        const a = RA.computeAxes('btcusdt', deps);
        expect(a.bull).toBe(4); expect(a.regime).toBe('trend');
        expect(a.rt[7]).toBeCloseTo(Math.abs((99.9 * 3) / (99.9 * 3 + 100.1) * 100 - 50) / 50, 3);
        expect(a.rt[9]).toBe(0);            // L/S 1 → echilibru
        expect(RA.computeAxes('X', { ...deps, serverState: { getSnapshotForSymbol: () => null, getBarsForSymbol: () => [] } })).toBeNull();
    });

    test('LIQ: nivelurile ATR intra printre magneti, ca in aplicatie (fara niveluri de lichiditate tot exista)', () => {
        const deps = {
            serverState: { getSnapshotForSymbol: () => ({ price: 100, atr: 1, rsi: { '5m': 50 }, indicators: {} }), getBarsForSymbol: () => flat },
            confluence: () => ({ bullDirs: 0, bearDirs: 0 }), orderflow: { getFlow: () => null }, sentiment: { getSentiment: () => null },
            liquidity: { getLiquidity: () => ({ nearestAbove: null, nearestBelow: { price: 99.5 } }), getOrderBook: () => null },
        };
        // cel mai apropiat: jos 99,5 (0,5%) → 1 − 0,005/0,02 = 0,75
        expect(RA.computeAxes('BTCUSDT', deps).rt[11]).toBeCloseTo(0.75, 3);
    });
});

