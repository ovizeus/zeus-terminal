'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => {
  try { db.prepare('DELETE FROM ml_cognitive_snapshots').run(); } catch(_) {}
});
afterAll(() => {
  try { db.prepare('DELETE FROM ml_cognitive_snapshots').run(); } catch(_) {}
});

describe('Doctor D-6: conflictMap', () => {
  test('compareSnapshots with identical snapshots returns 0 divergences', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    const { id: id1 } = cs.captureSnapshot({ triggerType: 'manual' });
    const { id: id2 } = cs.captureSnapshot({ triggerType: 'manual' });
    const cm = require('../../../server/services/ml/_doctor/conflictMap');
    const result = cm.compareSnapshots({ fromId: id1, toId: id2 });
    expect(result).toHaveProperty('divergences');
    expect(result.divergences.length).toBe(0);
    expect(result).toHaveProperty('totalDiverged', 0);
  });

  test('compareSnapshots detects trust score delta', () => {
    db.prepare(`INSERT INTO ml_cognitive_snapshots
      (trigger_type, cognitive_state, snapshot_json, created_at)
      VALUES ('manual', 'HEALTHY', ?, ?)`).run(
      JSON.stringify({ trustScores: { modA: 0.9, modB: 0.8 }, quarantines: [], shedState: 0 }),
      Date.now() - 10000
    );
    db.prepare(`INSERT INTO ml_cognitive_snapshots
      (trigger_type, cognitive_state, snapshot_json, created_at)
      VALUES ('manual', 'DEGRADED', ?, ?)`).run(
      JSON.stringify({ trustScores: { modA: 0.5, modB: 0.8 }, quarantines: [], shedState: 0 }),
      Date.now()
    );
    const rows = db.prepare('SELECT id FROM ml_cognitive_snapshots ORDER BY id ASC').all();
    const cm = require('../../../server/services/ml/_doctor/conflictMap');
    const result = cm.compareSnapshots({ fromId: rows[0].id, toId: rows[1].id });
    expect(result.totalDiverged).toBe(1);
    expect(result.divergences[0].moduleId).toBe('modA');
    expect(result.divergences[0].trustDelta).toBeCloseTo(-0.4, 1);
    expect(result.divergences[0].severity).toBe('high');
  });

  test('compareSnapshots with missing toId uses live state', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    const { id } = cs.captureSnapshot({ triggerType: 'manual' });
    const cm = require('../../../server/services/ml/_doctor/conflictMap');
    const result = cm.compareSnapshots({ fromId: id });
    expect(result).toHaveProperty('from');
    expect(result).toHaveProperty('to');
    expect(result).toHaveProperty('divergences');
  });

  test('compareSnapshots returns error for invalid fromId', () => {
    const cm = require('../../../server/services/ml/_doctor/conflictMap');
    const result = cm.compareSnapshots({ fromId: 99999 });
    expect(result).toHaveProperty('error');
  });
});
