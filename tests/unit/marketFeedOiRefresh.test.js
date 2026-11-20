'use strict';
// [2026-11-20] Bugul OI (gasit de radarul de pe server, reparat cu acordul operatorului):
// OI se citea o singura data la abonare, deci oiPrev ramanea gol si votul OI din confluenta
// iesea mereu „neut". Acum se reimprospateaza la minut si se emite DOAR la schimbare.
let OI = 100;
jest.mock('../../server/services/marketCache', () => ({ get: (k) => (k === 'oi' ? OI : null), set: () => {} }));
const mf = require('../../server/services/marketFeed');

const flush = () => new Promise((r) => setImmediate(r));

describe('marketFeed — OI reimprospatat', () => {
    test('emite la prima valoare si la fiecare SCHIMBARE; o valoare identica nu se emite', async () => {
        const got = [];
        mf.on('openInterest', (d) => { if (d.symbol === 'OITESTUSDT') got.push(d.value); });
        mf._addActiveSymbolForTest('OITESTUSDT');
        mf._oiRefreshTick(); await flush(); await flush();
        mf._oiRefreshTick(); await flush(); await flush();      // aceeasi valoare → nimic
        OI = 110;
        mf._oiRefreshTick(); await flush(); await flush();
        expect(got).toEqual([100, 110]);
    });

    test('cu doua valori, votul OI din confluenta nu mai e „neut" (era mereu, din cauza bugului)', () => {
        const { _calcConfluence } = jest.requireActual('../../server/services/serverBrain');
        const ind = { stDir: 'neut', macdDir: 'neut' };
        expect(_calcConfluence({ rsi: { '5m': 50 }, fr: null, oi: 110, oiPrev: null }, ind).oiDir).toBe('neut');
        expect(_calcConfluence({ rsi: { '5m': 50 }, fr: null, oi: 110, oiPrev: 100 }, ind).oiDir).toBe('bull');
    });
});
