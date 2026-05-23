'use strict';

// [Day 32A] marketRadar snapshot getter — TDD for the data the chat layer
// needs (top gainers / losers / volume / OI / funding) without re-fetching
// Binance each time. Pure unit test against the exported getTopSnapshot.

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-snap-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.MARKET_RADAR_ENABLED = '0';  // never auto-start; we drive _ingestSnapshotForTest directly

const radar = require('../../server/services/marketRadar');

function fixtureTickers() {
    return [
        { symbol: 'BTCUSDT', price: 70000, priceChangePercent24h:  2.5,  priceChangePercent1h:  0.5,  quoteVolume: 5_000_000_000 },
        { symbol: 'ETHUSDT', price: 3800,  priceChangePercent24h: -1.2,  priceChangePercent1h: -0.3,  quoteVolume: 3_000_000_000 },
        { symbol: 'SOLUSDT', price: 200,   priceChangePercent24h: 12.0,  priceChangePercent1h:  4.0,  quoteVolume: 1_500_000_000 },
        { symbol: 'XRPUSDT', price: 2.5,   priceChangePercent24h: -8.5,  priceChangePercent1h: -2.1,  quoteVolume:   900_000_000 },
        { symbol: 'PEPEUSDT', price: 0.00002, priceChangePercent24h: 35.0, priceChangePercent1h: 7.0, quoteVolume: 700_000_000 },
        { symbol: 'LUNAUSDT', price: 0.5,  priceChangePercent24h: -22.0, priceChangePercent1h: -5.0, quoteVolume:  600_000_000 },
        { symbol: 'BNBUSDT', price: 600,   priceChangePercent24h:  0.1,  priceChangePercent1h:  0.0, quoteVolume:  500_000_000 },
    ];
}

describe('marketRadar.getTopSnapshot', () => {
    beforeEach(() => {
        radar._resetSnapshotForTest();
    });

    test('returns null when no snapshot ingested yet', () => {
        const r = radar.getTopSnapshot({ kind: 'gainers', limit: 5 });
        expect(r).toBeNull();
    });

    test('top gainers sorted by 24h % desc', () => {
        radar._ingestSnapshotForTest(fixtureTickers());
        const r = radar.getTopSnapshot({ kind: 'gainers', limit: 3 });
        expect(r).not.toBeNull();
        expect(r.kind).toBe('gainers');
        expect(r.symbols.map(s => s.symbol)).toEqual(['PEPEUSDT', 'SOLUSDT', 'BTCUSDT']);
        expect(r.symbols[0].priceChangePercent24h).toBe(35.0);
    });

    test('top losers sorted by 24h % asc', () => {
        radar._ingestSnapshotForTest(fixtureTickers());
        const r = radar.getTopSnapshot({ kind: 'losers', limit: 3 });
        expect(r.symbols.map(s => s.symbol)).toEqual(['LUNAUSDT', 'XRPUSDT', 'ETHUSDT']);
        expect(r.symbols[0].priceChangePercent24h).toBe(-22.0);
    });

    test('top by volume desc (default sort)', () => {
        radar._ingestSnapshotForTest(fixtureTickers());
        const r = radar.getTopSnapshot({ kind: 'volume', limit: 3 });
        expect(r.symbols.map(s => s.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    });

    test('limit clamped to snapshot size', () => {
        radar._ingestSnapshotForTest(fixtureTickers().slice(0, 3));
        const r = radar.getTopSnapshot({ kind: 'gainers', limit: 10 });
        expect(r.symbols).toHaveLength(3);
    });

    test('limit floor 1 + ceiling 50 enforced', () => {
        radar._ingestSnapshotForTest(fixtureTickers());
        expect(radar.getTopSnapshot({ kind: 'gainers', limit: 0 }).symbols).toHaveLength(1);
        expect(radar.getTopSnapshot({ kind: 'gainers', limit: 999 }).symbols).toHaveLength(7);  // capped at snapshot size which is <50
    });

    test('returns timestamp + universe size meta', () => {
        radar._ingestSnapshotForTest(fixtureTickers());
        const r = radar.getTopSnapshot({ kind: 'gainers', limit: 1 });
        expect(typeof r.ts).toBe('number');
        expect(r.ts).toBeGreaterThan(0);
        expect(r.universeSize).toBe(7);
    });

    test('unknown kind falls back to volume', () => {
        radar._ingestSnapshotForTest(fixtureTickers());
        const r = radar.getTopSnapshot({ kind: 'bogus', limit: 3 });
        expect(r.kind).toBe('volume');
        expect(r.symbols[0].symbol).toBe('BTCUSDT');
    });

    test('getSymbolFromSnapshot returns single symbol entry', () => {
        radar._ingestSnapshotForTest(fixtureTickers());
        const r = radar.getSymbolFromSnapshot('SOLUSDT');
        expect(r).not.toBeNull();
        expect(r.symbol).toBe('SOLUSDT');
        expect(r.priceChangePercent24h).toBe(12.0);
        expect(r.price).toBe(200);
    });

    test('getSymbolFromSnapshot is case-insensitive + accepts short form', () => {
        radar._ingestSnapshotForTest(fixtureTickers());
        expect(radar.getSymbolFromSnapshot('btc').symbol).toBe('BTCUSDT');
        expect(radar.getSymbolFromSnapshot('SOL').symbol).toBe('SOLUSDT');
    });

    test('getSymbolFromSnapshot returns null for unknown', () => {
        radar._ingestSnapshotForTest(fixtureTickers());
        expect(radar.getSymbolFromSnapshot('UNKNOWNUSDT')).toBeNull();
    });
});
