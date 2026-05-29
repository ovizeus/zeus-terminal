/**
 * Zeus Terminal — MultiExchangeStore (per-user server-truth)
 *
 * Wraps /api/exchange/{status,save,verify,disconnect} with:
 *   - Promise dedup via _loadInFlight (mirrors omegaChatStore pattern)
 *   - 60s cache TTL on loadAccounts to avoid hammering
 *   - All state per req.user.id (server-side cookie auth)
 *
 * Invariants (Rule 0):
 *   - NEVER fake balance/maskedKey/lastVerified — always server-sourced
 *   - Mutual-exclusion (Binance XOR Bybit) is server-enforced; we display it
 *   - Coming Soon exchanges are NOT in this store (separate UI marker)
 */
import { create } from 'zustand'

const _CACHE_TTL_MS = 60_000

export interface ExchangeAccount {
  connected: boolean
  active: boolean        // [P7a.2] is this the currently-active exchange? (server is_active)
  mode: 'live' | 'testnet'
  maskedKey: string
  balance: number
  lastVerified: string
}

interface SaveResult {
  ok: boolean
  message?: string
  error?: string
  active?: boolean
  mode?: 'live' | 'testnet'
  maskedKey?: string
  balance?: number
  lastVerified?: string
}

// [P7a] Result of POST /api/exchange/switch. The server no longer 409s on open
// positions — it switches and returns a per-exchange summary of the positions left
// on the previous exchange(s), which stay DSL-managed there.
export interface SwitchResult {
  ok: boolean
  from?: string
  to?: string
  openPositionsOnPrevious?: Array<{ exchange: string; count: number }>
  message?: string
  error?: string
  code?: string
  noOp?: boolean
}

interface MultiExchangeState {
  accounts: Record<string, ExchangeAccount>
  loading: boolean
  error: string | null
  lastFetchTs: number | null
  _loadInFlight: Promise<void> | null

  loadAccounts(force?: boolean): Promise<void>
  saveAccount(exchange: string, apiKey: string, apiSecret: string, mode: 'live' | 'testnet'): Promise<SaveResult>
  verifyAccount(exchange: string): Promise<SaveResult>
  disconnectAccount(exchange: string): Promise<{ ok: boolean; error?: string }>
  switchExchange(targetExchange: string): Promise<SwitchResult>
}

async function _postJson(url: string, body: any) {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  // Defense: even on non-OK, attempt to parse server message; if body is non-JSON, return synthetic shape.
  try {
    return await r.json()
  } catch (_parseErr) {
    return { ok: false, error: `HTTP ${r.status}` }
  }
}

export const useMultiExchangeStore = create<MultiExchangeState>((set, get) => ({
  accounts: {},
  loading: false,
  error: null,
  lastFetchTs: null,
  _loadInFlight: null,

  loadAccounts: async (force?: boolean) => {
    const { lastFetchTs, _loadInFlight } = get()
    if (_loadInFlight && !force) return _loadInFlight
    if (!force && lastFetchTs != null && Date.now() - lastFetchTs < _CACHE_TTL_MS) return

    const p = (async () => {
      set({ loading: true, error: null })
      try {
        const r = await fetch('/api/exchange/status', { credentials: 'same-origin' })
        const d = await r.json()
        if (!d.ok) throw new Error(d.error || 'status fetch failed')
        const map: Record<string, ExchangeAccount> = {}
        for (const a of (d.accounts || [])) {
          map[a.exchange] = {
            connected: true,
            active: !!a.active,   // [P7a.2] from /status active flag (P7.0b)
            mode: a.mode,
            maskedKey: a.maskedKey,
            balance: typeof a.balance === 'number' ? a.balance : 0,
            lastVerified: a.lastVerified,
          }
        }
        set({ accounts: map, loading: false, lastFetchTs: Date.now(), _loadInFlight: null })
      } catch (err: any) {
        set({ loading: false, error: err.message || String(err), _loadInFlight: null })
      }
    })()
    set({ _loadInFlight: p })
    return p
  },

  saveAccount: async (exchange, apiKey, apiSecret, mode) => {
    const r = await _postJson('/api/exchange/save', { exchange, apiKey, apiSecret, mode })
    if (r.ok) {
      set((s) => ({
        accounts: {
          ...s.accounts,
          [exchange]: {
            connected: true,
            // [P7a.2] /save returns `active` (true=first/only, false=connected-inactive).
            // Authoritative active flags are refreshed via loadAccounts after save/switch.
            active: !!r.active,
            mode: r.mode,
            maskedKey: r.maskedKey,
            balance: typeof r.balance === 'number' ? r.balance : 0,
            lastVerified: r.lastVerified,
          },
        },
      }))
    }
    return r
  },

  verifyAccount: async (exchange) => {
    const r = await _postJson('/api/exchange/verify', { exchange })
    if (r.ok) {
      set((s) => {
        const existing = s.accounts[exchange]
        if (!existing) return s
        return {
          accounts: {
            ...s.accounts,
            [exchange]: {
              ...existing,
              balance: typeof r.balance === 'number' ? r.balance : existing.balance,
              lastVerified: r.lastVerified || existing.lastVerified,
            },
          },
        }
      })
    }
    return r
  },

  disconnectAccount: async (exchange) => {
    const r = await _postJson('/api/exchange/disconnect', { exchange })
    if (r.ok) {
      set((s) => {
        const next = { ...s.accounts }
        delete next[exchange]
        return { accounts: next }
      })
    }
    return r
  },

  // [P7a] One-click switch of the active exchange. Server toggles is_active and
  // returns openPositionsOnPrevious (positions left on the old exchange, still
  // DSL-managed there). Both accounts stay connected — nothing is removed here;
  // the caller refreshes active-exchange truth (loadAccounts/uiStore) + toasts.
  switchExchange: async (targetExchange) => {
    return await _postJson('/api/exchange/switch', { targetExchange }) as SwitchResult
  },
}))
