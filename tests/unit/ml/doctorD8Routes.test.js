'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => {
  try { db.prepare('DELETE FROM ml_cognitive_checkpoints').run(); } catch(_) {}
});
afterAll(() => {
  try { db.prepare('DELETE FROM ml_cognitive_checkpoints').run(); } catch(_) {}
});

describe('Doctor D-8: checkpoint routes integration', () => {
  test('save + list + restore flow', () => {
    const ck = require('../../../server/services/ml/_doctor/cognitiveCheckpoint');
    const { id } = ck.saveCheckpoint({ label: 'route_test' });
    expect(id).toBeGreaterThan(0);

    const list = ck.listCheckpoints({ limit: 10 });
    expect(list.length).toBe(1);
    expect(list[0].label).toBe('route_test');

    const result = ck.restoreCheckpoint({ checkpointId: id });
    expect(result.restored).toBe(true);
  });

  test('all D-8 modules load', () => {
    expect(() => require('../../../server/services/ml/_doctor/cognitiveCheckpoint')).not.toThrow();
  });

  test('pruneOld works correctly', () => {
    const ck = require('../../../server/services/ml/_doctor/cognitiveCheckpoint');
    ck.saveCheckpoint({ label: 'a' });
    ck.saveCheckpoint({ label: 'b' });
    ck.saveCheckpoint({ label: 'c' });
    const deleted = ck.pruneOld(1);
    expect(deleted).toBe(2);
  });
});
