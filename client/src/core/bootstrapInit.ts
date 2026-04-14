// Zeus — core/bootstrapInit.ts
// Ported 1:1 from public/js/core/bootstrap.js lines 6-367 (Chunk A)
// initZeusGroups, _waitForFeedThenStartExtras, _startExtras, runHealthChecks, _updatePnlLabCondensed

import { AT } from '../engine/events'
import { TP } from '../core/state'
import { el } from '../utils/dom'
import { _ZI } from '../constants/icons'
import { initModeBar } from '../ui/modebar'
import { _dslTrimAll, startDSLIntervals } from '../trading/dsl'
import { calcGlobalExpectancy } from '../engine/perfStore'
import { openPageView } from '../ui/pageview'
import { initZeusDock } from '../ui/dock'
import { DEV } from '../utils/dev'
import { runAutoTradeCheck , atLog } from '../trading/autotrade'
import { liveApiSyncState } from '../trading/liveApi'
const w = window as any // kept for w.S (bnbOk/bybOk/uiHealth SKIP), w.Intervals, atLog, fn calls

// ===== INIT ZEUS GROUPS (DOM structure) =====
export function initZeusGroups(): void {
  if (w.UI_BUILT) { console.warn('[ZEUS] initZeusGroups() called twice — skipping'); return }
  w.UI_BUILT = true
  const mi = document.getElementById('zeus-groups')
  if (!mi) { w.UI_BUILT = false; return }
  const _failedElements: string[] = []
  function _markPending(el: any) { if (el) el.classList.add('zg-pending-move') }
  function _recoverElement(el: any) { if (!el) return; el.classList.remove('zg-pending-move'); el.classList.add('zg-recovery-mode'); _failedElements.push(el.id || el.className || '(anon)') }
  function _showRecoveryBanner() { let banner: any = document.getElementById('zg-recovery-banner'); if (!banner) { banner = document.createElement('div'); banner.id = 'zg-recovery-banner'; document.body.insertAdjacentElement('afterbegin', banner) }; banner.innerHTML = '\u26A0\uFE0F Some panels could not load correctly. <strong>Click here to retry.</strong>'; banner.style.display = 'block'; banner.onclick = function () { w.UI_BUILT = false; document.querySelectorAll('.zg-recovery-mode').forEach((el: any) => el.classList.remove('zg-recovery-mode')); banner.style.display = 'none'; initZeusGroups() } }
  function mv(id: string, target: any) { const el = document.getElementById(id); if (!el) return; _markPending(el); if (!target) { _recoverElement(el); return }; if (el.parentElement === target) { el.classList.remove('zg-pending-move'); return }; if (target.contains && target !== el && target.contains(el)) { el.classList.remove('zg-pending-move'); return }; target.appendChild(el); el.classList.remove('zg-pending-move') }
  function mvSec(childSel: string, target: any) { try { const child = document.querySelector(childSel); if (!child) return; let node: any = child; while (node && node !== document.body) { if (node.classList && (node.classList.contains('sec') || node.classList.contains('znc') || node.classList.contains('bext') || node.classList.contains('dsl-zone') || node.classList.contains('at-panel') || node.classList.contains('trade-panel') || node.classList.contains('trade-sep') || node.classList.contains('at-sep'))) { _markPending(node); if (!target) { _recoverElement(node); return }; if (node.parentElement === target) { node.classList.remove('zg-pending-move'); return }; if (target.contains && target !== node && target.contains(node)) { node.classList.remove('zg-pending-move'); return }; target.appendChild(node); node.classList.remove('zg-pending-move'); return }; node = node.parentElement } } catch (_) { } }

  mv('zeus-mode-bar', mi); if (typeof initModeBar === 'function') initModeBar()
  mv('aub', mi); mv('sr-strip', mi); mv('csec', mi); mv('zeus-dock', mi)
  if (typeof w.initPageView === 'function') w.initPageView()
  initZeusDock()
  mv('aria-strip', mi); mv('teacher-strip', mi); mv('pnl-lab-strip', mi)
  mv('dsl-strip', mi); mv('at-strip', mi); mv('pt-strip', mi); mv('nova-strip', mi)
  mv('mtf-strip', mi); mv('adaptive-strip', mi); mv('actfeed-strip', mi)
  mv('zeusBrain', mi); mv('brainExt', mi)
  mvSec('#rsiupd', mi); mvSec('.dttabs', mi); mvSec('.conf-widget', mi); mvSec('.fgc', mi)
  mvSec('#frv', mi); mvSec('#askc', mi); mvSec('.srgrid', mi); mvSec('.lmcs', mi)
  mvSec('#tv', mi); mvSec('.fdlist', mi)
  mv('magSec', mi); mv('mscanSec', mi); mv('dhfSec', mi); mv('sigScanSec', mi)
  mv('deepdive-sec', mi); mv('scenario-sec', mi); mv('macro-sec', mi); mv('adaptive-sec', mi)
  if (DEV?.enabled) mv('dev-sec', mi)
  const _atPanel = document.getElementById('at-strip-panel')
  if (_atPanel) { mv('atPanel', _atPanel); mvSec('.at-sep', _atPanel) }
  const _ptPanel = document.getElementById('pt-strip-panel')
  if (_ptPanel) { mvSec('.trade-sep', _ptPanel); mv('panelDemo', _ptPanel); mv('panelLive', _ptPanel) }
  const _dslPanel = document.getElementById('dsl-strip-panel')
  if (_dslPanel) mv('dslZone', _dslPanel)
  mv('perfSec', mi); mv('btSec', mi)
  setTimeout(function () { document.querySelectorAll('.zg-pending-move').forEach(function (el: any) { console.warn('[ZEUS] Recovery: element stuck:', el.id || el.className); _recoverElement(el) }); if (_failedElements.length > 0) { console.warn('[ZEUS] Recovery mode for:', _failedElements); _showRecoveryBanner() }; if (!sessionStorage.getItem('zeusDock')) { const _sp = document.getElementById('_dockSplash'); if (_sp) _sp.remove() } }, 500)
  setTimeout(function () { const _sp = document.getElementById('_dockSplash'); if (_sp) _sp.remove() }, 5000)
}

// ===== FEED-GATED EXTRAS =====
export function _waitForFeedThenStartExtras(): void {
  w.Intervals.clear('feedWait')
  const MAX_WAIT_MS = 30000, CHECK_MS = 500
  let waited = 0
  w.Intervals.set('feedWait', () => {
    const feedOk = w.S.bnbOk || w.S.bybOk
    waited += CHECK_MS
    if (feedOk || waited >= MAX_WAIT_MS) {
      w.Intervals.clear('feedWait')
      if (!feedOk) atLog('warn', '[WARN] Extras started without confirmed feed (timeout)')
      else atLog('info', '[OK] Feed confirmed — starting DSL + scanner extras')
      // [MIGRATION-F0] Boot order: _userCtxPull → _startExtras (DoD #3)
      if (typeof w._ctxLoad === 'function') w._ctxLoad()
      if (typeof w._userCtxPull === 'function') w._userCtxPull()
      _startExtras()
      if (typeof w._ucRetryPendingBeacon === 'function') w._ucRetryPendingBeacon()
      try { const _sd = sessionStorage.getItem('zeusDock'); if (_sd) openPageView(_sd) } catch (_) { }
      const _sp = document.getElementById('_dockSplash'); if (_sp) _sp.remove()
    }
  }, CHECK_MS)
}

export function _startExtras(): void {
  startDSLIntervals()
  w.Intervals.set('dslTrim', _dslTrimAll, 300000)
  setTimeout(w.runMultiSymbolScan, 3000)
  w.Intervals.set('multiscan', () => { if (AT.enabled && el('atMultiSym')?.checked !== false) w.runMultiSymbolScan() }, 60000)
  w.Intervals.set('bbSave', () => { if (typeof w._aubSaveBB === 'function') w._aubSaveBB() }, 30000)
  atLog('info', '[INIT] Extras module online')
  w.Intervals.set('livePosSync', function () { if (typeof TP !== 'undefined' && TP.liveConnected && typeof liveApiSyncState === 'function') liveApiSyncState() }, 30000)
  if (typeof AT !== 'undefined' && AT.enabled && !AT.killTriggered) {
    console.log('[startApp] AT was enabled before reload — resuming')
    const _btn = el('atMainBtn'); if (_btn) _btn.className = 'at-main-btn on'
    const _dot = el('atBtnDot'); if (_dot) { _dot.style.background = 'var(--grn-bright)'; _dot.style.boxShadow = '0 0 10px var(--grn-bright)' }
    const _txt = el('atBtnTxt'); if (_txt) _txt.textContent = 'AUTO TRADE ON'
    const _st = el('atStatus'); if (_st) _st.innerHTML = _ZI.dGrn + ' Active — scanning every 30s'
    if (!AT.interval) AT.interval = w.Intervals.set('atCheck', runAutoTradeCheck, 30000)
    setTimeout(runAutoTradeCheck, 3000)
    if (typeof w.atUpdateBanner === 'function') w.atUpdateBanner()
    if (typeof w.ptUpdateBanner === 'function') w.ptUpdateBanner()
    atLog('info', '[RESUME] AutoTrade resumed from saved state')
  }
}

// ===== HEALTH CHECKS =====
export function runHealthChecks(): any {
  const checks: any = {}
  function _check(parentId: string, childSel?: string) { const parent = document.getElementById(parentId); if (!parent) return false; if (!childSel) return true; return !!parent.querySelector(childSel) }
  checks.mi = _check('zeus-groups', '.sec')
  checks.dsl = _check('dsl-strip-panel', '#dslZone')
  checks.at = _check('at-strip-panel', '#atPanel')
  checks.pt = _check('pt-strip-panel', '#panelDemo') && _check('pt-strip-panel', '#panelLive')
  console.log('[HEALTH] MI mounted:', checks.mi ? 'OK' : 'FAIL')
  console.log('[HEALTH] DSL mounted:', checks.dsl ? 'OK' : 'FAIL')
  console.log('[HEALTH] AT mounted:', checks.at ? 'OK' : 'FAIL')
  console.log('[HEALTH] PT mounted:', checks.pt ? 'OK' : 'FAIL')
  const anyFail = !checks.mi || !checks.dsl || !checks.at || !checks.pt
  if (typeof w.S !== 'undefined') { w.S.uiHealth = { mi: checks.mi, dsl: checks.dsl, at: checks.at, pt: checks.pt, ok: !anyFail, ts: Date.now() } }
  if (anyFail) {
    console.warn('[HEALTH] One or more modules failed to mount:', checks)
    let banner: any = document.getElementById('zg-health-banner')
    if (!banner) { banner = document.createElement('div'); banner.id = 'zg-health-banner'; const rb = document.getElementById('zg-recovery-banner'); if (rb) rb.insertAdjacentElement('afterend', banner); else document.body.insertAdjacentElement('afterbegin', banner) }
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k.toUpperCase()).join(', ')
    banner.innerHTML = _ZI.w + ` Incomplete interface — modules [${failed}] failed to load. Refresh the page.`
    banner.style.display = 'block'
  } else { const banner = document.getElementById('zg-health-banner'); if (banner) banner.style.display = 'none'; console.log('[HEALTH] All modules mounted OK') }
  return checks
}

// ===== PNL LAB CONDENSED =====
export function _updatePnlLabCondensed(): void {
  try {
    const ds = (typeof w.DAILY_STATS !== 'undefined') ? w.DAILY_STATS : null
    const cumEl = document.getElementById('pnl-lab-cum')
    const ddEl = document.getElementById('pnl-lab-dd')
    const expEl = document.getElementById('pnl-lab-exp')
    const hasData = ds && (ds.cumPnl !== 0 || ds.peak !== 0 || (ds.days && Object.keys(ds.days).length > 0))
    if (cumEl) { if (!hasData) { cumEl.textContent = 'PnL: \u2014'; cumEl.style.color = 'var(--dim)' } else { const c = ds.cumPnl || 0; cumEl.textContent = 'PnL: ' + (c >= 0 ? '+' : '') + '$' + c.toFixed(2); cumEl.style.color = c >= 0 ? 'var(--grn)' : 'var(--red)' } }
    if (ddEl) { if (!hasData) { ddEl.textContent = 'DD: \u2014'; ddEl.style.color = 'var(--dim)' } else { ddEl.textContent = 'DD: $' + (ds.currentDD || 0).toFixed(2); ddEl.style.color = ds.currentDD > 0 ? 'var(--red)' : 'var(--dim)' } }
    if (expEl) { if (typeof calcGlobalExpectancy !== 'function') { expEl.textContent = 'E: \u2014'; expEl.style.color = 'var(--dim)' } else { const e = calcGlobalExpectancy(); if (e === 0 && !hasData) { expEl.textContent = 'E: \u2014'; expEl.style.color = 'var(--dim)' } else { expEl.textContent = 'E: ' + (e >= 0 ? '+' : '') + '$' + e.toFixed(2); expEl.style.color = e > 0 ? 'var(--grn)' : e < 0 ? 'var(--red)' : 'var(--dim)' } } }
  } catch (_) { }
}
