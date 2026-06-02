'use strict';
const HB = require('../../server/services/heartbeatTracker');
beforeEach(() => HB._reset(1000)); // bootTs = 1000

describe('heartbeatTracker', () => {
  test('cold-start grace: unknown user is PRESENT during grace window', () => {
    expect(HB.isClientPresent(1, 1000 + 5000)).toBe(true);
  });
  test('cold-start grace expires: unknown user ABSENT after grace + timeout', () => {
    expect(HB.isClientPresent(1, 1000 + 30000 + 20001)).toBe(false);
  });
  test('fresh beat → present', () => {
    HB.recordBeat(1, 100000);
    expect(HB.isClientPresent(1, 100000 + 5000)).toBe(true);
  });
  test('stale beat past timeout → absent (after hysteresis)', () => {
    HB.recordBeat(1, 100000);
    HB.isClientPresent(1, 100000 + 20001); // first stale arms hysteresis
    expect(HB.isClientPresent(1, 100000 + 20002)).toBe(false);
  });
  test('markAbsent (WS close) forces absent immediately', () => {
    HB.recordBeat(1, 100000);
    HB.markAbsent(1);
    expect(HB.isClientPresent(1, 100000 + 1000)).toBe(false);
  });
  test('server-stamped: uses passed serverTs', () => {
    HB.recordBeat(1, 100000);
    expect(HB.isClientPresent(1, 100000)).toBe(true);
  });
});
