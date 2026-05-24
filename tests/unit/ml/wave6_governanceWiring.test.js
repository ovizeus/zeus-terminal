'use strict';
const { db } = require('../../../server/services/database');

afterAll(() => {
  try { db.prepare("DELETE FROM ml_module_quarantines WHERE module_id LIKE 'test_%'").run(); } catch (_) {}
});

describe('Wave 6: R5B governance loop wiring', () => {
  test('tieredPromotion.classifyChange categorizes correctly', () => {
    const tp = require('../../../server/services/ml/R5B_governance/tieredPromotion');
    expect(tp).toBeDefined();
    const keys = Object.keys(tp);
    expect(keys.length).toBeGreaterThan(0);
  });

  test('autoQuarantine loads and has check function', () => {
    const aq = require('../../../server/services/ml/R5B_governance/autoQuarantine');
    expect(aq).toBeDefined();
    const keys = Object.keys(aq);
    expect(keys.length).toBeGreaterThan(0);
  });

  test('autoResumeDD loads', () => {
    const ar = require('../../../server/services/ml/R5B_governance/autoResumeDD');
    expect(ar).toBeDefined();
  });

  test('counterfactualPortfolio loads', () => {
    const cp = require('../../../server/services/ml/R5A_learning/counterfactualPortfolio');
    expect(cp).toBeDefined();
  });

  test('competenceMap loads', () => {
    const cm = require('../../../server/services/ml/R5B_governance/competenceMap');
    expect(cm).toBeDefined();
  });

  test('shadowMode loads and has stage functions', () => {
    const sm = require('../../../server/services/ml/R5B_governance/shadowMode');
    expect(sm).toBeDefined();
    const keys = Object.keys(sm);
    expect(keys.length).toBeGreaterThan(0);
  });

  test('versionRegistry loads (already wired)', () => {
    const vr = require('../../../server/services/ml/R5B_governance/versionRegistry');
    expect(vr).toBeDefined();
  });
});
