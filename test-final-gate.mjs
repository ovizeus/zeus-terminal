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
  console.log('║  FINAL GATE — WS + REAL-TIME + BRAIN + FLOW            ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  const pageCrashes = []
  const consoleErrors = []
  page.on('pageerror', e => pageCrashes.push(e.message || String(e)))
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })

  await page.setCookie({ name: 'zeus_token', value: makeToken(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' })
  await page.goto('http://localhost:5174/app/', { waitUntil: 'networkidle2', timeout: 60000 })

  // Wait for full init
  for (let i = 0; i < 80; i++) { await sleep(500); if (await page.evaluate(() => typeof window.startApp === 'function' && window.__ZEUS_INIT__)) break }
  await sleep(8000)

  const results = await page.evaluate(() => {
    const intervals = typeof window.Intervals !== 'undefined' && window.Intervals.list ? window.Intervals.list() : []
    const wl1 = Array.from(document.querySelectorAll('.wl-item')).slice(0, 3).map(e => e.textContent.substring(0, 20))
    return {
      // 1. zsbWS
      zsbWS: document.getElementById('zsbWS')?.textContent?.trim(),
      // 2. Watchlist snapshot
      wl: wl1,
      // 3. S.price
      price1: window.S?.price,
      // 4. Brain
      brainBadge: document.getElementById('brainStateBadge')?.textContent?.trim(),
      brainIntervals: intervals.filter(i => /brain/i.test(i)),
      // 5. Flow
      flowIntervals: intervals.filter(i => /of_/i.test(i)),
      ofHudExists: !!document.getElementById('of-hud'),
      // 6. Total intervals
      totalIntervals: intervals.length,
      // 7. Chart
      chartOk: !!window.mainChart && !!window.cSeries,
      // 8. Dock + panels
      dockOk: !!document.getElementById('zeus-dock'),
      panelCount: document.querySelectorAll('[data-panel-id]').length,
    }
  })

  await sleep(5000)

  const results2 = await page.evaluate(() => ({
    price2: window.S?.price,
    wl: Array.from(document.querySelectorAll('.wl-item')).slice(0, 3).map(e => e.textContent.substring(0, 20)),
  }))

  // Refresh
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 })
  for (let i = 0; i < 80; i++) { await sleep(500); if (await page.evaluate(() => typeof window.startApp === 'function')) break }
  await sleep(6000)

  const afterRefresh = await page.evaluate(() => ({
    zsbWS: document.getElementById('zsbWS')?.textContent?.trim(),
    chartOk: !!window.mainChart && !!window.cSeries,
    dockOk: !!document.getElementById('zeus-dock'),
    panelCount: document.querySelectorAll('[data-panel-id]').length,
    price: window.S?.price,
    intervals: typeof window.Intervals !== 'undefined' && window.Intervals.list ? window.Intervals.list().length : 0,
  }))

  const priceChanged = results.price1 !== results2.price2
  const wlChanged = results.wl.some((w, i) => w !== results2.wl[i])
  const relevantErrors = consoleErrors.filter(e => !e.includes('favicon') && !e.includes('404'))

  console.log('  CHECK                          RESULT')
  console.log('  ─────────────────────────────────────────')
  console.log(`  1. zsbWS = "WS"                ${results.zsbWS === 'WS' ? 'PASS ✓' : `FAIL ✗ ("${results.zsbWS}")`}`)
  console.log(`  2. Watchlist live updates       ${wlChanged ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`  3. Chart live candle updates    ${priceChanged ? 'PASS ✓' : 'FAIL ✗'} (${results.price1} → ${results2.price2})`)
  console.log(`  4. Brain runtime active         ${results.brainIntervals.length > 0 ? 'PASS ✓' : 'FAIL ✗'} (${results.brainIntervals.join(',')} | badge: ${results.brainBadge})`)
  console.log(`  5. Flow/OF live feed            ${results.flowIntervals.length > 0 ? 'PASS ✓' : 'FAIL ✗'} (${results.flowIntervals.length} intervals)`)
  console.log(`  6. Refresh survival             ${afterRefresh.chartOk && afterRefresh.dockOk && afterRefresh.panelCount === 15 ? 'PASS ✓' : 'FAIL ✗'}`)
  console.log(`  7. Zero page crashes            ${pageCrashes.length === 0 ? 'PASS ✓' : `FAIL ✗ (${pageCrashes.length})`}`)
  console.log(`  8. Zero new console errors      ${relevantErrors.length === 0 ? 'PASS ✓' : `FAIL ✗ (${relevantErrors.length})`}`)
  console.log(`  ─────────────────────────────────────────`)
  console.log(`  Total active intervals:         ${results.totalIntervals}`)
  console.log(`  Chart OK:                       ${results.chartOk}`)
  console.log(`  Dock + ${results.panelCount} panels:             OK`)
  console.log(`  After refresh — WS: "${afterRefresh.zsbWS}", intervals: ${afterRefresh.intervals}, panels: ${afterRefresh.panelCount}`)

  if (relevantErrors.length > 0) {
    console.log('\n  Console errors:')
    relevantErrors.forEach(e => console.log(`    ${e.substring(0, 150)}`))
  }
  if (pageCrashes.length > 0) {
    console.log('\n  Page crashes:')
    pageCrashes.forEach(e => console.log(`    ${e.substring(0, 150)}`))
  }

  const allPass = results.zsbWS === 'WS' && wlChanged && priceChanged &&
    results.brainIntervals.length > 0 && results.flowIntervals.length > 0 &&
    afterRefresh.chartOk && afterRefresh.panelCount === 15 &&
    pageCrashes.length === 0 && relevantErrors.length === 0

  console.log(`\n  ═══ GATE VERDICT: ${allPass ? 'ALL 8 CHECKS PASS ✓✓✓' : 'FAIL — see above'} ═══`)

  await browser.close()
}

run().catch(console.error)
