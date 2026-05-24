'use strict';
const { db } = require('../../../server/services/database');

afterAll(() => {
  try { db.prepare('DELETE FROM ml_cognitive_checkpoints').run(); } catch(_) {}
});

describe('Doctor D-8: §240 covenant wiring', () => {
  test('cognitiveCheckpoint.saveCheckpoint with auto flag', () => {
    const ck = require('../../../server/services/ml/_doctor/cognitiveCheckpoint');
    const result = ck.saveCheckpoint({ label: 'auto_healthy', auto: true });
    expect(result.id).toBeGreaterThan(0);
    const cp = ck.getCheckpoint(result.id);
    expect(cp.auto_created).toBe(1);
  });

  test('getLastHealthy finds auto HEALTHY checkpoint', () => {
    const ck = require('../../../server/services/ml/_doctor/cognitiveCheckpoint');
    // Save a HEALTHY auto checkpoint by manipulating DB directly
    db.prepare(`INSERT INTO ml_cognitive_checkpoints
      (label, cognitive_state, checkpoint_json, auto_created, created_at)
      VALUES ('auto_healthy', 'HEALTHY', '{"trustScores":{},"quarantines":[],"shedState":0,"banditPosteriors":[],"moduleState":[]}', 1, ?)`).run(Date.now());
    const last = ck.getLastHealthy();
    expect(last).not.toBeNull();
    expect(last.cognitive_state).toBe('HEALTHY');
    expect(last.auto_created).toBe(1);
  });

  test('restoreCheckpoint from HEALTHY checkpoint works', () => {
    const ck = require('../../../server/services/ml/_doctor/cognitiveCheckpoint');
    const { id } = ck.saveCheckpoint({ label: 'restore_test_240', auto: true });
    const result = ck.restoreCheckpoint({ checkpointId: id });
    expect(result.restored).toBe(true);
  });
});
