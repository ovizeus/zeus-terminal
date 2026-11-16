// ZeuS Brain v7 — preferintele radarului (pe dispozitiv, `zeus.brain.ui`).
// [2026-11-16] Monedele radarului sunt o LISTA FIXA aleasa de operator (implicit BTC, SOL, ETH).
// Principala = moneda din chart; satelitii = celelalte din lista, cel mult 3.
// [2026-11-16 seara, cerut de operator] COLTURI FIXE: BTC stanga sus, ETH dreapta sus,
// SOL dreapta jos — toate trei raman MEREU vizibile pe locul lor. Principala e doar MARCATA
// („main") pe satelitul ei; nu-si schimba nimeni locul cand atingi.
// Jurnalul creierului prinde doar tranzactiile pe monedele radarului.
import { LS_KEY } from './brainStrings'

export const DEFAULT_COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']   // ordinea = colturile (SAT_SLOT)
export const MAX_SATS = 3
const MAX_COINS = MAX_SATS

export type Pref = { focus: boolean; snd: boolean; coins: string[] }

/** Lista pe colturi: pozitia = coltul; '' = colt gol (moneda scoasa, colturile nu aluneca). */
export function normalizeCoins(x: unknown): string[] {
  if (!Array.isArray(x)) return DEFAULT_COINS.slice()
  const out: string[] = []
  for (const s of x) {
    if (out.length >= MAX_COINS) break
    const v = String(s || '').toUpperCase().trim()
    out.push(/^[A-Z0-9]{2,20}USDT$/.test(v) && !out.includes(v) ? v : '')
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}

let _cache: Pref | null = null
export function loadPref(width = typeof window !== 'undefined' ? window.innerWidth : 1000): Pref {
  let s: any = null
  try { s = JSON.parse(localStorage.getItem(LS_KEY) || 'null') } catch { s = null }
  let coins: string[]
  if (s && Array.isArray(s.coins)) {
    coins = normalizeCoins(s.coins)
    // lista implicita salvata intr-o ordine veche (BTC, SOL, ETH) → colturile cerute
    if (coins.length === 3 && DEFAULT_COINS.every((c) => coins.includes(c))) coins = DEFAULT_COINS.slice()
  }
  // migrare: forma de ieri tinea doar satelitii (fara principala) → BTC in fata
  else if (s && Array.isArray(s.sats)) {
    coins = normalizeCoins(['BTCUSDT', ...s.sats])
    if (coins.length === 3 && DEFAULT_COINS.every((c) => coins.includes(c))) coins = DEFAULT_COINS.slice()
  }
  else coins = DEFAULT_COINS.slice()
  _cache = { focus: s && typeof s.focus === 'boolean' ? s.focus : width < 600, snd: !!(s && s.snd), coins }
  return _cache
}
export function savePref(p: Pref): void {
  _cache = { focus: p.focus, snd: p.snd, coins: normalizeCoins(p.coins) }
  try { localStorage.setItem(LS_KEY, JSON.stringify(_cache)) } catch { /* privat */ }
}
/** Lista radarului (din cache; citita o data). */
export function currentCoins(): string[] { return (_cache || loadPref()).coins.slice() }
/** Monedele alese (fara colturile goale). */
export const chosen = (coins: string[]) => coins.filter(Boolean)
/** Adauga in primul colt gol (sau la capat). */
export function addCoin(coins: string[], sym: string): string[] {
  if (coins.includes(sym) || chosen(coins).length >= MAX_SATS) return coins
  const out = coins.slice(), i = out.indexOf('')
  if (i >= 0) out[i] = sym; else out.push(sym)
  return out
}
/** Scoate o moneda; coltul ei ramane gol. Ultima nu se scoate. */
export function removeCoin(coins: string[], sym: string): string[] {
  if (chosen(coins).length <= 1) return coins
  return normalizeCoins(coins.map((c) => (c === sym ? '' : c)))
}

/** Satelitii: TOATA lista pe colturi ('' = colt gol), principala inclusa, marcata la desen. */
export function satsOf(_main: string, coins: string[] = currentCoins()): string[] {
  return coins.slice(0, MAX_SATS)
}

/** Monedele radarului acum: principala + satelitii (simboluri complete, fara dubluri). */
export function radarCoins(main: string, coins: string[] = currentCoins()): string[] {
  const m = String(main || '').toUpperCase()
  const out = m ? [m] : []
  for (const c of satsOf(m, coins)) if (c && !out.includes(c)) out.push(c)
  return out
}
