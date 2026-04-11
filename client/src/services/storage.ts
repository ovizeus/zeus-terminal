/**
 * Zeus Terminal — Storage helpers (ported from public/js/data/storage.js)
 * Trade journal, localStorage, funding rate countdown, OI delta tracking
 *
 * NOTE: reads/writes old JS globals (TP, S, el, fP, escHtml, _ZI, toast, Intervals, oiHistory, etc.)
 * via window.* — these are still managed by bridge-loaded old JS.
 */

import { getTPObject, getSymbol, getFRCountdown, getOI } from './stateAccessors'
const w = window as Record<string, any> // kept for w.el, w.fP, w.escHtml, w.toast, w._ZI, w.Intervals, w.ZLOG, w.oiHistory, w.ZT_capArr, w.recordDailyClose
const TP = getTPObject()

export function _safeLocalStorageSet(key: string, data: unknown): boolean {
  try {
    const str = typeof data === 'string' ? data : JSON.stringify(data)
    if (str.length > 900000) { console.warn('[ZEUS] localStorage cap hit for key:', key, str.length, 'bytes'); return false }
    localStorage.setItem(key, str)
    return true
  } catch (e: any) { console.warn('[ZEUS] localStorage write failed:', key, e.message); return false }
}

export function addTradeToJournal(trade: Record<string, any>): void {
  TP.journal.unshift(trade)
  if (TP.journal.length > 200) TP.journal.length = 200
  renderTradeJournal()
  _safeLocalStorageSet('zt_journal', TP.journal.slice(0, 50))
  if (trade.journalEvent === 'CLOSE' && typeof w.recordDailyClose === 'function') w.recordDailyClose(trade)
}

export function renderTradeJournal(): void {
  const body = w.el('journalBody'); if (!body) return
  if (!TP.journal.length) { body.innerHTML = '<div style="padding:10px;text-align:center;font-size:12px;color:var(--dim)">No trades yet</div>'; return }
  body.innerHTML = TP.journal.map((t: any) => {
    const pnl = Number(t.pnl) || 0
    const win = pnl >= 0
    const pnlStr = (win ? '+' : '') + '$' + pnl.toFixed(2)
    const ep = '$' + w.fP(t.entry || 0) + '→$' + w.fP(t.exit || 0)
    const _time = typeof w.escHtml === 'function' ? w.escHtml(t.time || '') : (t.time || '')
    const _side = typeof w.escHtml === 'function' ? w.escHtml(t.side || '') : (t.side || '')
    const _reason = typeof w.escHtml === 'function' ? w.escHtml(t.reason || '—') : (t.reason || '—')
    return `<div class="journal-row ${win ? 'win' : 'loss'}">
      <span style="color:var(--dim)">${_time}</span>
      <span style="color:${t.side === 'LONG' ? 'var(--grn)' : 'var(--red)'}">${_side}</span>
      <span style="color:var(--dim);font-size:11px">${ep}</span>
      <span style="color:${win ? 'var(--grn)' : 'var(--red)'};font-weight:700">${pnlStr}</span>
      <span style="color:var(--dim);font-size:11px">${_reason}</span>
    </div>`
  }).join('')
}

export function loadJournalFromStorage(): void {
  try {
    const raw = localStorage.getItem('zt_journal')
    if (raw) { TP.journal = JSON.parse(raw); renderTradeJournal() }
  } catch (e: any) {
    console.warn('[loadJournalFromStorage] Parse failed:', e.message)
    if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('ERROR', '[loadJournalFromStorage] ' + e.message)
    TP.journal = []
  }
}

export function exportJournalCSV(): void {
  if (!TP.journal.length) { if (typeof w.toast === 'function') w.toast('No trades to export'); return }
  const hdr = 'Time,Side,Symbol,Entry,Exit,PnL,Leverage,Reason\n'
  function csvSafe(v: unknown): string { const s = String(v || ''); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s }
  const rows = TP.journal.map((t: any) =>
    `${csvSafe(t.time)},${csvSafe(t.side)},${csvSafe(t.sym || getSymbol().replace('USDT', ''))},${t.entry || 0},${t.exit || 0},${(Number(t.pnl) || 0).toFixed(2)},${csvSafe(t.lev || '—')},${csvSafe(t.reason || 'Manual')}`
  ).join('\n')
  const blob = new Blob([hdr + rows], { type: 'text/csv' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
  a.download = `zeus_journal_${new Date().toISOString().slice(0, 10)}.csv`
  a.click(); if (typeof w.toast === 'function') w.toast('Journal exported!', 0, w._ZI?.ok)
}

export function startFRCountdown(): void {
  w.Intervals.set('frCountdown', () => {
    const frCd = getFRCountdown(); if (!frCd) return
    const now = Date.now(); const rem = frCd - now
    if (rem <= 0) { const cd = w.el('frCd'); if (cd) cd.style.display = 'none'; return }
    const mm = Math.floor(rem / 60000); const ss = Math.floor((rem % 60000) / 1000)
    const str = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss
    const cd = w.el('frCd')
    if (cd) { cd.textContent = str; cd.style.display = 'inline'; cd.className = 'fr-cd' + (rem < 300000 ? ' warn' : '') }
    const dtfrc = w.el('dtfrc'); if (dtfrc) dtfrc.textContent = str
  }, 1000)
}

export function trackOIDelta(): void {
  const oi = getOI().oi
  if (!oi) return
  const now = Date.now()
  w.oiHistory.push({ oi: oi, ts: now })
  if (typeof w.ZT_capArr === 'function') w.ZT_capArr(w.oiHistory, 2000)
  while (w.oiHistory.length > 0 && w.oiHistory[0].ts < now - 1200000) w.oiHistory.shift()
  const t5 = now - 300000
  const old5 = w.oiHistory.find((h: any) => h.ts >= t5)
  const delta5 = w.el('oiDelta5m')
  if (delta5 && old5 && oi) {
    const pct = ((oi - old5.oi) / old5.oi * 100)
    if (Math.abs(pct) > 0.01) {
      delta5.style.display = 'inline'
      delta5.textContent = (pct > 0 ? '▲' : pct < 0 ? '▼' : '') + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%'
      delta5.className = 'oi-delta ' + (pct > 0 ? 'up' : 'dn')
    } else delta5.style.display = 'none'
  }
}
