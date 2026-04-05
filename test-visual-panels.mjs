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
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  await page.setCookie({ name: 'zeus_token', value: makeToken(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' })
  await page.goto('http://localhost:5174/app/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  for (let i = 0; i < 120; i++) { await sleep(500); if (await page.evaluate(() => !!window.mainChart)) break }
  await sleep(5000)

  const panels = ['manual-trade','dsl','ares','flow','teacher','aub']
  for (const p of panels) {
    await page.click(`.zd-item[data-dock="${p}"]`)
    await sleep(800)
    await page.screenshot({ path: `audit-panel-${p}.png` })
    const back = await page.$('.zpv-back')
    if (back) { await back.click(); await sleep(400) }
  }

  // Settings modal
  await page.evaluate(() => { openM('msettings'); hubPopulate() })
  await sleep(600)
  await page.screenshot({ path: 'audit-modal-settings.png' })
  await page.evaluate(() => closeM('msettings'))

  console.log('Screenshots saved')
  await browser.close()
}
run().catch(console.error)
