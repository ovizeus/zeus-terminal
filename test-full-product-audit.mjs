import puppeteer from 'puppeteer-core'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = ms => new Promise(r => setTimeout(r, ms))
function makeToken() {
  const jwt = require('jsonwebtoken')
  return jwt.sign({ id: 1, email: 'test@test.com', role: 'admin', tokenVersion: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' })
}

const BUGS = []
let bugId = 0
function bug(sev, zone, symptom, cause) { BUGS.push({ id: ++bugId, sev, zone, symptom, cause }) }

async function run() {
  console.log('╔══════════════════════════════════════════════════════════════════╗')
  console.log('║  ZEUS TERMINAL — FULL PRODUCT AUDIT                              ║')
  console.log('╚══════════════════════════════════════════════════════════════════╝\n')

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message || String(e)))
  const consoleErrors = []
  const consoleWarnings = []
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('429') && !m.text().includes('favicon')) consoleErrors.push(m.text())
    if (m.type() === 'warning') consoleWarnings.push(m.text())
  })

  await page.setCookie({ name: 'zeus_token', value: makeToken(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' })
  await page.goto('http://localhost:5174/app/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  for (let i = 0; i < 120; i++) { await sleep(500); if (await page.evaluate(() => typeof window.togInd === 'function' && !!window.mainChart)) break }
  await sleep(6000)

  // ════════════════════════════════════════════════════════════════
  // 1. HOME PAGE — header, status bar, mode bar, watchlist, chart, brain, footer
  // ════════════════════════════════════════════════════════════════
  console.log('══ 1. HOME PAGE ══')
  const home = await page.evaluate(() => {
    const r = {}
    const vis = (sel) => { const e = document.querySelector(sel); if(!e) return {exists:false}; const s=getComputedStyle(e); const rect=e.getBoundingClientRect(); return {exists:true, visible: s.display!=='none'&&s.visibility!=='hidden'&&rect.width>0&&rect.height>0, w:Math.round(rect.width), h:Math.round(rect.height), text: e.textContent?.substring(0,60)} }

    r.header = vis('.zeus-fixed-top')
    r.statusBar = vis('#zeusStatusBar')
    r.modeBar = vis('#zeus-mode-bar')
    r.watchlist = vis('#wlBar')
    r.chart = vis('#mc')
    r.chartCanvas = {exists: !!document.querySelector('#mc canvas')}
    r.brain = vis('#zeusBrain')
    r.footer = vis('.bot')
    r.dock = vis('#zeus-dock')
    r.dockIcons = document.querySelectorAll('.zd-item').length

    // Status bar content
    r.zsbMode = document.getElementById('zsbMode')?.textContent?.trim()
    r.zsbAT = document.getElementById('zsbAT')?.textContent?.trim()
    r.zsbWS = document.getElementById('zsbWS')?.textContent?.trim()
    r.zsbData = document.getElementById('zsbData')?.textContent?.trim()
    r.zsbKill = document.getElementById('zsbKill')?.textContent?.trim()
    r.zsbPos = document.getElementById('zsbPos')?.textContent?.trim()
    r.zsbPnl = document.getElementById('zsbPnl')?.textContent?.trim()

    // Brain content
    r.brainMode = document.querySelector('.znc-mbtn.act-assist,.znc-mbtn.act-auto')?.textContent?.trim()
    r.brainProfile = document.querySelector('.znc-pbtn[class*=act]')?.textContent?.trim()

    // Analysis sections
    r.fgArc = {exists: !!document.getElementById('fgarc')}
    r.analysisRows = document.querySelectorAll('[id^="r"]').length

    return r
  })

  for (const [k,v] of Object.entries(home)) {
    if (typeof v === 'object' && 'exists' in v) {
      const ok = v.exists && (v.visible !== false)
      console.log(`  ${k.padEnd(16)} ${ok ? 'OK' : 'ISSUE'} ${v.visible === false ? '(hidden)' : ''} ${v.text ? '"'+v.text.substring(0,40)+'"' : ''}`)
      if (!ok && v.exists) bug('MEDIUM', 'Home', `${k} exists but hidden`, 'CSS or display issue')
      if (!v.exists) bug('HIGH', 'Home', `${k} not in DOM`, 'Missing element')
    } else {
      console.log(`  ${k.padEnd(16)} ${v || 'N/A'}`)
    }
  }

  // ════════════════════════════════════════════════════════════════
  // 2. ALL BUTTONS — comprehensive click audit
  // ════════════════════════════════════════════════════════════════
  console.log('\n══ 2. BUTTON AUDIT ══')

  // Collect ALL buttons and interactive elements
  const buttonAudit = await page.evaluate(() => {
    const results = []
    // All buttons with IDs
    document.querySelectorAll('button[id], [onclick], .zd-item').forEach(el => {
      const id = el.id || el.getAttribute('data-dock') || ''
      const hasOnclick = !!el.onclick || el.hasAttribute('onclick')
      const hasReactHandler = Object.keys(el).some(k => k.startsWith('__reactFiber') || k.startsWith('__reactEvents') || k.startsWith('__reactProps'))
      const hasListener = hasOnclick || hasReactHandler
      const visible = getComputedStyle(el).display !== 'none'
      if (id) results.push({ id, tag: el.tagName, hasListener, visible, text: el.textContent?.substring(0,20) })
    })
    return results
  })

  const noHandler = buttonAudit.filter(b => !b.hasListener && b.visible)
  console.log(`  Total buttons with IDs: ${buttonAudit.length}`)
  console.log(`  With handler: ${buttonAudit.filter(b=>b.hasListener).length}`)
  console.log(`  Without handler (visible): ${noHandler.length}`)
  if (noHandler.length) {
    noHandler.forEach(b => {
      console.log(`    NO HANDLER: #${b.id} "${b.text}"`)
      bug('MEDIUM', 'Buttons', `#${b.id} has no click handler`, 'Missing onClick or addEventListener')
    })
  }

  // ════════════════════════════════════════════════════════════════
  // 3. DOCK PANELS — open each, verify content, close
  // ════════════════════════════════════════════════════════════════
  console.log('\n══ 3. DOCK PANELS ══')

  const panels = [
    {dock:'autotrade', name:'AutoTrade', keyEls:['atMainBtn','atPanel','atStatus']},
    {dock:'manual-trade', name:'Manual Trade', keyEls:['panelDemo','demoExec','demoBalance']},
    {dock:'dsl', name:'DSL', keyEls:['dslToggleBtn','dslZone']},
    {dock:'ares', name:'ARES', keyEls:['ares-strip','ares-panel','ares-core-svg']},
    {dock:'postmortem', name:'Post-Mortem', keyEls:['pm-strip','pm-panel-body']},
    {dock:'pnllab', name:'PnL Lab', keyEls:['pnl-lab-strip','pnlLabBody']},
    {dock:'aria', name:'ARIA', keyEls:['aria-strip','aria-panel']},
    {dock:'nova', name:'Nova', keyEls:['nova-strip','nova-panel','nova-log']},
    {dock:'adaptive', name:'Adaptive', keyEls:['adaptive-sec','adaptiveToggleBtn']},
    {dock:'flow', name:'Flow', keyEls:['flow-panel','of-hud']},
    {dock:'mtf', name:'MTF', keyEls:['mtf-strip-panel','mtf-regime']},
    {dock:'teacher', name:'Teacher', keyEls:['teacher-strip','teacher-panel-body','teacher-tabs']},
    {dock:'sigreg', name:'Signals', keyEls:['sr-strip','sr-sec','sr-list']},
    {dock:'activity', name:'Activity', keyEls:['actfeed-strip','actfeedList']},
    {dock:'aub', name:'AUB', keyEls:['aub','aub-body']},
  ]

  for (const panel of panels) {
    const dockSel = `.zd-item[data-dock="${panel.dock}"]`
    const dockEl = await page.$(dockSel)
    if (!dockEl) { bug('HIGH', panel.name, 'Dock icon not found', 'Missing .zd-item'); continue }

    await dockEl.click()
    await sleep(700)

    const state = await page.evaluate((p) => {
      const wrapper = document.querySelector(`[data-panel-id="${p.dock}"]`)
      if (!wrapper) return { wrapperExists: false }
      const s = getComputedStyle(wrapper)
      const r = wrapper.getBoundingClientRect()
      const opens = s.display !== 'none' && r.width > 0 && r.height > 0

      const elChecks = {}
      let missingEls = []
      for (const id of p.keyEls) {
        const el = document.getElementById(id)
        if (!el) { missingEls.push(id); elChecks[id] = false; continue }
        const es = getComputedStyle(el)
        const vis = es.display !== 'none' && es.visibility !== 'hidden'
        elChecks[id] = vis
      }

      // Check for empty/placeholder text
      const allText = wrapper.textContent || ''
      const hasContent = allText.trim().length > 20

      // Check for overlapping elements (z-index issues)
      const zpvHeader = document.querySelector('.zpv-hdr')
      const zpvZ = zpvHeader ? parseInt(getComputedStyle(zpvHeader).zIndex) || 0 : 0

      return { wrapperExists: true, opens, w: Math.round(r.width), h: Math.round(r.height), elChecks, missingEls, hasContent, textLen: allText.trim().length }
    }, panel)

    if (!state.wrapperExists) {
      bug('HIGH', panel.name, 'Panel wrapper not in DOM', 'Missing [data-panel-id]')
      console.log(`  ${panel.name.padEnd(15)} WRAPPER MISSING`)
    } else {
      const ok = state.opens && state.missingEls.length === 0 && state.hasContent
      console.log(`  ${panel.name.padEnd(15)} opens:${state.opens?'Y':'N'} content:${state.hasContent?'Y':'N'} missing:${state.missingEls.length} txt:${state.textLen}`)
      if (state.missingEls.length) {
        console.log(`    MISSING: ${state.missingEls.join(', ')}`)
        state.missingEls.forEach(id => bug('MEDIUM', panel.name, `#${id} missing in panel`, 'Element not rendered'))
      }
      if (!state.opens) bug('HIGH', panel.name, 'Panel does not open', 'CSS visibility issue')
      if (!state.hasContent) bug('MEDIUM', panel.name, 'Panel has no real content', 'Old JS not populating')
    }

    // Close panel
    const back = await page.$('.zpv-back')
    if (back) { await back.click(); await sleep(300) }
  }

  // ════════════════════════════════════════════════════════════════
  // 4. MODALS — open, check content, close
  // ════════════════════════════════════════════════════════════════
  console.log('\n══ 4. MODALS ══')

  const modalTests = [
    {id:'msettings', openFn:"openM('msettings');hubPopulate()", name:'Settings'},
    {id:'madmin', openFn:"openM('madmin');zeusLoadAdmin()", name:'Admin'},
    {id:'mnotifications', openFn:"openM('mnotifications')", name:'Notifications'},
    {id:'malerts', openFn:"openM('malerts')", name:'Alerts'},
    {id:'mcharts', openFn:"openM('mcharts')", name:'Chart Settings'},
    {id:'mcloud', openFn:"openM('mcloud')", name:'Cloud Sync'},
    {id:'mwelcome', openFn:"openM('mwelcome')", name:'Welcome'},
  ]

  for (const modal of modalTests) {
    await page.evaluate(fn => { try { eval(fn) } catch(e) {} }, modal.openFn)
    await sleep(600)
    const state = await page.evaluate(id => {
      const el = document.getElementById(id)
      if (!el) return { exists: false }
      const s = getComputedStyle(el)
      const visible = s.display !== 'none'
      // Check for close button
      const closeBtn = el.querySelector('.mclose')
      const hasClose = !!closeBtn
      // Check content
      const textLen = (el.textContent || '').trim().length
      return { exists: true, visible, hasClose, textLen }
    }, modal.id)

    const ok = state.exists && state.visible && state.hasClose
    console.log(`  ${modal.name.padEnd(16)} exists:${state.exists?'Y':'N'} visible:${state.visible?'Y':'N'} close:${state.hasClose?'Y':'N'} txt:${state.textLen}`)
    if (!state.visible) bug('HIGH', modal.name, 'Modal does not open', 'Display issue')
    if (!state.hasClose) bug('MEDIUM', modal.name, 'No close button found', 'Missing .mclose element')

    // Close
    await page.evaluate(id => { const e = document.getElementById(id); if(e) e.style.display='none' }, modal.id)
    await sleep(200)
  }

  // ════════════════════════════════════════════════════════════════
  // 5. FUNCTIONAL TESTS — real interactions
  // ════════════════════════════════════════════════════════════════
  console.log('\n══ 5. FUNCTIONAL TESTS ══')

  // 5a. Demo order
  const orderBefore = await page.evaluate(() => window.TP?.demoPositions?.length ?? 0)
  await page.evaluate(() => { document.getElementById('demoSize').value = '100'; document.getElementById('demoExec').click() })
  await sleep(1500)
  const orderAfter = await page.evaluate(() => window.TP?.demoPositions?.length ?? 0)
  const orderOk = orderAfter > orderBefore
  console.log(`  Demo order:    ${orderOk ? 'PASS' : 'FAIL'} (${orderBefore} → ${orderAfter})`)
  if (!orderOk) bug('CRITICAL', 'Manual Trade', 'Demo order does not create position', 'placeDemoOrder binding')

  // 5b. AT toggle
  const atBefore = await page.evaluate(() => !!window.AT?.enabled)
  await page.evaluate(() => window.toggleAutoTrade?.())
  await sleep(1000)
  const atToggleWorks = await page.evaluate(() => typeof window.toggleAutoTrade === 'function')
  console.log(`  AT toggle fn:  ${atToggleWorks ? 'PASS' : 'FAIL'}`)

  // 5c. Brain mode switch
  await page.evaluate(() => window.setBrainMode?.('auto'))
  await sleep(300)
  const brainMode = await page.evaluate(() => window.S?.mode)
  console.log(`  Brain mode:    ${brainMode === 'auto' ? 'PASS' : 'CHECK'} (${brainMode})`)

  // 5d. Profile switch
  await page.evaluate(() => window.setProfile?.('swing'))
  await sleep(300)
  const profile = await page.evaluate(() => window.S?.activeProfile)
  console.log(`  Profile:       ${profile === 'swing' ? 'PASS' : 'CHECK'} (${profile})`)

  // 5e. DSL toggle
  const dslFn = await page.evaluate(() => typeof window.toggleDSL === 'function')
  console.log(`  DSL toggle fn: ${dslFn ? 'PASS' : 'FAIL'}`)

  // 5f. Symbol switch
  await page.evaluate(() => window.setSymbol?.('ETHUSDT'))
  await sleep(2000)
  const sym = await page.evaluate(() => window.S?.symbol)
  console.log(`  Symbol switch: ${sym === 'ETHUSDT' ? 'PASS' : 'FAIL'} (${sym})`)
  await page.evaluate(() => window.setSymbol?.('BTCUSDT'))
  await sleep(1000)

  // 5g. Indicator toggle
  await page.evaluate(() => window.togInd?.('rsi14', null))
  await sleep(800)
  const rsiOn = await page.evaluate(() => !!window.S?.activeInds?.rsi14)
  console.log(`  RSI toggle:    ${rsiOn ? 'PASS' : 'FAIL'}`)
  await page.evaluate(() => window.togInd?.('rsi14', null)) // toggle off
  await sleep(300)

  // 5h. Settings persistence
  const settingsFn = await page.evaluate(() => typeof window._usScheduleSave === 'function')
  console.log(`  Settings save: ${settingsFn ? 'PASS' : 'FAIL'}`)

  // ════════════════════════════════════════════════════════════════
  // 6. REFRESH SURVIVAL
  // ════════════════════════════════════════════════════════════════
  console.log('\n══ 6. REFRESH SURVIVAL ══')
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
  for (let i = 0; i < 120; i++) { await sleep(500); if (await page.evaluate(() => !!window.mainChart)) break }
  await sleep(5000)

  const afterRefresh = await page.evaluate(() => ({
    chart: !!window.mainChart,
    dock: !!document.getElementById('zeus-dock'),
    brain: !!document.getElementById('zeusBrain'),
    panels: document.querySelectorAll('[data-panel-id]').length,
    intervals: window.Intervals?.list?.()?.length || 0,
    price: window.S?.price > 0,
    modals: ['msettings','madmin','mnotifications','malerts','mcharts'].every(id => !!document.getElementById(id)),
  }))
  for (const [k,v] of Object.entries(afterRefresh)) {
    const ok = v === true || (typeof v === 'number' && v > 0)
    console.log(`  ${k.padEnd(16)} ${ok ? 'OK' : 'FAIL'} (${v})`)
    if (!ok) bug('HIGH', 'Refresh', `${k} broken after refresh`, 'Lifecycle issue')
  }

  // ════════════════════════════════════════════════════════════════
  // 7. CONSOLE ERRORS
  // ════════════════════════════════════════════════════════════════
  console.log('\n══ 7. CONSOLE ══')
  console.log(`  Page crashes: ${pageErrors.length}`)
  pageErrors.slice(0,5).forEach(e => { console.log(`    CRASH: ${e.substring(0,120)}`); bug('CRITICAL','Runtime',e.substring(0,80),'JS error') })
  console.log(`  Console errors: ${consoleErrors.length}`)
  consoleErrors.slice(0,5).forEach(e => console.log(`    ERR: ${e.substring(0,120)}`))
  console.log(`  Warnings: ${consoleWarnings.length}`)

  // ════════════════════════════════════════════════════════════════
  // FINAL REPORT
  // ════════════════════════════════════════════════════════════════
  console.log('\n╔══════════════════════════════════════════════════════════════════╗')
  console.log('║  BUG LIST                                                        ║')
  console.log('╚══════════════════════════════════════════════════════════════════╝\n')

  const critical = BUGS.filter(b => b.sev === 'CRITICAL')
  const high = BUGS.filter(b => b.sev === 'HIGH')
  const medium = BUGS.filter(b => b.sev === 'MEDIUM')
  const low = BUGS.filter(b => b.sev === 'LOW')

  console.log(`CRITICAL: ${critical.length} | HIGH: ${high.length} | MEDIUM: ${medium.length} | LOW: ${low.length}`)
  console.log('')

  if (BUGS.length === 0) {
    console.log('NO BUGS FOUND ✓')
  } else {
    console.log('ID | SEV      | Zone            | Symptom')
    console.log('─'.repeat(80))
    BUGS.forEach(b => {
      console.log(`${String(b.id).padEnd(3)}| ${b.sev.padEnd(9)}| ${b.zone.padEnd(16)}| ${b.symptom.substring(0,50)}`)
    })
  }

  console.log('\n=== FULL PRODUCT AUDIT COMPLETE ===')
  await browser.close()
}
run().catch(console.error)
