'use strict';

// Task L — Pre-trade balance sanity check
// Before _executeLiveEntry calls exchangeOps.placeEntry, verify the user
// actually has enough free balance to cover the entry (sizeUsd * 1.1 for
// 10% headroom). If not, skip with audit + Telegram alert instead of
// letting the exchange reject with a cryptic error message.
//
// Fail-open: if balance fetch errors (network, signer), DO NOT block —
// the exchange will reject if truly insufficient. Blocking on a stale
// balance API would cause more harm than good.

const path = require('path');

const exchangeOpsMock = {
    getBalance: jest.fn(),
    placeEntry: jest.fn(),
};
jest.mock(path.resolve(__dirname, '../../server/services/exchangeOps'), () => exchangeOpsMock);

describe('serverAT._checkBalanceForEntry', () => {
    let serverAT;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        jest.doMock(path.resolve(__dirname, '../../server/services/exchangeOps'), () => exchangeOpsMock);
        serverAT = require('../../server/services/serverAT');
    });

    test('exported as _checkBalanceForEntry function', () => {
        expect(typeof serverAT._checkBalanceForEntry).toBe('function');
    });

    test('returns ok=true when free balance covers sizeUsd * 1.1', async () => {
        exchangeOpsMock.getBalance.mockResolvedValue({ free: 200, total: 500 });
        const result = await serverAT._checkBalanceForEntry(42, 100);
        expect(result.ok).toBe(true);
        expect(result.free).toBe(200);
        expect(result.required).toBe(110);
    });

    test('returns ok=false when free balance below sizeUsd * 1.1', async () => {
        exchangeOpsMock.getBalance.mockResolvedValue({ free: 50, total: 100 });
        const result = await serverAT._checkBalanceForEntry(42, 100);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('BALANCE_INSUFFICIENT');
        expect(result.free).toBe(50);
        expect(result.required).toBe(110);
    });

    test('accepts when free == required (boundary)', async () => {
        exchangeOpsMock.getBalance.mockResolvedValue({ free: 110, total: 500 });
        const result = await serverAT._checkBalanceForEntry(42, 100);
        expect(result.ok).toBe(true);
    });

    test('uses availableBalance as fallback if free is missing', async () => {
        exchangeOpsMock.getBalance.mockResolvedValue({ availableBalance: 300 });
        const result = await serverAT._checkBalanceForEntry(42, 100);
        expect(result.ok).toBe(true);
        expect(result.free).toBe(300);
    });

    test('balance fetch failure → fail-open (returns ok=true + skipped=true)', async () => {
        exchangeOpsMock.getBalance.mockRejectedValue(new Error('network timeout'));
        const result = await serverAT._checkBalanceForEntry(42, 100);
        expect(result.ok).toBe(true);
        expect(result.skipped).toBe(true);
        expect(result.error).toMatch(/network timeout/);
    });

    test('sizeUsd <= 0 → ok=true (no check needed)', async () => {
        const result = await serverAT._checkBalanceForEntry(42, 0);
        expect(result.ok).toBe(true);
        expect(exchangeOpsMock.getBalance).not.toHaveBeenCalled();
    });

    test('sizeUsd null/undefined → ok=true', async () => {
        const result1 = await serverAT._checkBalanceForEntry(42, null);
        const result2 = await serverAT._checkBalanceForEntry(42, undefined);
        expect(result1.ok).toBe(true);
        expect(result2.ok).toBe(true);
    });

    test('zero free balance → ok=false', async () => {
        exchangeOpsMock.getBalance.mockResolvedValue({ free: 0 });
        const result = await serverAT._checkBalanceForEntry(42, 100);
        expect(result.ok).toBe(false);
        expect(result.free).toBe(0);
    });

    test('getBalance returns null → fail-open', async () => {
        exchangeOpsMock.getBalance.mockResolvedValue(null);
        const result = await serverAT._checkBalanceForEntry(42, 100);
        expect(result.ok).toBe(false);  // 0 free, 110 needed
        expect(result.free).toBe(0);
    });
});
