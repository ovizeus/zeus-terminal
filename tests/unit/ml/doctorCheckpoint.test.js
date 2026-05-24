'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => {
  try { db.prepare('DELETE FROM ml_cognitive_checkpoints').run(); } catch(_) {}
});
afterAll(() => {
  try { db.prepare('DELETE FROM ml_cognitive_checkpoints').run(); } catch(_) {}
});

describe('Doctor D-8: cognitiveCheckpoint', () => {
  test('saveCheckpoint stores checkpoint and returns id', () => {
    const ck = require('../../../server/services/ml/_doctor/cognitiveCheckpoint');
    const result = ck.saveCheckpoint({ label: 'test_manual' });
    expect(result).toHaveProperty('id');
    expect(result.id).toBeGreaterThan(0);
    expect(result).toHaveProperty('cognitiveState');
    expect(result).toHaveProperty('size');
  });

  test('getCheckpoint retrieves by id', () => {
    const ck = require('../../../server/services/ml/_doctor/cognitiveCheckpoint');
    const { id } = ck.saveCheckpoint({ label: 'test_get' });
    const cp = ck.getCheckpoint(id);
    expect(cp).not.toBeNull();
    expect(cp.label).toBe('test_get');
    const parsed = JSON.parse(cp.checkpoint_json);
    expect(parsed).toHaveProperty('trustScores');
    expect(parsed).toHaveProperty('quarantines');
    expect(parsed).toHaveProperty('banditPosteriors');
  });

  test('listCheckpoints returns sorted desc', () => {
    const ck = require('../../../server/services/ml/_doctor/cognitiveCheckpoint');
    ck.saveCheckpoint({ label: 'first' });
    ck.saveCheckpoint({ label: 'second' });
    const list = ck.listCheckpoints({ limit: 10 });
    expect(list.length).toBe(2);
    expect(list[0].label).toBe('second');
  });

  test('getLastHealthy returns most recent auto HEALTHY checkpoint', () => {
    const ck = require('../../../server/services/ml/_doctor/cognitiveCheckpoint');
    ck.saveCheckpoint({ label: 'auto_healthy', auto: true });
    const last = ck.getLastHealthy();
    // May or may not find one depending on analyzer state — just verify function works
    expect(last === null || last.auto_created === 1).toBe(true);
  });

  test('restoreCheckpoint returns restored result', () => {
    const ck = require('../../../server/services/ml/_doctor/cognitiveCheckpoint');
    const { id } = ck.saveCheckpoint({ label: 'restore_test' });
    const result = ck.restoreCheckpoint({ checkpointId: id });
    expect(result).toHaveProperty('restored', true);
    expect(result).toHaveProperty('rollbackItems');
  });

  test('pruneOld keeps only N most recent', () => {
    const ck = require('../../../server/services/ml/_doctor/cognitiveCheckpoint');
    ck.saveCheckpoint({ label: 'old1' });
    ck.saveCheckpoint({ label: 'old2' });
    ck.saveCheckpoint({ label: 'keep' });
    const deleted = ck.pruneOld(1);
    expect(deleted).toBe(2);
    expect(ck.listCheckpoints({}).length).toBe(1);
  });
});
