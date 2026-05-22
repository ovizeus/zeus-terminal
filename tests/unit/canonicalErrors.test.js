'use strict';

const ce = require('../../server/services/canonicalErrors');

describe('canonicalErrors', () => {
    describe('Codes enum', () => {
        it('has all 18 required canonical codes', () => {
            const required = [
                'ErrInvalidParams', 'ErrAuthFailed', 'ErrInsufficientBalance',
                'ErrInvalidSymbol', 'ErrLotSize', 'ErrMinNotional',
                'ErrLeverageInvalid', 'ErrPositionExists', 'ErrOrderNotFound',
                'ErrRateLimit', 'ErrIpBan', 'ErrSlPlacementFailed',
                'ErrTpPlacementFailed', 'ErrDuplicate', 'ErrLockTimeout',
                'ErrNetwork', 'ErrTimeSyncDrift', 'ErrUnknown'
            ];
            for (const code of required) {
                expect(ce.Codes[code]).toBe(code);
            }
        });

        it('Codes is frozen', () => {
            expect(Object.isFrozen(ce.Codes)).toBe(true);
        });
    });

    describe('create()', () => {
        it('returns object with code + message', () => {
            const err = ce.create('ErrInvalidParams', 'sl missing on live');
            expect(err.code).toBe('ErrInvalidParams');
            expect(err.message).toBe('sl missing on live');
        });

        it('includes rawCode + rawMessage when provided', () => {
            const err = ce.create('ErrInsufficientBalance', 'balance low', { rawCode: -2010, rawMessage: 'Account balance insufficient' });
            expect(err.rawCode).toBe(-2010);
            expect(err.rawMessage).toBe('Account balance insufficient');
        });

        it('omits rawCode/rawMessage when raw object not provided', () => {
            const err = ce.create('ErrUnknown', 'wat');
            expect(err).not.toHaveProperty('rawCode');
            expect(err).not.toHaveProperty('rawMessage');
        });
    });

    describe('translateBinance()', () => {
        it('returns null for status=FILLED', () => {
            expect(ce.translateBinance({ status: 'FILLED', orderId: 1 })).toBeNull();
        });

        it('returns null when code is undefined', () => {
            expect(ce.translateBinance({ orderId: 1 })).toBeNull();
        });

        it('returns null for null/undefined input', () => {
            expect(ce.translateBinance(null)).toBeNull();
            expect(ce.translateBinance(undefined)).toBeNull();
        });

        it('maps -2010 to ErrInsufficientBalance', () => {
            const err = ce.translateBinance({ code: -2010, msg: 'Account has insufficient balance' });
            expect(err.code).toBe('ErrInsufficientBalance');
            expect(err.rawCode).toBe(-2010);
            expect(err.rawMessage).toBe('Account has insufficient balance');
        });

        it('maps -1121 to ErrInvalidSymbol', () => {
            expect(ce.translateBinance({ code: -1121, msg: 'Invalid symbol' }).code).toBe('ErrInvalidSymbol');
        });

        it('maps -1100/-1011 to ErrLotSize', () => {
            expect(ce.translateBinance({ code: -1100, msg: 'lot' }).code).toBe('ErrLotSize');
            expect(ce.translateBinance({ code: -1011, msg: 'lot' }).code).toBe('ErrLotSize');
        });

        it('maps -1013 to ErrMinNotional', () => {
            expect(ce.translateBinance({ code: -1013, msg: 'notional' }).code).toBe('ErrMinNotional');
        });

        it('maps -4028/-4131 to ErrLeverageInvalid', () => {
            expect(ce.translateBinance({ code: -4028, msg: 'lev' }).code).toBe('ErrLeverageInvalid');
            expect(ce.translateBinance({ code: -4131, msg: 'lev' }).code).toBe('ErrLeverageInvalid');
        });

        it('maps -2027 to ErrPositionExists', () => {
            expect(ce.translateBinance({ code: -2027, msg: 'pos' }).code).toBe('ErrPositionExists');
        });

        it('maps -2011 to ErrOrderNotFound', () => {
            expect(ce.translateBinance({ code: -2011, msg: 'unknown' }).code).toBe('ErrOrderNotFound');
        });

        it('maps -2015 to ErrIpBan', () => {
            expect(ce.translateBinance({ code: -2015, msg: 'ip' }).code).toBe('ErrIpBan');
        });

        it('maps -1003 to ErrRateLimit', () => {
            expect(ce.translateBinance({ code: -1003, msg: 'rate' }).code).toBe('ErrRateLimit');
        });

        it('maps -2014/-1022 to ErrAuthFailed', () => {
            expect(ce.translateBinance({ code: -2014, msg: 'auth' }).code).toBe('ErrAuthFailed');
            expect(ce.translateBinance({ code: -1022, msg: 'auth' }).code).toBe('ErrAuthFailed');
        });

        it('maps unknown codes to ErrUnknown', () => {
            const err = ce.translateBinance({ code: -99999, msg: 'wat' });
            expect(err.code).toBe('ErrUnknown');
            expect(err.rawCode).toBe(-99999);
        });
    });

    describe('translateBybit()', () => {
        it('returns null for retCode=0 (success)', () => {
            expect(ce.translateBybit({ retCode: 0, retMsg: 'OK' })).toBeNull();
        });

        it('returns null when retCode undefined', () => {
            expect(ce.translateBybit({ result: {} })).toBeNull();
        });

        it('returns null for null/undefined', () => {
            expect(ce.translateBybit(null)).toBeNull();
            expect(ce.translateBybit(undefined)).toBeNull();
        });

        it('maps 110007 to ErrInsufficientBalance', () => {
            const err = ce.translateBybit({ retCode: 110007, retMsg: 'Insufficient balance' });
            expect(err.code).toBe('ErrInsufficientBalance');
            expect(err.rawCode).toBe(110007);
        });

        it('maps 110001 to ErrOrderNotFound', () => {
            expect(ce.translateBybit({ retCode: 110001, retMsg: 'order not exists' }).code).toBe('ErrOrderNotFound');
        });

        it('maps 110045 to ErrMinNotional', () => {
            expect(ce.translateBybit({ retCode: 110045, retMsg: 'min' }).code).toBe('ErrMinNotional');
        });

        it('maps 110026/110043 to ErrLeverageInvalid', () => {
            expect(ce.translateBybit({ retCode: 110026, retMsg: 'lev' }).code).toBe('ErrLeverageInvalid');
            expect(ce.translateBybit({ retCode: 110043, retMsg: 'lev' }).code).toBe('ErrLeverageInvalid');
        });

        it('maps 110066 to ErrDuplicate', () => {
            expect(ce.translateBybit({ retCode: 110066, retMsg: 'orderLinkId exists' }).code).toBe('ErrDuplicate');
        });

        it('maps 110025 to ErrPositionExists', () => {
            expect(ce.translateBybit({ retCode: 110025, retMsg: 'pos' }).code).toBe('ErrPositionExists');
        });

        it('maps 10003/10004/10005 to ErrAuthFailed', () => {
            for (const c of [10003, 10004, 10005]) {
                expect(ce.translateBybit({ retCode: c, retMsg: 'auth' }).code).toBe('ErrAuthFailed');
            }
        });

        it('maps 10006 to ErrRateLimit', () => {
            expect(ce.translateBybit({ retCode: 10006, retMsg: 'rate' }).code).toBe('ErrRateLimit');
        });

        it('maps 10018 to ErrIpBan', () => {
            expect(ce.translateBybit({ retCode: 10018, retMsg: 'ip' }).code).toBe('ErrIpBan');
        });

        it('maps unknown retCode to ErrUnknown', () => {
            expect(ce.translateBybit({ retCode: 99999, retMsg: 'wat' }).code).toBe('ErrUnknown');
        });
    });
});
