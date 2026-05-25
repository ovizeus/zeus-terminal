'use strict';

// ═══════════════════════════════════════════════════════════════════
// Exchange Adapter — symbol normalization + capability registry.
// Multi-exchange aware: Binance + Bybit now, OKX/Bitget/MEXC/HTX/Hyperliquid later.
//
// Canonical internal format: 'BTC-USDT-PERP'
// Each exchange has its own format (BTCUSDT, BTC-USDT-SWAP, etc.)
//
// Cache keys use canonical: 'binance:BTC-USDT-PERP:ticker'
// ═══════════════════════════════════════════════════════════════════

const EXCHANGES = Object.freeze({
    binance: {
        id: 'binance',
        label: 'Binance Futures',
        hasWS: true,
        weightPool: { futures: 2400, spot: 1200 },
        wsEndpoint: 'wss://fstream.binance.com',
        restEndpoint: 'https://fapi.binance.com',
        symbolFormat: 'concat',  // BTCUSDT
    },
    bybit: {
        id: 'bybit',
        label: 'Bybit V5',
        hasWS: true,
        weightPool: { v5: 120 },  // per-second rate, different model
        wsEndpoint: 'wss://stream.bybit.com/v5/public/linear',
        restEndpoint: 'https://api.bybit.com',
        symbolFormat: 'concat',  // BTCUSDT (category: linear)
    },
    okx: {
        id: 'okx',
        label: 'OKX',
        hasWS: true,
        weightPool: {},
        wsEndpoint: 'wss://ws.okx.com:8443/ws/v5/public',
        restEndpoint: 'https://www.okx.com',
        symbolFormat: 'dash-swap',  // BTC-USDT-SWAP
    },
    bitget: {
        id: 'bitget',
        label: 'Bitget',
        hasWS: true,
        weightPool: {},
        restEndpoint: 'https://api.bitget.com',
        symbolFormat: 'umcbl',  // BTCUSDT_UMCBL
    },
    mexc: {
        id: 'mexc',
        label: 'MEXC',
        hasWS: true,
        weightPool: {},
        restEndpoint: 'https://contract.mexc.com',
        symbolFormat: 'underscore',  // BTC_USDT
    },
    htx: {
        id: 'htx',
        label: 'HTX (Huobi)',
        hasWS: true,
        weightPool: {},
        restEndpoint: 'https://api.hbdm.com',
        symbolFormat: 'dash',  // BTC-USDT
    },
    hyperliquid: {
        id: 'hyperliquid',
        label: 'Hyperliquid',
        hasWS: true,
        weightPool: {},
        wsEndpoint: 'wss://api.hyperliquid.xyz/ws',
        restEndpoint: 'https://api.hyperliquid.xyz',
        symbolFormat: 'base-only',  // BTC
    },
});

// Canonical: 'BTC-USDT-PERP' → parts: { base: 'BTC', quote: 'USDT', type: 'PERP' }
function _parseCanonical(canonical) {
    if (!canonical || typeof canonical !== 'string') return null;
    const parts = canonical.split('-');
    if (parts.length < 2) return null;
    return { base: parts[0], quote: parts[1], type: parts[2] || 'PERP' };
}

function normalize(exchangeSymbol, exchange) {
    if (!exchangeSymbol || !exchange) return null;
    const sym = String(exchangeSymbol).toUpperCase().trim();
    const exch = EXCHANGES[exchange];
    if (!exch) return null;

    switch (exch.symbolFormat) {
        case 'concat': {
            // BTCUSDT → BTC-USDT-PERP
            const match = sym.match(/^([A-Z0-9]+)(USDT|BUSD|USDC)$/);
            if (!match) return null;
            return `${match[1]}-${match[2]}-PERP`;
        }
        case 'dash-swap': {
            // BTC-USDT-SWAP → BTC-USDT-PERP
            const parts = sym.split('-');
            if (parts.length < 2) return null;
            return `${parts[0]}-${parts[1]}-PERP`;
        }
        case 'umcbl': {
            // BTCUSDT_UMCBL → BTC-USDT-PERP
            const base = sym.replace(/_UMCBL$/i, '');
            const match = base.match(/^([A-Z0-9]+)(USDT|BUSD|USDC)$/);
            if (!match) return null;
            return `${match[1]}-${match[2]}-PERP`;
        }
        case 'underscore': {
            // BTC_USDT → BTC-USDT-PERP
            const parts = sym.split('_');
            if (parts.length < 2) return null;
            return `${parts[0]}-${parts[1]}-PERP`;
        }
        case 'dash': {
            // BTC-USDT → BTC-USDT-PERP
            const parts = sym.split('-');
            if (parts.length < 2) return null;
            return `${parts[0]}-${parts[1]}-PERP`;
        }
        case 'base-only': {
            // BTC → BTC-USDT-PERP (Hyperliquid only has USDT perps)
            return `${sym}-USDT-PERP`;
        }
        default: return null;
    }
}

function denormalize(canonical, exchange) {
    const parsed = _parseCanonical(canonical);
    if (!parsed) return null;
    const exch = EXCHANGES[exchange];
    if (!exch) return null;

    switch (exch.symbolFormat) {
        case 'concat':      return `${parsed.base}${parsed.quote}`;
        case 'dash-swap':   return `${parsed.base}-${parsed.quote}-SWAP`;
        case 'umcbl':       return `${parsed.base}${parsed.quote}_UMCBL`;
        case 'underscore':  return `${parsed.base}_${parsed.quote}`;
        case 'dash':        return `${parsed.base}-${parsed.quote}`;
        case 'base-only':   return parsed.base;
        default: return null;
    }
}

function capabilities(exchange) {
    const exch = EXCHANGES[exchange];
    if (!exch) return null;
    return {
        id: exch.id,
        label: exch.label,
        hasWS: !!exch.hasWS,
        weightPool: exch.weightPool || {},
        wsEndpoint: exch.wsEndpoint || null,
        restEndpoint: exch.restEndpoint || null,
        symbolFormat: exch.symbolFormat,
    };
}

function canonicalKey(exchange, canonical, dataType) {
    return `${exchange}:${canonical}:${dataType}`;
}

function cacheKey(exchange, exchangeSymbol, dataType) {
    return `${exchange}:${exchangeSymbol}`;
}

function listExchanges() {
    return Object.keys(EXCHANGES);
}

function isSupported(exchange) {
    return !!EXCHANGES[exchange];
}

module.exports = {
    normalize,
    denormalize,
    capabilities,
    canonicalKey,
    cacheKey,
    listExchanges,
    isSupported,
    EXCHANGES,
};
