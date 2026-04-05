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
  console.log('║  VISUAL LAYOUT AUDIT — Screenshots + Overlap Check      ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  const errs = []
  page.on('pageerror', e => errs.push(e.message))

  await page.setCookie({ name: 'zeus_token', value: makeToken(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' })
  await page.goto('http://localhost:5174/app/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  for (let i = 0; i < 120; i++) { await sleep(500); if (await page.evaluate(() => typeof window.togInd === 'function')) break }
  await sleep(6000)

  const issues = []

  // ── HOME PAGE SCREENSHOT ──
  await page.screenshot({ path: 'audit-visual-home.png', fullPage: false })
  console.log('  [screenshot] audit-visual-home.png')

  // ── VISUAL CHECKS ──
  console.log('\n══ LAYOUT CHECKS ══')

  const layoutCheck = await page.evaluate(() => {
    const results = []
    const viewW = window.innerWidth
    const viewH = window.innerHeight

    // Check all major elements for overflow
    const checks = [
      { sel: '.zeus-fixed-top', name: 'Header' },
      { sel: '#zeusStatusBar', name: 'Status Bar' },
      { sel: '#zeus-mode-bar', name: 'Mode Bar' },
      { sel: '#wlBar', name: 'Watchlist' },
      { sel: '.zr-panel--chart', name: 'Chart Section' },
      { sel: '#zeus-dock', name: 'Dock' },
      { sel: '#zeusBrain', name: 'Brain' },
      { sel: '.bot', name: 'Footer' },
    ]

    for (const c of checks) {
      const el = document.querySelector(c.sel)
      if (!el) { results.push({ name: c.name, issue: 'NOT FOUND' }); continue }
      const rect = el.getBoundingClientRect()
      const s = getComputedStyle(el)

      // Check overflow
      if (rect.right > viewW + 2) results.push({ name: c.name, issue: `overflows right by ${Math.round(rect.right - viewW)}px` })
      if (rect.left < -2) results.push({ name: c.name, issue: `overflows left by ${Math.round(-rect.left)}px` })

      // Check if clipped
      if (s.overflow === 'hidden' && (rect.width < 100 || rect.height < 5)) {
        results.push({ name: c.name, issue: `suspiciously small: ${Math.round(rect.width)}x${Math.round(rect.height)}` })
      }

      // Check z-index stacking
      const z = parseInt(s.zIndex) || 0
      if (c.name === 'Header' && z < 100) results.push({ name: c.name, issue: `low z-index: ${z}` })
    }

    // Check for overlapping fixed elements
    const header = document.querySelector('.zeus-fixed-top')
    const modeBar = document.getElementById('zeus-mode-bar')
    if (header && modeBar) {
      const hRect = header.getBoundingClientRect()
      const mRect = modeBar.getBoundingClientRect()
      if (mRect.top < hRect.bottom - 2) {
        results.push({ name: 'ModeBar vs Header', issue: `overlap: modeBar top ${Math.round(mRect.top)} < header bottom ${Math.round(hRect.bottom)}` })
      }
    }

    // Check dock not overlapping brain
    const dock = document.getElementById('zeus-dock')
    const brain = document.getElementById('zeusBrain')
    if (dock && brain) {
      const dRect = dock.getBoundingClientRect()
      const bRect = brain.getBoundingClientRect()
      if (bRect.top < dRect.bottom - 2 && bRect.top > dRect.top) {
        results.push({ name: 'Brain vs Dock', issue: `overlap: brain top ${Math.round(bRect.top)} < dock bottom ${Math.round(dRect.bottom)}` })
      }
    }

    // Check footer visibility
    const footer = document.querySelector('.bot')
    if (footer) {
      const fRect = footer.getBoundingClientRect()
      if (fRect.top > viewH) results.push({ name: 'Footer', issue: 'below viewport (not visible without scroll)' })
    }

    // Check text overflow in status bar
    const statusItems = document.querySelectorAll('.zsb-item')
    statusItems.forEach(item => {
      const r = item.getBoundingClientRect()
      if (r.width < 10 && item.textContent.trim().length > 0) {
        results.push({ name: `StatusBar #${item.id || 'unknown'}`, issue: `text clipped: width=${Math.round(r.width)}px text="${item.textContent.trim().substring(0,20)}"` })
      }
    })

    return results
  })

  if (layoutCheck.length === 0) {
    console.log('  No layout issues detected')
  } else {
    layoutCheck.forEach(r => {
      console.log(`  ${r.name.padEnd(20)} ${r.issue}`)
      issues.push(r)
    })
  }

  // ── PANEL VISUAL AUDIT — open each, screenshot, check layout ──
  console.log('\n══ PANEL VISUAL AUDIT ══')

  const panelIds = ['autotrade','manual-trade','dsl','ares','postmortem','pnllab','aria','nova','adaptive','flow','mtf','teacher','sigreg','activity','aub']

  for (const panelId of panelIds) {
    const dockSel = `.zd-item[data-dock="${panelId}"]`
    const dockEl = await page.$(dockSel)
    if (!dockEl) { console.log(`  ${panelId.padEnd(15)} DOCK ICON MISSING`); continue }

    await dockEl.click()
    await sleep(600)

    const panelCheck = await page.evaluate((pid) => {
      const wrapper = document.querySelector(`[data-panel-id="${pid}"]`)
      if (!wrapper) return { exists: false }
      const rect = wrapper.getBoundingClientRect()
      const s = getComputedStyle(wrapper)
      const viewW = window.innerWidth

      const issues = []

      // Check panel fills width
      if (rect.width < viewW * 0.9) issues.push(`narrow: ${Math.round(rect.width)}px vs viewport ${viewW}px`)

      // Check scroll behavior
      if (rect.height > window.innerHeight * 2) issues.push(`very tall: ${Math.round(rect.height)}px`)

      // Check for clipped content
      if (s.overflow === 'hidden' && rect.height < 50) issues.push('content clipped (overflow:hidden + small height)')

      // Check PageView header exists
      const pvHdr = document.querySelector('.zpv-hdr')
      if (!pvHdr) issues.push('no PageView header')

      // Check back button
      const backBtn = document.querySelector('.zpv-back')
      if (!backBtn) issues.push('no back button')

      return { exists: true, w: Math.round(rect.width), h: Math.round(rect.height), issues }
    }, panelId)

    if (!panelCheck.exists) {
      console.log(`  ${panelId.padEnd(15)} NOT FOUND`)
    } else {
      const ok = panelCheck.issues.length === 0
      console.log(`  ${panelId.padEnd(15)} ${panelCheck.w}x${panelCheck.h} ${ok ? 'OK' : panelCheck.issues.join(', ')}`)
      if (!ok) panelCheck.issues.forEach(i => issues.push({ name: panelId, issue: i }))
    }

    // Close
    const back = await page.$('.zpv-back')
    if (back) { await back.click(); await sleep(300) }
  }

  // ── MODAL VISUAL AUDIT ──
  console.log('\n══ MODAL VISUAL AUDIT ══')

  const modalIds = [
    { id: 'msettings', fn: "openM('msettings');hubPopulate()" },
    { id: 'malerts', fn: "openM('malerts')" },
    { id: 'mcharts', fn: "openM('mcharts')" },
    { id: 'mwelcome', fn: "openM('mwelcome')" },
  ]

  for (const m of modalIds) {
    await page.evaluate(fn => { try { eval(fn) } catch(e) {} }, m.fn)
    await sleep(500)

    const modalCheck = await page.evaluate(id => {
      const el = document.getElementById(id)
      if (!el || getComputedStyle(el).display === 'none') return { visible: false }
      const modal = el.querySelector('.modal') || el.querySelector('.wlc-modal')
      if (!modal) return { visible: true, issues: ['no .modal inner element'] }
      const rect = modal.getBoundingClientRect()
      const viewW = window.innerWidth
      const viewH = window.innerHeight
      const issues = []
      if (rect.right > viewW) issues.push(`overflows right by ${Math.round(rect.right - viewW)}px`)
      if (rect.bottom > viewH) issues.push(`overflows bottom by ${Math.round(rect.bottom - viewH)}px`)
      if (rect.left < 0) issues.push(`overflows left by ${Math.round(-rect.left)}px`)
      if (rect.width > viewW) issues.push(`wider than viewport: ${Math.round(rect.width)}px`)
      return { visible: true, w: Math.round(rect.width), h: Math.round(rect.height), issues }
    }, m.id)

    if (!modalCheck.visible) {
      console.log(`  ${m.id.padEnd(16)} NOT VISIBLE`)
    } else {
      const ok = !modalCheck.issues || modalCheck.issues.length === 0
      console.log(`  ${m.id.padEnd(16)} ${modalCheck.w}x${modalCheck.h} ${ok ? 'OK' : modalCheck.issues.join(', ')}`)
    }

    await page.evaluate(id => { const e = document.getElementById(id); if(e) e.style.display='none' }, m.id)
    await sleep(200)
  }

  // ── SCROLL BEHAVIOR ──
  console.log('\n══ SCROLL BEHAVIOR ══')
  const scrollCheck = await page.evaluate(() => {
    const body = document.body
    const html = document.documentElement
    const scrollH = Math.max(body.scrollHeight, html.scrollHeight)
    const viewH = window.innerHeight
    return { scrollH, viewH, scrollable: scrollH > viewH, ratio: (scrollH / viewH).toFixed(1) }
  })
  console.log(`  Page height: ${scrollCheck.scrollH}px, viewport: ${scrollCheck.viewH}px, ratio: ${scrollCheck.ratio}x`)

  // ── REFRESH + REOPEN ──
  console.log('\n══ REFRESH + REOPEN ══')
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
  for (let i = 0; i < 120; i++) { await sleep(500); if (await page.evaluate(() => !!window.mainChart)) break }
  await sleep(5000)
  await page.screenshot({ path: 'audit-visual-refresh.png', fullPage: false })
  console.log('  [screenshot] audit-visual-refresh.png')

  const refreshCheck = await page.evaluate(() => ({
    header: !!document.querySelector('.zeus-fixed-top'),
    chart: !!document.querySelector('#mc canvas'),
    dock: !!document.getElementById('zeus-dock'),
    brain: !!document.getElementById('zeusBrain'),
    footer: !!document.querySelector('.bot'),
    panels: document.querySelectorAll('[data-panel-id]').length,
  }))
  for (const [k,v] of Object.entries(refreshCheck)) {
    console.log(`  ${k.padEnd(16)} ${v === true || v > 0 ? 'OK' : 'FAIL'} (${v})`)
  }

  // ── SUMMARY ──
  console.log('\n╔══════════════════════════════════════════════════════════╗')
  console.log('║  VISUAL AUDIT SUMMARY                                    ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log(`\n  Layout issues: ${issues.length}`)
  console.log(`  Page errors: ${errs.length}`)
  issues.forEach(i => console.log(`    - ${i.name}: ${i.issue}`))
  errs.slice(0,3).forEach(e => console.log(`    ERROR: ${e.substring(0,100)}`))

  await browser.close()
}
run().catch(console.error)
