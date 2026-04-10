// QM Flow Engine — 1:1 from HTML: VAC, ICE, FLIP, MMTRAP, EXHAUST, VOID, STOP, SMF
const w = window as any

export function calcFLOW(): void {
  const c = w.S; if (!c || !c.price) return
  const buf = c._qmBuf || []; if (buf.length < 20) return
  const kl = c.klines || []; if (kl.length < 5) return
  const now = Date.now()
  const avgVol = kl.length >= 20 ? kl.slice(-20).reduce((s: number, x: any) => s + x.v, 0) / 20 : 1

  // VAC
  if (buf.length >= 15) {
    const v1 = (buf[buf.length - 1] - buf[buf.length - 2]) / buf[buf.length - 2] * 100
    c._qmVacVel = v1; c._qmVacDir = v1 > 0.015 ? 'UP' : v1 < -0.015 ? 'DOWN' : 'FLAT'
    c._qmVacPct = v1; c._qmVacTs = c._qmVacDir !== 'FLAT' ? now : (c._qmVacTs || now)
  }

  // ICE
  if (kl.length >= 5) {
    const lk = kl[kl.length - 1]
    const body = Math.abs(lk.c - lk.o); const rng = lk.h - lk.l || 0.001
    c._qmIceActive = body / rng < 0.25 && lk.v > avgVol * 1.8
    c._qmIceTop = c._qmIceActive ? lk.h : (c._qmIceTop || 0)
    c._qmIceT2 = c._qmIceActive ? lk.l : (c._qmIceT2 || 0)
    c._qmIceTs = c._qmIceActive ? now : (c._qmIceTs || now)
  }

  // FLIP
  if (buf.length >= 30) {
    const prv = buf.slice(-30, -15), cur = buf.slice(-15)
    const pd = (prv[prv.length - 1] - prv[0]) / prv[0] * 100
    const cd2 = (cur[cur.length - 1] - cur[0]) / cur[0] * 100
    c._qmFlipPrv = pd; c._qmFlipCur = cd2
    c._qmFlipZ = pd * cd2 < 0 ? +Math.abs(pd - cd2).toFixed(3) : 0
    c._qmFlipActive = c._qmFlipZ > 0.05; c._qmFlipTs = c._qmFlipActive ? now : (c._qmFlipTs || now)
  }

  // MMTRAP
  c._qmMmtrapHist = c._qmMmtrapHist || []
  if (buf.length >= 30) {
    const win = buf.slice(-30)
    const hi = Math.max(...win.slice(0, -3)), lo = Math.min(...win.slice(0, -3))
    const lp = buf[buf.length - 1], pp = buf[buf.length - 4]
    if (pp > hi * (1 + 0.0002) && lp < hi) c._qmMmtrapHist.push({ type: 'SHORT', pct: ((lp - pp) / pp * 100), time: now })
    if (pp < lo * (1 - 0.0002) && lp > lo) c._qmMmtrapHist.push({ type: 'LONG', pct: ((lp - pp) / pp * 100), time: now })
    c._qmMmtrapHist = c._qmMmtrapHist.filter((t: any) => now - t.time < 300000)
    if (c._qmMmtrapHist.length > 10) c._qmMmtrapHist.shift()
  }
  const lmm = c._qmMmtrapHist?.[c._qmMmtrapHist.length - 1]
  c._qmMmState = lmm ? lmm.type : 'IDLE'; c._qmMmPct = lmm ? lmm.pct : 0

  // EXHAUST
  if (kl.length >= 3) {
    const lk = kl[kl.length - 1]
    const body = Math.abs(lk.c - lk.o), rng = lk.h - lk.l || 0.001
    c._qmExhaustActive = lk.v > avgVol * 2 && body / rng < 0.2
    c._qmExhaustSide = c._qmExhaustActive ? (lk.c > lk.o ? 'BUY' : 'SELL') : ''
    c._qmExhaustTs = c._qmExhaustActive ? now : (c._qmExhaustTs || now)
  }

  // VOID
  if (kl.length >= 5) {
    c._qmVoidActive = kl[kl.length - 1].v < avgVol * 0.25
    c._qmVoidTs = c._qmVoidActive ? now : (c._qmVoidTs || now)
  }

  // STOP
  c._qmStopHist = c._qmStopHist || []
  if (buf.length >= 25) {
    const win = buf.slice(-25, -5), lp2 = buf.slice(-5)
    const hi = Math.max(...win), lo = Math.min(...win)
    const dip = lp2.some((p: number) => p < lo * 0.9996) && lp2[lp2.length - 1] > lo
    const spk = lp2.some((p: number) => p > hi * 1.0004) && lp2[lp2.length - 1] < hi
    if (dip || spk) c._qmStopHist.push({ side: dip ? 'LOW' : 'HIGH', time: now })
    c._qmStopHist = c._qmStopHist.filter((t: any) => now - t.time < 300000)
    if (c._qmStopHist.length > 5) c._qmStopHist.shift()
  }
  const lstop = c._qmStopHist?.[c._qmStopHist.length - 1]
  c._qmStopState = lstop ? `HIT ${lstop.side}` : 'IDLE'

  // SMF
  let smf = 0
  smf += (c._qmAbsorption?.detected ? 25 : 0)
  smf += ((c.cumDelta || 0) > 0 ? 15 : (c.cumDelta || 0) < 0 ? -15 : 0)
  smf += ((c._qmOrderFlowDelta || 0) > 10 ? 15 : (c._qmOrderFlowDelta || 0) < -10 ? -15 : 0)
  smf += ((c._qmMfi || 50) > 60 ? 10 : (c._qmMfi || 50) < 40 ? -10 : 0)
  smf += ((c.obBV || 0) > (c.obAV || 0) * 1.1 ? 10 : (c.obAV || 0) > (c.obBV || 0) * 1.1 ? -10 : 0)
  c._qmSmfState = smf > 30 ? 'BULL' : smf < -30 ? 'BEAR' : 'NEUT'; c._qmSmfScore = smf

  // Overall FLOW state
  const active = [c._qmVacDir !== 'FLAT', c._qmIceActive, c._qmFlipActive, c._qmMmState !== 'IDLE', c._qmExhaustActive, c._qmVoidActive, c._qmStopState !== 'IDLE'].filter(Boolean).length
  c._qmFlowState = active >= 3 ? 'ACTIVE' : active >= 1 ? 'WATCH' : 'NEUT'
}
