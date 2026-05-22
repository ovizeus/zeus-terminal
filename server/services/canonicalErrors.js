'use strict';

/**
 * canonicalErrors — Unified error model across exchanges.
 *
 * Every binanceOps/bybitOps method maps exchange-specific errors to
 * CanonicalError shape: { code, message, rawCode?, rawMessage? }
 *
 * Brain logic + recon react identically regardless of exchange.
 */

const Codes = Object.freeze({
    ErrInvalidParams:        'ErrInvalidParams',
    ErrAuthFailed:           'ErrAuthFailed',
    ErrInsufficientBalance:  'ErrInsufficientBalance',
    ErrInvalidSymbol:        'ErrInvalidSymbol',
    ErrLotSize:              'ErrLotSize',
    ErrMinNotional:          'ErrMinNotional',
    ErrLeverageInvalid:      'ErrLeverageInvalid',
    ErrPositionExists:       'ErrPositionExists',
    ErrOrderNotFound:        'ErrOrderNotFound',
    ErrRateLimit:            'ErrRateLimit',
    ErrIpBan:                'ErrIpBan',
    ErrSlPlacementFailed:    'ErrSlPlacementFailed',
    ErrTpPlacementFailed:    'ErrTpPlacementFailed',
    ErrDuplicate:            'ErrDuplicate',
    ErrLockTimeout:          'ErrLockTimeout',
    ErrNetwork:              'ErrNetwork',
    ErrTimeSyncDrift:        'ErrTimeSyncDrift',
    ErrUnknown:              'ErrUnknown',
});

function create(code, message, raw) {
    const err = { code, message };
    if (raw && raw.rawCode !== undefined) err.rawCode = raw.rawCode;
    if (raw && raw.rawMessage !== undefined) err.rawMessage = raw.rawMessage;
    return err;
}

const _BINANCE_MAP = Object.freeze({
    [-2010]: 'ErrInsufficientBalance',
    [-1121]: 'ErrInvalidSymbol',
    [-1100]: 'ErrLotSize',
    [-1011]: 'ErrLotSize',
    [-1013]: 'ErrMinNotional',
    [-4028]: 'ErrLeverageInvalid',
    [-2027]: 'ErrPositionExists',
    [-2011]: 'ErrOrderNotFound',
    [-2015]: 'ErrIpBan',
    [-2014]: 'ErrAuthFailed',
    [-1022]: 'ErrAuthFailed',
    [-1003]: 'ErrRateLimit',
    [-4131]: 'ErrLeverageInvalid',
});

function translateBinance(resp) {
    if (!resp) return null;
    if (resp.status === 'FILLED') return null;
    if (resp.code === undefined) return null;
    const code = resp.code;
    const message = resp.msg || resp.message || 'unknown';
    const canonicalCode = _BINANCE_MAP[code] || 'ErrUnknown';
    return create(canonicalCode, message, { rawCode: code, rawMessage: message });
}

const _BYBIT_MAP = Object.freeze({
    110007: 'ErrInsufficientBalance',
    110001: 'ErrOrderNotFound',
    110045: 'ErrMinNotional',
    110026: 'ErrLeverageInvalid',
    110066: 'ErrDuplicate',
    110025: 'ErrPositionExists',
    110043: 'ErrLeverageInvalid',
    10001:  'ErrInvalidParams',
    10003:  'ErrAuthFailed',
    10004:  'ErrAuthFailed',
    10005:  'ErrAuthFailed',
    10006:  'ErrRateLimit',
    10018:  'ErrIpBan',
});

function translateBybit(resp) {
    if (!resp) return null;
    if (resp.retCode === 0) return null;
    if (resp.retCode === undefined) return null;
    const code = resp.retCode;
    const message = resp.retMsg || 'unknown';
    const canonicalCode = _BYBIT_MAP[code] || 'ErrUnknown';
    return create(canonicalCode, message, { rawCode: code, rawMessage: message });
}

module.exports = { Codes, create, translateBinance, translateBybit };
