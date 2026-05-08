// Zeus Terminal — Exchange Connection Routes
// Multi-exchange: Binance Futures + Bybit Derivatives (simultaneous)
'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../services/database');
const { encrypt, decrypt, maskKey } = require('../services/encryption');
const logger = require('../services/logger');
const serverAT = require('../services/serverAT');

const SUPPORTED = ['binance', 'bybit'];

// ─── Binance Futures key verification ───
async function _testBinanceKeys(apiKey, apiSecret, mode) {
    const baseUrl = mode === 'testnet'
        ? 'https://testnet.binancefuture.com'
        : 'https://fapi.binance.com';

    const timestamp = Date.now();
    const params = `timestamp=${timestamp}&recvWindow=5000`;
    const signature = crypto
        .createHmac('sha256', apiSecret)
        .update(params)
        .digest('hex');

    const url = `${baseUrl}/fapi/v2/balance?${params}&signature=${signature}`;

    const res = await fetch(url, {
        method: 'GET',
        headers: { 'X-MBX-APIKEY': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || data.message || 'Unknown Binance error');

    const usdt = data.find(a => a.asset === 'USDT') || {};
    return {
        balance: parseFloat(usdt.balance || 0),
        availableBalance: parseFloat(usdt.availableBalance || 0),
    };
}

// ─── Bybit Derivatives key verification ───
async function _testBybitKeys(apiKey, apiSecret, mode) {
    const baseUrl = mode === 'testnet'
        ? 'https://api-testnet.bybit.com'
        : 'https://api.bybit.com';

    const timestamp = Date.now();
    const recvWindow = 5000;
    // Bybit v5: sign = HMAC-SHA256(timestamp + apiKey + recvWindow + queryString)
    const queryString = 'accountType=CONTRACT';
    const signPayload = `${timestamp}${apiKey}${recvWindow}${queryString}`;
    const signature = crypto
        .createHmac('sha256', apiSecret)
        .update(signPayload)
        .digest('hex');

    const url = `${baseUrl}/v5/account/wallet-balance?${queryString}`;

    const res = await fetch(url, {
        method: 'GET',
        headers: {
            'X-BAPI-API-KEY': apiKey,
            'X-BAPI-SIGN': signature,
            'X-BAPI-SIGN-TYPE': '2',
            'X-BAPI-TIMESTAMP': String(timestamp),
            'X-BAPI-RECV-WINDOW': String(recvWindow),
        },
        signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();
    if (data.retCode !== 0) throw new Error(data.retMsg || 'Bybit API error');

    const coins = data.result?.list?.[0]?.coin || [];
    const usdt = coins.find(c => c.coin === 'USDT') || {};
    return {
        balance: parseFloat(usdt.walletBalance || 0),
        availableBalance: parseFloat(usdt.availableToWithdraw || 0),
    };
}

async function _testKeys(exchange, apiKey, apiSecret, mode) {
    if (exchange === 'bybit') return _testBybitKeys(apiKey, apiSecret, mode);
    return _testBinanceKeys(apiKey, apiSecret, mode);
}

function _maskAndFormat(account) {
    let maskedKey = '******';
    try { maskedKey = maskKey(decrypt(account.api_key_encrypted)); } catch (_) {}
    return {
        exchange: account.exchange,
        mode: account.mode,
        status: account.status,
        maskedKey,
        lastVerified: account.last_verified_at,
        createdAt: account.created_at,
    };
}

// ─── GET /api/exchange/status — returns all connected exchanges ───
router.get('/status', (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'Not authenticated' });

    const accounts = db.getAllExchanges(req.user.id);
    res.json({
        ok: true,
        accounts: accounts.map(_maskAndFormat),
    });
});

// ─── POST /api/exchange/save — verify + encrypt + save for a specific exchange ───
router.post('/save', async (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'Not authenticated' });

    const { apiKey, apiSecret, mode, exchange } = req.body;
    const exName = SUPPORTED.includes(exchange) ? exchange : 'binance';
    const safeMode = (mode === 'testnet') ? 'testnet' : 'live';

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10)
        return res.status(400).json({ ok: false, error: 'API Key invalid — minim 10 caractere' });
    if (!apiSecret || typeof apiSecret !== 'string' || apiSecret.trim().length < 10)
        return res.status(400).json({ ok: false, error: 'Secret Key invalid — minim 10 caractere' });

    const cleanKey = apiKey.trim();
    const cleanSecret = apiSecret.trim();

    // ─── Phase 1A: single-exchange + single-env per user enforcement ───
    // Reject conflicting save BEFORE external API verify or DB write.
    // Re-verify/update on exact same (exchange, mode) falls through.
    const _activeRows = db.getAllExchanges(req.user.id) || [];
    for (const _row of _activeRows) {
        if (_row.exchange !== exName) {
            const _wantedLabel = exName === 'bybit' ? 'Bybit' : 'Binance';
            const _activeLabel = _row.exchange === 'bybit' ? 'Bybit' : 'Binance';
            const _msg = `${_wantedLabel} is blocked because ${_activeLabel} API credentials are currently active for this account. Zeus allows only one active exchange at a time. To use ${_wantedLabel}, first disconnect the active ${_activeLabel} API credentials, then return and add valid ${_wantedLabel} API credentials.`;
            db.auditLog(req.user.id, 'EXCHANGE_SAVE_BLOCKED', {
                code: 'EXCHANGE_CONFLICT',
                attempted: { exchange: exName, mode: safeMode },
                active: { exchange: _row.exchange, mode: _row.mode },
            }, req.ip);
            return res.status(409).json({
                ok: false,
                code: 'EXCHANGE_CONFLICT',
                message: _msg,
                details: {
                    attempted: { exchange: exName, mode: safeMode },
                    active: { exchange: _row.exchange, mode: _row.mode },
                },
            });
        }
        if (_row.mode !== safeMode) {
            const _wantedEnv = safeMode === 'testnet' ? 'TESTNET' : 'REAL';
            const _activeEnv = _row.mode === 'testnet' ? 'TESTNET' : 'REAL';
            const _msg = `${_wantedEnv} mode is blocked because ${_activeEnv} API credentials are currently active for this exchange. Zeus allows only one active API environment per exchange at a time. To use ${_wantedEnv} mode, first disconnect the active ${_activeEnv} API credentials, then add valid ${_wantedEnv} API credentials.`;
            db.auditLog(req.user.id, 'EXCHANGE_SAVE_BLOCKED', {
                code: 'ENV_CONFLICT',
                attempted: { exchange: exName, mode: safeMode },
                active: { exchange: _row.exchange, mode: _row.mode },
            }, req.ip);
            return res.status(409).json({
                ok: false,
                code: 'ENV_CONFLICT',
                message: _msg,
                details: {
                    attempted: { exchange: exName, mode: safeMode },
                    active: { exchange: _row.exchange, mode: _row.mode },
                },
            });
        }
        // same exchange + same mode → allowed (re-verify/update path)
    }

    let balanceInfo;
    try {
        balanceInfo = await _testKeys(exName, cleanKey, cleanSecret, safeMode);
    } catch (err) {
        db.auditLog(req.user.id, 'EXCHANGE_VERIFY_FAILED', { exchange: exName, mode: safeMode, error: err.message }, req.ip);
        return res.status(400).json({ ok: false, error: err.message || 'API key verification failed — verifică cheile' });
    }

    const encKey = encrypt(cleanKey);
    const encSecret = encrypt(cleanSecret);
    const accountId = db.saveExchangeByName(req.user.id, exName, encKey, encSecret, safeMode);

    db.auditLog(req.user.id, 'EXCHANGE_CONNECTED', { exchange: exName, mode: safeMode, accountId, balance: balanceInfo.balance }, req.ip);
    logger.info('EXCHANGE', `User connected ${exName}`, { userId: req.user.id, mode: safeMode });

    // [Phase 12.A — Batch A] Push typed exchange.changed to all live sessions
    // of this user so other tabs / devices reflect the new active exchange +
    // env immediately, without waiting for the next at_update or /status poll.
    // Best-effort: never blocks the response.
    try { req.app.locals.broadcastExchangeChanged(req.user.id); } catch (_) { /* WS push best-effort */ }

    res.json({
        ok: true,
        exchange: exName,
        mode: safeMode,
        maskedKey: maskKey(cleanKey),
        balance: balanceInfo.balance,
        availableBalance: balanceInfo.availableBalance,
        lastVerified: new Date().toISOString(),
    });
});

// ─── POST /api/exchange/disconnect — disconnect a specific exchange ───
router.post('/disconnect', (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'Not authenticated' });

    const { exchange } = req.body;
    const exName = SUPPORTED.includes(exchange) ? exchange : null;

    if (!exName) return res.status(400).json({ ok: false, error: 'Exchange invalid' });

    const account = db.getExchangeByName(req.user.id, exName);
    if (!account) return res.status(404).json({ ok: false, error: `Nicio conexiune ${exName} activă` });

    // Block if open live positions backed by this exchange
    const livePos = serverAT.getOpenPositions(req.user.id).filter(p => p.mode === 'live' && (p.exchange || 'binance') === exName);
    if (livePos.length > 0)
        return res.json({ ok: false, error: `Nu poți deconecta ${exName}: ${livePos.length} poziții deschise. Închide-le mai întâi.` });

    db.disconnectExchangeByName(req.user.id, exName);
    db.auditLog(req.user.id, 'EXCHANGE_DISCONNECTED', { exchange: exName }, req.ip);
    logger.info('EXCHANGE', `User disconnected ${exName}`, { userId: req.user.id });

    // [Phase 12.A — Batch A] Push typed exchange.changed so other sessions
    // see the disconnect (executionEnv flips to null with blockedReason).
    try { req.app.locals.broadcastExchangeChanged(req.user.id); } catch (_) { /* WS push best-effort */ }

    res.json({ ok: true });
});

// ─── POST /api/exchange/verify — re-verify a specific exchange ───
router.post('/verify', async (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'Not authenticated' });

    const { exchange } = req.body;
    const exName = SUPPORTED.includes(exchange) ? exchange : null;
    if (!exName) return res.status(400).json({ ok: false, error: 'Exchange invalid' });

    const account = db.getExchangeByName(req.user.id, exName);
    if (!account) return res.status(404).json({ ok: false, error: `Nicio conexiune ${exName} activă` });

    let plainKey, plainSecret;
    try {
        plainKey = decrypt(account.api_key_encrypted);
        plainSecret = decrypt(account.api_secret_encrypted);
    } catch (_) {
        return res.status(500).json({ ok: false, error: 'Eroare la decriptare — reconectează exchange' });
    }

    try {
        const balanceInfo = await _testKeys(exName, plainKey, plainSecret, account.mode);
        db.saveExchangeByName(req.user.id, exName, account.api_key_encrypted, account.api_secret_encrypted, account.mode);
        db.auditLog(req.user.id, 'EXCHANGE_REVERIFIED', { exchange: exName, balance: balanceInfo.balance }, req.ip);

        // [Phase 12.A — Batch A] Re-verify can flip apiConfigured/executionEnv
        // (e.g. previously invalid keys now pass). Push so UI reflects truth.
        try { req.app.locals.broadcastExchangeChanged(req.user.id); } catch (_) { /* WS push best-effort */ }

        res.json({
            ok: true,
            exchange: exName,
            mode: account.mode,
            maskedKey: maskKey(plainKey),
            balance: balanceInfo.balance,
            availableBalance: balanceInfo.availableBalance,
            lastVerified: new Date().toISOString(),
        });
    } catch (err) {
        db.auditLog(req.user.id, 'EXCHANGE_VERIFY_FAILED', { exchange: exName, error: err.message }, req.ip);
        res.status(400).json({ ok: false, error: err.message || 'Re-verificare eșuată — verifică cheile' });
    }
});

// ─── [OPS-1] Daily API key health check cron ────────────────────────
// Stale/revoked keys were detected only on first trade failure → user
// surprise pe entry attempt. Cron iterates `db.getAllExchanges(uid)` for
// every user în `listUsers()`, calls _testKeys against the saved decrypted
// secret, and logs/audits/alerts on failure. Daily cadence; day-tracked
// via _lastApiHealthCheckDate so multiple boots/day don't re-run the
// probe (cheap but still respects exchange API rate limits).
let _lastApiHealthCheckDate = '';
async function _runApiKeyHealthCheck() {
    const today = new Date().toISOString().slice(0, 10);
    if (_lastApiHealthCheckDate === today) return;
    _lastApiHealthCheckDate = today;
    let okCount = 0, failCount = 0;
    try {
        const users = db.listUsers() || [];
        for (const u of users) {
            if (!u || !u.id) continue;
            const accounts = db.getAllExchanges(u.id) || [];
            for (const acc of accounts) {
                try {
                    const plainKey = decrypt(acc.api_key_encrypted);
                    const plainSecret = decrypt(acc.api_secret_encrypted);
                    if (!plainKey || !plainSecret) {
                        failCount++;
                        db.auditLog(u.id, 'EXCHANGE_KEY_HEALTH_FAIL',
                            { exchange: acc.exchange, mode: acc.mode, reason: 'decrypt_failed' }, '127.0.0.1');
                        continue;
                    }
                    await _testKeys(acc.exchange, plainKey, plainSecret, acc.mode);
                    okCount++;
                } catch (err) {
                    failCount++;
                    const errMsg = (err && err.message) || 'unknown';
                    db.auditLog(u.id, 'EXCHANGE_KEY_HEALTH_FAIL',
                        { exchange: acc.exchange, mode: acc.mode, error: errMsg }, '127.0.0.1');
                    logger.warn('EXCHANGE', `Key health FAIL uid=${u.id} ${acc.exchange}/${acc.mode}: ${errMsg}`);
                    try {
                        require('../services/telegram').sendToUser(u.id,
                            `⚠️ Zeus: cheile ${acc.exchange.toUpperCase()} (${acc.mode}) au eșuat verificarea zilnică. Verifică cheile pe exchange — pot fi revocate sau expirate.`);
                    } catch (_) { /* Telegram optional */ }
                }
            }
        }
        logger.info('EXCHANGE', `API key health check: ${okCount} OK / ${failCount} FAIL`);
    } catch (err) {
        logger.error('EXCHANGE', 'API key health check cron crashed: ' + (err && err.message));
    }
}
// Boot delay 5min (avoid contention cu other crons + ensure DB ready);
// hourly check after that (day-tracked so the actual probe fires once/day).
setTimeout(() => { _runApiKeyHealthCheck().catch(() => { }); }, 5 * 60 * 1000);
setInterval(() => { _runApiKeyHealthCheck().catch(() => { }); }, 60 * 60 * 1000);

module.exports = router;
