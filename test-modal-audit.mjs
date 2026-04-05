import puppeteer from 'puppeteer-core'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = ms => new Promise(r => setTimeout(r, ms))
function makeToken() {
  const jwt = require('jsonwebtoken')
  return jwt.sign({ id: 1, email: 'test@test.com', role: 'admin', tokenVersion: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' })
}

// Modal definitions: id, old JS open function, key inner IDs that must exist, buttons that need onclick
const MODALS = [
  { id: 'msettings', name: 'Settings Hub', openFn: "openM('msettings');hubPopulate()",
    innerIds: ['hubCloudEmail','hubNotifyEnabled','themeSelect','hubUiScale','pinStatus','pinInput','chpwCurrent','chpwNew','exStatus','exApiKey','exApiSecret','exModeLive','exModeTestnet','hubTgBotToken','hubTgChatId','hubTgStatus','hubAlertMaster','zlog-counter'],
    buttons: ['hubSaveAll','hubLoadAll','hubResetDefaults','hubTgSave','hubTgTest','zeusExchangeSave','zeusExchangeVerify','pinActivateBtn','pinRemoveBtn','chpwRequestBtn','chemRequestBtn','clacRequestBtn'] },
  { id: 'madmin', name: 'Admin', openFn: "openM('madmin');zeusLoadAdmin()",
    innerIds: ['adminSearch','adminCounters','adminUsersList','adminAuditList','adminPendingList'],
    buttons: [] },
  { id: 'mnotifications', name: 'Notifications', openFn: "openM('mnotifications')",
    innerIds: ['nc-list'],
    buttons: [] },
  { id: 'mcloud', name: 'Cloud Sync', openFn: "openM('mcloud')",
    innerIds: ['cloudStatus','cloudEmail','cloudMsg'],
    buttons: [] },
  { id: 'malerts', name: 'Alerts', openFn: "openM('malerts')",
    innerIds: ['alertMaster','aVolSpike','aVolThresh','aWhaleOrders','aWhaleMin','aLiqEn','aLiqMin','aDivEn','aRSIEn','aRSIOB','aRSIOS'],
    buttons: [] },
  { id: 'mcharts', name: 'Chart Settings', openFn: "openM('mcharts')",
    innerIds: ['ccBull','ccBear','ccBullW','ccBearW','ccPriceText','ccPriceBg','hmLookback','hmAtrLen','roTimeDisplay'],
    buttons: [] },
  { id: 'mliq', name: 'Liq Settings', openFn: "openM('mliq')",
    innerIds: [],
    buttons: [] },
  { id: 'mllv', name: 'LLV Settings', openFn: "openM('mllv')",
    innerIds: [],
    buttons: [] },
  { id: 'mzs', name: 'Supremus', openFn: "openM('mzs')",
    innerIds: [],
    buttons: [] },
  { id: 'msr', name: 'S/R Settings', openFn: "openM('msr')",
    innerIds: [],
    buttons: [] },
  { id: 'oviPanel', name: 'OVI', openFn: "el('oviPanel').style.display='block'",
    innerIds: ['oviLookback','oviPivotW','oviAtrLen','oviAtrBand','oviExtend','oviContrast','oviWeightMode','oviLongCol','oviShortCol'],
    buttons: [] },
  { id: 'mwelcome', name: 'Welcome', openFn: "openM('mwelcome')",
    innerIds: ['wlcGreeting','wlcModeBadge','wlcVersion','wlcBalance','wlcDailyPnl','wlcTrades','wlcWinRate','wlcPositions','wlcAT','wlcBrain','wlcEnterBtn'],
    buttons: ['wlcEnterBtn'] },
  { id: 'cmdPalette', name: 'Command Palette', openFn: "_toggleCmdPalette()",
    innerIds: ['cmdInput','cmdResults'],
    buttons: [] },
  { id: 'exposurePanel', name: 'Exposure', openFn: "_toggleExposurePanel()",
    innerIds: ['exposureContent'],
    buttons: [] },
  { id: 'dlogPanel', name: 'Decision Log', openFn: "_toggleDecisionPanel()",
    innerIds: ['dlogFilters','dlogStats','dlogList'],
    buttons: [] },
]

async function run() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  MODAL FUNCTIONAL AUDIT                                  ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message || String(e)))

  await page.setCookie({ name: 'zeus_token', value: makeToken(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' })
  await page.goto('http://localhost:5174/app/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  for (let i = 0; i < 120; i++) { await sleep(500); if (await page.evaluate(() => typeof window.openM === 'function')) break }
  await sleep(5000)

  const results = []

  for (const modal of MODALS) {
    const r = { name: modal.name, id: modal.id, inDom: false, opens: false, innerIds: {}, missingIds: [], populatedIds: [], errors: [] }

    // 1. Check in DOM before open
    r.inDom = await page.evaluate(id => !!document.getElementById(id), modal.id)

    // 2. Try to open
    try {
      await page.evaluate(fn => { try { eval(fn) } catch(e) { return e.message } }, modal.openFn)
      await sleep(800)
      r.opens = await page.evaluate(id => {
        const el = document.getElementById(id)
        return el ? getComputedStyle(el).display !== 'none' : false
      }, modal.id)
    } catch (e) { r.errors.push('open: ' + e.message) }

    // 3. Check inner IDs
    for (const innerId of modal.innerIds) {
      const state = await page.evaluate(id => {
        const el = document.getElementById(id)
        if (!el) return { exists: false }
        const val = el.value || el.textContent || el.innerHTML
        return { exists: true, hasContent: val.trim().length > 0, tag: el.tagName, excerpt: val.substring(0, 40) }
      }, innerId)

      r.innerIds[innerId] = state
      if (!state.exists) r.missingIds.push(innerId)
      else if (state.hasContent) r.populatedIds.push(innerId)
    }

    // 4. Check button IDs
    for (const btnId of modal.buttons) {
      const exists = await page.evaluate(id => !!document.getElementById(id), btnId)
      if (!exists) r.missingIds.push(btnId + ' (btn)')
    }

    // 5. Close modal
    try {
      await page.evaluate(id => {
        const el = document.getElementById(id)
        if (el) el.style.display = 'none'
      }, modal.id)
      await sleep(200)
    } catch {}

    // 6. Verify closed
    const stillOpen = await page.evaluate(id => {
      const el = document.getElementById(id)
      return el ? getComputedStyle(el).display !== 'none' : false
    }, modal.id)
    r.closes = !stillOpen

    results.push(r)

    // Print per-modal
    const status = r.inDom && r.opens && r.closes && r.missingIds.length === 0 ? 'OK' : 'ISSUE'
    console.log(`\n══ ${modal.name} (${modal.id}) — ${status} ══`)
    console.log(`  in DOM: ${r.inDom}  opens: ${r.opens}  closes: ${r.closes}`)
    console.log(`  inner IDs: ${Object.keys(r.innerIds).length} checked, ${r.missingIds.length} missing, ${r.populatedIds.length} populated`)
    if (r.missingIds.length) console.log(`  MISSING: ${r.missingIds.join(', ')}`)
    if (r.errors.length) console.log(`  ERRORS: ${r.errors.join('; ')}`)
  }

  // Summary
  console.log('\n\n╔══════════════════════════════════════════════════════════╗')
  console.log('║  SUMMARY                                                 ║')
  console.log('╚══════════════════════════════════════════════════════════╝')

  console.log('\nModal            | DOM | Open | Close | Missing | Populated | Status')
  console.log('─'.repeat(80))
  for (const r of results) {
    const status = r.inDom && r.opens && r.closes && r.missingIds.length === 0 ? 'OK' : 'FIX'
    console.log(`${r.name.padEnd(17)}| ${r.inDom?'Y':'N'}   | ${r.opens?'Y':'N'}    | ${r.closes?'Y':'N'}     | ${String(r.missingIds.length).padEnd(8)}| ${String(r.populatedIds.length).padEnd(10)}| ${status}`)
  }

  const ok = results.filter(r => r.inDom && r.opens && r.closes && r.missingIds.length === 0).length
  console.log(`\n${ok}/${results.length} modals fully OK`)
  console.log(`Page errors: ${pageErrors.length}`)
  pageErrors.slice(0,3).forEach(e => console.log(`  ${e.substring(0,120)}`))

  await browser.close()
}
run().catch(console.error)
