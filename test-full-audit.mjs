import puppeteer from 'puppeteer-core'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = ms => new Promise(r => setTimeout(r, ms))

function makeToken() {
  const jwt = require('jsonwebtoken')
  return jwt.sign({ id: 1, email: 'test@test.com', role: 'admin', tokenVersion: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' })
}

const PANELS = [
  { dock: 'autotrade', name: 'AutoTrade', selectors: ['#atPanel', '.at-body', '.at-sep'] },
  { dock: 'manual-trade', name: 'Manual Trade', selectors: ['.trade-panel', '#panelDemo', '#demoBalance'] },
  { dock: 'dsl', name: 'DSL', selectors: ['#dslZone', '.dsl-zone'] },
  { dock: 'ares', name: 'ARES', selectors: ['#ares-strip', '#ares-panel', '#ares-core-svg', '#ares-stats-row'] },
  { dock: 'postmortem', name: 'Post-Mortem', selectors: ['#pm-strip', '#pm-panel-body'] },
  { dock: 'pnllab', name: 'PnL Lab', selectors: ['#pnl-lab-strip', '#pnlLabBody'] },
  { dock: 'aria', name: 'ARIA', selectors: ['#aria-strip', '#aria-panel', '.aria-cols'] },
  { dock: 'nova', name: 'Nova', selectors: ['#nova-strip', '#nova-panel', '#nova-log'] },
  { dock: 'adaptive', name: 'Adaptive', selectors: ['#adaptive-sec', '#adaptiveToggleBtn', '#adaptive-bucket-table'] },
  { dock: 'flow', name: 'Flow', selectors: ['#flow-panel', '#of-hud', '#flow-panel-body'] },
  { dock: 'mtf', name: 'MTF', selectors: ['#mtf-strip-panel', '#mtf-regime', '#mtf-score-fill'] },
  { dock: 'teacher', name: 'Teacher', selectors: ['#teacher-strip', '#teacher-panel-body', '#teacher-cap-hero', '#teacher-tabs'] },
  { dock: 'sigreg', name: 'Signals', selectors: ['#sr-strip', '#sr-sec', '#sr-list'] },
  { dock: 'activity', name: 'Activity', selectors: ['#actfeed-strip', '#actfeedList'] },
  { dock: 'aub', name: 'AUB (Alien)', selectors: ['#aub', '#aub-body', '.aub-card'] },
]

async function run() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  ZEUS TERMINAL — COMPLETE STATE AUDIT                   ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-web-security'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })

  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message || String(e)))
  const consoleLogs = []
  page.on('console', m => consoleLogs.push({ type: m.type(), text: m.text() }))
  const networkErrors = []
  page.on('requestfailed', req => {
    if (!req.url().includes('hot-update') && !req.url().includes('@vite'))
      networkErrors.push({ url: req.url(), err: req.failure()?.errorText || 'unknown' })
  })

  await page.setCookie({ name: 'zeus_token', value: makeToken(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' })
  console.log('[1/8] Loading app...')
  await page.goto('http://localhost:5174/app/', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(2000)

  // Wait for bridge
  let bridgeReady = false
  for (let i = 0; i < 80; i++) {
    await sleep(500)
    if (consoleLogs.some(l => l.text.includes('startApp() completed'))) { bridgeReady = true; break }
  }
  await sleep(3000)
  console.log(`  Bridge ready: ${bridgeReady}`)

  // ══════════════════════════════════════════
  // PHASE 2 — GLOBAL APP STATUS
  // ══════════════════════════════════════════
  console.log('\n══ PHASE 2: GLOBAL APP STATUS ══')

  const globalState = await page.evaluate(() => {
    const exists = (sel) => !!document.querySelector(sel)
    const visible = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return false
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0
    }
    const text = (sel) => {
      const el = document.querySelector(sel)
      return el ? el.textContent.trim().substring(0, 80) : null
    }

    return {
      // Auth — if we see the main app, auth passed
      auth: exists('.zr-panels') || exists('main'),
      // Header
      header: { exists: exists('#zsb') || exists('.zsb'), visible: visible('#zsb') || visible('.zsb'), text: text('#zsb') || text('.zsb') },
      // Status bar
      statusBar: { exists: exists('.zsb-items') || exists('#zsbCoin'), visible: visible('.zsb-items') || visible('#zsbCoin'), coinText: text('#zsbCoin') },
      // Mode bar
      modeBar: { exists: exists('#zeus-mode-bar') || exists('.zmb'), visible: visible('#zeus-mode-bar') || visible('.zmb'), text: text('#zeus-mode-bar') || text('.zmb') },
      // Watchlist
      watchlist: { exists: exists('#wlbar') || exists('.wl-bar'), visible: visible('#wlbar') || visible('.wl-bar') },
      // Chart
      chart: {
        container: exists('#mc'),
        containerVisible: visible('#mc'),
        canvas: exists('#mc canvas') || exists('.tv-lightweight-charts'),
        canvasVisible: visible('#mc canvas') || visible('.tv-lightweight-charts'),
        chartControls: exists('.chart-controls') || exists('.cc-bar'),
      },
      // Dock
      dock: {
        exists: exists('#zeus-dock') || exists('.zd-bar'),
        visible: visible('#zeus-dock') || visible('.zd-bar'),
        iconCount: document.querySelectorAll('.zd-item').length,
      },
      // Zeus groups (panel container)
      zeusGroups: exists('#zeus-groups'),
      // Brain
      brain: {
        exists: exists('#brainCore') || exists('.brain-cockpit'),
        visible: visible('#brainCore') || visible('.brain-cockpit'),
      },
      // Analysis sections
      analysis: { exists: exists('.analysis-sections') || exists('#analysis'), visible: visible('.analysis-sections') || visible('#analysis') },
      // Footer
      footer: { exists: exists('.bot') || exists('footer'), visible: visible('.bot') || visible('footer') },
      // WebSocket
      wsLogs: (() => {
        const wsLogs = []
        // Check if WS object exists
        if (window.ws) wsLogs.push('ws object exists')
        if (window._wsReady) wsLogs.push('_wsReady=true')
        return wsLogs
      })(),
      // Globals set by old JS
      globals: {
        S: typeof window.S !== 'undefined',
        AT: typeof window.AT !== 'undefined',
        TP: typeof window.TP !== 'undefined',
        _resolvedEnv: window._resolvedEnv || null,
        _exchangeMode: window._exchangeMode || null,
        _apiConfigured: window._apiConfigured || null,
        serverMode: (typeof window.AT !== 'undefined' && window.AT._serverMode) || null,
      },
    }
  })

  // Print global status
  const gs = globalState
  const status = (ok) => ok ? 'WORKING' : 'BROKEN'
  const statusV = (e, v) => e && v ? 'WORKING' : e && !v ? 'PARTIAL (exists but hidden)' : 'BROKEN'

  console.log(`  1.  Auth/login:           ${gs.auth ? 'WORKING' : 'BROKEN'}`)
  console.log(`  2.  Header:               ${statusV(gs.header.exists, gs.header.visible)}`)
  console.log(`  3.  Status bar:           ${statusV(gs.statusBar.exists, gs.statusBar.visible)} — coin: ${gs.statusBar.coinText || 'N/A'}`)
  console.log(`  4.  Mode bar:             ${statusV(gs.modeBar.exists, gs.modeBar.visible)}`)
  console.log(`  5.  Watchlist:            ${statusV(gs.watchlist.exists, gs.watchlist.visible)}`)
  console.log(`  6.  Chart container:      ${statusV(gs.chart.container, gs.chart.containerVisible)}`)
  console.log(`  6b. Chart canvas:         ${statusV(gs.chart.canvas, gs.chart.canvasVisible)}`)
  console.log(`  6c. Chart controls:       ${gs.chart.chartControls ? 'WORKING' : 'BROKEN'}`)
  console.log(`  7.  Dock:                 ${statusV(gs.dock.exists, gs.dock.visible)} — ${gs.dock.iconCount} icons`)
  console.log(`  8.  Zeus groups:          ${gs.zeusGroups ? 'WORKING' : 'BROKEN'}`)
  console.log(`  9.  Brain:                ${statusV(gs.brain.exists, gs.brain.visible)}`)
  console.log(`  10. Analysis sections:    ${statusV(gs.analysis.exists, gs.analysis.visible)}`)
  console.log(`  11. Footer:               ${statusV(gs.footer.exists, gs.footer.visible)}`)
  console.log(`  --- Globals ---`)
  console.log(`  S (market data):          ${gs.globals.S ? 'YES' : 'NO'}`)
  console.log(`  AT (autotrade):           ${gs.globals.AT ? 'YES' : 'NO'}`)
  console.log(`  TP (positions):           ${gs.globals.TP ? 'YES' : 'NO'}`)
  console.log(`  _resolvedEnv:             ${gs.globals._resolvedEnv || 'NOT SET'}`)
  console.log(`  _exchangeMode:            ${gs.globals._exchangeMode || 'NOT SET'}`)
  console.log(`  _apiConfigured:           ${gs.globals._apiConfigured || 'NOT SET'}`)
  console.log(`  AT._serverMode:           ${gs.globals.serverMode || 'NOT SET'}`)

  // Check modals
  console.log('\n  --- Modals ---')
  const modalIds = ['notifications', 'cloud', 'alerts', 'charts', 'liq', 'llv', 'supremus', 'sr', 'settings', 'ovi', 'welcome', 'admin', 'cmdpalette', 'exposure', 'decisionlog']
  for (const mid of modalIds) {
    const mExists = await page.evaluate((id) => {
      // Check if there's a React modal component for this id
      const moverSel = `.mover[data-modal="${id}"]`
      const reactModal = document.querySelector(moverSel)
      // Also check generic mover classes
      return { exists: !!reactModal, generic: document.querySelectorAll('.mover').length }
    }, mid)
  }
  // Count total modals
  const totalMovers = await page.evaluate(() => document.querySelectorAll('.mover').length)
  console.log(`  Total .mover elements:    ${totalMovers}`)

  // WebSocket check
  console.log('\n  --- WebSocket/Data Feed ---')
  const wsState = await page.evaluate(() => {
    const logs = []
    if (window.ws) {
      logs.push(`ws.readyState: ${window.ws.readyState} (0=CONNECTING, 1=OPEN, 3=CLOSED)`)
    } else {
      logs.push('No window.ws found')
    }
    if (window.S && window.S.price) logs.push(`S.price: ${window.S.price}`)
    if (window.S && window.S.symbol) logs.push(`S.symbol: ${window.S.symbol}`)
    // Check if any prices are visible
    const priceEl = document.getElementById('zsbPrice') || document.querySelector('.zsb-price')
    if (priceEl) logs.push(`Price display: ${priceEl.textContent.trim().substring(0, 30)}`)
    return logs
  })
  wsState.forEach(l => console.log(`  ${l}`))

  // Health check
  console.log('\n  --- Health/Sync ---')
  const healthLogs = consoleLogs.filter(l => l.text.includes('health') || l.text.includes('sync') || l.text.includes('BRIDGE') || l.text.includes('startApp'))
  healthLogs.slice(0, 15).forEach(l => console.log(`  [${l.type}] ${l.text.substring(0, 120)}`))

  // ══════════════════════════════════════════
  // PHASE 3 — PANEL-BY-PANEL AUDIT
  // ══════════════════════════════════════════
  console.log('\n══ PHASE 3: PANEL-BY-PANEL AUDIT ══')

  const panelResults = []

  for (const panel of PANELS) {
    // Click dock icon
    const dockSel = `.zd-item[data-dock="${panel.dock}"]`
    const dockExists = await page.$(dockSel)
    if (!dockExists) {
      console.log(`  ${panel.name}: DOCK ICON NOT FOUND`)
      panelResults.push({ ...panel, opens: false, visible: false, populated: false, shellOnly: true, selectorsFound: 0, selectorsTotal: panel.selectors.length, errors: false, classification: 'BROKEN' })
      continue
    }

    await page.click(dockSel)
    await sleep(800)

    const state = await page.evaluate((p) => {
      const wrapper = document.querySelector(`[data-panel-id="${p.dock}"]`)
      if (!wrapper) return { wrapperExists: false }

      const wStyle = getComputedStyle(wrapper)
      const wRect = wrapper.getBoundingClientRect()
      const opens = wStyle.display !== 'none' && wRect.width > 0 && wRect.height > 0

      const selectorResults = {}
      let found = 0, visibleCount = 0, contentCount = 0
      for (const sel of p.selectors) {
        const el = wrapper.querySelector(sel) || document.querySelector(sel)
        if (!el) { selectorResults[sel] = { exists: false }; continue }
        found++
        const s = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        const vis = s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0
        const hasContent = el.innerHTML.trim().length > 10
        if (vis) visibleCount++
        if (hasContent) contentCount++
        selectorResults[sel] = { exists: true, visible: vis, hasContent, w: Math.round(r.width), h: Math.round(r.height) }
      }

      // Check if old JS populated — look for dynamic content
      const allText = wrapper.querySelectorAll('*')
      let visTextEls = 0
      allText.forEach(el => {
        const s = getComputedStyle(el)
        if (s.display !== 'none' && s.visibility !== 'hidden' && (el.textContent || '').trim().length > 0) visTextEls++
      })

      return {
        wrapperExists: true,
        opens,
        wrapperW: Math.round(wRect.width),
        wrapperH: Math.round(wRect.height),
        selectorResults,
        found,
        visibleCount,
        contentCount,
        visTextEls,
      }
    }, panel)

    if (!state.wrapperExists) {
      console.log(`  ${panel.name}: WRAPPER NOT FOUND`)
      panelResults.push({ ...panel, opens: false, visible: false, populated: false, shellOnly: true, selectorsFound: 0, selectorsTotal: panel.selectors.length, errors: false, classification: 'BROKEN' })
    } else {
      const populated = state.visTextEls >= 3
      const shellOnly = state.visTextEls < 3 && state.opens
      let classification = 'BROKEN'
      if (state.opens && state.visibleCount > 0 && populated) classification = 'WORKING'
      else if (state.opens && state.visibleCount > 0 && !populated) classification = 'SHELL ONLY'
      else if (state.opens && state.visibleCount === 0) classification = 'PARTIAL'
      else if (!state.opens) classification = 'BROKEN'

      const selDetail = Object.entries(state.selectorResults).map(([sel, info]) => {
        if (!info.exists) return `${sel}: MISSING`
        if (!info.visible) return `${sel}: HIDDEN`
        return `${sel}: OK ${info.w}x${info.h}${info.hasContent ? ' +content' : ''}`
      }).join(' | ')

      console.log(`  ${panel.name.padEnd(15)} opens:${state.opens ? 'Y' : 'N'} vis:${state.visibleCount}/${panel.selectors.length} txt:${state.visTextEls} → ${classification}`)
      console.log(`    ${selDetail}`)

      panelResults.push({
        ...panel,
        opens: state.opens,
        visible: state.visibleCount > 0,
        populated,
        shellOnly,
        selectorsFound: state.found,
        selectorsVisible: state.visibleCount,
        selectorsTotal: panel.selectors.length,
        visTextEls: state.visTextEls,
        classification,
      })
    }

    // Close panel
    const backBtn = await page.$('.zpv-back')
    if (backBtn) {
      await backBtn.click()
      await sleep(300)
    }
  }

  // ══════════════════════════════════════════
  // PHASE 4 — LOGIC MODULE AUDIT
  // ══════════════════════════════════════════
  console.log('\n══ PHASE 4: LOGIC MODULE AUDIT ══')

  const logicState = await page.evaluate(() => {
    const check = (name) => typeof window[name] !== 'undefined'
    const checkFn = (name) => typeof window[name] === 'function'
    return {
      // Chart
      chartLib: !!document.querySelector('.tv-lightweight-charts') || !!document.querySelector('#mc canvas'),
      // Brain
      brainCycle: checkFn('_brainCycle') || checkFn('runBrain'),
      brainData: check('_brainState') || (check('S') && window.S.brainSignal !== undefined),
      // Forecast
      forecast: check('_fcState') || checkFn('_fcRender'),
      // AT engine
      atEngine: check('AT') && checkFn('_atCycle'),
      atPoll: checkFn('_atPollOnce'),
      // DSL
      dslEngine: checkFn('runDSLBrain'),
      dslRender: checkFn('_dslRenderSummary') || checkFn('_dslUpdateView'),
      // Manual trade
      switchGlobalMode: checkFn('switchGlobalMode'),
      _applyGlobalModeUI: checkFn('_applyGlobalModeUI'),
      placeDemoOrder: checkFn('placeDemoOrder') || checkFn('_execDemoTrade'),
      // Positions
      positionsTracker: check('TP') && (typeof window.TP === 'object'),
      renderPositions: checkFn('renderDemoPositions') || checkFn('_renderOpenPositions'),
      // ARIA/Nova
      ariaInit: checkFn('initAria') || checkFn('_ariaInit'),
      ariaRender: checkFn('renderAria') || checkFn('_ariaRender'),
      novaInit: checkFn('initNova') || checkFn('_novaInit'),
      novaLog: checkFn('novaLog'),
      // AUB
      aubInit: checkFn('initAUB') || checkFn('_aubInit'),
      aubRender: checkFn('_aubRender') || checkFn('refreshAUB'),
      // Teacher
      teacherInit: checkFn('initTeacher') || checkFn('_teacherInit'),
      // PostMortem
      pmInit: checkFn('initPostMortem') || checkFn('_pmInit'),
      // Signal Registry
      srInit: checkFn('_srInit') || checkFn('initSigReg'),
      srRender: checkFn('_srRenderList'),
      // Flow/Orderflow
      flowInit: checkFn('initFlow') || checkFn('_flowInit'),
      flowRender: checkFn('renderFlow') || checkFn('_ofRender'),
      // MTF
      mtfRender: checkFn('_mtfRender') || checkFn('renderMTF'),
      // Adaptive
      adaptiveRender: checkFn('_adaptiveRender') || checkFn('renderAdaptive'),
      // PnL Lab
      pnlLabRender: checkFn('renderPnlLab') || checkFn('_pnlLabRender'),
      // Journal
      journal: checkFn('addJournalRow') || checkFn('_jlRender'),
      // Risk/guards
      guards: checkFn('_guardsCheck') || checkFn('runGuards'),
      // Settings persistence
      settingsSave: checkFn('_usScheduleSave') || checkFn('saveUserSettings'),
      settingsLoad: checkFn('loadUserSettings') || checkFn('_usLoad'),
      // Sync/restore
      stateSync: checkFn('_atPollOnce') || checkFn('_syncState'),
      // Indicators
      indicators: {
        ema: checkFn('calcEMA') || check('_ema50'),
        supertrend: checkFn('calcSuperTrend') || check('_stSeries'),
        rsi: checkFn('calcRSI'),
        macd: checkFn('calcMACD'),
        atr: checkFn('calcATR'),
        obv: checkFn('calcOBV'),
        mfi: checkFn('calcMFI'),
        bbands: checkFn('calcBBands') || checkFn('calcBollingerBands'),
      },
      // Chart bridge
      chartBridge: check('_chartInstance') || check('mainChart'),
      chartSeries: check('_candleSeries') || check('candleSeries'),
      // WS
      ws: check('ws'),
      wsReady: window.ws && window.ws.readyState === 1,
    }
  })

  const logicRows = [
    ['Chart render/update',     logicState.chartLib,        'bridge', !logicState.chartLib],
    ['Chart bridge (old→new)',  logicState.chartBridge,     'bridge', false],
    ['Indicators/subcharts',    Object.values(logicState.indicators).some(Boolean), 'bridge', false],
    ['Brain cycle',             logicState.brainCycle,      'bridge', !logicState.brainCycle],
    ['Forecast',                logicState.forecast,        'bridge', !logicState.forecast],
    ['AutoTrade engine',        logicState.atEngine,        'bridge', !logicState.atEngine],
    ['AT poll/sync',            logicState.atPoll,          'bridge', false],
    ['DSL engine',              logicState.dslEngine,       'bridge', !logicState.dslEngine],
    ['Manual trade exec',       logicState.placeDemoOrder,  'bridge', !logicState.placeDemoOrder],
    ['Mode switch UI',          logicState._applyGlobalModeUI, 'bridge', false],
    ['Positions tracking',      logicState.positionsTracker,'bridge', !logicState.positionsTracker],
    ['ARIA',                    logicState.ariaRender,      'bridge', !logicState.ariaRender],
    ['Nova',                    logicState.novaLog,         'bridge', !logicState.novaLog],
    ['AUB',                     logicState.aubRender,       'bridge', !logicState.aubRender],
    ['Teacher',                 logicState.teacherInit,     'bridge', !logicState.teacherInit],
    ['PostMortem',              logicState.pmInit,           'bridge', !logicState.pmInit],
    ['Signal Registry',         logicState.srRender,        'bridge', !logicState.srRender],
    ['Flow/Orderflow',          logicState.flowRender,      'bridge', !logicState.flowRender],
    ['MTF',                     logicState.mtfRender,       'bridge', !logicState.mtfRender],
    ['Adaptive',                logicState.adaptiveRender,  'bridge', !logicState.adaptiveRender],
    ['PnL Lab',                 logicState.pnlLabRender,    'bridge', !logicState.pnlLabRender],
    ['Journal',                 logicState.journal,         'bridge', !logicState.journal],
    ['Risk/guards',             logicState.guards,          'bridge', !logicState.guards],
    ['Settings save/load',      logicState.settingsSave,    'bridge', !logicState.settingsSave],
    ['State sync/restore',      logicState.stateSync,       'bridge', false],
    ['WebSocket feed',          logicState.wsReady,         'bridge', !logicState.ws],
  ]

  for (const [name, running, type, shell] of logicRows) {
    const runStr = running ? 'YES' : 'NO '
    const shellStr = shell ? 'SHELL' : '     '
    const confidence = running ? 'HIGH' : (shell ? 'LOW' : 'MEDIUM')
    console.log(`  ${name.padEnd(24)} running:${runStr}  ${type}  ${shellStr}  confidence:${confidence}`)
  }

  // Indicators detail
  console.log('\n  --- Indicator Functions ---')
  for (const [name, exists] of Object.entries(logicState.indicators)) {
    console.log(`    ${name.padEnd(12)} ${exists ? 'FOUND' : 'MISSING'}`)
  }

  // ══════════════════════════════════════════
  // PHASE 5 — CSS/UI PARITY
  // ══════════════════════════════════════════
  console.log('\n══ PHASE 5: CSS/UI PARITY ══')

  const cssState = await page.evaluate(() => {
    const issues = []

    // Check dock icons visible
    const dockIcons = document.querySelectorAll('.zd-item')
    let visIcons = 0
    dockIcons.forEach(i => {
      const s = getComputedStyle(i)
      if (s.display !== 'none' && s.visibility !== 'hidden') visIcons++
    })
    if (visIcons < 15) issues.push(`Dock: only ${visIcons}/16 icons visible`)

    // Check if old main.css loaded
    const links = document.querySelectorAll('link[rel="stylesheet"]')
    const cssFiles = Array.from(links).map(l => l.href)
    const hasMainCss = cssFiles.some(f => f.includes('main.css'))
    const hasThemes = cssFiles.some(f => f.includes('themes.css'))
    if (!hasMainCss) issues.push('main.css NOT loaded')
    if (!hasThemes) issues.push('themes.css NOT loaded')

    // Check #zeus-groups children hidden when no panel active
    const zg = document.getElementById('zeus-groups')
    if (zg) {
      const panels = zg.querySelectorAll('[data-panel-id]')
      let hiddenCount = 0
      panels.forEach(p => {
        const s = getComputedStyle(p)
        if (s.display === 'none' || p.classList.contains('zpv-hidden-panel')) hiddenCount++
      })
      if (hiddenCount !== panels.length) issues.push(`Zeus-groups: ${panels.length - hiddenCount}/${panels.length} panels unexpectedly visible on home`)
    }

    // Check modal z-index layering
    const movers = document.querySelectorAll('.mover')
    movers.forEach(m => {
      const s = getComputedStyle(m)
      if (parseInt(s.zIndex) < 900) issues.push(`Modal ${m.dataset.modal || 'unknown'} has low z-index: ${s.zIndex}`)
    })

    // Check font
    const body = getComputedStyle(document.body)
    const fontOk = body.fontFamily.includes('Share Tech Mono')

    return {
      dockIconsVisible: visIcons,
      dockIconsTotal: dockIcons.length,
      mainCssLoaded: hasMainCss,
      themesCssLoaded: hasThemes,
      fontCorrect: fontOk,
      issues,
    }
  })

  console.log(`  Dock icons: ${cssState.dockIconsVisible}/${cssState.dockIconsTotal}`)
  console.log(`  main.css loaded: ${cssState.mainCssLoaded}`)
  console.log(`  themes.css loaded: ${cssState.themesCssLoaded}`)
  console.log(`  Font correct: ${cssState.fontCorrect}`)
  if (cssState.issues.length > 0) {
    console.log('  Issues:')
    cssState.issues.forEach(i => console.log(`    - ${i}`))
  } else {
    console.log('  No CSS issues detected')
  }

  // ══════════════════════════════════════════
  // PHASE 6 — ERRORS/WARNINGS
  // ══════════════════════════════════════════
  console.log('\n══ PHASE 6: ERRORS/WARNINGS ══')

  const criticalErrors = pageErrors.filter(e => !e.includes('ResizeObserver') && !e.includes('Non-Error'))
  const devWarnings = consoleLogs.filter(l => l.type === 'warning')
  const jsErrors = consoleLogs.filter(l => l.type === 'error')

  console.log(`\n  A. PAGE ERRORS (${criticalErrors.length}):`)
  criticalErrors.slice(0, 20).forEach(e => console.log(`    ${e.substring(0, 150)}`))

  console.log(`\n  B. CONSOLE ERRORS (${jsErrors.length}):`)
  jsErrors.slice(0, 20).forEach(l => console.log(`    ${l.text.substring(0, 150)}`))

  console.log(`\n  C. CONSOLE WARNINGS (${devWarnings.length}):`)
  devWarnings.slice(0, 10).forEach(l => console.log(`    ${l.text.substring(0, 150)}`))

  console.log(`\n  D. NETWORK ERRORS (${networkErrors.length}):`)
  networkErrors.slice(0, 10).forEach(n => console.log(`    ${n.url.substring(0, 80)} → ${n.err}`))

  // 404s
  const notFoundLogs = consoleLogs.filter(l => l.text.includes('404') || l.text.includes('not found'))
  console.log(`\n  E. 404s (${notFoundLogs.length}):`)
  notFoundLogs.slice(0, 10).forEach(l => console.log(`    ${l.text.substring(0, 150)}`))

  // ══════════════════════════════════════════
  // PHASE 7 — SUMMARY TABLES
  // ══════════════════════════════════════════
  console.log('\n\n╔══════════════════════════════════════════════════════════╗')
  console.log('║  SUMMARY                                                 ║')
  console.log('╚══════════════════════════════════════════════════════════╝')

  console.log('\n── PANEL MATRIX ──')
  console.log('Panel           | opens | visible | populated | selectors     | classification')
  console.log('─'.repeat(85))
  for (const r of panelResults) {
    const opens = r.opens ? ' YES ' : ' NO  '
    const vis = r.visible ? '  YES  ' : '  NO   '
    const pop = r.populated ? '   YES   ' : '   NO    '
    const sel = `${r.selectorsVisible || 0}/${r.selectorsTotal}`.padEnd(13)
    console.log(`${r.name.padEnd(16)}|${opens}|${vis}|${pop}| ${sel} | ${r.classification}`)
  }

  const working = panelResults.filter(r => r.classification === 'WORKING').length
  const partial = panelResults.filter(r => r.classification === 'PARTIAL').length
  const shell = panelResults.filter(r => r.classification === 'SHELL ONLY').length
  const broken = panelResults.filter(r => r.classification === 'BROKEN').length

  console.log(`\nPANELS: ${working} WORKING / ${partial} PARTIAL / ${shell} SHELL / ${broken} BROKEN out of ${panelResults.length}`)

  // Logic summary
  const logicWorking = logicRows.filter(r => r[1]).length
  const logicTotal = logicRows.length
  console.log(`LOGIC MODULES: ${logicWorking}/${logicTotal} running in runtime`)

  console.log(`\nPAGE ERRORS: ${criticalErrors.length}`)
  console.log(`CONSOLE ERRORS: ${jsErrors.length}`)
  console.log(`NETWORK ERRORS: ${networkErrors.length}`)

  console.log('\n=== AUDIT COMPLETE ===')
  await browser.close()
}

run().catch(console.error)
