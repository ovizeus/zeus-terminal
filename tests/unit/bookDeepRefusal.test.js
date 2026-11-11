/**
 * De ce exista acest test.
 *
 * Panoul BOOK a stat pe "Waiting for the first snapshot" o ora intreaga in
 * timp ce bursa ne refuza cererile. Mesajul era o minciuna: nu asteptam un
 * snapshot, ni se raspundea NU. Cauza in cod: `_fetchDeep` facea
 * `if (!res.ok) { _deepFail++; return null }` si arunca motivul, desi
 * motivul era deja in corpul raspunsului (`reason: 'warm_class_b'`).
 *
 * Aceeasi clasa cu `bybitFeed._emit`: eroarea exista, dar nimeni n-o citea.
 */
const path = require('path');

const MOD = path.join(__dirname, '../../server/services/bookFeed');

function synthetic503(reason) {
    return {
        status: 503, ok: false,
        headers: { get: () => null },
        json: async () => ({ code: 'BINANCE_SCHEDULER_BACKPRESSURE', synthetic: true, reason }),
    };
}

describe('bookFeed — refuzul interogarii adanci este VIZIBIL', () => {
    let feed;

    beforeEach(() => {
        jest.resetModules();
        jest.doMock(path.join(__dirname, '../../server/services/binanceGateway'), () => ({
            fetch: jest.fn(async () => synthetic503('warm_class_b')),
        }));
        feed = require(MOD);
    });

    test('motivul refuzului ajunge in health(), nu se pierde', async () => {
        await feed._fetchDeep('BTCUSDT');
        const h = feed.health();
        expect(h.deepRefusal).toBeTruthy();
        expect(h.deepRefusal.reason).toBe('warm_class_b');
        expect(typeof h.deepRefusal.at).toBe('number');
    });

    test('un raspuns refuzat NU trece drept cadru valid', async () => {
        const f = await feed._fetchDeep('BTCUSDT');
        expect(f).toBeNull();
        expect(feed.deepFrames('BTCUSDT')).toHaveLength(0);
    });
});

describe('bookFeed — un refuz vechi nu mai acuza bursa', () => {
    test('refuzul expira, ca sa nu ramana un mesaj de eroare lipit pe panou', () => {
        jest.resetModules();
        const feed2 = require(MOD);
        expect(feed2.refusalIfFresh({ reason: 'warm_class_b', at: 1000 }, 1000 + 59_000)).toEqual(
            { reason: 'warm_class_b', at: 1000 });
        expect(feed2.refusalIfFresh({ reason: 'warm_class_b', at: 1000 }, 1000 + 400_000)).toBeNull();
        expect(feed2.refusalIfFresh(null, 5000)).toBeNull();
    });
});
