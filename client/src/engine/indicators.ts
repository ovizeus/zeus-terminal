// Zeus — engine/indicators.ts
// Ported 1:1 from public/js/brain/deepdive.js lines 3733-4912 (Phase 5B1)
// Live API stubs, PWA, Indicator panel, Overlay/Oscillator indicators,
// Signal scanner, Deep Dive narrative generator

import { api } from '../services/api'
import { fmtTime, fmtDate, fmtNow, toast, _calcATRSeries } from '../data/marketDataHelpers'
import { sendAlert } from '../data/marketDataWS'
import { liveApiSyncState } from '../trading/liveApi'
import { fmt, fP } from '../utils/format'
import { escHtml, el } from '../utils/dom'
import { _ZI } from '../constants/icons'
import { sma as _calcSMA, hma as _calcHMA, keltner as _calcKC, donchian as _calcDC, parabolicSAR as _calcPSAR, adx as _calcADX, williamsR as _calcWILLR, roc as _calcROC, cmf as _calcCMF, awesomeOscillator as _calcAO, vwma as _calcVWMA, aroon as _calcAROON, trix as _calcTRIX, ultimateOscillator as _calcUO, choppiness as _calcCHOP, keraunos as _calcKERA, aether as _calcAETHER, marketStructure as _calcMS, nemesis as _calcNEM, pythia as _calcPYTHIA, ema as _calcEMA, plutus as _calcPLUTUS, helios as _calcHELIOS, hermes as _calcHERMES, charon as _calcCHARON, atlas as _calcATLAS, eos as _calcEOS, pantheon as _calcPANTHEON, aegis as _calcAEGIS, selene as _calcSELENE, kratos as _calcKRATOS, pantheon as _calcPANTHEON2, prometheus as _calcPROM, mnemosyne as _calcMNEMO, themis as _calcTHEMIS, erebus as _calcEREBUS, anemoi as _calcANEMOI, cerberus as _calcCERBERUS } from './indicatorCalc'
import { IND_ICONS } from '../constants/indicatorIcons'
import { playAlertSound } from '../ui/dom2'
import { renderSignals } from './signals'
import { renderVWAP, getVwapSeries, resetVwapSeries } from '../ui/panels'
import { getChartW } from '../data/marketDataChart'
import { atLog } from '../trading/autotrade'

const w = window as any

// Module-level chart refs (owned by this file)
let _macdChart: any = null
export function getMacdChart(): any { return _macdChart }

// ═══════════════════════════════════════════════════════════════
// LIVE API STUBS
// ═══════════════════════════════════════════════════════════════

export function connectLiveAPI(): void {
  const st = el('apiStatus')
  if (st) { st.innerHTML = _ZI.timer + ' Checking exchange connection...'; st.style.color = 'var(--yel)' }
  api.raw<any>('GET', '/api/exchange/status').then(function (data: any) {
    if (!data.ok || !data.connected) {
      if (st) {
        st.innerHTML = _ZI.w + ' No exchange connection configured.<br><span style="color:#00afff;cursor:pointer" onclick="openM(\'msettings\');swtab(\'msettings\',\'set-exchange\',document.querySelector(\'[data-extab]\'))">' + _ZI.bolt + ' Configure in Settings \u2192 Exchange API</span>'
        st.style.color = '#f0c040'
      }
      return
    }
    // [Phase 12.A — Batch H cleanup] No more hardcoded "binance" default.
    // Whitelist server truth; null when unknown, never faked. Display label
    // falls back to neutral "ACTIVE EXCHANGE" instead of inventing a brand.
    const _rawExch = data.exchange
    const exchange: 'binance' | 'bybit' | null = (_rawExch === 'binance' || _rawExch === 'bybit') ? _rawExch : null
    const mode = data.mode || 'live'
    w.TP.liveConnected = true; w.TP.liveExchange = exchange
    const _exchDisplay = exchange ? exchange.toUpperCase() : 'ACTIVE EXCHANGE'
    if (st) {
      st.innerHTML = _ZI.ok + ' <b>' + _exchDisplay + '</b> \u2014 ' + mode.toUpperCase() + '<br><span style="font-size:8px;color:#556">API: ' + (data.maskedKey || '***') + ' \u00B7 Last verified: ' + (data.lastVerified || 'N/A') + '</span>'
      st.style.color = 'var(--grn)'
    }
    const form = el('liveOrderForm'); if (form) form.style.display = 'block'
    const btn = el('btnConnectExchange'); if (btn) btn.style.display = 'none'
    if (typeof liveApiSyncState === 'function') liveApiSyncState()
  }).catch(function (err: any) {
    if (st) { st.innerHTML = _ZI.x + ' Backend unreachable: ' + escHtml(err.message || err); st.style.color = 'var(--red)' }
  })
}

export function placeLiveOrder(): void {
  toast('placeLiveOrder disabled \u2014 use standard Live Trading panel', 0, _ZI.x)
  atLog('warn', '[BLOCK] placeLiveOrder is disabled (orphan order path \u2014 use Live Trading panel)')
}

export function connectLiveExchange(): void {
  toast('LIVE TRADING DISABLED \u2014 backend required.', 0, _ZI.dRed)
}

export function loadSavedAPI(): void {
  localStorage.removeItem('zt_api_key')
  localStorage.removeItem('zt_api_secret')
  localStorage.removeItem('zt_api_token')
  localStorage.removeItem('zt_api_exchange')
  connectLiveAPI()
}

export function installPWA(): void {
  const prompt = w._dip || w._deferredPrompt
  if (prompt) { prompt.prompt(); prompt.userChoice.then(() => { const b = el('installBtn'); if (b) b.style.display = 'none'; w._dip = null; w._deferredPrompt = null }) }
  else toast('Open in Chrome/Brave \u2192 menu \u2192 Install app')
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR STATE INIT
// ═══════════════════════════════════════════════════════════════

export function initIndicatorState(): void {
  if (typeof w.S === 'undefined' || !w.S) return
  if (!w.S.activeInds) w.S.activeInds = { ema: true, wma: true, st: true, vp: true }
  if (!w.S.macdData) w.S.macdData = []
  if (!w.S.signalData) w.S.signalData = {}
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR PANEL
// ═══════════════════════════════════════════════════════════════

export function openIndPanel(): void {
  const ov = document.getElementById('indOverlay')
  const pan = document.getElementById('indPanel')
  const body = document.getElementById('indPanelBody')
  if (!ov || !pan || !body) return

  body.innerHTML = ''
  const _sorted = w.INDICATORS.slice().sort(function (a: any, b: any) {
    const aOn = w.S.activeInds[a.id] ? 1 : 0
    const bOn = w.S.activeInds[b.id] ? 1 : 0
    return bOn - aOn
  })
  _sorted.forEach((ind: any) => {
    const on = !!w.S.activeInds[ind.id]
    const row = document.createElement('div')
    row.className = 'ind-row'
    row.innerHTML = `
      <div class="ind-row-l">
        <span class="ind-row-ico">${ind.ico}</span>
        <div>
          <div class="ind-row-name">${ind.name}</div>
          <div class="ind-row-desc">${ind.desc}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="ind-gear" data-action="openIndSettings" data-id="${ind.id}" title="Settings">${_ZI.bolt}</span>
        <div class="ind-toggle ${on ? 'on' : ''}" data-action="toggleInd" data-id="${ind.id}">
          <div class="ind-toggle-dot"></div>
        </div>
      </div>
    `
    body.appendChild(row)
  })

  // Event delegation for indicator panel buttons
  if (!body.dataset.delegated) {
    body.dataset.delegated = '1'
    body.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement
      if (!target) return
      const action = target.dataset.action
      const id = target.dataset.id
      if (action === 'openIndSettings') { e.stopPropagation(); openIndSettings(id || '') }
      else if (action === 'toggleInd') toggleInd(id || '', target)
    })
  }

  ov.classList.add('open')
  pan.classList.add('open')
}

export function closeIndPanel(): void {
  document.getElementById('indOverlay')?.classList.remove('open')
  document.getElementById('indPanel')?.classList.remove('open')
}

export function toggleInd(id: string, toggleEl: HTMLElement): void {
  w.S.activeInds[id] = !w.S.activeInds[id]
  w.S.indicators[id] = w.S.activeInds[id]
  if (w.S.activeInds[id]) toggleEl.classList.add('on')
  else toggleEl.classList.remove('on')
  applyIndVisibility(id, w.S.activeInds[id])
  if (w.S.activeInds[id] && typeof w.renderChart === 'function') w.renderChart()
  renderActBar()
  toast(w.S.activeInds[id] ? w.INDICATORS.find((i: any) => i.id === id)?.name + ' ON' : w.INDICATORS.find((i: any) => i.id === id)?.name + ' OFF')
  if (typeof w._usSave === 'function') w._usSave()
  if (typeof w._userCtxPushNow === 'function') w._userCtxPushNow()
}

export function applyIndVisibility(id: string, visible: boolean): void {
  const show = visible
  switch (id) {
    case 'ema':
      if (w.ema50S) w.ema50S.applyOptions({ visible: show })
      if (w.ema200S) w.ema200S.applyOptions({ visible: show })
      if (w.ema3S) w.ema3S.applyOptions({ visible: show })
      if (w.ema4S) w.ema4S.applyOptions({ visible: show })
      break
    case 'wma':
      if (w.wma20S) w.wma20S.applyOptions({ visible: show })
      if (w.wma50S) w.wma50S.applyOptions({ visible: show })
      break
    case 'st':
      if (w.stS) w.stS.applyOptions({ visible: show })
      break
    case 'bb':
      if (show) initBBSeries()
      if (w.bbUpperS) w.bbUpperS.applyOptions({ visible: show })
      if (w.bbMiddleS) w.bbMiddleS.applyOptions({ visible: show })
      if (w.bbLowerS) w.bbLowerS.applyOptions({ visible: show })
      if (show) updateBB()
      break
    case 'ichimoku':
      if (show) initIchimokuSeries()
      if (!Array.isArray(w.ichimokuSeries)) w.ichimokuSeries = []
      w.ichimokuSeries.forEach((s: any) => { try { s.applyOptions({ visible: show }) } catch (_) { } })
      if (show) updateIchimoku()
      break
    case 'fib':
      if (show) updateFib()
      else { if (Array.isArray(w.fibSeries)) w.fibSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s) } catch (_) { } }); w.fibSeries = [] }
      break
    case 'pivot':
      if (show) updatePivot()
      else { if (Array.isArray(w.pivotSeries)) w.pivotSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s) } catch (_) { } }); w.pivotSeries = [] }
      break
    case 'vp':
      if (show) updateVP()
      else { if (Array.isArray(w.vpSeries)) w.vpSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s) } catch (_) { } }); w.vpSeries = [] }
      break
    case 'vwap':
      w.S.vwapOn = show
      if (show) { if (typeof renderVWAP === 'function') renderVWAP() }
      else { getVwapSeries().forEach((s: any) => { try { w.mainChart.removeSeries(s) } catch (_) { } }); resetVwapSeries() }
      { const vBtn = document.getElementById('vwapBtn'); if (vBtn) vBtn.classList.toggle('on', show) }
      break
    case 'cvd':
      { const cvdEl = document.getElementById('cc'); if (cvdEl) cvdEl.style.display = show ? '' : 'none' }
      break
    case 'macd':
      { const mc = document.getElementById('macdChart'); if (mc) mc.style.display = show ? '' : 'none'; if (show) initMACDChart() }
      break
    case 'rsi14':
      { const rc = document.getElementById('rsiChart'); if (rc) rc.style.display = show ? '' : 'none'; if (show) initRSIChart() }
      break
    case 'stoch':
      { const sc = document.getElementById('stochChart'); if (sc) sc.style.display = show ? '' : 'none'; if (show) initStochChart() }
      break
    case 'atr':
      { const ac = document.getElementById('atrChart'); if (ac) ac.style.display = show ? '' : 'none'; if (show) initATRChart() }
      break
    case 'obv':
      { const oc = document.getElementById('obvChart'); if (oc) oc.style.display = show ? '' : 'none'; if (show) initOBVChart() }
      break
    case 'mfi':
      { const mfc = document.getElementById('mfiChart'); if (mfc) mfc.style.display = show ? '' : 'none'; if (show) initMFIChart() }
      break
    case 'cci':
      { const cc = document.getElementById('cciChart'); if (cc) cc.style.display = show ? '' : 'none'; if (show) initCCIChart() }
      break
    // [2026-06-16] New oscillators (batch 2)
    case 'adx':
      { const ax = document.getElementById('adxChart'); if (ax) ax.style.display = show ? '' : 'none'; if (show) initADXChart() }
      break
    case 'willr':
      { const wx = document.getElementById('willrChart'); if (wx) wx.style.display = show ? '' : 'none'; if (show) initWILLRChart() }
      break
    case 'roc':
      { const rx = document.getElementById('rocChart'); if (rx) rx.style.display = show ? '' : 'none'; if (show) initROCChart() }
      break
    case 'cmf':
      { const cx = document.getElementById('cmfChart'); if (cx) cx.style.display = show ? '' : 'none'; if (show) initCMFChart() }
      break
    case 'ao':
      { const aox = document.getElementById('aoChart'); if (aox) aox.style.display = show ? '' : 'none'; if (show) initAOChart() }
      break
    // [2026-06-16] New indicators (batch 3): VWMA overlay + 4 oscillator panes
    case 'vwma':
      if (show) initVWMASeries()
      if (w.vwmaS) w.vwmaS.applyOptions({ visible: show })
      if (show) updateVWMA()
      break
    case 'aroon':
      { const arx = document.getElementById('aroonChart'); if (arx) arx.style.display = show ? '' : 'none'; if (show) initAroonChart() }
      break
    case 'trix':
      { const trx = document.getElementById('trixChart'); if (trx) trx.style.display = show ? '' : 'none'; if (show) initTrixChart() }
      break
    case 'uo':
      { const uox = document.getElementById('uoChart'); if (uox) uox.style.display = show ? '' : 'none'; if (show) initUOChart() }
      break
    case 'chop':
      { const chx = document.getElementById('chopChart'); if (chx) chx.style.display = show ? '' : 'none'; if (show) initChopChart() }
      break
    case 'kera':
      if (show) initKeraSeries()
      ;[w.keraS, w.keraUpS, w.keraLowS].forEach((sx: any) => { if (sx) sx.applyOptions({ visible: show }) })
      if (show) updateKera()
      break
    case 'aether':
      if (show) initAetherSeries()
      ;[w.aetMidS, w.aetUpS, w.aetLowS].forEach((sx: any) => { if (sx) sx.applyOptions({ visible: show }) })
      if (show) updateAether()
      break
    case 'ms':
      if (show) initMSSeries()
      if (w.msZigS) { w.msZigS.applyOptions({ visible: show }); if (!show) try { w.msZigS.setMarkers([]) } catch (_) { } }
      if (show) updateMS()
      break
    case 'nem':
      if (show) initNemSeries()
      if (w.nemS) { w.nemS.applyOptions({ visible: show }); if (!show) try { w.nemS.setMarkers([]); w.nemS.setData([]) } catch (_) { } }
      if (show) updateNem()
      break
    case 'iris':
      if (show) initIrisSeries()
      if (Array.isArray(w.irisSeries)) w.irisSeries.forEach((sx: any) => { if (sx) sx.applyOptions({ visible: show }) })
      if (show) updateIris()
      break
    case 'pythia':
      if (show) initPythiaSeries()
      ;[w.pythiaMarkS, w.pythiaTpS, w.pythiaSlS].forEach((sx: any) => { if (sx) sx.applyOptions({ visible: show }) })
      if (w.pythiaMarkS && !show) try { w.pythiaMarkS.setMarkers([]) } catch (_) { }
      if (show) updatePythia()
      break
    case 'plutus':
      if (show) initPlutusSeries()
      if (w.plutusS) { w.plutusS.applyOptions({ visible: show }); if (!show) try { w.plutusS.setMarkers([]); w.plutusS.setData([]) } catch (_) { } }
      if (show) updatePlutus()
      break
    case 'helios':
      { const hex = document.getElementById('heliosChart'); if (hex) hex.style.display = show ? '' : 'none'; if (show) initHeliosChart() }
      break
    case 'hermes':
      if (show) initHermesSeries()
      ;[w.hermesMarkS, w.hermesTopS, w.hermesBotS].forEach((sx: any) => { if (sx) sx.applyOptions({ visible: show }) })
      if (w.hermesMarkS && !show) try { w.hermesMarkS.setMarkers([]) } catch (_) { }
      if (show) updateHermes()
      break
    case 'charon':
      if (show) { initCharonSeries(); updateCharon() }
      else if (w.charonS && w._charonLines) { try { w._charonLines.forEach((pl: any) => w.charonS.removePriceLine(pl)) } catch (_) { } w._charonLines = [] }
      break
    case 'atlas':
      { const atx = document.getElementById('atlasChart'); if (atx) atx.style.display = show ? '' : 'none'; if (show) initAtlasChart() }
      break
    case 'eos':
      if (show) initEosSeries()
      if (w.eosS) { w.eosS.applyOptions({ visible: show }); if (!show) try { w.eosS.setMarkers([]); w.eosS.setData([]) } catch (_) { } }
      if (show) updateEos()
      break
    case 'pantheon':
      { const ptx = document.getElementById('pantheonChart'); if (ptx) ptx.style.display = show ? '' : 'none'; if (show) initPantheonChart() }
      break
    case 'aegis':
      if (show) initAegisSeries()
      ;[w.aegisMarkS, w.aegisStopS].forEach((sx: any) => { if (sx) sx.applyOptions({ visible: show }) })
      if (w.aegisMarkS && !show) try { w.aegisMarkS.setMarkers([]) } catch (_) { }
      if (show) updateAegis()
      break
    case 'selene':
      { const slx = document.getElementById('seleneChart'); if (slx) slx.style.display = show ? '' : 'none'; if (show) initSeleneChart() }
      break
    case 'prometheus':
      if (show) initPrometheusSeries()
      ;[w.promCenterS, w.promUp1S, w.promLo1S, w.promUp2S, w.promLo2S].forEach((sx: any) => { if (sx) { sx.applyOptions({ visible: show }); if (!show) try { sx.setData([]) } catch (_) { } } })
      if (show) updatePrometheus()
      break
    case 'mnemosyne':
      if (show) initMnemoSeries()
      if (w.mnemoS) { w.mnemoS.applyOptions({ visible: show }); if (!show) try { w.mnemoS.setData([]) } catch (_) { } }
      if (show) updateMnemo()
      break
    case 'themis':
      { const thx = document.getElementById('themisChart'); if (thx) thx.style.display = show ? '' : 'none'; if (show) initThemisChart() }
      break
    case 'erebus':
      { const erx = document.getElementById('erebusChart'); if (erx) erx.style.display = show ? '' : 'none'; if (show) initErebusChart() }
      break
    case 'anemoi':
      { const anx = document.getElementById('anemoiChart'); if (anx) anx.style.display = show ? '' : 'none'; if (show) initAnemoiChart() }
      break
    case 'cerberus':
      { const cbx = document.getElementById('cerberusChart'); if (cbx) cbx.style.display = show ? '' : 'none'; if (show) initCerberusChart() }
      break
    case 'kratos':
      if (show) { initKratosSeries(); initKratosHud(); updateKratos() }
      else {
        ;[w.kratosMarkS, w.kratosEntryS, w.kratosTpS, w.kratosSlS].forEach((sx: any) => { if (sx) { try { sx.applyOptions({ visible: false }); if (sx.setMarkers) sx.setMarkers([]); sx.setData([]) } catch (_) { } } })
        if (w._kratosHud) w._kratosHud.style.display = 'none'
      }
      break
    // [2026-06-16] New overlays (batch 1)
    case 'sma':
      if (show) initSMASeries()
      if (w.smaS) w.smaS.applyOptions({ visible: show })
      if (show) updateSMA()
      break
    case 'hma':
      if (show) initHMASeries()
      if (w.hmaS) w.hmaS.applyOptions({ visible: show })
      if (show) updateHMA()
      break
    case 'psar':
      if (show) initPSARSeries()
      if (w.psarS) w.psarS.applyOptions({ visible: show })
      if (show) updatePSAR()
      break
    case 'kc':
      if (show) initKCSeries()
      ;[w.kcUpperS, w.kcMiddleS, w.kcLowerS].forEach((s: any) => { if (s) s.applyOptions({ visible: show }) })
      if (show) updateKC()
      break
    case 'dc':
      if (show) initDCSeries()
      ;[w.dcUpperS, w.dcMiddleS, w.dcLowerS].forEach((s: any) => { if (s) s.applyOptions({ visible: show }) })
      if (show) updateDC()
      break
  }
}

// ═══════════════════════════════════════════════════════════════
// [2026-06-16] NEW OVERLAY INDICATORS — batch 1
// SMA, Hull MA, Parabolic SAR, Keltner Channels, Donchian Channels.
// Pure math in ./indicatorCalc (unit-tested); these map to chart series.
// Source bars: w.S.klines [{time,open,high,low,close,volume}]. Lazy-init series.
// ═══════════════════════════════════════════════════════════════
function _klTime(i: number): any { return w.S.klines[i].time }

export function initSMASeries(): void {
  if (w.smaS || !w.mainChart) return
  w.smaS = w.mainChart.addLineSeries({ color: '#26c6da', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
}
export function updateSMA(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initSMASeries()
  const vals = _calcSMA(w.S.klines.map((k: any) => k.close), Math.round(w.IND_SETTINGS.sma.period) || 20)
  const data: any[] = []
  for (let i = 0; i < vals.length; i++) if (vals[i] != null) data.push({ time: _klTime(i), value: vals[i] })
  try { w.smaS.setData(data) } catch (_) { }
}

export function initHMASeries(): void {
  if (w.hmaS || !w.mainChart) return
  w.hmaS = w.mainChart.addLineSeries({ color: '#ffca28', lineWidth: 2, priceLineVisible: false, lastValueVisible: false })
}
export function updateHMA(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initHMASeries()
  const vals = _calcHMA(w.S.klines.map((k: any) => k.close), Math.round(w.IND_SETTINGS.hma.period) || 21)
  const data: any[] = []
  for (let i = 0; i < vals.length; i++) if (vals[i] != null) data.push({ time: _klTime(i), value: vals[i] })
  try { w.hmaS.setData(data) } catch (_) { }
}

export function initPSARSeries(): void {
  if (w.psarS || !w.mainChart) return
  // Dotted line + per-point color (green=uptrend SAR below price, red=downtrend above).
  w.psarS = w.mainChart.addLineSeries({ color: '#00e5ff', lineWidth: 1, lineStyle: 1, priceLineVisible: false, lastValueVisible: false })
}
export function updatePSAR(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initPSARSeries()
  const highs = w.S.klines.map((k: any) => k.high), lows = w.S.klines.map((k: any) => k.low)
  const { sar, isUp } = _calcPSAR(highs, lows, w.IND_SETTINGS.psar.step || 0.02, w.IND_SETTINGS.psar.maxAf || 0.2)
  const data: any[] = []
  for (let i = 0; i < sar.length; i++) if (sar[i] != null) data.push({ time: _klTime(i), value: sar[i], color: isUp[i] ? '#26ff9a' : '#ff5277' })
  try { w.psarS.setData(data) } catch (_) { }
}

export function initKCSeries(): void {
  if (w.kcUpperS || !w.mainChart) return
  w.kcUpperS = w.mainChart.addLineSeries({ color: '#ab47bc66', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
  w.kcMiddleS = w.mainChart.addLineSeries({ color: '#ab47bc', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
  w.kcLowerS = w.mainChart.addLineSeries({ color: '#ab47bc66', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
}
export function updateKC(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initKCSeries()
  const b = _calcKC(w.S.klines.map((k: any) => k.high), w.S.klines.map((k: any) => k.low), w.S.klines.map((k: any) => k.close), Math.round(w.IND_SETTINGS.kc.period) || 20, w.IND_SETTINGS.kc.mult || 2)
  const U: any[] = [], M: any[] = [], L: any[] = []
  for (let i = 0; i < b.middle.length; i++) { const t = _klTime(i); if (b.upper[i] != null) U.push({ time: t, value: b.upper[i] }); if (b.middle[i] != null) M.push({ time: t, value: b.middle[i] }); if (b.lower[i] != null) L.push({ time: t, value: b.lower[i] }) }
  try { w.kcUpperS.setData(U); w.kcMiddleS.setData(M); w.kcLowerS.setData(L) } catch (_) { }
}

export function initDCSeries(): void {
  if (w.dcUpperS || !w.mainChart) return
  w.dcUpperS = w.mainChart.addLineSeries({ color: '#42a5f5', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
  w.dcMiddleS = w.mainChart.addLineSeries({ color: '#42a5f566', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
  w.dcLowerS = w.mainChart.addLineSeries({ color: '#42a5f5', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
}
export function updateDC(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initDCSeries()
  const b = _calcDC(w.S.klines.map((k: any) => k.high), w.S.klines.map((k: any) => k.low), Math.round(w.IND_SETTINGS.dc.period) || 20)
  const U: any[] = [], M: any[] = [], L: any[] = []
  for (let i = 0; i < b.middle.length; i++) { const t = _klTime(i); if (b.upper[i] != null) U.push({ time: t, value: b.upper[i] }); if (b.middle[i] != null) M.push({ time: t, value: b.middle[i] }); if (b.lower[i] != null) L.push({ time: t, value: b.lower[i] }) }
  try { w.dcUpperS.setData(U); w.dcMiddleS.setData(M); w.dcLowerS.setData(L) } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR SETTINGS MODAL
// ═══════════════════════════════════════════════════════════════

export function openIndSettings(id: string): void {
  const cfg = w.IND_SETTINGS[id]
  if (!cfg) { toast('No settings for ' + id.toUpperCase()); return }
  const ind = w.INDICATORS.find((i: any) => i.id === id)
  const labels: Record<string, string> = {
    p1: 'Period 1', p2: 'Period 2', p3: 'Period 3', p4: 'Period 4', period: 'Period', mult: 'Multiplier',
    stdDev: 'Inner Band σ', stdDev2: 'Outer Band σ', kPeriod: 'K Period', dPeriod: 'D Period', smooth: 'Smoothing',
    fast: 'Fast', slow: 'Slow', signal: 'Signal', tenkan: 'Tenkan', kijun: 'Kijun',
    senkou: 'Senkou Span B', rows: 'Rows', type: 'Type', smoothing: 'Smoothing (SMA)',
    levels: 'Levels (CSV)', step: 'Step', maxAf: 'Max Accel', er: 'Efficiency', atrP: 'ATR Length', bbMult: 'BB ×', kcMult: 'KC ×', lookback: 'Swing Lookback', setupLen: 'Setup Length', climaxMult: 'Climax ×', base: 'Base EMA', tpMult: 'Target ×ATR', slMult: 'Stop ×ATR', volMult: 'Climax Vol ×', minPct: 'Min Gap %', tolPct: 'Cluster Tol %', minHits: 'Min Touches', rocLen: 'ROC Length', rsiPeriod: 'RSI Length', thr: 'Confluence Thr', atrMult: 'Stop ×ATR', detrendLen: 'Detrend Len', minP: 'Min Cycle', maxP: 'Max Cycle', rr: 'Risk:Reward', horizon: 'Horizon (bars)', drift: 'Drift (1/0)', queryLen: 'Pattern Len', dim: 'Embed Dim', baseLen: 'Base TF Len', mult2: 'Mid ×', mult3: 'Slow ×'
  }
  // [batch3-B] pivot.type dropdown options
  const typeOpts: Record<string, string[]> = {
    pivot: ['standard', 'fibonacci', 'camarilla', 'woodie', 'demark']
  }
  let html = `<div class="ind-set-title">${ind ? ind.ico : _ZI.bolt} ${ind ? ind.name : id.toUpperCase()} Settings</div>`
  const entries = Object.entries(cfg)
  if (!entries.length) {
    html += `<div class="ind-set-row" style="color:#888;font-size:11px">No configurable parameters.</div>`
  }
  for (const [key, val] of entries) {
    if (key === 'type') {
      const opts = typeOpts[id] || [String(val)]
      const sel = opts.map((o: string) => `<option value="${o}"${o === val ? ' selected' : ''}>${o}</option>`).join('')
      html += `<div class="ind-set-row"><label>${labels[key] || key}</label><select id="indset-${id}-${key}" class="ind-set-input">${sel}</select></div>`
    } else if (key === 'levels' && Array.isArray(val)) {
      const csv = (val as any[]).join(',')
      html += `<div class="ind-set-row"><label>${labels[key] || key}</label><input type="text" id="indset-${id}-${key}" value="${csv}" placeholder="0, 0.236, 0.382, 0.5, 0.618, 0.786, 1" class="ind-set-input"></div>`
    } else {
      html += `<div class="ind-set-row"><label>${labels[key] || key}</label><input type="number" id="indset-${id}-${key}" value="${val}" min="0" max="500" step="any" class="ind-set-input"></div>`
    }
  }
  html += `<div style="display:flex;gap:8px;margin-top:10px"><button class="ind-set-btn" data-action="applyIndSettings" data-id="${id}">Apply</button><button class="ind-set-btn cancel" data-action="closeIndSettings">Cancel</button></div>`
  let modal = document.getElementById('indSettingsModal')
  if (!modal) {
    modal = document.createElement('div')
    modal.id = 'indSettingsModal'
    modal.className = 'ind-settings-modal'
    document.body.appendChild(modal)
  }
  modal.innerHTML = html
  ;(modal as HTMLElement).style.display = 'flex'
  // Event delegation for settings modal buttons
  if (!modal.dataset.delegated) {
    modal.dataset.delegated = '1'
    modal.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement
      if (!btn) return
      if (btn.dataset.action === 'applyIndSettings') applyIndSettings(btn.dataset.id || '')
      else if (btn.dataset.action === 'closeIndSettings') closeIndSettings()
    })
  }
}

export function closeIndSettings(): void {
  const m = document.getElementById('indSettingsModal')
  if (m) (m as HTMLElement).style.display = 'none'
}

export function applyIndSettings(id: string): void {
  const cfg = w.IND_SETTINGS[id]
  if (!cfg) return
  for (const key of Object.keys(cfg)) {
    const inp = document.getElementById('indset-' + id + '-' + key) as HTMLInputElement | HTMLSelectElement | null
    if (!inp) continue
    if (key === 'type') {
      const val = (inp as HTMLSelectElement).value
      if (val) cfg[key] = val
    } else if (key === 'levels') {
      const parsed = (inp as HTMLInputElement).value.split(',').map((s: string) => parseFloat(s.trim())).filter((n: number) => isFinite(n))
      if (parsed.length) cfg[key] = parsed
    } else {
      const v = parseFloat((inp as HTMLInputElement).value)
      // smoothing allows 0 (= disabled); other numeric keys require > 0
      if (isFinite(v) && (v > 0 || key === 'smoothing')) cfg[key] = v
    }
  }
  closeIndSettings()
  if (typeof w._indSettingsSave === 'function') w._indSettingsSave()
  if (typeof w._userCtxPush === 'function') w._userCtxPush()
  if (w.S.activeInds[id]) {
    if (typeof w.renderChart === 'function') w.renderChart()
    applyIndVisibility(id, true)
  }
  toast(id.toUpperCase() + ' settings updated', 0, _ZI.bolt)
}

// ═══════════════════════════════════════════════════════════════
// OVERLAY — Bollinger Bands
// ═══════════════════════════════════════════════════════════════

export function initBBSeries(): void {
  if (w.bbUpperS || !w.mainChart) return
  w.bbUpperS = w.mainChart.addLineSeries({ color: '#ff668866', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 })
  w.bbMiddleS = w.mainChart.addLineSeries({ color: '#ff6688', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
  w.bbLowerS = w.mainChart.addLineSeries({ color: '#ff668866', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 })
}

export function updateBB(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initBBSeries()
  const c = w.S.klines.map((k: any) => k.close)
  const p = Math.round(w.IND_SETTINGS.bb.period) || 20
  const sd = w.IND_SETTINGS.bb.stdDev || 2
  const upper: any[] = [], middle: any[] = [], lower: any[] = []
  for (let i = 0; i < c.length; i++) {
    if (i < p - 1) { upper.push({ time: w.S.klines[i].time, value: 0 }); middle.push({ time: w.S.klines[i].time, value: 0 }); lower.push({ time: w.S.klines[i].time, value: 0 }); continue }
    let sum = 0; for (let j = i - p + 1; j <= i; j++) sum += c[j]; const avg = sum / p
    let variance = 0; for (let j = i - p + 1; j <= i; j++) variance += Math.pow(c[j] - avg, 2); const stdDev = Math.sqrt(variance / p)
    middle.push({ time: w.S.klines[i].time, value: avg })
    upper.push({ time: w.S.klines[i].time, value: avg + sd * stdDev })
    lower.push({ time: w.S.klines[i].time, value: avg - sd * stdDev })
  }
  try { w.bbMiddleS.setData(middle.filter((d: any) => d.value > 0)); w.bbUpperS.setData(upper.filter((d: any) => d.value > 0)); w.bbLowerS.setData(lower.filter((d: any) => d.value > 0)) } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// OVERLAY — Ichimoku Cloud
// ═══════════════════════════════════════════════════════════════

export function initIchimokuSeries(): void {
  if (w.ichimokuSeries.length || !w.mainChart) return
  const tenkanS = w.mainChart.addLineSeries({ color: '#0496ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'Tenkan' })
  const kijunS = w.mainChart.addLineSeries({ color: '#ff3355', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'Kijun' })
  const spanAS = w.mainChart.addLineSeries({ color: '#00d97a66', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 })
  const spanBS = w.mainChart.addLineSeries({ color: '#ff335566', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 2 })
  const chikouS = w.mainChart.addLineSeries({ color: '#aa44ff66', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: 3 })
  w.ichimokuSeries = [tenkanS, kijunS, spanAS, spanBS, chikouS]
}

function _ichiHL(klines: any[], p: number, idx: number): number {
  let h = -Infinity, l = Infinity
  for (let j = Math.max(0, idx - p + 1); j <= idx; j++) { h = Math.max(h, klines[j].high); l = Math.min(l, klines[j].low) }
  return (h + l) / 2
}

export function updateIchimoku(): void {
  if (!w.mainChart || !w.S.klines.length || w.ichimokuSeries.length < 5) return
  const k = w.S.klines; const cfg = w.IND_SETTINGS.ichimoku
  const tenkan: any[] = [], kijun: any[] = [], spanA: any[] = [], spanB: any[] = [], chikou: any[] = []
  for (let i = 0; i < k.length; i++) {
    const tv = i >= cfg.tenkan - 1 ? _ichiHL(k, cfg.tenkan, i) : null
    const kv = i >= cfg.kijun - 1 ? _ichiHL(k, cfg.kijun, i) : null
    if (tv !== null) tenkan.push({ time: k[i].time, value: tv })
    if (kv !== null) kijun.push({ time: k[i].time, value: kv })
    if (tv !== null && kv !== null && i + cfg.kijun < k.length) spanA.push({ time: k[i + cfg.kijun].time, value: (tv + kv) / 2 })
    if (i >= cfg.senkou - 1 && i + cfg.kijun < k.length) spanB.push({ time: k[i + cfg.kijun].time, value: _ichiHL(k, cfg.senkou, i) })
    if (i >= cfg.kijun) chikou.push({ time: k[i - cfg.kijun].time, value: k[i].close })
  }
  try { w.ichimokuSeries[0].setData(tenkan); w.ichimokuSeries[1].setData(kijun); w.ichimokuSeries[2].setData(spanA); w.ichimokuSeries[3].setData(spanB); w.ichimokuSeries[4].setData(chikou) } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// OVERLAY — Fibonacci Retracement
// ═══════════════════════════════════════════════════════════════

export function updateFib(): void {
  if (!Array.isArray(w.fibSeries)) w.fibSeries = []
  w.fibSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s) } catch (_) { } }); w.fibSeries = []
  if (!w.mainChart || !w.S.klines.length) return
  const k = w.S.klines; let swH = -Infinity, swL = Infinity, hiIdx = 0, loIdx = 0
  const start = Math.max(0, k.length - 100)
  for (let i = start; i < k.length; i++) { if (k[i].high > swH) { swH = k[i].high; hiIdx = i } if (k[i].low < swL) { swL = k[i].low; loIdx = i } }
  if (swH <= swL) return
  const isUptrend = loIdx < hiIdx
  const colors = ['#ffffff44', '#00d97a55', '#00b8d455', '#f0c04066', '#ff880066', '#ff335566', '#ff668866']
  const levels = w.IND_SETTINGS.fib.levels
  levels.forEach((lv: number, idx: number) => {
    const price = isUptrend ? swH - lv * (swH - swL) : swL + lv * (swH - swL)
    const s = w.mainChart.addLineSeries({ color: colors[idx] || '#888', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: (lv * 100).toFixed(1) + '%', lineStyle: 2 })
    s.setData([{ time: k[start].time, value: price }, { time: k[k.length - 1].time, value: price }])
    w.fibSeries.push(s)
  })
}

// ═══════════════════════════════════════════════════════════════
// OVERLAY — Pivot Points
// ═══════════════════════════════════════════════════════════════

export function updatePivot(): void {
  if (!Array.isArray(w.pivotSeries)) w.pivotSeries = []
  w.pivotSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s) } catch (_) { } }); w.pivotSeries = []
  if (!w.mainChart || !w.S.klines.length) return
  const k = w.S.klines
  const now = Date.now() / 1000
  const dayStart = Math.floor(now / 86400) * 86400
  const prevDay = k.filter((b: any) => b.time >= dayStart - 86400 && b.time < dayStart)
  if (!prevDay.length) return
  let ph = -Infinity, pl = Infinity; const pc = prevDay[prevDay.length - 1].close
  prevDay.forEach((b: any) => { ph = Math.max(ph, b.high); pl = Math.min(pl, b.low) })
  const P = (ph + pl + pc) / 3
  const R1 = 2 * P - pl, S1 = 2 * P - ph
  const R2 = P + (ph - pl), S2 = P - (ph - pl)
  const R3 = ph + 2 * (P - pl), S3 = pl - 2 * (ph - P)
  const today = k.filter((b: any) => b.time >= dayStart)
  if (!today.length) return
  const t0 = today[0].time, t1 = today[today.length - 1].time
  const add = (price: number, color: string, label: string) => {
    const s = w.mainChart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: label, lineStyle: 2 })
    s.setData([{ time: t0, value: price }, { time: t1, value: price }])
    w.pivotSeries.push(s)
  }
  add(P, '#f0c040', 'P')
  add(R1, '#ff335566', 'R1'); add(R2, '#ff335588', 'R2'); add(R3, '#ff3355aa', 'R3')
  add(S1, '#00d97a66', 'S1'); add(S2, '#00d97a88', 'S2'); add(S3, '#00d97aaa', 'S3')
}

// ═══════════════════════════════════════════════════════════════
// OVERLAY — Volume Profile
// ═══════════════════════════════════════════════════════════════

export function updateVP(): void {
  if (!Array.isArray(w.vpSeries)) w.vpSeries = []
  w.vpSeries.forEach((s: any) => { try { w.mainChart.removeSeries(s) } catch (_) { } }); w.vpSeries = []
  if (!w.mainChart || !w.S.klines.length) return
  const k = w.S.klines; const rows = w.IND_SETTINGS.vp.rows || 70
  let hi = -Infinity, lo = Infinity
  k.forEach((b: any) => { hi = Math.max(hi, b.high); lo = Math.min(lo, b.low) })
  if (hi <= lo) return
  const step = (hi - lo) / rows
  const buckets = new Array(rows).fill(0)
  k.forEach((b: any) => {
    const idx = Math.min(rows - 1, Math.floor((b.close - lo) / step))
    buckets[idx] += b.volume
  })
  const maxVol = Math.max(...buckets)
  if (!maxVol) return
  const vpS = w.mainChart.addHistogramSeries({
    color: '#00b8d422', priceFormat: { type: 'price' }, priceScaleId: 'vp', scaleMargins: { top: 0, bottom: 0 },
  })
  try { w.mainChart.priceScale('vp').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.05 }, visible: false }) } catch (_) { }
  const vpData: any[] = []
  const step2 = Math.floor(k.length / rows)
  for (let i = 0; i < rows && i * step2 < k.length; i++) {
    vpData.push({ time: k[i * step2].time, value: buckets[i], color: buckets[i] === maxVol ? '#f0c04044' : '#00b8d422' })
  }
  vpS.setData(vpData)
  w.vpSeries.push(vpS)
}

// ═══════════════════════════════════════════════════════════════
// SUB-CHART HELPER
// ═══════════════════════════════════════════════════════════════

function _createSubChart(containerId: string, height?: number): any {
  const container = document.getElementById(containerId)
  if (!container || typeof w.LightweightCharts === 'undefined') return null
  container.style.height = (height || 60) + 'px'
  const chart = w.LightweightCharts.createChart(container, {
    width: getChartW(),
    height: height || 60,
    layout: { background: { color: '#0a0f16' }, textColor: '#7a9ab8' },
    grid: { vertLines: { color: '#1a2030' }, horzLines: { color: '#1a2030' } },
    rightPriceScale: { borderColor: '#1e2530', visible: true, width: 70, scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale: { visible: false, rightOffset: 12 },
    crosshair: { mode: w.LightweightCharts.CrosshairMode.Normal },
    handleScroll: { mouseWheel: true, pressedMouseMove: true },
    handleScale: { mouseWheel: true, pinch: true },
  })
  chart.applyOptions({ localization: { timeFormatter: (ts: number) => fmtTime(ts), dateFormatter: (ts: number) => fmtDate(ts) } })
  if (w.mainChart) {
    try {
      const tr = w.mainChart.timeScale().getVisibleLogicalRange()
      if (tr) chart.timeScale().setVisibleLogicalRange(tr)
    } catch (_) { }
  }
  return chart
}

export function _syncSubChartsToMain(): void {
  if (!w.mainChart) return
  try {
    const r = w.mainChart.timeScale().getVisibleLogicalRange()
    if (!r) return
    ;[w._rsiChart, w._stochChart, w._atrChart, w._obvChart, w._mfiChart, w._cciChart, w._adxChart, w._willrChart, w._rocChart, w._cmfChart, w._aoChart, w._aroonChart, w._trixChart, w._uoChart, w._chopChart, w._heliosChart, w._atlasChart, w._pantheonChart, w._seleneChart, w._themisChart, w._erebusChart, w._anemoiChart, w._cerberusChart, _macdChart].forEach((ch: any) => {
      if (ch) try { ch.timeScale().setVisibleLogicalRange(r) } catch (_) { }
    })
  } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// OSCILLATORS — RSI, Stoch, ATR, OBV, MFI, CCI
// ═══════════════════════════════════════════════════════════════

export function initRSIChart(): void {
  if (w._rsiInited && w._rsiChart) { updateRSI(); return }
  w._rsiChart = _createSubChart('rsiChart', 60)
  if (!w._rsiChart) return
  w._rsiSeries = w._rsiChart.addLineSeries({ color: '#f5c842', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'RSI' })
  w._rsiInited = true
  updateRSI()
}

export function updateRSI(): void {
  if (!w._rsiInited || !w._rsiSeries || !w.S.klines.length) return
  const c = w.S.klines.map((k: any) => k.close)
  const p = Math.round(w.IND_SETTINGS.rsi14.period) || 14
  const rsiData: any[] = []
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i < c.length; i++) {
    const change = c[i] - c[i - 1]
    if (i <= p) {
      if (change > 0) avgGain += change; else avgLoss -= change
      if (i === p) { avgGain /= p; avgLoss /= p; const rs = avgLoss === 0 ? 100 : avgGain / avgLoss; rsiData.push({ time: w.S.klines[i].time, value: 100 - 100 / (1 + rs) }) }
    } else {
      avgGain = (avgGain * (p - 1) + Math.max(change, 0)) / p
      avgLoss = (avgLoss * (p - 1) + Math.max(-change, 0)) / p
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
      rsiData.push({ time: w.S.klines[i].time, value: 100 - 100 / (1 + rs) })
    }
  }
  try { w._rsiSeries.setData(rsiData); _syncSubChartsToMain() } catch (_) { }
}

export function initStochChart(): void {
  if (w._stochInited && w._stochChart) { updateStoch(); return }
  w._stochChart = _createSubChart('stochChart', 60)
  if (!w._stochChart) return
  w._stochKSeries = w._stochChart.addLineSeries({ color: '#00e5ff', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: '%K' })
  w._stochDSeries = w._stochChart.addLineSeries({ color: '#ff8800', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: '%D' })
  w._stochInited = true
  updateStoch()
}

export function updateStoch(): void {
  if (!w._stochInited || !w._stochKSeries || !w.S.klines.length) return
  const c = w.S.klines.map((k: any) => k.close)
  const p = Math.round(w.IND_SETTINGS.stoch.kPeriod) || 14
  const dP = Math.round(w.IND_SETTINGS.stoch.dPeriod) || 3
  const sm = Math.round(w.IND_SETTINGS.stoch.smooth) || 3
  const rsi: number[] = []
  let avgG = 0, avgL = 0
  for (let i = 1; i < c.length; i++) {
    const ch = c[i] - c[i - 1]
    if (i <= 14) { if (ch > 0) avgG += ch; else avgL -= ch; if (i === 14) { avgG /= 14; avgL /= 14 } }
    else { avgG = (avgG * 13 + Math.max(ch, 0)) / 14; avgL = (avgL * 13 + Math.max(-ch, 0)) / 14 }
    if (i >= 14) { const rs = avgL === 0 ? 100 : avgG / avgL; rsi.push(100 - 100 / (1 + rs)) }
  }
  const rawK: number[] = []
  for (let i = p - 1; i < rsi.length; i++) {
    let hi = -Infinity, lo = Infinity
    for (let j = i - p + 1; j <= i; j++) { hi = Math.max(hi, rsi[j]); lo = Math.min(lo, rsi[j]) }
    rawK.push(hi === lo ? 50 : (rsi[i] - lo) / (hi - lo) * 100)
  }
  const sK: number[] = []; for (let i = sm - 1; i < rawK.length; i++) { let s = 0; for (let j = 0; j < sm; j++) s += rawK[i - j]; sK.push(s / sm) }
  const sD: number[] = []; for (let i = dP - 1; i < sK.length; i++) { let s = 0; for (let j = 0; j < dP; j++) s += sK[i - j]; sD.push(s / dP) }
  const offset = 14 + p - 1 + sm - 1
  const kData = sK.map((v, i) => ({ time: w.S.klines[offset + i]?.time, value: v })).filter((d: any) => d.time)
  const dOffset = offset + dP - 1
  const dData = sD.map((v, i) => ({ time: w.S.klines[dOffset + i]?.time, value: v })).filter((d: any) => d.time)
  try { w._stochKSeries.setData(kData); w._stochDSeries.setData(dData); _syncSubChartsToMain() } catch (_) { }
}

export function initATRChart(): void {
  if (w._atrInited && w._atrChart) { updateATRInd(); return }
  w._atrChart = _createSubChart('atrChart', 60)
  if (!w._atrChart) return
  w._atrSeries = w._atrChart.addLineSeries({ color: '#ff8800', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'ATR' })
  w._atrInited = true
  updateATRInd()
}

export function updateATRInd(): void {
  if (!w._atrInited || !w._atrSeries || !w.S.klines.length) return
  const k = w.S.klines; const p = Math.round(w.IND_SETTINGS.atr.period) || 14
  const tr: number[] = []; for (let i = 0; i < k.length; i++) {
    if (i === 0) tr.push(k[i].high - k[i].low)
    else tr.push(Math.max(k[i].high - k[i].low, Math.abs(k[i].high - k[i - 1].close), Math.abs(k[i].low - k[i - 1].close)))
  }
  const atrData: any[] = []; let atr = 0
  for (let i = 0; i < tr.length; i++) {
    if (i < p) { atr += tr[i]; if (i === p - 1) { atr /= p; atrData.push({ time: k[i].time, value: atr }) } }
    else { atr = (atr * (p - 1) + tr[i]) / p; atrData.push({ time: k[i].time, value: atr }) }
  }
  try { w._atrSeries.setData(atrData); _syncSubChartsToMain() } catch (_) { }
}

export function initOBVChart(): void {
  if (w._obvInited && w._obvChart) { updateOBV(); return }
  w._obvChart = _createSubChart('obvChart', 60)
  if (!w._obvChart) return
  w._obvSeries = w._obvChart.addLineSeries({ color: '#00b8d4', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'OBV' })
  w._obvInited = true
  updateOBV()
}

export function updateOBV(): void {
  if (!w._obvInited || !w._obvSeries || !w.S.klines.length) return
  const k = w.S.klines; let obv = 0
  const raw = k.map((b: any, i: number) => {
    if (i > 0) { if (b.close > k[i - 1].close) obv += b.volume; else if (b.close < k[i - 1].close) obv -= b.volume }
    return { time: b.time, value: obv }
  })
  const sm = Math.round(w.IND_SETTINGS?.obv?.smoothing || 0)
  const data = sm > 1 ? raw.map((d: any, i: number) => {
    if (i < sm - 1) return d
    let s = 0; for (let j = 0; j < sm; j++) s += raw[i - j].value
    return { time: d.time, value: s / sm }
  }) : raw
  try { w._obvSeries.setData(data); _syncSubChartsToMain() } catch (_) { }
}

export function initMFIChart(): void {
  if (w._mfiInited && w._mfiChart) { updateMFI(); return }
  w._mfiChart = _createSubChart('mfiChart', 60)
  if (!w._mfiChart) return
  w._mfiSeries = w._mfiChart.addLineSeries({ color: '#00d97a', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'MFI' })
  w._mfiInited = true
  updateMFI()
}

export function updateMFI(): void {
  if (!w._mfiInited || !w._mfiSeries || !w.S.klines.length) return
  const k = w.S.klines; const p = Math.round(w.IND_SETTINGS.mfi.period) || 14
  const tp = k.map((b: any) => (b.high + b.low + b.close) / 3)
  const mfData: any[] = []
  for (let i = p; i < k.length; i++) {
    let posFlow = 0, negFlow = 0
    for (let j = i - p + 1; j <= i; j++) {
      const flow = tp[j] * k[j].volume
      if (tp[j] > tp[j - 1]) posFlow += flow; else negFlow += flow
    }
    const mfi = negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow)
    mfData.push({ time: k[i].time, value: mfi })
  }
  try { w._mfiSeries.setData(mfData); _syncSubChartsToMain() } catch (_) { }
}

export function initCCIChart(): void {
  if (w._cciInited && w._cciChart) { updateCCI(); return }
  w._cciChart = _createSubChart('cciChart', 60)
  if (!w._cciChart) return
  w._cciSeries = w._cciChart.addLineSeries({ color: '#ff3355', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'CCI' })
  w._cciInited = true
  updateCCI()
}

export function updateCCI(): void {
  if (!w._cciInited || !w._cciSeries || !w.S.klines.length) return
  const k = w.S.klines; const p = Math.round(w.IND_SETTINGS.cci.period) || 20
  const tp = k.map((b: any) => (b.high + b.low + b.close) / 3)
  const cciData: any[] = []
  for (let i = p - 1; i < tp.length; i++) {
    let sum = 0; for (let j = i - p + 1; j <= i; j++) sum += tp[j]; const avg = sum / p
    let madSum = 0; for (let j = i - p + 1; j <= i; j++) madSum += Math.abs(tp[j] - avg); const mad = madSum / p
    const cci = mad === 0 ? 0 : (tp[i] - avg) / (0.015 * mad)
    cciData.push({ time: k[i].time, value: cci })
  }
  try { w._cciSeries.setData(cciData); _syncSubChartsToMain() } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// OSCILLATORS — batch 2: ADX (+DI/−DI), Williams %R, ROC, CMF, Awesome Oscillator
// Pure math in ./indicatorCalc (unit-tested); these map outputs to pane series.
// ═══════════════════════════════════════════════════════════════

function _osc(series: any, vals: (number | null)[]): any[] {
  const k = w.S.klines
  const out: any[] = []
  for (let i = 0; i < vals.length; i++) { if (vals[i] != null && k[i]) out.push({ time: k[i].time, value: vals[i] }) }
  try { series.setData(out) } catch (_) { }
  return out
}

export function initADXChart(): void {
  if (w._adxInited && w._adxChart) { updateADX(); return }
  w._adxChart = _createSubChart('adxChart', 60)
  if (!w._adxChart) return
  w._adxSeries = w._adxChart.addLineSeries({ color: '#f0c040', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'ADX' })
  w._adxPlusSeries = w._adxChart.addLineSeries({ color: '#26ff9a', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: '+DI' })
  w._adxMinusSeries = w._adxChart.addLineSeries({ color: '#ff5277', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: '-DI' })
  w._adxInited = true
  updateADX()
}
export function updateADX(): void {
  if (!w._adxInited || !w._adxSeries || !w.S.klines.length) return
  const k = w.S.klines, p = Math.round(w.IND_SETTINGS.adx.period) || 14
  const r = _calcADX(k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close), p)
  _osc(w._adxSeries, r.adx); _osc(w._adxPlusSeries, r.plusDI); _osc(w._adxMinusSeries, r.minusDI)
  _syncSubChartsToMain()
}

export function initWILLRChart(): void {
  if (w._willrInited && w._willrChart) { updateWILLR(); return }
  w._willrChart = _createSubChart('willrChart', 60)
  if (!w._willrChart) return
  w._willrSeries = w._willrChart.addLineSeries({ color: '#26c6da', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: '%R' })
  w._willrInited = true
  updateWILLR()
}
export function updateWILLR(): void {
  if (!w._willrInited || !w._willrSeries || !w.S.klines.length) return
  const k = w.S.klines, p = Math.round(w.IND_SETTINGS.willr.period) || 14
  _osc(w._willrSeries, _calcWILLR(k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close), p))
  _syncSubChartsToMain()
}

export function initROCChart(): void {
  if (w._rocInited && w._rocChart) { updateROC(); return }
  w._rocChart = _createSubChart('rocChart', 60)
  if (!w._rocChart) return
  w._rocSeries = w._rocChart.addLineSeries({ color: '#ffca28', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'ROC' })
  w._rocInited = true
  updateROC()
}
export function updateROC(): void {
  if (!w._rocInited || !w._rocSeries || !w.S.klines.length) return
  const k = w.S.klines, p = Math.round(w.IND_SETTINGS.roc.period) || 12
  _osc(w._rocSeries, _calcROC(k.map((b: any) => b.close), p))
  _syncSubChartsToMain()
}

export function initCMFChart(): void {
  if (w._cmfInited && w._cmfChart) { updateCMF(); return }
  w._cmfChart = _createSubChart('cmfChart', 60)
  if (!w._cmfChart) return
  w._cmfSeries = w._cmfChart.addLineSeries({ color: '#ab47bc', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'CMF' })
  w._cmfInited = true
  updateCMF()
}
export function updateCMF(): void {
  if (!w._cmfInited || !w._cmfSeries || !w.S.klines.length) return
  const k = w.S.klines, p = Math.round(w.IND_SETTINGS.cmf.period) || 20
  _osc(w._cmfSeries, _calcCMF(k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close), k.map((b: any) => b.volume), p))
  _syncSubChartsToMain()
}

export function initAOChart(): void {
  if (w._aoInited && w._aoChart) { updateAO(); return }
  w._aoChart = _createSubChart('aoChart', 60)
  if (!w._aoChart) return
  w._aoSeries = w._aoChart.addHistogramSeries({ color: '#26ff9a', priceLineVisible: false, lastValueVisible: true, title: 'AO' })
  w._aoInited = true
  updateAO()
}
export function updateAO(): void {
  if (!w._aoInited || !w._aoSeries || !w.S.klines.length) return
  const k = w.S.klines
  const fast = Math.round(w.IND_SETTINGS.ao.fast) || 5, slow = Math.round(w.IND_SETTINGS.ao.slow) || 34
  const vals = _calcAO(k.map((b: any) => b.high), k.map((b: any) => b.low), fast, slow)
  const out: any[] = []
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] == null || !k[i]) continue
    const up = i === 0 ? true : (vals[i] as number) >= (vals[i - 1] as number)
    out.push({ time: k[i].time, value: vals[i], color: up ? '#26ff9a' : '#ff5277' })
  }
  try { w._aoSeries.setData(out); _syncSubChartsToMain() } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// batch 3: VWMA (overlay) + Aroon, TRIX, Ultimate Osc, Choppiness (panes)
// ═══════════════════════════════════════════════════════════════

export function initVWMASeries(): void {
  if (w.vwmaS || !w.mainChart) return
  w.vwmaS = w.mainChart.addLineSeries({ color: '#7e57c2', lineWidth: 2, priceLineVisible: false, lastValueVisible: false })
}
export function updateVWMA(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initVWMASeries()
  const k = w.S.klines
  const vals = _calcVWMA(k.map((b: any) => b.close), k.map((b: any) => b.volume), Math.round(w.IND_SETTINGS.vwma.period) || 20)
  const data: any[] = []
  for (let i = 0; i < vals.length; i++) if (vals[i] != null) data.push({ time: _klTime(i), value: vals[i] })
  try { w.vwmaS.setData(data) } catch (_) { }
}

export function initAroonChart(): void {
  if (w._aroonInited && w._aroonChart) { updateAroon(); return }
  w._aroonChart = _createSubChart('aroonChart', 60)
  if (!w._aroonChart) return
  w._aroonUpSeries = w._aroonChart.addLineSeries({ color: '#26ff9a', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'Up' })
  w._aroonDnSeries = w._aroonChart.addLineSeries({ color: '#ff5277', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'Dn' })
  w._aroonInited = true
  updateAroon()
}
export function updateAroon(): void {
  if (!w._aroonInited || !w._aroonUpSeries || !w.S.klines.length) return
  const k = w.S.klines, p = Math.round(w.IND_SETTINGS.aroon.period) || 14
  const r = _calcAROON(k.map((b: any) => b.high), k.map((b: any) => b.low), p)
  _osc(w._aroonUpSeries, r.up); _osc(w._aroonDnSeries, r.down)
  _syncSubChartsToMain()
}

export function initTrixChart(): void {
  if (w._trixInited && w._trixChart) { updateTrix(); return }
  w._trixChart = _createSubChart('trixChart', 60)
  if (!w._trixChart) return
  w._trixSeries = w._trixChart.addLineSeries({ color: '#ffca28', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'TRIX' })
  w._trixInited = true
  updateTrix()
}
export function updateTrix(): void {
  if (!w._trixInited || !w._trixSeries || !w.S.klines.length) return
  const k = w.S.klines, p = Math.round(w.IND_SETTINGS.trix.period) || 15
  _osc(w._trixSeries, _calcTRIX(k.map((b: any) => b.close), p))
  _syncSubChartsToMain()
}

export function initUOChart(): void {
  if (w._uoInited && w._uoChart) { updateUO(); return }
  w._uoChart = _createSubChart('uoChart', 60)
  if (!w._uoChart) return
  w._uoSeries = w._uoChart.addLineSeries({ color: '#26c6da', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'UO' })
  w._uoInited = true
  updateUO()
}
export function updateUO(): void {
  if (!w._uoInited || !w._uoSeries || !w.S.klines.length) return
  const k = w.S.klines, s = w.IND_SETTINGS.uo
  _osc(w._uoSeries, _calcUO(k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close), Math.round(s.p1) || 7, Math.round(s.p2) || 14, Math.round(s.p3) || 28))
  _syncSubChartsToMain()
}

export function initChopChart(): void {
  if (w._chopInited && w._chopChart) { updateChop(); return }
  w._chopChart = _createSubChart('chopChart', 60)
  if (!w._chopChart) return
  w._chopSeries = w._chopChart.addLineSeries({ color: '#ab47bc', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'CHOP' })
  w._chopInited = true
  updateChop()
}
export function updateChop(): void {
  if (!w._chopInited || !w._chopSeries || !w.S.klines.length) return
  const k = w.S.klines, p = Math.round(w.IND_SETTINGS.chop.period) || 14
  _osc(w._chopSeries, _calcCHOP(k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close), p))
  _syncSubChartsToMain()
}

// ═══════════════════════════════════════════════════════════════
// KERAUNOS — invented adaptive conviction ribbon (main-chart overlay)
// ═══════════════════════════════════════════════════════════════

function _keraColor(c: number): string {
  if (c > 0.5) return '#00e676'   // strong bullish conviction
  if (c > 0.15) return '#66bb6a'  // bullish
  if (c >= -0.15) return '#78909c' // chop / no edge — stay out
  if (c > -0.5) return '#ef5350'  // bearish
  return '#ff1744'                // strong bearish conviction
}

export function initKeraSeries(): void {
  if (w.keraS || !w.mainChart) return
  w.keraS = w.mainChart.addLineSeries({ lineWidth: 3, priceLineVisible: false, lastValueVisible: false })
  w.keraUpS = w.mainChart.addLineSeries({ color: 'rgba(126,87,194,0.35)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
  w.keraLowS = w.mainChart.addLineSeries({ color: 'rgba(126,87,194,0.35)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
}
export function updateKera(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initKeraSeries()
  const k = w.S.klines, s = w.IND_SETTINGS.kera || {}
  const r = _calcKERA(
    k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close), k.map((b: any) => b.volume),
    Math.round(s.er) || 10, Math.round(s.atrP) || 14, s.mult || 1.6
  )
  const base: any[] = [], up: any[] = [], low: any[] = []
  for (let i = 0; i < r.baseline.length; i++) {
    if (r.baseline[i] == null || !k[i]) continue
    base.push({ time: k[i].time, value: r.baseline[i], color: _keraColor((r.conviction[i] as number) || 0) })
    if (r.upper[i] != null) up.push({ time: k[i].time, value: r.upper[i] })
    if (r.lower[i] != null) low.push({ time: k[i].time, value: r.lower[i] })
  }
  try { w.keraS.setData(base); w.keraUpS.setData(up); w.keraLowS.setData(low) } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// AETHER — invented volatility-squeeze / breakout field (main-chart overlay)
// ═══════════════════════════════════════════════════════════════

export function initAetherSeries(): void {
  if (w.aetMidS || !w.mainChart) return
  w.aetUpS = w.mainChart.addLineSeries({ lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
  w.aetLowS = w.mainChart.addLineSeries({ lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
  w.aetMidS = w.mainChart.addLineSeries({ lineWidth: 2, lineStyle: 0, priceLineVisible: false, lastValueVisible: false })
}
export function updateAether(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initAetherSeries()
  const k = w.S.klines, s = w.IND_SETTINGS.aether || {}
  const r = _calcAETHER(
    k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close),
    Math.round(s.period) || 20, s.bbMult || 2, s.kcMult || 1.5
  )
  const GOLD = '#f0c040', BLUE = 'rgba(66,165,245,0.55)'
  const mom = (m: number) => (m > 0.5 ? '#00e676' : m > 0.1 ? '#66bb6a' : m < -0.5 ? '#ff1744' : m < -0.1 ? '#ef5350' : '#78909c')
  const up: any[] = [], low: any[] = [], midA: any[] = []
  for (let i = 0; i < r.mid.length; i++) {
    if (r.mid[i] == null || !k[i]) continue
    const sq = r.squeeze[i]
    const bandColor = sq ? GOLD : BLUE
    up.push({ time: k[i].time, value: r.upper[i], color: bandColor })
    low.push({ time: k[i].time, value: r.lower[i], color: bandColor })
    midA.push({ time: k[i].time, value: r.mid[i], color: sq ? GOLD : mom((r.momentum[i] as number) || 0) })
  }
  try { w.aetUpS.setData(up); w.aetLowS.setData(low); w.aetMidS.setData(midA) } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// MOIRA — invented market-structure skeleton (main-chart overlay)
// ═══════════════════════════════════════════════════════════════

export function initMSSeries(): void {
  if (w.msZigS || !w.mainChart) return
  w.msZigS = w.mainChart.addLineSeries({ lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
}
export function updateMS(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initMSSeries()
  const k = w.S.klines, s = w.IND_SETTINGS.ms || {}
  const r = _calcMS(k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close), Math.round(s.lookback) || 5)
  // zigzag: each pivot point colored by the structure trend leading into it
  const zig: any[] = []
  for (const pv of r.pivots) { if (k[pv.index]) zig.push({ time: k[pv.index].time, value: pv.value, color: pv.trend === 'up' ? '#26ff9a' : '#ff5277' }) }
  // BOS markers
  const marks = r.breaks.filter((b: any) => k[b.index]).map((b: any) => ({
    time: k[b.index].time,
    position: b.dir === 'up' ? 'belowBar' : 'aboveBar',
    color: b.dir === 'up' ? '#26ff9a' : '#ff5277',
    shape: b.dir === 'up' ? 'arrowUp' : 'arrowDown',
    text: 'BOS',
  }))
  try { w.msZigS.setData(zig); w.msZigS.setMarkers(marks) } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// NEMESIS — invented exhaustion / reversal markers (main-chart overlay)
// ═══════════════════════════════════════════════════════════════

export function initNemSeries(): void {
  if (w.nemS || !w.mainChart) return
  // transparent carrier line: gives markers a full time range to anchor to,
  // without drawing a visible line.
  w.nemS = w.mainChart.addLineSeries({ color: 'rgba(0,0,0,0)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
}
export function updateNem(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initNemSeries()
  const k = w.S.klines, s = w.IND_SETTINGS.nem || {}
  const sigs = _calcNEM(k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close), k.map((b: any) => b.volume), Math.round(s.setupLen) || 9, s.climaxMult || 2)
  const marks = sigs.filter((g: any) => k[g.index]).map((g: any) => ({
    time: k[g.index].time,
    position: g.dir === 'top' ? 'aboveBar' : 'belowBar',
    shape: g.dir === 'top' ? 'arrowDown' : 'arrowUp',
    color: g.dir === 'top' ? (g.strength >= 2 ? '#ff1744' : '#ff8a80') : (g.strength >= 2 ? '#00e676' : '#a5d6a7'),
    text: g.strength >= 3 ? '★' : (g.strength >= 2 ? '!' : ''),
  }))
  try { w.nemS.setData(k.map((b: any) => ({ time: b.time, value: b.close }))); w.nemS.setMarkers(marks) } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// IRIS — invented rainbow EMA ribbon (main-chart overlay)
// ═══════════════════════════════════════════════════════════════

const _IRIS_COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#32ade6', '#af52de']
const _IRIS_MULT = [1, 1.6, 2.6, 4.2, 6.8, 11]

export function initIrisSeries(): void {
  if ((w.irisSeries && w.irisSeries.length) || !w.mainChart) return
  w.irisSeries = _IRIS_COLORS.map((c) => w.mainChart.addLineSeries({ color: c, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }))
}
export function updateIris(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initIrisSeries()
  const k = w.S.klines, base = Math.max(2, Math.round(w.IND_SETTINGS.iris?.base) || 8)
  const closes = k.map((b: any) => b.close)
  _IRIS_MULT.forEach((m, idx) => {
    const period = Math.max(2, Math.round(base * m))
    const vals = _calcEMA(closes, period)
    const data: any[] = []
    for (let i = 0; i < vals.length; i++) if (vals[i] != null) data.push({ time: k[i].time, value: vals[i] })
    try { w.irisSeries[idx]?.setData(data) } catch (_) { }
  })
}

// ═══════════════════════════════════════════════════════════════
// PYTHIA — invented entry oracle: marks entries + projects targets,
// confirmed by the live server brain (BM) and crowd sentiment (S.ls)
// ═══════════════════════════════════════════════════════════════

export function initPythiaSeries(): void {
  if (w.pythiaMarkS || !w.mainChart) return
  w.pythiaMarkS = w.mainChart.addLineSeries({ color: 'rgba(0,0,0,0)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
  w.pythiaTpS = w.mainChart.addLineSeries({ color: '#26ff9a', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: true, title: 'PYTHIA TP' })
  w.pythiaSlS = w.mainChart.addLineSeries({ color: '#ff5277', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: true, title: 'PYTHIA SL' })
}
export function updatePythia(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initPythiaSeries()
  const k = w.S.klines, s = w.IND_SETTINGS.pythia || {}
  const entries = _calcPYTHIA(
    k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close),
    Math.round(s.fast) || 21, Math.round(s.slow) || 50, Math.round(s.atrLen) || 14, s.tpMult || 2.5, s.slMult || 1.2
  )
  // Backend confirmation for the most-recent entry: live server brain + crowd sentiment.
  const bm = (w.BM || {}) as any
  const score = Number(bm.entryScore) || 0
  const ready = !!bm.entryReady
  const latest = entries.length ? entries[entries.length - 1] : null
  const latestConfirmed = !!latest && ((latest.dir === 'long' ? score : -score) > 10 || (ready && score !== 0 && ((score > 0) === (latest.dir === 'long'))))
  const marks = entries.filter((g: any) => k[g.index]).map((g: any, i: number) => {
    const isLatest = i === entries.length - 1
    const strong = isLatest && latestConfirmed
    return {
      time: k[g.index].time,
      position: g.dir === 'long' ? 'belowBar' : 'aboveBar',
      shape: g.dir === 'long' ? 'arrowUp' : 'arrowDown',
      color: g.dir === 'long' ? (strong ? '#00e676' : '#66bb6a') : (strong ? '#ff1744' : '#ef5350'),
      text: strong ? '★' : (isLatest ? 'PYTHIA' : ''),
    }
  })
  try {
    w.pythiaMarkS.setData(k.map((b: any) => ({ time: b.time, value: b.close })))
    w.pythiaMarkS.setMarkers(marks)
    if (latest && k[latest.index]) {
      const t0 = k[latest.index].time, t1 = k[k.length - 1].time
      w.pythiaTpS.setData([{ time: t0, value: latest.target }, { time: t1, value: latest.target }])
      w.pythiaSlS.setData([{ time: t0, value: latest.stop }, { time: t1, value: latest.stop }])
    } else { w.pythiaTpS.setData([]); w.pythiaSlS.setData([]) }
  } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// PLUTUS — invented smart-money footprint (Wyckoff effort-vs-result)
// main-chart markers: ◆ accumulation (green, below) / distribution (red, above)
// ═══════════════════════════════════════════════════════════════

export function initPlutusSeries(): void {
  if (w.plutusS || !w.mainChart) return
  // transparent carrier so markers anchor across the full time range
  w.plutusS = w.mainChart.addLineSeries({ color: 'rgba(0,0,0,0)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
}
export function updatePlutus(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initPlutusSeries()
  const k = w.S.klines, s = w.IND_SETTINGS.plutus || {}
  const sigs = _calcPLUTUS(
    k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close), k.map((b: any) => b.volume),
    Math.round(s.lookback) || 20, s.volMult || 1.5
  )
  const marks = sigs.filter((g: any) => k[g.index]).map((g: any) => {
    const strong = g.effort >= 2.5
    return {
      time: k[g.index].time,
      position: g.dir === 'accumulation' ? 'belowBar' : 'aboveBar',
      shape: 'circle',
      color: g.dir === 'accumulation' ? (strong ? '#00e676' : '#66bb6a') : (strong ? '#ff1744' : '#ef5350'),
      text: strong ? '◆◆' : '◆',
    }
  })
  try { w.plutusS.setData(k.map((b: any) => ({ time: b.time, value: b.close }))); w.plutusS.setMarkers(marks) } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// HELIOS — invented regime oracle (rolling Hurst exponent, sub-pane)
// gold line > 0.5 = trending/persistent · cyan < 0.5 = mean-reverting
// ═══════════════════════════════════════════════════════════════

export function initHeliosChart(): void {
  if (w._heliosInited && w._heliosChart) { updateHelios(); return }
  w._heliosChart = _createSubChart('heliosChart', 60)
  if (!w._heliosChart) return
  w._heliosSeries = w._heliosChart.addLineSeries({ color: '#f0c040', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'HELIOS H' })
  // 0.5 random-walk reference line
  w._heliosMidS = w._heliosChart.addLineSeries({ color: 'rgba(255,255,255,0.25)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
  w._heliosInited = true
  updateHelios()
}
export function updateHelios(): void {
  if (!w._heliosInited || !w._heliosSeries || !w.S.klines.length) return
  const k = w.S.klines, p = Math.round(w.IND_SETTINGS.helios?.period) || 30
  const h = _calcHELIOS(k.map((b: any) => b.close), p)
  const data: any[] = [], mid: any[] = []
  for (let i = 0; i < h.length; i++) {
    if (h[i] == null || !k[i]) continue
    const v = h[i] as number
    data.push({ time: k[i].time, value: v, color: v >= 0.5 ? '#f0c040' : '#32ade6' }) // gold trend / cyan revert
    mid.push({ time: k[i].time, value: 0.5 })
  }
  try { w._heliosSeries.setData(data); w._heliosMidS.setData(mid) } catch (_) { }
  _syncSubChartsToMain()
}

// ═══════════════════════════════════════════════════════════════
// HERMES — invented fair-value-gap (imbalance) detector. Main-chart markers
// tag each gap; the most-recent UNFILLED gap is drawn as a magnet band.
// ═══════════════════════════════════════════════════════════════

export function initHermesSeries(): void {
  if (w.hermesMarkS || !w.mainChart) return
  w.hermesMarkS = w.mainChart.addLineSeries({ color: 'rgba(0,0,0,0)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
  w.hermesTopS = w.mainChart.addLineSeries({ lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
  w.hermesBotS = w.mainChart.addLineSeries({ lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
}
export function updateHermes(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initHermesSeries()
  const k = w.S.klines, s = w.IND_SETTINGS.hermes || {}
  const gaps = _calcHERMES(k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close), s.minPct ?? 0.05)
  // markers: small tag at each gap bar (dimmer if already filled)
  const marks = gaps.filter((g: any) => k[g.index]).map((g: any) => ({
    time: k[g.index].time,
    position: g.dir === 'bull' ? 'belowBar' : 'aboveBar',
    shape: 'square',
    color: g.dir === 'bull' ? (g.filled ? '#2e7d5288' : '#00e676') : (g.filled ? '#b71c1c88' : '#ff1744'),
    text: g.filled ? '' : '▮',
  }))
  try { w.hermesMarkS.setData(k.map((b: any) => ({ time: b.time, value: b.close }))) ; w.hermesMarkS.setMarkers(marks) } catch (_) { }
  // band: most-recent still-open gap → price magnet zone, drawn from formation to now
  const open = [...gaps].reverse().find((g: any) => !g.filled && k[g.index])
  try {
    if (open) {
      const col = open.dir === 'bull' ? 'rgba(0,230,118,0.6)' : 'rgba(255,23,68,0.6)'
      w.hermesTopS.applyOptions({ color: col }); w.hermesBotS.applyOptions({ color: col })
      const t0 = k[open.index].time, t1 = k[k.length - 1].time
      w.hermesTopS.setData([{ time: t0, value: open.top }, { time: t1, value: open.top }])
      w.hermesBotS.setData([{ time: t0, value: open.bottom }, { time: t1, value: open.bottom }])
    } else { w.hermesTopS.setData([]); w.hermesBotS.setData([]) }
  } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// CHARON — invented liquidity-pool (stop-hunt) detector. Horizontal price
// lines at resting-liquidity levels; dimmed once swept. (main-chart overlay)
// ═══════════════════════════════════════════════════════════════

export function initCharonSeries(): void {
  if (w.charonS || !w.mainChart) return
  // carrier series just to host createPriceLine() levels
  w.charonS = w.mainChart.addLineSeries({ color: 'rgba(0,0,0,0)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
  w._charonLines = []
}
export function updateCharon(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initCharonSeries()
  const k = w.S.klines, s = w.IND_SETTINGS.charon || {}
  // keep the carrier anchored to the time range
  try { w.charonS.setData(k.map((b: any) => ({ time: b.time, value: b.close }))) } catch (_) { }
  try { (w._charonLines || []).forEach((pl: any) => w.charonS.removePriceLine(pl)) } catch (_) { }
  w._charonLines = []
  const pools = _calcCHARON(
    k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close),
    Math.round(s.lookback) || 5, s.tolPct ?? 0.15, Math.round(s.minHits) || 2
  )
  // draw the strongest few unswept pools (live magnets) brightly + recent swept ones dim
  const ordered = [...pools].sort((a: any, b: any) => (Number(a.swept) - Number(b.swept)) || (b.hits - a.hits))
  for (const p of ordered.slice(0, 8)) {
    const buy = p.side === 'buy'
    const col = p.swept ? (buy ? '#7e9cae66' : '#7e9cae66') : (buy ? '#ffca28' : '#26c6da')
    try {
      const pl = w.charonS.createPriceLine({
        price: p.level, color: col, lineWidth: 1, lineStyle: p.swept ? 1 : 2,
        axisLabelVisible: !p.swept, title: `${buy ? 'BSL' : 'SSL'}×${p.hits}${p.swept ? ' swept' : ''}`,
      })
      w._charonLines.push(pl)
    } catch (_) { }
  }
}

// ═══════════════════════════════════════════════════════════════
// ATLAS — invented momentum-ACCELERATION oscillator (sub-pane histogram)
// bright = accelerating · dim = decelerating (trend tiring)
// ═══════════════════════════════════════════════════════════════

export function initAtlasChart(): void {
  if (w._atlasInited && w._atlasChart) { updateAtlas(); return }
  w._atlasChart = _createSubChart('atlasChart', 60)
  if (!w._atlasChart) return
  w._atlasSeries = w._atlasChart.addHistogramSeries({ color: '#26ff9a', priceLineVisible: false, lastValueVisible: true, title: 'ATLAS' })
  w._atlasInited = true
  updateAtlas()
}
export function updateAtlas(): void {
  if (!w._atlasInited || !w._atlasSeries || !w.S.klines.length) return
  const k = w.S.klines, s = w.IND_SETTINGS.atlas || {}
  const r = _calcATLAS(k.map((b: any) => b.close), Math.round(s.rocLen) || 10, Math.round(s.smooth) || 5)
  const out: any[] = []
  for (let i = 0; i < r.accel.length; i++) {
    if (r.accel[i] == null || r.momentum[i] == null || !k[i]) continue
    const m = r.momentum[i] as number, a = r.accel[i] as number
    // 4 regimes: up+gaining / up+tiring / down+gaining / down+tiring
    const col = m >= 0 ? (a >= 0 ? '#00e676' : '#2e7d5288') : (a <= 0 ? '#ff1744' : '#b71c1c88')
    out.push({ time: k[i].time, value: a, color: col })
  }
  try { w._atlasSeries.setData(out); _syncSubChartsToMain() } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// EOS — invented divergence detector (price vs RSI). Main-chart markers.
// ═══════════════════════════════════════════════════════════════

export function initEosSeries(): void {
  if (w.eosS || !w.mainChart) return
  w.eosS = w.mainChart.addLineSeries({ color: 'rgba(0,0,0,0)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
}
export function updateEos(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initEosSeries()
  const k = w.S.klines, s = w.IND_SETTINGS.eos || {}
  const divs = _calcEOS(k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close), Math.round(s.lookback) || 5, Math.round(s.rsiPeriod) || 14)
  const marks = divs.filter((d: any) => k[d.index]).map((d: any) => ({
    time: k[d.index].time,
    position: d.dir === 'bear' ? 'aboveBar' : 'belowBar',
    shape: d.dir === 'bear' ? 'arrowDown' : 'arrowUp',
    color: d.dir === 'bear' ? '#ff8f00' : '#00bcd4',
    text: d.dir === 'bear' ? 'DIV↓' : 'DIV↑',
  }))
  try { w.eosS.setData(k.map((b: any) => ({ time: b.time, value: b.close }))); w.eosS.setMarkers(marks) } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// PANTHEON — invented MAX-CONFLUENCE meter (fuses the Zeus arsenal). Sub-pane
// histogram, −1..1, green/red by sign, dim when weak (gods disagree).
// ═══════════════════════════════════════════════════════════════

export function initPantheonChart(): void {
  if (w._pantheonInited && w._pantheonChart) { updatePantheon(); return }
  w._pantheonChart = _createSubChart('pantheonChart', 60)
  if (!w._pantheonChart) return
  w._pantheonSeries = w._pantheonChart.addHistogramSeries({ color: '#f0c040', priceLineVisible: false, lastValueVisible: true, title: 'PANTHEON' })
  w._pantheonInited = true
  updatePantheon()
}
export function updatePantheon(): void {
  if (!w._pantheonInited || !w._pantheonSeries || !w.S.klines.length) return
  const k = w.S.klines
  const r = _calcPANTHEON(k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close), k.map((b: any) => b.volume))
  const out: any[] = []
  for (let i = 0; i < r.score.length; i++) {
    if (r.score[i] == null || !k[i]) continue
    const v = r.score[i] as number
    const strong = Math.abs(v) >= 0.4
    const col = v >= 0 ? (strong ? '#00e676' : '#2e7d5288') : (strong ? '#ff1744' : '#b71c1c88')
    out.push({ time: k[i].time, value: v, color: col })
  }
  try { w._pantheonSeries.setData(out); _syncSubChartsToMain() } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// AEGIS — invented apex confluence-gated ENTRY trigger (PANTHEON × HELIOS),
// brain-confirmed. Main-chart markers + ATR stop line for the latest.
// ═══════════════════════════════════════════════════════════════

export function initAegisSeries(): void {
  if (w.aegisMarkS || !w.mainChart) return
  w.aegisMarkS = w.mainChart.addLineSeries({ color: 'rgba(0,0,0,0)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
  w.aegisStopS = w.mainChart.addLineSeries({ color: '#ff5277', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: true, title: 'AEGIS STOP' })
}
export function updateAegis(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initAegisSeries()
  const k = w.S.klines, s = w.IND_SETTINGS.aegis || {}
  const entries = _calcAEGIS(k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close), k.map((b: any) => b.volume), s.thr ?? 0.4, s.atrMult ?? 1.5)
  // brain confirmation for the most-recent signal
  const bm = (w.BM || {}) as any
  const score = Number(bm.entryScore) || 0, ready = !!bm.entryReady
  const latest = entries.length ? entries[entries.length - 1] : null
  const latestConfirmed = !!latest && ((latest.dir === 'long' ? score : -score) > 10 || (ready && score !== 0 && ((score > 0) === (latest.dir === 'long'))))
  const marks = entries.filter((g: any) => k[g.index]).map((g: any, i: number) => {
    const isLatest = i === entries.length - 1
    const strong = isLatest && latestConfirmed
    return {
      time: k[g.index].time,
      position: g.dir === 'long' ? 'belowBar' : 'aboveBar',
      shape: g.dir === 'long' ? 'arrowUp' : 'arrowDown',
      color: g.dir === 'long' ? (strong ? '#00e676' : '#66bb6a') : (strong ? '#ff1744' : '#ef5350'),
      text: strong ? '🛡★' : (isLatest ? 'AEGIS' : ''),
    }
  })
  try {
    w.aegisMarkS.setData(k.map((b: any) => ({ time: b.time, value: b.close })))
    w.aegisMarkS.setMarkers(marks)
    if (latest && k[latest.index]) {
      const t0 = k[latest.index].time, t1 = k[k.length - 1].time
      w.aegisStopS.setData([{ time: t0, value: latest.stop }, { time: t1, value: latest.stop }])
    } else { w.aegisStopS.setData([]) }
  } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// SELENE — invented dominant-cycle oscillator (sub-pane). Wave coloured by
// phase (rising cyan / falling magenta); pane title shows the cycle length.
// ═══════════════════════════════════════════════════════════════

export function initSeleneChart(): void {
  if (w._seleneInited && w._seleneChart) { updateSelene(); return }
  w._seleneChart = _createSubChart('seleneChart', 60)
  if (!w._seleneChart) return
  w._seleneSeries = w._seleneChart.addLineSeries({ color: '#b388ff', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'SELENE' })
  w._seleneMidS = w._seleneChart.addLineSeries({ color: 'rgba(255,255,255,0.2)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
  w._seleneInited = true
  updateSelene()
}
export function updateSelene(): void {
  if (!w._seleneInited || !w._seleneSeries || !w.S.klines.length) return
  const k = w.S.klines, s = w.IND_SETTINGS.selene || {}
  const r = _calcSELENE(k.map((b: any) => b.close), Math.round(s.detrendLen) || 20, Math.round(s.minP) || 8, Math.round(s.maxP) || 60)
  const data: any[] = [], mid: any[] = []
  let prev: number | null = null
  for (let i = 0; i < r.wave.length; i++) {
    if (r.wave[i] == null || !k[i]) continue
    const v = r.wave[i] as number
    const rising = prev == null ? true : v >= prev
    data.push({ time: k[i].time, value: v, color: rising ? '#26c6da' : '#e040fb' }) // cyan up toward peak / magenta down
    mid.push({ time: k[i].time, value: 0 })
    prev = v
  }
  try {
    w._seleneSeries.applyOptions({ title: r.period ? `SELENE P${r.period}` : 'SELENE' })
    w._seleneSeries.setData(data); w._seleneMidS.setData(mid); _syncSubChartsToMain()
  } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// KRATOS — invented ALL-IN-ONE trade commander. Marks every trade
// (entry/exit/SL/TP) on the chart AND drives a live HUD "cadran" ticket.
// ═══════════════════════════════════════════════════════════════

function _kFmt(p: number): string {
  const d = Math.abs(p) >= 1000 ? 1 : Math.abs(p) >= 1 ? 2 : 5
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export function initKratosSeries(): void {
  if (w.kratosMarkS || !w.mainChart) return
  w.kratosMarkS = w.mainChart.addLineSeries({ color: 'rgba(0,0,0,0)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
  w.kratosEntryS = w.mainChart.addLineSeries({ color: '#f0c040', lineWidth: 1, lineStyle: 0, priceLineVisible: false, lastValueVisible: true, title: 'KRATOS ENTRY' })
  w.kratosTpS = w.mainChart.addLineSeries({ color: '#26ff9a', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: true, title: 'KRATOS TP' })
  w.kratosSlS = w.mainChart.addLineSeries({ color: '#ff5277', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: true, title: 'KRATOS SL' })
}

export function initKratosHud(): void {
  // Anchor the HUD INSIDE the chart container (#mc) — NOT its parent, which also
  // holds the Zeus toolbar/header and made the cadran overlap the UI. As a child of
  // #mc it's clipped to the chart plot area (standard lightweight-charts legend pattern).
  const mc = document.getElementById('mc')
  if (!mc) return
  if (w._kratosHud) {
    if (w._kratosHud.parentElement !== mc) { try { mc.appendChild(w._kratosHud) } catch (_) { } } // re-home if it landed on the old parent
    w._kratosHud.style.display = ''
    return
  }
  try { if (getComputedStyle(mc).position === 'static') mc.style.position = 'relative' } catch (_) { }
  const hud = document.createElement('div')
  hud.id = 'kratosHud'
  hud.className = 'kratos-hud'
  mc.appendChild(hud)
  w._kratosHud = hud
}

export function updateKratos(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initKratosSeries()
  const k = w.S.klines, s = w.IND_SETTINGS.kratos || {}
  const thr = s.thr ?? 0.35, atrMult = s.atrMult ?? 1.5, rr = s.rr ?? 2
  const trades = _calcKRATOS(
    k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close), k.map((b: any) => b.volume),
    thr, atrMult, rr
  )
  ;[w.kratosMarkS, w.kratosEntryS, w.kratosTpS, w.kratosSlS].forEach((sx: any) => { if (sx) sx.applyOptions({ visible: true }) })
  // entry + exit markers for every trade
  const marks: any[] = []
  for (const t of trades) {
    if (k[t.entryIndex]) marks.push({
      time: k[t.entryIndex].time,
      position: t.dir === 'long' ? 'belowBar' : 'aboveBar',
      shape: t.dir === 'long' ? 'arrowUp' : 'arrowDown',
      color: t.dir === 'long' ? '#00e676' : '#ff1744',
      text: t.dir === 'long' ? 'BUY' : 'SELL',
    })
    if (t.exitReason !== 'open' && k[t.exitIndex]) marks.push({
      time: k[t.exitIndex].time,
      position: t.dir === 'long' ? 'aboveBar' : 'belowBar',
      shape: 'circle',
      color: t.exitReason === 'tp' ? '#26ff9a' : t.exitReason === 'sl' ? '#ff5277' : '#90a4ae',
      text: t.exitReason === 'tp' ? `TP +${t.pnlPct.toFixed(1)}%` : t.exitReason === 'sl' ? `SL ${t.pnlPct.toFixed(1)}%` : 'FLIP',
    })
  }
  try { w.kratosMarkS.setData(k.map((b: any) => ({ time: b.time, value: b.close }))); w.kratosMarkS.setMarkers(marks) } catch (_) { }
  // active trade → live entry/TP/SL lines
  const active = trades.length && trades[trades.length - 1].exitReason === 'open' ? trades[trades.length - 1] : null
  try {
    if (active && k[active.entryIndex]) {
      const t0 = k[active.entryIndex].time, t1 = k[k.length - 1].time
      w.kratosEntryS.setData([{ time: t0, value: active.entry }, { time: t1, value: active.entry }])
      w.kratosTpS.setData([{ time: t0, value: active.tp }, { time: t1, value: active.tp }])
      w.kratosSlS.setData([{ time: t0, value: active.sl }, { time: t1, value: active.sl }])
    } else { w.kratosEntryS.setData([]); w.kratosTpS.setData([]); w.kratosSlS.setData([]) }
  } catch (_) { }
  // ── the cadran: live trade ticket HUD ──
  initKratosHud()
  if (w._kratosHud) w._kratosHud.innerHTML = _kratosHudHtml(trades, active, k)
}

function _kratosHudHtml(trades: any[], active: any, k: any[]): string {
  const wins = trades.filter((t: any) => t.exitReason === 'tp').length
  const losses = trades.filter((t: any) => t.exitReason === 'sl').length
  const closed = trades.filter((t: any) => t.exitReason !== 'open')
  const wr = closed.length ? Math.round(wins / closed.length * 100) : 0
  // confluence gauge from the latest PANTHEON score
  const sc = _calcPANTHEON2(k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close), k.map((b: any) => b.volume)).score
  let score = 0; for (let i = sc.length - 1; i >= 0; i--) { if (sc[i] != null) { score = sc[i] as number; break } }
  const filled = Math.round((score + 1) / 2 * 10)
  const gColor = score >= 0.15 ? '#00e676' : score <= -0.15 ? '#ff1744' : '#90a4ae'
  const gauge = `<span style="color:${gColor}">${'▰'.repeat(Math.max(0, Math.min(10, filled)))}</span><span style="color:#33414d">${'▱'.repeat(Math.max(0, 10 - filled))}</span>`
  const head = `<div style="font-weight:700;letter-spacing:1px;color:#f0c040;margin-bottom:4px">⚔ KRATOS</div>`
  const stats = `<div style="margin-top:5px;border-top:1px solid #ffffff14;padding-top:4px;color:#7fa">W ${wins} · L ${losses} · WR ${wr}%</div><div style="margin-top:3px">Conf ${gauge}</div>`
  if (active) {
    const live = k[k.length - 1]?.close ?? active.entry
    const pnl = active.pnlPct
    const pnlCol = pnl >= 0 ? '#26ff9a' : '#ff5277'
    const dirCol = active.dir === 'long' ? '#00e676' : '#ff1744'
    const dot = active.dir === 'long' ? '🟢' : '🔴'
    return head +
      `<div style="color:${dirCol};font-weight:700">${dot} ${active.dir.toUpperCase()} @ ${_kFmt(active.entry)}</div>` +
      `<div style="color:#26ff9a">TP ${_kFmt(active.tp)}</div>` +
      `<div style="color:#ff5277">SL ${_kFmt(active.sl)}</div>` +
      `<div style="margin-top:3px">Now ${_kFmt(live)} · <span style="color:${pnlCol};font-weight:700">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%</span></div>` +
      stats
  }
  return head + `<div style="color:#90a4ae">⚪ FLAT — waiting for setup</div>` + stats
}

// ═══════════════════════════════════════════════════════════════
// PROMETHEUS — invented forward volatility CONE (projects into the future).
// MNEMOSYNE — invented analog forecast (historical-pattern continuation).
// Both plot beyond the last candle using extrapolated future bar times.
// ═══════════════════════════════════════════════════════════════

/** Future bar times extrapolated from the kline interval: [t_last, t_last+iv, …]. */
function _futureTimes(k: any[], steps: number): number[] {
  const n = k.length
  const t1 = k[n - 1].time
  const iv = n >= 2 ? (t1 - k[n - 2].time) : 60
  const out: number[] = []
  for (let i = 0; i <= steps; i++) out.push(t1 + iv * i)
  return out
}

export function initPrometheusSeries(): void {
  if (w.promCenterS || !w.mainChart) return
  const band = (c: string, lw = 1, ls = 0) => w.mainChart.addLineSeries({ color: c, lineWidth: lw, lineStyle: ls, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
  w.promUp2S = band('rgba(255,138,0,0.30)')
  w.promLo2S = band('rgba(255,138,0,0.30)')
  w.promUp1S = band('rgba(255,171,64,0.55)')
  w.promLo1S = band('rgba(255,171,64,0.55)')
  w.promCenterS = band('#ff8f00', 2, 2)
}
export function updatePrometheus(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initPrometheusSeries()
  const k = w.S.klines, s = w.IND_SETTINGS.prometheus || {}
  const r = _calcPROM(k.map((b: any) => b.high), k.map((b: any) => b.low), k.map((b: any) => b.close), Math.round(s.atrP) || 14, Math.round(s.horizon) || 12, (s.drift ?? 1) != 0)
  const ft = _futureTimes(k, r.steps)
  const mk = (arr: number[]) => arr.map((v, i) => ({ time: ft[i], value: v }))
  try {
    w.promCenterS.setData(mk(r.center)); w.promUp1S.setData(mk(r.up1)); w.promLo1S.setData(mk(r.lo1))
    w.promUp2S.setData(mk(r.up2)); w.promLo2S.setData(mk(r.lo2))
  } catch (_) { }
}

export function initMnemoSeries(): void {
  if (w.mnemoS || !w.mainChart) return
  w.mnemoS = w.mainChart.addLineSeries({ color: '#b388ff', lineWidth: 2, lineStyle: 1, priceLineVisible: false, lastValueVisible: true, title: 'MNEMOSYNE', crosshairMarkerVisible: false })
}
export function updateMnemo(): void {
  if (!w.mainChart || !w.S.klines.length) return
  initMnemoSeries()
  const k = w.S.klines, s = w.IND_SETTINGS.mnemosyne || {}
  const r = _calcMNEMO(k.map((b: any) => b.close), Math.round(s.queryLen) || 20, Math.round(s.horizon) || 12, 5)
  try {
    if (r.projection.length) {
      const ft = _futureTimes(k, r.projection.length - 1)
      w.mnemoS.applyOptions({ title: `MNEMO ${Math.round(r.similarity * 100)}%` })
      w.mnemoS.setData(r.projection.map((v: number, i: number) => ({ time: ft[i], value: v })))
    } else { w.mnemoS.setData([]) }
  } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// THEMIS — invented regression-equilibrium stretch (z-score) oscillator. Pane.
// ═══════════════════════════════════════════════════════════════

export function initThemisChart(): void {
  if (w._themisInited && w._themisChart) { updateThemis(); return }
  w._themisChart = _createSubChart('themisChart', 60)
  if (!w._themisChart) return
  w._themisSeries = w._themisChart.addLineSeries({ color: '#f0c040', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'THEMIS z' })
  const ref = (c: string) => w._themisChart.addLineSeries({ color: c, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
  w._themisZeroS = ref('rgba(255,255,255,0.2)'); w._themisHiS = ref('rgba(255,82,119,0.5)'); w._themisLoS = ref('rgba(38,255,154,0.5)')
  w._themisInited = true
  updateThemis()
}
export function updateThemis(): void {
  if (!w._themisInited || !w._themisSeries || !w.S.klines.length) return
  const k = w.S.klines, p = Math.round(w.IND_SETTINGS.themis?.period) || 50
  const r = _calcTHEMIS(k.map((b: any) => b.close), p)
  const data: any[] = [], z0: any[] = [], zhi: any[] = [], zlo: any[] = []
  for (let i = 0; i < r.z.length; i++) {
    if (r.z[i] == null || !k[i]) continue
    const v = r.z[i] as number, a = Math.abs(v)
    const col = a >= 2 ? (v > 0 ? '#ff1744' : '#00e676') : a >= 1 ? '#ffab40' : '#90a4ae'
    data.push({ time: k[i].time, value: v, color: col })
    z0.push({ time: k[i].time, value: 0 }); zhi.push({ time: k[i].time, value: 2 }); zlo.push({ time: k[i].time, value: -2 })
  }
  try { w._themisSeries.setData(data); w._themisZeroS.setData(z0); w._themisHiS.setData(zhi); w._themisLoS.setData(zlo); _syncSubChartsToMain() } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// EREBUS — invented permutation-entropy (market disorder) meter. Pane.
// green low = ordered/tradeable · red high = chaotic/noise.
// ═══════════════════════════════════════════════════════════════

export function initErebusChart(): void {
  if (w._erebusInited && w._erebusChart) { updateErebus(); return }
  w._erebusChart = _createSubChart('erebusChart', 60)
  if (!w._erebusChart) return
  w._erebusSeries = w._erebusChart.addLineSeries({ color: '#b388ff', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'EREBUS H' })
  w._erebusMidS = w._erebusChart.addLineSeries({ color: 'rgba(255,255,255,0.2)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
  w._erebusInited = true
  updateErebus()
}
export function updateErebus(): void {
  if (!w._erebusInited || !w._erebusSeries || !w.S.klines.length) return
  const k = w.S.klines, s = w.IND_SETTINGS.erebus || {}
  const h = _calcEREBUS(k.map((b: any) => b.close), Math.round(s.period) || 60, Math.round(s.dim) || 3)
  const data: any[] = [], mid: any[] = []
  for (let i = 0; i < h.length; i++) {
    if (h[i] == null || !k[i]) continue
    const v = h[i] as number
    // green ordered (low) → amber → red chaotic (high)
    const col = v <= 0.45 ? '#00e676' : v <= 0.7 ? '#ffab40' : '#ff1744'
    data.push({ time: k[i].time, value: v, color: col })
    mid.push({ time: k[i].time, value: 0.5 })
  }
  try { w._erebusSeries.setData(data); w._erebusMidS.setData(mid); _syncSubChartsToMain() } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// ANEMOI — invented volume-anomaly (z-score) meter. Sub-pane histogram.
// ═══════════════════════════════════════════════════════════════

export function initAnemoiChart(): void {
  if (w._anemoiInited && w._anemoiChart) { updateAnemoi(); return }
  w._anemoiChart = _createSubChart('anemoiChart', 60)
  if (!w._anemoiChart) return
  w._anemoiSeries = w._anemoiChart.addHistogramSeries({ color: '#26c6da', priceLineVisible: false, lastValueVisible: true, title: 'ANEMOI z' })
  w._anemoiInited = true
  updateAnemoi()
}
export function updateAnemoi(): void {
  if (!w._anemoiInited || !w._anemoiSeries || !w.S.klines.length) return
  const k = w.S.klines, p = Math.round(w.IND_SETTINGS.anemoi?.period) || 20
  const z = _calcANEMOI(k.map((b: any) => b.volume), p)
  const out: any[] = []
  for (let i = 0; i < z.length; i++) {
    if (z[i] == null || !k[i]) continue
    const v = z[i] as number
    const col = v >= 2 ? '#ff1744' : v >= 1 ? '#ffab40' : v <= -1 ? '#37474f' : '#26c6da'
    out.push({ time: k[i].time, value: v, color: col })
  }
  try { w._anemoiSeries.setData(out); _syncSubChartsToMain() } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// CERBERUS — invented multi-timeframe trend alignment (3 heads). Sub-pane:
// three stacked rows (fast/mid/slow), each green up / red down.
// ═══════════════════════════════════════════════════════════════

export function initCerberusChart(): void {
  if (w._cerberusInited && w._cerberusChart) { updateCerberus(); return }
  w._cerberusChart = _createSubChart('cerberusChart', 60)
  if (!w._cerberusChart) return
  const row = () => w._cerberusChart.addLineSeries({ lineWidth: 4, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
  w._cerberusFastS = row(); w._cerberusMidS = row(); w._cerberusSlowS = row()
  w._cerberusInited = true
  updateCerberus()
}
export function updateCerberus(): void {
  if (!w._cerberusInited || !w._cerberusSlowS || !w.S.klines.length) return
  const k = w.S.klines, s = w.IND_SETTINGS.cerberus || {}
  const r = _calcCERBERUS(k.map((b: any) => b.close), Math.round(s.baseLen) || 20, Math.round(s.mult2) || 4, Math.round(s.mult3) || 12)
  const col = (v: number | null) => (v == null ? '#37474f' : v > 0 ? '#00e676' : v < 0 ? '#ff1744' : '#90a4ae')
  const build = (arr: (number | null)[], level: number) => {
    const out: any[] = []
    for (let i = 0; i < arr.length; i++) { if (arr[i] == null || !k[i]) continue; out.push({ time: k[i].time, value: level, color: col(arr[i]) }) }
    return out
  }
  try {
    w._cerberusFastS.setData(build(r.fast, 3))  // fast = top row
    w._cerberusMidS.setData(build(r.mid, 2))
    w._cerberusSlowS.setData(build(r.slow, 1))  // slow = bottom row (highest TF)
    _syncSubChartsToMain()
  } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR RENDER HOOK
// ═══════════════════════════════════════════════════════════════

export function _indRenderHook(): void {
  if (w.S.activeInds.bb) updateBB()
  if (w.S.activeInds.ichimoku) updateIchimoku()
  if (w.S.activeInds.fib) updateFib()
  if (w.S.activeInds.pivot) updatePivot()
  if (w.S.activeInds.vp) updateVP()
  if (w.S.activeInds.rsi14 && w._rsiInited) updateRSI()
  if (w.S.activeInds.stoch && w._stochInited) updateStoch()
  if (w.S.activeInds.atr && w._atrInited) updateATRInd()
  if (w.S.activeInds.obv && w._obvInited) updateOBV()
  if (w.S.activeInds.mfi && w._mfiInited) updateMFI()
  if (w.S.activeInds.cci && w._cciInited) updateCCI()
  // [2026-06-16] batch-1 overlays
  if (w.S.activeInds.sma) updateSMA()
  if (w.S.activeInds.hma) updateHMA()
  if (w.S.activeInds.psar) updatePSAR()
  if (w.S.activeInds.kc) updateKC()
  if (w.S.activeInds.dc) updateDC()
  // [2026-06-16] batch-2 oscillators
  if (w.S.activeInds.adx && w._adxInited) updateADX()
  if (w.S.activeInds.willr && w._willrInited) updateWILLR()
  if (w.S.activeInds.roc && w._rocInited) updateROC()
  if (w.S.activeInds.cmf && w._cmfInited) updateCMF()
  if (w.S.activeInds.ao && w._aoInited) updateAO()
  // [2026-06-16] batch-3
  if (w.S.activeInds.vwma) updateVWMA()
  if (w.S.activeInds.aroon && w._aroonInited) updateAroon()
  if (w.S.activeInds.trix && w._trixInited) updateTrix()
  if (w.S.activeInds.uo && w._uoInited) updateUO()
  if (w.S.activeInds.chop && w._chopInited) updateChop()
  if (w.S.activeInds.kera) updateKera()
  if (w.S.activeInds.aether) updateAether()
  if (w.S.activeInds.ms) updateMS()
  if (w.S.activeInds.nem) updateNem()
  if (w.S.activeInds.iris) updateIris()
  if (w.S.activeInds.pythia) updatePythia()
  if (w.S.activeInds.plutus) updatePlutus()
  if (w.S.activeInds.helios && w._heliosInited) updateHelios()
  if (w.S.activeInds.hermes) updateHermes()
  if (w.S.activeInds.charon) updateCharon()
  if (w.S.activeInds.atlas && w._atlasInited) updateAtlas()
  if (w.S.activeInds.eos) updateEos()
  if (w.S.activeInds.pantheon && w._pantheonInited) updatePantheon()
  if (w.S.activeInds.aegis) updateAegis()
  if (w.S.activeInds.selene && w._seleneInited) updateSelene()
  if (w.S.activeInds.kratos) updateKratos()
  if (w.S.activeInds.prometheus) updatePrometheus()
  if (w.S.activeInds.mnemosyne) updateMnemo()
  if (w.S.activeInds.themis && w._themisInited) updateThemis()
  if (w.S.activeInds.erebus && w._erebusInited) updateErebus()
  if (w.S.activeInds.anemoi && w._anemoiInited) updateAnemoi()
  if (w.S.activeInds.cerberus && w._cerberusInited) updateCerberus()
}

export function renderActBar(): void {
  const bar = document.getElementById('actIndBar')
  const cnt = document.getElementById('actCount')
  if (!bar) return
  const active = w.INDICATORS.filter((i: any) => w.S.activeInds[i.id])
  if (cnt) cnt.textContent = active.length
  bar.innerHTML = active.map((i: any) => `
    <span class="act-pill" style="color:${getIndColor(i.id)};border-color:${getIndColor(i.id)}44;background:${getIndColor(i.id)}11"
      data-action="deactivateInd" data-id="${i.id}">
      ${IND_ICONS[i.id] || i.ico} ${i.id.toUpperCase()} <span class="kill">\u2715</span>
    </span>`).join('')
  // Event delegation for active indicator pills
  if (!bar.dataset.delegated) {
    bar.dataset.delegated = '1'
    bar.addEventListener('click', (e) => {
      const pill = (e.target as HTMLElement).closest('[data-action="deactivateInd"]') as HTMLElement
      if (pill) deactivateInd(pill.dataset.id || '')
    })
  }
}

export function getIndColor(id: string): string {
  const map: Record<string, string> = { ema: '#f0c040', wma: '#aa44ff', st: '#ff8800', vp: '#00b8d4', macd: '#00e5ff', bb: '#ff6688', rsi14: '#f5c842', vwap: '#00d97a', fib: '#aa44ff', ichimoku: '#44aaff', stoch: '#ffaa00', obv: '#00b8d4', atr: '#ff8800', pivot: '#f0c040', mfi: '#00d97a', cci: '#ff3355', sma: '#26c6da', hma: '#ffca28', psar: '#00e5ff', kc: '#ab47bc', dc: '#42a5f5', adx: '#f0c040', willr: '#26c6da', roc: '#ffca28', cmf: '#ab47bc', ao: '#26ff9a', vwma: '#7e57c2', aroon: '#26ff9a', trix: '#ffca28', uo: '#26c6da', chop: '#ab47bc', kera: '#00e676', aether: '#f0c040', ms: '#26ff9a', nem: '#ff1744', iris: '#32ade6', pythia: '#00e676', plutus: '#ffab40', helios: '#f0c040', hermes: '#26c6da', charon: '#ffca28', atlas: '#00e676', eos: '#ff8f00', pantheon: '#f0c040', aegis: '#00e676', selene: '#b388ff', kratos: '#f0c040', prometheus: '#ff8f00', mnemosyne: '#b388ff', themis: '#f0c040', erebus: '#b388ff', anemoi: '#26c6da', cerberus: '#00e676' }
  return map[id] || '#888'
}

export function deactivateInd(id: string): void {
  w.S.activeInds[id] = false
  w.S.indicators[id] = false
  applyIndVisibility(id, false)
  renderActBar()
  if (typeof w._usSave === 'function') w._usSave()
}

export function toggleActBar(): void {
  const bar = document.getElementById('actIndBar')
  if (!bar) return
  ;(bar as HTMLElement).style.display = (bar as HTMLElement).style.display === 'none' ? 'flex' : 'none'
}

// ═══════════════════════════════════════════════════════════════
// MACD
// ═══════════════════════════════════════════════════════════════

export function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9): any {
  if (!closes || closes.length < slow + signal) return null
  const ema = (arr: number[], p: number) => {
    const k = 2 / (p + 1); let v = arr[0]
    return arr.map((x, i) => i === 0 ? v : (v = x * k + v * (1 - k)))
  }
  const fastE = ema(closes, fast)
  const slowE = ema(closes, slow)
  const macdLine = fastE.map((v, i) => v - slowE[i]).slice(slow - 1)
  const sigLine = ema(macdLine, signal)
  const histogram = macdLine.map((v, i) => v - sigLine[i])
  const last = macdLine.length - 1
  return {
    macd: macdLine[last], signal: sigLine[last], hist: histogram[last],
    prevHist: histogram[last - 1] || 0, prevMacd: macdLine[last - 1] || 0, prevSignal: sigLine[last - 1] || 0,
  }
}

export function initMACDChart(): void {
  if (w._macdInited && _macdChart) { _updateMACDChart(); return }
  const container = document.getElementById('macdChart')
  if (!container || typeof w.LightweightCharts === 'undefined') return
  container.style.height = '60px'
  const width = getChartW()
  _macdChart = w.LightweightCharts.createChart(container, {
    width, height: 60,
    layout: { background: { color: '#0a0f16' }, textColor: '#7a9ab8' },
    grid: { vertLines: { color: '#1a2030' }, horzLines: { color: '#1a2030' } },
    rightPriceScale: { borderColor: '#1e2530', scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale: { borderColor: '#1e2530', timeVisible: true, secondsVisible: false, rightOffset: 12 },
    crosshair: { mode: w.LightweightCharts.CrosshairMode.Normal },
    handleScroll: { mouseWheel: true, pressedMouseMove: true },
    handleScale: { mouseWheel: true, pinch: true },
  })
  _macdChart.applyOptions({ localization: { timeFormatter: (ts: number) => fmtTime(ts), dateFormatter: (ts: number) => fmtDate(ts) } })
  _macdChart.timeScale().applyOptions({ visible: false, rightOffset: 12 })
  _macdChart.applyOptions({ rightPriceScale: { visible: true, borderColor: '#1e2530', width: 70 } })
  w._macdLineSeries = _macdChart.addLineSeries({ color: '#00e5ff', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'MACD' })
  w._macdSigSeries = _macdChart.addLineSeries({ color: '#ff8800', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: 'SIG' })
  w._macdHistSeries = _macdChart.addHistogramSeries({ color: '#00d97a44', priceFormat: { type: 'price', precision: 4, minMove: 0.0001 }, priceScaleId: '', scaleMargins: { top: 0.8, bottom: 0 } })
  w._macdInited = true
  _updateMACDChart()
}

function _updateMACDChart(): void {
  if (!w._macdInited || !_macdChart || !w._macdLineSeries) return
  const klines = w.S.klines
  const cfg = w.IND_SETTINGS?.macd || {}
  const fast = Math.max(1, Math.round(cfg.fast || 12))
  const slow = Math.max(fast + 1, Math.round(cfg.slow || 26))
  const signal = Math.max(1, Math.round(cfg.signal || 9))
  if (!klines || klines.length < slow + signal) return
  const closes = klines.map((k: any) => k.close)
  const emaFn = (arr: number[], p: number) => {
    const k = 2 / (p + 1); let v = arr[0]
    return arr.map((x: number, i: number) => i === 0 ? v : (v = x * k + v * (1 - k)))
  }
  const fastE = emaFn(closes, fast)
  const slowE = emaFn(closes, slow)
  const macdArr = fastE.map((v: number, i: number) => v - slowE[i]).slice(slow - 1)
  const times = klines.map((k: any) => k.time).slice(slow - 1)
  const sigArr = emaFn(macdArr, signal)
  const histArr = macdArr.map((v: number, i: number) => v - sigArr[i])
  const macdData = times.map((t: number, i: number) => ({ time: t, value: macdArr[i] })).filter((d: any) => Number.isFinite(d.value))
  const sigData = times.map((t: number, i: number) => ({ time: t, value: sigArr[i] })).filter((d: any) => Number.isFinite(d.value))
  const histData = times.map((t: number, i: number) => ({
    time: t, value: histArr[i],
    color: histArr[i] >= 0 ? (histArr[i] >= (histArr[i - 1] || 0) ? '#00d97a' : '#00d97a66') : (histArr[i] <= (histArr[i - 1] || 0) ? '#ff3355' : '#ff335566')
  })).filter((d: any) => Number.isFinite(d.value))
  try {
    w._macdLineSeries.setData(macdData)
    w._macdSigSeries.setData(sigData)
    w._macdHistSeries.setData(histData)
    if (w.mainChart && _macdChart) {
      const tr = w.mainChart.timeScale().getVisibleRange()
      if (tr) _macdChart.timeScale().setVisibleRange(tr)
    }
  } catch (e) { console.warn('[MACD]', e) }
}

export function _macdKlineHook(): void {
  if (w._macdInited && _macdChart) _updateMACDChart()
}

// ═══════════════════════════════════════════════════════════════
// SUPERTREND FLIP + RSI DIVERGENCE DETECTORS
// ═══════════════════════════════════════════════════════════════

export function detectSupertrendFlip(bars: any[]): string | null {
  if (!bars || bars.length < 2) return null
  const last = bars[bars.length - 1]
  const prev = bars[bars.length - 2]
  if (!last || !prev) return null
  const lClose = last.close, pClose = prev.close
  const _stBars = bars.slice(-20)
  const atr14 = (typeof _calcATRSeries === 'function' ? _calcATRSeries(_stBars, 14, 'wilder').last : null) || (last.high - last.low)
  const mult = 3
  const upperBand = ((last.high + last.low) / 2) + mult * atr14
  const lowerBand = ((last.high + last.low) / 2) - mult * atr14
  if (lClose > upperBand && pClose < upperBand) return 'bull'
  if (lClose < lowerBand && pClose > lowerBand) return 'bear'
  return null
}

export function detectRSIDivergence(closes: number[], rsiVal: number): string | null {
  if (!closes || closes.length < 20 || !rsiVal) return null
  const slice = closes.slice(-20)
  const minP = Math.min(...slice), maxP = Math.max(...slice)
  const midP = (minP + maxP) / 2
  const lastP = closes[closes.length - 1]
  if (lastP < midP && rsiVal > 45 && rsiVal < 60) return 'bull_div'
  if (lastP > midP && rsiVal < 55 && rsiVal > 40) return 'bear_div'
  return null
}

// ═══════════════════════════════════════════════════════════════
// SIGNAL SCANNER ENGINE
// ═══════════════════════════════════════════════════════════════

export function runSignalScan(): void {
  const bars = w.S.chartBars || []
  if (bars.length < 30) return
  const closes = bars.map((b: any) => b.close)
  // [R29] Drop DOM fallback — w.S.rsiData is the canonical source (populated
  // by fetchRSI in marketDataFeeds.ts). If absent, default to neutral 50.
  const rsiNow = w.S.rsiData?.['5m'] || 50
  const rsi1h = w.S.rsiData?.['1h'] || 60
  const rsi4h = w.S.rsiData?.['4h'] || 60
  const price = w.S.price || 0

  const macdRes = calcMACD(closes)
  const stFlip = detectSupertrendFlip(bars)
  const rsiDiv = detectRSIDivergence(closes, rsiNow)

  const signals: any[] = []
  let bullCount = 0, bearCount = 0

  if (macdRes) {
    const cross = macdRes.macd > macdRes.signal && macdRes.prevMacd <= macdRes.prevSignal
    const dcross = macdRes.macd < macdRes.signal && macdRes.prevMacd >= macdRes.prevSignal
    if (cross) { signals.push({ name: 'MACD Crossover', det: `MACD: ${macdRes.macd.toFixed(2)} | Signal: ${macdRes.signal.toFixed(2)}`, dir: 'bull', str: 'BULLISH' }); bullCount++ }
    if (dcross) { signals.push({ name: 'MACD Crossunder', det: `MACD: ${macdRes.macd.toFixed(2)} | Signal: ${macdRes.signal.toFixed(2)}`, dir: 'bear', str: 'BEARISH' }); bearCount++ }
    if (macdRes.hist > 0 && macdRes.prevHist < macdRes.hist) { signals.push({ name: 'MACD Histogram +', det: `Histogram: +${macdRes.hist.toFixed(2)}`, dir: 'bull', str: 'BULLISH' }); bullCount++ }
    if (macdRes.hist < 0 && macdRes.prevHist > macdRes.hist) { signals.push({ name: 'MACD Histogram \u2212', det: `Histogram: ${macdRes.hist.toFixed(2)}`, dir: 'bear', str: 'BEARISH' }); bearCount++ }
  }

  if (rsiNow < 30) { signals.push({ name: 'RSI Oversold (5m)', det: `RSI: ${rsiNow.toFixed(1)} < 30`, dir: 'bull', str: 'STRONG BULL' }); bullCount += 2 }
  if (rsiNow > 70) { signals.push({ name: 'RSI Overbought (5m)', det: `RSI: ${rsiNow.toFixed(1)} > 70`, dir: 'bear', str: 'STRONG BEAR' }); bearCount += 2 }
  if (rsiDiv === 'bull_div') { signals.push({ name: 'RSI Bullish Divergence', det: `Price lower + RSI higher`, dir: 'bull', str: 'BULLISH' }); bullCount++ }
  if (rsiDiv === 'bear_div') { signals.push({ name: 'RSI Bearish Divergence', det: `Price higher + RSI lower`, dir: 'bear', str: 'BEARISH' }); bearCount++ }

  if (stFlip === 'bull') { signals.push({ name: 'Supertrend Flip \u2191', det: `Trend change BULLISH`, dir: 'bull', str: 'STRONG BULL' }); bullCount += 2 }
  if (stFlip === 'bear') { signals.push({ name: 'Supertrend Flip \u2193', det: `Trend change BEARISH`, dir: 'bear', str: 'STRONG BEAR' }); bearCount += 2 }

  if (rsiNow > 55 && rsi1h > 55 && rsi4h > 55) { signals.push({ name: 'RSI Aligned Bullish MTF', det: `5m:${rsiNow.toFixed(0)} 1h:${rsi1h.toFixed(0)} 4h:${rsi4h.toFixed(0)}`, dir: 'bull', str: 'BULLISH' }); bullCount++ }
  if (rsiNow < 45 && rsi1h < 45 && rsi4h < 45) { signals.push({ name: 'RSI Aligned Bearish MTF', det: `5m:${rsiNow.toFixed(0)} 1h:${rsi1h.toFixed(0)} 4h:${rsi4h.toFixed(0)}`, dir: 'bear', str: 'BEARISH' }); bearCount++ }

  const sma20 = closes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20
  const sma50 = closes.slice(-50).reduce((a: number, b: number) => a + b, 0) / 50
  if (price > sma20 && sma20 > sma50) { signals.push({ name: 'Bullish Trend (SMA)', det: `Price>${sma20.toFixed(0)} > SMA50:${sma50.toFixed(0)}`, dir: 'bull', str: 'BULLISH' }); bullCount++ }
  if (price < sma20 && sma20 < sma50) { signals.push({ name: 'Bearish Trend (SMA)', det: `Price<${sma20.toFixed(0)} < SMA50:${sma50.toFixed(0)}`, dir: 'bear', str: 'BEARISH' }); bearCount++ }

  w.S.signalData = { signals, bullCount, bearCount }
  if (typeof renderSignals === 'function') renderSignals(signals, bullCount, bearCount)
  if (typeof updateDeepDive === 'function') updateDeepDive()

  if ((bullCount >= 3 || bearCount >= 3) && w.S.alerts?.enabled) {
    if (typeof playAlertSound === 'function') playAlertSound()
    if (bullCount >= 3 && typeof sendAlert === 'function') sendAlert('STRONG BULL SIGNAL', '3+ indicators aligned bullish', 'scan')
    if (bearCount >= 3 && typeof sendAlert === 'function') sendAlert('STRONG BEAR SIGNAL', '3+ indicators aligned bearish', 'scan')
  }

  signals.filter((s: any) => s.str.includes('STRONG')).forEach((s: any) => {
    if (typeof w.srRecord === 'function') w.srRecord('scan', s.name, s.dir === 'bull' ? 'LONG' : 'SHORT', s.str)
  })
  if (bullCount >= 3 && typeof w.srRecord === 'function') w.srRecord('scan', 'Scan STRONG BULL \u00D7' + bullCount, 'LONG', bullCount * 20)
  if (bearCount >= 3 && typeof w.srRecord === 'function') w.srRecord('scan', 'Scan STRONG BEAR \u00D7' + bearCount, 'SHORT', bearCount * 20)
}

// ═══════════════════════════════════════════════════════════════
// DEEP DIVE — Narrative Context Generator (READ-ONLY)
// ═══════════════════════════════════════════════════════════════

let _ddTimer: ReturnType<typeof setTimeout> | null = null

export function generateDeepDive(): string {
  try {
    if (!w.S || !w.S.price || !w.S.klines || w.S.klines.length < 20) {
      return '<div class="dd-loading">Waiting for market data...</div>'
    }

    const price = w.S.price
    const closes = w.S.klines.map((k: any) => k.close)
    const bars = w.S.chartBars || w.S.klines

    // 1. REGIME
    const regime = (w.BRAIN && w.BRAIN.regime) || 'unknown'
    const regConf = (w.BRAIN && w.BRAIN.regimeConfidence) || 0
    const regAtrPct = (w.BRAIN && w.BRAIN.regimeAtrPct) || 0
    const regSlope = (w.BRAIN && w.BRAIN.regimeSlope) || 0

    const regLabels: Record<string, string> = { trend: regSlope > 0 ? 'UPTREND' : 'DOWNTREND', range: 'RANGING', volatile: 'VOLATILE', breakout: 'BREAKOUT', unknown: 'SCANNING' }
    const regBadge: Record<string, string> = { trend: regSlope > 0 ? 'trend' : 'trend-dn', range: 'range', volatile: 'volatile', breakout: 'breakout', unknown: 'neut' }
    const regLabel = regLabels[regime] || regime.toUpperCase()
    const regCls = regBadge[regime] || 'neut'
    const confStr = regConf > 0 ? ` <span class="dd-hl-dim">(conf ${regConf}%)</span>` : ''
    const atrStr = regAtrPct > 0 ? ` \u00B7 ATR <span class="dd-hl-neut">${regAtrPct.toFixed(2)}%</span>` : ''

    const secRegime = `<div class="dd-section"><div class="dd-title">${_ZI.chart} REGIME</div><div class="dd-body"><span class="dd-badge ${regCls}">${regLabel}</span>${confStr}${atrStr}</div></div>`

    // 2. LIQUIDITY
    let secLiq = ''
    try {
      const magnets = (w.S.magnets) || { above: [], below: [] }
      const nearAbove = magnets.above && magnets.above[0]
      const nearBelow = magnets.below && magnets.below[0]
      const bias = (w.S.magnetBias || w.S.magnets?.bias || 'neut').toLowerCase()
      const biasCls = bias === 'bull' ? 'dd-hl-bull' : bias === 'bear' ? 'dd-hl-bear' : 'dd-hl-neut'
      const biasLbl = bias === 'bull' ? 'BULLISH PULL' : bias === 'bear' ? 'BEARISH PULL' : 'NEUTRAL'
      let aboveStr = '\u2014', belowStr = '\u2014'
      if (nearAbove && nearAbove.price) {
        const distA = ((nearAbove.price - price) / price * 100).toFixed(2)
        const volA = nearAbove.usd > 0 ? ` \u00B7 $${fmt(nearAbove.usd)}` : ''
        aboveStr = `<span class="dd-hl-bear">$${fP(nearAbove.price)}</span> <span class="dd-hl-dim">(+${distA}%${volA})</span>`
      }
      if (nearBelow && nearBelow.price) {
        const distB = ((price - nearBelow.price) / price * 100).toFixed(2)
        const volB = nearBelow.usd > 0 ? ` \u00B7 $${fmt(nearBelow.usd)}` : ''
        belowStr = `<span class="dd-hl-bull">$${fP(nearBelow.price)}</span> <span class="dd-hl-dim">(-${distB}%${volB})</span>`
      }
      secLiq = `<div class="dd-section"><div class="dd-title">${_ZI.mag} LIQUIDITY</div><div class="dd-body">Bias: <span class="${biasCls}">${biasLbl}</span><br>Nearest above: ${aboveStr}<br>Nearest below: ${belowStr}</div></div>`
    } catch (_) {
      secLiq = `<div class="dd-section"><div class="dd-title">${_ZI.mag} LIQUIDITY</div><div class="dd-body"><span class="dd-hl-dim">Scanning magnets...</span></div></div>`
    }

    // 3. INDICATORS
    let secInd = ''
    try {
      const rsi5m = w._safe.rsi(w.S.rsiData?.['5m'] || w.S.rsi?.['5m'])
      const rsi1h = w._safe.rsi(w.S.rsiData?.['1h'] || w.S.rsi?.['1h'] || 50)
      const rsi4h = w._safe.rsi(w.S.rsiData?.['4h'] || w.S.rsi?.['4h'] || 50)
      const rsiCls = (v: number) => v >= 70 ? 'dd-hl-bear' : v <= 30 ? 'dd-hl-bull' : 'dd-hl-neut'
      const rsiLbl = (v: number) => v >= 70 ? 'overbought' : v <= 30 ? 'oversold' : 'neutral'

      let macdStr = '\u2014'
      try {
        const macdR = calcMACD(closes)
        if (macdR) {
          const macdDir = macdR.hist > 0 ? '<span class="dd-hl-bull">\u25B2 BULL</span>' : '<span class="dd-hl-bear">\u25BC BEAR</span>'
          macdStr = `${macdDir} <span class="dd-hl-dim">(hist ${macdR.hist > 0 ? '+' : ''}${macdR.hist.toFixed(1)})</span>`
        }
      } catch (_) { }

      let stStr = '\u2014'
      try {
        const stFlipV = detectSupertrendFlip(bars)
        const sigSt = w.S.signalData?.signals?.find((sg: any) => sg.name.includes('Supertrend'))
        const stDir = sigSt ? sigSt.dir : (stFlipV === 'bull' ? 'bull' : stFlipV === 'bear' ? 'bear' : null)
        if (stDir === 'bull') stStr = '<span class="dd-hl-bull">\u25B2 BULL</span>'
        else if (stDir === 'bear') stStr = '<span class="dd-hl-bear">\u25BC BEAR</span>'
        else stStr = '<span class="dd-hl-neut">\u2014</span>'
      } catch (_) { }

      let frStr = '\u2014'
      if (w.S.fr !== null && w.S.fr !== undefined) {
        const frPct = (w.S.fr * 100).toFixed(4)
        const frCls = w.S.fr > 0.0001 ? 'dd-hl-bear' : w.S.fr < -0.0001 ? 'dd-hl-bull' : 'dd-hl-neut'
        const frLbl = w.S.fr > 0.0001 ? 'longs pay' : w.S.fr < -0.0001 ? 'shorts pay' : 'neutral'
        frStr = `<span class="${frCls}">${frPct}%</span> <span class="dd-hl-dim">(${frLbl})</span>`
      }

      let oiStr = '\u2014'
      if (w.S.oi && w.S.oiPrev && w.S.oiPrev > 0) {
        const oiChg = ((w.S.oi - w.S.oiPrev) / w.S.oiPrev * 100)
        const oiCls = oiChg > 0 ? 'dd-hl-bull' : 'dd-hl-bear'
        oiStr = `<span class="${oiCls}">${oiChg > 0 ? '+' : ''}${oiChg.toFixed(2)}%</span>`
      }

      const ofi = w.BRAIN?.ofi?.blendBuy || 50
      const ofiCls = ofi > 55 ? 'dd-hl-bull' : ofi < 45 ? 'dd-hl-bear' : 'dd-hl-neut'
      const ofiStr = `<span class="${ofiCls}">${ofi.toFixed(0)}% buy</span>`

      secInd = `<div class="dd-section"><div class="dd-title">${_ZI.ruler} INDICATORS</div><div class="dd-body">RSI 5m: <span class="${rsiCls(rsi5m)}">${rsi5m.toFixed(0)}</span> <span class="dd-hl-dim">(${rsiLbl(rsi5m)})</span> \u00B7 1h: <span class="${rsiCls(rsi1h)}">${rsi1h.toFixed(0)}</span> \u00B7 4h: <span class="${rsiCls(rsi4h)}">${rsi4h.toFixed(0)}</span><br>MACD: ${macdStr} \u00B7 ST: ${stStr}<br>Funding: ${frStr} \u00B7 OI \u0394: ${oiStr}<br>Order Flow: ${ofiStr}</div></div>`
    } catch (_) {
      secInd = `<div class="dd-section"><div class="dd-title">${_ZI.ruler} INDICATORS</div><div class="dd-body"><span class="dd-hl-dim">Calculating...</span></div></div>`
    }

    // 4. CONCLUSION
    let secConc = ''
    try {
      const bullC = w.S.signalData?.bullCount || 0
      const bearC = w.S.signalData?.bearCount || 0
      const ofi = w.BRAIN?.ofi?.blendBuy || 50
      const rsi5m = w._safe.rsi(w.S.rsiData?.['5m'] || w.S.rsi?.['5m'])
      const mBias = (w.S.magnetBias || w.S.magnets?.bias || 'neut').toLowerCase()

      let verdict = '', verdictCls = 'neut'
      const bullScore = bullC + (ofi > 55 ? 1 : 0) + (rsi5m > 55 ? 1 : 0) + (mBias === 'bull' ? 1 : 0) + (regime === 'trend' && regSlope > 0 ? 2 : 0)
      const bearScore = bearC + (ofi < 45 ? 1 : 0) + (rsi5m < 45 ? 1 : 0) + (mBias === 'bear' ? 1 : 0) + (regime === 'trend' && regSlope < 0 ? 2 : 0)

      if (regime === 'volatile') { verdict = 'Highly volatile conditions \u2014 avoid new entries until regime stabilizes.'; verdictCls = 'dd-hl-neut' }
      else if (bullScore > bearScore + 2) {
        const nearRes = w.S.magnets?.above?.[0]
        const resWarn = nearRes ? ` Price approaching resistance at $${fP(nearRes.price)} \u2014 wait for retest.` : ''
        verdict = `Bullish bias with ${bullC} aligned signal(s).${resWarn}`; verdictCls = 'dd-hl-bull'
      } else if (bearScore > bullScore + 2) {
        const nearSup = w.S.magnets?.below?.[0]
        const supWarn = nearSup ? ` Watch support at $${fP(nearSup.price)}.` : ''
        verdict = `Bearish pressure with ${bearC} aligned signal(s).${supWarn}`; verdictCls = 'dd-hl-bear'
      } else if (regime === 'range') { verdict = `Market ranging with no clear directional edge. Wait for breakout confirmation.`; verdictCls = 'dd-hl-neut' }
      else { verdict = `Mixed signals \u2014 no strong directional conviction. Neutral stance advised.`; verdictCls = 'dd-hl-neut' }

      secConc = `<div class="dd-section"><div class="dd-title">${_ZI.brain} CONCLUSION</div><div class="dd-body"><span class="${verdictCls}">${verdict}</span></div></div>`
    } catch (_) {
      secConc = `<div class="dd-section"><div class="dd-title">${_ZI.brain} CONCLUSION</div><div class="dd-body"><span class="dd-hl-dim">Analyzing...</span></div></div>`
    }

    // 5. INVALIDATION
    let secInval = ''
    try {
      const nearBelow = w.S.magnets?.below?.[0]
      const nearAbove = w.S.magnets?.above?.[0]
      const bullC = w.S.signalData?.bullCount || 0
      const bearC = w.S.signalData?.bearCount || 0
      const ofi = w.BRAIN?.ofi?.blendBuy || 50
      const isBull = (bullC > bearC) || (ofi > 55)

      let invalStr = ''
      if (isBull && nearBelow && nearBelow.price) invalStr = `Daily close below <span class="dd-hl-bear">$${fP(nearBelow.price)}</span> invalidates bullish scenario.`
      else if (!isBull && nearAbove && nearAbove.price) invalStr = `Reclaim above <span class="dd-hl-bull">$${fP(nearAbove.price)}</span> would invalidate bearish scenario.`
      else if (regime === 'volatile') invalStr = `Volatility cool-down below ATR <span class="dd-hl-neut">${(regAtrPct * 0.5).toFixed(2)}%</span> needed for trend confirmation.`
      else invalStr = `Regime shift or sudden OFI reversal would invalidate current read.`

      secInval = `<div class="dd-section"><div class="dd-title">${_ZI.w} INVALIDATION</div><div class="dd-body">${invalStr}</div></div>`
    } catch (_) {
      secInval = `<div class="dd-section"><div class="dd-title">${_ZI.w} INVALIDATION</div><div class="dd-body"><span class="dd-hl-dim">\u2014</span></div></div>`
    }

    return secRegime + secLiq + secInd + secConc + secInval
  } catch (err) {
    console.warn('[DeepDive] generateDeepDive error:', err)
    return '<div class="dd-loading">Analysis unavailable \u2014 waiting for data.</div>'
  }
}

export function updateDeepDive(): void {
  if (_ddTimer) return
  _ddTimer = setTimeout(function () {
    _ddTimer = null
    try {
      const el_c = document.getElementById('deepdive-content')
      const el_t = document.getElementById('deepdive-upd')
      if (!el_c) return
      el_c.innerHTML = generateDeepDive()
      if (el_t) el_t.textContent = 'updated ' + fmtNow()
    } catch (err) {
      console.warn('[DeepDive] updateDeepDive error:', err)
    }
  }, 500)
}
