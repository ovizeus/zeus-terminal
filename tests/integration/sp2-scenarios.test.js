'use strict';
const { resolveOwnership } = require('../../server/services/ownership');
const HB = require('../../server/services/heartbeatTracker');
const DEDUP = require('../../server/services/entryDedup');

describe('SP2 integration scenarios (spec §14)', () => {
  beforeEach(() => { HB._reset(1000); DEDUP._reset(); });

  test('net-cut during SL hit: client absent → server owns entries, exit net always on', () => {
    HB.markAbsent(5); // WS closed = laptop closed
    const own = resolveOwnership({ clientPresent: HB.isClientPresent(5, 2000), atActive: true, credsValid: true, cutoverActive: true, underTakeControl: false });
    expect(own.entryOwner).toBe('SERVER');
    expect(own.exitOwner.activeManager).toBe('SERVER');
    expect(own.exitOwner.disasterBackstop).toBe('SERVER');
  });

  test('take-control + net-cut: active mgmt USER but disaster backstop STILL SERVER', () => {
    const own = resolveOwnership({ clientPresent: false, atActive: true, credsValid: true, cutoverActive: true, underTakeControl: true });
    expect(own.exitOwner.activeManager).toBe('USER');
    expect(own.exitOwner.disasterBackstop).toBe('SERVER');
  });

  test('reload (cold-start grace): no heartbeat yet → client treated PRESENT for entries (no double-open)', () => {
    const own = resolveOwnership({ clientPresent: HB.isClientPresent(9, 1000 + 5000), atActive: true, credsValid: true, cutoverActive: true, underTakeControl: false });
    expect(own.entryOwner).toBe('CLIENT');
  });

  test('idempotency: server cannot double-open same symbol within window', () => {
    expect(DEDUP.shouldBlockOpen(5, 'BTCUSDT', 1000, 8000)).toBe(false);
    DEDUP.markOpened(5, 'BTCUSDT', 1000);
    expect(DEDUP.shouldBlockOpen(5, 'BTCUSDT', 2000, 8000)).toBe(true);
  });

  test('rollback: cutover off → entries return to client instantly, net unaffected', () => {
    const own = resolveOwnership({ clientPresent: false, atActive: true, credsValid: true, cutoverActive: false, underTakeControl: false });
    expect(own.entryOwner).toBe('CLIENT');
    expect(own.exitOwner.disasterBackstop).toBe('SERVER');
  });
});
