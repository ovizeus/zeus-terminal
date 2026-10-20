'use strict';
// [2026-10-20 b289] Cache-ul de filtre (stepSize/tickSize) e OBLIGATORIU ca
// serverul sa poata intra in piata: `_alignQtyToLotSize` respinge corect orice
// intrare pentru un simbol fara stepSize. Daca incarcarea de la boot pica,
// retry-ul vechi se oprea dupa 4 incercari (~3,5 min) si urmatoarea sansa era
// abia la intervalul de 6 ORE. In fereastra asta ORICE intrare autotrade si
// orice inregistrare manuala moare cu LOT_SIZE_ALIGN_REJECTED, in liniste.
// S-a intamplat pe viu 2026-10-19 12:40-12:50: 59 de intrari pierdute la
// uid=1, cu incredere 63-71 in regim TREND.

function boot({ failFirstN }) {
    jest.resetModules();
    let calls = 0;
    const fetchMock = jest.fn(async () => {
        calls++;
        if (calls <= failFirstN) throw new Error('simulated network failure');
        return {
            ok: true,
            json: async () => ({
                symbols: [{
                    symbol: 'BTCUSDT',
                    filters: [
                        { filterType: 'LOT_SIZE', stepSize: '0.001' },
                        { filterType: 'PRICE_FILTER', tickSize: '0.10' },
                    ],
                }],
            }),
        };
    });
    jest.doMock('../../server/services/binanceGateway', () => ({ fetch: fetchMock }));
    jest.doMock('../../server/config', () => ({ binance: { baseUrl: 'https://fapi.example' } }));
    const mod = require('../../server/services/exchangeInfo');
    return { mod, fetchMock, calls: () => fetchMock.mock.calls.length };
}

describe('exchangeInfo — retry-ul de la boot', () => {
    let warnSpy, logSpy, errSpy;
    beforeEach(() => {
        jest.useFakeTimers();
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        jest.useRealTimers();
        warnSpy.mockRestore(); logSpy.mockRestore(); errSpy.mockRestore();
    });

    test('nu renunta dupa 4 incercari: continua sa reincerce mult peste 3,5 min', async () => {
        const { mod, calls } = boot({ failFirstN: 1000 });
        mod.startAutoRefresh();
        await Promise.resolve();

        // Lasam sa treaca 30 de minute — vechea implementare facea exact 4
        // incercari si apoi tacea pana la ora 6.
        for (let i = 0; i < 60; i++) {
            jest.advanceTimersByTime(30000);
            await Promise.resolve(); await Promise.resolve();
        }
        expect(calls()).toBeGreaterThan(4);
        expect(mod.getFilters('BTCUSDT')).toBeNull();
    });

    test('se opreste de reincercat imediat ce reuseste, si cache-ul e populat', async () => {
        const { mod, calls } = boot({ failFirstN: 3 });
        mod.startAutoRefresh();
        await Promise.resolve();

        for (let i = 0; i < 40; i++) {
            jest.advanceTimersByTime(30000);
            await Promise.resolve(); await Promise.resolve();
        }
        const f = mod.getFilters('BTCUSDT');
        expect(f).not.toBeNull();
        expect(f.stepSize).toBe('0.001');

        const afterSuccess = calls();
        for (let i = 0; i < 20; i++) {
            jest.advanceTimersByTime(30000);
            await Promise.resolve(); await Promise.resolve();
        }
        // Fara reincercari de boot dupa reusita (refresh-ul de 6h e separat).
        expect(calls()).toBe(afterSuccess);
    });

    test('backoff-ul e plafonat, nu creste nelimitat', async () => {
        const { mod, calls } = boot({ failFirstN: 1000 });
        mod.startAutoRefresh();
        await Promise.resolve();

        // Dupa o ora trebuie sa fie un numar rezonabil de incercari:
        // suficiente ca sa prinda revenirea rapid, nu atat de multe incat
        // sa batem API-ul (regula „fara rafala spre Binance").
        for (let i = 0; i < 120; i++) {
            jest.advanceTimersByTime(30000);
            await Promise.resolve(); await Promise.resolve();
        }
        const n = calls();
        expect(n).toBeGreaterThan(5);
        expect(n).toBeLessThan(40);
    });
});
