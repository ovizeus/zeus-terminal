'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => {
  try { db.prepare('DELETE FROM ml_cognitive_snapshots').run(); } catch(_) {}
});
afterAll(() => {
  try { db.prepare('DELETE FROM ml_cognitive_snapshots').run(); } catch(_) {}
});

describe('Doctor D-6: cognitiveSnapshot', () => {
  test('captureSnapshot stores snapshot and returns id', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    const result = cs.captureSnapshot({ triggerType: 'manual' });
    expect(result).toHaveProperty('id');
    expect(result.id).toBeGreaterThan(0);
    expect(result).toHaveProperty('cognitiveState');
  });

  test('getSnapshot retrieves by id', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    const { id } = cs.captureSnapshot({ triggerType: 'manual' });
    const snap = cs.getSnapshot(id);
    expect(snap).not.toBeNull();
    expect(snap.trigger_type).toBe('manual');
    expect(snap.snapshot_json).toBeDefined();
    const parsed = JSON.parse(snap.snapshot_json);
    expect(parsed).toHaveProperty('trustScores');
    expect(parsed).toHaveProperty('quarantines');
    expect(parsed).toHaveProperty('shedState');
  });

  test('listSnapshots returns array sorted by created_at desc', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    cs.captureSnapshot({ triggerType: 'manual' });
    cs.captureSnapshot({ triggerType: 'auto_p0', triggerEventId: 42 });
    const list = cs.listSnapshots({ limit: 10 });
    expect(list.length).toBe(2);
    expect(list[0].trigger_type).toBe('auto_p0');
  });

  test('getSnapshot returns null for nonexistent id', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    expect(cs.getSnapshot(99999)).toBeNull();
  });

  test('pruneOld deletes snapshots older than maxAgeDays', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    cs.captureSnapshot({ triggerType: 'manual' });
    db.prepare(`INSERT INTO ml_cognitive_snapshots
      (trigger_type, cognitive_state, snapshot_json, created_at)
      VALUES ('manual', 'HEALTHY', '{}', ?)`).run(Date.now() - 100 * 86400000);
    const deleted = cs.pruneOld(90);
    expect(deleted).toBe(1);
    expect(cs.listSnapshots({}).length).toBe(1);
  });
});
