'use strict';
const D = require('../../server/services/entryDedup');
beforeEach(() => D._reset());
describe('entryDedup', () => {
  test('first open allowed, second within window blocked', () => {
    expect(D.shouldBlockOpen(1, 'BTCUSDT', 1000, 8000)).toBe(false);
    D.markOpened(1, 'BTCUSDT', 1000);
    expect(D.shouldBlockOpen(1, 'BTCUSDT', 3000, 8000)).toBe(true);
  });
  test('after window, allowed again', () => {
    D.markOpened(1, 'BTCUSDT', 1000);
    expect(D.shouldBlockOpen(1, 'BTCUSDT', 1000 + 8001, 8000)).toBe(false);
  });
  test('different symbol not blocked', () => {
    D.markOpened(1, 'BTCUSDT', 1000);
    expect(D.shouldBlockOpen(1, 'ETHUSDT', 1500, 8000)).toBe(false);
  });
});
