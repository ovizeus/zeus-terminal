import puppeteer from 'puppeteer-core'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = ms => new Promise(r => setTimeout(r, ms))

function makeToken() {
  const jwt = require('jsonwebtoken')
  return jwt.sign({ id: 1, email: 'test@test.com', role: 'admin', tokenVersion: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' })
}

async function run() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  DEEP AUDIT — PHASE 2 CORRECTIONS + LOGIC DEEP DIVE    ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  const consoleLogs = []
  page.on('console', m => consoleLogs.push({ type: m.type(), text: m.text() }))
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message || String(e)))

  await page.setCookie({ name: 'zeus_token', value: makeToken(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' })
  await page.goto('http://localhost:5174/app/', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(2000)

  // Wait for bridge
  for (let i = 0; i < 80; i++) {
    await sleep(500)
    if (consoleLogs.some(l => l.text.includes('startApp() completed'))) break
  }
  await sleep(4000)

  // ══ CORRECTED GLOBAL STATUS ══
  console.log('══ CORRECTED GLOBAL STATUS (right selectors) ══\n')

  const state = await page.evaluate(() => {
    const vis = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return { exists: false, visible: false }
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return {
        exists: true,
        visible: s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0,
        w: Math.round(r.width),
        h: Math.round(r.height),
        text: el.textContent.substring(0, 60)
      }
    }

    return {
      header: vis('.zeus-fixed-top'),
      headerInner: vis('#hdr'),
      statusBar: vis('#zeusStatusBar'),
      modeBar: vis('#zeus-mode-bar'),
      watchlist: vis('#wlBar'),
      chartContainer: vis('#mc'),
      chartCanvas: vis('#mc canvas'),
      chartControls: vis('#chartControls'),
      chartControlsFallback: vis('.cc-bar'),
      chartControlsAlt: vis('.zr-panel--chart'),
      dock: vis('#zeus-dock'),
      brain: vis('#zeusBrain'),
      brainZnc: vis('.znc'),
      analysis: vis('.fc-wrap'),
      analysisAlt: vis('#fgarc'),
      analysisAlt2: vis('.analysis-sections'),
      footer: vis('.bot'),
      zeusGroups: vis('#zeus-groups'),
    }
  })

  for (const [name, info] of Object.entries(state)) {
    const status = !info.exists ? 'NOT FOUND' : info.visible ? `VISIBLE ${info.w}x${info.h}` : `HIDDEN`
    console.log(`  ${name.padEnd(24)} ${status}${info.text ? ` — "${info.text.substring(0,40)}"` : ''}`)
  }

  // ══ DEEP LOGIC MODULE AUDIT ══
  console.log('\n══ DEEP LOGIC MODULE AUDIT ══\n')

  const logic = await page.evaluate(() => {
    const fn = (name) => typeof window[name] === 'function'
    const obj = (name) => typeof window[name] !== 'undefined' && window[name] !== null

    // Get ALL global function names that match key patterns
    const allGlobals = Object.keys(window).filter(k => {
      try { return typeof window[k] === 'function' && k.length > 3 && !k.startsWith('webkit') && !k.startsWith('on') }
      catch { return false }
    })

    // Brain
    const brainFns = allGlobals.filter(k => /brain|_brain|Brain|_bc/i.test(k))
    // Forecast
    const fcFns = allGlobals.filter(k => /forecast|_fc|Forecast/i.test(k))
    // AT
    const atFns = allGlobals.filter(k => /^_at|^at[A-Z]|AutoTrade|autotrade/i.test(k) && !/attach/i.test(k))
    // DSL
    const dslFns = allGlobals.filter(k => /dsl|DSL/i.test(k))
    // Positions
    const posFns = allGlobals.filter(k => /position|_pos|demo.*pos|render.*pos/i.test(k))
    // ARIA
    const ariaFns = allGlobals.filter(k => /aria|_aria|_ar[A-Z]/i.test(k) && !/ariaLabel/i.test(k))
    // Nova
    const novaFns = allGlobals.filter(k => /nova|_nova|novaLog/i.test(k))
    // AUB
    const aubFns = allGlobals.filter(k => /aub|AUB|_aub/i.test(k))
    // Teacher
    const teacherFns = allGlobals.filter(k => /teacher|_teacher|Teacher/i.test(k))
    // PM
    const pmFns = allGlobals.filter(k => /postmortem|_pm[A-Z]|PostMortem/i.test(k))
    // SR
    const srFns = allGlobals.filter(k => /^_sr[A-Z]|sigReg|SigReg/i.test(k))
    // Flow
    const flowFns = allGlobals.filter(k => /orderflow|_of[A-Z]|flow|Flow/i.test(k) && !/overflow/i.test(k))
    // MTF
    const mtfFns = allGlobals.filter(k => /^_mtf|MTF|mtf[A-Z]/i.test(k))
    // Adaptive
    const adaptFns = allGlobals.filter(k => /adaptive|_adapt/i.test(k))
    // PnL Lab
    const pnlFns = allGlobals.filter(k => /pnlLab|_pnl|pnl[A-Z]/i.test(k))
    // Journal
    const journalFns = allGlobals.filter(k => /journal|_jl|addJournal/i.test(k))
    // Guards/Risk
    const guardFns = allGlobals.filter(k => /guard|risk|_guard|_risk/i.test(k))
    // Settings
    const settingsFns = allGlobals.filter(k => /settings|_us[A-Z]|userSettings|saveUser|loadUser/i.test(k))
    // Sync/State
    const syncFns = allGlobals.filter(k => /sync|_sync|stateSync|_poll|pollOnce/i.test(k))
    // WS
    const wsFns = allGlobals.filter(k => /^ws$|_ws|websocket|initWS/i.test(k))
    // Chart
    const chartFns = allGlobals.filter(k => /chart|Chart|_chart|mainChart|cSeries/i.test(k))
    // Indicators
    const indFns = allGlobals.filter(k => /calc[A-Z]|EMA|RSI|MACD|ATR|OBV|MFI|BBand|SuperTrend|Stoch/i.test(k))

    return {
      brain: { count: brainFns.length, fns: brainFns.slice(0, 15) },
      forecast: { count: fcFns.length, fns: fcFns.slice(0, 10) },
      at: { count: atFns.length, fns: atFns.slice(0, 15) },
      dsl: { count: dslFns.length, fns: dslFns.slice(0, 10) },
      positions: { count: posFns.length, fns: posFns.slice(0, 10) },
      aria: { count: ariaFns.length, fns: ariaFns.slice(0, 10) },
      nova: { count: novaFns.length, fns: novaFns.slice(0, 10) },
      aub: { count: aubFns.length, fns: aubFns.slice(0, 10) },
      teacher: { count: teacherFns.length, fns: teacherFns.slice(0, 10) },
      pm: { count: pmFns.length, fns: pmFns.slice(0, 10) },
      sr: { count: srFns.length, fns: srFns.slice(0, 10) },
      flow: { count: flowFns.length, fns: flowFns.slice(0, 10) },
      mtf: { count: mtfFns.length, fns: mtfFns.slice(0, 10) },
      adaptive: { count: adaptFns.length, fns: adaptFns.slice(0, 10) },
      pnl: { count: pnlFns.length, fns: pnlFns.slice(0, 10) },
      journal: { count: journalFns.length, fns: journalFns.slice(0, 10) },
      guards: { count: guardFns.length, fns: guardFns.slice(0, 10) },
      settings: { count: settingsFns.length, fns: settingsFns.slice(0, 10) },
      sync: { count: syncFns.length, fns: syncFns.slice(0, 10) },
      ws: { count: wsFns.length, fns: wsFns.slice(0, 10), wsObj: obj('ws'), wsReady: window.ws?.readyState },
      chart: { count: chartFns.length, fns: chartFns.slice(0, 10) },
      indicators: { count: indFns.length, fns: indFns.slice(0, 15) },
      // Key specific checks
      specific: {
        startApp: fn('startApp'),
        _brainCycle: fn('_brainCycle'),
        runBrain: fn('runBrain'),
        brainStep: fn('_bcStep') || fn('_brainStep'),
        _fcRender: fn('_fcRender'),
        _fcCalc: fn('_fcCalc'),
        _atCycle: fn('_atCycle'),
        _atPollOnce: fn('_atPollOnce'),
        _atCheckEntry: fn('_atCheckEntry'),
        initAria: fn('initAria') || fn('_arInit'),
        _ariaRender: fn('_ariaRender') || fn('_arRender'),
        initNova: fn('initNova') || fn('_novaInit'),
        novaLog: fn('novaLog'),
        initAUB: fn('initAUB'),
        _aubRender: fn('_aubRender'),
        initTeacher: fn('initTeacher') || fn('_teacherInit'),
        _pmInit: fn('_pmInit') || fn('initPM'),
        _srRenderList: fn('_srRenderList'),
        _ofRender: fn('_ofRender') || fn('renderOF'),
        _mtfRender: fn('_mtfRender') || fn('renderMTF'),
        _adaptiveRender: fn('_adaptiveRender'),
        _pnlLabRender: fn('_pnlLabRender') || fn('renderPnlLab'),
        addJournalRow: fn('addJournalRow'),
        runGuards: fn('runGuards') || fn('_guardsCheck'),
        _usScheduleSave: fn('_usScheduleSave'),
        initWS: fn('initWS') || fn('_wsInit'),
        switchGlobalMode: fn('switchGlobalMode'),
        _applyGlobalModeUI: fn('_applyGlobalModeUI'),
      }
    }
  })

  for (const [module, data] of Object.entries(logic)) {
    if (module === 'specific') continue
    const status = data.count > 0 ? `${data.count} functions` : 'NONE'
    console.log(`  ${module.padEnd(14)} ${status.padEnd(15)} ${data.fns ? data.fns.join(', ') : ''}`)
  }

  console.log('\n── SPECIFIC FUNCTION CHECKS ──')
  for (const [name, exists] of Object.entries(logic.specific)) {
    console.log(`  ${name.padEnd(24)} ${exists ? 'EXISTS' : 'MISSING'}`)
  }

  // ══ BRIDGE LOG ANALYSIS ══
  console.log('\n══ BRIDGE LOG ANALYSIS ══\n')

  const bridgeLogs = consoleLogs.filter(l => l.text.includes('[BRIDGE]') || l.text.includes('[ZEUS]') || l.text.includes('startApp'))
  bridgeLogs.forEach(l => console.log(`  [${l.type}] ${l.text.substring(0, 140)}`))

  // ══ ALL CONSOLE ERRORS ══
  console.log('\n══ ALL CONSOLE ERRORS ══\n')
  const errors = consoleLogs.filter(l => l.type === 'error')
  errors.forEach(l => console.log(`  ${l.text.substring(0, 200)}`))

  // ══ PAGE ERRORS ══
  console.log('\n══ PAGE ERRORS ══\n')
  pageErrors.forEach(e => console.log(`  ${e.substring(0, 200)}`))

  // ══ MODAL VERIFICATION ══
  console.log('\n══ MODAL VERIFICATION ══')
  const modalCheck = await page.evaluate(() => {
    // Check for .mover elements
    const movers = document.querySelectorAll('.mover')
    // Check for modal overlay components
    const results = []
    const ids = ['msettings', 'madmin', 'mnotifications', 'mcloud', 'malerts', 'mcharts', 'mliq', 'mllv', 'mzs', 'msr', 'oviPanel', 'mwelcome', 'cmdPalette', 'exposurePanel', 'dlogPanel']
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) {
        const s = getComputedStyle(el)
        results.push({ id, exists: true, display: s.display, visibility: s.visibility })
      } else {
        results.push({ id, exists: false })
      }
    }
    return { moverCount: movers.length, modals: results }
  })

  console.log(`  .mover count: ${modalCheck.moverCount}`)
  for (const m of modalCheck.modals) {
    const status = !m.exists ? 'NOT IN DOM' : m.display === 'none' ? 'HIDDEN (ready)' : `VISIBLE (${m.display})`
    console.log(`  ${m.id.padEnd(18)} ${status}`)
  }

  // ══ CSS LOADED CHECK ══
  console.log('\n══ CSS FILES LOADED ══')
  const cssFiles = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map(el => {
      if (el.tagName === 'LINK') return { type: 'link', href: el.href }
      return { type: 'style', length: el.textContent.length }
    })
  })
  cssFiles.forEach(f => {
    if (f.type === 'link') console.log(`  LINK: ${f.href}`)
    else console.log(`  STYLE: ${f.length} chars`)
  })

  // ══ WEBSOCKET DEEP CHECK ══
  console.log('\n══ WEBSOCKET DEEP CHECK ══')
  const wsDeep = await page.evaluate(() => {
    const results = {}
    // Check for various WS patterns
    results.windowWs = typeof window.ws !== 'undefined'
    results.windowWsState = window.ws?.readyState
    // Check if WS was attempted
    results._wsReady = window._wsReady || false
    results._wsUrl = window._wsUrl || null
    // Check Binance WS
    results.binanceWs = typeof window._binanceWs !== 'undefined'
    // Check for React-managed WS
    results.wsConnected = document.querySelector('[data-ws-status]')?.dataset?.wsStatus || null
    // Check status bar WS indicator
    const wsInd = document.getElementById('zsbWS')
    results.zsbWS = wsInd ? wsInd.textContent.trim() : null
    return results
  })
  for (const [k, v] of Object.entries(wsDeep)) {
    console.log(`  ${k.padEnd(20)} ${JSON.stringify(v)}`)
  }

  console.log('\n=== DEEP AUDIT COMPLETE ===')
  await browser.close()
}

run().catch(console.error)
