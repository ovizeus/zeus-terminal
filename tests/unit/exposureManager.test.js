'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'exposure-mgr-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const expoMgr = require('../../server/services/ml/R4_execution/exposureManager');

describe('exposureManager', () => {
    test('getTotalExposure returns 0 when no positions', () => {
        const r = expoMgr.getTotalExposure({ positions: [] });
        expect(r.totalSize).toBe(0);
        expect(r.totalNotional).toBe(0);
        expect(r.positionCount).toBe(0);
    });

    test('getTotalExposure sums size + notional across positions', () => {
        const r = expoMgr.getTotalExposure({
            positions: [
                { symbol: 'BTC', size: 100, lev: 5, qty: 0.001, price: 70000 },
                { symbol: 'ETH', size: 50, lev: 10, qty: 0.01, price: 3800 },
            ],
        });
        expect(r.totalSize).toBe(150);
        expect(r.positionCount).toBe(2);
        // Notional = qty × price summed
        expect(r.totalNotional).toBeGreaterThan(0);
    });

    test('getTotalExposure groups by symbol', () => {
        const r = expoMgr.getTotalExposure({
            positions: [
                { symbol: 'BTC', size: 100, lev: 5, qty: 0.001, price: 70000 },
                { symbol: 'BTC', size: 50, lev: 5, qty: 0.0005, price: 70000 },
                { symbol: 'ETH', size: 30, lev: 5, qty: 0.005, price: 3800 },
            ],
        });
        expect(r.bySymbol.BTC.size).toBe(150);
        expect(r.bySymbol.ETH.size).toBe(30);
    });

    test('getTotalExposure separates by side', () => {
        const r = expoMgr.getTotalExposure({
            positions: [
                { symbol: 'BTC', side: 'LONG', size: 100, qty: 0.001, price: 70000 },
                { symbol: 'BTC', side: 'SHORT', size: 80, qty: 0.001, price: 70000 },
            ],
        });
        expect(r.totalSize).toBe(180);
        expect(r.byDir.LONG).toBe(100);
        expect(r.byDir.SHORT).toBe(80);
    });

    test('exposurePct returns size/balance × 100', () => {
        const r = expoMgr.getTotalExposure({
            positions: [{ symbol: 'BTC', size: 200, qty: 0.001, price: 70000 }],
            balance: 1000,
        });
        expect(r.exposurePct).toBe(20);
    });

    test('exposurePct = 0 when balance = 0 (defensive)', () => {
        const r = expoMgr.getTotalExposure({
            positions: [{ symbol: 'BTC', size: 200 }],
            balance: 0,
        });
        expect(r.exposurePct).toBe(0);
    });

    test('wouldExceedLimit returns true when new order pushes >50% balance', () => {
        const r = expoMgr.wouldExceedLimit({
            positions: [{ symbol: 'BTC', size: 400 }],
            balance: 1000,
            newOrder: { size: 200 },
            maxPct: 50,
        });
        expect(r.wouldExceed).toBe(true);
        expect(r.projectedPct).toBe(60);
    });

    test('wouldExceedLimit returns false when within bounds', () => {
        const r = expoMgr.wouldExceedLimit({
            positions: [{ symbol: 'BTC', size: 100 }],
            balance: 1000,
            newOrder: { size: 50 },
            maxPct: 50,
        });
        expect(r.wouldExceed).toBe(false);
    });

    test('handles undefined positions gracefully', () => {
        const r = expoMgr.getTotalExposure({ positions: null });
        expect(r.totalSize).toBe(0);
    });
});
