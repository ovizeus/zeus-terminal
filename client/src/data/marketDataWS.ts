// Zeus — data/marketDataWS.ts
// Ported 1:1 from public/js/data/marketData.js lines 1129-1966 (Chunk D2)
// WS connections, liq processing, symbol switch, order book, feed,
// modals, alerts, cloud, chart settings, sound

import { getTPObject, getBrainMetrics, getBrainObject } from '../services/stateAccessors'
import { fmtTime, toast } from './marketDataHelpers'
import { fmt, fP } from '../utils/format'
import { el } from '../utils/dom'
import { _ZI } from '../constants/icons'
import { clearAllSessionOverlays } from '../ui/panels'
import { llvRequestRender, renderHeatmapOverlay, renderSROverlay, clearSR } from './marketDataOverlays'
import { resetForecast } from '../engine/forecast'
import { trackOIDelta } from '../services/storage'
import { PhaseFilter } from '../engine/phaseFilter'
import { RegimeEngine } from '../engine/regime'
import { _enterDegradedMode, _exitDegradedMode, _isDegradedOnly, _enterRecoveryMode, _exitRecoveryMode } from '../utils/guards'
import { fetchATR, updatePriceDisplay } from './marketDataFeeds'
import { renderATPositions } from '../trading/autotrade'
const w = window as any // kept for w.S (producer), w.WS, w.Intervals, w.Timeouts, w.__wsGen, w.ZLOG, w.CORE_STATE, fn calls
// [8D-1] BM/BR = mutable refs for setSymbol reset
const BM = getBrainMetrics()
const BR = getBrainObject()

// ===== WS RECONNECT BACKOFF =====
const _wsBackoff: any = { bnb: 0, byb: 0, wl: 0 }
function _nextBackoff(key: string, base: number, cap: number): number {
  const attempt = _wsBackoff[key] || 0
  const delay = Math.min(cap, base * Math.pow(2, attempt))
  _wsBackoff[key] = attempt + 1
  return delay
}
function _resetBackoff(key: string): void { _wsBackoff[key] = 0 }

// ===== CONNECT BINANCE WS =====
export function connectBNB(): void {
  const sym = (w.S.symbol || 'BTCUSDT').toLowerCase()
  const url = `wss://fstream.binance.com/stream?streams=${sym}@markPrice@1s/${sym}@depth20@500ms/!forceOrder@arr`
  const _bnbGen = w.__wsGen
  console.log(`[connectBNB] attempt | sym=${sym} | gen=${_bnbGen}`)
  w.WS.open('bnb', url, {
    onopen: () => { console.log(`[connectBNB] onopen | gen=${w.__wsGen} (my gen=${_bnbGen})`); w.S.bnbOk = true; _resetBackoff('bnb'); _exitRecoveryMode(); updConn() },
    onclose: () => { console.log(`[connectBNB] onclose`); w.S.bnbOk = false; _enterRecoveryMode('BNB'); updConn(); w.Timeouts.set('bnbReconnect', () => { if (w.__wsGen !== _bnbGen) return; _exitRecoveryMode(); connectBNB() }, _nextBackoff('bnb', 3000, 30000)) },
    onerror: (e: any) => { console.error(`[connectBNB] onerror`, e); if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('WARN', '[WS BNB] onerror'); w.S.bnbOk = false; updConn() },
    onmessage: (e: any) => {
      if (w.__wsGen !== _bnbGen) return
      let j: any; try { j = JSON.parse(e.data) } catch (_) { return }
      if (j.stream) {
        const d = j.data; const st = j.stream
        if (st.includes('markPrice')) {
          if (w.ingestPrice(d.p, 'BNB')) {
            w.S.fr = w._safe.num(d.r, 'fr', 0); w.S.frCd = +d.T
            updatePriceDisplay(); updateMainMetrics()
            if (getTPObject().demoPositions?.some((p: any) => p.autoTrade)) renderATPositions()
          }
        } else if (st.includes('depth20')) {
          w.S.bids = (d.b || []).map(([p, q]: any) => ({ p: +p, q: +q }))
          w.S.asks = (d.a || []).map(([p, q]: any) => ({ p: +p, q: +q }))
          renderOB()
        } else if (st.includes('forceOrder')) {
          if (Array.isArray(d)) d.forEach((o: any) => procLiq(o.o || o, 'bnb'))
          else procLiq(d.o || d, 'bnb')
        }
      }
    }
  })
}

// ===== CONNECT BYBIT WS =====
let _bybPingTimer: any = null
function _stopBybPing(): void { if (_bybPingTimer) { clearInterval(_bybPingTimer); _bybPingTimer = null } }

export function connectBYB(): void {
  _stopBybPing()
  const sym = w.S.symbol || 'BTCUSDT'
  const _bybGen = w.__wsGen
  console.log(`[connectBYB] attempt | sym=${sym} | gen=${_bybGen}`)
  w.WS.open('byb', 'wss://stream.bybit.com/v5/public/linear', {
    onopen: () => {
      console.log(`[connectBYB] onopen`); w.S.bybOk = true; _resetBackoff('byb'); _exitDegradedMode('BYB'); updConn()
      w.S.liqMetrics.byb.connected = true; w.S.liqMetrics.byb.connectedAt = Date.now()
      const wsi = w.WS.get('byb'); if (wsi) wsi.send(JSON.stringify({ op: 'subscribe', args: [`liquidation.${sym}`] }))
      _stopBybPing()
      _bybPingTimer = setInterval(() => { try { const ws = w.WS.get('byb'); if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' })) } catch (_) { } }, 20000)
    },
    onclose: () => { _stopBybPing(); w.S.bybOk = false; w.S.liqMetrics.byb.connected = false; w.S.liqMetrics.byb.reconnects++; _enterDegradedMode('BYB'); updConn(); w.Timeouts.set('bybReconnect', () => { if (w.__wsGen !== _bybGen) return; connectBYB() }, _nextBackoff('byb', 5000, 30000)) },
    onerror: () => { if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('WARN', '[WS BYB] onerror') },
    onmessage: (e: any) => {
      if (w.__wsGen !== _bybGen) return
      let j: any; try { j = JSON.parse(e.data) } catch (_) { return }
      if (j.topic && j.topic.includes('liquidation') && j.data) {
        const d = j.data; const o = { s: d.symbol, S: d.side === 'Buy' ? 'SELL' : 'BUY', q: +d.size, p: +d.price }
        w.S.liqMetrics.byb.msgCount++; procLiq(o, 'byb')
      }
    }
  })
}

// ===== CONNECTION STATUS =====
export function updConn(): void {
  const dot = el('ldot'), lbl = el('llbl')
  const ok = w.S.bnbOk || w.S.bybOk
  const degraded = _isDegradedOnly()
  if (dot) dot.className = 'ldot' + (ok ? (degraded ? ' degraded' : ' on') : '')
  if (lbl) lbl.textContent = ok ? (degraded ? 'DEGRADED' : 'LIVE') : 'CONNECTING'
  const bv = el('bns'); const byv = el('bys')
  if (bv) bv.textContent = 'BNB:' + (w.S.bnbOk ? 'LIVE' : '\u2014')
  if (byv) byv.textContent = 'BYB:' + (w.S.bybOk ? 'LIVE' : '\u2014' + (degraded ? ' [!]' : ''))
  updBybHealth()
}

// ===== PROCESS LIQUIDATION =====
export function procLiq(o: any, src?: string): void {
  if (!o || !o.q || !o.p) return
  src = src || 'bnb'
  const qty = +o.q, price = +o.p
  const sym = (o.s || '').replace('USDT', '').substring(0, 3)
  const usd = qty * price
  if (usd < w.S.liqMinUsd) return
  const isLong = o.S === 'SELL'
  const m = w.S.liqMetrics[src] || w.S.liqMetrics.bnb
  m.count++; m.usd += usd; m.lastTs = Date.now()
  w.S.totalUSD += usd; if (isLong) w.S.longUSD += usd; else w.S.shortUSD += usd
  w.S.cnt++; if (isLong) w.S.longCnt++; else w.S.shortCnt++
  const now = Date.now()
  let dupFlag = false
  for (let i = 0; i < Math.min(3, w.S.events.length); i++) {
    const prev = w.S.events[i]
    if (prev.sym === sym && prev.isLong === isLong && now - prev.ts < 2000 && Math.abs(prev.price - price) / price < 0.001) { dupFlag = true; break }
  }
  const bi = w.S.bIdx % 20
  w.S.buckets[bi].l += isLong ? usd : 0; w.S.buckets[bi].s += isLong ? 0 : usd
  w.S.events.unshift({ sym, usd, isLong, price, ts: now, src, dup: dupFlag })
  if (w.S.events.length > 100) w.S.events.pop()
  updLiqStats(); renderFeed()
  if (sym === 'BTC' || sym === w.S.symbol.replace('USDT', '').substring(0, 3)) {
    const _bkt = w.S.llvSettings.bucketPct || 0.3
    const _step = price * _bkt / 100
    let _pkey = Math.round(price / _step) * _step; _pkey = Math.round(_pkey)
    const _pk100 = Math.round(price / 100) * 100
    w.S.btcClusters[_pk100] = w.S.btcClusters[_pk100] || { price: _pk100, vol: 0, isLong, bnbUsd: 0, bybUsd: 0 }
    w.S.btcClusters[_pk100].vol += usd
    if (src === 'byb') w.S.btcClusters[_pk100].bybUsd += usd; else w.S.btcClusters[_pk100].bnbUsd += usd
    w.S.llvBuckets = w.S.llvBuckets || {}
    w.S.llvBuckets[_pkey] = w.S.llvBuckets[_pkey] || { price: _pkey, longUSD: 0, shortUSD: 0, longBTC: 0, shortBTC: 0, ts: Date.now() }
    if (isLong) { w.S.llvBuckets[_pkey].longUSD += usd; w.S.llvBuckets[_pkey].longBTC += qty } else { w.S.llvBuckets[_pkey].shortUSD += usd; w.S.llvBuckets[_pkey].shortBTC += qty }
    w.S.llvBuckets[_pkey].ts = Date.now()
    if (w.S.overlays.llv && typeof llvRequestRender === 'function') llvRequestRender()
  }
  checkLiqAlert(usd, qty, isLong ? 'LONG' : 'SHORT', sym)
}

// ===== LIQ STATS =====
export function updLiqStats(): void {
  const le = el('llc'), se = el('lsc'); if (le) le.textContent = w.S.longCnt; if (se) se.textContent = w.S.shortCnt
  const lu = el('llu'), su = el('lsu'); if (lu) lu.textContent = '$' + fmt(w.S.longUSD); if (su) su.textContent = '$' + fmt(w.S.shortUSD)
  const avgl = el('lla'), avgs = el('lsa'); if (avgl) avgl.textContent = w.S.longCnt ? 'avg: $' + fmt(w.S.longUSD / w.S.longCnt) : 'avg: \u2014'; if (avgs) avgs.textContent = w.S.shortCnt ? 'avg: $' + fmt(w.S.shortUSD / w.S.shortCnt) : 'avg: \u2014'
  const rate = el('lrate'); if (rate) rate.textContent = ((w.S.longCnt + w.S.shortCnt) / Math.max(1, (Date.now() - performance.timeOrigin) * 0.001) * 60).toFixed(0)
  const loss = el('lloss'); if (loss) loss.textContent = '$' + fmt(w.S.totalUSD)
  const t1 = el('tv'), tl = el('lv'), ts = el('sv'), tc = el('cv')
  if (t1) t1.textContent = '$' + fmt(w.S.totalUSD); if (tl) tl.textContent = '$' + fmt(w.S.longUSD); if (ts) ts.textContent = '$' + fmt(w.S.shortUSD); if (tc) tc.textContent = w.S.cnt
  const bar = el('rfill'); if (bar && w.S.totalUSD > 0) { const lp = w.S.longUSD / w.S.totalUSD * 100; bar.style.width = lp + '%' }
  const lpc = el('lplbl'), spc = el('splbl')
  if (lpc && w.S.totalUSD > 0) lpc.textContent = 'LONG ' + ((w.S.longUSD / w.S.totalUSD) * 100).toFixed(0) + '%'
  if (spc && w.S.totalUSD > 0) spc.textContent = 'SHORT ' + ((w.S.shortUSD / w.S.totalUSD) * 100).toFixed(0) + '%'
  const calm = el('calm')
  if (calm) { const recent = w.S.events.filter((e: any) => Date.now() - e.ts < 60000); const bigLiq = recent.filter((e: any) => e.usd > 100000).length; calm.innerHTML = bigLiq > 5 ? _ZI.fire + ' HOT' : bigLiq > 2 ? _ZI.bolt + ' ACTIVE' : 'CALM'; calm.style.color = bigLiq > 5 ? 'var(--red)' : bigLiq > 2 ? 'var(--ylw)' : 'var(--dim)' }
  const now = Date.now(); const w1m = w.S.events.filter((e: any) => now - e.ts < 60000); const w5m = w.S.events.filter((e: any) => now - e.ts < 300000); const w15m = w.S.events.filter((e: any) => now - e.ts < 900000)
  const e1m = el('t1l'), e1ms = el('t1s'), e1mv = el('t1v')
  if (e1m) e1m.textContent = w1m.filter((e: any) => e.isLong).length + 'L'; if (e1ms) e1ms.textContent = w1m.filter((e: any) => !e.isLong).length + 'S'; if (e1mv) e1mv.textContent = '$' + fmt(w1m.reduce((a: number, e: any) => a + e.usd, 0))
  const e5ml = el('t5l'), e5ms = el('t5s'), e5mv = el('t5v')
  if (e5ml) e5ml.textContent = w5m.filter((e: any) => e.isLong).length + 'L'; if (e5ms) e5ms.textContent = w5m.filter((e: any) => !e.isLong).length + 'S'; if (e5mv) e5mv.textContent = '$' + fmt(w5m.reduce((a: number, e: any) => a + e.usd, 0))
  const e15ml = el('t15l'), e15ms = el('t15s'), e15mv = el('t15v')
  if (e15ml) e15ml.textContent = w15m.filter((e: any) => e.isLong).length + 'L'; if (e15ms) e15ms.textContent = w15m.filter((e: any) => !e.isLong).length + 'S'; if (e15mv) e15mv.textContent = '$' + fmt(w15m.reduce((a: number, e: any) => a + e.usd, 0))
  renderHotZones(); updMarketPressure(); updLiqSourceMetrics()
}

export function updLiqSourceMetrics(): void {
  const mb = w.S.liqMetrics.bnb, my = w.S.liqMetrics.byb; const total = mb.count + my.count || 1
  const ebc = el('lm-bnb-cnt'), ebu = el('lm-bnb-usd'), ebp = el('lm-bnb-pct')
  const eyc = el('lm-byb-cnt'), eyu = el('lm-byb-usd'), eyp = el('lm-byb-pct')
  if (ebc) ebc.textContent = mb.count; if (ebu) ebu.textContent = '$' + fmt(mb.usd); if (ebp) ebp.textContent = (mb.count / total * 100).toFixed(0) + '%'
  if (eyc) eyc.textContent = my.count; if (eyu) eyu.textContent = '$' + fmt(my.usd); if (eyp) eyp.textContent = (my.count / total * 100).toFixed(0) + '%'
  const elast = el('lm-last-src'); if (elast) { const lastEvt = w.S.events[0]; if (lastEvt) { elast.textContent = lastEvt.src === 'byb' ? 'BYB' : 'BNB'; elast.style.color = lastEvt.src === 'byb' ? 'var(--ylw)' : 'var(--grn)' } }
  const edup = el('lm-dup-cnt'); if (edup) edup.textContent = w.S.events.filter((e: any) => e.dup).length
}

export function updBybHealth(): void {
  const my = w.S.liqMetrics.byb
  const eSt = el('byb-h-status'), eRc = el('byb-h-reconn'), eRate = el('byb-h-rate'), eAge = el('byb-h-age')
  if (eSt) { const st = w.S.bybOk ? 'CONNECTED' : (my.reconnects > 0 ? 'DEGRADED' : 'DISCONNECTED'); eSt.textContent = st; eSt.style.color = w.S.bybOk ? 'var(--grn)' : 'var(--red)' }
  if (eRc) eRc.textContent = my.reconnects
  if (eRate) { const now = Date.now(); const recent = w.S.events.filter((e: any) => e.src === 'byb' && now - e.ts < 60000); eRate.textContent = recent.length + '/min' }
  if (eAge) { if (my.lastTs) { const age = Math.round((Date.now() - my.lastTs) / 1000); eAge.textContent = age < 60 ? age + 's ago' : Math.round(age / 60) + 'm ago'; eAge.style.color = age > 120 ? 'var(--red)' : age > 60 ? 'var(--ylw)' : 'var(--dim)' } else eAge.textContent = '\u2014' }
}

// ===== ORDER BOOK =====
let _lastRenderOB = 0
export function renderOB(): void {
  const _now = Date.now(); if (_now - _lastRenderOB < 300) return; _lastRenderOB = _now
  if (!w.S.asks.length && !w.S.bids.length) return
  const top = 5; let ah = '', bh = ''
  const maxSz = Math.max(...w.S.asks.slice(0, top).map((x: any) => x.q), ...w.S.bids.slice(0, top).map((x: any) => x.q), 1)
  w.S.asks.slice(0, top).reverse().forEach((a: any) => { const pct = a.q / maxSz * 100; ah += `<tr><td style="color:var(--red)">${fP(a.p)}</td><td style="color:var(--dim);text-align:right">${a.q.toFixed(3)}</td><td style="width:60px"><div style="height:6px;background:#ff335533;width:${pct}%"></div></td></tr>` })
  w.S.bids.slice(0, top).forEach((b: any) => { const pct = b.q / maxSz * 100; bh += `<tr><td style="color:var(--grn)">${fP(b.p)}</td><td style="color:var(--dim);text-align:right">${b.q.toFixed(3)}</td><td style="width:60px"><div style="height:6px;background:#00d97a33;width:${pct}%"></div></td></tr>` })
  const ae = el('askc'), be = el('bidc'); if (ae) ae.innerHTML = ah; if (be) be.innerHTML = bh
  const sp = w.S.asks.length && w.S.bids.length ? w.S.asks[0].p - w.S.bids[0].p : 0
  const spe = el('spread'); if (spe) spe.textContent = 'SPREAD: $' + sp.toFixed(2)
}

// ===== HOT ZONES =====
export function renderHotZones(): void {
  const hz = el('hzc'); if (!hz) return
  const clusters: any[] = Object.values(w.S.btcClusters).sort((a: any, b: any) => b.vol - a.vol).slice(0, 5)
  if (!clusters.length) { hz.innerHTML = '<div style="color:var(--dim);font-size:13px;text-align:center;padding:12px">Accumulating data...</div>'; return }
  const maxV = Math.max(...clusters.map((c: any) => c.vol), 1)
  hz.innerHTML = clusters.map((c: any) => { const pct = c.vol / maxV * 100; const col = c.isLong ? 'var(--red)' : 'var(--grn)'; const dist = w.S.price ? ((c.price - w.S.price) / w.S.price * 100) : 0; return `<div class="hzrow"><div style="color:${col};font-size:13px">${c.isLong ? 'LONG' : 'SHORT'} $${fP(c.price)} <span style="color:var(--dim)">${dist >= 0 ? '+' : ''}${dist.toFixed(2)}%</span></div><div style="display:flex;align-items:center;gap:4px"><div style="flex:1;height:4px;background:#1a2530;border-radius:2px"><div style="height:4px;background:${col};width:${pct}%;border-radius:2px"></div></div><span style="color:var(--whi);font-size:12px">$${fmt(c.vol)}</span></div></div>` }).join('')
}

// ===== MARKET PRESSURE =====
export function updMarketPressure(): void {
  const e = el('pvv'); if (!e) return
  const total = w.S.totalUSD; if (!total) { e.textContent = 'NEUTRAL'; e.className = 'pvv neut'; return }
  const ratio = w.S.longUSD / total
  if (ratio > 0.65) { e.textContent = 'SHORT HEAVY'; e.className = 'pvv bears' } else if (ratio < 0.35) { e.textContent = 'LONG HEAVY'; e.className = 'pvv bulls' } else { e.textContent = 'NEUTRAL'; e.className = 'pvv neut' }
}

// ===== FEED =====
let _liqSrcFilter = 'all'
export function setLiqSrcFilter(v: any): void { _liqSrcFilter = v; renderFeed(); updLiqFilterBtns() }
export function updLiqFilterBtns(): void { ['all', 'bnb', 'byb'].forEach((k: string) => { const b = el('lf-' + k); if (b) b.className = 'liq-fbtn' + (_liqSrcFilter === k ? ' act' : '') }) }
export function renderFeed(): void {
  const fd = el('fdlist'); if (!fd) return
  const base = (w.S.symbol || 'BTCUSDT').replace('USDT', '').replace('BUSD', '')
  let filtered = w.S.events.filter((e: any) => e.sym && e.sym.toUpperCase().startsWith(base.toUpperCase()))
  if (_liqSrcFilter !== 'all') filtered = filtered.filter((e: any) => e.src === _liqSrcFilter)
  const html = filtered.slice(0, 30).map((e: any) => { const col = e.isLong ? 'var(--red)' : 'var(--grn)'; const icon = e.usd >= 1e6 ? _ZI.fire : e.usd >= 500000 ? _ZI.boom : _ZI.drop; const srcTag = e.src === 'byb' ? '<span class="liq-src-byb">BYB</span>' : '<span class="liq-src-bnb">BNB</span>'; const dupTag = e.dup ? '<span class="liq-dup">DUP?</span>' : ''; return `<div class="fdrow" style="border-left:2px solid ${col};padding-left:6px"><span style="color:${col}">${icon} ${e.sym} ${e.isLong ? 'LONG LIQ' : 'SHORT LIQ'}</span>${srcTag}${dupTag}<span style="color:var(--whi)">$${fmt(e.usd)}</span><span style="color:var(--dim)">@${fP(e.price)}</span></div>` }).join('')
  fd.innerHTML = html || `<div style="color:var(--dim);font-size:13px;padding:8px">Waiting for ${base} liquidations...</div>`
  const cnt = el('fcnt'); if (cnt) cnt.textContent = filtered.length + ' events' + (_liqSrcFilter !== 'all' ? ' (' + _liqSrcFilter.toUpperCase() + ')' : '')
}

// ===== SYMBOL SWITCH =====
export function setSymbol(sym: string): void {
  console.log(`[setSymbol] called with '${sym}' | current __wsGen=${w.__wsGen}`)
  try {
    w.__wsGen = (w.__wsGen || 0) + 1
    w.WS.closeSymbolFeeds()
    if (w.S.wsK) { try { w.S.wsK.close() } catch (_) { } w.S.wsK = null }
    if (typeof clearAllSessionOverlays === 'function') clearAllSessionOverlays()
    w.S.symbol = sym
    if (typeof w.ZLOG !== 'undefined') w.ZLOG.push('INFO', '[SYM] \u2192 ' + sym)
    const lbl = el('chartTitleLbl'); if (lbl) lbl.textContent = sym
    w.S.klines = []; w.S.btcClusters = {}; w.S.events = []
    w.S.price = 0; w.S.totalUSD = 0; w.S.longUSD = 0; w.S.shortUSD = 0; w.S.cnt = 0; w.S.longCnt = 0; w.S.shortCnt = 0
    w.S.bids = []; w.S.asks = []
    if (typeof RegimeEngine !== 'undefined' && RegimeEngine.reset) RegimeEngine.reset()
    if (typeof PhaseFilter !== 'undefined' && PhaseFilter.reset) PhaseFilter.reset()
    if (typeof resetForecast === 'function') resetForecast()
    if (typeof BM !== 'undefined') { BM.regimeEngine = { regime: 'RANGE', confidence: 0, trendBias: 'neutral', volatilityState: 'normal', trapRisk: 0, notes: ['switching symbol'] }; BM.phaseFilter = { allow: false, phase: 'RANGE', reason: 'switching symbol', riskMode: 'reduced', sizeMultiplier: 0.5, allowedSetups: [], blockedSetups: [] }; BM.confluenceScore = 50; BM.probScore = 0; BM.probBreakdown = { regime: 0, liquidity: 0, signals: 0, flow: 0 }; BM.entryScore = 0; BM.entryReady = false; BM.gates = {}; BM.sweep = { type: 'none', reclaim: false, displacement: false }; BM.flow = { cvd: 'neut', delta: 0, ofi: 'neut' }; BM.mtf = { '15m': 'neut', '1h': 'neut', '4h': 'neut' }; BM.atmosphere = { category: 'neutral', allowEntry: true, cautionLevel: 'medium', confidence: 0, reasons: ['switching symbol'], sizeMultiplier: 1.0 }; BM.qexit = { risk: 0, signals: { divergence: { type: null, conf: 0 }, climax: { dir: null, mult: 0 }, regimeFlip: { from: null, to: null, conf: 0 }, liquidity: { nearestAboveDistPct: null, nearestBelowDistPct: null, bias: 'neutral' } }, action: 'HOLD', lastTs: 0, lastReason: '', shadowStop: null, confirm: { div: 0, climax: 0 } }; BM.danger = 0; BM.dangerBreakdown = { volatility: 0, spread: 0, liquidations: 0, volume: 0, funding: 0 }; BM.conviction = 0; BM.convictionMult = 1.0; BM.structure = { regime: 'unknown', adx: 0, atrPct: 0, squeeze: false, volMode: '\u2014', structureLabel: '\u2014', mtfAlign: { '15m': 'neut', '1h': 'neut', '4h': 'neut' }, score: 0, lastUpdate: 0 } }
    if (typeof BR !== 'undefined') { BR.state = 'scanning'; BR.regime = 'unknown'; BR.regimeConfidence = 0; BR.score = 0; BR.thoughts = []; BR.neurons = {}; BR.ofi = { buy: 0, sell: 0, blendBuy: 50, tape: [] } }
    if (typeof w.CORE_STATE !== 'undefined') { w.CORE_STATE.score = 50; w.CORE_STATE.lastUpdate = Date.now() }
    // [9A-2] Notify React brainStore — BM/BR fully reset on symbol switch
    try { window.dispatchEvent(new CustomEvent('zeus:brainStateChanged')) } catch (_) {}
    w.FetchLock.release('klines')
    w.fetchKlines(w.S.chartTf); fetchATR(); w.fetchOI(); w.fetchLS(); w.fetch24h(); w.fetchAllRSI()
    connectBNB(); connectBYB()
  } catch (_setSymErr: any) { console.error('[setSymbol] error:', _setSymErr.message || _setSymErr) }
}

// ===== SOUND =====
export function toggleSnd(): void {
  w.S.soundOn = !w.S.soundOn
  if (typeof w._initAudio === 'function') w._initAudio()
  const e = el('snd'); if (e) e.innerHTML = w.S.soundOn ? _ZI.bell : _ZI.bellX
}

// ===== MODAL =====
export function openM(id: string): void { const e = el(id); if (e) e.style.display = 'flex' }
export function closeM(id: string): void { const e = el(id); if (e) { e.style.display = 'none'; const m = e.querySelector('.modal'); if (m) { m.style.transform = ''; m.style.left = ''; m.style.top = ''; m.style.position = '' } } }

// ===== MODAL DRAG =====
export function _initModalDrag(): void {
  document.querySelectorAll('.mover').forEach(function (ov: any) {
    const modal = ov.querySelector('.modal'); const hdr = ov.querySelector('.mhdr')
    if (!modal || !hdr) return; hdr.style.cursor = 'grab'
    let ox = 0, oy = 0, mx = 0, my = 0, dragging = false
    function onDown(e: any) { if (e.target.closest('.mclose')) return; dragging = true; const r = modal.getBoundingClientRect(); ox = r.left; oy = r.top; mx = e.clientX; my = e.clientY; modal.style.position = 'fixed'; modal.style.left = ox + 'px'; modal.style.top = oy + 'px'; modal.style.margin = '0'; hdr.style.cursor = 'grabbing'; e.preventDefault() }
    function onMove(e: any) { if (!dragging) return; let nx = ox + (e.clientX - mx), ny = oy + (e.clientY - my); const mw = modal.offsetWidth, mh = modal.offsetHeight; const vw = window.innerWidth, vh = window.innerHeight; nx = Math.max(0, Math.min(nx, vw - mw)); ny = Math.max(0, Math.min(ny, vh - mh)); modal.style.left = nx + 'px'; modal.style.top = ny + 'px'; modal.style.transform = 'none' }
    function onUp() { if (dragging) { dragging = false; hdr.style.cursor = 'grab' } }
    hdr.addEventListener('mousedown', onDown); document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  })
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initModalDrag)
else _initModalDrag()

export function swtab(modalId: string, paneId: string, btn: any): void {
  const modal = el(modalId); if (!modal) return
  modal.querySelectorAll('.mbody').forEach((p: any) => p.classList.remove('act'))
  modal.querySelectorAll('.mtab').forEach((b: any) => b.classList.remove('act'))
  const pane = el(paneId); if (pane) pane.classList.add('act')
  if (btn) btn.classList.add('act')
}

// ===== UPDATE MAIN METRICS =====
export function updateMainMetrics(): void {
  if (document.hidden) return
  const fr = el('frv'), frs_el = el('frs'), oi = el('oiv'), ois_el = el('ois'), atr = el('atrv'), ls = el('lsv'), lss_el = el('lss')
  if (fr) fr.textContent = w.S.fr !== null && w.S.fr !== undefined ? (w.S.fr * 100).toFixed(4) + '%' : '\u2014'
  if (fr) fr.style.color = w.S.fr > 0 ? 'var(--red)' : w.S.fr < 0 ? 'var(--grn)' : 'var(--dim)'
  if (frs_el) { if (w.S.frCd) { const d = new Date(w.S.frCd); frs_el.textContent = 'next: ' + fmtTime(d.getTime()) } else frs_el.textContent = 'next: \u2014' }
  if (oi) oi.textContent = w.S.oi ? '$' + fmt(w.S.oi) : '\u2014'
  if (ois_el) { if (w.S.oiPrev && w.S.oi) { const ch = ((w.S.oi - w.S.oiPrev) / w.S.oiPrev * 100).toFixed(2); ois_el.textContent = (+ch > 0 ? '\u25B2' : +ch < 0 ? '\u25BC' : '') + ch + '%'; ois_el.style.color = +ch > 0 ? 'var(--grn)' : 'var(--red)' } else ois_el.textContent = '\u2014' }
  if (atr) atr.textContent = w.S.atr ? '$' + fP(w.S.atr) : '\u2014'
  if (ls) ls.textContent = w.S.ls ? w.S.ls.l.toFixed(1) + '% / ' + w.S.ls.s.toFixed(1) + '%' : '\u2014'
  if (lss_el) { if (w.S.ls) { const bull = w.S.ls.l > 55; const bear = w.S.ls.s > 55; lss_el.textContent = bull ? '\u25B2 LONGS' : bear ? '\u25BC SHORTS' : 'BALANCED'; lss_el.style.color = bull ? 'var(--grn)' : bear ? 'var(--red)' : 'var(--dim)' } else lss_el.textContent = '\u2014' }
  if (typeof trackOIDelta === 'function') trackOIDelta()
}

// ===== CHART SETTINGS =====
export function showTab(tab: string, btn: any): void { document.querySelectorAll('.ctab-pane').forEach((p: any) => p.classList.remove('act')); document.querySelectorAll('.ctab-btn').forEach((b: any) => b.classList.remove('act')); const pane = el('ct-' + tab); if (pane) pane.classList.add('act'); if (btn) btn.classList.add('act') }
export function applyChartColors(): void { const uc = el('ccBull')?.value || '#00d97a'; const dc = el('ccBear')?.value || '#ff3355'; const uw = el('ccBullW')?.value || '#00d97a77'; const dw = el('ccBearW')?.value || '#ff335577'; if (w.cSeries) w.cSeries.applyOptions({ upColor: uc, downColor: dc, borderUpColor: uc, borderDownColor: dc, wickUpColor: uw, wickDownColor: dw }); toast('Colors applied'); if (typeof w._usScheduleSave === 'function') w._usScheduleSave() }
export function setCandleStyle(style: string, btn: any): void { document.querySelectorAll('#ct-candles .qb').forEach((b: any) => b.classList.remove('act')); if (btn) btn.classList.add('act'); toast('Style: ' + style) }
export function setTZ(tz: string, btn: any): void { w.S.tz = tz; document.querySelectorAll('#cst .qb').forEach((b: any) => b.classList.remove('act')); if (btn) btn.classList.add('act'); const n: any = { 'Europe/Bucharest': 'RO', 'UTC': 'UTC', 'America/New_York': 'NY', 'Asia/Tokyo': 'TK', 'Europe/London': 'LN' }; const lbl = el('chartTZLbl'); if (lbl) lbl.textContent = n[tz] || tz; toast('Timezone: ' + tz); if (typeof w._usScheduleSave === 'function') w._usScheduleSave() }
export function applyHeatmapSettings(): void { const hs = w.S.heatmapSettings; const gv = (id: string) => +(el(id)?.value) || 0; hs.lookback = gv('hmLookback') || 400; hs.pivotWidth = gv('hmPivotW') || 1; hs.atrLen = gv('hmAtrLen') || 121; hs.atrBandPct = gv('hmAtrBand') || 0.05; hs.extendUnhit = gv('hmExtend') || 30; hs.heatContrast = gv('hmContrast') || 0.3; hs.minWeight = 0; hs.keepTouched = el('hmKeepTouched')?.checked !== false; hs.longCol = el('hmLongCol')?.value || '#01c4fe'; hs.shortCol = el('hmShortCol')?.value || '#ffe400'; if (w.S.overlays.liq) renderHeatmapOverlay(); closeM('mcharts'); toast('Heatmap updated'); if (typeof w._usScheduleSave === 'function') w._usScheduleSave() }

// ===== ALERTS =====
export function sendAlert(title: string, body: string, tag = 'zt'): void {
  if (!w.S.alerts.enabled) return
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) { navigator.serviceWorker.controller.postMessage({ type: 'NOTIFY', title, body, tag }) }
  else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') { try { const n = new Notification(title, { body, tag, icon: '', badge: '', vibrate: [200, 100, 200], requireInteraction: false, silent: false } as any); setTimeout(() => n.close(), 8000) } catch (_) { } }
  toast(title + ': ' + body)
  if (typeof w.ncAdd === 'function') w.ncAdd('info', 'alert', title + (body ? ': ' + body : ''))
}

export function registerServiceWorker(): void { if (!('serviceWorker' in navigator)) return; const proto = location.protocol; const host = location.hostname; const isSecure = (proto === 'https:') || (host === 'localhost') || (host === '127.0.0.1'); if (!isSecure || proto === 'file:' || proto === 'content:') return; try { navigator.serviceWorker.register('./sw.js').then(() => { w.Intervals.set('swKeepalive', () => { if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: 'KEEPALIVE' }) }, 20000) }).catch((err: any) => console.warn('[SW] register failed:', err)) } catch (err: any) { console.warn('[SW] error:', err) } }

export function checkLiqAlert(usd: number, qty: number, side: string, sym: string): void { if (!w.S.alerts.liqAlerts) return; if (qty < w.S.alerts.liqMinBtc) return; if (!(checkLiqAlert as any)._last || Date.now() - (checkLiqAlert as any)._last > 5000) { (checkLiqAlert as any)._last = Date.now(); sendAlert(`${sym} LIQUIDATION`, `$${fmt(usd)} ${side}`, 'liq') } }
export function testNotification(): void { sendAlert('ZeuS Terminal', 'Test alert working!', 'test') }
export function saveAlerts(): void { w.S.alerts.liqAlerts = el('aLiqEn')?.checked !== false; w.S.alerts.rsiAlerts = el('aDivEn')?.checked !== false; const liqMin = el('aLiqMin'); if (liqMin) w.S.alerts.liqMinBtc = +liqMin.value || 0; toast('Alert settings saved'); if (typeof w._usScheduleSave === 'function') w._usScheduleSave() }
export function applySR(): void { const en = el('srEn')?.checked !== false; w.S.overlays.sr = en; clearSR(); if (en) renderSROverlay(); const btn = el('bsr'); if (btn) btn.classList.toggle('act', en); toast('S/R settings applied') }

// ===== MISC (cloud, inject, filters, supremus) =====
export function cloudClear(): void { const ei = el('cloudEmail'); if (ei) ei.value = ''; toast('Email cleared') }
export function injectFakeWhale(): void { const sym = w.S.symbol || 'BTCUSDT'; const side = Math.random() > 0.5; const usd = Math.floor(Math.random() * 5000000) + 500000; const qty = usd / (w.S.price || 67000); const ev = { sym, isLong: side, usd, qty, price: w.S.price || 67000, ts: Date.now() }; w.S.events.unshift(ev); if (w.S.events.length > 200) w.S.events.pop(); renderFeed(); checkLiqAlert(usd, qty, side ? 'LONG' : 'SHORT', sym); toast(`Fake whale: $${fmt(usd)} ${side ? 'LONG' : 'SHORT'} ${sym}`) }
export function setLiqSym(sym: string, btn: any): void { w.S.liqFilter = w.S.liqFilter || { sym: 'BTC', minUsd: 0, tw: 24 }; w.S.liqFilter.sym = sym; const q = document.getElementById('lsymq'); if (q) q.querySelectorAll('.qb').forEach((b: any) => b.classList.remove('act')); if (btn) btn.classList.add('act'); toast('Filter: ' + sym) }
export function setLiqUsd(val: number, btn: any): void { w.S.liqFilter = w.S.liqFilter || { sym: 'BTC', minUsd: 0, tw: 24 }; w.S.liqFilter.minUsd = val; const container = btn?.parentElement; if (container) container.querySelectorAll('.qb').forEach((b: any) => b.classList.remove('act')); if (btn) btn.classList.add('act'); toast('Min size: $' + fmt(val)) }
export function setLiqTW(hours: number, btn: any): void { w.S.liqFilter = w.S.liqFilter || { sym: 'BTC', minUsd: 0, tw: 24 }; w.S.liqFilter.tw = hours; const container = btn?.parentElement; if (container) container.querySelectorAll('.qb').forEach((b: any) => b.classList.remove('act')); if (btn) btn.classList.add('act'); toast('Time window: ' + hours + 'h') }

export async function hashEmail(email: string): Promise<string> { const b = new TextEncoder().encode(email.toLowerCase().trim()); const h = await crypto.subtle.digest('SHA-256', b); return Array.from(new Uint8Array(h)).map(x => x.toString(16).padStart(2, '0')).join('') }
export async function cloudSave(): Promise<void> { const ei = el('cloudEmail'); if (!ei || !ei.value.trim()) { toast('Enter email first'); return }; const hash = await hashEmail(ei.value); const data = { symbol: w.S.symbol, chartTf: w.S.chartTf, tz: w.S.tz, indicators: w.S.indicators, overlays: w.S.overlays, activeInds: w.S.activeInds, heatmapSettings: w.S.heatmapSettings, alerts: w.S.alerts, zsSettings: w.S.zsSettings || {}, sessions: w.S.sessions || { asia: false, london: false, ny: false }, vwapOn: w.S.vwapOn || false, ts: Date.now() }; localStorage.setItem('zt_cloud_' + hash, JSON.stringify(data)); localStorage.setItem('zt_cloud_last_hash', hash); const st = el('cloudStatus'); if (st) st.textContent = 'Saved at ' + new Date().toLocaleTimeString('ro-RO', { timeZone: w.S.tz || 'Europe/Bucharest' }); toast('Settings saved to cloud!', 3000, _ZI.ok) }
export async function cloudLoad(): Promise<void> { const ei = el('cloudEmail'); if (!ei || !ei.value.trim()) { toast('Enter email first'); return }; const hash = await hashEmail(ei.value); const raw = localStorage.getItem('zt_cloud_' + hash); if (!raw) { toast('No saved data for this email'); return }; try { const data = JSON.parse(raw); if (data.symbol) w.S.symbol = data.symbol; if (data.chartTf) w.S.chartTf = data.chartTf; if (data.tz) w.S.tz = data.tz; if (data.indicators) w.S.indicators = data.indicators; if (data.overlays) w.S.overlays = data.overlays; if (data.activeInds) w.S.activeInds = data.activeInds; if (data.heatmapSettings) w.S.heatmapSettings = data.heatmapSettings; if (data.alerts) w.S.alerts = data.alerts; if (data.zsSettings) w.S.zsSettings = data.zsSettings; if (data.sessions) w.S.sessions = data.sessions; if (data.vwapOn != null) w.S.vwapOn = data.vwapOn; toast('Settings loaded!', 3000, _ZI.ok); const st = el('cloudStatus'); if (st) st.textContent = 'Loaded from ' + new Date(data.ts).toLocaleTimeString('ro-RO', { timeZone: w.S.tz || 'Europe/Bucharest' }) } catch (e: any) { toast('Error loading: ' + e.message) } }
export function initCloudSettings(): void { const hash = localStorage.getItem('zt_cloud_last_hash'); if (!hash) return; const st = el('cloudStatus'); if (st) st.textContent = 'Last sync available' }
export function applySessionSettings(): void { if (typeof w._usScheduleSave === 'function') w._usScheduleSave(); toast('Session settings saved') }

// ===== SUPREMUS + ZS =====
export function applyZS(): void { w.S.zsSettings = w.S.zsSettings || {}; const cbIds = ['zshh', 'zshl', 'zsll', 'zslh', 'zsbb', 'zsfi', 'zspi', 'zsvi', 'zsse', 'zsds', 'zspu', 'zspd', 'zspivot', 'zsvwap', 'zsShowZones', 'zsExtendZones']; cbIds.forEach((id: string) => { const e = el(id); if (e) w.S.zsSettings[id] = e.checked }); const colIds = ['zshhCol', 'zshlCol', 'zslhCol', 'zsllCol', 'zsUpperCol', 'zsLowerCol', 'zsVwapDc', 'zsVwapWc', 'zsVwapMc']; colIds.forEach((id: string) => { const e = el(id); if (e) w.S.zsSettings[id] = e.value }); const numIds = ['zsZoneWidth', 'zsPivotLen', 'zsPivotCount']; numIds.forEach((id: string) => { const e = el(id); if (e) w.S.zsSettings[id] = +e.value }); ['zsVwapD', 'zsVwapW', 'zsVwapM'].forEach((id: string) => { const e = el(id); if (e) w.S.zsSettings[id] = e.checked }); toast('Supremus settings saved', 3000, _ZI.crown); if (w.S.overlays.zs) { clearZS(); renderZS() } }
export function clearZS(): void { w.zsSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s) } catch (_) { } }); w.zsSeries = [] }
export function renderZS(): void {
  if (!w.S.klines || w.S.klines.length < 20) return
  const cfg = w.S.zsSettings || {}; const klines = w.S.klines; const n = klines.length
  const pivW = Math.max(2, Math.round((cfg.zsPivotLen) || 8))
  const showHH = cfg.zshh !== false, showHL = cfg.zshl !== false, showLH = cfg.zslh !== false, showLL = cfg.zsll !== false
  const hhCol = cfg.zshhCol || '#00d97a', hlCol = cfg.zshlCol || '#44aaff', lhCol = cfg.zslhCol || '#ff8800', llCol = cfg.zsllCol || '#ff3355'
  const pivHigh: number[] = [], pivLow: number[] = []
  for (let i = pivW; i < n - pivW; i++) { let isH = true, isL = true; for (let j = i - pivW; j <= i + pivW; j++) { if (j === i) continue; if (klines[j].high >= klines[i].high) isH = false; if (klines[j].low <= klines[i].low) isL = false }; if (isH) pivHigh.push(i); if (isL) pivLow.push(i) }
  const lastBarTime = klines[n - 1].time
  function addHLine(price: number, col: string, title: string) { const s = w.mainChart.addLineSeries({ color: col, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title, lineStyle: 1 }); s.setData([{ time: klines[Math.max(0, n - 100)].time, value: price }, { time: lastBarTime, value: price }]); w.zsSeries.push(s) }
  const maxPivots = Math.min(pivHigh.length, +(cfg.zsPivotCount) || 3)
  for (let pi = pivHigh.length - maxPivots; pi < pivHigh.length; pi++) { if (pi < 0 || pi >= pivHigh.length) continue; const idx = pivHigh[pi]; const price = klines[idx].high; const prev = pivHigh[pi - 1]; const isHH = prev != null && price > klines[prev].high; if (isHH && showHH) addHLine(price, hhCol, 'HH'); else if (!isHH && showLH) addHLine(price, lhCol, 'LH') }
  for (let pi = pivLow.length - maxPivots; pi < pivLow.length; pi++) { if (pi < 0 || pi >= pivLow.length) continue; const idx = pivLow[pi]; const price = klines[idx].low; const prev = pivLow[pi - 1]; const isHL = prev != null && price > klines[prev].low; if (isHL && showHL) addHLine(price, hlCol, 'HL'); else if (!isHL && showLL) addHLine(price, llCol, 'LL') }
  const extendZones = cfg.zsExtendZones === true; const maxExtend = extendZones ? n : 80
  if (cfg.zsShowZones !== false) {
    const zW = +(cfg.zsZoneWidth) || 6; const upCol = (cfg.zsUpperCol || '#00b8d4') + '44'; const dnCol = (cfg.zsLowerCol || '#aa44ff') + '44'
    const lastPH = pivHigh[pivHigh.length - 1]; const lastPL = pivLow[pivLow.length - 1]
    if (lastPH != null) { const ph = klines[lastPH].high; const mid = (ph + (ph + zW * 0.1 * (w.S.atr || ph * 0.001)) + (ph - zW * 0.1 * (w.S.atr || ph * 0.001))) / 3; const sTop = w.mainChart.addLineSeries({ color: upCol, lineWidth: Math.max(1, zW), priceLineVisible: false, lastValueVisible: false }); sTop.setData([{ time: klines[Math.max(0, n - maxExtend)].time, value: mid }, { time: lastBarTime, value: mid }]); w.zsSeries.push(sTop) }
    if (lastPL != null) { const pl = klines[lastPL].low; const mid = pl + zW * 0.05 * (w.S.atr || pl * 0.001); const sDn = w.mainChart.addLineSeries({ color: dnCol, lineWidth: Math.max(1, zW), priceLineVisible: false, lastValueVisible: false }); sDn.setData([{ time: klines[Math.max(0, n - maxExtend)].time, value: mid }, { time: lastBarTime, value: mid }]); w.zsSeries.push(sDn) }
  }
}
