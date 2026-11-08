/**
 * Bar-close alerts — volume, divergences, RSI extremes, pivot crossings.
 *
 * [2026-11-08] These four groups were checkboxes wired to nothing. They are
 * evaluated here, once per klines fetch, from the same 50 bars the RSI panel
 * already asks for: one request, four answers, no extra load on the gateway.
 *
 * Everything it needs is passed in — the settings, the sender, the cooldown
 * map and even the clock. Nothing is read off `window`. That is what makes it
 * testable, which is the whole reason these rules exist at all instead of
 * sitting inside a fetch handler where nobody could check them.
 *
 * Decisions are taken on CLOSED bars. A divergence or a pivot cross judged
 * mid-bar appears and vanishes while the candle moves, and an alert that
 * un-happens is worse than no alert.
 */

import {
  volumeSpikeRatio, shouldVolAlert, findDivergences, keepDivergence,
  rsiExtremeKind, crossedLevels, findSwings, macdLine, canFire,
} from './alertRules'
import { calcRSIArr } from '../utils/math'

export interface BarAlertDeps {
  /** Raw Binance klines: [openTime, open, high, low, close, volume, ...]. */
  klines: unknown[]
  tf: string
  symbol?: string
  alerts: Record<string, unknown>
  send: (title: string, body: string, tag?: string) => void
  /** Per-key timestamps of the last firing; mutated in place. */
  last: Record<string, number>
  now?: number
}

const COOLDOWN = Object.freeze({
  vol: 5 * 60_000,
  div: 15 * 60_000,
  rsi: 5 * 60_000,
  pivot: 10 * 60_000,
})

/** Bars either side of a swing, and how far back to look for pivot levels. */
const SWING_WIDTH = 3
const PIVOT_LEVELS = 6
/**
 * How stale a divergence may be and still be worth saying.
 *
 * A swing cannot be recognised until SWING_WIDTH bars have printed after it,
 * so the freshest possible divergence is already that old — the window has to
 * allow for it. Beyond a couple of bars more it is history, and announcing
 * history on every poll is the warning flood all over again.
 */
const DIV_GRACE_BARS = 2

function _col(klines: unknown[], idx: number): number[] {
  const out: number[] = []
  for (const k of klines) {
    const row = k as unknown[]
    const v = Array.isArray(row) ? parseFloat(String(row[idx])) : NaN
    out.push(Number.isFinite(v) ? v : NaN)
  }
  return out
}

function _fmt(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString('en-US')
  return (Math.round(n * 100) / 100).toString()
}

/**
 * Evaluates every bar-close alert group. Returns the tags it fired, which is
 * what the tests assert on and what makes "it did nothing" distinguishable
 * from "it was switched off".
 */
export function checkBarAlerts(deps: BarAlertDeps): string[] {
  const fired: string[] = []
  try {
    const { klines, tf, alerts, send, last } = deps
    if (!Array.isArray(klines) || klines.length < 10) return fired
    if (!alerts || alerts.enabled === false) return fired
    const now = Number.isFinite(deps.now as number) ? (deps.now as number) : Date.now()
    const sym = deps.symbol || ''
    const pre = sym ? sym + ' ' + tf : tf

    // The last row of a klines response is the bar still forming. Every
    // decision below uses CLOSED bars only.
    const closedCount = klines.length - 1
    const highs = _col(klines, 2).slice(0, closedCount)
    const lows = _col(klines, 3).slice(0, closedCount)
    const closes = _col(klines, 4).slice(0, closedCount)
    const vols = _col(klines, 5).slice(0, closedCount)
    if (closes.length < 8) return fired

    // ── Volume. The threshold is absolute, as the control says ("BTC per
    // candle"); the ratio against the average goes in the text, because that
    // is the part that tells him whether to care.
    if (alerts.volSpike !== false) {
      const lastVol = vols[vols.length - 1]
      if (shouldVolAlert(lastVol, alerts.volThreshold as number) && canFire(last, 'vol_' + tf, now, COOLDOWN.vol)) {
        const ratio = volumeSpikeRatio(vols)
        const extra = ratio !== null ? ` · ${(Math.round(ratio * 10) / 10)}× the usual` : ''
        send('VOLUME SPIKE', `${pre}: ${_fmt(lastVol)}${extra}`, 'vol')
        fired.push('vol')
      }
    }

    // ── Divergences, against RSI and/or MACD, filtered by what he ticked.
    if (alerts.divergence !== false) {
      const sources: Array<{ name: string; series: number[] }> = []
      if (alerts.divRSI !== false) {
        sources.push({ name: 'RSI', series: calcRSIArr(closes).map((v) => (v === null ? NaN : v)) })
      }
      if (alerts.divMACD !== false) {
        sources.push({ name: 'MACD', series: macdLine(closes) })
      }
      for (const src of sources) {
        const hits = findDivergences(highs, lows, src.series, SWING_WIDTH).filter((h) => keepDivergence(h, alerts))
        const latest = hits[hits.length - 1]
        // Only the most recent one, and only while it is still the newest
        // swing: re-announcing an old divergence on every poll is noise.
        if (!latest || latest.index < closedCount - 1 - SWING_WIDTH - DIV_GRACE_BARS) continue
        const key = `div_${tf}_${src.name}_${latest.dir}_${latest.index}`
        if (!canFire(last, key, now, COOLDOWN.div)) continue
        const word = latest.hidden ? 'HIDDEN DIVERGENCE' : 'DIVERGENCE'
        send(`${latest.dir === 'bull' ? 'BULLISH' : 'BEARISH'} ${word}`,
          `${pre}: price vs ${src.name} at ${_fmt(closes[latest.index])}`, 'div')
        fired.push('div')
      }
    }

    // ── RSI extremes, each end behind its own switch.
    if (alerts.rsiAlerts !== false) {
      const rsiArr = calcRSIArr(closes)
      const rsi = rsiArr[rsiArr.length - 1]
      const kind = rsiExtremeKind(rsi, alerts)
      if (kind && canFire(last, 'rsi_' + tf, now, COOLDOWN.rsi)) {
        send(kind === 'ob' ? 'RSI OVERBOUGHT' : 'RSI OVERSOLD',
          `${pre} RSI: ${_fmt(rsi as number)}`, 'rsi')
        fired.push('rsi')
      }
    }

    // ── Pivot crossings, confirmed on the close.
    if (alerts.pivotAlerts === true) {
      const sw = findSwings(highs, lows, SWING_WIDTH)
      const levels: number[] = []
      for (const i of sw.highs.slice(-PIVOT_LEVELS)) levels.push(highs[i])
      for (const i of sw.lows.slice(-PIVOT_LEVELS)) levels.push(lows[i])
      const prev = closes[closes.length - 2]
      const cur = closes[closes.length - 1]
      for (const x of crossedLevels(prev, cur, levels)) {
        const key = `piv_${tf}_${Math.round(x.level * 100)}`
        if (!canFire(last, key, now, COOLDOWN.pivot)) continue
        send('PIVOT CROSSED', `${pre}: ${x.dir === 'up' ? 'above' : 'below'} ${_fmt(x.level)}`, 'pivot')
        fired.push('pivot')
      }
    }
  } catch (e) {
    // This runs on live market data. A thrown rule must not take the feed with it.
    console.warn('[barAlerts]', (e as Error)?.message)
  }
  return fired
}

export const _COOLDOWN = COOLDOWN
export const _DIV_WINDOW = { SWING_WIDTH, DIV_GRACE_BARS }
