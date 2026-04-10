// QM ARIA Engine — Pattern Recognition + MTF Stack — 1:1 from HTML
const w = window as any
import { qmLog } from '../state'

export function calcARIA(): void {
  const c = w.S; if (!c) return
  const kl = c.klines; const buf = c._qmBuf || []
  if (!kl || kl.length < 15 || buf.length < 20) return
  const now = Date.now()
  c._qmAriaPatterns = c._qmAriaPatterns || []
  const avgVol = kl.slice(-20).reduce((s: number, x: any) => s + x.v, 0) / 20 || 1
  const recent = kl.slice(-10)
  const hs = recent.map((x: any) => x.h), ls = recent.map((x: any) => x.l), cs = recent.map((x: any) => x.c)
  const prevH = Math.max(...hs.slice(0, -2)), prevL = Math.min(...ls.slice(0, -2))
  const lh = hs[hs.length - 1], ll = ls[ls.length - 1], lc = cs[cs.length - 1]
  const lv = recent[recent.length - 1].v
  let pat: any = null

  if (lh > prevH * 1.0004 && lc < prevH) pat = { name: 'Liquidity Sweep', side: 'BEAR', shape: 'sweep_high' }
  else if (ll < prevL * 0.9996 && lc > prevL) pat = { name: 'Liquidity Sweep', side: 'BULL', shape: 'sweep_low' }
  else if (lh > prevH && lv < avgVol * 0.7 && lc < (lh + ll) / 2) pat = { name: 'Upthrust', side: 'BEAR', shape: 'upthrust' }
  else if (ll < prevL && lv < avgVol * 0.7 && lc > (lh + ll) / 2) pat = { name: 'Spring', side: 'BULL', shape: 'spring' }
  else if (c._qmAbsorption?.detected && lv > avgVol * 2.0) pat = { name: 'Absorption', side: c._qmAbsorption.side === 'BID' ? 'BULL' : 'BEAR', shape: 'absorb' }
  else if (c._qmBbSqueeze && c._qmRegime === 'RANGING') pat = { name: 'Inside Squeeze', side: 'NEUT', shape: 'squeeze' }

  if (pat) {
    pat.conf = Math.min(95, Math.round(35 + (c._qmMtfAlignScore || 50) / 4))
    pat.tf = '15m'; pat.time = now
    const last = c._qmAriaPatterns[c._qmAriaPatterns.length - 1]
    if (!last || last.name !== pat.name || now - last.time > 90000) {
      c._qmAriaPatterns.push(pat)
      if (c._qmAriaPatterns.length > 5) c._qmAriaPatterns.shift()
      qmLog('AI', `ARIA ${pat.name} [${pat.side}] ${pat.conf}% @ $${c.price.toFixed(2)}`)
    }
  }
  c._qmAriaCurrentPat = c._qmAriaPatterns[c._qmAriaPatterns.length - 1] || null

  // Candle reading
  const lk = kl[kl.length - 1]
  const body = Math.abs(lk.c - lk.o), rng = lk.h - lk.l || 0.001
  const br = body / rng
  c._qmAriaCandleType = br > 0.6 ? (lk.c > lk.o ? 'bullish' : 'bearish') : (br > 0.3 ? 'indecision' : 'doji')
  c._qmAriaCandleVol = lk.v > avgVol * 1.5 ? 'high' : lk.v < avgVol * 0.5 ? 'low' : 'flat'

  // MTF Stack
  const ema = (d: number[], p: number) => { if (d.length < p) return d[d.length - 1]; const k = 2 / (p + 1); let v = d[0]; for (let i = 1; i < d.length; i++) v = d[i] * k + v * (1 - k); return v }
  const sl = (n: number) => buf.slice(-Math.min(n, buf.length))
  c._qmAriaMTF = {
    '5m': buf.length >= 8 ? (ema(sl(8), 3) > ema(sl(8), 6) ? 1 : -1) : 0,
    '15m': buf.length >= 20 ? (ema(sl(20), 5) > ema(sl(20), 12) ? 1 : -1) : 0,
    '30m': buf.length >= 40 ? (ema(sl(40), 8) > ema(sl(40), 20) ? 1 : -1) : 0,
    '1h': buf.length >= 60 ? (ema(sl(60), 10) > ema(sl(60), 30) ? 1 : -1) : 0,
    '4h': buf.length >= 120 ? (ema(sl(120), 15) > ema(sl(120), 40) ? 1 : -1) : 0,
    '1D': 0
  }
  const bullTFs = Object.values(c._qmAriaMTF).filter((v: any) => v === 1).length
  const bearTFs = Object.values(c._qmAriaMTF).filter((v: any) => v === -1).length
  c._qmAriaWatch = bullTFs >= 4 ? 'BULL' : bearTFs >= 4 ? 'BEAR' : 'WATCH'
}
