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

  // Settings modal test
  console.log('=== SETTINGS MODAL ===')
  const settingsBtn = await page.$('[data-modal="settings"], .bot-btn-settings')
  if (!settingsBtn) {
    // Try header button
    const headerBtns = await page.$$('.zr-header button')
    for (const btn of headerBtns) {
      const text = await btn.evaluate(b => b.textContent)
      if (text.includes('Settings') || text.includes('⚙')) {
        await btn.click()
        break
      }
    }
  } else {
    await settingsBtn.click()
  }
  await sleep(500)
  const settingsState = await page.evaluate(() => {
    const mover = document.querySelector('.mover')
    if (!mover) return { found: false }
    const style = window.getComputedStyle(mover)
    return {
      found: true,
      display: style.display,
      w: Math.round(mover.getBoundingClientRect().width),
      h: Math.round(mover.getBoundingClientRect().height),
      hasModal: !!mover.querySelector('.modal'),
      modalContent: mover.querySelector('.modal')?.innerHTML?.length || 0,
    }
  })
  console.log(`  Settings: ${JSON.stringify(settingsState)}`)
  await page.screenshot({ path: 'test-final-settings.png' })

  // Close modal
  const closeBtn = await page.$('.mclose')
  if (closeBtn) await closeBtn.click()
  await sleep(300)

  // Take screenshot of each panel for visual proof
  const panels = ['autotrade', 'flow', 'sigreg', 'aria', 'nova', 'aub', 'teacher']
  for (const p of panels) {
    await page.click(`.zd-item[data-dock="${p}"]`)
    await sleep(400)
    await page.screenshot({ path: `test-final-${p}.png` })
    const back = await page.$('.zpv-back')
    if (back) { await back.click(); await sleep(200) }
  }

  console.log(`\nPage errors: ${errors.length}`)
  errors.forEach(e => console.log(`  ${e.substring(0, 150)}`))
  console.log('\n=== FINAL VERIFY DONE ===')
  await browser.close()
}
run().catch(console.error)
