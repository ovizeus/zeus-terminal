'use strict';

/**
 * omegaMemoryHealthService.test.js — 6 TDD tests for Sub-C.1 Task 3
 *
 * Tests cover pure function _calcStatus only (no DB access).
 * States: healthy | degraded | down | idle
 * 2 idle conditions + pending-override edge case.
 */

const { _internals } = require('../../server/services/ml/_voice/omegaMemoryHealthService');

describe('omegaMemoryHealthService._calcStatus', () => {
  test('returns idle when no attempts ever (last_attempt_at = null)', () => {
    const status = _internals._calcStatus({
      last_attempt_at: null,
      failure_rate_last_hour: 0,
      pending_count: 0,
      total_attempts_last_hour: 0
    }, Date.now());
    expect(status).toBe('idle');
  });

  test('returns idle when last_attempt > 30min ago', () => {
    const now = Date.now();
    const status = _internals._calcStatus({
      last_attempt_at: now - 31 * 60 * 1000,
      failure_rate_last_hour: 0,
      pending_count: 0,
      total_attempts_last_hour: 5
    }, now);
    expect(status).toBe('idle');
  });

  test('returns healthy with low failure rate + low pending', () => {
    const now = Date.now();
    const status = _internals._calcStatus({
      last_attempt_at: now - 60 * 1000,
      failure_rate_last_hour: 0.05,
      pending_count: 2,
      total_attempts_last_hour: 20
    }, now);
    expect(status).toBe('healthy');
  });

  test('returns degraded with 10-50% failure rate', () => {
    const now = Date.now();
    const status = _internals._calcStatus({
      last_attempt_at: now - 60 * 1000,
      failure_rate_last_hour: 0.25,
      pending_count: 3,
      total_attempts_last_hour: 20
    }, now);
    expect(status).toBe('degraded');
  });

  test('returns degraded on pending>20 OVERRIDE (even with low rate)', () => {
    const now = Date.now();
    const status = _internals._calcStatus({
      last_attempt_at: now - 60 * 1000,
      failure_rate_last_hour: 0.02,
      pending_count: 25,
      total_attempts_last_hour: 30
    }, now);
    expect(status).toBe('degraded');
  });

  test('returns down with >50% failure rate', () => {
    const now = Date.now();
    const status = _internals._calcStatus({
      last_attempt_at: now - 60 * 1000,
      failure_rate_last_hour: 0.75,
      pending_count: 5,
      total_attempts_last_hour: 20
    }, now);
    expect(status).toBe('down');
  });
});
