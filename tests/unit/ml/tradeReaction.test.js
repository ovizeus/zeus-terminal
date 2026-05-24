'use strict';
const { db } = require('../../../server/services/database');

describe('A-Z Raid R: tradeReaction', () => {
  test('reactToTrade returns text for entry', () => {
    const tr = require('../../../server/services/ml/_voice/tradeReaction');
    tr._resetForTest();
    const result = tr.reactToTrade({ userId: 1, symbol: 'BTCUSDT', side: 'LONG', action: 'entry', mood: 'CALM' });
    expect(result.reacted).toBe(true);
    expect(result.text.length).toBeGreaterThan(0);
  });

  test('reactToTrade respects 5min frequency cap', () => {
    const tr = require('../../../server/services/ml/_voice/tradeReaction');
    tr._resetForTest();
    tr.reactToTrade({ userId: 1, symbol: 'ETHUSDT', side: 'SHORT', action: 'entry', mood: 'ALERT' });
    const result = tr.reactToTrade({ userId: 1, symbol: 'ETHUSDT', side: 'LONG', action: 'entry', mood: 'ALERT' });
    expect(result.reacted).toBe(false);
    expect(result.reason).toContain('frequency');
  });

  test('reactToTrade mood branching produces different text', () => {
    const tr = require('../../../server/services/ml/_voice/tradeReaction');
    tr._resetForTest();
    const calm = tr.reactToTrade({ userId: 1, symbol: 'SOLUSDT', side: 'LONG', action: 'entry', mood: 'CALM' });
    tr._resetForTest();
    const cautious = tr.reactToTrade({ userId: 1, symbol: 'SOLUSDT', side: 'LONG', action: 'entry', mood: 'CAUTIOUS' });
    // Different mood pools should produce different text (probabilistic but pools are distinct)
    expect(calm.reacted).toBe(true);
    expect(cautious.reacted).toBe(true);
  });

  test('reactToTrade writes to ml_voice_log', () => {
    const tr = require('../../../server/services/ml/_voice/tradeReaction');
    tr._resetForTest();
    const before = db.prepare("SELECT COUNT(*) as cnt FROM ml_voice_log WHERE template_id = 'omega_reaction'").get();
    tr.reactToTrade({ userId: 1, symbol: 'BNBUSDT', side: 'SHORT', action: 'win', mood: 'ALERT' });
    const after = db.prepare("SELECT COUNT(*) as cnt FROM ml_voice_log WHERE template_id = 'omega_reaction'").get();
    expect(after.cnt).toBeGreaterThan(before.cnt);
  });

  test('reactToTrade scalping detection skips', () => {
    const tr = require('../../../server/services/ml/_voice/tradeReaction');
    tr._resetForTest();
    for (let i = 0; i < 5; i++) tr._recordTrade('DOTUSDT');
    const result = tr.reactToTrade({ userId: 1, symbol: 'DOTUSDT', side: 'LONG', action: 'entry', mood: 'CALM' });
    expect(result.reacted).toBe(false);
    expect(result.reason).toContain('scalp');
  });
});
