'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => {
  try { db.prepare('DELETE FROM ml_cognitive_snapshots').run(); } catch(_) {}
});
afterAll(() => {
  try { db.prepare('DELETE FROM ml_cognitive_snapshots').run(); } catch(_) {}
});

describe('Doctor D-6: integration', () => {
  test('captureSnapshot works for auto_p0 trigger', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    const result = cs.captureSnapshot({ triggerType: 'auto_p0', triggerEventId: 42 });
    expect(result.id).toBeGreaterThan(0);
    const snap = cs.getSnapshot(result.id);
    expect(snap.trigger_type).toBe('auto_p0');
    expect(snap.trigger_event_id).toBe(42);
  });

  test('causalChain.buildBlameTree returns valid structure', () => {
    const cc = require('../../../server/services/ml/_doctor/causalChain');
    const tree = cc.buildBlameTree({ moduleId: 'circuitBreaker' });
    expect(tree.root).toBe('circuitBreaker');
    expect(Array.isArray(tree.nodes)).toBe(true);
  });

  test('conflictMap end-to-end: capture two, compare', () => {
    const cs = require('../../../server/services/ml/_doctor/cognitiveSnapshot');
    const { id: id1 } = cs.captureSnapshot({ triggerType: 'manual' });
    const { id: id2 } = cs.captureSnapshot({ triggerType: 'manual' });
    const cm = require('../../../server/services/ml/_doctor/conflictMap');
    const result = cm.compareSnapshots({ fromId: id1, toId: id2 });
    expect(result.totalDiverged).toBe(0);
  });

  test('all D-6 modules load without error', () => {
    expect(() => require('../../../server/services/ml/_doctor/cognitiveSnapshot')).not.toThrow();
    expect(() => require('../../../server/services/ml/_doctor/causalChain')).not.toThrow();
    expect(() => require('../../../server/services/ml/_doctor/conflictMap')).not.toThrow();
  });
});
