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

  // Test FLOW
  console.log('=== FLOW DEBUG ===')
  await page.click('.zd-item[data-dock="flow"]')
  await sleep(600)

  const cdp = await page.createCDPSession()
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')

  // Get #flow-panel node
  const { root } = await cdp.send('DOM.getDocument')
  const { nodeId: flowNodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#flow-panel' })
  console.log('flow-panel nodeId:', flowNodeId)

  if (flowNodeId) {
    const { matchedCSSRules } = await cdp.send('CSS.getMatchedStylesForNode', { nodeId: flowNodeId })
    const displayRules = matchedCSSRules.filter(r => r.rule.selectorList && r.rule.style.cssProperties.some(p => p.name === 'display'))
    for (const r of displayRules) {
      const sel = r.rule.selectorList.text
      const disp = r.rule.style.cssProperties.find(p => p.name === 'display')
      const origin = r.rule.origin
      const src = r.rule.style.styleSheetId ? 'stylesheet' : 'inline'
      console.log(`  ${sel} → display: ${disp?.value}${disp?.important ? ' !important' : ''} [${origin}]`)
    }
  }

  // Check wrapper class
  const flowDebug = await page.evaluate(() => {
    const wrapper = document.querySelector('[data-panel-id="flow"]')
    const fp = document.getElementById('flow-panel')
    return {
      wrapperClass: wrapper?.className,
      wrapperInZeusGroups: wrapper?.parentElement?.id,
      fpParent: fp?.parentElement?.getAttribute('data-panel-id'),
      fpComputed: fp ? window.getComputedStyle(fp).display : 'N/A',
      fpClassList: fp?.className,
    }
  })
  console.log('Flow debug:', JSON.stringify(flowDebug, null, 2))

  // Close and test Signals
  const backBtn = await page.$('.zpv-back')
  if (backBtn) { await backBtn.click(); await sleep(300) }

  console.log('\n=== SIGNALS DEBUG ===')
  await page.click('.zd-item[data-dock="sigreg"]')
  await sleep(600)

  const { nodeId: srNodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#sr-strip' })
  console.log('sr-strip nodeId:', srNodeId)

  if (srNodeId) {
    const { matchedCSSRules } = await cdp.send('CSS.getMatchedStylesForNode', { nodeId: srNodeId })
    const displayRules = matchedCSSRules.filter(r => r.rule.selectorList && r.rule.style.cssProperties.some(p => p.name === 'display'))
    for (const r of displayRules) {
      const sel = r.rule.selectorList.text
      const disp = r.rule.style.cssProperties.find(p => p.name === 'display')
      console.log(`  ${sel} → display: ${disp?.value}${disp?.important ? ' !important' : ''}`)
    }
  }

  const srDebug = await page.evaluate(() => {
    const wrapper = document.querySelector('[data-panel-id="sigreg"]')
    const sr = document.getElementById('sr-strip')
    return {
      wrapperClass: wrapper?.className,
      srComputed: sr ? window.getComputedStyle(sr).display : 'N/A',
      srClassList: sr?.className,
    }
  })
  console.log('SR debug:', JSON.stringify(srDebug, null, 2))

  await browser.close()
}
run().catch(console.error)
