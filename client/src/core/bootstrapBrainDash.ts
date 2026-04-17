// Zeus — core/bootstrapBrainDash.ts
// Ported 1:1 from public/js/core/bootstrap.js lines 2804-3191 (Chunk F)
// Brain Vision (V2) + Brain Dashboard (Reflection Engine) — both IIFEs with polling

import { useBrainStore } from '../stores/brainStore'
import { useATStore } from '../stores/atStore'

// ===== BRAIN VISION V2 — LOCAL REAL-TIME (reads from brainStore/atStore, fallback window.*) =====
;(function () {
  const w = window as any
  let _bvTimer: any = null

  function _c(dir: any) { return dir === 'bull' || dir === 'up' || dir === 'LONG' ? '#00ff88' : dir === 'bear' || dir === 'down' || dir === 'SHORT' ? '#ff3355' : '#556677' }
  function _dot(status: any) { return status === 'ok' ? '<span style="color:#00ff88">\u25CF</span>' : status === 'fail' ? '<span style="color:#ff3355">\u25CF</span>' : '<span style="color:#f0c040">\u25CF</span>' }
  function _badge(text: string, color: string, bg?: string) { return '<span style="background:' + (bg || color + '22') + ';color:' + color + ';font-size:8px;padding:1px 5px;border-radius:2px;letter-spacing:1px;font-weight:600">' + text + '</span>' }
  function _row(label: string, value: string) { return '<div style="padding:1px 0"><span style="color:#556677;width:72px;display:inline-block;font-weight:600;font-size:10px">' + label + '</span>' + value + '</div>' }

  function _bvRenderLocal() {
    const body = document.getElementById('brainVisionBody')
    const cycleEl = document.getElementById('brainVisionCycle')
    if (!body) return
    // Read from Zustand stores (single source of truth in React)
    let BM: any, _brainState: string, _thoughts: any[], _adaptParams: any, _blockReason: any, _atEnabled: boolean, _atKill: boolean, _atTrades: number, _atWins: number
    try {
      /* stores imported statically above */
      const bs = useBrainStore.getState()
      const as2 = useATStore.getState()
      BM = bs.brain; _brainState = bs.brainState
      _thoughts = bs.thoughts; _adaptParams = bs.adaptParams; _blockReason = bs.blockReason
      _atEnabled = as2.enabled; _atKill = as2.killTriggered; _atTrades = as2.totalTrades; _atWins = as2.wins
    } catch (_) {
      // Fallback to window.* if stores not loaded yet
      BM = w.BM; _brainState = w.BRAIN?.state || 'scanning'
      _thoughts = w.BRAIN?.thoughts || []; _adaptParams = w.BRAIN?.adaptParams; _blockReason = null
      _atEnabled = w.AT?.enabled || false; _atKill = w.AT?.killTriggered || false
      _atTrades = w.AT?.totalTrades || 0; _atWins = w.AT?.wins || 0
    }
    const S = w.S // S still needed for price/symbol (will be migrated in Phase 8)
    if (!BM || !S) { body.innerHTML = '<div style="color:#334455;padding:4px 0">Initializing brain...</div>'; return }

    if (cycleEl) cycleEl.textContent = (_brainState || 'idle').toUpperCase()
    let h = ''

    // ── HEADER: Symbol + Price + Regime
    const sym = (S.symbol || 'BTCUSDT').replace('USDT', '')
    const price = S.price ? '$' + Number(S.price).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '$—'
    const regime = BM.regimeEngine?.regime || BM.structure?.regime || '—'
    const regimeConf = BM.regimeEngine?.confidence || BM.structure?.score || 0
    h += '<div style="padding:3px 0 4px;border-bottom:1px solid rgba(120,80,220,0.15)">'
    h += '<span style="color:#aa88ff;font-weight:bold;font-size:10px;letter-spacing:1px">' + sym + '</span> '
    h += '<span style="color:#8899aa;font-size:9px">' + price + '</span> '
    h += _badge(regime, '#cc88ff')
    h += ' <span style="color:#556677;font-size:8px">' + regimeConf + '%</span>'
    h += '</div>'

    // ── BRAIN STATE + CONFLUENCE
    const state = _brainState || 'scanning'
    const stateCol = state === 'ready' ? '#00ff88' : state === 'trading' ? '#f0c040' : state === 'blocked' ? '#ff3355' : state === 'analyzing' ? '#00aaff' : '#556677'
    const conf = BM.confluenceScore || 0
    const confCol = conf >= 68 ? '#00ff88' : conf >= 50 ? '#f0c040' : '#ff3355'
    h += _row('STATE', _badge(state.toUpperCase(), stateCol) + ' <span style="color:' + confCol + ';font-weight:700;font-size:11px">CONF:' + conf + '</span>')

    // ── AT STATUS
    const atOn = _atEnabled ? 'ON' : 'OFF'
    const atCol = _atEnabled ? '#00ff88' : '#ff3355'
    h += _row('AT', _badge(atOn, atCol) + (_atKill ? ' ' + _badge('KILL', '#ff3355') : '') + ' <span style="color:#556677">trades:' + _atTrades + ' W:' + _atWins + '</span>')

    // ── GATES (7 gates)
    const gates = BM.gates || {}
    const gateNames = ['mtf', 'flow', 'trigger', 'session', 'adx', 'risk', 'news']
    let gateHtml = ''
    for (let i = 0; i < gateNames.length; i++) {
      const g = gateNames[i]; const val = gates[g] || 'wait'
      gateHtml += _dot(val) + '<span style="color:#445566;font-size:8px;margin:0 4px 0 1px">' + g.toUpperCase() + '</span>'
    }
    h += _row('GATES', gateHtml)

    // ── SIGNALS
    const sd = S.signalData || {}
    const bulls = sd.bullCount || 0; const bears = sd.bearCount || 0
    const sigCol = (bulls + bears) >= 3 ? '#00ff88' : '#f0c040'
    h += _row('SIGNALS', '<span style="color:#00ff88">\u25B2' + bulls + '</span> <span style="color:#ff3355">\u25BC' + bears + '</span> <span style="color:' + sigCol + '">= ' + (bulls + bears) + '</span>')

    // ── MTF ALIGNMENT
    const mtf = BM.mtf || {}
    let mtfHtml = ''
    const tfs = ['4h', '1h', '15m']
    for (let i = 0; i < tfs.length; i++) { const tf = tfs[i]; const dir = mtf[tf] || 'neut'; mtfHtml += '<span style="color:' + _c(dir) + ';margin-right:4px">' + tf + ':' + (dir === 'bull' ? '\u2191' : dir === 'bear' ? '\u2193' : '\u2194') + '</span>' }
    h += _row('MTF', mtfHtml)

    // ── REGIME DETAIL
    const re = BM.regimeEngine || {}
    const bias = re.trendBias || 'neutral'
    h += _row('REGIME', '<span style="color:' + _c(bias) + '">' + (re.regime || '—') + '</span> <span style="color:#556677">bias:' + bias + ' trap:' + (re.trapRisk || 0) + '%</span>')

    // ── ATMOSPHERE
    const atm = BM.atmosphere || {}
    if (atm.category) {
      const atmCol = atm.allowEntry ? '#00ff88' : atm.cautionLevel === 'high' ? '#ff3355' : '#f0c040'
      h += _row('ATMOS', _badge(atm.category, atmCol) + ' <span style="color:#556677">' + (atm.reasons || []).slice(0, 2).join(', ') + '</span>')
    }

    // ── FLOW
    const flow = BM.flow || {}
    if (flow.cvd || flow.delta) {
      h += _row('FLOW', 'CVD:<span style="color:' + _c(flow.cvd) + '">' + (flow.cvd || '—') + '</span> \u0394:<span style="color:' + (flow.delta > 0 ? '#00ff88' : flow.delta < 0 ? '#ff3355' : '#556677') + '">' + (flow.delta || 0) + '</span> OFI:<span style="color:' + _c(flow.ofi) + '">' + (flow.ofi || '—') + '</span>')
    }

    // ── DANGER + CONVICTION
    const danger = BM.danger || 0; const conv = BM.conviction || 0; const convMult = BM.convictionMult || 0
    const dangerCol = danger > 60 ? '#ff3355' : danger > 30 ? '#f0c040' : '#00ff88'
    const convCol = conv > 70 ? '#00ff88' : conv > 40 ? '#f0c040' : '#ff3355'
    h += _row('DANGER', '<span style="color:' + dangerCol + ';font-weight:700">' + danger + '</span> <span style="color:#445566">|</span> <span style="color:#556677">CONV:</span><span style="color:' + convCol + ';font-weight:700">' + conv + '</span> <span style="color:#556677">\u00D7' + convMult.toFixed(2) + '</span>')

    // ── VOLATILITY
    const volR = BM.volRegime || '—'; const volP = BM.volPct || 0
    const volCol = volR === 'EXTREME' ? '#ff2244' : volR === 'HIGH' ? '#ff6644' : volR === 'MED' ? '#f0c040' : '#668899'
    h += _row('VOL', '<span style="color:' + volCol + '">' + volR + '</span> <span style="color:#556677">P' + volP + '</span>')

    // ── PHASE FILTER
    const pf = BM.phaseFilter || {}
    if (pf.phase) {
      const pfCol = pf.allow ? '#00ff88' : '#ff3355'
      h += _row('PHASE', _badge(pf.phase, pfCol) + ' <span style="color:#556677">' + (pf.riskMode || '') + ' size:\u00D7' + (pf.sizeMultiplier || 1) + '</span>')
    }

    // ── PROTECT MODE
    if (BM.protectMode) {
      h += _row('PROTECT', _badge('ACTIVE', '#ff3355', '#ff335533') + ' <span style="color:#ff6655">' + (BM.protectReason || '—') + '</span>')
    }

    // ── BLOCK REASON
    if (_blockReason && _blockReason.code) {
      h += _row('BLOCK', '<span style="color:#ff3355;font-weight:700">' + _blockReason.code + '</span> <span style="color:#ff8866">' + (_blockReason.text || '') + '</span>')
    }

    // ── ADAPT PARAMS
    if (_adaptParams && _adaptParams.adjustCount > 0) {
      h += _row('ADAPT', '<span style="color:#f0c040">SL:' + (_adaptParams.sl || '—') + '% Size:$' + (_adaptParams.size || '—') + ' (\u00D7' + _adaptParams.adjustCount + ' adj)</span>')
    }

    // ── THOUGHTS (last 5)
    const _recentThoughts = _thoughts || []
    if (_recentThoughts.length > 0) {
      h += '<div style="border-top:1px solid rgba(120,80,220,0.1);margin-top:4px;padding-top:3px">'
      h += '<span style="color:#aa88ff;font-size:8px;letter-spacing:1.5px;font-weight:600">THOUGHTS</span>'
      const recent = _recentThoughts.slice(-5)
      for (let i = recent.length - 1; i >= 0; i--) {
        const t = recent[i]
        const col = t.type === 'ok' ? '#00ff88' : t.type === 'bad' ? '#ff3355' : t.type === 'warn' ? '#f0c040' : '#668899'
        const ago = Math.round((Date.now() - (t.time || 0)) / 60000)
        h += '<div style="color:' + col + ';font-size:9px;padding:0 0 1px;opacity:' + (1 - i * 0.15) + '"><span style="color:#445566">' + ago + 'm</span> ' + (t.msg || '').replace(/</g, '&lt;').slice(0, 80) + '</div>'
      }
      h += '</div>'
    }

    body.innerHTML = h
  }

  function _bvInit() {
    const wrap = document.getElementById('brainVisionWrap'); if (!wrap) return
    setTimeout(_bvRenderLocal, 3000)
    if (_bvTimer) clearInterval(_bvTimer)
    _bvTimer = setInterval(_bvRenderLocal, 5000) // refresh every 5s
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bvInit)
  else setTimeout(_bvInit, 1000)
})()

// ===== BRAIN DASHBOARD (Reflection Engine) =====
;(function () {
  let _bdData: any = null
  let _bdTimer: any = null

  function _bdCard(label: string, value: any, color: string) { return '<div style="background:rgba(20,30,50,0.5);padding:2px 4px;border-radius:2px;text-align:center"><div style="color:#445566;font-size:10px">' + label + '</div><div style="color:' + (color || '#aabbcc') + ';font-size:13px;font-weight:bold">' + value + '</div></div>' }
  function _esc(s: any) { return (s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

  function _bdRender() {
    const body = document.getElementById('brainDashBody'); const scoreEl = document.getElementById('brainDashScore')
    if (!body || !_bdData) return; let html = ''
    const thoughts = _bdData.thoughts || []
    if (thoughts.length > 0) { html += '<div style="color:#3ab4dc;margin-bottom:3px;font-size:11px;letter-spacing:1px;font-weight:600">LIVE THINKING</div>'; const recent = thoughts.slice(-8); for (let i = recent.length - 1; i >= 0; i--) { const t = recent[i]; const sev = t.severity || 'info'; const col = sev === 'critical' ? '#ff3355' : sev === 'warning' ? '#ffaa00' : '#668899'; const icon = sev === 'critical' ? '\u25CF' : sev === 'warning' ? '\u25B2' : '\u25CB'; const ago = Math.round((Date.now() - t.ts) / 60000); html += '<div style="color:' + col + ';padding:1px 0;border-bottom:1px solid rgba(50,70,90,0.2)">' + icon + ' <span style="color:#557788">' + ago + 'm</span> ' + _esc(t.text) + '</div>' } }
    else { html += '<div style="color:#334455;font-style:italic">Waiting for trades to reflect on...</div>' }
    const ss = _bdData.selfScore
    if (ss) { html += '<div style="color:#3ab4dc;margin:6px 0 3px;font-size:11px;letter-spacing:1px;font-weight:600">SELF-SCORE</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px">'; html += _bdCard('Accuracy', ss.accuracyToday != null ? ss.accuracyToday + '%' : '\u2014', ss.accuracyToday >= 60 ? '#22cc66' : ss.accuracyToday != null ? '#ff6644' : '#445566'); html += _bdCard('Streak', ss.streak + 'W', ss.streak >= 3 ? '#22cc66' : '#778899'); html += _bdCard('Best', ss.bestStreak + 'W', '#aa88ff'); html += _bdCard('Decisions', ss.decisionsToday || 0, '#778899'); html += _bdCard('Avoided', ss.avoidedLosses || 0, '#22cc66'); html += _bdCard('Regret', ss.regretTrades || 0, ss.regretTrades > 3 ? '#ff6644' : '#778899'); html += '</div>'; if (scoreEl) scoreEl.textContent = ss.accuracyToday != null ? 'Accuracy: ' + ss.accuracyToday + '%' : '' }
    const rules = _bdData.learnedRules || []
    if (rules.length > 0) { html += '<div style="color:#3ab4dc;margin:6px 0 3px;font-size:11px;letter-spacing:1px;font-weight:600">LEARNED RULES (' + rules.length + ')</div>'; for (let r = 0; r < Math.min(rules.length, 8); r++) { const rule = rules[r]; html += '<div style="color:#aabbcc;padding:1px 0"><span style="color:#ffaa00">#' + rule.id + '</span> ' + _esc(rule.rule) + (rule.blockEntry ? ' <span style="color:#ff3355">[BLOCK]</span>' : '') + ' <span style="color:#556677">hits:' + (rule.hitCount || 0) + '</span></div>' } }
    const dsl = _bdData.dslRecommendations || []
    if (dsl.length > 0) { html += '<div style="color:#3ab4dc;margin:6px 0 3px;font-size:11px;letter-spacing:1px;font-weight:600">DSL RECOMMENDATIONS</div>'; for (let d = 0; d < dsl.length; d++) { const rec = dsl[d]; html += '<div style="color:#ffbb44;padding:1px 0"><span style="color:#778899">' + (rec.regime || '') + '</span> ' + rec.param + ': <span style="color:#ff6644">' + rec.current + '</span> \u2192 <span style="color:#22cc66">' + rec.recommended + '</span> <span style="color:#556677">' + _esc(rec.reason || '') + '</span></div>' } }
    const cal = _bdData.calibration || {}; const calKeys = Object.keys(cal)
    if (calKeys.length > 0) { html += '<div style="color:#3ab4dc;margin:6px 0 3px;font-size:11px;letter-spacing:1px;font-weight:600">CONFIDENCE CALIBRATION</div><div style="display:flex;gap:4px;flex-wrap:wrap">'; for (let c = 0; c < calKeys.length; c++) { const k = calKeys[c]; const cv = cal[k]; const gapCol = cv.gap > 5 ? '#22cc66' : cv.gap < -10 ? '#ff3355' : '#778899'; html += '<div style="background:rgba(30,40,60,0.5);padding:2px 4px;border-radius:2px"><span style="color:#556677">' + k + '</span> <span style="color:' + gapCol + '">' + (cv.gap > 0 ? '+' : '') + cv.gap + '%</span> <span style="color:#445566">(' + cv.samples + ')</span></div>' }; html += '</div>' }
    const ap = _bdData.antiPatterns || []
    if (ap.length > 0) { html += '<div style="color:#3ab4dc;margin:6px 0 3px;font-size:11px;letter-spacing:1px;font-weight:600">ANTI-PATTERNS (' + ap.length + ')</div>'; for (let a = 0; a < Math.min(ap.length, 6); a++) { const pat = ap[a]; html += '<div style="color:#ff8866;padding:1px 0">' + _esc(pat.pattern) + ' <span style="color:#556677">\u00D7' + pat.occurrences + '</span> <span style="color:#ff3355">' + Math.round((pat.lossRate || 0) * 100) + '% loss</span></div>' } }
    const reviews = _bdData.sessionReviews || []
    if (reviews.length > 0) { const rev = reviews[reviews.length - 1]; html += '<div style="color:#3ab4dc;margin:6px 0 3px;font-size:11px;letter-spacing:1px;font-weight:600">SESSION REVIEW</div>'; const wrCol = rev.winRate >= 60 ? '#22cc66' : rev.winRate < 40 ? '#ff3355' : '#ffaa00'; html += '<div style="color:#aabbcc">' + rev.trades + ' trades | <span style="color:#22cc66">' + rev.wins + 'W</span> / <span style="color:#ff3355">' + rev.losses + 'L</span> | WR: <span style="color:' + wrCol + '">' + rev.winRate + '%</span> | PnL: <span style="color:' + (rev.totalPnl >= 0 ? '#22cc66' : '#ff3355') + '">$' + (rev.totalPnl || 0).toFixed(2) + '</span></div>'; if (rev.conclusions && rev.conclusions.length > 0) { for (let ci = 0; ci < rev.conclusions.length; ci++) { html += '<div style="color:#8899aa;padding:1px 0">\u25B8 ' + _esc(rev.conclusions[ci]) + '</div>' } } }
    body.innerHTML = html
  }

  function _bdPoll() { fetch('/api/brain/dashboard', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null }).then(function (data: any) { if (data) { _bdData = data; _bdRender() } }).catch(function () { }) }

  // DOMContentLoaded already fired in React SPA — start directly
  function _bdInit() {
    const wrap = document.getElementById('brainDashWrap'); if (!wrap) return
    setTimeout(_bdPoll, 5000); _bdTimer = setInterval(_bdPoll, 30000)
    void _bdTimer
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bdInit)
  else setTimeout(_bdInit, 500)
})()

export {}
