'use strict';

describe('exchangeAdapter', () => {
  const ea = require('../../server/services/exchangeAdapter');

  // normalize: exchange symbol → canonical
  test('binance BTCUSDT → BTC-USDT-PERP', () => {
    expect(ea.normalize('BTCUSDT', 'binance')).toBe('BTC-USDT-PERP');
  });

  test('binance ETHUSDT → ETH-USDT-PERP', () => {
    expect(ea.normalize('ETHUSDT', 'binance')).toBe('ETH-USDT-PERP');
  });

  test('bybit SOLUSDT → SOL-USDT-PERP', () => {
    expect(ea.normalize('SOLUSDT', 'bybit')).toBe('SOL-USDT-PERP');
  });

  test('okx BTC-USDT-SWAP → BTC-USDT-PERP', () => {
    expect(ea.normalize('BTC-USDT-SWAP', 'okx')).toBe('BTC-USDT-PERP');
  });

  test('bitget BTCUSDT_UMCBL → BTC-USDT-PERP', () => {
    expect(ea.normalize('BTCUSDT_UMCBL', 'bitget')).toBe('BTC-USDT-PERP');
  });

  test('mexc BTC_USDT → BTC-USDT-PERP', () => {
    expect(ea.normalize('BTC_USDT', 'mexc')).toBe('BTC-USDT-PERP');
  });

  test('hyperliquid BTC → BTC-USDT-PERP', () => {
    expect(ea.normalize('BTC', 'hyperliquid')).toBe('BTC-USDT-PERP');
  });

  // denormalize: canonical → exchange symbol
  test('denormalize BTC-USDT-PERP → binance BTCUSDT', () => {
    expect(ea.denormalize('BTC-USDT-PERP', 'binance')).toBe('BTCUSDT');
  });

  test('denormalize BTC-USDT-PERP → okx BTC-USDT-SWAP', () => {
    expect(ea.denormalize('BTC-USDT-PERP', 'okx')).toBe('BTC-USDT-SWAP');
  });

  test('denormalize BTC-USDT-PERP → bitget BTCUSDT_UMCBL', () => {
    expect(ea.denormalize('BTC-USDT-PERP', 'bitget')).toBe('BTCUSDT_UMCBL');
  });

  test('denormalize BTC-USDT-PERP → hyperliquid BTC', () => {
    expect(ea.denormalize('BTC-USDT-PERP', 'hyperliquid')).toBe('BTC');
  });

  // roundtrip: normalize → denormalize = original
  test('roundtrip binance BTCUSDT', () => {
    const canonical = ea.normalize('BTCUSDT', 'binance');
    expect(ea.denormalize(canonical, 'binance')).toBe('BTCUSDT');
  });

  test('roundtrip bybit ETHUSDT', () => {
    const canonical = ea.normalize('ETHUSDT', 'bybit');
    expect(ea.denormalize(canonical, 'bybit')).toBe('ETHUSDT');
  });

  // capabilities
  test('capabilities binance returns weight pool', () => {
    const caps = ea.capabilities('binance');
    expect(caps.hasWS).toBe(true);
    expect(caps.weightPool.futures).toBe(2400);
  });

  test('capabilities bybit returns v5 pool', () => {
    const caps = ea.capabilities('bybit');
    expect(caps.hasWS).toBe(true);
    expect(caps.weightPool.v5).toBe(120);
  });

  test('capabilities unknown returns null', () => {
    expect(ea.capabilities('fake_exchange')).toBeNull();
  });

  // edge cases
  test('normalize null/empty returns null', () => {
    expect(ea.normalize(null, 'binance')).toBeNull();
    expect(ea.normalize('', 'binance')).toBeNull();
    expect(ea.normalize('BTCUSDT', null)).toBeNull();
  });

  test('normalize unknown exchange returns null', () => {
    expect(ea.normalize('BTCUSDT', 'fake')).toBeNull();
  });

  test('normalize invalid symbol returns null', () => {
    expect(ea.normalize('INVALID', 'binance')).toBeNull();
  });

  // listExchanges
  test('listExchanges returns all 7', () => {
    const list = ea.listExchanges();
    expect(list.length).toBe(7);
    expect(list).toContain('binance');
    expect(list).toContain('bybit');
    expect(list).toContain('okx');
  });

  // isSupported
  test('isSupported true for binance', () => {
    expect(ea.isSupported('binance')).toBe(true);
  });

  test('isSupported false for unknown', () => {
    expect(ea.isSupported('fake')).toBe(false);
  });
});
