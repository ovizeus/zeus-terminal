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

  // Check for DUPLICATE IDs
  const dupCheck = await page.evaluate(() => {
    const ids = ['flow-panel', 'sr-strip', 'of-hud', 'flow-panel-body', 'flow-panel-hdr',
                 'sr-sec', 'sr-list', 'sr-strip-bar', 'sr-strip-panel']
    const result = {}
    for (const id of ids) {
      const all = document.querySelectorAll(`#${id}`)
      result[id] = {
        count: all.length,
        locations: [...all].map(el => {
          let path = ''
          let cur = el
          for (let i = 0; i < 5 && cur; i++) {
            const tag = cur.tagName?.toLowerCase() || '?'
            const cid = cur.id ? '#' + cur.id : ''
            const pid = cur.getAttribute?.('data-panel-id') || ''
            path = `${tag}${cid}${pid ? '[data-panel-id=' + pid + ']' : ''}` + (path ? ' > ' + path : '')
            cur = cur.parentElement
          }
          return path
        })
      }
    }
    return result
  })

  for (const [id, info] of Object.entries(dupCheck)) {
    if (info.count > 1 || info.count === 0) {
      console.log(`${info.count === 0 ? 'MISSING' : 'DUPLICATE'}: #${id} (${info.count} found)`)
      info.locations.forEach(l => console.log(`  → ${l}`))
    } else {
      console.log(`OK: #${id} (1 found) → ${info.locations[0]}`)
    }
  }

  await browser.close()
}
run().catch(console.error)
