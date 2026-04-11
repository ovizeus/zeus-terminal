/**
 * Zeus Terminal — Klines (ported from public/js/data/klines.js)
 * Kline data processing helpers
 */

import { getTPObject, getATObject, getBrainMetrics, getBrainObject, getDSLObject, getPrice, getSymbol, getTimezone, getTCMaxPos } from '../services/stateAccessors'
import { el } from '../utils/dom'
import { fP } from '../utils/format'
import { toast } from './marketDataHelpers'
import { _ZI } from '../constants/icons'
import { _getCooldownMs, isArmAssistValid } from '../engine/brain'
import { macroAdjustEntryScore } from '../trading/risk'
const w = window as any // kept for w.S.mode/profile (self-ref), w.PERF, w.BlockReason, w.MSCAN, w.MSCAN_SYMS, fn calls
// [8D-3] mutable refs
const TP = getTPObject()
const AT = getATObject()
const BM = getBrainMetrics()
const BR = getBrainObject()
const DSL = getDSLObject()

// ADX calculator
export function calcADX(klines: any[], period = 14) {
  if (!klines || klines.length < period * 3 + 1) return null
  const bars = klines.slice(-(period * 3 + 1))

  // ── Etapa 1: Prima perioadă — seed cu suma simpla (Wilder init) ──
  let sTR = 0, sDMp = 0, sDMm = 0
  for (let i = 1; i <= period; i++) {
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close
    const ph = bars[i - 1].high, pl = bars[i - 1].low
    sTR += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
    sDMp += (h - ph > 0 && h - ph > pl - l) ? h - ph : 0
    sDMm += (pl - l > 0 && pl - l > h - ph) ? pl - l : 0
  }

  // ── Etapa 2: Smoothing Wilder ──
  let smoothADX = 0, dxCount = 0
  for (let i = period + 1; i < bars.length; i++) {
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close
    const ph = bars[i - 1].high, pl = bars[i - 1].low
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
    const dp = (h - ph > 0 && h - ph > pl - l) ? h - ph : 0
    const dm = (pl - l > 0 && pl - l > h - ph) ? pl - l : 0

    sTR = sTR - sTR / period + tr
    sDMp = sDMp - sDMp / period + dp
    sDMm = sDMm - sDMm / period + dm

    if (sTR === 0) continue
    const diP = (sDMp / sTR) * 100
    const diM = (sDMm / sTR) * 100
    const dxD = diP + diM
    const dx = dxD === 0 ? 0 : Math.abs(diP - diM) / dxD * 100

    if (dxCount === 0) { smoothADX = dx }
    else { smoothADX = (smoothADX * (period - 1) + dx) / period }
    dxCount++
  }
  if (dxCount === 0) return null
  return Math.round(smoothADX)
}
w.calcADX = calcADX


// RSI from klines
export function calcRSIFromKlines(klines: any[], p = 14) {
  if (!klines || klines.length < p + 1) return null
  const closes = klines.map((k: any) => k.close)
  let g = 0, l = 0
  for (let i = 1; i <= p; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l += Math.abs(d) }
  let ag = g / p, al = l / p
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) { ag = (ag * (p - 1) + d) / p; al = al * (p - 1) / p }
    else { ag = ag * (p - 1) / p; al = (al * (p - 1) + Math.abs(d)) / p }
  }
  return al === 0 ? 100 : parseFloat((100 - (100 / (1 + (ag / al)))).toFixed(1))
}

export function detectMACDDir(klines: any[]) {
  if (!klines || klines.length < 35) return 'neut'
  const closes = klines.map((k: any) => k.close)
  const calcEMA = (data: number[], p: number) => { const k = 2 / (p + 1); let e = data[0]; return data.map(v => { e = v * k + e * (1 - k); return e }) }
  const ema12 = calcEMA(closes, 12)
  const ema26 = calcEMA(closes, 26)
  const macd = ema12.map((v, i) => v - ema26[i])
  // [FIX QA-H11] Compute signal EMA on full MACD array (skip first 25 warmup bars)
  const signal = calcEMA(macd.slice(25), 9)
  if (signal.length < 2) return 'neut'
  const last = macd[macd.length - 1]
  const prev = macd[macd.length - 2]
  const sig = signal[signal.length - 1]
  const prevSig = signal[signal.length - 2]
  if (last > sig && prev <= prevSig) return 'bull'
  if (last < sig && prev >= prevSig) return 'bear'
  return last > sig ? 'bull' : 'bear'
}

export function detectSTDir(klines: any[], mult = 3) {
  if (!klines || klines.length < 20) return 'neut'
  const bars = klines.slice(-20)
  const closes = bars.map((b: any) => b.close)
  const atrs = bars.slice(1).map((b: any, i: number) => Math.max(b.high - b.low, Math.abs(b.high - bars[i].close), Math.abs(b.low - bars[i].close)))
  const _atr = atrs.reduce((a: number, b: number) => a + b, 0) / atrs.length
  const last = bars[bars.length - 1]
  const _hl2 = (last.high + last.low) / 2
  const _upper = _hl2 + mult * _atr
  const _lower = _hl2 - mult * _atr
  // [FIX QA-C2] Stateful SuperTrend
  let stUp = _lower, stDn = _upper, stDir = 1
  for (let i = 1; i < bars.length; i++) {
    const prevClose = bars[i - 1].close
    const h2 = (bars[i].high + bars[i].low) / 2
    const trI = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - prevClose), Math.abs(bars[i].low - prevClose))
    const curUp = h2 - mult * trI
    const curDn = h2 + mult * trI
    stUp = (curUp > stUp || prevClose < stUp) ? curUp : stUp
    stDn = (curDn < stDn || prevClose > stDn) ? curDn : stDn
    if (stDir === 1 && bars[i].close < stUp) stDir = -1
    else if (stDir === -1 && bars[i].close > stDn) stDir = 1
  }
  // suppress unused
  void closes; void _upper
  return stDir === 1 ? 'bull' : 'bear'
}

// Symbol score
export function calcSymbolScore(_sym: any, _klines: any, rsi: any, macd: any, stDir: any, adx: any) {
  let score = 50
  const signals: string[] = []
  let dir = 'neut'
  let bullPts = 0, bearPts = 0

  // RSI (weighted by PERF)
  const PERF = w.PERF
  const rsiWeight = PERF.rsi.wins + PERF.rsi.losses > 5
    ? (PERF.rsi.wins / (PERF.rsi.wins + PERF.rsi.losses)) * 1.5 : 1.0
  if (rsi !== null) {
    if (rsi < 35) { bullPts += 20 * rsiWeight; signals.push('RSI OS') }
    else if (rsi < 45) { bullPts += 10 * rsiWeight }
    else if (rsi > 65) { bearPts += 20 * rsiWeight; signals.push('RSI OB') }
    else if (rsi > 55) { bearPts += 10 * rsiWeight }
  }

  // MACD (weighted by PERF)
  const macdWeight = PERF.macd.wins + PERF.macd.losses > 5
    ? (PERF.macd.wins / (PERF.macd.wins + PERF.macd.losses)) * 1.5 : 1.0
  if (macd === 'bull') { bullPts += 20 * macdWeight; signals.push('MACD\u2191') }
  else if (macd === 'bear') { bearPts += 20 * macdWeight; signals.push('MACD\u2193') }

  // SuperTrend
  const stWeight = PERF.supertrend.wins + PERF.supertrend.losses > 5
    ? (PERF.supertrend.wins / (PERF.supertrend.wins + PERF.supertrend.losses)) * 1.5 : 1.0
  if (stDir === 'bull') { bullPts += 25 * stWeight; signals.push('ST\u2191') }
  else if (stDir === 'bear') { bearPts += 25 * stWeight; signals.push('ST\u2193') }

  // ADX bonus (trend strength)
  const adxWeight = PERF.adx.wins + PERF.adx.losses > 5
    ? (PERF.adx.wins / (PERF.adx.wins + PERF.adx.losses)) * 1.5 : 1.0
  if (adx !== null) {
    if (adx > 30) { bullPts += 10 * adxWeight; bearPts += 10 * adxWeight; signals.push('ADX' + adx) }
    else if (adx > 20) { bullPts += 5; bearPts += 5 }
  }

  const total = bullPts + bearPts || 1
  if (bullPts > bearPts) {
    dir = 'bull'
    score = Math.min(98, Math.round(50 + bullPts / total * 50))
  } else if (bearPts > bullPts) {
    dir = 'bear'
    score = Math.min(98, Math.round(50 + bearPts / total * 50))
  } else {
    dir = 'neut'
    score = 50
  }

  return { score, dir, signals: signals.join(' ') }
}

// ─── FETCH KLINES FOR A SYMBOL ────────────────────────────────
const _klineCache: Record<string, any> = {}
const _KLINE_CACHE_TTL = 50000

export async function fetchSymbolKlines(sym: string, tf = '5m', limit = 100) {
  try {
    const _cacheKey = sym + '_' + tf + '_' + limit
    const _cached = _klineCache[_cacheKey]
    if (_cached && (Date.now() - _cached.ts) < _KLINE_CACHE_TTL) return _cached.data
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(tf)}&limit=${encodeURIComponent(limit)}`
    const _ac = new AbortController()
    const _t = setTimeout(() => _ac.abort(), 8000)
    let r
    try { r = await fetch(url, { signal: _ac.signal }) }
    catch (_fe) { clearTimeout(_t); return _cached ? _cached.data : null }
    clearTimeout(_t)
    if (!r || !r.ok) return _cached ? _cached.data : null
    const d = await r.json()
    const parsed = d.map((k: any) => ({
      time: k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5]
    }))
    _klineCache[_cacheKey] = { ts: Date.now(), data: parsed }
    return parsed
  } catch (_e) { return null }
}
w.fetchSymbolKlines = fetchSymbolKlines


// Multi-symbol scan functions
export function _updateWhyBlocked(code: any, text: any) {
  const pill = document.getElementById('at-why-blocked')
  if (!pill) return

  // Derive from current state if not passed
  if (code === undefined) {
    const br = w.BlockReason.get()
    code = br?.code || null
    text = br?.text || null
  }

  // Degraded feeds override
  if (w._isDegradedOnly() && !code) {
    const feeds = [...w._SAFETY.degradedFeeds].join(',')
    pill.innerHTML = _ZI.w + ' DEGRADED: ' + feeds
    pill.className = 'degraded'
    pill.style.display = 'block'
    return
  }

  if (!code) {
    pill.style.display = 'none'
    pill.className = 'ok'
    return
  }

  // Map code → pill class + compact label
  let cls = 'blocked'
  let label = _ZI.noent + ' ' + (text || code)

  if (code === 'SAFETY_FAIL') {
    if (text && text.includes('session')) { cls = 'session'; label = _ZI.timer + ' Session FAIL — outside hours' }
    else if (text && text.includes('regime')) { cls = 'regime'; label = _ZI.w + ' Regime UNSTABLE' }
    else if (text && text.includes('cooldown')) { cls = 'cooldown'; label = _ZI.clock + ' Cooldown — wait...' }
    else { cls = 'blocked'; label = _ZI.noent + ' Safety: ' + (text || 'FAIL') }
  } else if (code === 'DATA_STALL') {
    cls = 'degraded'; label = _ZI.w + ' Data stalled'
  } else if (code === 'KILL' || code === 'KILL_SWITCH') {
    cls = 'blocked'; label = _ZI.dRed + ' Kill switch activ'
  } else if (code === 'PROTECT' || code === 'PROTECT_MODE') {
    cls = 'blocked'; label = _ZI.sh + ' Protect mode'
  } else if (code === 'TRIGGER_FAIL') {
    cls = 'regime'; label = _ZI.bolt + ' Trigger neatins'
  } else if (code === 'FAKEOUT') {
    cls = 'regime'; label = _ZI.noent + ' Anti-fakeout'
  }

  // Cooldown: add live countdown if applicable
  if (cls === 'cooldown') {
    const cdMs = Math.max(0, _getCooldownMs() - (Date.now() - (AT.lastTradeTs || 0)))
    const cdMin = Math.ceil(cdMs / 60000)
    label = _ZI.clock + ' Cooldown: ' + (cdMin > 0 ? cdMin + 'm' : 'clearing...')
  }

  pill.innerHTML = label
  pill.className = cls
  pill.style.display = 'block'
}
w._updateWhyBlocked = _updateWhyBlocked

// ─── MAIN MULTI SYMBOL SCAN ───────────────────────────────────
export async function runMultiSymbolScan() {
  if (el('atMultiSym')?.checked === false) return
  if (!w.FetchLock.try('multiScan')) return
  if (w.MSCAN.scanning) { w.FetchLock.release('multiScan'); return }
  w.MSCAN.scanning = true
  const scanSyms = getActiveMscanSyms()
  try {
    const tbody = el('mscanBody')
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:12px;color:#aa44ff;font-size:12px">${_ZI.bolt} SCANEZ ${scanSyms.length} SIMBOLURI...</td></tr>`

    let opps = 0
    const results: any[] = []

    for (const sym of scanSyms) {
      try {
        const wlPrice = getSymbol() === sym ? getPrice() : (w.wlPrices[sym]?.price || null)
        const wlChg = w.wlPrices[sym]?.chg || 0

        const klines = await fetchSymbolKlines(sym, '5m', 150)
        await new Promise(r => setTimeout(r, 120))

        const rsi = klines ? calcRSIFromKlines(klines) : null
        const macd = klines ? detectMACDDir(klines) : 'neut'
        const st = klines ? detectSTDir(klines) : 'neut'
        const adx = klines ? calcADX(klines) : null

        const { score, dir, signals } = calcSymbolScore(sym, klines, rsi, macd, st, adx)

        if (typeof w.atLog === 'function') w.atLog('info', 'AT_SCAN ' + sym.replace('USDT', '') + ' score=' + score + ' dir=' + dir + (adx != null ? ' adx=' + adx : ''))

        const confMin = (typeof BM !== 'undefined' ? BM.confMin : 65) || 65
        const isOpp = score >= confMin && (dir === 'bull' || dir === 'bear')
        if (isOpp) opps++

        const alreadyOpen = (TP.demoPositions || []).some((p: any) => p.sym === sym && p.autoTrade && !p.closed)

        results.push({ sym, price: wlPrice, chg: wlChg, rsi, macd, st, adx, score, dir, signals, isOpp, alreadyOpen })
        w.MSCAN.data[sym] = { price: wlPrice, chg: wlChg, rsi, macd, st, adx, score, dir, signals, isOpp, alreadyOpen }
      } catch (_e) {
        results.push({ sym, price: null, chg: 0, rsi: null, macd: 'neut', st: 'neut', adx: null, score: 50, dir: 'neut', signals: 'ERR', isOpp: false, alreadyOpen: false })
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score)
    w.MSCAN.sortedResults = results

    renderMscanTable(results, opps)
    w.MSCAN.lastScan = Date.now()

    // If auto trade is on, check each opp
    if (AT.enabled && !AT.killTriggered) {
      runMultiSymbolAutoTrade(results)
    }
  } catch (e) {
    console.error('[multiScan]', e)
  } finally {
    w.MSCAN.scanning = false
    w.FetchLock.release('multiScan')
  }
}
w.runMultiSymbolScan = runMultiSymbolScan

export function renderMscanTable(results: any[], opps: number) {
  const tbody = el('mscanBody')
  const oppsEl = el('mscanOpps')
  const updEl = el('mscanUpdTime')
  if (oppsEl) oppsEl.textContent = opps + ' oportunit' + (opps === 1 ? 'ate' : 'ati')
  if (updEl) updEl.textContent = new Date().toLocaleTimeString('ro-RO', { timeZone: getTimezone() || 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (!tbody) return

  const confMin = (typeof BM !== 'undefined' ? BM.confMin : 65) || 65

  tbody.innerHTML = results.map((r: any) => {
    const symBase = r.sym.replace('USDT', '')
    const priceStr = r.price ? '$' + fP(r.price) : '\u2014'
    const chgCls = r.chg > 0 ? 'pos' : r.chg < 0 ? 'neg' : 'neu'
    const chgStr = r.chg ? (r.chg > 0 ? '+' : '') + r.chg.toFixed(2) + '%' : '\u2014'
    const rsiCls = r.rsi ? r.rsi > 65 ? 'ob' : r.rsi < 35 ? 'os' : 'neu' : 'neu'
    const rsiStr = r.rsi ? r.rsi.toFixed(1) : '\u2014'
    const macdCls = r.macd === 'bull' ? 'bull' : r.macd === 'bear' ? 'bear' : 'neu'
    const macdStr = r.macd === 'bull' ? '\u25B2 BULL' : r.macd === 'bear' ? '\u25BC BEAR' : '\u2014'
    const stCls = r.st === 'bull' ? 'bull' : r.st === 'bear' ? 'bear' : 'neu'
    const stStr = r.st === 'bull' ? '\u25B2' : r.st === 'bear' ? '\u25BC' : '\u2014'
    const adxCls = r.adx > 20 ? 'strong' : 'weak'
    const adxStr = r.adx !== null ? r.adx : '\u2014'
    const scoreCls = r.score >= confMin ? 'high' : r.score >= 50 ? 'mid' : 'low'

    let actionHtml = ''
    if (r.alreadyOpen) {
      actionHtml = `<div style="font-size:11px;color:#aa44ff">${_ZI.dRed} IN POZ</div>`
    } else if (r.isOpp && r.dir === 'bull') {
      actionHtml = `<button class="mscan-enter-btn long" onclick="manualEnterFromScan('${r.sym}','LONG',${r.score})">\u25B2 LONG</button>`
    } else if (r.isOpp && r.dir === 'bear') {
      actionHtml = `<button class="mscan-enter-btn short" onclick="manualEnterFromScan('${r.sym}','SHORT',${r.score})">\u25BC SHORT</button>`
    } else {
      actionHtml = `<span class="mscan-enter-btn dis">\u2014</span>`
    }

    const rowBg = r.isOpp ? (r.dir === 'bull' ? 'background:#00d97a06' : 'background:#ff446606') : ''

    return `<tr style="${rowBg}">
      <td><span class="mscan-sym" style="color:${r.isOpp ? r.dir === 'bull' ? '#00d97a' : '#ff4466' : 'var(--whi)'}">${symBase}</span></td>
      <td class="mscan-price">${priceStr}</td>
      <td class="mscan-chg ${chgCls}">${chgStr}</td>
      <td class="mscan-rsi ${rsiCls}">${rsiStr}</td>
      <td><span class="mscan-ind ${macdCls}">${macdStr}</span></td>
      <td><span class="mscan-ind ${stCls}">${stStr}</span></td>
      <td class="mscan-adx ${adxCls}">${adxStr}</td>
      <td><span class="mscan-score ${scoreCls}">${r.score}</span></td>
      <td class="mscan-signal" style="color:${r.isOpp ? r.dir === 'bull' ? '#00d97a' : '#ff4466' : 'var(--dim)'}" title="${r.signals}">${r.signals || '\u2014'}</td>
      <td>${actionHtml}</td>
    </tr>`
  }).join('')
}
// renderMscanTable — self-ref removed (direct call)

// ─── MANUAL ENTRY FROM SCANNER ─────────────────────────────────
export function manualEnterFromScan(sym: string, side: string, score: number) {
  const maxPos = getTCMaxPos()
  const openAuto = (TP.demoPositions || []).filter((p: any) => p.autoTrade && !p.closed).length
  if (openAuto >= maxPos) { toast('Max pozitii atinse (' + maxPos + ')'); return }

  const price = sym === getSymbol() ? getPrice() : (w.wlPrices[sym]?.price || 0)
  if (!price) { toast('Nu am pretul pentru ' + sym); return }

  const fakeEntry = { score, bullCount: 3, bearCount: 0, stDir: side === 'LONG' ? 'bull' : 'bear' }
  w.placeAutoTrade(side, fakeEntry, sym, price)

  setTimeout(() => runMultiSymbolScan(), 1000)
}
w.manualEnterFromScan = manualEnterFromScan

// ─── MULTI-SYMBOL AUTO TRADE ───────────────────────────────────
export function _endMultiScan() { w.FetchLock.release('multiScan') }

export function runMultiSymbolAutoTrade(results: any[]) {
  if (!AT.enabled || AT.killTriggered) return

  const _mode = (w.S.mode || 'assist').toLowerCase()
  const _prof = (w.S.profile || 'fast').toLowerCase()

  if (_mode !== 'assist' && _mode !== 'auto') return

  if (_mode === 'assist') {
    if (!isArmAssistValid()) {
      w.atLog('info', 'ASSIST \u2014 ne\u00eennarmat. Apas\u0103 ARM ASSIST pentru confirmare.')
      return
    }
  }

  if (_mode === 'auto') {
    if (BM.protectMode) { w.BlockReason.set('PROTECT', BM.protectReason || 'Protect mode activ', 'autoCheck'); return }
    if (AT.killTriggered) { w.BlockReason.set('KILL', 'Kill switch activ', 'autoCheck'); return }

    const _chaos = Math.round((BR.regimeAtrPct || 0) * 15 + (BM.newsRisk === 'high' ? 40 : BM.newsRisk === 'med' ? 20 : 0))
    const _anyDSLActive = (TP.demoPositions || []).some((p: any) => p.autoTrade && !p.closed && DSL.positions?.[p.id]?.active)
    if (_anyDSLActive && _chaos > 60) {
      w.BlockReason.set('CHAOS', `Chaos ${_chaos} > 60 \u2014 pia\u021B\u0103 prea volatil\u0103 cu DSL activ`, 'autoCheck')
      w.atLog('warn', '[BLOCK] AUTO BLOCK \u2014 DSL active + chaos>60'); return
    }

    const _dslWaitMs = 10 * 60 * 1000
    const _dslWaiting = (TP.demoPositions || []).some((p: any) => {
      const d = DSL.positions?.[p.id]
      return d && !d.active && p.autoTrade && !p.closed && (Date.now() - p.ts) > _dslWaitMs
    })
    if (_dslWaiting) { w.atLog('warn', '[WARN] AUTO \u2014 DSL WAIT>10min, threshold ridicat') }
  }

  // suppress unused
  void _prof

  const maxPos = getTCMaxPos()
  const openAuto = (TP.demoPositions || []).filter((p: any) => p.autoTrade && !p.closed)
  if (openAuto.length >= maxPos) return

  const profileThresh: Record<string, number[]> = { fast: [65, 55], swing: [72, 60], defensive: [80, 65] }
  const [confMin, _confMinConfl] = profileThresh[w.S.profile || 'fast'] || [65, 55]
  const _adaptEntryMult = (BM.adaptive && BM.adaptive.enabled) ? (BM.adaptive.entryMult || 1.0) : 1.0
  const confMinAdj = Math.max(40, Math.min(95, confMin / _adaptEntryMult))
  const _sigMin = parseInt(el('atSigMin')?.value) || 3

  // suppress unused
  void _confMinConfl; void _sigMin

  if (!w.isCurrentTimeOK()) {
    w.atLog('warn', '[TIME] Ora curenta are WR scazut \u2014 nu intru (Day/Hour filter)')
    w.brainThink('bad', _ZI.clock + ' Hour filter: WR scazut acum, astept ora mai buna')
    return
  }

  const opps = results.filter((r: any) => {
    if (!r.isOpp || r.alreadyOpen) return false
    const adjScore = (typeof macroAdjustEntryScore === 'function') ? macroAdjustEntryScore(r.dir, r.score) : r.score
    r.scoreAdj = adjScore
    if (adjScore < confMinAdj) return false
    if (r.adx !== null && r.adx < 18) return false
    const alreadyInDir = (TP.demoPositions || []).some((p: any) =>
      p.sym === r.sym && p.autoTrade && !p.closed &&
      ((r.dir === 'bull' && p.side === 'SHORT') || (r.dir === 'bear' && p.side === 'LONG')))
    if (alreadyInDir) return false
    return true
  }).sort((a: any, b: any) => b.score - a.score)

  if (!opps.length) return

  const slots = maxPos - openAuto.length
  const toEnter = opps.slice(0, slots)

  toEnter.forEach((opp: any) => {
    const side = opp.dir === 'bull' ? 'LONG' : 'SHORT'
    const price = opp.sym === getSymbol() ? getPrice() : (w.wlPrices[opp.sym]?.price || 0)
    if (!price) { w.atLog('warn', '[ERR] Nu am pret pentru ' + opp.sym); return }

    w.atLog(side === 'LONG' ? 'buy' : 'sell',
      `[MSCAN] ${opp.sym.replace('USDT', '')} ${side} Score:${opp.score} ADX:${opp.adx || '\u2014'} | ${opp.signals}`)
    w.brainThink('trade', _ZI.scope + ` ${opp.sym.replace('USDT', '')} ${side} Score:${opp.score} \u2014 intru!`)

    w.placeAutoTrade(side, { score: opp.score, bullCount: opp.dir === 'bull' ? 3 : 0, bearCount: opp.dir === 'bear' ? 3 : 0, stDir: opp.dir }, opp.sym, price)
  })

  setTimeout(() => renderMscanTable(w.MSCAN.sortedResults || results, 0), 500)
}
// runMultiSymbolAutoTrade — self-ref removed (direct call)

export function toggleMultiSymMode() {
  const on = el('atMultiSym')?.checked
  _mscanUpdateLabel()
  if (on) w.atLog('info', '[MSCAN] Multi-Symbol ACTIV \u2014 ' + _mscanGetActive().length + ' simboluri')
  else w.atLog('warn', 'Multi-Symbol DEZACTIVAT \u2014 doar symbol curent')
  w._usScheduleSave()
}
// toggleMultiSymMode — self-ref removed (direct call)

/* ── Symbol Picker for MSCAN ── */
export function _mscanGetActive() {
  try {
    const saved = localStorage.getItem('zeus_mscan_syms')
    if (saved) {
      const arr = JSON.parse(saved)
      if (Array.isArray(arr) && arr.length > 0) return arr
    }
  } catch (_) { /* */ }
  return w.MSCAN_SYMS.slice()
}

export function _mscanSaveActive(arr: any[]) {
  localStorage.setItem('zeus_mscan_syms', JSON.stringify(arr))
  if (typeof w._ucMarkDirty === 'function') w._ucMarkDirty('scannerSyms')
  if (typeof w._userCtxPush === 'function') w._userCtxPush()
  _mscanUpdateLabel()
}

export function _mscanUpdateLabel() {
  const lbl = el('atMultiSymLbl')
  if (!lbl) return
  const on = el('atMultiSym')?.checked
  if (!on) { lbl.textContent = 'DEZACTIVAT'; return }
  const active = _mscanGetActive()
  lbl.textContent = 'ACTIV \u2014 ' + active.length + ' simboluri'
}
w._mscanUpdateLabel = _mscanUpdateLabel

export function getActiveMscanSyms() {
  const on = el('atMultiSym')?.checked
  if (!on) return [typeof w.S !== 'undefined' ? getSymbol() : 'BTCUSDT']
  return _mscanGetActive()
}

export function toggleSymPicker() {
  const drop = el('atSymPickerDrop')
  if (!drop) return
  const vis = drop.style.display !== 'none'
  if (vis) { drop.style.display = 'none'; return }
  const list = el('atSymPickerList')
  if (!list) return
  const active = _mscanGetActive()
  let html = ''
  w.MSCAN_SYMS.forEach(function (sym: string) {
    const short = sym.replace('USDT', '')
    const checked = active.indexOf(sym) !== -1 ? 'checked' : ''
    html += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:3px 4px;border-radius:3px;font-size:8px;color:#ccd" onmouseenter="this.style.background=\'#1a1030\'" onmouseleave="this.style.background=\'transparent\'">' +
      '<input type="checkbox" data-sym="' + sym + '" ' + checked + ' onchange="mscanToggleSym(this)" style="accent-color:#aa44ff">' +
      '<span style="font-weight:700;color:#fff;min-width:38px">' + short + '</span>' +
      '<span style="color:#556;font-size:6px">' + sym + '</span></label>'
  })
  list.innerHTML = html
  drop.style.display = 'block'
}
// toggleSymPicker — self-ref removed (direct call)

export function mscanToggleSym(cb: any) {
  const sym = cb.dataset.sym
  let active = _mscanGetActive()
  if (cb.checked) {
    if (active.indexOf(sym) === -1) active.push(sym)
  } else {
    active = active.filter(function (s: string) { return s !== sym })
  }
  _mscanSaveActive(active)
}
w.mscanToggleSym = mscanToggleSym

export function mscanPickAll(selectAll: boolean) {
  const active = selectAll ? w.MSCAN_SYMS.slice() : []
  _mscanSaveActive(active)
  const list = el('atSymPickerList')
  if (list) list.querySelectorAll('input[type="checkbox"]').forEach(function (cb: any) { cb.checked = selectAll })
}
// mscanPickAll — self-ref removed (direct call)

// Close picker on outside click
document.addEventListener('click', function (e) {
  const drop = document.getElementById('atSymPickerDrop')
  const card = document.getElementById('atSymPickerCard')
  if (drop && drop.style.display !== 'none' && !drop.contains(e.target as Node) && card && !card.contains(e.target as Node)) {
    drop.style.display = 'none'
  }
})
