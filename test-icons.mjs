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
  console.log('=== ICON VISIBILITY VERIFICATION ===\n')
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message || String(e)))
  const logs = []
  page.on('console', m => logs.push({ type: m.type(), text: m.text() }))

  await page.setCookie({ name: 'zeus_token', value: makeToken(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' })
  await page.goto('http://localhost:5173/app/', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(3000)

  // Wait for bridge
  for (let i = 0; i < 80; i++) {
    await sleep(500)
    if (logs.some(l => l.text.includes('startApp() completed'))) break
  }
  await sleep(2000)

  // A. Check dock icon computed colors
  console.log('══ A. DOCK ICON COMPUTED COLORS ══')
  const dockIcons = await page.evaluate(() => {
    const dock = document.getElementById('zeus-dock')
    if (!dock) return { exists: false }
    const items = dock.querySelectorAll('.zd-item')
    const results = []
    items.forEach(item => {
      const id = item.getAttribute('data-dock')
      const svg = item.querySelector('.zd-icon svg')
      const label = item.querySelector('.zd-label')
      const icon = item.querySelector('.zd-icon')
      if (!svg) return
      const svgStyle = window.getComputedStyle(svg)
      const labelStyle = label ? window.getComputedStyle(label) : null
      const iconStyle = window.getComputedStyle(icon)
      results.push({
        id,
        svgColor: svgStyle.color,
        labelColor: labelStyle?.color || 'N/A',
        iconBg: iconStyle.background?.substring(0, 80) || 'N/A',
        svgVisible: svg.getBoundingClientRect().width > 0,
        pathCount: svg.querySelectorAll('path,circle,rect,line,polyline,polygon,ellipse').length,
      })
    })
    return { exists: true, count: items.length, items: results }
  })

  if (!dockIcons.exists) {
    console.log('  FAIL: #zeus-dock not found')
  } else {
    console.log(`  Dock items: ${dockIcons.count}`)
    for (const item of dockIcons.items) {
      const colorOk = item.svgColor !== 'rgb(0, 0, 0)' && item.svgVisible
      console.log(`  ${colorOk ? 'OK' : 'FAIL'} ${item.id}: svg=${item.svgColor} label=${item.labelColor} paths=${item.pathCount} visible=${item.svgVisible}`)
    }
  }

  // B. Check for any black icons
  console.log('\n══ B. BLACK ICON CHECK ══')
  const blackIcons = dockIcons.items?.filter(i => i.svgColor === 'rgb(0, 0, 0)') || []
  console.log(`  Black icons: ${blackIcons.length}`)
  blackIcons.forEach(i => console.log(`  BLACK: ${i.id}`))

  // C. Check dock navigation still works
  console.log('\n══ C. DOCK NAVIGATION TEST ══')
  const navTest = await page.evaluate(() => {
    const item = document.querySelector('.zd-item[data-dock="autotrade"]')
    if (!item) return { found: false }
    item.click()
    const isActive = item.classList.contains('active')
    return { found: true, clickedActive: isActive }
  })
  console.log(`  AT dock click: found=${navTest.found}, active=${navTest.clickedActive}`)

  // D. Check panel functionality still works
  console.log('\n══ D. PANEL REGRESSION CHECK ══')
  const panelCheck = await page.evaluate(() => {
    return {
      dslMounted: !!document.getElementById('dslZone'),
      atMounted: !!document.getElementById('atPanel'),
      ptMounted: !!document.getElementById('panelDemo'),
      atLogPopulated: (document.getElementById('atLog')?.innerHTML?.length || 0) > 10,
      demoBalance: document.getElementById('demoBalance')?.textContent || 'N/A',
    }
  })
  for (const [k, v] of Object.entries(panelCheck)) {
    console.log(`  ${k}: ${v}`)
  }

  // E. Console errors
  console.log('\n══ E. CONSOLE ERRORS ══')
  console.log(`  Page errors: ${errors.length}`)
  errors.forEach(e => console.log(`  ${e.substring(0, 150)}`))

  console.log('\n=== ICON VERIFICATION COMPLETE ===')
  await browser.close()
}
run().catch(console.error)
