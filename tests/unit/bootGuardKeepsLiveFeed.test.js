'use strict';
/**
 * De ce exista acest test.
 *
 * Garda de pornire din 9 nov 2026 ("nu trage istoricul intr-un ban activ")
 * facea `return` din TOATA functia `subscribe`. Sarea astfel si peste pornirea
 * citirii vii de pret si de bare. Self-heal umplea apoi istoricul, dar pretul
 * ramanea inghetat, iar brain-ul sarea simbolul in tacere (date vechi).
 *
 * Urmari masurate: dupa reload-ul din 9 nov, 6 din 7 simboluri Binance fara
 * pret viu; dupa cel din 11 nov, toate 7 — zero decizii pe conturile Binance
 * timp de ore, pozitii BNBUSDT/SOLUSDT neatinse din 9 nov, randul de preturi
 * de sus gol.
 *
 * Testul vechi verifica doar functia pura `shouldSeedAtBoot`. Nimeni nu
 * verifica ce face `subscribe` DUPA ce garda spune "nu".
 */
const path = require('path');
const S = (m) => path.join(__dirname, '../../server/services', m);

function load({ banned }) {
    jest.resetModules();
    const lines = [];
    const urls = [];
    const rec = (lvl) => (c, m) => lines.push(`${lvl} ${c} ${m}`);
    jest.doMock(S('logger'), () => ({ info: rec('INFO'), warn: rec('WARN'), error: rec('ERROR'), debug: () => {} }));
    jest.doMock(path.join(__dirname, '../../server/migrationFlags'), () => ({ ALT_WS_FEEDS: true }));
    jest.doMock(S('binanceRateState'), () => ({
        load: () => (banned ? { banned_until: Date.now() + 3600000, warm_until: 0, ban_reason: 'HTTP 418' } : { banned_until: 0, warm_until: 0, ban_reason: null }),
        banAppliesTo: () => true,
    }));
    jest.doMock(S('binanceGateway'), () => ({
        fetch: async (url) => { urls.push(String(url)); return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({}) }; },
    }));
    const feed = require(S('marketFeed'));
    return { feed, lines, urls };
}

describe('garda de pornire sare DOAR peste istoric', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

    test('in ban: istoricul NU se trage, dar citirea vie PORNESTE', async () => {
        const { feed, lines, urls } = load({ banned: true });
        await feed.subscribe('BTCUSDT', ['5m']);
        try {
            expect(lines.some((l) => /skipping initial candle fetch/.test(l))).toBe(true);
            expect(lines.some((l) => /initial candles/.test(l) && !/skipping/.test(l))).toBe(false);
            // Linia care anunta pornirea pollerelor de bare si de pret:
            expect(lines.some((l) => /\[ALT_WS_FEEDS=ON\] BTCUSDT/.test(l))).toBe(true);
            // Niciun istoric lung cerut in ban:
            expect(urls.filter((u) => /klines/.test(u) && /limit=(1000|500|300|200)\b/.test(u))).toHaveLength(0);
        } finally { try { feed.unsubscribeAll(); } catch (_) {} }
    });

    test('REGRESIE: fara ban, istoricul se trage SI citirea vie porneste', async () => {
        const { feed, lines, urls } = load({ banned: false });
        await feed.subscribe('BTCUSDT', ['5m']);
        try {
            expect(lines.some((l) => /skipping initial candle fetch/.test(l))).toBe(false);
            expect(lines.some((l) => /BTCUSDT 5m: \d+ initial candles/.test(l))).toBe(true);
            expect(lines.some((l) => /\[ALT_WS_FEEDS=ON\] BTCUSDT/.test(l))).toBe(true);
            expect(urls.some((u) => /klines/.test(u))).toBe(true);
        } finally { try { feed.unsubscribeAll(); } catch (_) {} }
    });
});
