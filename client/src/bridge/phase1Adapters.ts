/**
 * Phase 1 Adapters — expose ported utility modules on window.*
 * so old JS (state.js, config.js, deepdive.js, etc.) can use them unchanged.
 *
 * Called from legacyLoader.ts installShims() BEFORE any old JS loads.
 * Replaces: helpers.js, formatters.js, math.js, icons.js
 */

import { el, safeSetText, safeSetHTML, escHtml, isValidMarketPrice, safeLastKline } from '../utils/dom'
import { fmt, fP, fmtTime, fmtTimeSec, fmtDate, fmtFull, _TZ } from '../utils/format'
import { _clamp, _clampFB01, _clampFB, calcRSIArr } from '../utils/math'
import { _ZI } from '../constants/icons'

export function installPhase1Adapters(): void {
  const w = window as Record<string, unknown>

  // ── helpers.js replacements ──
  w.el = el
  w.safeSetText = safeSetText
  w.safeSetHTML = safeSetHTML
  w.escHtml = escHtml
  w.isValidMarketPrice = isValidMarketPrice
  w.safeLastKline = safeLastKline

  // ── formatters.js replacements ──
  w.fmt = fmt
  w.fP = fP
  w.fmtTime = fmtTime
  w.fmtTimeSec = fmtTimeSec
  w.fmtDate = fmtDate
  w.fmtFull = fmtFull
  w._TZ = _TZ
  w._dtfTime = { format: (d: Date) => fmtTime(d.getTime() / 1000) }
  w._dtfTimeSec = { format: (d: Date) => fmtTimeSec(d.getTime() / 1000) }
  w._dtfDate = { format: (d: Date) => fmtDate(d.getTime() / 1000) }
  w._dtfFull = { format: (d: Date) => fmtFull(d.getTime() / 1000) }

  // ── math.js replacements ──
  w._clamp = _clamp
  w._clampFB01 = _clampFB01
  w._clampFB = _clampFB
  w.calcRSIArr = calcRSIArr

  // ── icons.js replacement ──
  w._ZI = _ZI
}
