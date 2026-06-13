'use strict';

// [2026-06-13] Radar P5-starvation fix — disk-persisted last-good snapshot so the
// TOP 300 panel survives a reload (and any upstream quota starvation) by serving
// the previous good snapshot marked stale, instead of a blank "scanning…".
// See memory project-radar-top300-p5-starvation. Pure unit test — no Binance.

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-persist-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.MARKET_RADAR_ENABLED = '0';            // never auto-start
const SNAP_PATH = path.join(TEST_DIR, 'marketRadar-snapshot.json');
process.env.MARKET_RADAR_SNAPSHOT_PATH = SNAP_PATH;

const radar = require('../../server/services/marketRadar');

function fixtureTickers() {
    return [
        { symbol: 'BTCUSDT', price: 70000, priceChangePercent24h: 2.5, priceChangePercent1h: 0.5, quoteVolume: 5_000_000_000 },
        { symbol: 'ETHUSDT', price: 3800, priceChangePercent24h: -1.2, priceChangePercent1h: -0.3, quoteVolume: 3_000_000_000 },
        { symbol: 'SOLUSDT', price: 200, priceChangePercent24h: 12.0, priceChangePercent1h: 4.0, quoteVolume: 1_500_000_000 },
    ];
}

describe('marketRadar snapshot disk persistence (P5-starvation fix)', () => {
    beforeEach(() => {
        radar._resetSnapshotForTest();
        try { fs.unlinkSync(SNAP_PATH); } catch (_) { /* not there */ }
    });

    test('a fresh live snapshot is flagged stale:false', () => {
        radar._ingestSnapshotForTest(fixtureTickers());
        const r = radar.getTopSnapshot({ kind: 'volume', limit: 3 });
        expect(r.stale).toBe(false);
    });

    test('_setSnapshot persists the snapshot to disk as valid JSON', () => {
        radar._ingestSnapshotForTest(fixtureTickers());
        radar._persistSnapshotToDisk();                       // flush (ingest may persist async)
        expect(fs.existsSync(SNAP_PATH)).toBe(true);
        const onDisk = JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8'));
        expect(typeof onDisk.ts).toBe('number');
        expect(onDisk.source).toBe('binance');
        expect(Array.isArray(onDisk.tickers)).toBe(true);
        expect(onDisk.tickers.map(t => t.symbol)).toContain('BTCUSDT');
    });

    test('_rehydrateIfEmpty repopulates last-good from disk after a reload, marked stale', () => {
        radar._ingestSnapshotForTest(fixtureTickers());
        radar._persistSnapshotToDisk();
        radar._resetSnapshotForTest();                        // simulate process reload (memory wiped)
        expect(radar.getTopSnapshot({ kind: 'volume', limit: 3 })).toBeNull();

        const did = radar._rehydrateIfEmpty();
        expect(did).toBe(true);
        const r = radar.getTopSnapshot({ kind: 'volume', limit: 3 });
        expect(r).not.toBeNull();
        expect(r.stale).toBe(true);
        expect(r.source).toBe('binance');
        expect(r.symbols.map(s => s.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    });

    test('_rehydrateIfEmpty does NOT clobber an existing live snapshot', () => {
        // disk has an OLD single-symbol snapshot
        radar._ingestSnapshotForTest([{ symbol: 'OLDUSDT', price: 1, priceChangePercent24h: 0, priceChangePercent1h: 0, quoteVolume: 1 }]);
        radar._persistSnapshotToDisk();
        // a fresh live poll lands
        radar._resetSnapshotForTest();
        radar._ingestSnapshotForTest(fixtureTickers());
        const did = radar._rehydrateIfEmpty();
        expect(did).toBe(false);
        const r = radar.getTopSnapshot({ kind: 'volume', limit: 3 });
        expect(r.stale).toBe(false);
        expect(r.symbols.map(s => s.symbol)).toContain('BTCUSDT');
    });

    test('_rehydrateIfEmpty is a safe no-op when no disk file exists', () => {
        radar._resetSnapshotForTest();
        const did = radar._rehydrateIfEmpty();
        expect(did).toBe(false);
        expect(radar.getTopSnapshot({ kind: 'volume', limit: 3 })).toBeNull();
    });

    test('corrupt disk file does not throw and yields no rehydration', () => {
        fs.writeFileSync(SNAP_PATH, '{ this is not json ', 'utf8');
        radar._resetSnapshotForTest();
        expect(() => radar._rehydrateIfEmpty()).not.toThrow();
        expect(radar.getTopSnapshot({ kind: 'volume', limit: 3 })).toBeNull();
    });
});
