// QM Wyckoff Phase Detector + CVD Divergence + Volume Profile — 1:1 from HTML
const w = window as any

export function calcWyckoff(): void {
  const c = w.S; if (!c) return
  const kl = c.klines; const buf = c._qmBuf || []
  if (!kl || kl.length < 20 || buf.length < 20) { c._qmWyckoffPhase = 'UNKNOWN'; return }
  const avgVol = kl.slice(-20).reduce((s: number, x: any) => s + x.v, 0) / 20 || 1
  const recent = kl.slice(-15)
  const hs = recent.map((x: any) => x.h), ls = recent.map((x: any) => x.l), cs = recent.map((x: any) => x.c), vs = recent.map((x: any) => x.v)
  const prevH = Math.max(...hs.slice(0, -3)), prevL = Math.min(...ls.slice(0, -3))
  const lh = hs[hs.length - 1], ll = ls[ls.length - 1], lc = cs[cs.length - 1], lv = vs[vs.length - 1]
  const pc = cs[cs.length - 2]
  const atr = c.atr || 100

  if (ll < prevL * 0.9997 && lc > prevL && lv > avgVol * 1.3) { c._qmWyckoffEvent = 'SPRING'; c._qmWyckoffPhase = 'ACCUM'; c._qmWyckoffBias = 'BULL' }
  else if (lh > prevH * 1.0003 && lc < prevH && lv > avgVol * 1.3) { c._qmWyckoffEvent = 'UPTHRUST'; c._qmWyckoffPhase = 'DISTRIB'; c._qmWyckoffBias = 'BEAR' }
  else if (ll > prevL && lc > pc && lv < avgVol * 0.8 && buf[buf.length - 1] > buf[buf.length - 10]) { c._qmWyckoffEvent = 'LPS'; c._qmWyckoffPhase = 'MARKUP'; c._qmWyckoffBias = 'BULL' }
  else if (lh < prevH && lc < pc && lv < avgVol * 0.8 && buf[buf.length - 1] < buf[buf.length - 10]) { c._qmWyckoffEvent = 'LPSY'; c._qmWyckoffPhase = 'MARKDOWN'; c._qmWyckoffBias = 'BEAR' }
  else if ((lh - ll) > atr * 2.5 && lc > (lh + ll) / 2 && lv > avgVol * 2) { c._qmWyckoffEvent = 'SHAKEOUT'; c._qmWyckoffPhase = 'ACCUM'; c._qmWyckoffBias = 'BULL' }
  else if (lc > prevH && lv > avgVol * 1.5) { c._qmWyckoffEvent = 'SOS'; c._qmWyckoffPhase = 'MARKUP'; c._qmWyckoffBias = 'BULL' }
  else if (lc < prevL && lv > avgVol * 1.5) { c._qmWyckoffEvent = 'SOW'; c._qmWyckoffPhase = 'MARKDOWN'; c._qmWyckoffBias = 'BEAR' }
  else { c._qmWyckoffEvent = '\u2500'; c._qmWyckoffBias = 'NEUT' }
}

export function calcCVDDivergence(): void {
  const c = w.S; if (!c) return
  const buf = c._qmBuf || []; const dh = c._qmDeltaHist || []
  if (buf.length < 20 || dh.length < 20) { c._qmCvdDivergence = 'NONE'; return }
  const N = Math.min(20, buf.length, dh.length)
  const pOld = buf[buf.length - N], pNew = buf[buf.length - 1]
  const dOld = dh[dh.length - N], dNew = dh[dh.length - 1]
  const pUp = pNew > pOld * 1.0002, pDn = pNew < pOld * 0.9998
  const dUp = dNew > dOld + 0.01, dDn = dNew < dOld - 0.01
  if (pUp && dDn) { c._qmCvdDivergence = 'BEARISH'; c._qmCvdDivDir = 'Price\u2191 CVD\u2193' }
  else if (pDn && dUp) { c._qmCvdDivergence = 'BULLISH'; c._qmCvdDivDir = 'Price\u2193 CVD\u2191' }
  else { c._qmCvdDivergence = 'NONE'; c._qmCvdDivDir = '' }
}

export function calcVolumeProfile(): void {
  const c = w.S; if (!c) return
  const kl = c.klines; if (!kl || kl.length < 10) return
  const session = kl.slice(-Math.min(60, kl.length))
  const prices = session.flatMap((x: any) => [x.h, x.l, x.o, x.c])
  const mn = Math.min(...prices), mx = Math.max(...prices), rng = mx - mn || 1
  const buckets = 20; const bucketSize = rng / buckets
  const nodes = Array.from({ length: buckets }, (_, i) => ({ price: mn + i * bucketSize + bucketSize / 2, vol: 0 }))
  session.forEach((bar: any) => { const midP = (bar.h + bar.l) / 2; const idx = Math.min(buckets - 1, Math.floor((midP - mn) / rng * buckets)); nodes[idx].vol += bar.v })
  const maxVol = Math.max(...nodes.map((n: any) => n.vol), 0.001)
  c._qmVpNodes = nodes.map((n: any) => ({ ...n, norm: n.vol / maxVol }))
  const poc = nodes.reduce((a: any, b: any) => b.vol > a.vol ? b : a)
  c._qmVpPOC = poc.price
  const totalVol = nodes.reduce((s: number, n: any) => s + n.vol, 0)
  const sorted = [...nodes].sort((a: any, b: any) => b.vol - a.vol)
  let vaVol = 0; const vaNodes: any[] = []
  for (const n of sorted) { vaVol += n.vol; vaNodes.push(n); if (vaVol / totalVol >= 0.70) break }
  const vaPrices = vaNodes.map((n: any) => n.price)
  c._qmVpVAH = Math.max(...vaPrices); c._qmVpVAL = Math.min(...vaPrices)
}
