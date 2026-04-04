import puppeteer from 'puppeteer-core'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = ms => new Promise(r => setTimeout(r, ms))

function makeToken() {
  const jwt = require('jsonwebtoken')
  return jwt.sign({ id: 1, email: 'hidden.kode@proton.me', role: 'admin', tokenVersion: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' })
}

async function run() {
  console.log('=== NAVIGATION & CONTENT VISIBILITY TEST ===\n')
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  const logs = []
  page.on('console', m => logs.push({ type: m.type(), text: m.text() }))

  await page.setCookie({ name: 'zeus_token', value: makeToken(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' })
  await page.goto('http://localhost:5173/app/', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(2000)

  // Wait for bridge
  for (let i = 0; i < 80; i++) {
    await sleep(500)
    if (logs.some(l => l.text.includes('startApp() completed'))) break
  }
  await sleep(3000)

  // ═══ A. HOME STATE — before any dock click ═══
  console.log('══ A. HOME STATE ══')
  const homeState = await page.evaluate(() => {
    const zpv = document.querySelector('.zpv')
    const zeusGroups = document.getElementById('zeus-groups')
    return {
      zpvExists: !!zpv,
      zpvDisplay: zpv ? window.getComputedStyle(zpv).display : 'N/A',
      zeusGroupsClass: zeusGroups?.className || '',
      activePanels: document.querySelectorAll('.zpv-active-panel').length,
      hiddenPanels: document.querySelectorAll('.zpv-hidden-panel').length,
    }
  })
  for (const [k, v] of Object.entries(homeState)) console.log(`  ${k}: ${v}`)

  // ═══ B. CLICK AT DOCK ICON ═══
  console.log('\n══ B. CLICK "autotrade" DOCK ICON ══')
  await page.click('.zd-item[data-dock="autotrade"]')
  await sleep(500)

  const atClickState = await page.evaluate(() => {
    const zpv = document.querySelector('.zpv')
    const zpvContent = document.querySelector('.zpv-content')
    const zpvTitle = document.querySelector('.zpv-title')
    const zeusGroups = document.getElementById('zeus-groups')
    const atPanel = document.getElementById('atPanel')
    const atStripPanel = document.getElementById('at-strip-panel')

    // Check what's active
    const activePanels = document.querySelectorAll('.zpv-active-panel')
    const activeIds = [...activePanels].map(el => el.getAttribute('data-panel-id') || el.id)

    // Check if AT panel is truly visible
    let atPanelRect = atPanel ? atPanel.getBoundingClientRect() : null
    let atStripRect = atStripPanel ? atStripPanel.getBoundingClientRect() : null

    return {
      // PageView overlay
      zpvExists: !!zpv,
      zpvDisplay: zpv ? window.getComputedStyle(zpv).display : 'N/A',
      zpvZIndex: zpv ? window.getComputedStyle(zpv).zIndex : 'N/A',
      zpvTitle: zpvTitle?.textContent || 'N/A',
      zpvContentChildren: zpvContent ? zpvContent.children.length : -1,
      zpvContentInnerHTML: zpvContent ? zpvContent.innerHTML.substring(0, 200) : 'N/A',

      // Active panel
      activePanelCount: activePanels.length,
      activePanelIds: activeIds,

      // AT strip panel (wrapper)
      atStripClass: atStripPanel?.className || 'N/A',
      atStripPosition: atStripPanel ? window.getComputedStyle(atStripPanel).position : 'N/A',
      atStripZIndex: atStripPanel ? window.getComputedStyle(atStripPanel).zIndex : 'N/A',
      atStripDisplay: atStripPanel ? window.getComputedStyle(atStripPanel).display : 'N/A',
      atStripVisibility: atStripPanel ? window.getComputedStyle(atStripPanel).visibility : 'N/A',
      atStripRect: atStripRect ? { w: atStripRect.width, h: atStripRect.height, top: atStripRect.top } : null,

      // AT panel (inner content)
      atPanelExists: !!atPanel,
      atPanelDisplay: atPanel ? window.getComputedStyle(atPanel).display : 'N/A',
      atPanelRect: atPanelRect ? { w: atPanelRect.width, h: atPanelRect.height, top: atPanelRect.top } : null,
      atPanelBodyChildren: atPanel?.querySelector('.at-body')?.children.length || 0,

      // Zeus groups
      zeusGroupsClass: zeusGroups?.className || '',
    }
  })
  for (const [k, v] of Object.entries(atClickState)) {
    console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
  }

  // Close the page view
  const backBtn = await page.$('.zpv-back')
  if (backBtn) {
    await backBtn.click()
    await sleep(300)
  }

  // ═══ C. CLICK DSL DOCK ICON ═══
  console.log('\n══ C. CLICK "dsl" DOCK ICON ══')
  await page.click('.zd-item[data-dock="dsl"]')
  await sleep(500)

  const dslClickState = await page.evaluate(() => {
    const dslStripPanel = document.querySelector('[data-panel-id="dsl"]')
    const dslZone = document.getElementById('dslZone')
    return {
      dslStripClass: dslStripPanel?.className || 'N/A',
      dslStripPosition: dslStripPanel ? window.getComputedStyle(dslStripPanel).position : 'N/A',
      dslStripZIndex: dslStripPanel ? window.getComputedStyle(dslStripPanel).zIndex : 'N/A',
      dslStripRect: dslStripPanel ? (() => { const r = dslStripPanel.getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top } })() : null,
      dslZoneExists: !!dslZone,
      dslZoneDisplay: dslZone ? window.getComputedStyle(dslZone).display : 'N/A',
      dslZoneChildren: dslZone ? dslZone.children.length : 0,
    }
  })
  for (const [k, v] of Object.entries(dslClickState)) {
    console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
  }

  if (backBtn) { await page.click('.zpv-back'); await sleep(300) }

  // ═══ D. SETTINGS BUTTON TEST ═══
  console.log('\n══ D. SETTINGS BUTTON TEST ══')
  const settingsTest = await page.evaluate(() => {
    // Check footer for settings button
    const footer = document.querySelector('.bot, footer, .zr-footer')
    const settingsBtn = document.querySelector('[data-modal="settings"], #settingsBtn, .settings-btn, .bot-btn-settings')
    const allFooterBtns = footer ? [...footer.querySelectorAll('button, .bot-btn, [data-modal]')].map(b => ({
      text: b.textContent?.substring(0, 30) || '',
      id: b.id || '',
      class: b.className?.substring(0, 50) || '',
      dataModal: b.getAttribute('data-modal') || '',
      onClick: !!b.onclick,
    })) : []

    return {
      footerExists: !!footer,
      footerTag: footer?.tagName || 'N/A',
      footerClass: footer?.className || 'N/A',
      settingsBtnFound: !!settingsBtn,
      footerBtnCount: allFooterBtns.length,
      footerBtns: allFooterBtns.slice(0, 10),
    }
  })
  for (const [k, v] of Object.entries(settingsTest)) {
    console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
  }

  // ═══ E. MODALS CHECK ═══
  console.log('\n══ E. MODAL ELEMENTS CHECK ══')
  const modalCheck = await page.evaluate(() => {
    // Check if modal components are rendered
    const modals = [
      'notifications', 'cloud', 'alerts', 'charts', 'liq', 'llv',
      'supremus', 'sr', 'settings', 'ovi', 'welcome', 'admin',
      'cmdpalette', 'exposure', 'decisionlog'
    ]
    const results = {}
    for (const m of modals) {
      // Try various selectors
      const el = document.querySelector(`[data-modal="${m}"], .mover-${m}, #modal-${m}`)
      results[m] = !!el
    }
    // Check all .mover elements (old modal class)
    const movers = document.querySelectorAll('.mover')
    results._moverCount = movers.length
    results._moverIds = [...movers].map(m => m.id || m.className.substring(0, 30)).slice(0, 10)
    return results
  })
  for (const [k, v] of Object.entries(modalCheck)) {
    console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
  }

  // ═══ F. SCREENSHOT ═══
  console.log('\n══ F. SCREENSHOTS ══')
  await page.screenshot({ path: 'test-screenshot-home.png', fullPage: false })
  console.log('  Saved: test-screenshot-home.png')

  // Click AT dock
  await page.click('.zd-item[data-dock="autotrade"]')
  await sleep(500)
  await page.screenshot({ path: 'test-screenshot-at-open.png', fullPage: false })
  console.log('  Saved: test-screenshot-at-open.png')

  console.log('\n=== NAVIGATION TEST COMPLETE ===')
  await browser.close()
}
run().catch(console.error)
