// Zeus Terminal — Server Config
// Loads .env, then applies persisted overrides from data/config_overrides.json
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const OVERRIDES_FILE = path.join(__dirname, '..', 'data', 'config_overrides.json');

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET,
  binance: {
    apiKey: process.env.BINANCE_API_KEY || '',
    apiSecret: process.env.BINANCE_API_SECRET || '',
    baseUrl: process.env.BINANCE_BASE_URL || 'https://testnet.binancefuture.com',
  },
  risk: {
    maxLeverage: parseInt(process.env.MAX_LEVERAGE, 10) || 10,
    maxPositionUsdt: parseFloat(process.env.MAX_POSITION_USDT) || 100,
    dailyLossLimitPct: parseFloat(process.env.DAILY_LOSS_LIMIT_PCT) || 5,
  },
  tradingEnabled: process.env.TRADING_ENABLED === 'true',
  tradingToken: process.env.TRADING_TOKEN || '',
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
  allowedIps: process.env.ALLOWED_IPS ? process.env.ALLOWED_IPS.split(',').map(s => s.trim()).filter(Boolean) : [],
  port: parseInt(process.env.PORT, 10) || 3000,
};

// Apply persisted overrides (from POST /api/config)
try {
  if (fs.existsSync(OVERRIDES_FILE)) {
    const ov = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));
    if (ov.risk) {
      if (typeof ov.risk.maxLeverage === 'number') config.risk.maxLeverage = ov.risk.maxLeverage;
      if (typeof ov.risk.maxPositionUsdt === 'number') config.risk.maxPositionUsdt = ov.risk.maxPositionUsdt;
      if (typeof ov.risk.dailyLossLimitPct === 'number') config.risk.dailyLossLimitPct = ov.risk.dailyLossLimitPct;
    }
    console.log('[CONFIG] Loaded persisted overrides:', JSON.stringify(ov.risk));
  }
} catch (_) { }

/** Save current risk config to disk so it survives restarts. */
config.saveOverrides = function () {
  try {
    const dir = path.dirname(OVERRIDES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = OVERRIDES_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ risk: config.risk }, null, 2));
    fs.renameSync(tmp, OVERRIDES_FILE);
  } catch (err) {
    console.error('[CONFIG] Failed to persist overrides:', err.message);
  }
};

// ── Fail fast if critical secrets are missing ──
const _required = ['JWT_SECRET', 'ENCRYPTION_KEY'];
for (const v of _required) {
  if (!process.env[v]) {
    console.error(`[CONFIG] FATAL: Missing required env var ${v} — server cannot start safely`);
    process.exit(1);
  }
}

// Warn if API keys not configured
if (!config.binance.apiKey || !config.binance.apiSecret) {
  console.warn('[CONFIG] ⚠ BINANCE_API_KEY or BINANCE_API_SECRET not set — trading will fail');
}

module.exports = config;
