/**
 * Zeus Terminal — Daily PnL aggregation (ported from public/js/analytics/dailyPnl.js)
 * [8B-rest] READS migrated to stateAccessors. WRITES remain on window.* (bridge).
 */

import { getTimezone, getJournal } from '../services/stateAccessors'
import { _safeLocalStorageSet } from '../services/storage'
import { estimateRoundTripFees } from '../trading/risk'

const w = window as Record<string, any> // kept for WRITES (w.DAILY_STATS)
const _DAILY_PNL_KEY = 'zeus_daily_pnl_v1'
const _DAILY_MAX_DAYS = 90

function _todayKey(tsOrDate?: number | Date): string {
  let d = tsOrDate instanceof Date ? tsOrDate : new Date(tsOrDate || Date.now())
  if (isNaN(d.getTime())) d = new Date()
  return new Intl.DateTimeFormat('en-CA', { timeZone: getTimezone() }).format(d)
}

function _updateDrawdown(ds: any): void {
  if (ds.cumPnl > ds.peak) ds.peak = ds.cumPnl
  ds.currentDD = ds.peak > 0 ? ds.peak - ds.cumPnl : 0
  if (ds.currentDD > ds.maxDD) ds.maxDD = ds.currentDD
}

function _pruneOldDays(ds: any): void {
  const keys = Object.keys(ds.days).sort()
  while (keys.length > _DAILY_MAX_DAYS) delete ds.days[keys.shift()!]
}

function _addTradeToDailyStats(ds: any, trade: any): void {
  const dateKey = _todayKey(trade.closedAt || trade.time || Date.now())
  if (!ds.days[dateKey]) ds.days[dateKey] = { trades: 0, wins: 0, losses: 0, grossPnl: 0, fees: 0, netPnl: 0 }
  const day = ds.days[dateKey]
  day.trades += 1
  if (trade.pnl >= 0) day.wins += 1; else day.losses += 1
  day.grossPnl += trade.pnl
  let fees = 0
  if (Number.isFinite(trade.fees)) fees = trade.fees
  else if (typeof estimateRoundTripFees === 'function' && Number.isFinite(trade.notional)) fees = (estimateRoundTripFees(trade.notional, 'taker', trade.profile || 'fast').total || 0)
  day.fees += fees; day.netPnl = day.grossPnl - day.fees
  ds.cumPnl += trade.pnl - fees; _updateDrawdown(ds)
}

export function recordDailyClose(trade: any): void {
  if (!trade || !Number.isFinite(trade.pnl)) return
  const ds = w.DAILY_STATS; if (!ds) return
  _addTradeToDailyStats(ds, trade); _pruneOldDays(ds); saveDailyPnl()
}

export function rebuildDailyFromJournal(): void {
  const ds = w.DAILY_STATS; if (!ds) return
  if (ds.days && Object.keys(ds.days).length > 0) { _reconcileJournalIntoDailyStats(ds); return }
  const journal = getJournal()
  ds.days = {}; ds.peak = 0; ds.currentDD = 0; ds.maxDD = 0; ds.cumPnl = 0
  journal.filter((t: any) => t.journalEvent === 'CLOSE' && t.exit !== null && Number.isFinite(t.pnl)).reverse().forEach((t: any) => _addTradeToDailyStats(ds, t))
  _pruneOldDays(ds); saveDailyPnl()
}

function _reconcileJournalIntoDailyStats(ds: any): void {
  const journal = getJournal()
  const closed = journal.filter((t: any) => t.journalEvent === 'CLOSE' && t.exit !== null && Number.isFinite(t.pnl))
  const journalCounts: Record<string, number> = {}
  closed.forEach((t: any) => { const dk = _todayKey(t.closedAt || t.time || Date.now()); journalCounts[dk] = (journalCounts[dk] || 0) + 1 })
  const todayKey = _todayKey(Date.now())
  const todayDS = ds.days[todayKey]; const todayJournal = journalCounts[todayKey] || 0
  if (todayJournal > 0 && (!todayDS || todayDS.trades < todayJournal)) {
    ds.days[todayKey] = { trades: 0, wins: 0, losses: 0, grossPnl: 0, fees: 0, netPnl: 0 }
    const prevCum = ds.cumPnl - (todayDS ? todayDS.netPnl : 0); ds.cumPnl = prevCum
    closed.filter((t: any) => _todayKey(t.closedAt || t.time || Date.now()) === todayKey).reverse().forEach((t: any) => _addTradeToDailyStats(ds, t))
    _pruneOldDays(ds); saveDailyPnl()
  }
}

export function getDailyStats(dateStr: string): any { return w.DAILY_STATS?.days?.[dateStr] || null }

export function getLastNDays(n = 7): any[] {
  if (!w.DAILY_STATS?.days) return []
  return Object.keys(w.DAILY_STATS.days).filter(k => { const d = w.DAILY_STATS.days[k]; return d && typeof d === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(k) })
    .sort().reverse().slice(0, n).map(k => { const d = w.DAILY_STATS.days[k]; return { date: k, trades: d.trades || 0, wins: d.wins || 0, losses: d.losses || 0, grossPnl: d.grossPnl || 0, fees: d.fees || 0, netPnl: d.netPnl || 0 } })
}

function _rollup(totalDays: number, periodDays: number): any[] {
  if (!w.DAILY_STATS?.days) return []
  const now = new Date(); const buckets: any[] = []
  for (let i = 0; i < Math.ceil(totalDays / periodDays); i++) buckets.push({ start: '', end: '', trades: 0, wins: 0, losses: 0, grossPnl: 0, fees: 0, netPnl: 0 })
  Object.keys(w.DAILY_STATS.days).sort().reverse().forEach(dayKey => {
    const d = w.DAILY_STATS.days[dayKey]; if (!d || typeof d !== 'object') return
    const dt = new Date(dayKey + 'T00:00:00'); if (isNaN(dt.getTime())) return
    const daysAgo = Math.floor((now.getTime() - dt.getTime()) / 86400000)
    if (daysAgo < 0 || daysAgo >= totalDays || !Number.isFinite(daysAgo)) return
    const idx = Math.floor(daysAgo / periodDays); if (idx < 0 || idx >= buckets.length) return
    const b = buckets[idx]
    b.trades += (d.trades || 0); b.wins += (d.wins || 0); b.losses += (d.losses || 0)
    b.grossPnl += (d.grossPnl || 0); b.fees += (d.fees || 0); b.netPnl += (d.netPnl || 0)
    if (!b.end || dayKey > b.end) b.end = dayKey; if (!b.start || dayKey < b.start) b.start = dayKey
  })
  return buckets.filter(b => b.trades > 0)
}

export function getWeeklyRollup(): any[] { return _rollup(28, 7) }
export function getMonthlyRollup(): any[] { return _rollup(90, 30) }

export function getDrawdownStats(): { peak: number; currentDD: number; maxDD: number; cumPnl: number; recoveryFactor: number } {
  if (!w.DAILY_STATS) return { peak: 0, currentDD: 0, maxDD: 0, cumPnl: 0, recoveryFactor: 0 }
  const rf = w.DAILY_STATS.maxDD > 0 ? w.DAILY_STATS.cumPnl / w.DAILY_STATS.maxDD : 0
  return { peak: w.DAILY_STATS.peak || 0, currentDD: w.DAILY_STATS.currentDD || 0, maxDD: w.DAILY_STATS.maxDD || 0, cumPnl: w.DAILY_STATS.cumPnl || 0, recoveryFactor: Math.round(rf * 100) / 100 }
}

export function saveDailyPnl(): void {
  try {
    if (!w.DAILY_STATS) return
    const payload = { days: w.DAILY_STATS.days, peak: w.DAILY_STATS.peak, currentDD: w.DAILY_STATS.currentDD, maxDD: w.DAILY_STATS.maxDD, cumPnl: w.DAILY_STATS.cumPnl }
    _safeLocalStorageSet(_DAILY_PNL_KEY, payload)
    if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('dailyPnl')
    if (typeof w._userCtxPush === 'function') w._userCtxPush()
  } catch (e: any) { console.warn('[dailyPnl] save failed:', e.message) }
}

export function loadDailyPnl(): void {
  try {
    const raw = localStorage.getItem(_DAILY_PNL_KEY); if (!raw) return
    const data = JSON.parse(raw); if (!data || typeof data !== 'object') return
    if (data.days && typeof data.days === 'object') {
      const clean: Record<string, any> = {}
      Object.keys(data.days).forEach(k => { const d = data.days[k]; if (d && typeof d === 'object' && Number.isFinite(d.trades) && /^\d{4}-\d{2}-\d{2}$/.test(k)) clean[k] = d })
      w.DAILY_STATS.days = clean
    }
    if (Number.isFinite(data.peak)) w.DAILY_STATS.peak = data.peak
    if (Number.isFinite(data.currentDD)) w.DAILY_STATS.currentDD = data.currentDD
    if (Number.isFinite(data.maxDD)) w.DAILY_STATS.maxDD = data.maxDD
    if (Number.isFinite(data.cumPnl)) w.DAILY_STATS.cumPnl = data.cumPnl
    _pruneOldDays(w.DAILY_STATS)
  } catch (e: any) { console.warn('[dailyPnl] load failed:', e.message) }
}

export function resetDailyPnl(): void {
  if (!w.DAILY_STATS) return
  w.DAILY_STATS.days = {}; w.DAILY_STATS.peak = 0; w.DAILY_STATS.currentDD = 0; w.DAILY_STATS.maxDD = 0; w.DAILY_STATS.cumPnl = 0
  saveDailyPnl()
}
