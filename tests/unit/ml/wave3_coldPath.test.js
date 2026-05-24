'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => {
  try { db.prepare('DELETE FROM ml_reflection_runs').run(); } catch (_) {}
  try { db.prepare('DELETE FROM ml_reflection_insights').run(); } catch (_) {}
});

afterAll(() => {
  try { db.prepare('DELETE FROM ml_reflection_runs').run(); } catch (_) {}
  try { db.prepare('DELETE FROM ml_reflection_insights').run(); } catch (_) {}
});

describe('Wave 3: Cold Path cron infrastructure', () => {
  test('ml_reflection_runs table exists with correct columns', () => {
    const info = db.prepare("PRAGMA table_info(ml_reflection_runs)").all();
    expect(info.length).toBeGreaterThan(0);
    const cols = info.map(c => c.name);
    expect(cols).toContain('started_at');
    expect(cols).toContain('finished_at');
    expect(cols).toContain('decisions_processed');
    expect(cols).toContain('modules_run');
    expect(cols).toContain('modules_failed');
    expect(cols).toContain('total_insights');
    expect(cols).toContain('duration_ms');
  });

  test('ml_reflection_insights table exists with correct columns', () => {
    const info = db.prepare("PRAGMA table_info(ml_reflection_insights)").all();
    expect(info.length).toBeGreaterThan(0);
    const cols = info.map(c => c.name);
    expect(cols).toContain('run_id');
    expect(cols).toContain('module_id');
    expect(cols).toContain('decision_id');
    expect(cols).toContain('insight_type');
    expect(cols).toContain('severity');
    expect(cols).toContain('insight_text');
    expect(cols).toContain('metadata_json');
    expect(cols).toContain('surfaced_in_voice');
  });

  test('coldPathCron exports schedule, stop, _tick', () => {
    const cron = require('../../../server/cron/coldPathCron');
    expect(typeof cron.schedule).toBe('function');
    expect(typeof cron.stop).toBe('function');
    expect(typeof cron._tick).toBe('function');
  });

  test('coldPathCron._tick records a reflection run', () => {
    const cron = require('../../../server/cron/coldPathCron');
    cron._tick();
    const run = db.prepare('SELECT * FROM ml_reflection_runs ORDER BY id DESC LIMIT 1').get();
    expect(run).not.toBeNull();
    expect(run.modules_run).toBeGreaterThanOrEqual(0);
    expect(run.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test('coldPathCron._tick does not throw on module failure', () => {
    const cron = require('../../../server/cron/coldPathCron');
    expect(() => cron._tick()).not.toThrow();
  });
});
