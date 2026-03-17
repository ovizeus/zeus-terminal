// Zeus Terminal — Exchange Connection Routes
// Per-user API key management: save, verify, disconnect, status
'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../services/database');
const { encrypt, decrypt, maskKey } = require('../services/encryption');

// ─── Helpers ───

// Test Binance credentials by calling account endpoint
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
        headers: {
            'X-MBX-APIKEY': apiKey,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();
    if (!res.ok) {
        const msg = data.msg || data.message || 'Unknown Binance error';
        throw new Error(msg);
    }

    // Find USDT balance as a connection proof
    const usdt = data.find(a => a.asset === 'USDT') || {};
    return {
        balance: parseFloat(usdt.balance || 0),
        availableBalance: parseFloat(usdt.availableBalance || 0),
    };
}

// ─── GET /api/exchange/status — check user's exchange connection ───
router.get('/status', (req, res) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ ok: false, error: 'Not authenticated' });
    }

    const account = db.getExchangeAccount(req.user.id);
    if (!account) {
        return res.json({ ok: true, connected: false });
    }

    // Decrypt key just to get masked version
    let maskedKey = '******';
    try {
        const plainKey = decrypt(account.api_key_encrypted);
        maskedKey = maskKey(plainKey);
    } catch (_) { }

    res.json({
        ok: true,
        connected: true,
        exchange: account.exchange,
        mode: account.mode,
        status: account.status,
        maskedKey,
        lastVerified: account.last_verified_at,
        createdAt: account.created_at,
    });
});

// ─── POST /api/exchange/save — verify + encrypt + save API keys ───
router.post('/save', async (req, res) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ ok: false, error: 'Not authenticated' });
    }

    const { apiKey, apiSecret, mode } = req.body;

    // Validate inputs
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
        return res.status(400).json({ ok: false, error: 'API Key invalid — minim 10 caractere' });
    }
    if (!apiSecret || typeof apiSecret !== 'string' || apiSecret.trim().length < 10) {
        return res.status(400).json({ ok: false, error: 'Secret Key invalid — minim 10 caractere' });
    }
    const safeMode = (mode === 'testnet') ? 'testnet' : 'live';
    const cleanKey = apiKey.trim();
    const cleanSecret = apiSecret.trim();

    // Step 1: Test credentials on Binance
    let balanceInfo;
    try {
        balanceInfo = await _testBinanceKeys(cleanKey, cleanSecret, safeMode);
    } catch (err) {
        db.auditLog(req.user.id, 'EXCHANGE_VERIFY_FAILED', { exchange: 'binance', mode: safeMode, error: err.message }, req.ip);
        return res.status(400).json({ ok: false, error: 'Verificare eșuată: ' + err.message });
    }

    // Step 2: Encrypt keys
    const encKey = encrypt(cleanKey);
    const encSecret = encrypt(cleanSecret);

    // Step 3: Save to DB
    const accountId = db.saveExchangeAccount(req.user.id, 'binance', encKey, encSecret, safeMode);

    // Step 4: Audit
    db.auditLog(req.user.id, 'EXCHANGE_CONNECTED', {
        exchange: 'binance',
        mode: safeMode,
        accountId,
        balance: balanceInfo.balance,
    }, req.ip);

    console.log(`[EXCHANGE] User ${req.user.email} connected Binance (${safeMode}) — balance: ${balanceInfo.balance} USDT`);

    res.json({
        ok: true,
        exchange: 'binance',
        mode: safeMode,
        maskedKey: maskKey(cleanKey),
        balance: balanceInfo.balance,
        availableBalance: balanceInfo.availableBalance,
        lastVerified: new Date().toISOString(),
    });
});

// ─── POST /api/exchange/disconnect — revoke exchange connection ───
router.post('/disconnect', (req, res) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ ok: false, error: 'Not authenticated' });
    }

    const account = db.getExchangeAccount(req.user.id);
    if (!account) {
        return res.status(404).json({ ok: false, error: 'Nicio conexiune exchange activă' });
    }

    db.disconnectExchange(req.user.id);
    db.auditLog(req.user.id, 'EXCHANGE_DISCONNECTED', { exchange: account.exchange }, req.ip);

    console.log(`[EXCHANGE] User ${req.user.email} disconnected exchange`);
    res.json({ ok: true });
});

// ─── POST /api/exchange/verify — re-verify existing connection ───
router.post('/verify', async (req, res) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ ok: false, error: 'Not authenticated' });
    }

    const account = db.getExchangeAccount(req.user.id);
    if (!account) {
        return res.status(404).json({ ok: false, error: 'Nicio conexiune exchange activă' });
    }

    let plainKey, plainSecret;
    try {
        plainKey = decrypt(account.api_key_encrypted);
        plainSecret = decrypt(account.api_secret_encrypted);
    } catch (err) {
        return res.status(500).json({ ok: false, error: 'Eroare la decriptare — reconectează exchange' });
    }

    try {
        const balanceInfo = await _testBinanceKeys(plainKey, plainSecret, account.mode);
        // Update last verified
        db.saveExchangeAccount(req.user.id, account.exchange,
            account.api_key_encrypted, account.api_secret_encrypted, account.mode);
        db.auditLog(req.user.id, 'EXCHANGE_REVERIFIED', { exchange: account.exchange, balance: balanceInfo.balance }, req.ip);

        res.json({
            ok: true,
            exchange: account.exchange,
            mode: account.mode,
            maskedKey: maskKey(plainKey),
            balance: balanceInfo.balance,
            availableBalance: balanceInfo.availableBalance,
            lastVerified: new Date().toISOString(),
        });
    } catch (err) {
        db.auditLog(req.user.id, 'EXCHANGE_VERIFY_FAILED', { exchange: account.exchange, error: err.message }, req.ip);
        res.status(400).json({ ok: false, error: 'Reverificare eșuată: ' + err.message });
    }
});

module.exports = router;
