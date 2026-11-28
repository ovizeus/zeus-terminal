// [2026-11-28] Ultima lumanare a chartului, tinuta vie din PRET cand fluxul de lumanari tace.
// Serverul nu primeste nimic de la fstream.binance.com (Hetzner blocat), deci `market.kline`
// nu vine; vine doar `market.price` (~3 s). Volumul real si OHLC-ul exact le aduce citirea
// REST de 10 s din marketDataChart — asta doar misca lumanarea intre citiri.

const _UNIT: Record<string, number> = { m: 60, h: 3600, d: 86400, w: 604800 }

/** secundele unui interval Binance ('5m', '4h', '1d', '1w'); lunar/necunoscut → 0 */
export function tfSeconds(tf: string): number {
  const m = /^(\d+)([mhdw])$/.exec(String(tf || ''))
  if (!m) return 0
  return (+m[1]) * _UNIT[m[2]]
}

export interface Bar { time: number; open: number; high: number; low: number; close: number; volume?: number }

/**
 * Aplica un pret pe ultima lumanare. In acelasi interval: close + high/low largite.
 * Dupa interval: lumanare noua pe granita (calculata de la ultima, deci si saptamanile
 * Binance — care incep luni — ies corect), deschisa la close-ul vechi, volum 0.
 * Intoarce null cand nu e nimic sigur de facut.
 */
export function mergeTick(last: Bar | undefined | null, price: number, nowSec: number, tfSec: number): Bar | null {
  if (!last || !(price > 0) || !Number.isFinite(price) || !(tfSec > 0)) return null
  const age = nowSec - last.time
  if (!(age >= 0)) return null
  if (age < tfSec) {
    return { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) }
  }
  const time = last.time + Math.floor(age / tfSec) * tfSec
  return { time, open: last.close, high: Math.max(last.close, price), low: Math.min(last.close, price), close: price, volume: 0 }
}
