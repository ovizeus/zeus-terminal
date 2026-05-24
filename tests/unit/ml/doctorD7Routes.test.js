'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => {
  try { db.prepare('DELETE FROM ml_experiments').run(); } catch(_) {}
  try { db.prepare('DELETE FROM ml_experiment_outcomes').run(); } catch(_) {}
  try { db.prepare('DELETE FROM ml_cognitive_snapshots WHERE trigger_type = ?').run('scheduled'); } catch(_) {}
});
afterAll(() => {
  try { db.prepare('DELETE FROM ml_experiments').run(); } catch(_) {}
  try { db.prepare('DELETE FROM ml_experiment_outcomes').run(); } catch(_) {}
});

describe('Doctor D-7: sandbox integration', () => {
  test('create + list + complete flow', () => {
    const sb = require('../../../server/services/ml/_doctor/cognitiveSandbox');
    const { experimentId } = sb.createExperiment({
      moduleId: 'testMod', name: 'flow_test',
      variantAConfig: { a: 1 }, variantBConfig: { b: 2 },
    });
    expect(experimentId).toBeGreaterThan(0);

    const list = sb.listExperiments({});
    expect(list.length).toBeGreaterThan(0);

    const result = sb.completeExperiment({ experimentId });
    expect(result.completed).toBe(true);
  });

  test('completeExperiment captures D-6 snapshot', () => {
    const sb = require('../../../server/services/ml/_doctor/cognitiveSandbox');
    const { experimentId } = sb.createExperiment({
      moduleId: 'snapMod', name: 'snap_test',
      variantAConfig: {}, variantBConfig: {},
    });
    sb.completeExperiment({ experimentId });
    const snaps = db.prepare("SELECT COUNT(*) as cnt FROM ml_cognitive_snapshots WHERE trigger_type = 'scheduled'").get();
    expect(snaps.cnt).toBeGreaterThan(0);
  });

  test('all D-7 modules load without error', () => {
    expect(() => require('../../../server/services/ml/_doctor/cognitiveSandbox')).not.toThrow();
  });
});
