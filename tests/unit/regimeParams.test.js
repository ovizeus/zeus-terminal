/**
 * Zeus Terminal — Unit Tests: serverRegimeParams.js
 * Tests getAdaptedParams(), getProfile(), getTransitionAwareParams()
 */
'use strict';

const { getAdaptedParams, getProfile, getTransitionAwareParams, REGIME_PROFILES } = require('../../server/services/serverRegimeParams');

// ══════════════════════════════════════════════════════════════
// REGIME_PROFILES structure
// ══════════════════════════════════════════════════════════════
describe('REGIME_PROFILES', () => {

  test('all required regimes exist', () => {
    const expected = ['TREND', 'TREND_UP', 'TREND_DOWN', 'RANGE', 'BREAKOUT', 'EXPANSION', 'SQUEEZE', 'VOLATILE', 'CHAOS', 'LIQUIDATION_EVENT'];
    for (const r of expected) {
      expect(REGIME_PROFILES[r]).toBeDefined();
    }
  });

  test('each profile has required fields', () => {
    for (const [name, profile] of Object.entries(REGIME_PROFILES)) {
      expect(profile.confMin).toBeGreaterThan(0);
      expect(profile.slMult).toBeGreaterThan(0);
      expect(profile.rrMin).toBeGreaterThan(0);
      expect(typeof profile.dslMode).toBe('string');
      expect(profile.sizeScale).toBeGreaterThan(0);
      expect(profile.sizeScale).toBeLessThanOrEqual(1.0);
    }
  });

  test('CHAOS confMin is very high (near-block)', () => {
    expect(REGIME_PROFILES.CHAOS.confMin).toBeGreaterThanOrEqual(90);
  });

  test('TREND confMin is lower than RANGE', () => {
    expect(REGIME_PROFILES.TREND.confMin).toBeLessThan(REGIME_PROFILES.RANGE.confMin);
  });

  test('VOLATILE sizeScale is reduced', () => {
    expect(REGIME_PROFILES.VOLATILE.sizeScale).toBeLessThan(1.0);
  });
});

// ══════════════════════════════════════════════════════════════
// getProfile
// ══════════════════════════════════════════════════════════════
describe('getProfile', () => {

  test('returns correct profile for known regime', () => {
    const p = getProfile('TREND');
    expect(p.confMin).toBe(55);
    expect(p.dslMode).toBe('swing');
  });

  test('returns default for unknown regime', () => {
    const p = getProfile('NONEXISTENT');
    expect(p.confMin).toBe(65);
    expect(p.dslMode).toBe('def');
  });
});

// ══════════════════════════════════════════════════════════════
// getAdaptedParams
// ══════════════════════════════════════════════════════════════
describe('getAdaptedParams', () => {

  test('merges regime profile with base STC', () => {
    const result = getAdaptedParams('TREND', { size: 300, lev: 10, slPct: 1.5, rr: 2 });
    expect(result.confMin).toBe(55);      // regime's confMin
    expect(result.size).toBe(300);         // 300 * 1.0 sizeScale
    expect(result.lev).toBe(10);           // from base
    expect(result._regime).toBe('TREND');
  });

  test('user confMin higher than regime takes precedence', () => {
    const result = getAdaptedParams('TREND', { confMin: 80 });
    expect(result.confMin).toBe(80); // user's 80 > regime's 55
  });

  test('regime confMin takes precedence when higher', () => {
    const result = getAdaptedParams('VOLATILE', { confMin: 60 });
    expect(result.confMin).toBe(80); // regime's 80 > user's 60
  });

  test('sizeScale reduces position size', () => {
    const result = getAdaptedParams('VOLATILE', { size: 200 });
    expect(result.size).toBe(120); // 200 * 0.6
  });

  test('slMult widens stop loss', () => {
    const result = getAdaptedParams('TREND', { slPct: 1.5 });
    expect(result.slPct).toBe(2.1); // 1.5 * 1.4
  });

  test('rr uses regime minimum when base is lower', () => {
    const result = getAdaptedParams('VOLATILE', { rr: 1.5 });
    expect(result.rr).toBe(3.0); // regime's 3.0 > user's 1.5
  });

  test('dslMode uses regime when user has default', () => {
    const result = getAdaptedParams('RANGE', { dslMode: 'def' });
    expect(result.dslMode).toBe('fast'); // regime override
  });

  test('dslMode keeps user non-default choice', () => {
    const result = getAdaptedParams('RANGE', { dslMode: 'atr' });
    expect(result.dslMode).toBe('atr'); // user explicit
  });

  test('works with empty baseSTC', () => {
    const result = getAdaptedParams('TREND', {});
    expect(result.confMin).toBe(55);
    expect(result.lev).toBe(5); // default
    expect(result.size).toBe(200); // default 200 * 1.0
  });

  test('works with null baseSTC', () => {
    const result = getAdaptedParams('TREND', null);
    expect(result.confMin).toBe(55);
    expect(result._regime).toBe('TREND');
  });

  test('unknown regime uses defaults', () => {
    const result = getAdaptedParams('BANANA', { size: 100 });
    expect(result.confMin).toBe(65);
    expect(result.size).toBe(100); // default sizeScale = 1.0
  });
});

// ══════════════════════════════════════════════════════════════
// getTransitionAwareParams
// ══════════════════════════════════════════════════════════════
describe('getTransitionAwareParams', () => {

  test('no transition returns normal params', () => {
    const result = getTransitionAwareParams('TREND', { size: 200 }, null);
    expect(result.confMin).toBe(55);
    expect(result._transitionBlend).toBeUndefined();
  });

  test('transition blends confMin toward target regime', () => {
    const transition = { transitioning: true, to: 'VOLATILE', confidence: 80 };
    const result = getTransitionAwareParams('TREND', { slPct: 1.5 }, transition);
    // confMin should be between TREND (55) and VOLATILE (80)
    expect(result.confMin).toBeGreaterThan(55);
    expect(result.confMin).toBeLessThan(80);
    expect(result._transitionBlend).toBeDefined();
    expect(result._transitionBlend.from).toBe('TREND');
    expect(result._transitionBlend.to).toBe('VOLATILE');
  });

  test('blend factor capped at 40%', () => {
    const transition = { transitioning: true, to: 'CHAOS', confidence: 100 };
    const result = getTransitionAwareParams('TREND', {}, transition);
    // Even at max confidence, blend is at most 40%
    // confMin = 55 * 0.6 + 95 * 0.4 = 33 + 38 = 71
    expect(result.confMin).toBeLessThanOrEqual(71);
    expect(result._transitionBlend.factor).toBeLessThanOrEqual(0.4);
  });
});
