// QM Liquidation persistence — [BUG5.5.3]
// Snapshots QM.liqAgg + w.S.llvBuckets to localStorage so the 24h rolling
// liquidation map survives page reloads. Events older than WINDOW_MS are
// filtered on both save and load. Throttled to ~10s during active use,
// flushed synchronously on beforeunload.
import { QM } from '../state'

const w = window as any

const KEY = 'zt:qmLiq:v1'
const WINDOW_MS = 24 * 3600 * 1000
const SAVE_THROTTLE_MS = 10_000

type Snapshot = {
  v: 1
  t: number
  binance: any[]
  bybit: any[]
  okx: any[]
  llv: Record<string, any>
}

let _lastSaveTs = 0
let _saveIv: ReturnType<typeof setInterval> | null = null
let _unloadHandler: (() => void) | null = null

function filterFresh<T extends { time?: number; ts?: number }>(arr: T[], cutoff: number): T[] {
  return (arr || []).filter(e => {
    const t = e?.time ?? e?.ts ?? 0
    return !t || t >= cutoff
  })
}

export function saveLiqSnapshot(force = false): void {
  const now = Date.now()
  if (!force && now - _lastSaveTs < SAVE_THROTTLE_MS) return
  _lastSaveTs = now
  try {
    const cutoff = now - WINDOW_MS
    const llvRaw = (w.S && w.S.llvBuckets) || {}
    const llv: Record<string, any> = {}
    for (const k in llvRaw) {
      const b = llvRaw[k]
      if (b && b.ts && b.ts >= cutoff) llv[k] = b
    }
    const snap: Snapshot = {
      v: 1,
      t: now,
      binance: filterFresh(QM.liqAgg.binance.btc as any[], cutoff),
      bybit: filterFresh(QM.liqAgg.bybit.btc as any[], cutoff),
      okx: filterFresh(QM.liqAgg.okx.btc as any[], cutoff),
      llv,
    }
    localStorage.setItem(KEY, JSON.stringify(snap))
  } catch (_) { /* quota / JSON error — silent */ }
}

export function loadLiqSnapshot(): { restored: number } {
  let restored = 0
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { restored }
    const snap = JSON.parse(raw) as Snapshot
    if (!snap || snap.v !== 1) return { restored }
    const cutoff = Date.now() - WINDOW_MS

    const bnb = filterFresh(snap.binance || [], cutoff)
    const byb = filterFresh(snap.bybit || [], cutoff)
    const okx = filterFresh(snap.okx || [], cutoff)

    // Hydrate QM.liqAgg buffers + recompute totalBtc so the counter stays honest
    QM.liqAgg.binance.btc = bnb
    QM.liqAgg.binance.totalBtc = bnb.reduce((s: number, e: any) => s + (+e.vol || 0), 0)
    QM.liqAgg.bybit.btc = byb
    QM.liqAgg.bybit.totalBtc = byb.reduce((s: number, e: any) => s + (+e.vol || 0), 0)
    QM.liqAgg.okx.btc = okx
    QM.liqAgg.okx.totalBtc = okx.reduce((s: number, e: any) => s + (+e.vol || 0), 0)

    // Hydrate w.S.llvBuckets — merge with whatever already exists (live WS may
    // have pushed a few events before init completes)
    if (w.S) {
      w.S.llvBuckets = w.S.llvBuckets || {}
      const existing = w.S.llvBuckets
      for (const k in (snap.llv || {})) {
        const b = snap.llv[k]
        if (!b || !b.ts || b.ts < cutoff) continue
        if (!existing[k]) existing[k] = b
        else {
          existing[k].longUSD = (existing[k].longUSD || 0) + (b.longUSD || 0)
          existing[k].shortUSD = (existing[k].shortUSD || 0) + (b.shortUSD || 0)
          existing[k].longBTC = (existing[k].longBTC || 0) + (b.longBTC || 0)
          existing[k].shortBTC = (existing[k].shortBTC || 0) + (b.shortBTC || 0)
          existing[k].ts = Math.max(existing[k].ts || 0, b.ts)
        }
      }
    }

    restored = bnb.length + byb.length + okx.length + Object.keys(snap.llv || {}).length
  } catch (_) { /* JSON parse / storage error — silent */ }
  return { restored }
}

export function startLiqPersist(): void {
  stopLiqPersist()
  _saveIv = setInterval(() => saveLiqSnapshot(false), SAVE_THROTTLE_MS)
  _unloadHandler = () => saveLiqSnapshot(true)
  window.addEventListener('beforeunload', _unloadHandler)
  window.addEventListener('pagehide', _unloadHandler)
}

export function stopLiqPersist(): void {
  if (_saveIv) { clearInterval(_saveIv); _saveIv = null }
  if (_unloadHandler) {
    window.removeEventListener('beforeunload', _unloadHandler)
    window.removeEventListener('pagehide', _unloadHandler)
    _unloadHandler = null
  }
}
