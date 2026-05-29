'use strict';

// P1 (multi-exchange switch) — getExchangeCredsFor(userId, exchange).
// getExchangeCreds loads ONLY the active row → after a switch the old exchange (is_active=0)
// can't be loaded → its open positions can't be managed (close/SL routes to wrong exchange).
// getExchangeCredsFor loads a SPECIFIC exchange's verified creds REGARDLESS of is_active.

const mockDb = {
    getExchangeAccount: jest.fn(),            // active row (unchanged path)
    getExchangeAccountByExchange: jest.fn(),  // NEW — by exchange, any active-state, verified
};
jest.mock('../../server/services/database', () => mockDb);
jest.mock('../../server/services/encryption', () => ({
    decrypt: (v) => (v ? String(v).replace('enc:', '') : v),
}));

const cred = require('../../server/services/credentialStore');

beforeEach(() => jest.clearAllMocks());

const bybitRow = { exchange: 'bybit', api_key_encrypted: 'enc:BKEY', api_secret_encrypted: 'enc:BSEC', mode: 'testnet', is_active: 0, status: 'verified' };
const binanceActive = { exchange: 'binance', api_key_encrypted: 'enc:NKEY', api_secret_encrypted: 'enc:NSEC', mode: 'testnet', is_active: 1, status: 'verified' };

describe('getExchangeCredsFor(userId, exchange)', () => {
    test('loads a specific exchange row even when NOT active (is_active=0)', () => {
        mockDb.getExchangeAccountByExchange.mockReturnValue(bybitRow);
        const c = cred.getExchangeCredsFor(1, 'bybit');
        expect(c).toEqual({ exchange: 'bybit', apiKey: 'BKEY', apiSecret: 'BSEC', baseUrl: 'https://api-testnet.bybit.com', mode: 'testnet' });
        expect(mockDb.getExchangeAccountByExchange).toHaveBeenCalledWith(1, 'bybit');
    });

    test('returns null when no verified account exists for that exchange', () => {
        mockDb.getExchangeAccountByExchange.mockReturnValue(undefined);
        expect(cred.getExchangeCredsFor(1, 'okx')).toBeNull();
    });

    test('returns null on missing args (fail-safe)', () => {
        expect(cred.getExchangeCredsFor(null, 'bybit')).toBeNull();
        expect(cred.getExchangeCredsFor(1, '')).toBeNull();
    });
});

describe('getExchangeCreds (active) — unchanged behavior', () => {
    test('still loads the active row via getExchangeAccount', () => {
        mockDb.getExchangeAccount.mockReturnValue(binanceActive);
        const c = cred.getExchangeCreds(1);
        expect(c.exchange).toBe('binance');
        expect(c.apiKey).toBe('NKEY');
        expect(c.baseUrl).toBe('https://testnet.binancefuture.com');
        expect(mockDb.getExchangeAccount).toHaveBeenCalledWith(1);
    });
});
