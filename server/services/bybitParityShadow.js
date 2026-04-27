// Zeus Terminal — Bybit Shadow Parity Service (S4-B4)
// Pure dormant service that produces a sanitized parity record for a single
// canonical intent. Intended consumer: tests/probe-s4-b4.js (and, in a future
// S4-B5+ batch, a shadow logger gated by BYBIT_PARITY_ENABLED=false).
//
// HARD CONTRACT:
//   - No HTTP / fetch / axios / http / https / node-fetch.
//   - No DB, no audit, no env reads, no real credential access.
//   - No imports of database / serverAT / serverBrain / serverDSL /
//     binanceSigner / audit / any file under routes.
//   - No Date.now(), no Math.random(). Caller must supply
//     opts.timestamp + opts.recvWindow (deterministic input → output).
//   - Returned record contains NO apiSecret, NO apiKey, NO raw signature,
//     NO header values (only header names). Body / query are stored raw
//     because Bybit V5 body / query do not contain secret bytes.
//   - The record is frozen (Object.freeze) so callers cannot mutate it.
'use strict';

const crypto = require('crypto');
const sgn = require('./bybitSigner');
const tx = require('./bybitOrderTranslator');

// ── Intent dispatch (frozen so the surface is statically auditable) ─────────

const _DISPATCH = Object.freeze({
    marketEntry: {
        method: 'POST',
        path: '/v5/order/create',
        translate: tx.translateMarketEntryToBybitV5,
        project: (body) => ({
            side: body.side,
            reduceOnly: body.reduceOnly,
            orderType: body.orderType,
            qty: body.qty,
            orderLinkId: body.orderLinkId,
        }),
    },
    reduceOnlyClose: {
        method: 'POST',
        path: '/v5/order/create',
        translate: tx.translateReduceOnlyCloseToBybitV5,
        project: (body) => ({
            side: body.side,
            reduceOnly: body.reduceOnly,
            orderType: body.orderType,
            qty: body.qty,
            orderLinkId: body.orderLinkId,
        }),
    },
    entryWithSLTP: {
        method: 'POST',
        path: '/v5/order/create',
        translate: tx.translateMarketEntryWithSLTPToBybitV5,
        project: (body) => ({
            side: body.side,
            reduceOnly: body.reduceOnly,
            orderType: body.orderType,
            qty: body.qty,
            orderLinkId: body.orderLinkId,
            stopLoss: body.stopLoss,
            takeProfit: body.takeProfit,
            slTriggerBy: body.slTriggerBy,
            tpTriggerBy: body.tpTriggerBy,
            tpslMode: body.tpslMode,
        }),
    },
    cancelAll: {
        method: 'POST',
        path: '/v5/order/cancel-all',
        translate: tx.translateCancelAllToBybitV5,
        project: (_body) => ({}),
    },
    setLeverage: {
        method: 'POST',
        path: '/v5/position/set-leverage',
        translate: tx.translateSetLeverageToBybitV5,
        project: (body) => ({
            buyLeverage: body.buyLeverage,
            sellLeverage: body.sellLeverage,
        }),
    },
    walletBalance: {
        method: 'GET',
        path: '/v5/account/wallet-balance',
        translate: tx.translateWalletBalanceRequestToBybitV5,
        project: (body) => ({
            accountType: body.accountType,
        }),
    },
    positionList: {
        method: 'GET',
        path: '/v5/position/list',
        translate: tx.translatePositionListRequestToBybitV5,
        project: (_body) => ({}),
    },
});

const SUPPORTED_INTENT_TYPES = Object.freeze(Object.keys(_DISPATCH).sort());

// ── Helpers ─────────────────────────────────────────────────────────────────

function _sha256Hex(input) {
    return crypto.createHash('sha256').update(input || '').digest('hex');
}

function _validateOpts(opts) {
    if (!opts || typeof opts !== 'object') {
        throw new Error('BYBIT_PARITY_OPTS_REQUIRED');
    }
    if (!Number.isFinite(opts.timestamp)) {
        throw new Error('BYBIT_PARITY_TIMESTAMP_REQUIRED');
    }
    if (!Number.isFinite(opts.recvWindow)) {
        throw new Error('BYBIT_PARITY_RECV_WINDOW_REQUIRED');
    }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a sanitized Bybit parity record for the given canonical intent.
 *
 * Routes the intent through bybitOrderTranslator.translate*ToBybitV5(...)
 * and bybitSigner.buildSignedRequestDryRun(...), then strips all secret-
 * adjacent bytes from the resulting descriptor before returning a frozen
 * in-memory record.
 *
 * Sanitization rules baked into the returned shape:
 *   - apiSecret: never stored.
 *   - apiKey: never stored.
 *   - X-BAPI-SIGN value: never stored. Only `hasSignature` + `signatureLength`.
 *   - Header values: never stored. Only sorted `headerNames`.
 *   - body / query: stored raw — Bybit V5 body / query contain order data
 *     only, no secret bytes. payloadHash = sha256(body || query) for compact
 *     downstream comparison.
 *
 * @param {string} intentType            one of SUPPORTED_INTENT_TYPES
 * @param {object} intent                canonical intent object (see translator)
 * @param {object} creds                 { apiKey, apiSecret, baseUrl }
 * @param {object} opts                  { timestamp, recvWindow }  — both required
 * @returns {object}                     frozen sanitized parity record
 */
function buildBybitParityRecord(intentType, intent, creds, opts) {
    if (typeof intentType !== 'string' ||
        !Object.prototype.hasOwnProperty.call(_DISPATCH, intentType)) {
        throw new Error('BYBIT_PARITY_INVALID_INTENT_TYPE');
    }
    _validateOpts(opts);

    const dispatch = _DISPATCH[intentType];
    // Translator validates the intent fields and throws BYBIT_TRANSLATOR_*
    // on invalid input. We let those errors propagate unchanged.
    const translated = dispatch.translate(intent);

    // Signer validates creds and the BYBIT_DRY_RUN_ONLY gate (S4-B1.1).
    // Throws BYBIT_DRY_RUN_ONLY_REQUIRED if the gate is not set; that
    // error too is allowed to surface verbatim.
    const desc = sgn.buildSignedRequestDryRun(
        dispatch.method, dispatch.path, translated, creds, opts);

    // Defence in depth: if the signer ever returns a non-dry-run descriptor,
    // refuse to build a record. This should be statically impossible because
    // bybitSigner only exports the dry-run function — but the assertion is
    // cheap and protects against future signer drift.
    if (desc.dryRun !== true) {
        throw new Error('BYBIT_PARITY_NON_DRY_RUN_DESCRIPTOR');
    }

    const headers = (desc.headers && typeof desc.headers === 'object') ? desc.headers : {};
    const sigValue = headers['X-BAPI-SIGN'];
    const headerNames = Object.keys(headers).sort();

    const payload = (desc.method === 'GET' || desc.method === 'DELETE')
        ? desc.query : desc.body;
    const payloadHash = _sha256Hex(payload);

    const record = Object.assign({
        ok: true,
        exchange: 'bybit',
        mode: 'dry-run',
        intentType,
        method: desc.method,
        path: desc.path,
        url: desc.url,
        baseUrl: creds && creds.baseUrl,
        category: translated.category || null,
        symbol: translated.symbol || null,
    }, dispatch.project(translated), {
        query: desc.query,
        body: desc.body,
        payloadHash,
        headerNames,
        hasSignature: typeof sigValue === 'string' && sigValue.length > 0,
        signatureLength: typeof sigValue === 'string' ? sigValue.length : 0,
        timestamp: desc.timestamp,
        recvWindow: desc.recvWindow,
        dryRun: true,
        secretLeak: false,
        warnings: Object.freeze([]),
    });

    return Object.freeze(record);
}

module.exports = {
    buildBybitParityRecord,
    SUPPORTED_INTENT_TYPES,
};
