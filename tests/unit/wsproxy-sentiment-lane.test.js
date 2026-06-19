'use strict';

// [AUDIT-20260619 P2] The watchlist/quant REST pollers (wsproxy-watchlist,
// wsproxy-quant) are the ONLY live price/funding/OI source while Hetzner blocks
// the fstream WS, and the sentiment LS feed is a brain confluence input — yet all
// three fell to DEFAULT_LANE=P5 (cosmetic), so they were shed during the 120s
// boot-blind window after every reload (pressure 0.85) and during order bursts.
// They belong in P4 (live data feed, graceful degrade) like marketFeed:funding/oi.

const scheduler = require('../../server/services/binanceScheduler');
beforeEach(() => scheduler._resetForTest());

describe('wsproxy / sentiment lane mapping', () => {
  test('wsproxy-watchlist → P4 (price freshness, not cosmetic P5)', () => {
    expect(scheduler.laneForSrc('wsproxy-watchlist')).toBe('P4');
  });
  test('wsproxy-quant → P4', () => {
    expect(scheduler.laneForSrc('wsproxy-quant')).toBe('P4');
  });
  test('sentiment → P4 (brain confluence input)', () => {
    expect(scheduler.laneForSrc('sentiment')).toBe('P4');
  });
  test('marketRadar stays P5 (genuinely cosmetic) — no over-promotion', () => {
    expect(scheduler.laneForSrc('marketRadar:ticker')).toBe('P5');
  });
});
