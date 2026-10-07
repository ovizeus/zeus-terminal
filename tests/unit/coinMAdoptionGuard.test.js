'use strict';
// tests/unit/coinMAdoptionGuard.test.js
// [COIN-M ADOPTION GUARD 2026-10-07] uid=1's Binance testnet account held real
// COIN-M positions and recon adopted them:
//   SAT_RECON_ORPHAN_ADOPTED {"symbol":"BTCUSD_PERP","side":"LONG","amt":778}
// Nothing in this codebase speaks COIN-M — every management and close call goes
// to the USDⓈ-M /fapi endpoints, which answer "Invalid symbol" for *USD_PERP.
// So adoption produced 13 positions that could never be closed, which became
// the 13 poison rows in emergency_close_queue (see
// emergencyQueuePoisonRow.test.js). The guard refuses them at the door.

const at = require('../../server/services/serverAT');

describe('_isUnmanageableSymbol', () => {
    const f = at._isUnmanageableSymbol;

    test('is exported', () => {
        expect(typeof f).toBe('function');
    });

    test('rejects the COIN-M perpetuals that actually caused the incident', () => {
        for (const s of ['BTCUSD_PERP', 'ETHUSD_PERP', 'XRPUSD_PERP', 'ETCUSD_PERP',
                         'NEARUSD_PERP', 'TRXUSD_PERP', 'WLDUSD_PERP', 'SOLUSD_PERP',
                         'DOGEUSD_PERP', 'BNBUSD_PERP', 'LINKUSD_PERP', 'DOTUSD_PERP',
                         'LTCUSD_PERP']) {
            expect(f(s)).toBe(true);
        }
    });

    test('rejects dated COIN-M delivery contracts', () => {
        expect(f('BTCUSD_250926')).toBe(true);
        expect(f('ETHUSD_251226')).toBe(true);
    });

    test('accepts the USDⓈ-M symbols the engine actually trades', () => {
        for (const s of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT',
                         'XRPUSDT', 'LINKUSDT', 'DOTUSDT', '1000PEPEUSDT', 'ETCUSDT']) {
            expect(f(s)).toBe(false);
        }
    });

    test('accepts USDC-quoted USDⓈ-M pairs too', () => {
        expect(f('BTCUSDC')).toBe(false);
    });

    test('treats missing/garbage input as unmanageable rather than passing it through', () => {
        expect(f('')).toBe(true);
        expect(f(null)).toBe(true);
        expect(f(undefined)).toBe(true);
    });
});
