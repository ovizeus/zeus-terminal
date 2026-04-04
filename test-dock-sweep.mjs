import puppeteer from 'puppeteer-core'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = ms => new Promise(r => setTimeout(r, ms))

function makeToken() {
  const jwt = require('jsonwebtoken')
  return jwt.sign({ id: 1, email: 'hidden.kode@proton.me', role: 'admin', tokenVersion: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' })
}

// All 15 dock panels (excluding 'more') with their expected inner selectors
const PANELS = [
  { dock: 'autotrade', name: 'AutoTrade', innerSelectors: ['#atPanel', '.at-body', '.at-sep'] },
  { dock: 'manual-trade', name: 'Manual Trade', innerSelectors: ['.trade-panel', '#panelDemo', '#demoBalance'] },
  { dock: 'dsl', name: 'DSL', innerSelectors: ['#dslZone', '.dsl-zone'] },
  { dock: 'ares', name: 'ARES', innerSelectors: ['#ares-strip', '#ares-panel', '#ares-core-svg', '#ares-stats-row'] },
  { dock: 'postmortem', name: 'Post-Mortem', innerSelectors: ['#pm-strip', '#pm-panel-body'] },
  { dock: 'pnllab', name: 'PnL Lab', innerSelectors: ['#pnl-lab-strip', '#pnlLabBody'] },
  { dock: 'aria', name: 'ARIA', innerSelectors: ['#aria-strip', '#aria-panel', '.aria-cols'] },
  { dock: 'nova', name: 'Nova', innerSelectors: ['#nova-strip', '#nova-panel', '#nova-log'] },
  { dock: 'adaptive', name: 'Adaptive', innerSelectors: ['#adaptive-sec', '#adaptiveToggleBtn', '#adaptive-bucket-table'] },
  { dock: 'flow', name: 'Flow', innerSelectors: ['#flow-panel', '#of-hud', '#flow-panel-body'] },
  { dock: 'mtf', name: 'MTF', innerSelectors: ['#mtf-strip-panel', '#mtf-regime', '#mtf-score-fill'] },
  { dock: 'teacher', name: 'Teacher', innerSelectors: ['#teacher-strip', '#teacher-panel-body', '#teacher-cap-hero', '#teacher-tabs'] },
  { dock: 'sigreg', name: 'Signals', innerSelectors: ['#sr-strip', '#sr-sec', '#sr-list'] },
  { dock: 'activity', name: 'Activity', innerSelectors: ['#actfeed-strip', '#actfeedList'] },
  { dock: 'aub', name: 'AUB (Alien)', innerSelectors: ['#aub', '#aub-body', '.aub-card'] },
]

async function run() {
  console.log('=== FULL DOCK SWEEP — ALL 15 PANELS ===\n')
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  const errors = []
  page.on('pageerror', e => errors.push(e.message || String(e)))
  const logs = []
  page.on('console', m => logs.push({ type: m.type(), text: m.text() }))

  await page.setCookie({ name: 'zeus_token', value: makeToken(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' })
  await page.goto('http://localhost:5174/app/', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(2000)

  // Wait for bridge
  for (let i = 0; i < 80; i++) {
    await sleep(500)
    if (logs.some(l => l.text.includes('startApp() completed'))) break
  }
  await sleep(3000)

  const results = []

  for (const panel of PANELS) {
    console.log(`\n══ ${panel.name} (dock: ${panel.dock}) ══`)

    // Click dock icon
    const dockSel = `.zd-item[data-dock="${panel.dock}"]`
    const dockExists = await page.$(dockSel)
    if (!dockExists) {
      console.log('  FAIL: dock icon not found')
      results.push({ ...panel, opens: false, contentVisible: false, populated: false, selectorsFound: 0, selectorsTotal: panel.innerSelectors.length, emptyShell: true, errors: false })
      continue
    }

    await page.click(dockSel)
    await sleep(600)

    // Check panel state
    const state = await page.evaluate((p) => {
      const wrapper = document.querySelector(`[data-panel-id="${p.dock}"]`)
      if (!wrapper) return { wrapperExists: false }

      const wStyle = window.getComputedStyle(wrapper)
      const wRect = wrapper.getBoundingClientRect()

      // Check each inner selector
      const selectorResults = {}
      for (const sel of p.innerSelectors) {
        const el = wrapper.querySelector(sel) || document.querySelector(sel)
        if (!el) {
          selectorResults[sel] = { exists: false, display: 'N/A', visible: false, hasContent: false }
          continue
        }
        const style = window.getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
        const hasContent = el.innerHTML.trim().length > 10
        selectorResults[sel] = {
          exists: true,
          display: style.display,
          visible,
          hasContent,
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        }
      }

      // Check overall content — is there ANY visible child with real content?
      const allChildren = wrapper.querySelectorAll('*')
      let visibleTextContent = 0
      allChildren.forEach(el => {
        const s = window.getComputedStyle(el)
        if (s.display !== 'none' && s.visibility !== 'hidden') {
          const txt = el.textContent || ''
          if (txt.trim().length > 0) visibleTextContent++
        }
      })

      return {
        wrapperExists: true,
        wrapperDisplay: wStyle.display,
        wrapperClass: wrapper.className,
        wrapperW: Math.round(wRect.width),
        wrapperH: Math.round(wRect.height),
        selectorResults,
        visibleTextElements: visibleTextContent,
        innerHTML: wrapper.innerHTML.substring(0, 300),
      }
    }, panel)

    if (!state.wrapperExists) {
      console.log('  FAIL: wrapper not found')
      results.push({ ...panel, opens: false, contentVisible: false, populated: false, selectorsFound: 0, selectorsTotal: panel.innerSelectors.length, emptyShell: true, errors: false })
    } else {
      const opens = state.wrapperDisplay !== 'none' && state.wrapperW > 0 && state.wrapperH > 0
      let selectorsFound = 0
      let selectorsVisible = 0
      for (const [sel, info] of Object.entries(state.selectorResults)) {
        if (info.exists) selectorsFound++
        const status = !info.exists ? 'MISSING' : !info.visible ? `HIDDEN(${info.display})` : `OK ${info.w}x${info.h}`
        console.log(`  ${sel}: ${status}${info.hasContent ? ' +content' : ''}`)
        if (info.visible) selectorsVisible++
      }

      const contentVisible = selectorsVisible > 0
      const emptyShell = state.visibleTextElements < 3
      console.log(`  wrapper: ${state.wrapperDisplay} ${state.wrapperW}x${state.wrapperH}`)
      console.log(`  selectors: ${selectorsFound}/${panel.innerSelectors.length} exist, ${selectorsVisible}/${panel.innerSelectors.length} visible`)
      console.log(`  visible text elements: ${state.visibleTextElements}`)
      console.log(`  empty shell: ${emptyShell ? 'YES' : 'NO'}`)
      console.log(`  VERDICT: ${opens && contentVisible && !emptyShell ? 'PASS' : 'FAIL'}`)

      results.push({
        ...panel,
        opens,
        contentVisible,
        populated: !emptyShell,
        selectorsFound,
        selectorsVisible,
        selectorsTotal: panel.innerSelectors.length,
        emptyShell,
        errors: false,
        visibleTextElements: state.visibleTextElements,
      })
    }

    // Take screenshot
    await page.screenshot({ path: `test-sweep-${panel.dock}.png`, fullPage: false })

    // Close page view (click back)
    const backBtn = await page.$('.zpv-back')
    if (backBtn) {
      await backBtn.click()
      await sleep(300)
    }
  }

  // Summary
  console.log('\n\n═══════════════════════════════════════')
  console.log('═══ DOCK SWEEP SUMMARY ═══')
  console.log('═══════════════════════════════════════\n')

  const pass = results.filter(r => r.opens && r.contentVisible && r.populated)
  const fail = results.filter(r => !(r.opens && r.contentVisible && r.populated))

  console.log(`PASS: ${pass.length}/15`)
  console.log(`FAIL: ${fail.length}/15\n`)

  for (const r of results) {
    const status = r.opens && r.contentVisible && r.populated ? 'PASS' : 'FAIL'
    console.log(`${status} | ${r.name.padEnd(14)} | opens:${r.opens ? 'Y' : 'N'} content:${r.contentVisible ? 'Y' : 'N'} populated:${r.populated ? 'Y' : 'N'} sel:${r.selectorsVisible || 0}/${r.selectorsTotal} shell:${r.emptyShell ? 'YES' : 'NO'} txt:${r.visibleTextElements || 0}`)
  }

  if (fail.length > 0) {
    console.log('\n═══ FAILED PANELS DETAIL ═══')
    for (const r of fail) {
      console.log(`\n  ${r.name} (${r.dock}):`)
      console.log(`    opens: ${r.opens}`)
      console.log(`    contentVisible: ${r.contentVisible}`)
      console.log(`    populated: ${r.populated}`)
      console.log(`    selectors: ${r.selectorsFound}/${r.selectorsTotal} exist, ${r.selectorsVisible || 0}/${r.selectorsTotal} visible`)
      console.log(`    emptyShell: ${r.emptyShell}`)
    }
  }

  console.log(`\nPage errors: ${errors.length}`)
  errors.forEach(e => console.log(`  ${e.substring(0, 150)}`))

  console.log('\n=== DOCK SWEEP COMPLETE ===')
  await browser.close()
}
run().catch(console.error)
