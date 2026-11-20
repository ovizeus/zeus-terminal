'use strict';
// [2026-11-16] Banda LATA a cartii (NEREUS): totalul Binance + OKX + Gate pe trepte.
const W = require('../../server/services/bookWide');
const BM = require('../../server/services/bookMap');

describe('bookWide — totalul pe trepte, cinstit', () => {
    afterAll(() => W.stop());

    test('bucketize: pune fiecare nivel in treapta lui (centrul treptei)', () => {
        const m = W.bucketize([[64910, 1], [64949.9, 2], [64950, 3]], 50);
        expect([...m.entries()]).toEqual([[64925, 3], [64975, 3]]);
    });

    test('combine: aduna bursele pe aceeasi treapta si spune unde se termina fiecare', () => {
        const f = W.combine({ symbol: 'BTCUSDT', ts: 1, step: 50, books: [
            { ex: 'binance', bids: [[64900, 1], [64700, 2]], asks: [[64901, 1], [65100, 2]] },
            { ex: 'gate', bids: [[64900, 4], [62500, 5]], asks: [[64950, 1], [67400, 6]] },
        ] });
        expect(f.mid).toBe(64900.5);                         // mijlocul vine din prima carte (cea fina)
        expect(f.bids.find(([p]) => p === 64925)[1]).toBe(5); // 1 Binance + 4 Gate
        expect(f.coverage).toEqual([
            { ex: 'binance', lo: 64700, hi: 65100 },
            { ex: 'gate', lo: 62500, hi: 67400 },
        ]);
        expect(f.exchange).toBe('binance+gate');
    });

    test('combine: o carte decalata (bid peste mijloc) nu intra in total', () => {
        const f = W.combine({ symbol: 'BTCUSDT', ts: 1, step: 50, books: [
            { ex: 'binance', bids: [[64900, 1]], asks: [[64901, 1]] },
            { ex: 'okx', bids: [[65500, 9]], asks: [[66000, 9]] },
        ] });
        expect(f.coverage.map((c) => c.ex)).toEqual(['binance']);
        expect(f.bids.reduce((s, [, q]) => s + q, 0)).toBe(1);
    });

    test('combine: fara nicio carte → null (nu inventeaza un cadru)', () => {
        expect(W.combine({ symbol: 'BTCUSDT', ts: 1, step: 50, books: [] })).toBeNull();
    });

    test('BTC acopera ±2.5K pe trepte de 50 $; ETH pe trepte de 1 $', () => {
        expect(W.config('BTCUSDT')).toMatchObject({ step: 50, half: 2500, gateInterval: '50' });
        expect(W.config('ethusdt')).toMatchObject({ step: 1, gateInterval: '1' });
        expect(W.config('SOLUSDT')).toBeNull();
    });

    test('grila explicita: randuri de 100 $ aliniate, fiecare rand = doua trepte, fara dungi false', () => {
        const f = W.combine({ symbol: 'BTCUSDT', ts: 1000, step: 50, books: [
            { ex: 'gate', bids: [[64850, 1], [64800, 1], [64750, 1], [64700, 1]], asks: [[64950, 1], [65000, 1]] },
        ] });
        const h = BM.heatAbs({ frames: [f], cols: 2, rows: 51, windowMs: 600000, now: 1000, gridLo: 62400, gridHi: 67500 });
        expect(h.rowUsd).toBe(100);
        expect(h.priceLo).toBe(62400);
        const rowsWithBids = h.cells.filter((c) => c.bidUsd > 0).map((c) => c.row);
        expect(new Set(rowsWithBids).size).toBe(2);        // 4 trepte → 2 randuri, fara goluri intre ele
    });

    test('ruta: band=wide e legata de bookWide; benzile vechi raman pe bookFeed', () => {
        const src = require('fs').readFileSync(require('path').join(__dirname, '../../server/routes/market.js'), 'utf8');
        expect(src).toMatch(/bandRaw === 'wide'/);
        expect(src).toMatch(/require\('\.\.\/services\/bookWide'\)/);
        expect(src).toMatch(/wide \? W\.frames\(sym\) : feed\.deepFrames\(sym\)/);
    });
});
