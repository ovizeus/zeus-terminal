'use strict';

// [AUDIT-20260619 BUG B] The SL-required entry guard rejected reduce-only CLOSES
// with 400 ("SL required") because it had no close/reduceOnly exemption — acute when
// _isTestnet mis-resolved to false and a testnet close was treated as a REAL entry.

const { slRequiredForEntry } = require('../../server/services/orderGuards');

describe('slRequiredForEntry — closes never require an SL', () => {
  test('reduce-only close → NOT required (the bug: it was rejected 400)', () => {
    expect(slRequiredForEntry({ engineMode: 'live', isTestnet: false, reduceOnly: true })).toBe(false);
  });
  test('closePosition close → NOT required', () => {
    expect(slRequiredForEntry({ engineMode: 'live', isTestnet: false, closePosition: true })).toBe(false);
  });
  test('live REAL entry (open) → required', () => {
    expect(slRequiredForEntry({ engineMode: 'live', isTestnet: false })).toBe(true);
  });
  test('live TESTNET entry → exempt (existing design)', () => {
    expect(slRequiredForEntry({ engineMode: 'live', isTestnet: true })).toBe(false);
  });
  test('demo entry → exempt', () => {
    expect(slRequiredForEntry({ engineMode: 'demo', isTestnet: false })).toBe(false);
  });
  test('REAL close even with no SL → still not required', () => {
    expect(slRequiredForEntry({ engineMode: 'live', isTestnet: false, reduceOnly: true, closePosition: false })).toBe(false);
  });
});
