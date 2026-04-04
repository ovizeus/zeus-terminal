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
  const logs = []
  page.on('console', m => logs.push(m.text()))
  await page.setCookie({ name: 'zeus_token', value: makeToken(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' })
  await page.goto('http://localhost:5174/app/', { waitUntil: 'networkidle2', timeout: 60000 })
  for (let i = 0; i < 80; i++) { await sleep(500); if (logs.some(l => l.includes('startApp() completed'))) break }
  await sleep(3000)

  // Check which panel inner elements are inside vs outside their correct React wrappers
  const check = await page.evaluate(() => {
    const panels = [
      { dock: 'autotrade', innerId: 'atPanel' },
      { dock: 'manual-trade', innerId: null, innerClass: 'trade-panel' },
      { dock: 'dsl', innerId: 'dslZone' },
      { dock: 'ares', innerId: 'ares-strip' },
      { dock: 'postmortem', innerId: 'pm-strip' },
      { dock: 'pnllab', innerId: 'pnl-lab-strip' },
      { dock: 'aria', innerId: 'aria-strip' },
      { dock: 'nova', innerId: 'nova-strip' },
      { dock: 'adaptive', innerId: 'adaptive-sec' },
      { dock: 'flow', innerId: 'flow-panel' },
      { dock: 'mtf', innerId: 'mtf-strip-panel' },
      { dock: 'teacher', innerId: 'teacher-strip' },
      { dock: 'sigreg', innerId: 'sr-strip' },
      { dock: 'activity', innerId: 'actfeed-strip' },
      { dock: 'aub', innerId: 'aub' },
    ]
    const results = []
    for (const p of panels) {
      const wrapper = document.querySelector(`[data-panel-id="${p.dock}"]`)
      const inner = p.innerId ? document.getElementById(p.innerId) : document.querySelector(`.${p.innerClass}`)
      if (!inner) { results.push({ dock: p.dock, id: p.innerId || p.innerClass, status: 'MISSING' }); continue }
      const isInsideWrapper = wrapper ? wrapper.contains(inner) : false
      const actualParentPanel = inner.closest('[data-panel-id]')?.getAttribute('data-panel-id') || 'DIRECT-IN-GROUPS'
      results.push({ dock: p.dock, id: p.innerId || p.innerClass, insideCorrectWrapper: isInsideWrapper, actualParent: actualParentPanel })
    }
    return results
  })

  for (const r of check) {
    const ok = r.insideCorrectWrapper
    console.log(`${ok === undefined ? 'MISSING' : ok ? 'OK' : 'MOVED'} | ${r.dock.padEnd(14)} | ${(r.id || '').padEnd(18)} | actual parent: ${r.actualParent || r.status}`)
  }

  await browser.close()
}
run().catch(console.error)
