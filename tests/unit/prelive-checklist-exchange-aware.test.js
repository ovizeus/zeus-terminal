'use strict';

// [BUG multi-exchange] preLiveChecklist was hardcoded to the Binance signer
// (sendSignedRequest GET /fapi/v2/balance) but fed the ACTIVE exchange's creds.
// Once the active exchange was Bybit, it sent a Binance-format request to the
// Bybit host (https://api-demo.bybit.com/fapi/v2/balance) → HTTP 200 non-JSON →
// CONNECTIVITY + BALANCE falsely failed → "Cannot switch to LIVE: Binance API
// unreachable: ...non-JSON response (HTTP 200)". This blocked the live-mode
// switch whenever Bybit was active.
//
// Correct behavior (mirrors the established Fix #10 / Task 40.1 pattern in the
// same file): route the readiness balance/connectivity probe through
// exchangeOps.getBalance(userId), which dispatches to the active exchange's own
// ops (binanceOps OR bybitOps) and returns the normalized
// { availableBalance, walletBalance, rawExchange } shape.

const path = require('path');

const exchangeOpsMock = { getBalance: jest.fn(), placeEntry: jest.fn() };
// Binance signer must NEVER be the path for a Bybit-active checklist. Mock it to
// reproduce the real failure (200 non-JSON) so the OLD code goes RED and the
// NEW code (which must not touch it) goes GREEN.
const binanceSignerMock = {
    sendSignedRequest: jest.fn().mockRejectedValue(
        new Error('Binance returned non-JSON response (HTTP 200)')
    ),
};
const credentialStoreMock = {
    getExchangeCreds: jest.fn(() => ({
        exchange: 'bybit', apiKey: 'k', apiSecret: 's',
        baseUrl: 'https://api-demo.bybit.com', mode: 'testnet',
    })),
    getExchangeCredsFor: jest.fn(() => null),
};

describe('preLiveChecklist — exchange-aware (Bybit active)', () => {
    let serverAT;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        binanceSignerMock.sendSignedRequest.mockRejectedValue(
            new Error('Binance returned non-JSON response (HTTP 200)')
        );
        credentialStoreMock.getExchangeCreds.mockReturnValue({
            exchange: 'bybit', apiKey: 'k', apiSecret: 's',
            baseUrl: 'https://api-demo.bybit.com', mode: 'testnet',
        });
        jest.doMock(path.resolve(__dirname, '../../server/services/exchangeOps'), () => exchangeOpsMock);
        jest.doMock(path.resolve(__dirname, '../../server/services/binanceSigner'), () => binanceSignerMock);
        jest.doMock(path.resolve(__dirname, '../../server/services/credentialStore'), () => credentialStoreMock);
        serverAT = require('../../server/services/serverAT');
    });

    test('routes the readiness probe through exchangeOps, NOT the Binance signer', async () => {
        exchangeOpsMock.getBalance.mockResolvedValue({
            asset: 'USDT', walletBalance: '500', availableBalance: '500',
            totalUnrealizedPnL: '0', rawExchange: 'bybit',
        });
        const result = await serverAT.preLiveChecklist(42);

        expect(exchangeOpsMock.getBalance).toHaveBeenCalledWith(42);
        expect(binanceSignerMock.sendSignedRequest).not.toHaveBeenCalled();

        const connectivity = result.checks.find(c => c.name === 'CONNECTIVITY');
        const balance = result.checks.find(c => c.name === 'BALANCE');
        expect(connectivity.ok).toBe(true);
        expect(balance.ok).toBe(true);
        // Detail must reflect the ACTIVE exchange, never a hardcoded "Binance".
        expect(connectivity.detail).not.toMatch(/Binance/i);
        expect(connectivity.detail).toMatch(/Bybit/i);
        expect(result.failedChecks).not.toContain('CONNECTIVITY');
        expect(result.failedChecks).not.toContain('BALANCE');
    });

    test('zero balance on the active exchange → BALANCE fails truthfully (no Binance text)', async () => {
        exchangeOpsMock.getBalance.mockResolvedValue({
            asset: 'USDT', walletBalance: '0', availableBalance: '0',
            totalUnrealizedPnL: '0', rawExchange: 'bybit',
        });
        const result = await serverAT.preLiveChecklist(42);
        const balance = result.checks.find(c => c.name === 'BALANCE');
        expect(balance.ok).toBe(false);
        expect(balance.detail).toMatch(/Bybit/i);
        expect(balance.detail).not.toMatch(/Binance/i);
    });

    test('exchange unreachable → CONNECTIVITY fails with the active exchange name', async () => {
        exchangeOpsMock.getBalance.mockRejectedValue(new Error('socket hang up'));
        const result = await serverAT.preLiveChecklist(42);
        const connectivity = result.checks.find(c => c.name === 'CONNECTIVITY');
        expect(connectivity.ok).toBe(false);
        expect(connectivity.detail).toMatch(/Bybit/i);
        expect(connectivity.detail).not.toMatch(/Binance/i);
    });
});
