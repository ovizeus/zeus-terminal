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
  console.log('║  WS + REAL-TIME DATA VERIFICATION                      ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  // NOT headless — real browser so we can verify WS connectivity
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-web-security', '--allow-running-insecure-content']
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })

  const wsLogs = []
  const allErrors = []
  const pageCrashes = []
  page.on('console', m => {
    const t = m.text()
    if (t.includes('[WS]') || t.includes('WebSocket') || t.includes('ws/sync') || t.includes('wsK') || t.includes('wss://')) {
      wsLogs.push({ type: m.type(), text: t })
    }
    if (m.type() === 'error') allErrors.push(t)
  })
  page.on('pageerror', e => pageCrashes.push(e.message || String(e)))

  await page.setCookie({ name: 'zeus_token', value: makeToken(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' })

  console.log('[1] Loading app...')
  await page.goto('http://localhost:5174/app/', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(2000)

  // Wait for bridge
  let bridgeOk = false
  for (let i = 0; i < 80; i++) {
    await sleep(500)
    const ready = await page.evaluate(() =>
      document.querySelector('#zeus-dock') !== null &&
      typeof window.startApp === 'function'
    )
    if (ready) { bridgeOk = true; break }
  }
  console.log(`  Bridge loaded: ${bridgeOk}`)
  await sleep(5000) // extra wait for WS connections to establish

  // ══════════════════════════════════════════
  // TEST 1: WS STATUS
  // ══════════════════════════════════════════
  console.log('\n══ TEST 1: WEBSOCKET STATUS ══')

  const wsState1 = await page.evaluate(() => {
    const results = {}
    // WS Manager
    results.wsManagerExists = typeof window.WS !== 'undefined' && typeof window.WS.open === 'function'
    results.wsManagerList = typeof window.WS !== 'undefined' && window.WS.list ? window.WS.list() : []

    // Status bar WS indicator
    const wsEl = document.getElementById('zsbWS')
    results.zsbWS = wsEl ? wsEl.textContent.trim() : 'NOT FOUND'
    results.zsbWSClass = wsEl ? wsEl.className : ''

    // Internal sync WS
    results.syncWS = typeof window._ws !== 'undefined'

    // Check S object for live data
    results.sPrice = window.S ? window.S.price : null
    results.sSymbol = window.S ? window.S.symbol : null
    results.sLastUpdate = window.S ? window.S.lastUpdate : null

    // __wsGen
    results.wsGen = window.__wsGen

    return results
  })

  console.log(`  WS Manager exists:    ${wsState1.wsManagerExists}`)
  console.log(`  WS Manager active:    [${wsState1.wsManagerList.join(', ')}]`)
  console.log(`  zsbWS text:           "${wsState1.zsbWS}"`)
  console.log(`  zsbWS class:          "${wsState1.zsbWSClass}"`)
  console.log(`  Internal sync WS:     ${wsState1.syncWS}`)
  console.log(`  S.price:              ${wsState1.sPrice}`)
  console.log(`  S.symbol:             ${wsState1.sSymbol}`)
  console.log(`  __wsGen:              ${wsState1.wsGen}`)

  // Print all WS-related console logs
  console.log(`\n  WS Console Logs (${wsLogs.length}):`)
  wsLogs.forEach(l => console.log(`    [${l.type}] ${l.text.substring(0, 160)}`))

  // Wait 10 more seconds for WS to fully connect
  console.log('\n  Waiting 10s for WS connections...')
  await sleep(10000)

  const wsState2 = await page.evaluate(() => {
    return {
      wsManagerList: typeof window.WS !== 'undefined' && window.WS.list ? window.WS.list() : [],
      zsbWS: document.getElementById('zsbWS')?.textContent?.trim() || 'NOT FOUND',
      sPrice: window.S ? window.S.price : null,
    }
  })

  console.log(`  After 10s — WS active: [${wsState2.wsManagerList.join(', ')}]`)
  console.log(`  After 10s — zsbWS:     "${wsState2.zsbWS}"`)
  console.log(`  After 10s — S.price:   ${wsState2.sPrice}`)

  // New WS logs since first check
  const newWsLogs = wsLogs.slice(wsState1.wsManagerList.length > 0 ? 0 : wsLogs.length)
  if (newWsLogs.length > 0) {
    console.log(`  New WS logs:`)
    newWsLogs.forEach(l => console.log(`    [${l.type}] ${l.text.substring(0, 160)}`))
  }

  // ══════════════════════════════════════════
  // TEST 2: WATCHLIST LIVE UPDATES
  // ══════════════════════════════════════════
  console.log('\n══ TEST 2: WATCHLIST LIVE UPDATES ══')

  const wl1 = await page.evaluate(() => {
    const items = document.querySelectorAll('.wl-item')
    return Array.from(items).slice(0, 4).map(el => ({
      sym: el.querySelector('.wl-sym')?.textContent?.trim() || el.textContent.substring(0, 10),
      price: el.querySelector('.wl-price')?.textContent?.trim() || 'N/A',
    }))
  })
  console.log(`  Snapshot 1: ${wl1.map(w => `${w.sym}=${w.price}`).join(' | ')}`)

  await sleep(5000)

  const wl2 = await page.evaluate(() => {
    const items = document.querySelectorAll('.wl-item')
    return Array.from(items).slice(0, 4).map(el => ({
      sym: el.querySelector('.wl-sym')?.textContent?.trim() || el.textContent.substring(0, 10),
      price: el.querySelector('.wl-price')?.textContent?.trim() || 'N/A',
    }))
  })
  console.log(`  Snapshot 2: ${wl2.map(w => `${w.sym}=${w.price}`).join(' | ')}`)

  const wlChanged = wl1.some((w, i) => w.price !== wl2[i]?.price)
  console.log(`  Watchlist updated: ${wlChanged ? 'YES ✓' : 'NO ✗ (prices identical after 5s)'}`)

  // ══════════════════════════════════════════
  // TEST 3: CHART LIVE CANDLE UPDATES
  // ══════════════════════════════════════════
  console.log('\n══ TEST 3: CHART LIVE CANDLE UPDATES ══')

  const chart1 = await page.evaluate(() => {
    if (!window.cSeries) return { hasSeries: false }
    // Check last candle data
    const data = window._lastKlineData || null
    return {
      hasSeries: true,
      mainChart: !!window.mainChart,
      lastData: data ? JSON.stringify(data).substring(0, 100) : null,
      sPrice: window.S?.price,
      sLastTick: window.S?.lastTick || null,
    }
  })
  console.log(`  Chart series exists:  ${chart1.hasSeries}`)
  console.log(`  mainChart global:     ${chart1.mainChart}`)
  console.log(`  S.price at t=0:       ${chart1.sPrice}`)

  await sleep(8000)

  const chart2 = await page.evaluate(() => {
    return {
      sPrice: window.S?.price,
      sLastTick: window.S?.lastTick || null,
      sPriceChanged: window.S?.price !== window._prevTestPrice,
    }
  })
  console.log(`  S.price at t=8s:      ${chart2.sPrice}`)
  const priceChanged = chart1.sPrice !== chart2.sPrice
  console.log(`  Price changed:        ${priceChanged ? 'YES ✓' : 'NO ✗'}`)

  // ══════════════════════════════════════════
  // TEST 4: BRAIN/RUNTIME ACTIVITY
  // ══════════════════════════════════════════
  console.log('\n══ TEST 4: BRAIN/RUNTIME ACTIVITY ══')

  const brain = await page.evaluate(() => {
    return {
      brainState: typeof window._brainState !== 'undefined',
      brainSignal: window.S?.brainSignal || null,
      brainConf: window.S?.brainConf || null,
      brainRegime: window.S?.regime || null,
      znc: !!document.getElementById('zeusBrain'),
      zncVisible: (() => {
        const el = document.getElementById('zeusBrain')
        if (!el) return false
        const s = getComputedStyle(el)
        return s.display !== 'none' && s.visibility !== 'hidden'
      })(),
      brainBodyText: document.querySelector('.znc-body')?.textContent?.substring(0, 100) || null,
      brainSrc: document.getElementById('znc-src')?.textContent?.trim() || null,
    }
  })
  console.log(`  Brain state exists:   ${brain.brainState}`)
  console.log(`  Brain signal:         ${brain.brainSignal}`)
  console.log(`  Brain confidence:     ${brain.brainConf}`)
  console.log(`  Brain regime:         ${brain.brainRegime}`)
  console.log(`  Brain cockpit visible:${brain.zncVisible}`)
  console.log(`  Brain source:         ${brain.brainSrc}`)

  // ══════════════════════════════════════════
  // TEST 5: FLOW/ORDERFLOW
  // ══════════════════════════════════════════
  console.log('\n══ TEST 5: FLOW/ORDERFLOW ══')

  const flow = await page.evaluate(() => {
    return {
      _ofWS: typeof window._ofWS !== 'undefined',
      flowFn: typeof window.updateFlowEngine === 'function',
      ofHud: !!document.getElementById('of-hud'),
      ofHudText: document.getElementById('of-hud')?.textContent?.substring(0, 80) || null,
    }
  })
  console.log(`  OrderFlow WS:         ${flow._ofWS}`)
  console.log(`  updateFlowEngine fn:  ${flow.flowFn}`)
  console.log(`  OF HUD exists:        ${flow.ofHud}`)
  console.log(`  OF HUD text:          ${flow.ofHudText}`)

  // ══════════════════════════════════════════
  // TEST 6: REFRESH SURVIVAL
  // ══════════════════════════════════════════
  console.log('\n══ TEST 6: REFRESH SURVIVAL ══')

  const preRefreshErrors = [...allErrors]
  const preRefreshCrashes = [...pageCrashes]

  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(2000)

  // Wait for bridge again
  for (let i = 0; i < 80; i++) {
    await sleep(500)
    const ready = await page.evaluate(() => typeof window.startApp === 'function')
    if (ready) break
  }
  await sleep(6000)

  const postRefresh = await page.evaluate(() => {
    return {
      zsbWS: document.getElementById('zsbWS')?.textContent?.trim() || 'NOT FOUND',
      wsManagerList: typeof window.WS !== 'undefined' && window.WS.list ? window.WS.list() : [],
      sPrice: window.S?.price,
      chartOk: !!window.mainChart && !!window.cSeries,
      dockOk: !!document.getElementById('zeus-dock'),
      brainOk: !!document.getElementById('zeusBrain'),
      panelCount: document.querySelectorAll('[data-panel-id]').length,
    }
  })

  console.log(`  After refresh:`)
  console.log(`    zsbWS:          "${postRefresh.zsbWS}"`)
  console.log(`    WS active:      [${postRefresh.wsManagerList.join(', ')}]`)
  console.log(`    S.price:        ${postRefresh.sPrice}`)
  console.log(`    Chart OK:       ${postRefresh.chartOk}`)
  console.log(`    Dock OK:        ${postRefresh.dockOk}`)
  console.log(`    Brain OK:       ${postRefresh.brainOk}`)
  console.log(`    Panel count:    ${postRefresh.panelCount}`)

  // ══════════════════════════════════════════
  // TEST 7: CONSOLE ERRORS
  // ══════════════════════════════════════════
  console.log('\n══ TEST 7: CONSOLE ERRORS ══')

  const newErrors = allErrors.filter(e => !preRefreshErrors.includes(e))
  const relevantErrors = allErrors.filter(e => !e.includes('favicon') && !e.includes('hot-update'))

  console.log(`  Total console errors: ${allErrors.length}`)
  console.log(`  Page crashes: ${pageCrashes.length}`)
  console.log(`  Errors after refresh: ${newErrors.length}`)

  if (relevantErrors.length > 0) {
    console.log('  Error list:')
    relevantErrors.slice(0, 15).forEach(e => console.log(`    ${e.substring(0, 160)}`))
  }
  if (pageCrashes.length > 0) {
    console.log('  Crashes:')
    pageCrashes.forEach(e => console.log(`    ${e.substring(0, 160)}`))
  }

  // ══════════════════════════════════════════
  // FINAL VERDICT
  // ══════════════════════════════════════════
  console.log('\n╔══════════════════════════════════════════════════════════╗')
  console.log('║  VERDICT                                                 ║')
  console.log('╚══════════════════════════════════════════════════════════╝')

  const wsConnected = wsState2.zsbWS === 'WS' || wsState2.wsManagerList.length > 0
  const wlLive = wlChanged
  const chartLive = priceChanged
  const brainActive = brain.brainSignal || brain.brainConf || brain.brainState
  const refreshOk = postRefresh.chartOk && postRefresh.dockOk && postRefresh.panelCount === 15
  const noNewErrors = pageCrashes.length === 0

  console.log(`  zsbWS connected:      ${wsConnected ? 'PASS ✓' : 'FAIL ✗'}  (${wsState2.zsbWS})`)
  console.log(`  Watchlist live:       ${wlLive ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`  Chart live candles:   ${chartLive ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`  Brain activity:       ${brainActive ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`  Flow/OF feed:         ${flow._ofWS ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`  Refresh survival:     ${refreshOk ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`  Zero crashes:         ${noNewErrors ? 'PASS ✓' : 'FAIL ✗'}`)

  const allPass = wsConnected && wlLive && chartLive && brainActive && refreshOk && noNewErrors
  console.log(`\n  OVERALL: ${allPass ? 'ALL PASS ✓✓✓' : 'HAS FAILURES — see above'}`)

  console.log('\n=== WS VERIFICATION COMPLETE ===')
  await browser.close()
}

run().catch(console.error)
