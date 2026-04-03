/**
 * Zeus Terminal — Unit Tests: serverPendingEntry.js
 * Tests pending entry creation, pullback fills, momentum fills, expiry, cancellation
 */
'use strict';

jest.mock('../../server/services/database', () => ({
    db: { prepare: jest.fn(() => ({ all: jest.fn(() => []), run: jest.fn() })) },
    atSetState: jest.fn(),
}));
jest.mock('../../server/services/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../server/services/telegram', () => ({
    sendToUser: jest.fn(),
}));

const pending = require('../../server/services/serverPendingEntry');

// ── Helpers ──
function makeBrainDecision(overrides = {}) {
    return {
        symbol: 'BTCUSDT',
        price: 50000,
        priceTs: Date.now(),
        cycle: 100,
        fusion: { dir: 'LONG', decision: 'MEDIUM', confidence: 75, score: 80 },
        regime: { regime: 'TREND' },
        ...overrides,
    };
}

const baseSTC = { confMin: 65, sigMin: 3, adxMin: 18, maxPos: 10, cooldownMs: 60000, lev: 20, size: 2000, slPct: 1, rr: 1, dslMode: 'fast' };

// ══════════════════════════════════════════════════════════════
// createPending
// ══════════════════════════════════════════════════════════════
describe('createPending', () => {

    test('creates pending entry for valid decision', () => {
        const p = pending.createPending(makeBrainDecision(), baseSTC, 'user-1', {});
        expect(p).not.toBeNull();
        expect(p.status).toBe('WAITING');
        expect(p.dir).toBe('LONG');
        expect(p.symbol).toBe('BTCUSDT');
        expect(p.targetPrice).toBeLessThan(50000); // LONG pullback = lower price
    });

    test('returns null without userId', () => {
        const p = pending.createPending(makeBrainDecision(), baseSTC, null, {});
        expect(p).toBeNull();
    });

    test('returns null without decision', () => {
        const p = pending.createPending(null, baseSTC, 'user-2', {});
        expect(p).toBeNull();
    });

    test('blocks duplicate pending for same symbol', () => {
        pending.createPending(makeBrainDecision(), baseSTC, 'dup-user', {});
        const p2 = pending.createPending(makeBrainDecision(), baseSTC, 'dup-user', {});
        expect(p2).toBeNull();
    });

    test('SHORT pending has target above current price', () => {
        const dec = makeBrainDecision({ fusion: { dir: 'SHORT', decision: 'MEDIUM', confidence: 75, score: 80 } });
        const p = pending.createPending(dec, baseSTC, 'short-user', {});
        expect(p.targetPrice).toBeGreaterThan(50000);
    });

    test('uses liquidity zone for target price if available', () => {
        const ctx = { liquidity: { nearestBelow: { price: 49900 } } };
        const p = pending.createPending(makeBrainDecision(), baseSTC, 'liq-user', ctx);
        expect(p.targetPrice).toBe(49900);
    });
});

// ══════════════════════════════════════════════════════════════
// checkPending — pullback fill
// ══════════════════════════════════════════════════════════════
describe('checkPending — pullback fill', () => {

    test('fills when price hits target (LONG)', () => {
        const dec = makeBrainDecision({ price: 50000 });
        pending.createPending(dec, baseSTC, 'fill-user', {});
        const result = pending.checkPending('BTCUSDT', 49940, 'fill-user'); // below target
        expect(result).not.toBeNull();
        expect(result.action).toBe('FILL');
        expect(result.pending.status).toBe('FILLED');
    });

    test('fills when price hits target (SHORT)', () => {
        const dec = makeBrainDecision({ price: 50000, fusion: { dir: 'SHORT', decision: 'MEDIUM', confidence: 75, score: 80 } });
        pending.createPending(dec, baseSTC, 'fill-short', {});
        const result = pending.checkPending('BTCUSDT', 50060, 'fill-short'); // above target
        expect(result).not.toBeNull();
        expect(result.action).toBe('FILL');
    });
});

// ══════════════════════════════════════════════════════════════
// checkPending — momentum fill
// ══════════════════════════════════════════════════════════════
describe('checkPending — momentum fill', () => {

    test('momentum fills on 0.3% move in direction (LONG)', () => {
        const dec = makeBrainDecision({ price: 50000 });
        pending.createPending(dec, baseSTC, 'mom-user', {});
        // 0.3% up = 50150
        const result = pending.checkPending('BTCUSDT', 50150, 'mom-user');
        expect(result).not.toBeNull();
        expect(result.action).toBe('MOMENTUM');
    });

    test('no momentum fill on small move', () => {
        const dec = makeBrainDecision({ price: 50000 });
        pending.createPending(dec, baseSTC, 'small-mom', {});
        const result = pending.checkPending('BTCUSDT', 50050, 'small-mom'); // only 0.1%
        expect(result).toBeNull(); // still waiting
    });
});

// ══════════════════════════════════════════════════════════════
// checkPending — expiry
// ══════════════════════════════════════════════════════════════
describe('checkPending — expiry', () => {

    test('expires after max candles', () => {
        const dec = makeBrainDecision({ price: 50000 });
        pending.createPending(dec, baseSTC, 'expire-user', {});
        let result;
        // Simulate 6 cycles with no pullback and no momentum
        for (let i = 0; i < 6; i++) {
            result = pending.checkPending('BTCUSDT', 50010, 'expire-user'); // tiny move, not momentum
        }
        expect(result).not.toBeNull();
        expect(result.action).toBe('EXPIRE');
    });
});

// ══════════════════════════════════════════════════════════════
// cancelPending
// ══════════════════════════════════════════════════════════════
describe('cancelPending', () => {

    test('cancels existing pending', () => {
        pending.createPending(makeBrainDecision(), baseSTC, 'cancel-user', {});
        const ok = pending.cancelPending('BTCUSDT', 'cancel-user', 'test');
        expect(ok).toBe(true);
        expect(pending.getPending('BTCUSDT', 'cancel-user')).toBeNull();
    });

    test('returns false for non-existent pending', () => {
        const ok = pending.cancelPending('ETHUSDT', 'no-user', 'test');
        expect(ok).toBe(false);
    });
});

// ══════════════════════════════════════════════════════════════
// getAllPending
// ══════════════════════════════════════════════════════════════
describe('getAllPending', () => {

    test('returns all pending for user', () => {
        pending.createPending(makeBrainDecision({ symbol: 'ETHUSDT' }), baseSTC, 'multi-user', {});
        pending.createPending(makeBrainDecision({ symbol: 'SOLUSDT' }), baseSTC, 'multi-user', {});
        const all = pending.getAllPending('multi-user');
        expect(all.length).toBe(2);
        expect(all.map(p => p.symbol).sort()).toEqual(['ETHUSDT', 'SOLUSDT']);
    });

    test('returns empty for unknown user', () => {
        expect(pending.getAllPending('nobody').length).toBe(0);
    });
});

// ══════════════════════════════════════════════════════════════
// cancelAllForUser
// ══════════════════════════════════════════════════════════════
describe('cancelAllForUser', () => {

    test('cancels all pending entries', () => {
        pending.createPending(makeBrainDecision({ symbol: 'AAVEUSDT' }), baseSTC, 'killuser', {});
        pending.createPending(makeBrainDecision({ symbol: 'LINKUSDT' }), baseSTC, 'killuser', {});
        pending.cancelAllForUser('killuser');
        expect(pending.getAllPending('killuser').length).toBe(0);
    });
});
