'use strict';
// [2026-11-14] OKX da marimea lichidarii in CONTRACTE. Fara conversie, BTC iesea
// de 100× prea mare, ETH de 10×, iar DOGE de 1000× prea mic — masurat in
// `liq_events`. Regula e a lui liqGate: fara valoarea contractului, evenimentul
// se arunca; nu se ghiceste cu 1.
const okx = require('../../server/services/liqOkx');

const INST = {
    'BTC-USDT-SWAP': 0.01, 'ETH-USDT-SWAP': 0.1, 'SOL-USDT-SWAP': 1,
    'XRP-USDT-SWAP': 100, 'DOGE-USDT-SWAP': 1000,
    'BTC-USD-SWAP': { ctVal: 100, inverse: true },
};
const ev = (instId, sz, px, side = 'sell') => ({ instId, side, sz: String(sz), bkPx: String(px), ts: '1700000000456' });

describe('normalize — contracte, nu monede', () => {
    beforeEach(() => okx._setInstrumentsForTest(INST));

    test('BTC: 25 de contracte sunt 0,25 BTC, nu 25 BTC', () => {
        const l = okx.normalize(ev('BTC-USDT-SWAP', 25, 66000));
        expect(l.q).toBeCloseTo(0.25, 10);
        expect(l.vol).toBeCloseTo(16500, 6);          // nu 1.650.000
        expect(l).toMatchObject({ exchange: 'okx', symbol: 'BTCUSDT', side: 'SELL', isLong: true, p: 66000, time: 1700000000456 });
    });
    test('ETH: un contract e 0,1 ETH', () => {
        expect(okx.normalize(ev('ETH-USDT-SWAP', 97, 1900)).vol).toBeCloseTo(18430, 6);
    });
    test('SOL: un contract e 1 SOL (neschimbat)', () => {
        expect(okx.normalize(ev('SOL-USDT-SWAP', 172, 77)).vol).toBeCloseTo(13244, 6);
    });
    test('DOGE si XRP: un contract e 1000 / 100 de monede — inainte ieseau prea MICI', () => {
        expect(okx.normalize(ev('DOGE-USDT-SWAP', 193, 0.062)).vol).toBeCloseTo(11966, 4);
        expect(okx.normalize(ev('XRP-USDT-SWAP', 112, 1.0)).vol).toBeCloseTo(11200, 6);
    });
    test('contract INVERS: valoarea e in dolari, cantitatea se scoate din pret', () => {
        const l = okx.normalize(ev('BTC-USD-SWAP', 10, 50000, 'buy'));
        expect(l.vol).toBe(1000);                     // 10 × 100 $
        expect(l.q).toBeCloseTo(0.02, 10);
        expect(l).toMatchObject({ symbol: 'BTCUSDT', side: 'BUY', isLong: false });
    });
    test('⛔ fara valoarea contractului, evenimentul se ARUNCA', () => {
        expect(okx.normalize(ev('NEW-USDT-SWAP', 5, 10))).toBeNull();
        okx._setInstrumentsForTest({});
        expect(okx.normalize(ev('BTC-USDT-SWAP', 25, 66000))).toBeNull();
    });
    test('gunoi la intrare = null, fara exceptii', () => {
        for (const bad of [null, undefined, 'x', {}, { instId: 5 }, ev('BTC-USDT-SWAP', 0, 66000), ev('BTC-USDT-SWAP', 25, 0),
            ev('BTC-USDT-SWAP', 'abc', 66000), ev('BTC-USDT-SWAP', -3, 66000), { ...ev('BTC-USDT-SWAP', 1, 1), side: 'hold' }]) {
            expect(okx.normalize(bad)).toBeNull();
        }
    });
    test('literele mici si spatiile din instId nu ocolesc harta', () => {
        expect(okx.normalize(ev(' btc-usdt-swap ', 25, 66000)).vol).toBeCloseTo(16500, 6);
    });
});

describe('parseInstruments / loadInstruments', () => {
    const RESP = { code: '0', data: [
        { instId: 'BTC-USDT-SWAP', ctVal: '0.01', ctMult: '1', ctType: 'linear' },
        { instId: 'BTC-USD-SWAP', ctVal: '100', ctMult: '1', ctType: 'inverse' },
        { instId: 'X-USDT-SWAP', ctVal: '10', ctMult: '2', ctType: 'linear' },
        { instId: 'BAD1-USDT-SWAP', ctVal: '0', ctType: 'linear' },
        { instId: 'BAD2-USDT-SWAP', ctVal: 'abc', ctType: 'linear' },
        { instId: 'BAD3-USDT-SWAP', ctVal: '1', ctType: '' },
        { ctVal: '1', ctType: 'linear' },
    ] };
    test('pastreaza doar contractele cu valoare si tip cunoscute', () => {
        const m = okx.parseInstruments(RESP);
        expect(Object.keys(m).sort()).toEqual(['BTC-USD-SWAP', 'BTC-USDT-SWAP', 'X-USDT-SWAP']);
        expect(m['BTC-USDT-SWAP']).toEqual({ ctVal: 0.01, inverse: false });
        expect(m['BTC-USD-SWAP']).toEqual({ ctVal: 100, inverse: true });
        expect(m['X-USDT-SWAP']).toEqual({ ctVal: 20, inverse: false });      // ctVal × ctMult
        expect(okx.parseInstruments(null)).toEqual({});
        expect(okx.parseInstruments({ data: 'x' })).toEqual({});
    });
    test('incarcarea reusita inlocuieste harta', async () => {
        okx._setInstrumentsForTest({});
        const n = await okx.loadInstruments(async () => ({ ok: true, json: async () => RESP }));
        expect(n).toBe(3);
        expect(okx.linearCtValOf('BTCUSDT')).toBe(0.01);
    });
    test('⛔ o incarcare picata pastreaza harta veche, nu o goleste', async () => {
        okx._setInstrumentsForTest(INST);
        expect(await okx.loadInstruments(async () => ({ ok: false }))).toBe(0);
        expect(await okx.loadInstruments(async () => { throw new Error('net'); })).toBe(0);
        expect(await okx.loadInstruments(async () => ({ ok: true, json: async () => ({ data: [] }) }))).toBe(0);
        expect(okx.instrumentCount()).toBe(Object.keys(INST).length);
    });
    test('linearCtValOf nu intoarce valoarea unui contract invers', () => {
        okx._setInstrumentsForTest({ 'BTC-USD-SWAP': { ctVal: 100, inverse: true } });
        expect(okx.linearCtValOf('BTCUSDT')).toBeNull();
        expect(okx.linearCtValOf('')).toBeNull();
    });
});
