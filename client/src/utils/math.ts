/**
 * Zeus Terminal — Math utilities (ported from public/js/utils/math.js)
 * Exposes: _clamp, _clampFB01, _clampFB, calcRSIArr
 */

/** Clamp value between min and max */
export function _clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n))
}

/** Clamp to [0,1], NaN-safe (returns 0 for NaN) */
export function _clampFB01(x: number): number {
  x = +x
  return !Number.isFinite(x) ? 0 : Math.max(0, Math.min(1, x))
}

/** Clamp to [a,b], NaN-safe (returns a for NaN) */
export function _clampFB(x: number, a: number, b: number): number {
  x = +x
  return !Number.isFinite(x) ? a : Math.max(a, Math.min(b, x))
}

/** Wilder RSI calculation — returns array with nulls for insufficient data */
export function calcRSIArr(prices: number[], p = 14): (number | null)[] {
  const out: (number | null)[] = new Array(prices.length).fill(null)
  if (prices.length < p + 1) return out
  let g = 0, l = 0
  for (let i = 1; i <= p; i++) {
    const d = prices[i] - prices[i - 1]
    if (d > 0) g += d; else l += Math.abs(d)
  }
  let ag = g / p, al = l / p
  out[p] = al === 0 ? 100 : 100 - (100 / (1 + (ag / al)))
  for (let i = p + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1]
    if (d > 0) { ag = (ag * (p - 1) + d) / p; al = al * (p - 1) / p }
    else { ag = ag * (p - 1) / p; al = (al * (p - 1) + Math.abs(d)) / p }
    out[i] = al === 0 ? 100 : 100 - (100 / (1 + (ag / al)))
  }
  return out
}
