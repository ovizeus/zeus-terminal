// Zeus — On-chain proxy metrics (200WMA, Pi Cycle, Puell, Mayer, NUPL, RHODL, S2F, Log Regression, Market Cycle)
// Ported 1:1 from ZeuS Quantitative Monitor HTML
const w = window as any

// ── Weekly klines for 200WMA ──
export async function fetchWeeklyKlines(): Promise<void> {
  try {
    const r = await (await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1w&limit=210')).json()
    if (!w.S) return
    w.S._weeklyKlines = r.map((x: any) => ({ o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5], t: x[0] }))
    calc200WMA()
  } catch (_) { /* silent */ }
}

// ── Daily klines for Pi Cycle, Puell, Mayer, NUPL, RHODL ──
export async function fetchDailyKlines(): Promise<void> {
  try {
    const r = await (await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=500')).json()
    if (!w.S) return
    w.S._dailyKlines = r.map((x: any) => ({ o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5], t: x[0] }))
    calcPiCycle()
    calcPuellMultiple()
    calcMayer200()
    calcNUPL()
    calcRHODLProxy()
  } catch (_) { /* silent */ }
}

function calc200WMA(): void {
  const kl = w.S._weeklyKlines
  if (!kl || kl.length < 10) return
  const data = kl.slice(-200)
  let wSum = 0, vSum = 0
  data.forEach((bar: any, i: number) => { const wt = i + 1; wSum += bar.c * wt; vSum += wt })
  w.S.wma200 = vSum > 0 ? wSum / vSum : 0
  w.S.wmaRatio = w.S.wma200 > 0 ? w.S.price / w.S.wma200 : 0
}

function calcPiCycle(): void {
  const kl = w.S._dailyKlines
  if (!kl || kl.length < 360) return
  const closes = kl.map((x: any) => x.c)
  const sma = (arr: number[], p: number) => arr.slice(-p).reduce((a: number, b: number) => a + b, 0) / p
  w.S.pi111 = sma(closes, 111)
  const arr350 = closes.slice(-350)
  w.S.pi350x2 = arr350.reduce((a: number, b: number) => a + b, 0) / 350 * 2
  w.S.piSignal = w.S.pi111 >= w.S.pi350x2 * 0.995 && w.S.pi111 <= w.S.pi350x2 * 1.005
}

function calcPuellMultiple(): void {
  const kl = w.S._dailyKlines
  if (!kl || kl.length < 370) return
  const dailyBTC = 450 // 3.125 BTC/block × 144 blocks post-4th halving
  const closes = kl.map((x: any) => x.c)
  const dailyRev = closes.map((p: number) => p * dailyBTC)
  const ma365 = dailyRev.slice(-365).reduce((a: number, b: number) => a + b, 0) / 365
  const todayRev = closes[closes.length - 1] * dailyBTC
  w.S.puell = ma365 > 0 ? todayRev / ma365 : 0
  w.S.puellMA365 = ma365
}

export function calcS2F(): void {
  if (!w.S) return
  const annualFlow = 3.125 * 144 * 365 // ~164,025 BTC/yr
  const supply = 19700000 // ~19.7M BTC mined
  const sf = supply / annualFlow
  w.S.s2fValue = sf
  const modelMC = Math.exp(3.31819 * Math.log(sf) + 14.6227)
  w.S.s2fModelPrice = modelMC / supply
  w.S.s2fDeviation = w.S.price > 0 && w.S.s2fModelPrice > 0 ? ((w.S.price - w.S.s2fModelPrice) / w.S.s2fModelPrice * 100) : 0
}

export function calcLogRegression(): void {
  if (!w.S || !w.S.price) return
  const genesis = new Date('2009-01-03').getTime()
  const days = (Date.now() - genesis) / 86400000
  const logD = Math.log10(days)
  w.S.logRegLow = Math.pow(10, 5.84 * logD - 17.01)
  w.S.logRegMid = Math.pow(10, 5.84 * logD - 16.38)
  w.S.logRegHigh = Math.pow(10, 5.84 * logD - 15.75)
  if (w.S.price >= w.S.logRegLow && w.S.price <= w.S.logRegHigh) {
    w.S.logRegPos = Math.round((Math.log10(w.S.price) - Math.log10(w.S.logRegLow)) / (Math.log10(w.S.logRegHigh) - Math.log10(w.S.logRegLow)) * 100)
  } else if (w.S.price < w.S.logRegLow) w.S.logRegPos = 0
  else w.S.logRegPos = 100
}

function calcMayer200(): void {
  const kl = w.S._dailyKlines
  if (!kl || kl.length < 200) return
  const closes = kl.map((x: any) => x.c)
  w.S.mayer200dma = closes.slice(-200).reduce((a: number, b: number) => a + b, 0) / 200
  w.S.mayerMultiple = w.S.mayer200dma > 0 ? w.S.price / w.S.mayer200dma : 0
}

function calcNUPL(): void {
  const kl = w.S._dailyKlines
  if (!kl || kl.length < 200) return
  const closes = kl.map((x: any) => x.c)
  const ma200 = closes.slice(-200).reduce((a: number, b: number) => a + b, 0) / 200
  const ma30 = closes.slice(-30).reduce((a: number, b: number) => a + b, 0) / 30
  w.S.realizedProxy = ma200 * 0.7 + ma30 * 0.3
  w.S.nupl = w.S.price > 0 ? ((w.S.price - w.S.realizedProxy) / w.S.price * 100) : 0
}

function calcRHODLProxy(): void {
  const kl = w.S._dailyKlines
  if (!kl || kl.length < 90) return
  const closes = kl.map((x: any) => x.c)
  const ma7 = closes.slice(-7).reduce((a: number, b: number) => a + b, 0) / 7
  const ma90 = closes.slice(-90).reduce((a: number, b: number) => a + b, 0) / 90
  const ratio = ma7 / ma90
  w.S.rhodlScore = Math.min(100, Math.max(0, Math.round((ratio - 0.8) / 0.6 * 100)))
}

export function calcMarketCycle(): void {
  if (!w.S) return
  const halvings = [
    new Date('2009-01-03'), new Date('2012-11-28'),
    new Date('2016-07-09'), new Date('2020-05-11'),
    new Date('2024-04-20'), new Date('2028-04-20')
  ]
  const now = Date.now()
  let cycleStart = halvings[0], cycleEnd = halvings[1]
  for (let i = 0; i < halvings.length - 1; i++) {
    if (now >= halvings[i].getTime() && now < halvings[i + 1].getTime()) {
      cycleStart = halvings[i]; cycleEnd = halvings[i + 1]; break
    }
  }
  const total = cycleEnd.getTime() - cycleStart.getTime()
  const elapsed = now - cycleStart.getTime()
  w.S.cyclePct = Math.min(100, Math.max(0, elapsed / total * 100))
  w.S.cycleDaysElapsed = Math.floor(elapsed / 86400000)
  w.S.cycleDaysRemain = Math.max(0, Math.floor((cycleEnd.getTime() - now) / 86400000))
  const p = w.S.cyclePct
  if (p < 15) { w.S.cyclePhase = 'ACCUMULATION'; w.S.cyclePhaseClr = 'c' }
  else if (p < 35) { w.S.cyclePhase = 'EARLY MARKUP'; w.S.cyclePhaseClr = 'g' }
  else if (p < 55) { w.S.cyclePhase = 'BULL MARKUP'; w.S.cyclePhaseClr = 'gb' }
  else if (p < 70) { w.S.cyclePhase = 'EUPHORIA'; w.S.cyclePhaseClr = 'yb' }
  else if (p < 80) { w.S.cyclePhase = 'DISTRIBUTION'; w.S.cyclePhaseClr = 'y' }
  else if (p < 90) { w.S.cyclePhase = 'CAPITULATION'; w.S.cyclePhaseClr = 'rb' }
  else { w.S.cyclePhase = 'BOTTOM FORM'; w.S.cyclePhaseClr = 'r' }
}
