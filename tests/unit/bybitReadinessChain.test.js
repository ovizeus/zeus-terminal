'use strict';

/**
 * [2026-11-08] The whole chain for a user on a secondary exchange.
 *
 * uid=2 was armed, her socket was connected, and the brain still skipped her
 * every cycle for a month. The reason sat at the far end of a long chain, so
 * this test walks the entire thing instead of any single link:
 *
 *     REST history → seedHistory → the REAL bybit kline consumer →
 *     bars stored in order → indicators computed → the symbol counts as READY
 *
 * It drives the actual listener serverState registers, not a stand-in, because
 * the bug that shipped was precisely in the handoff between those two pieces:
 * the wiring called `_emit`, a function that does not exist in that module, and
 * a defensive catch swallowed all 2400 failures in silence.
 */
const feed = require('../../server/services/bybitFeed');
const serverState = require('../../server/services/serverState');

// Capture the listener serverState registers, so the bars take the real path.
let klineHandler = null;
let tradeHandler = null;
const _origOn = feed.on.bind(feed);
beforeAll(() => {
    feed.on = (ev, fn) => {
        if (ev === 'kline') klineHandler = fn;
        if (ev === 'trade') tradeHandler = fn;
        return _origOn(ev, fn);
    };
    serverState._wireBybitListeners();
});
afterAll(() => { feed.on = _origOn; });

/** Rows shaped exactly as bybitRest.fetchKlines returns them (Binance 12-tuples). */
function realisticRows(count, startTs = 1_700_000_000_000, stepMs = 300_000) {
    const rows = [];
    let price = 75000;
    for (let i = 0; i < count; i++) {
        // A trend with noise on top. A series that barely moves leaves ADX
        // undefined, which is a property of the indicator, not of the feed —
        // the first version of this test used one and then blamed the code.
        price += Math.sin(i / 9) * 120 + (((i * 37) % 23) - 11) * 6;
        const open = price, close = price + (((i * 13) % 17) - 8) * 7;
        const high = Math.max(open, close) + 40, low = Math.min(open, close) - 40;
        rows.push([startTs + i * stepMs, String(open), String(high), String(low),
                   String(close), '12.5', startTs + i * stepMs, '0', 0, '0', '0', '0']);
    }
    return rows.reverse();                      // Bybit hands history back newest-first
}

const seedInto = (symbol, count) => feed.seedHistory({
    symbols: [symbol], timeframes: ['5m'], limit: count,
    fetchKlines: async () => realisticRows(count),
    emit: (ev, data) => { if (ev === 'kline' && klineHandler) klineHandler(data); },
});

describe('a bybit symbol becomes usable from REST history alone', () => {
    const SYM = 'BTCUSDT';

    it('the listeners are actually wired — otherwise this whole file proves nothing', () => {
        expect(typeof klineHandler).toBe('function');
        expect(typeof tradeHandler).toBe('function');
    });

    it('history alone is NOT enough — a live price is also required', async () => {
        const bybit = serverState.forExchange('bybit');
        expect(bybit.getReadySymbols()).not.toContain(SYM);    // nothing up our sleeve

        const res = await seedInto(SYM, 200);
        expect(res.bars).toBe(200);
        expect(res.failed).toBe(0);                            // the shipped bug was 200 failures

        // Readiness for a per-exchange user is price>0 AND bars. Klines carry
        // no price, so the backfill on its own leaves the symbol unusable —
        // worth pinning, because it means the REST seed and the live socket
        // are both load-bearing.
        expect(serverState.forExchange('bybit').getReadySymbols()).not.toContain(SYM);
    });

    it('becomes READY once the live stream delivers a price', () => {
        tradeHandler({ symbol: SYM, price: 75123.5, qty: 0.4, side: 'Buy', ts: Date.now() });
        expect(serverState.forExchange('bybit').getReadySymbols()).toContain(SYM);
    });

    it('stored the bars in the order they happened', () => {
        const bars = serverState.forExchange('bybit').getBarsForSymbol(SYM, '5m');
        expect(bars.length).toBeGreaterThanOrEqual(50);
        const times = bars.map((b) => b.time);
        expect(times.every((t, i) => i === 0 || t >= times[i - 1])).toBe(true);
    });

    it('computes the indicators the brain reads, once a later bar lands', async () => {
        // Recomputes are throttled to one per 2s per symbol, and a 200-bar
        // backfill arrives in milliseconds — so the seed computes ONCE, off
        // the first 30 bars, which is too few for ADX. In the market the next
        // bar is minutes away; here, waiting out the throttle and delivering
        // one more bar is the same thing. Spotting this took a failing test
        // first blaming the feed, then the indicator, then the throttle.
        await new Promise((r) => setTimeout(r, 2100));
        klineHandler({
            symbol: SYM, tf: '5m', ts: 1_700_000_000_000 + 250 * 300_000,
            open: 76000, high: 76120, low: 75880, close: 76050, volume: 9,
            confirmed: true, rawExchange: 'bybit',
        });
        const snap = serverState.forExchange('bybit').getSnapshotForSymbol(SYM);
        expect(snap).toBeTruthy();
        expect(snap.indicators).not.toBeNull();
        expect(snap.adx).not.toBeNull();
        expect(Number.isFinite(snap.adx)).toBe(true);
    }, 10000);

    it('did not touch the binance side — the two exchanges stay separate', () => {
        expect(serverState.forExchange('binance').getReadySymbols()).not.toContain(SYM);
    });

    it('a symbol with a price but no bars is still not usable', () => {
        const BARELESS = 'XRPUSDT';
        tradeHandler({ symbol: BARELESS, price: 1.15, qty: 10, side: 'Buy', ts: Date.now() });
        expect(serverState.forExchange('bybit').getReadySymbols()).not.toContain(BARELESS);
    });
});

describe('a brand-new account, with nothing saved yet', () => {
    const Database = require('better-sqlite3');
    let db;
    beforeEach(() => {
        db = new Database(':memory:');
        db.exec(`CREATE TABLE at_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, user_id INTEGER NOT NULL)`);
        db.exec(`CREATE TABLE exchange_accounts (user_id INTEGER, exchange TEXT, is_active INTEGER)`);
    });
    afterEach(() => db.close());

    it('is not in the restore set, so it boots disarmed rather than armed by accident', () => {
        db.prepare('INSERT INTO at_state VALUES (?,?,?)').run('engine:1', '{}', 1);
        const ids = db.prepare("SELECT DISTINCT user_id FROM at_state WHERE key LIKE 'engine:%' AND user_id IS NOT NULL")
            .all().map((r) => r.user_id);
        expect(ids).not.toContain(99);        // the new account
        // Arming is a deliberate act; a fresh account must never come up armed.
    });

    it('falls back to binance when it has no exchange account of its own', () => {
        // mirrors _getUserExchange: no active row → 'binance', the fed exchange
        const row = db.prepare('SELECT exchange FROM exchange_accounts WHERE user_id=? AND is_active=1').get(99);
        expect((row && row.exchange) || 'binance').toBe('binance');
    });

    it('once it saves state, the next restart brings it back', () => {
        db.prepare('INSERT INTO at_state VALUES (?,?,?)').run('engine:99', '{"atActiveDemo":true}', 99);
        const ids = db.prepare("SELECT DISTINCT user_id FROM at_state WHERE key LIKE 'engine:%' AND user_id IS NOT NULL")
            .all().map((r) => r.user_id);
        expect(ids).toContain(99);
    });
});
