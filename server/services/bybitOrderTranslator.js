// Zeus Terminal — Bybit V5 Order Translator (S4-B3)
// Pure functions mapping internal canonical intents to Bybit V5 param objects
// ready to be fed into bybitSigner.buildSignedRequestDryRun(...).
//
// HARD CONTRACT:
//   - No HTTP / fetch / axios / http / https / node-fetch.
//   - No DB, no serverAT/serverBrain/serverDSL imports.
//   - No binanceSigner import. No routes import.
//   - No Date.now(), no Math.random(), no process.env reads.
//   - No real credentials handled here (creds are passed to bybitSigner, not here).
//   - Deterministic input → output. Same input always yields same output.
//   - Throws canonical BYBIT_TRANSLATOR_* error codes on invalid input.
//
// Reduce-only close uses EXPLICIT positionSide semantics (Option A from the
// approved S4-B3 spec) so the side mapping is unambiguous:
//   positionSide:'long'  → Bybit side:'Sell', reduceOnly:true
//   positionSide:'short' → Bybit side:'Buy',  reduceOnly:true
'use strict';

// ── Constants ───────────────────────────────────────────────────────────────
const _SUPPORTED_CATEGORIES = new Set(['linear']); // S4-B3 scope
const _CLIENT_ID_MAX_LEN = 36;
const _CLIENT_ID_RE = /^[a-zA-Z0-9_-]+$/;
const _SYMBOL_RE = /^[A-Z0-9]+$/;
const _SIDE_TO_BYBIT = { long: 'Buy', short: 'Sell' };
const _CLOSE_SIDE_FOR_POSITION = { long: 'Sell', short: 'Buy' };
const _ALLOWED_TIF = new Set(['IOC', 'GTC', 'FOK']);
const _ALLOWED_TRIGGER_BY = new Set(['LastPrice', 'IndexPrice', 'MarkPrice']);
const _ALLOWED_TPSL_MODE = new Set(['Full', 'Partial']);
const _ALLOWED_ACCOUNT_TYPE = new Set(['CONTRACT', 'UNIFIED']);

// ── Validation helpers (throw canonical error codes) ────────────────────────

function _validateSymbol(symbol) {
    if (typeof symbol !== 'string' || !_SYMBOL_RE.test(symbol)) {
        throw new Error('BYBIT_TRANSLATOR_INVALID_SYMBOL');
    }
}

function _validateCategory(category) {
    if (!_SUPPORTED_CATEGORIES.has(category)) {
        throw new Error('BYBIT_TRANSLATOR_UNSUPPORTED_CATEGORY');
    }
}

function _validateEntrySide(side) {
    if (!Object.prototype.hasOwnProperty.call(_SIDE_TO_BYBIT, side)) {
        throw new Error('BYBIT_TRANSLATOR_INVALID_SIDE');
    }
}

function _validatePositionSide(positionSide) {
    if (!Object.prototype.hasOwnProperty.call(_CLOSE_SIDE_FOR_POSITION, positionSide)) {
        throw new Error('BYBIT_TRANSLATOR_INVALID_POSITION_SIDE');
    }
}

function _toFiniteNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v === 'string' && v.trim() !== '' && /^-?\d+(?:\.\d+)?$/.test(v.trim())) {
        const n = Number(v.trim());
        return Number.isFinite(n) ? n : NaN;
    }
    return NaN;
}

function _validatePositiveAmount(value, errCode) {
    const n = _toFiniteNumber(value);
    if (!Number.isFinite(n) || n <= 0) throw new Error(errCode);
}

function _formatAmount(value) {
    // Output is always a string. If input is a number, .toString() preserves
    // the canonical form Bybit expects (e.g. 0.001, 70500, 10).
    return typeof value === 'string' ? value.trim() : String(value);
}

function _validateClientId(id) {
    if (typeof id !== 'string' || id.length === 0 ||
        id.length > _CLIENT_ID_MAX_LEN || !_CLIENT_ID_RE.test(id)) {
        throw new Error('BYBIT_TRANSLATOR_INVALID_CLIENT_ID');
    }
}

function _validateLeverage(leverage) {
    const n = _toFiniteNumber(leverage);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        throw new Error('BYBIT_TRANSLATOR_INVALID_LEVERAGE');
    }
}

function _resolveTimeInForce(tif) {
    if (tif === undefined) return 'IOC';
    if (typeof tif !== 'string' || !_ALLOWED_TIF.has(tif)) {
        throw new Error('BYBIT_TRANSLATOR_INVALID_TIF');
    }
    return tif;
}

function _resolveTriggerBy(triggerBy, defaultValue) {
    if (triggerBy === undefined) return defaultValue;
    if (typeof triggerBy !== 'string' || !_ALLOWED_TRIGGER_BY.has(triggerBy)) {
        throw new Error('BYBIT_TRANSLATOR_INVALID_TRIGGER_BY');
    }
    return triggerBy;
}

function _resolveTpslMode(tpslMode) {
    if (tpslMode === undefined) return 'Full';
    if (typeof tpslMode !== 'string' || !_ALLOWED_TPSL_MODE.has(tpslMode)) {
        throw new Error('BYBIT_TRANSLATOR_INVALID_TPSL_MODE');
    }
    return tpslMode;
}

function _resolveAccountType(accountType) {
    if (accountType === undefined) return 'CONTRACT';
    if (typeof accountType !== 'string' || !_ALLOWED_ACCOUNT_TYPE.has(accountType)) {
        throw new Error('BYBIT_TRANSLATOR_INVALID_ACCOUNT_TYPE');
    }
    return accountType;
}

function _resolveCategory(category) {
    if (category === undefined) return 'linear';
    _validateCategory(category);
    return category;
}

// ── Translators ─────────────────────────────────────────────────────────────

/**
 * Map an internal canonical market entry intent to a Bybit V5 order/create body.
 *
 * @param {object} intent
 * @param {string} intent.symbol         e.g. 'BTCUSDT' (uppercase ASCII alnum)
 * @param {'long'|'short'} intent.side   canonical lowercase
 * @param {number|string} intent.qty     finite > 0
 * @param {string} intent.clientOrderId  ≤36 chars, [a-zA-Z0-9_-]
 * @param {string} [intent.timeInForce]  default 'IOC'
 * @param {'linear'} [intent.category]   default 'linear'
 * @returns {object} Bybit V5 body for POST /v5/order/create
 */
function translateMarketEntryToBybitV5(intent) {
    if (!intent || typeof intent !== 'object') throw new Error('BYBIT_TRANSLATOR_INVALID_SYMBOL');
    const { symbol, side, qty, clientOrderId } = intent;
    _validateSymbol(symbol);
    _validateEntrySide(side);
    _validatePositiveAmount(qty, 'BYBIT_TRANSLATOR_INVALID_QTY');
    _validateClientId(clientOrderId);
    const category = _resolveCategory(intent.category);
    const timeInForce = _resolveTimeInForce(intent.timeInForce);
    return {
        category,
        symbol,
        side: _SIDE_TO_BYBIT[side],
        orderType: 'Market',
        qty: _formatAmount(qty),
        reduceOnly: false,
        timeInForce,
        orderLinkId: clientOrderId,
    };
}

/**
 * Map an internal canonical reduce-only close intent to a Bybit V5
 * order/create body. Uses EXPLICIT positionSide semantics: the caller names
 * the SIDE OF THE POSITION TO CLOSE, not the side of the close order.
 *
 *   positionSide:'long'  → Bybit side:'Sell', reduceOnly:true
 *   positionSide:'short' → Bybit side:'Buy',  reduceOnly:true
 *
 * @param {object} intent
 * @param {string} intent.symbol
 * @param {'long'|'short'} intent.positionSide   side of the position being CLOSED
 * @param {number|string} intent.qty
 * @param {string} intent.clientOrderId
 * @param {string} [intent.timeInForce]          default 'IOC'
 * @param {'linear'} [intent.category]           default 'linear'
 */
function translateReduceOnlyCloseToBybitV5(intent) {
    if (!intent || typeof intent !== 'object') throw new Error('BYBIT_TRANSLATOR_INVALID_POSITION_SIDE');
    const { symbol, positionSide, qty, clientOrderId } = intent;
    _validateSymbol(symbol);
    _validatePositionSide(positionSide);
    _validatePositiveAmount(qty, 'BYBIT_TRANSLATOR_INVALID_QTY');
    _validateClientId(clientOrderId);
    const category = _resolveCategory(intent.category);
    const timeInForce = _resolveTimeInForce(intent.timeInForce);
    return {
        category,
        symbol,
        side: _CLOSE_SIDE_FOR_POSITION[positionSide],
        orderType: 'Market',
        qty: _formatAmount(qty),
        reduceOnly: true,
        timeInForce,
        orderLinkId: clientOrderId,
    };
}

/**
 * Map an internal canonical entry-with-SL/TP intent to a Bybit V5
 * order/create body with stopLoss + takeProfit attached.
 *
 * Bybit V5 attaches SL/TP at order creation; no separate algo endpoints
 * (unlike Binance which uses /fapi/v1/algoOrder for STOP_MARKET / TP_MARKET).
 *
 * @param {object} intent
 * @param {string} intent.symbol
 * @param {'long'|'short'} intent.side
 * @param {number|string} intent.qty
 * @param {string} intent.clientOrderId
 * @param {number|string} intent.stopLoss        finite > 0
 * @param {number|string} intent.takeProfit      finite > 0
 * @param {string} [intent.slTriggerBy]          default 'LastPrice'
 * @param {string} [intent.tpTriggerBy]          default 'LastPrice'
 * @param {'Full'|'Partial'} [intent.tpslMode]   default 'Full'
 * @param {string} [intent.timeInForce]          default 'IOC'
 * @param {'linear'} [intent.category]           default 'linear'
 */
function translateMarketEntryWithSLTPToBybitV5(intent) {
    if (!intent || typeof intent !== 'object') throw new Error('BYBIT_TRANSLATOR_INVALID_SYMBOL');
    const { symbol, side, qty, clientOrderId, stopLoss, takeProfit } = intent;
    _validateSymbol(symbol);
    _validateEntrySide(side);
    _validatePositiveAmount(qty, 'BYBIT_TRANSLATOR_INVALID_QTY');
    _validateClientId(clientOrderId);
    _validatePositiveAmount(stopLoss, 'BYBIT_TRANSLATOR_INVALID_SL');
    _validatePositiveAmount(takeProfit, 'BYBIT_TRANSLATOR_INVALID_TP');
    const category = _resolveCategory(intent.category);
    const timeInForce = _resolveTimeInForce(intent.timeInForce);
    const slTriggerBy = _resolveTriggerBy(intent.slTriggerBy, 'LastPrice');
    const tpTriggerBy = _resolveTriggerBy(intent.tpTriggerBy, 'LastPrice');
    const tpslMode = _resolveTpslMode(intent.tpslMode);
    return {
        category,
        symbol,
        side: _SIDE_TO_BYBIT[side],
        orderType: 'Market',
        qty: _formatAmount(qty),
        reduceOnly: false,
        timeInForce,
        orderLinkId: clientOrderId,
        stopLoss: _formatAmount(stopLoss),
        takeProfit: _formatAmount(takeProfit),
        slTriggerBy,
        tpTriggerBy,
        tpslMode,
    };
}

/**
 * Map a cancel-all intent to a Bybit V5 order/cancel-all body.
 *
 * @param {object} intent
 * @param {string} intent.symbol
 * @param {'linear'} [intent.category]   default 'linear'
 */
function translateCancelAllToBybitV5(intent) {
    if (!intent || typeof intent !== 'object') throw new Error('BYBIT_TRANSLATOR_INVALID_SYMBOL');
    _validateSymbol(intent.symbol);
    const category = _resolveCategory(intent.category);
    return { category, symbol: intent.symbol };
}

/**
 * Map a set-leverage intent to a Bybit V5 position/set-leverage body. Bybit
 * requires symmetric buy/sell leverage in one-way mode; this translator mirrors
 * a single internal `leverage` field into both.
 *
 * @param {object} intent
 * @param {string} intent.symbol
 * @param {number|string} intent.leverage   finite positive integer
 * @param {'linear'} [intent.category]      default 'linear'
 */
function translateSetLeverageToBybitV5(intent) {
    if (!intent || typeof intent !== 'object') throw new Error('BYBIT_TRANSLATOR_INVALID_SYMBOL');
    _validateSymbol(intent.symbol);
    _validateLeverage(intent.leverage);
    const category = _resolveCategory(intent.category);
    const lev = _formatAmount(intent.leverage);
    return {
        category,
        symbol: intent.symbol,
        buyLeverage: lev,
        sellLeverage: lev,
    };
}

/**
 * Map a wallet-balance read request to a Bybit V5 account/wallet-balance query.
 *
 * @param {object} [intent]
 * @param {'CONTRACT'|'UNIFIED'} [intent.accountType]   default 'CONTRACT'
 */
function translateWalletBalanceRequestToBybitV5(intent) {
    const accountType = _resolveAccountType(intent && intent.accountType);
    return { accountType };
}

/**
 * Map a position-list read request to a Bybit V5 position/list query. `symbol`
 * is optional; when omitted the caller will receive every position under the
 * given category.
 *
 * @param {object} [intent]
 * @param {string} [intent.symbol]
 * @param {'linear'} [intent.category]   default 'linear'
 */
function translatePositionListRequestToBybitV5(intent) {
    const category = _resolveCategory(intent && intent.category);
    const out = { category };
    if (intent && intent.symbol !== undefined) {
        _validateSymbol(intent.symbol);
        out.symbol = intent.symbol;
    }
    return out;
}

/**
 * Normalize a raw Bybit V5 response into a safe internal shape. Pure function;
 * does NOT throw on retCode != 0 — the caller decides policy.
 *
 * @param {*} resp
 * @returns {{ok:boolean, code:number, message:string, time:number, result:*}}
 */
function normalizeBybitErrorShape(resp) {
    if (!resp || typeof resp !== 'object') {
        return { ok: false, code: -1, message: 'invalid_response', time: 0, result: null };
    }
    const code = Number.isFinite(resp.retCode) ? resp.retCode : -1;
    return {
        ok: code === 0,
        code,
        message: typeof resp.retMsg === 'string' ? resp.retMsg : '',
        time: Number.isFinite(resp.time) ? resp.time : 0,
        result: resp.result !== undefined ? resp.result : null,
    };
}

module.exports = {
    translateMarketEntryToBybitV5,
    translateReduceOnlyCloseToBybitV5,
    translateMarketEntryWithSLTPToBybitV5,
    translateCancelAllToBybitV5,
    translateSetLeverageToBybitV5,
    translateWalletBalanceRequestToBybitV5,
    translatePositionListRequestToBybitV5,
    normalizeBybitErrorShape,
};
