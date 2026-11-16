// ZeuS Brain v7 — stocare pe dispozitiv (spec 4.2, hotarat de operator: doar pe dispozitiv).
// IndexedDB `zeus_brain`: `trades` (inregistrarea creierului), `frames` (replay), `snapshots` (poza la intrare).
// Cheia contine id-ul contului: doua conturi pe acelasi telefon nu-si vad datele.
// Datele de baza ale tranzactiei (rezultat, PnL, preturi) vin de la server (at_closed), nu de aici.

export interface TradeRecord {
  key: string            // `${uid}:${id}`
  uid: string
  id: string             // id real (seq de pe server)
  isDemo: boolean
  symbol: string
  side: 'LONG' | 'SHORT'
  entryTime: number
  exitTime: number | null
  entryPrice: number | null
  exitPrice: number | null
  result: 'TP' | 'SL' | 'MANUAL' | 'DSL' | 'LIQ' | 'OTHER' | null   // null = inca deschisa / neconfirmata
  pnlPct: number | null
  pnlAbs: number | null
  confAtEntry: number | null
  thrAtEntry: number | null
  profile: string | null
  pre: string
  entryShape: number[]
  hasSnapshot: boolean
  hasFrames: boolean
  status: 'open' | 'closing' | 'closed'
  // [2026-11-16] Jurnalul radarului (pasul B). Toate optionale: inregistrarile vechi nu le au.
  env?: 'DEMO' | 'TESTNET' | 'REAL' | null     // mediul REAL al tranzactiei, la intrare
  radarCoin?: boolean                            // moneda era a radarului la intrare
  radarCoins?: string[]                          // lista radarului de atunci
  onMain?: boolean                               // era moneda de pe chart (poza + replay posibile)
  noSnapReason?: string | null                   // de ce nu exista poza
  meta?: {
    radarMode: string | null; regime: string | null; focus: boolean | null; lens: string
    gatesFailing: number[]; gatesUnknown: number[]; ml: number | null
  }
}

const DB = 'zeus_brain'
const VER = 1
let _db: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (_db) return _db
  _db = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const rq = indexedDB.open(DB, VER)
      rq.onupgradeneeded = () => {
        const d = rq.result
        if (!d.objectStoreNames.contains('trades')) d.createObjectStore('trades', { keyPath: 'key' }).createIndex('uid', 'uid')
        if (!d.objectStoreNames.contains('frames')) d.createObjectStore('frames')
        if (!d.objectStoreNames.contains('snapshots')) d.createObjectStore('snapshots')
      }
      rq.onsuccess = () => resolve(rq.result)
      rq.onerror = () => resolve(null)
      rq.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
  return _db
}

function req<T>(r: IDBRequest<T>): Promise<T | null> {
  return new Promise((res) => { r.onsuccess = () => res(r.result); r.onerror = () => res(null) })
}

async function store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore | null> {
  const d = await open()
  if (!d) return null
  try { return d.transaction(name, mode).objectStore(name) } catch { return null }
}

export const brainStorage = {
  async putTrade(t: TradeRecord): Promise<void> { const s = await store('trades', 'readwrite'); if (s) await req(s.put(t)) },
  async loadTrades(uid: string): Promise<TradeRecord[]> {
    const s = await store('trades', 'readonly'); if (!s) return []
    const all = (await req(s.index('uid').getAll(uid))) as TradeRecord[] | null
    return Array.isArray(all) ? all : []
  },
  async putFrames(key: string, frames: unknown[]): Promise<void> { const s = await store('frames', 'readwrite'); if (s) await req(s.put(frames, key)) },
  async getFrames(key: string): Promise<unknown[] | null> { const s = await store('frames', 'readonly'); if (!s) return null; return (await req(s.get(key))) as unknown[] | null },
  async delFrames(key: string): Promise<void> { const s = await store('frames', 'readwrite'); if (s) await req(s.delete(key)) },
  async putSnapshot(key: string, dataUrl: string): Promise<void> { const s = await store('snapshots', 'readwrite'); if (s) await req(s.put(dataUrl, key)) },
  async getSnapshot(key: string): Promise<string | null> { const s = await store('snapshots', 'readonly'); if (!s) return null; return (await req(s.get(key))) as string | null },
}
