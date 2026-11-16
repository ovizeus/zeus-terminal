// ZeuS Brain v7 — preferintele radarului (pe dispozitiv, `zeus.brain.ui`).
// [2026-11-16] Monedele radarului sunt o LISTA FIXA aleasa de operator, nu primele din
// scaner: moneda din chart (principala) + cel mult 3 sateliti, fiecare in coltul lui.
// Jurnalul creierului prinde doar tranzactiile pe monedele radarului.
import { LS_KEY } from './brainStrings'

export const DEFAULT_SATS = ['SOLUSDT', 'ETHUSDT']
export const MAX_SATS = 3

export type Pref = { focus: boolean; snd: boolean; sats: string[] }

export function normalizeSats(x: unknown): string[] {
  if (!Array.isArray(x)) return DEFAULT_SATS.slice()
  const out: string[] = []
  for (const s of x) {
    const v = String(s || '').toUpperCase().trim()
    if (/^[A-Z0-9]{2,20}USDT$/.test(v) && !out.includes(v)) out.push(v)
    if (out.length >= MAX_SATS) break
  }
  return out
}

let _cache: Pref | null = null
export function loadPref(width = typeof window !== 'undefined' ? window.innerWidth : 1000): Pref {
  let s: any = null
  try { s = JSON.parse(localStorage.getItem(LS_KEY) || 'null') } catch { s = null }
  _cache = {
    focus: s && typeof s.focus === 'boolean' ? s.focus : width < 600,
    snd: !!(s && s.snd),
    sats: s && Array.isArray(s.sats) ? normalizeSats(s.sats) : DEFAULT_SATS.slice(),
  }
  return _cache
}
export function savePref(p: Pref): void {
  _cache = { ...p, sats: normalizeSats(p.sats) }
  try { localStorage.setItem(LS_KEY, JSON.stringify(_cache)) } catch { /* privat */ }
}
/** Lista curenta de sateliti (din cache; citita o data). */
export function currentSats(): string[] { return (_cache || loadPref()).sats.slice() }

/** Monedele radarului acum: principala + satelitii (simboluri complete, fara dubluri). */
export function radarCoins(main: string, sats: string[] = currentSats()): string[] {
  const m = String(main || '').toUpperCase()
  const out = m ? [m] : []
  for (const s of sats) if (!out.includes(s)) out.push(s)
  return out
}
