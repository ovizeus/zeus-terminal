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
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  const logs = []
  page.on('console', m => logs.push(m.text()))
  const errors = []
  page.on('pageerror', e => errors.push(e.message || String(e)))

  await page.setCookie({ name: 'zeus_token', value: makeToken(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' })
  await page.goto('http://localhost:5174/app/', { waitUntil: 'networkidle2', timeout: 60000 })
  for (let i = 0; i < 80; i++) { await sleep(500); if (logs.some(l => l.includes('startApp() completed'))) break }
  await sleep(3000)

  // Settings modal — click by title
  console.log('=== SETTINGS MODAL ===')
  await page.click('button[title="Settings Hub"]')
  await sleep(500)
  const settingsState = await page.evaluate(() => {
    const movers = document.querySelectorAll('.mover')
    for (const m of movers) {
      const s = window.getComputedStyle(m)
      if (s.display !== 'none') {
        return { visible: true, display: s.display, w: Math.round(m.getBoundingClientRect().width), h: Math.round(m.getBoundingClientRect().height), id: m.id }
      }
    }
    return { visible: false }
  })
  console.log(`  Settings: ${JSON.stringify(settingsState)}`)
  await page.screenshot({ path: 'test-final-settings.png' })

  // Close
  const mc = await page.$('.mclose')
  if (mc) { await mc.click(); await sleep(200) }

  // Admin modal
  console.log('\n=== ADMIN MODAL ===')
  const adminBtn = await page.$('button[title="Admin Panel"]')
  if (adminBtn) {
    await adminBtn.click()
    await sleep(500)
    const adminState = await page.evaluate(() => {
      const movers = document.querySelectorAll('.mover')
      for (const m of movers) {
        const s = window.getComputedStyle(m)
        if (s.display !== 'none') return { visible: true, display: s.display, id: m.id }
      }
      return { visible: false }
    })
    console.log(`  Admin: ${JSON.stringify(adminState)}`)
    await page.screenshot({ path: 'test-final-admin.png' })
    const mc2 = await page.$('.mclose')
    if (mc2) { await mc2.click(); await sleep(200) }
  } else {
    console.log('  Admin btn not found')
  }

  // Screenshots of key panels
  const panels = ['flow', 'sigreg', 'aria', 'nova', 'teacher', 'aub']
  for (const p of panels) {
    await page.click(`.zd-item[data-dock="${p}"]`)
    await sleep(400)
    await page.screenshot({ path: `test-final-${p}.png` })
    const back = await page.$('.zpv-back')
    if (back) { await back.click(); await sleep(200) }
  }

  console.log(`\nPage errors: ${errors.length}`)
  errors.forEach(e => console.log(`  ${e.substring(0, 150)}`))
  console.log('\n=== FINAL VERIFY COMPLETE ===')
  await browser.close()
}
run().catch(console.error)
