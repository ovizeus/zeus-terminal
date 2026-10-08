#!/usr/bin/env npx tsx
/**
 * Screenshot the page generate.ts produced, into docs/terminator-live.png.
 * Serves the folder on a loopback port, drives headless Chrome, then tears
 * everything down — no browser and no server are left behind (the box has been
 * starved by leftover Chrome before).
 */
import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
// playwright-core is NOT a project dependency — screenshotting is optional.
// Without it the page is still served and can simply be opened in a browser.
let chromium: any = null
try { ({ chromium } = require('playwright-core')) } catch { /* optional */ }

const DIR = path.join(__dirname, 'out')
const OUT = path.join(__dirname, '..', '..', 'docs', 'terminator-live.png')
const PORT = 8791
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }

async function main() {
  if (!fs.existsSync(path.join(DIR, 'data.json'))) {
    throw new Error('rulează întâi: npx tsx scripts/verify-terminator/generate.ts')
  }
  const server = http.createServer((req, res) => {
    const f = path.join(DIR, (req.url || '/').split('?')[0] === '/' ? 'index.html' : (req.url || '').slice(1))
    if (!f.startsWith(DIR) || !fs.existsSync(f)) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' })
    fs.createReadStream(f).pipe(res)
  })
  await new Promise<void>((ok) => server.listen(PORT, '127.0.0.1', ok))

  // Chrome refuses to run as root with its sandbox on; this is a throwaway
  // render of local files, so the sandbox is off deliberately.
  if (!chromium) {
    console.log(`Pagina e servită pe http://127.0.0.1:${PORT}/index.html — deschide-o în browser.`)
    console.log('(Pentru PNG automat: npm i -D playwright-core, apoi rulează din nou.)')
    console.log('Ctrl+C când ai terminat.')
    return
  }
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/opt/google/chrome/chrome',
    chromiumSandbox: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1240, height: 680 } })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
    await page.screenshot({ path: OUT })
    console.log('✔ ' + OUT + (errors.length ? ' | erori pagină: ' + errors.join('; ') : ''))
  } finally {
    await browser.close()
    server.close()
  }
}
main().catch((e) => { console.error('EROARE:', e.message); process.exit(1) })
