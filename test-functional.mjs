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
  console.log('=== FUNCTIONAL VERIFICATION: DSL / AT / PT ===\n')
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  const logs = []
  const errors = []
  page.on('console', m => logs.push({ type: m.type(), text: m.text() }))
  page.on('pageerror', e => errors.push(e.message || String(e)))

  await page.setCookie({ name: 'zeus_token', value: makeToken(), domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' })
  await page.goto('http://localhost:5173/app/', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(2000)

  // Wait for bridge to complete
  for (let i = 0; i < 80; i++) {
    await sleep(500)
    if (logs.some(l => l.text.includes('startApp() completed'))) break
  }
  // Extra wait for old JS to populate panels after startApp
  await sleep(5000)

  // ═══════════════════════════════════════════════════
  // A. DSL PANEL — FUNCTIONAL VERIFICATION
  // ═══════════════════════════════════════════════════
  console.log('══ A. DSL PANEL ══')
  const dsl = await page.evaluate(() => {
    const zone = document.getElementById('dslZone')
    if (!zone) return { mounted: false }
    return {
      mounted: true,
      // Check inner selectors that old JS dsl.js uses
      hasLiquidBg: !!document.getElementById('dslLiquidBg'),
      hasStatusDot: !!document.getElementById('dslStatusDot'),
      hasToggleBtn: !!document.getElementById('dslToggleBtn'),
      hasLockOverlay: !!document.getElementById('dslLockOverlay'),
      hasAssistBar: !!document.getElementById('dslAssistBar'),
      hasAssistArmBtn: !!document.getElementById('dslAssistArmBtn'),
      hasAssistStatus: !!document.getElementById('dslAssistStatus'),
      hasCascade: !!document.getElementById('dslCascade'),
      hasPositionCards: !!document.getElementById('dslPositionCards'),
      hasWaitingState: !!document.getElementById('dslWaitingState'),
      hasActivatePct: !!document.getElementById('dslActivatePct'),
      hasTrailPct: !!document.getElementById('dslTrailPct'),
      hasExtendPct: !!document.getElementById('dslExtendPct'),
      hasTrailSusPct: !!document.getElementById('dslTrailSusPct'),
      hasActiveCount: !!document.getElementById('dslActiveCount'),
      // Check if old JS populated anything (text content changes)
      toggleBtnText: document.getElementById('dslToggleBtn')?.textContent || '',
      activeCountText: document.getElementById('dslActiveCount')?.textContent || '',
      assistStatusText: document.getElementById('dslAssistStatus')?.textContent || '',
      lockBadgeText: zone.querySelector('.dsl-lock-badge')?.textContent || '',
      // Classes that old JS might change
      zoneClasses: zone.className,
      childCount: zone.children.length,
    }
  })
  console.log(`  MOUNT: ${dsl.mounted ? 'OK' : 'FAIL'}`)
  if (dsl.mounted) {
    const selectors = ['hasLiquidBg', 'hasStatusDot', 'hasToggleBtn', 'hasLockOverlay', 'hasAssistBar',
      'hasAssistArmBtn', 'hasAssistStatus', 'hasCascade', 'hasPositionCards', 'hasWaitingState',
      'hasActivatePct', 'hasTrailPct', 'hasExtendPct', 'hasTrailSusPct', 'hasActiveCount']
    const missing = selectors.filter(s => !dsl[s])
    console.log(`  SELECTORS: ${selectors.length - missing.length}/${selectors.length} found`)
    if (missing.length > 0) console.log(`  MISSING: ${missing.join(', ')}`)
    console.log(`  POPULATION:`)
    console.log(`    toggleBtn: "${dsl.toggleBtnText}"`)
    console.log(`    activeCount: "${dsl.activeCountText}"`)
    console.log(`    assistStatus: "${dsl.assistStatusText}"`)
    console.log(`    lockBadge: "${dsl.lockBadgeText}"`)
    console.log(`    zoneClasses: "${dsl.zoneClasses}"`)
    console.log(`    childCount: ${dsl.childCount}`)
  }

  // ═══════════════════════════════════════════════════
  // B. AT PANEL — FUNCTIONAL VERIFICATION
  // ═══════════════════════════════════════════════════
  console.log('\n══ B. AT PANEL ══')
  const at = await page.evaluate(() => {
    const panel = document.getElementById('atPanel')
    if (!panel) return { mounted: false }
    return {
      mounted: true,
      // Key inner selectors old JS autotrade.js / bootstrap.js uses
      hasAtModeLabel: !!document.getElementById('atModeLabel'),
      hasAtLog: !!document.getElementById('atLog'),
      hasBrainVisionWrap: !!document.getElementById('brainVisionWrap'),
      hasBrainDashWrap: !!document.getElementById('brainDashWrap'),
      // AT sep / control strip
      hasBrainExt: !!document.getElementById('brainExt'),
      hasSessBacktest: !!document.getElementById('sessBacktestBox'),
      hasBrainHeatmap: !!document.getElementById('brainHeatmap'),
      // AT main button
      hasAtMainBtn: !!document.querySelector('.at-center .at-main-btn, #atMainBtn'),
      hasAtStatusText: !!document.querySelector('.at-status-text, #atStatusText'),
      // Kill switch
      hasKillSwitch: !!panel.querySelector('.at-kill'),
      // Check text population
      modeLabelText: document.getElementById('atModeLabel')?.textContent || '',
      atLogContent: document.getElementById('atLog')?.innerHTML?.length || 0,
      panelChildCount: panel.children.length,
      // Check if at-body has real content
      atBodyExists: !!panel.querySelector('.at-body'),
      atBodyChildCount: panel.querySelector('.at-body')?.children.length || 0,
      atHdrText: panel.querySelector('.at-hdr')?.textContent || '',
    }
  })
  console.log(`  MOUNT: ${at.mounted ? 'OK' : 'FAIL'}`)
  if (at.mounted) {
    const selectors = ['hasAtModeLabel', 'hasAtLog', 'hasBrainVisionWrap', 'hasBrainDashWrap',
      'hasBrainExt', 'hasSessBacktest', 'hasBrainHeatmap', 'hasKillSwitch', 'hasAtMainBtn']
    const missing = selectors.filter(s => !at[s])
    console.log(`  SELECTORS: ${selectors.length - missing.length}/${selectors.length} found`)
    if (missing.length > 0) console.log(`  MISSING: ${missing.join(', ')}`)
    console.log(`  POPULATION:`)
    console.log(`    modeLabel: "${at.modeLabelText}"`)
    console.log(`    atLogLength: ${at.atLogContent} chars`)
    console.log(`    atHdr: "${at.atHdrText}"`)
    console.log(`    atBody exists: ${at.atBodyExists}, children: ${at.atBodyChildCount}`)
    console.log(`    panelChildCount: ${at.panelChildCount}`)
  }

  // ═══════════════════════════════════════════════════
  // C. PT PANEL — FUNCTIONAL VERIFICATION
  // ═══════════════════════════════════════════════════
  console.log('\n══ C. PT PANEL ══')
  const pt = await page.evaluate(() => {
    const demo = document.getElementById('panelDemo')
    const live = document.getElementById('panelLive')
    if (!demo && !live) return { mounted: false }
    return {
      mounted: true,
      demoExists: !!demo,
      liveExists: !!live,
      // Mode toggle buttons
      hasBtnDemo: !!document.getElementById('btnDemo'),
      hasBtnLive: !!document.getElementById('btnLive'),
      // Demo panel inner selectors
      hasDemoBalance: !!document.getElementById('demoBalance'),
      hasDemoLongBtn: !!document.getElementById('demoLongBtn'),
      hasDemoShortBtn: !!document.getElementById('demoShortBtn'),
      hasDemoOrdType: !!document.getElementById('demoOrdType'),
      hasDemoMarginMode: !!document.getElementById('demoMarginMode'),
      hasDemoLev: !!document.getElementById('demoLev'),
      hasDemoEntry: !!document.getElementById('demoEntry'),
      hasDemoSize: !!document.getElementById('demoSize'),
      hasDemoTP: !!document.getElementById('demoTP'),
      hasDemoSL: !!document.getElementById('demoSL'),
      hasDemoExec: !!document.getElementById('demoExec'),
      hasDemoPnL: !!document.getElementById('demoPnL'),
      hasDemoWR: !!document.getElementById('demoWR'),
      hasDemoTrades: !!document.getElementById('demoTrades'),
      hasDemoLiqPrice: !!document.getElementById('demoLiqPrice'),
      hasDemoPosTable: !!document.getElementById('demoPosTable'),
      hasJournalBody: !!document.getElementById('journalBody'),
      hasCloseAllBtn: !!document.querySelector('[data-close-id="closeAllBtn"], #closeAllBtn'),
      // Live panel inner selectors
      hasApiSection: !!document.getElementById('apiSection'),
      hasApiStatus: !!document.getElementById('apiStatus'),
      hasBtnConnect: !!document.getElementById('btnConnectExchange'),
      hasLiveOrderForm: !!document.getElementById('liveOrderForm'),
      hasLiveLongBtn: !!document.getElementById('liveLongBtn'),
      hasLiveShortBtn: !!document.getElementById('liveShortBtn'),
      hasLiveOrdType: !!document.getElementById('liveOrdType'),
      hasLiveLev: !!document.getElementById('liveLev'),
      hasLiveSize: !!document.getElementById('liveSize'),
      hasLiveEntry: !!document.getElementById('liveEntry'),
      hasLiveTP: !!document.getElementById('liveTP'),
      hasLiveSL: !!document.getElementById('liveSL'),
      hasLiveLiqPrice: !!document.getElementById('liveLiqPrice'),
      hasLivePositions: !!document.getElementById('livePositions'),
      // Text content (old JS population)
      demoBalanceText: document.getElementById('demoBalance')?.textContent || '',
      demoPnLText: document.getElementById('demoPnL')?.textContent || '',
      demoWRText: document.getElementById('demoWR')?.textContent || '',
      demoTradesText: document.getElementById('demoTrades')?.textContent || '',
      // Old JS might update these via positions.js
      demoSizeVal: (document.getElementById('demoSize'))?.value || '',
    }
  })
  console.log(`  MOUNT: ${pt.mounted ? 'OK' : 'FAIL'}`)
  if (pt.mounted) {
    console.log(`  panelDemo: ${pt.demoExists ? 'YES' : 'NO'}`)
    console.log(`  panelLive: ${pt.liveExists ? 'YES' : 'NO'}`)
    const demoSels = ['hasBtnDemo', 'hasBtnLive', 'hasDemoBalance', 'hasDemoLongBtn', 'hasDemoShortBtn',
      'hasDemoOrdType', 'hasDemoMarginMode', 'hasDemoLev', 'hasDemoEntry', 'hasDemoSize',
      'hasDemoTP', 'hasDemoSL', 'hasDemoExec', 'hasDemoPnL', 'hasDemoWR', 'hasDemoTrades',
      'hasDemoLiqPrice', 'hasJournalBody', 'hasCloseAllBtn']
    const liveSels = ['hasApiSection', 'hasApiStatus', 'hasBtnConnect', 'hasLiveOrderForm',
      'hasLiveLongBtn', 'hasLiveShortBtn', 'hasLiveOrdType', 'hasLiveLev',
      'hasLiveSize', 'hasLiveEntry', 'hasLiveTP', 'hasLiveSL', 'hasLiveLiqPrice', 'hasLivePositions']
    const missingDemo = demoSels.filter(s => !pt[s])
    const missingLive = liveSels.filter(s => !pt[s])
    console.log(`  DEMO SELECTORS: ${demoSels.length - missingDemo.length}/${demoSels.length}`)
    if (missingDemo.length > 0) console.log(`  DEMO MISSING: ${missingDemo.join(', ')}`)
    console.log(`  LIVE SELECTORS: ${liveSels.length - missingLive.length}/${liveSels.length}`)
    if (missingLive.length > 0) console.log(`  LIVE MISSING: ${missingLive.join(', ')}`)
    console.log(`  POPULATION:`)
    console.log(`    balance: "${pt.demoBalanceText}"`)
    console.log(`    pnl: "${pt.demoPnLText}"`)
    console.log(`    winRate: "${pt.demoWRText}"`)
    console.log(`    trades: "${pt.demoTradesText}"`)
    console.log(`    sizeVal: "${pt.demoSizeVal}"`)
  }

  // ═══════════════════════════════════════════════════
  // D. NULL SELECTOR ERRORS
  // ═══════════════════════════════════════════════════
  console.log('\n══ D. CONSOLE ERRORS ══')
  const nullErrors = logs.filter(l =>
    l.type === 'error' && (
      l.text.includes('null') ||
      l.text.includes('undefined') ||
      l.text.includes('Cannot read') ||
      l.text.includes('addEventListener')
    ) && !l.text.includes('403') && !l.text.includes('404')
  )
  console.log(`  Null/selector errors: ${nullErrors.length}`)
  nullErrors.forEach(l => console.log(`  ${l.text.substring(0, 200)}`))

  console.log('\n  Page errors:')
  console.log(`  Count: ${errors.length}`)
  errors.forEach(e => console.log(`  ${e.substring(0, 200)}`))

  // ═══════════════════════════════════════════════════
  // E. OLD JS POPULATION EVIDENCE
  // ═══════════════════════════════════════════════════
  console.log('\n══ E. OLD JS POPULATION EVIDENCE ══')
  const popEvidence = await page.evaluate(() => {
    // Check if old JS has written into panel elements (innerHTML changed from React default)
    const atLog = document.getElementById('atLog')
    const journalBody = document.getElementById('journalBody')
    const demoPosTable = document.getElementById('demoPosTable')
    const dslActiveCount = document.getElementById('dslActiveCount')
    // Check for old JS-created dynamic content
    const dslCards = document.getElementById('dslPositionCards')
    return {
      atLogPopulated: atLog ? atLog.innerHTML.length > 10 : false,
      atLogSample: atLog ? atLog.innerHTML.substring(0, 100) : 'N/A',
      journalPopulated: journalBody ? journalBody.innerHTML.length > 10 : false,
      journalSample: journalBody ? journalBody.innerHTML.substring(0, 100) : 'N/A',
      demoPosPopulated: demoPosTable ? demoPosTable.innerHTML.length > 10 : false,
      dslActiveCountText: dslActiveCount?.textContent || 'N/A',
      dslCardsChildren: dslCards?.children.length || 0,
      // Check if old JS updated balance (from server sync)
      demoBalance: document.getElementById('demoBalance')?.textContent || 'N/A',
      // Check if old JS set ZEUS_STARTED and ran brain
      zeusStarted: window.ZEUS_STARTED === true,
      brainLastRun: window.BM?.core?.lastRunTs > 0,
    }
  })
  for (const [k, v] of Object.entries(popEvidence)) {
    console.log(`  ${k}: ${typeof v === 'string' ? `"${v}"` : v}`)
  }

  // ═══════════════════════════════════════════════════
  // F. DUPLICATE INIT CHECK
  // ═══════════════════════════════════════════════════
  console.log('\n══ F. DUPLICATE INIT CHECK ══')
  const dupLogs = logs.filter(l =>
    l.text.includes('already') || l.text.includes('duplicate') || l.text.includes('twice')
  )
  console.log(`  Duplicate warnings: ${dupLogs.length}`)
  dupLogs.forEach(l => console.log(`  ${l.text.substring(0, 150)}`))

  console.log('\n=== FUNCTIONAL VERIFICATION COMPLETE ===')
  await browser.close()
}
run().catch(console.error)
