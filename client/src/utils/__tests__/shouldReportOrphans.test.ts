import { describe, it, expect } from 'vitest'
import { shouldReportOrphans } from '../positionSource'

// [2026-06-15] Root cause of "kill switch keeps coming back after I deactivate it":
// liveApiSyncState reports orphans (exchange positions not in w._lastServerPositions)
// to /api/srv-pos/orphan-report, which ARMS the kill switch at 5 orphans in 5 min.
// During the boot/refresh window — before the AT-state sync populates
// _lastServerPositions — the operator's REAL positions look like orphans, so every
// refresh fires false orphans → the kill re-arms. Only report orphans when there is
// a loaded, non-empty server book to compare against; otherwise we can't distinguish
// a genuine orphan from "snapshot not arrived yet". (Genuine orphans on an empty
// server book are still caught by the server-side 60s exchange-truth recon.)
describe('shouldReportOrphans (boot-race / empty-snapshot guard)', () => {
  const orphans = [{ sym: 'BNBUSDT', side: 'SHORT' }]

  it('does NOT report while the server snapshot is not loaded yet (boot window)', () => {
    expect(shouldReportOrphans(false, [{ symbol: 'BNBUSDT', side: 'SHORT' }], orphans)).toBe(false)
  })

  it('does NOT report when there is no server book to compare against (empty snapshot)', () => {
    expect(shouldReportOrphans(true, [], orphans)).toBe(false)
    expect(shouldReportOrphans(true, undefined as any, orphans)).toBe(false)
  })

  it('DOES report a genuine orphan once the server book is loaded and non-empty', () => {
    expect(shouldReportOrphans(true, [{ symbol: 'BTCUSDT', side: 'SHORT' }], orphans)).toBe(true)
  })

  it('does NOT report when there are no orphans', () => {
    expect(shouldReportOrphans(true, [{ symbol: 'BTCUSDT', side: 'SHORT' }], [])).toBe(false)
  })
})
