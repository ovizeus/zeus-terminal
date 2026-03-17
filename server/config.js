// Zeus Terminal — Server Config
// Loads .env and exports validated configuration
'use strict';

require('dotenv').config();

const config = {
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

// Warn if API keys not configured
if (!config.binance.apiKey || !config.binance.apiSecret) {
  console.warn('[CONFIG] ⚠ BINANCE_API_KEY or BINANCE_API_SECRET not set — trading will fail');
}

module.exports = config;
