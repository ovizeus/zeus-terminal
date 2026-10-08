#!/usr/bin/env npx tsx
/**
 * Render TERMINATOR from LIVE market data and leave a PNG to look at.
 *
 * Why this exists: the indicator's maths and colours were right and every unit
 * test passed, yet rendering it for the first time exposed two drawing bugs no
 * test could see (long diagonals between staircase segments, and every flip
 * marker piling up at the left edge). Looking at the picture is part of the
 * job, so it is a command rather than a one-off.
 *
 *   npm run verify:terminator            # BTCUSDT 1h, 300 candles
 *   SYMBOL=ETHUSDT TF=15m npm run verify:terminator
 *
 * It uses the REAL production functions from client/src, not a copy, and real
 * klines from Binance — nothing synthetic. Output: docs/terminator-live.png
 */
import * as fs from 'fs'
import * as path from 'path'
import { terminator, terminatorTintBars } from '../../client/src/engine/indicatorCalc'

const UP = '#05E17F'
const DN = '#E547FC'
const SYMBOL = process.env.SYMBOL || 'BTCUSDT'
const TF = process.env.TF || '1h'
const LIMIT = Number(process.env.LIMIT || 300)
const OUT = path.join(__dirname, 'out')

async function main() {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${SYMBOL}&interval=${TF}&limit=${LIMIT}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`klines HTTP ${r.status} — is the symbol/interval valid?`)
  const raw = (await r.json()) as unknown[][]
  const kl = raw.map((k) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: +(k[1] as string), high: +(k[2] as string),
    low: +(k[3] as string), close: +(k[4] as string),
  }))

  const t = terminator(kl.map(k => k.high), kl.map(k => k.low), kl.map(k => k.close))
  const tinted = terminatorTintBars(kl, t.trend, UP, DN)

  // Same segmentation as updateTerminator: one run per contiguous trend, so the
  // lines can never connect across a flip.
  const segs: { trend: number; points: { time: number; value: number }[] }[] = []
  let cur: { trend: number; points: { time: number; value: number }[] } | null = null
  const lvl: { time: number; value: number }[] = []
  const markers: Record<string, unknown>[] = []
  for (let i = 0; i < kl.length; i++) {
    const v = t.line[i], d = t.trend[i]
    if (t.flipLevel[i] != null) lvl.push({ time: kl[i].time, value: t.flipLevel[i] as number })
    if (t.flip[i]) {
      const bull = t.trend[i] === 1
      markers.push({ time: kl[i].time, position: bull ? 'belowBar' : 'aboveBar',
        color: bull ? UP : DN, shape: 'square', text: bull ? 'LONG' : 'SHORT' })
    }
    if (v == null || (d !== 1 && d !== -1)) { cur = null; continue }
    if (!cur || cur.trend !== d) { cur = { trend: d, points: [] }; segs.push(cur) }
    cur.points.push({ time: kl[i].time, value: v })
  }

  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify({ tinted, segs, lvl, markers, UP, DN }))
  fs.copyFileSync(
    path.join(__dirname, '..', '..', 'client', 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js'),
    path.join(OUT, 'lw.js'),
  )
  fs.copyFileSync(path.join(__dirname, 'page.html'), path.join(OUT, 'index.html'))

  const flips = t.flip.filter(Boolean).length
  const last = t.trend[t.trend.length - 1]
  console.log(`${SYMBOL} ${TF}: ${kl.length} lumânări REALE | ${flips} flip-uri | trend curent: ${last === 1 ? 'BULL' : 'BEAR'}`)
  console.log(`preţ ${kl[kl.length - 1].close} | stop ${(t.line[t.line.length - 1] as number).toFixed(2)}`)
  console.log(`\nAcum: npx tsx scripts/verify-terminator/shot.ts`)
}
main().catch((e) => { console.error('EROARE:', e.message); process.exit(1) })
