// Zeus — core/bootstrapBrainDash.ts
// Ported 1:1 from public/js/core/bootstrap.js lines 2804-3191 (Chunk F)
// Brain Vision (V2) + Brain Dashboard (Reflection Engine) — both IIFEs with polling

// ===== BRAIN VISION V2 =====
;(function () {
  let _bvTimer: any = null
  let _bvData: any = null

  function _bvColor(dir: any) { if (dir === 'bull' || dir === 'up' || dir === 'LONG' || dir === 'bullish') return 'var(--grn-bright)'; if (dir === 'bear' || dir === 'down' || dir === 'SHORT' || dir === 'bearish') return 'var(--red)'; return 'rgba(255,255,255,0.35)' }
  function _bvArrow(dir: any) { if (dir === 'bull' || dir === 'up' || dir === 'LONG') return '\u2191'; if (dir === 'bear' || dir === 'down' || dir === 'SHORT') return '\u2193'; return '\u2194' }
  function _bvDot(dir: any) { return '<span style="color:' + _bvColor(dir) + '">\u25CF</span>' }
  function _bvDelta(v: any) { if (!v && v !== 0) return '\u2014'; const sign = v >= 0 ? '+' : ''; const color = v > 0 ? 'var(--grn-bright)' : v < 0 ? 'var(--red)' : 'rgba(255,255,255,0.35)'; return '<span style="color:' + color + '">' + sign + (v >= 1000 || v <= -1000 ? (v / 1000).toFixed(1) + 'K' : v) + '</span>' }

  function _bvRender() {
    const body = document.getElementById('brainVisionBody'); const cycleEl = document.getElementById('brainVisionCycle')
    if (!body || !_bvData) return; if (cycleEl) cycleEl.textContent = 'C' + (_bvData.cycle || 0)
    const syms = _bvData.symbols; if (!syms || Object.keys(syms).length === 0) { body.innerHTML = '<div style="color:var(--dim);padding:4px 0">Waiting for data...</div>'; return }
    let html = ''
    for (const sym in syms) {
      const d = syms[sym]; const short = sym.replace('USDT', '')
      html += '<div style="border-top:1px solid rgba(120,80,220,0.1);padding:5px 0 2px;margin-top:3px"><span style="color:#aa88ff;font-weight:bold;font-size:9px;letter-spacing:1px">' + short + '</span> <span style="color:var(--dim);font-size:7px">$' + (d.price || 0).toLocaleString() + '</span> <span style="background:rgba(120,80,220,0.15);color:#cc88ff;font-size:7px;padding:1px 4px;border-radius:2px;letter-spacing:1px">' + (d.regime || '?') + '</span></div>'
      let mtfHtml = ''; const tfOrder = ['4h', '1h', '15m', '5m']; for (let i = 0; i < tfOrder.length; i++) { const tf = tfOrder[i]; const m = d.mtf[tf]; if (!m) continue; mtfHtml += '<span style="margin-right:5px">' + tf + ':' + _bvDot(m.st) + '</span>' }
      if (mtfHtml) html += '<div style="padding:1px 0;color:rgba(255,255,255,0.5)"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">MTF</span>' + mtfHtml + '</div>'
      const structColor = _bvColor(d.structure.trend); let structLabel = d.structure.trend || 'none'; if (d.structure.choch) structLabel = 'CHoCH ' + _bvArrow(d.structure.choch); else if (d.structure.bos) structLabel = 'BOS ' + _bvArrow(d.structure.bos)
      html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">STRUCT</span><span style="color:' + structColor + '">' + structLabel + '</span> <span style="color:var(--dim)">(' + d.structure.score + '%)</span></div>'
      html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">FLOW</span>CVD:' + _bvDelta(d.flow.delta5m); if (d.flow.poc) html += ' <span style="color:var(--dim)">POC:$' + d.flow.poc.toLocaleString() + '</span>'; if (d.flow.absorption > 30) html += ' <span style="color:#ffaa00">ABS:' + d.flow.absorption + '%</span>'; html += '</div>'
      const sentColor = d.sentiment.score > 15 ? '#00ff88' : d.sentiment.score < -15 ? '#ff4466' : 'rgba(255,255,255,0.35)'; html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">SENT</span><span style="color:' + sentColor + '">' + (d.sentiment.score > 0 ? '+' : '') + d.sentiment.score + '</span> <span style="color:var(--dim)">crowd:' + (d.sentiment.crowd || '?') + ' fund:' + (d.sentiment.funding || '?') + '</span></div>'
      html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">LIQ</span>'; if (d.liquidity.above) html += '<span style="color:#ff4466">\u2191$' + d.liquidity.above.toLocaleString() + '</span> '; if (d.liquidity.below) html += '<span style="color:#00ff88">\u2193$' + d.liquidity.below.toLocaleString() + '</span> '; html += '<span style="color:var(--dim)">' + d.liquidity.zones + 'z</span>'; if (d.liquidity.grabRisk > 30) html += ' <span style="color:#ffaa00">GRAB:' + d.liquidity.grabRisk + '%</span>'; html += '</div>'
      html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">PARAMS</span><span style="color:rgba(255,255,255,0.45)">conf\u2265' + d.regimeParams.confMin + ' SL\u00D7' + d.regimeParams.slMult + ' RR\u2265' + d.regimeParams.rrMin + ' DSL:' + d.regimeParams.dsl + ' size:' + (d.regimeParams.sizeScale * 100) + '%</span></div>'
      if (d.knn) { const knnColor = d.knn.winRate >= 60 ? '#00ff88' : d.knn.winRate <= 40 ? '#ff4466' : '#ffaa00'; html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">KNN</span><span style="color:' + knnColor + '">' + d.knn.winRate + '% WIN</span> <span style="color:var(--dim)">dir:' + (d.knn.dir || '?') + ' sim:' + (d.knn.similarity || '?') + '% ' + d.knn.patterns + ' patterns</span></div>' }
      if (d.journal) { const jColor = d.journal.winRate >= 50 ? '#00ff88' : '#ff4466'; html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">LEARN</span><span style="color:' + jColor + '">WR:' + d.journal.winRate + '%</span> <span style="color:var(--dim)">' + d.journal.trades + ' trades</span>'; if (d.journal.bestRegime) html += ' <span style="color:#00ff88">best:' + d.journal.bestRegime + '</span>'; if (d.journal.worstRegime) html += ' <span style="color:#ff4466">avoid:' + d.journal.worstRegime + '</span>'; html += '</div>' }
      if (d.volatility && d.volatility.score > 10) { const vol = d.volatility; const volCol = vol.level === 'EXTREME' ? '#ff2244' : vol.level === 'HIGH' ? '#ff6644' : vol.level === 'ELEVATED' ? '#ffaa00' : '#668899'; html += '<div style="padding:1px 0"><span style="color:' + volCol + ';width:65px;display:inline-block;font-weight:600">VOL</span><span style="color:' + volCol + '">' + vol.level + '</span> <span style="color:var(--dim)">ATR:P' + (vol.atrPct || 50) + ' SL\u00D7' + (vol.slMult || 1) + '</span></div>' }
      if (d.regimeTransition && d.regimeTransition.transitioning) { const rt = d.regimeTransition; html += '<div style="padding:1px 0"><span style="color:#ffaa00;width:65px;display:inline-block;font-weight:600">\u26A1 SHIFT</span><span style="color:#ffaa00">' + rt.from + ' \u2192 ' + rt.to + '</span></div>' }
      if (d.volatilityForecast && d.volatilityForecast.score > 15) { const vf = d.volatilityForecast; const vfCol = vf.level === 'high' ? '#ff3355' : '#ffaa00'; html += '<div style="padding:1px 0"><span style="color:' + vfCol + ';width:65px;display:inline-block;font-weight:600">\u26A1 VOL</span><span style="color:' + vfCol + '">' + vf.level.toUpperCase() + ' (' + vf.score + ')</span></div>' }
    }
    const v3 = _bvData.v3
    if (v3) {
      html += '<div style="border-top:1px solid rgba(120,80,220,0.2);margin-top:5px;padding-top:5px"><span style="color:#44aaff;font-size:9px;letter-spacing:1.5px;font-weight:600">BRAIN V3 INTELLIGENCE</span>'
      if (v3.session && v3.session.current) { const sess = v3.session; const sessCol = sess.modifier >= 1.05 ? '#00ff88' : sess.modifier <= 0.90 ? '#ff4466' : 'rgba(255,255,255,0.45)'; html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">SESS</span><span style="color:#aa88ff">' + sess.current.name + '</span> <span style="color:' + sessCol + '">\u00D7' + sess.modifier + '</span>' + (sess.current.overlap ? ' <span style="color:#ffaa00">OVERLAP</span>' : '') + '</div>' }
      if (v3.drawdown) { const dd = v3.drawdown; const ddCol = dd.tier === 'GREEN' ? '#00ff88' : dd.tier === 'CAUTION' ? '#ffaa00' : dd.tier === 'WARNING' ? '#ff8844' : dd.tier === 'DANGER' ? '#ff3355' : '#668899'; html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">DD</span><span style="color:' + ddCol + '">' + dd.tier + '</span> <span style="color:var(--dim)">-' + dd.drawdownPct + '% max:-' + dd.maxDrawdown + '%</span></div>' }
      if (v3.sizing && v3.sizing.sufficient) { const sz = v3.sizing; const szCol = sz.winRate >= 55 ? '#00ff88' : sz.winRate < 45 ? '#ff4466' : '#ffaa00'; html += '<div style="padding:1px 0"><span style="color:var(--dim);width:65px;display:inline-block;font-weight:600">EDGE</span><span style="color:' + szCol + '">WR:' + sz.winRate + '%</span> <span style="color:var(--dim)">Kelly:' + sz.quarterKelly + '% n=' + sz.sampleSize + '</span></div>' }
      if (v3.correlation && v3.correlation.warning) { html += '<div style="padding:1px 0"><span style="color:#ff4466;width:65px;display:inline-block;font-weight:600">\u26A0 CORR</span><span style="color:#ff8844">' + v3.correlation.warning + '</span></div>' }
      html += '</div>'
    }
    body.innerHTML = html
  }

  function _bvPoll() { fetch('/api/brain/vision', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null }).then(function (data: any) { if (data && data.symbols) { _bvData = data; _bvRender() } }).catch(function () { }) }

  // DOMContentLoaded already fired in React SPA — start directly
  function _bvInit() {
    const wrap = document.getElementById('brainVisionWrap'); if (!wrap) return
    setTimeout(_bvPoll, 3000); _bvTimer = setInterval(_bvPoll, 30000)
    void _bvTimer
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bvInit)
  else setTimeout(_bvInit, 500)
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
