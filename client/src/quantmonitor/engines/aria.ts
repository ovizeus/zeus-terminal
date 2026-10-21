// QM ARIA Engine — Pattern Recognition + MTF Stack — 1:1 from HTML
const w = window as any
import { qmLog } from '../state'
import { computeMtfStack, computeAlignScore, mtfWatch } from './mtf'

export function calcARIA(): void {
  const c = w.S; if (!c) return

  // MTF Stack — din klines ADEVARATE (vezi engines/mtf.ts).
  // [2026-10-21 b295] Inainte se calcula din `c._qmBuf`, un tampon care
  // primeste un pret la fiecare 500 ms: randurile etichetate 5m/15m/30m/1h/4h
  // acopereau in realitate 4/10/20/30/60 de SECUNDE, iar '1D' era hardcodat 0.
  // Se calculeaza INAINTE de ieşirea devreme de mai jos (nu depinde nici de
  // klines, nici de tampon, deci panoul arata orizonturi reale si la pornire)
  // si inainte de detectia de pattern, ca increderea sa foloseasca scorul din
  // ACEST tick. La comutarea de simbol datele vechi sunt ignorate, nu citite
  // ca trend al noului simbol.
  const _mk = c._qmMtfKlines
  const _mtfSrc = _mk && _mk.symbol === (c.symbol || 'BTCUSDT') ? _mk : {}
  c._qmAriaMTF = computeMtfStack(_mtfSrc)
  c._qmMtfAlignScore = computeAlignScore(c._qmAriaMTF)
  c._qmMtfAlignDetailed = { '15m': c._qmAriaMTF['15m'], '1h': c._qmAriaMTF['1h'], '4h': c._qmAriaMTF['4h'] }
  c._qmAriaWatch = mtfWatch(c._qmAriaMTF)

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
    // `_qmMtfAlignScore` n-avea NICIUN scriitor (3 cititori in frame.ts, zero
    // scrieri), deci cadea mereu pe `|| 50` si increderea ieşea constant 48%.
    // Acum scorul e real, pe scala 0..100 pe care o randeaza panoul
    // ("ALIGN SCORE x / 100"). Factorul /4 presupunea o scala 0..240 ca sa
    // atinga plafonul de 95 al autorului; cu 0..100, *0,6 da exact acelasi
    // interval intenţionat, 35..95.
    pat.conf = Math.min(95, Math.round(35 + (c._qmMtfAlignScore || 0) * 0.6))
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

}
