// Zeus — engine/aresJournal.ts
// Ported 1:1 from public/js/brain/deepdive.js lines 1384-1461 (Phase 5B1)
// ARES Trade Journal — ML dataset collection

const w = window as any

const LS_KEY = 'ARES_JOURNAL_V1'
const MAX_ENTRIES = 200
let _journal: any[] = []
try { _journal = JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch (_) { _journal = [] }

function _save(): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(_journal)) } catch (_) { }
  if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('aresData')
  if (typeof w._userCtxPush === 'function') w._userCtxPush()
}

function recordOpen(decision: any, pos: any, markPrice: number): any {
  const entry = {
    id: pos.id,
    openTs: Date.now(),
    symbol: 'BTCUSDT',
    side: decision.side,
    entryPrice: markPrice,
    leverage: pos.leverage,
    notional: pos.notional,
    confidence: decision.confidence,
    inputs: {
      regime: decision.sources.regime || null,
      session: decision.sources.session || null,
      entryScore: decision.sources.entryScore || 0,
      atrPct: decision.sources.atrPct || 0,
      bullCount: decision.sources.bullCount || 0,
      bearCount: decision.sources.bearCount || 0,
      balance: decision.sources.balance || 0,
      openPositions: decision.sources.openPositions || 0,
      aresState: decision.sources.state || null,
    },
    reasons: decision.reasons,
    closeTs: null,
    closePrice: null,
    netPnl: null,
    closeReason: null,
    durationMs: null,
    outcome: null, // 'WIN' | 'LOSS' | 'NEUTRAL'
  }
  _journal.unshift(entry)
  if (_journal.length > MAX_ENTRIES) _journal = _journal.slice(0, MAX_ENTRIES)
  _save()
  return entry
}

function recordClose(posId: string, closeData: any): void {
  const entry = _journal.find(function (e: any) { return e.id === posId })
  if (!entry) return
  entry.closeTs = Date.now()
  entry.closePrice = closeData.closePrice || 0
  entry.netPnl = closeData.netPnl || 0
  entry.closeReason = closeData.closeReason || 'unknown'
  entry.durationMs = entry.closeTs - entry.openTs
  entry.outcome = entry.netPnl > 0 ? 'WIN' : (entry.netPnl < 0 ? 'LOSS' : 'NEUTRAL')
  _save()
}

function getAll(): any[] { return _journal }
function getCompleted(): any[] { return _journal.filter(function (e: any) { return e.closeTs !== null }) }

export const ARES_JOURNAL = { recordOpen, recordClose, getAll, getCompleted }
