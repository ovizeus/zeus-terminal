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
  await page.setCookie({ name: 'zeus_token', value: makeToken(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' })
  await page.goto('http://localhost:5174/app/', { waitUntil: 'networkidle2', timeout: 60000 })
  for (let i = 0; i < 80; i++) { await sleep(500); if (logs.some(l => l.includes('startApp() completed'))) break }
  await sleep(3000)

  await page.click('.zd-item[data-dock="aub"]')
  await sleep(600)

  // Check all 8 cards
  const aubDebug = await page.evaluate(() => {
    const aub = document.getElementById('aub')
    const aubBody = document.getElementById('aub-body')
    const aubHdr = document.getElementById('aub-hdr')
    const wrapper = document.querySelector('[data-panel-id="aub"]')

    // Check #aub computed styles
    const aubStyle = aub ? window.getComputedStyle(aub) : null
    const bodyStyle = aubBody ? window.getComputedStyle(aubBody) : null
    const hdrStyle = aubHdr ? window.getComputedStyle(aubHdr) : null

    // All cards
    const cards = document.querySelectorAll('.aub-card')
    const cardInfo = [...cards].map(c => {
      const s = window.getComputedStyle(c)
      const r = c.getBoundingClientRect()
      return {
        id: c.id,
        display: s.display,
        visibility: s.visibility,
        opacity: s.opacity,
        w: Math.round(r.width),
        h: Math.round(r.height),
        top: Math.round(r.top),
        title: c.querySelector('.aub-card-title')?.textContent || '',
      }
    })

    return {
      // #aub element
      aubDisplay: aubStyle?.display,
      aubMaxHeight: aubStyle?.maxHeight,
      aubOverflow: aubStyle?.overflow,
      aubClass: aub?.className,
      aubH: Math.round(aub?.getBoundingClientRect().height || 0),

      // #aub-hdr
      hdrDisplay: hdrStyle?.display,

      // #aub-body
      bodyDisplay: bodyStyle?.display,
      bodyGrid: bodyStyle?.gridTemplateColumns,
      bodyH: Math.round(aubBody?.getBoundingClientRect().height || 0),
      bodyOverflow: bodyStyle?.overflow,
      bodyMaxHeight: bodyStyle?.maxHeight,

      // wrapper
      wrapperClass: wrapper?.className,

      // cards
      cardCount: cards.length,
      cards: cardInfo,
    }
  })

  console.log('=== AUB DEBUG ===')
  console.log(`#aub: display=${aubDebug.aubDisplay} class="${aubDebug.aubClass}" maxHeight=${aubDebug.aubMaxHeight} overflow=${aubDebug.aubOverflow} h=${aubDebug.aubH}`)
  console.log(`#aub-hdr: display=${aubDebug.hdrDisplay}`)
  console.log(`#aub-body: display=${aubDebug.bodyDisplay} grid="${aubDebug.bodyGrid}" h=${aubDebug.bodyH} overflow=${aubDebug.bodyOverflow} maxHeight=${aubDebug.bodyMaxHeight}`)
  console.log(`wrapper: class="${aubDebug.wrapperClass}"`)
  console.log(`Cards: ${aubDebug.cardCount}`)
  for (const c of aubDebug.cards) {
    const vis = c.display !== 'none' && c.h > 0
    console.log(`  ${vis ? 'VIS' : 'HIDDEN'} ${c.id.padEnd(18)} ${c.title.padEnd(25)} ${c.display.padEnd(8)} ${c.w}x${c.h} top=${c.top} opacity=${c.opacity}`)
  }

  // CDP check matched styles on #aub-body
  const cdp = await page.createCDPSession()
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root } = await cdp.send('DOM.getDocument')
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#aub-body' })
  if (nodeId) {
    const { matchedCSSRules } = await cdp.send('CSS.getMatchedStylesForNode', { nodeId })
    const relevant = matchedCSSRules.filter(r => {
      const props = r.rule.style.cssProperties
      return props.some(p => ['display', 'grid-template-columns', 'max-height', 'overflow', 'height'].includes(p.name))
    })
    console.log('\n=== CDP: #aub-body matched rules ===')
    for (const r of relevant) {
      const sel = r.rule.selectorList?.text || '?'
      const props = r.rule.style.cssProperties
        .filter(p => ['display', 'grid-template-columns', 'max-height', 'overflow', 'height'].includes(p.name))
        .map(p => `${p.name}: ${p.value}${p.important ? ' !important' : ''}`)
        .join('; ')
      console.log(`  ${sel} → ${props}`)
    }
  }

  // Also check #aub itself
  const { nodeId: aubNodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#aub' })
  if (aubNodeId) {
    const { matchedCSSRules } = await cdp.send('CSS.getMatchedStylesForNode', { nodeId: aubNodeId })
    const relevant = matchedCSSRules.filter(r => {
      const props = r.rule.style.cssProperties
      return props.some(p => ['display', 'max-height', 'overflow'].includes(p.name))
    })
    console.log('\n=== CDP: #aub matched rules ===')
    for (const r of relevant) {
      const sel = r.rule.selectorList?.text || '?'
      const props = r.rule.style.cssProperties
        .filter(p => ['display', 'max-height', 'overflow'].includes(p.name))
        .map(p => `${p.name}: ${p.value}${p.important ? ' !important' : ''}`)
        .join('; ')
      console.log(`  ${sel} → ${props}`)
    }
  }

  await browser.close()
}
run().catch(console.error)
