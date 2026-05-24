'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => { try { db.prepare('DELETE FROM ml_voice_feedback').run(); } catch(_) {} });
afterAll(() => { try { db.prepare('DELETE FROM ml_voice_feedback').run(); } catch(_) {} });

describe('A-Z Raid F: voiceFeedback', () => {
  test('submitFeedback stores feedback', () => {
    const vf = require('../../../server/services/ml/_voice/voiceFeedback');
    const result = vf.submitFeedback({ voiceLogId: 1, userId: 1, feedback: 'up' });
    expect(result.ok).toBe(true);
  });

  test('submitFeedback upserts on same voiceLogId', () => {
    const vf = require('../../../server/services/ml/_voice/voiceFeedback');
    vf.submitFeedback({ voiceLogId: 2, userId: 1, feedback: 'up' });
    vf.submitFeedback({ voiceLogId: 2, userId: 1, feedback: 'down' });
    const row = db.prepare('SELECT feedback FROM ml_voice_feedback WHERE voice_log_id = 2').get();
    expect(row.feedback).toBe('down');
  });

  test('submitFeedback respects 50/day limit', () => {
    const vf = require('../../../server/services/ml/_voice/voiceFeedback');
    for (let i = 100; i < 150; i++) vf.submitFeedback({ voiceLogId: i, userId: 99, feedback: 'up' });
    const result = vf.submitFeedback({ voiceLogId: 999, userId: 99, feedback: 'up' });
    expect(result.ok).toBe(false);
  });

  test('getFeedbackStats returns counts', () => {
    const vf = require('../../../server/services/ml/_voice/voiceFeedback');
    vf.submitFeedback({ voiceLogId: 10, userId: 1, feedback: 'up' });
    vf.submitFeedback({ voiceLogId: 11, userId: 1, feedback: 'down' });
    const stats = vf.getFeedbackStats({ userId: 1 });
    expect(stats.up).toBeGreaterThanOrEqual(1);
    expect(stats.down).toBeGreaterThanOrEqual(1);
  });
});
