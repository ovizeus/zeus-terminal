'use strict';

// [LAG-FIX 2026-05-31] With ALT_WS_FEEDS=ON (the bookTicker WS lives on the
// Hetzner-blocked fstream.binance.com), price only refreshed from the 30s kline
// poll → stale 20s/30s → operator's "data lag 9s→staled". A fast REST ticker poll
// (~3s) keeps price fresh. _parseTickerPrice is the pure parse step.

const marketFeed = require('../../server/services/marketFeed');

describe('marketFeed._parseTickerPrice', () => {
    it('parses a valid /fapi/v1/ticker/price response to a number', () => {
        expect(marketFeed._parseTickerPrice({ symbol: 'BTCUSDT', price: '73000.5' })).toBe(73000.5);
    });
    it('returns null for zero / negative / missing / malformed price', () => {
        expect(marketFeed._parseTickerPrice({ price: '0' })).toBe(null);
        expect(marketFeed._parseTickerPrice({ price: '-1' })).toBe(null);
        expect(marketFeed._parseTickerPrice({})).toBe(null);
        expect(marketFeed._parseTickerPrice(null)).toBe(null);
        expect(marketFeed._parseTickerPrice({ price: 'abc' })).toBe(null);
    });
});
