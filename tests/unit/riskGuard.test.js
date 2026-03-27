/**
 * Zeus Terminal — Unit Tests: riskGuard.js
 * Tests validateOrder(), recordClosedPnL(), setEmergencyKill(), getDailyState()
 */
'use strict';

// ── Mock dependencies BEFORE requiring riskGuard ──
jest.mock('../../server/services/telegram', () => ({
  alertKillSwitch: jest.fn(),
  alertDailyLoss: jest.fn(),
}));
jest.mock('../../server/services/audit', () => ({
  record: jest.fn(),
}));
jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  writeFileSync: jest.fn(),
  renameSync: jest.fn(),
  readFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

// Mock config with test defaults
jest.mock('../../server/config', () => ({
  tradingEnabled: true,
  risk: {
    maxLeverage: 10,
    maxPositionUsdt: 100,
    dailyLossLimitPct: 5,
  },
}));

const config = require('../../server/config');
const telegram = require('../../server/services/telegram');
const { validateOrder, recordClosedPnL, setEmergencyKill, getDailyState } = require('../../server/services/riskGuard');

// ── Helpers ──
const validOrder = (overrides = {}) => ({
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'MARKET',
  quantity: '0.001',
  price: '60000',
  referencePrice: '60000',
  leverage: '5',
  ...overrides,
});

// ══════════════════════════════════════════════════════════════
// validateOrder — core risk validation
// ══════════════════════════════════════════════════════════════
describe('validateOrder', () => {

  beforeEach(() => {
    // Reset config to defaults
    config.tradingEnabled = true;
    config.risk.maxLeverage = 10;
    config.risk.maxPositionUsdt = 100;
    config.risk.dailyLossLimitPct = 5;
    // Clear kill switch
    setEmergencyKill(false, 'test-user-1');
  });

  // ── Happy path ──
  test('valid MARKET order passes', () => {
    const result = validateOrder(validOrder(), 'AT', 'test-user-1');
    expect(result.ok).toBe(true);
  });

  test('valid LIMIT order passes', () => {
    const result = validateOrder(validOrder({ type: 'LIMIT' }), 'AT', 'test-user-1');
    expect(result.ok).toBe(true);
  });

  test('STOP_MARKET skips notional check', () => {
    const result = validateOrder(validOrder({ type: 'STOP_MARKET', quantity: '999' }), 'AT', 'test-user-1');
    expect(result.ok).toBe(true);
  });

  test('TP_MARKET skips notional check', () => {
    const result = validateOrder(validOrder({ type: 'TP_MARKET' }), 'AT', 'test-user-1');
    expect(result.ok).toBe(true);
  });

  // ── Emergency kill ──
  test('emergency kill blocks order', () => {
    setEmergencyKill(true, 'test-user-2');
    const result = validateOrder(validOrder(), 'AT', 'test-user-2');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/kill/i);
  });

  test('emergency kill is per-user', () => {
    setEmergencyKill(true, 'test-user-3');
    const other = validateOrder(validOrder(), 'AT', 'test-user-4');
    expect(other.ok).toBe(true);
  });

  // ── Trading disabled ──
  test('trading disabled blocks order', () => {
    config.tradingEnabled = false;
    const result = validateOrder(validOrder(), 'AT', 'test-user-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/disabled/i);
  });

  // ── Leverage ──
  test('leverage exceeding max is blocked', () => {
    const result = validateOrder(validOrder({ leverage: '200' }), 'AT', 'test-user-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/leverage/i);
  });

  test('leverage=0 is blocked', () => {
    const result = validateOrder(validOrder({ leverage: '0' }), 'AT', 'test-user-1');
    expect(result.ok).toBe(false);
  });

  test('leverage=-1 is blocked', () => {
    const result = validateOrder(validOrder({ leverage: '-1' }), 'AT', 'test-user-1');
    expect(result.ok).toBe(false);
  });

  test('NaN leverage "abc" is blocked (RM-04)', () => {
    const result = validateOrder(validOrder({ leverage: 'abc' }), 'AT', 'test-user-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/invalid/i);
  });

  test('undefined leverage is blocked', () => {
    const result = validateOrder(validOrder({ leverage: undefined }), 'AT', 'test-user-1');
    expect(result.ok).toBe(false);
  });

  // ── Quantity ──
  test('NaN quantity "xyz" is blocked (RM-03)', () => {
    const result = validateOrder(validOrder({ quantity: 'xyz' }), 'AT', 'test-user-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/quantity/i);
  });

  test('zero quantity is blocked', () => {
    const result = validateOrder(validOrder({ quantity: '0' }), 'AT', 'test-user-1');
    expect(result.ok).toBe(false);
  });

  test('negative quantity is blocked', () => {
    const result = validateOrder(validOrder({ quantity: '-1' }), 'AT', 'test-user-1');
    expect(result.ok).toBe(false);
  });

  // ── Price ──
  test('zero price is blocked', () => {
    const result = validateOrder(validOrder({ price: '0', referencePrice: '0' }), 'AT', 'test-user-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/price/i);
  });

  test('NaN price is blocked', () => {
    const result = validateOrder(validOrder({ price: 'notanumber' }), 'AT', 'test-user-1');
    expect(result.ok).toBe(false);
  });

  // ── Notional (position size) ──
  test('notional exceeding max is blocked', () => {
    // qty=0.01 * price=60000 = $600 > $100 max
    const result = validateOrder(validOrder({ quantity: '0.01', price: '60000' }), 'AT', 'test-user-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/position size/i);
  });

  test('notional at exactly max passes', () => {
    // qty=0.001 * price=100000 = $100 = max
    config.risk.maxPositionUsdt = 100;
    const result = validateOrder(validOrder({ quantity: '0.001', price: '100000' }), 'AT', 'test-user-1');
    expect(result.ok).toBe(true);
  });

  // ── Daily loss limit ──
  test('daily loss limit blocks order', () => {
    // maxPositionUsdt=100, dailyLossLimitPct=5 → lossLimit=$5
    recordClosedPnL(-6, 'AT', 'test-loss-user');
    const result = validateOrder(validOrder(), 'AT', 'test-loss-user');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/daily loss/i);
  });

  test('AT and ARES have independent loss tracking', () => {
    recordClosedPnL(-6, 'AT', 'test-indep-user');
    // ARES should still pass (independent tracker)
    const result = validateOrder(validOrder(), 'ARES', 'test-indep-user');
    expect(result.ok).toBe(true);
  });

  test('loss below limit passes', () => {
    recordClosedPnL(-2, 'AT', 'test-under-user');
    const result = validateOrder(validOrder(), 'AT', 'test-under-user');
    expect(result.ok).toBe(true);
  });

  // ── Null/missing userId (RM-05) ──
  test('null userId returns blocked (safe default), does not throw', () => {
    const result = validateOrder(validOrder(), 'AT', null);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/kill/i);
  });

  test('undefined userId returns blocked, does not throw', () => {
    const result = validateOrder(validOrder(), 'AT', undefined);
    expect(result.ok).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════
// setEmergencyKill — kill switch
// ══════════════════════════════════════════════════════════════
describe('setEmergencyKill', () => {

  test('activating kill calls telegram (best-effort)', () => {
    telegram.alertKillSwitch.mockClear();
    setEmergencyKill(true, 'tg-test-user');
    expect(telegram.alertKillSwitch).toHaveBeenCalledWith(true, 'tg-test-user');
  });

  test('telegram failure does not throw (A2 fix)', () => {
    telegram.alertKillSwitch.mockImplementationOnce(() => { throw new Error('TG down'); });
    expect(() => setEmergencyKill(true, 'tg-fail-user')).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════
// recordClosedPnL + getDailyState
// ══════════════════════════════════════════════════════════════
describe('recordClosedPnL + getDailyState', () => {

  test('records PnL for AT', () => {
    recordClosedPnL(-3.5, 'AT', 'pnl-user-1');
    const state = getDailyState('AT', 'pnl-user-1');
    expect(state.realizedPnL).toBeCloseTo(-3.5);
  });

  test('records PnL for ARES independently', () => {
    recordClosedPnL(5, 'ARES', 'pnl-user-2');
    recordClosedPnL(-2, 'AT', 'pnl-user-2');
    const ares = getDailyState('ARES', 'pnl-user-2');
    const at = getDailyState('AT', 'pnl-user-2');
    expect(ares.realizedPnL).toBeCloseTo(5);
    expect(at.realizedPnL).toBeCloseTo(-2);
  });

  test('accumulates multiple PnL entries', () => {
    recordClosedPnL(-1, 'AT', 'pnl-accum');
    recordClosedPnL(-2, 'AT', 'pnl-accum');
    recordClosedPnL(0.5, 'AT', 'pnl-accum');
    const state = getDailyState('AT', 'pnl-accum');
    expect(state.realizedPnL).toBeCloseTo(-2.5);
  });
});
