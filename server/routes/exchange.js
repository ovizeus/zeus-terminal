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
const positionEvents = require('../services/positionEvents');
const exchangeOps = require('../services/exchangeOps');
const { summarizeOpenPositions } = require('./exchangeSwitchHelpers');

// Lazy require to avoid circular import: serverBrain → routes/exchange → serverBrain
function _getServerBrain() {
    return require('../services/serverBrain');
}

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

    // [Phase A / Task A3] Route the signed key-health probe through the gateway so it
    // respects the circuit-breaker / ban state (testnet host now tracked distinctly) —
    // the hourly cron was hammering a banned IP via raw fetch and extending 418 bans.
    const res = await require('../services/binanceGateway').fetch(url, {
        method: 'GET',
        headers: { 'X-MBX-APIKEY': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(10000),
        __weight: 5, __src: 'keyhealth',
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
    // [BYBIT-VERIFY-FIX 2026-05-29] UNIFIED (not CONTRACT) — modern Bybit v5 accounts
    // (incl. testnet) are Unified Trading Accounts; CONTRACT returns an error/empty body
    // for them → res.json() threw "Unexpected end of JSON input" → save 400. Matches
    // the proven bybitOps.getBalance (accountType: 'UNIFIED').
    const queryString = 'accountType=UNIFIED';
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

    // [BYBIT-VERIFY-FIX] Robust parse — a non-JSON / empty Bybit body must surface a
    // clean error, not a raw "Unexpected end of JSON input" thrown by res.json().
    let data;
    try {
        data = await res.json();
    } catch (_) {
        // Bybit returns an empty-body 401 for a rejected key. Make it actionable:
        // the #1 cause is using MAINNET keys in TESTNET mode (Bybit testnet keys are
        // created separately at testnet.bybit.com), or an IP-restricted key.
        if (res.status === 401) {
            throw new Error('Bybit rejected the API key (401). Use TESTNET keys created at testnet.bybit.com (separate from mainnet), with no IP restriction.');
        }
        throw new Error(`Bybit verification failed — HTTP ${res.status} (non-JSON response)`);
    }
    if (!data || data.retCode !== 0) throw new Error((data && data.retMsg) || `Bybit API error (HTTP ${res.status})`);

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
        active: account.is_active === 1,  // [P7.0b] which connected exchange is the active one
        maskedKey,
        lastVerified: account.last_verified_at,
        createdAt: account.created_at,
    };
}

// ─── GET /api/exchange/status — returns all connected exchanges ───
router.get('/status', (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'Not authenticated' });

    // [P7.0b] All connected (verified) exchanges, not just the active one — so the
    // client can show both and offer a one-click Switch to the inactive one.
    const accounts = db.getConnectedExchanges(req.user.id);
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
    // [P7.0a Multi-connect] A DIFFERENT exchange being active no longer BLOCKS this
    // save — Zeus now supports multiple connected exchanges (one active). The new
    // exchange connects as INACTIVE (_makeActive=false); the operator activates it
    // with one-click Switch. The per-exchange env mutex (testnet↔real on the SAME
    // exchange) is KEPT below — fail-closed on a same-exchange env clash.
    let _makeActive = true;
    const _activeRows = db.getAllExchanges(req.user.id) || [];
    for (const _row of _activeRows) {
        if (_row.exchange !== exName) {
            // Another exchange is active → connect this one inactive (no 409).
            _makeActive = false;
            continue;
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
        return res.status(400).json({ ok: false, error: err.message || 'API key verification failed — check your API keys' });
    }

    const encKey = encrypt(cleanKey);
    const encSecret = encrypt(cleanSecret);
    const accountId = db.saveExchangeByName(req.user.id, exName, encKey, encSecret, safeMode, _makeActive);

    db.auditLog(req.user.id, 'EXCHANGE_CONNECTED', { exchange: exName, mode: safeMode, accountId, balance: balanceInfo.balance }, req.ip);
    logger.info('EXCHANGE', `User connected ${exName}`, { userId: req.user.id, mode: safeMode });

    // Invalidate exchange cache so serverBrain reads fresh exchange on next cycle
    try { _getServerBrain()._invalidateUserExchangeCache(req.user.id); } catch (_) { /* best-effort */ }

    // [Phase 12.A — Batch A] Push typed exchange.changed to all live sessions
    // of this user so other tabs / devices reflect the new active exchange +
    // env immediately, without waiting for the next at_update or /status poll.
    // Best-effort: never blocks the response.
    try { req.app.locals.broadcastExchangeChanged(req.user.id); } catch (_) { /* WS push best-effort */ }

    // [Task 50] After successful save for Bybit: fire-and-forget initial recon
    // to detect any pre-existing open positions on the exchange.
    if (exName === 'bybit') {
        setImmediate(async () => {
            try {
                const positions = await exchangeOps.getPositions(req.user.id, {});
                if (positions && positions.length > 0) {
                    db.auditLog(req.user.id, 'INITIAL_RECON_POSITIONS_FOUND', {
                        count: positions.length,
                        positions: positions.map(p => ({ symbol: p.symbol, side: p.side, qty: p.qty })),
                    });
                    logger.info('EXCHANGE', `Initial recon found ${positions.length} existing positions`, { userId: req.user.id });
                }
            } catch (_) { /* best-effort — never block save response */ }
        });
    }

    res.json({
        ok: true,
        verified: true,
        exchange: exName,
        mode: safeMode,
        active: _makeActive,  // [P7a.2] true=first/only (active), false=connected-inactive (Switch activates)
        maskedKey: maskKey(cleanKey),
        balance: balanceInfo.balance,
        availableBalance: balanceInfo.availableBalance,
        lastVerified: new Date().toISOString(),
    });
});

// ─── POST /api/exchange/disconnect — disconnect a specific exchange ───
// [Task 48] Checks DB for open positions before disconnecting → 409 if blocked.
// [Task 49] force=true bypasses block by orphaning open positions first.
router.post('/disconnect', (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'Not authenticated' });

    const { exchange, force } = req.body;
    const exName = SUPPORTED.includes(exchange) ? exchange : null;
    const uid = req.user.id;

    if (!exName) return res.status(400).json({ ok: false, error: 'Exchange invalid' });

    const account = db.getExchangeByName(uid, exName);
    if (!account) return res.status(404).json({ ok: false, error: `No active ${exName} connection` });

    // [Task 48] Query DB for open positions on this exchange (exclude DEMO — not on exchange)
    const rawDb = db.db;
    const openPositions = rawDb.prepare(
        `SELECT seq, data, status, user_id, exchange FROM at_positions
         WHERE user_id = ? AND exchange = ? AND status IN ('OPEN','OPENING','CLOSING')
         AND json_extract(data, '$.mode') != 'demo'`
    ).all(uid, exName);

    if (openPositions.length > 0) {
        if (force !== true) {
            // [Task 48] Block with 409 + positions list
            return res.status(409).json({
                ok: false,
                error: `Cannot disconnect with open positions`,
                positions: openPositions,
            });
        }

        // [Task 49] force=true: orphan all open positions, then proceed
        for (const pos of openPositions) {
            rawDb.prepare(
                `INSERT INTO at_positions_orphaned
                    (original_at_positions_seq, user_id, exchange, data, disconnected_at)
                 VALUES (?, ?, ?, ?, ?)`
            ).run(pos.seq, uid, exName, pos.data || '{}', Date.now());

            rawDb.prepare(`DELETE FROM at_positions WHERE seq = ?`).run(pos.seq);

            try {
                positionEvents.append({
                    position_seq: pos.seq,
                    user_id: uid,
                    exchange: exName,
                    event_type: 'ORPHANED_BY_DISCONNECT',
                    payload: { forced: true, status: pos.status },
                });
            } catch (_) { /* best-effort — position_events may not be in all test envs */ }
        }

        db.auditLog(uid, 'EXCHANGE_POSITIONS_ORPHANED', {
            exchange: exName, count: openPositions.length, forced: true,
        }, req.ip);
        logger.info('EXCHANGE', `Orphaned ${openPositions.length} positions on forced disconnect`, { userId: uid });
    }

    db.disconnectExchangeByName(uid, exName);
    db.auditLog(uid, 'EXCHANGE_DISCONNECTED', { exchange: exName }, req.ip);
    logger.info('EXCHANGE', `User disconnected ${exName}`, { userId: uid });

    // Invalidate exchange cache so serverBrain reads fresh state on next cycle
    try { _getServerBrain()._invalidateUserExchangeCache(uid); } catch (_) { /* best-effort */ }

    // [Phase 12.A — Batch A] Push typed exchange.changed so other sessions
    // see the disconnect (executionEnv flips to null with blockedReason).
    try { req.app.locals.broadcastExchangeChanged(uid); } catch (_) { /* WS push best-effort */ }

    res.json({ ok: true, orphaned: openPositions.length });
});

// ─── POST /api/exchange/verify — re-verify a specific exchange ───
router.post('/verify', async (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'Not authenticated' });

    const { exchange } = req.body;
    const exName = SUPPORTED.includes(exchange) ? exchange : null;
    if (!exName) return res.status(400).json({ ok: false, error: 'Exchange invalid' });

    const account = db.getExchangeByName(req.user.id, exName);
    if (!account) return res.status(404).json({ ok: false, error: `No active ${exName} connection` });

    let plainKey, plainSecret;
    try {
        plainKey = decrypt(account.api_key_encrypted);
        plainSecret = decrypt(account.api_secret_encrypted);
    } catch (_) {
        return res.status(500).json({ ok: false, error: 'Decryption failed — reconnect exchange in Settings' });
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
        res.status(400).json({ ok: false, error: err.message || 'Re-verification failed — check your API keys' });
    }
});

// ─── POST /api/exchange/switch — switch active exchange ───
// Spec: Phase 6 Task 36
// Flow:
//   1. Validate targetExchange (binance|bybit) → 400 on missing/invalid
//   2. Read current active exchange from exchange_accounts
//   3. No-op if target === current → 200 { noOp: true }
//   4.  [P3 + P2c.6] Summarize open positions on previous exchange(s) — NON-blocking
//       (P3-REGATE gate lifted; cross-exchange safety family complete)
//   5.  Audit EXCHANGE_SWITCH_REQUESTED (with summary)
//   6.  Call serverBrain._markPendingSwitch(uid, from, to)
//   7.  Toggle is_active flags in exchange_accounts (old row kept, is_active=0)
//   8.  Return 200 { ok: true, from, to, openPositionsOnPrevious, message }
router.post('/switch', (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'Not authenticated' });

    const { targetExchange } = req.body;

    // Step 1: Validate
    if (!targetExchange || typeof targetExchange !== 'string')
        return res.status(400).json({ ok: false, error: 'targetExchange is required' });
    if (!SUPPORTED.includes(targetExchange))
        return res.status(400).json({ ok: false, error: `targetExchange must be one of: ${SUPPORTED.join(', ')}` });

    const uid = req.user.id;
    const rawDb = db.db;

    // Step 2: Read current active exchange
    const currentRow = rawDb.prepare(
        `SELECT exchange FROM exchange_accounts WHERE user_id = ? AND is_active = 1 LIMIT 1`
    ).get(uid);
    const currentExchange = currentRow ? currentRow.exchange : null;

    // Step 3: No-op if target === current
    if (currentExchange === targetExchange) {
        return res.json({ ok: true, noOp: true, exchange: targetExchange });
    }

    // Step 3.5: Verify target exchange has saved credentials
    const targetAccount = rawDb.prepare(
        `SELECT id FROM exchange_accounts WHERE user_id = ? AND exchange = ? LIMIT 1`
    ).get(uid, targetExchange);
    if (!targetAccount) {
        return res.status(400).json({
            ok: false,
            code: 'NO_TARGET_CREDENTIALS',
            error: `Cannot switch to ${targetExchange}: no saved API credentials. Add ${targetExchange} credentials first.`,
        });
    }

    // Step 4: [Multi-exchange switch P3 + P2c.6] Summarize open positions on the
    // previous exchange(s) — NON-BLOCKING. The P3-REGATE 409 gate is LIFTED: the
    // cross-exchange safety family is complete — reconciliation (P2c.1b), driftChecker
    // (P2c.2), recoveryBoot (P2c.3), orderSweeper (P2c.4) and SL-placement (P2c.5) are
    // all per-exchange, and manual close routes by pos.exchange (P2a/P2b). So an open
    // position stays DSL-managed on its OWN exchange after a switch. The summary is
    // returned so the client can confirm/label "BINANCE has N open positions — they
    // stay managed on Binance; new orders go to <target>". Source of truth for venue
    // is the persisted entry (data.exchange); fall back to the column then 'binance'.
    const openRows = rawDb.prepare(
        `SELECT COALESCE(json_extract(data, '$.exchange'), exchange, 'binance') AS exchange
         FROM at_positions WHERE user_id = ? AND status IN ('OPEN','OPENING','CLOSING')
         AND json_extract(data, '$.mode') != 'demo'`
    ).all(uid);
    const openPositionsOnPrevious = summarizeOpenPositions(openRows);

    // Step 5: Audit EXCHANGE_SWITCH_REQUESTED (include managed-position summary)
    rawDb.prepare(
        `INSERT INTO audit_log (user_id, action, details, created_at) VALUES (?, 'EXCHANGE_SWITCH_REQUESTED', ?, datetime('now'))`
    ).run(uid, JSON.stringify({ from: currentExchange, to: targetExchange, openPositionsOnPrevious }));

    // Step 6: Invoke serverBrain._markPendingSwitch (explicit barrier per spec pillar 7)
    try {
        _getServerBrain()._markPendingSwitch(uid, currentExchange, targetExchange);
    } catch (err) {
        logger.warn('EXCHANGE', `_markPendingSwitch failed uid=${uid}: ${err && err.message}`);
    }

    // Step 7: Toggle is_active flags in exchange_accounts
    // Deactivate current (if exists)
    if (currentExchange) {
        rawDb.prepare(
            `UPDATE exchange_accounts SET is_active = 0 WHERE user_id = ? AND exchange = ?`
        ).run(uid, currentExchange);
    }
    // Activate target if row exists, otherwise leave for _applyPendingSwitches
    rawDb.prepare(
        `UPDATE exchange_accounts SET is_active = 1 WHERE user_id = ? AND exchange = ?`
    ).run(uid, targetExchange);

    // Best-effort WS broadcast
    try { req.app.locals.broadcastExchangeChanged(uid); } catch (_) { /* WS push best-effort */ }

    logger.info('EXCHANGE', `User switched ${currentExchange} → ${targetExchange}`, { userId: uid });

    return res.json({
        ok: true,
        from: currentExchange,
        to: targetExchange,
        openPositionsOnPrevious,  // [P3] [{exchange,count}] — stay DSL-managed on their own exchange
        message: 'switch will apply at next brain cycle',
    });
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
                            `⚠️ Zeus: ${acc.exchange.toUpperCase()} (${acc.mode}) API keys failed daily verification. Check your exchange API keys — they may be revoked or expired.`);
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
