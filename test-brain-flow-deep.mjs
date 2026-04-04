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
  console.log('══ BRAIN + FLOW DEEP CHECK ══\n')
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  const logs = []
  page.on('console', m => logs.push({ type: m.type(), text: m.text() }))

  await page.setCookie({ name: 'zeus_token', value: makeToken(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' })
  await page.goto('http://localhost:5174/app/', { waitUntil: 'networkidle2', timeout: 60000 })

  // Wait for bridge + data
  for (let i = 0; i < 80; i++) {
    await sleep(500)
    if (logs.some(l => l.text.includes('startApp() completed'))) break
  }
  await sleep(8000) // let brain cycle fire

  // ── BRAIN ──
  console.log('── BRAIN ANALYSIS ──')

  // Check bridge-side brain
  const brainOld = await page.evaluate(() => {
    const fns = ['brainThink', 'runBrainUpdate', 'syncBrainFromState', 'renderBrainCockpit', 'renderCircuitBrain', '_initBrainCockpit']
    const found = fns.filter(f => typeof window[f] === 'function')

    // Check S object for brain data
    const sFields = {}
    if (window.S) {
      for (const k of Object.keys(window.S)) {
        if (/brain|regime|signal|conf|structure|adapt|fcast/i.test(k)) {
          sFields[k] = window.S[k]
        }
      }
    }

    // Check brain DOM
    const znc = document.getElementById('zeusBrain')
    const zncBody = document.querySelector('.znc-body')
    const brainState = document.getElementById('brainStateBadge')
    const zncSrc = document.getElementById('znc-src')

    // Check intervals
    const intervals = typeof window.Intervals !== 'undefined' && window.Intervals.list ? window.Intervals.list() : []
    const brainIntervals = intervals.filter(i => /brain/i.test(i))

    return {
      fnsFound: found,
      fnsTotal: fns.length,
      sFields,
      brainBadge: brainState?.textContent?.trim() || null,
      zncSrc: zncSrc?.textContent?.trim() || null,
      zncBodyExcerpt: zncBody?.textContent?.substring(0, 200) || null,
      allIntervals: intervals,
      brainIntervals,
    }
  })

  console.log(`  Old JS brain functions: ${brainOld.fnsFound.length}/${brainOld.fnsTotal} (${brainOld.fnsFound.join(', ')})`)
  console.log(`  S.* brain fields: ${JSON.stringify(brainOld.sFields)}`)
  console.log(`  Brain badge: ${brainOld.brainBadge}`)
  console.log(`  Brain source: ${brainOld.zncSrc}`)
  console.log(`  Active intervals: [${brainOld.allIntervals.join(', ')}]`)
  console.log(`  Brain intervals: [${brainOld.brainIntervals.join(', ')}]`)

  // Check brain console logs
  const brainLogs = logs.filter(l => /brain|regime|signal|forecast|_bc/i.test(l.text))
  console.log(`  Brain console logs (${brainLogs.length}):`)
  brainLogs.slice(0, 10).forEach(l => console.log(`    [${l.type}] ${l.text.substring(0, 140)}`))

  // Wait 15 more seconds and check brain again
  console.log('\n  Waiting 15s for brain cycles...')
  await sleep(15000)

  const brainAfter = await page.evaluate(() => {
    const sFields = {}
    if (window.S) {
      for (const k of Object.keys(window.S)) {
        if (/brain|regime|signal|conf|structure|adapt|fcast/i.test(k)) {
          sFields[k] = window.S[k]
        }
      }
    }
    return {
      sFields,
      brainBadge: document.getElementById('brainStateBadge')?.textContent?.trim() || null,
    }
  })
  console.log(`  After 15s — S.* brain fields: ${JSON.stringify(brainAfter.sFields)}`)
  console.log(`  After 15s — Brain badge: ${brainAfter.brainBadge}`)

  const newBrainLogs = logs.filter(l => /brain|regime|signal|forecast|_bc/i.test(l.text))
  console.log(`  New brain logs (${newBrainLogs.length - brainLogs.length} new):`)
  newBrainLogs.slice(brainLogs.length, brainLogs.length + 10).forEach(l => console.log(`    [${l.type}] ${l.text.substring(0, 140)}`))

  // ── FLOW/ORDERFLOW ──
  console.log('\n── FLOW/ORDERFLOW ANALYSIS ──')

  const flowState = await page.evaluate(() => {
    // Check all flow-related globals
    const globals = {}
    const patterns = ['_of', 'orderflow', 'flow', 'aggTrade', 'updateFlow', 'updateOrderFlow']
    for (const k of Object.keys(window)) {
      try {
        if (patterns.some(p => k.toLowerCase().includes(p.toLowerCase())) && !k.includes('overflow')) {
          globals[k] = typeof window[k]
        }
      } catch {}
    }

    // Check S.of or S.orderflow
    const ofData = {}
    if (window.S) {
      for (const k of Object.keys(window.S)) {
        if (/flow|of_|aggr|trade.*count|delta/i.test(k)) {
          ofData[k] = window.S[k]
        }
      }
    }

    // Check OF HUD content
    const ofHud = document.getElementById('of-hud')
    const ofDetail = document.getElementById('of-hud-detail')

    return {
      globals,
      ofData,
      ofHudText: ofHud?.textContent?.substring(0, 150) || null,
      ofDetailText: ofDetail?.textContent?.substring(0, 150) || null,
    }
  })

  console.log(`  Flow globals: ${JSON.stringify(flowState.globals)}`)
  console.log(`  S.* flow data: ${JSON.stringify(flowState.ofData)}`)
  console.log(`  OF HUD text: ${flowState.ofHudText}`)

  // Check flow-related console logs
  const flowLogs = logs.filter(l => /orderflow|of_agg|aggTrade|flow.*update/i.test(l.text))
  console.log(`  Flow console logs (${flowLogs.length}):`)
  flowLogs.slice(0, 10).forEach(l => console.log(`    [${l.type}] ${l.text.substring(0, 140)}`))

  console.log('\n=== DEEP CHECK COMPLETE ===')
  await browser.close()
}

run().catch(console.error)
