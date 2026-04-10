/**
 * Server sync hook — routes AT state + sync signals to Zustand stores.
 *
 * Data flow:
 *   1. Initial pull: GET /api/sync/state → positions + demoBalance
 *   2. WS at_update: full AT state → positions, AT stats, balance, mode
 *   3. WS sync: cross-device signal → re-pull state
 *   4. Polling fallback: AT state every 10s (same as old frontend)
 *   5. Journal pull: GET /api/sync/journal → journalStore
 */
import { useEffect, useRef } from 'react'
import { wsService } from '../services/ws'
import { syncApi, api } from '../services/api'
import { usePositionsStore, useATStore, useUiStore } from '../stores'
import { useJournalStore } from '../stores/journalStore'
import type { WsMessage, ServerATState, ServerDemoBalance } from '../types'

/** Extract numeric balance from server's demoBalance (can be number or {balance,pnl,startBalance}) */
function extractBalance(raw: number | ServerDemoBalance | undefined): { balance: number; pnl: number } {
  if (raw == null) return { balance: 10000, pnl: 0 }
  if (typeof raw === 'number') return { balance: raw, pnl: 0 }
  return { balance: raw.balance ?? 10000, pnl: raw.pnl ?? 0 }
}

/** Filter to only open positions */
function filterOpen(positions: ServerATState['positions']): ServerATState['positions'] {
  return (positions || []).filter((p) => {
    if (p.status && p.status !== 'OPEN') return false
    if ((p as Record<string, unknown>).closed) return false
    return true
  })
}

/** Apply a full AT state update to all relevant stores */
function applyATUpdate(data: ServerATState) {
  const posStore = usePositionsStore.getState()
  const atStore = useATStore.getState()

  // --- Positions ---
  // Server sends demoPositions/livePositions separately (preferred) OR flat positions array
  let demo: ServerATState['positions']
  let live: ServerATState['positions']
  if (data.demoPositions && data.livePositions) {
    demo = filterOpen(data.demoPositions)
    live = filterOpen(data.livePositions)
  } else {
    const all = filterOpen(data.positions)
    demo = all.filter((p) => p.mode !== 'live')
    live = all.filter((p) => p.mode === 'live')
  }
  posStore.setDemoPositions(demo)
  posStore.setLivePositions(live)

  // --- Demo Balance ---
  const bal = extractBalance(data.demoBalance)
  posStore.setDemoBalance(bal.balance)
  posStore.patch({ demoPnL: bal.pnl })

  // --- Demo wins/losses from demoStats ---
  const ds = data.demoStats || data.stats
  if (ds) {
    posStore.patch({ demoWins: ds.wins || 0, demoLosses: ds.losses || 0 })
  }

  // --- AT State ---
  const stats = data.stats || {} as ServerATState['stats']
  const demoStats = data.demoStats || null
  const liveStats = data.liveStats || null
  atStore.patch({
    enabled: data.atActive ?? data.enabled ?? false,
    mode: data.mode === 'live' ? 'live' : 'demo',
    killTriggered: !!data.killActive,
    totalTrades: (stats.entries || 0),
    wins: stats.wins || 0,
    losses: stats.losses || 0,
    totalPnL: stats.pnl || 0,
    dailyPnL: data.dailyPnL ?? stats.dailyPnL ?? 0,
    _modeConfirmed: true,
    _serverMode: data.mode || 'demo',
    _serverStats: stats,
    _serverDemoStats: demoStats,
    _serverLiveStats: liveStats,
  })

  // --- UI env info ---
  useUiStore.getState().patch({
    apiConfigured: !!data.apiConfigured,
    exchangeMode: data.exchangeMode || null,
    resolvedEnv: data.resolvedEnv || 'DEMO',
  })
}

/** Pull journal entries from server */
async function pullJournal() {
  try {
    const res = await api.get<unknown[]>('/api/sync/journal')
    if (res.ok && Array.isArray(res.data)) {
      useJournalStore.getState().setEntries(
        res.data.map((row: Record<string, unknown>) => ({
          id: String(row.seq || row.id || ''),
          symbol: String(row.symbol || ''),
          side: String(row.side || 'LONG') as 'LONG' | 'SHORT',
          entryPrice: Number(row.price || row.entryPrice || 0),
          exitPrice: Number(row.exitPrice || row.closePrice || 0),
          pnl: Number(row.closePnl || row.pnl || 0),
          reason: String(row.closeReason || row.reason || ''),
          openTs: Number(row.ts || row.openTs || 0),
          closeTs: Number(row.closeTs || 0),
          mode: String(row.mode || 'demo') as 'demo' | 'live',
        })),
      )
    }
  } catch {
    // Journal pull failed — not critical
  }
}

/** Pull AT state via REST (polling fallback, same as old frontend's _atPollOnce) */
async function pullATState() {
  try {
    // /api/at/state returns getFullState() directly (no {ok,data} wrapper)
    const res = await fetch('/api/at/state', {
      credentials: 'same-origin',
      headers: { 'X-Zeus-Request': '1' },
    })
    if (res.ok) {
      const data: ServerATState = await res.json()
      if (data) applyATUpdate(data)
    }
  } catch {
    // AT poll failed — WS is primary, this is fallback
  }
}

export function useServerSync(authenticated: boolean) {
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!authenticated) return

    // Delay initial pulls to avoid 429 collision with old JS bridge.
    // Old JS (state.js, config.js) also pulls state/AT/journal at boot.
    // Wait 8s so bridge loads first, then React does one-time sync.
    const initTimer = setTimeout(() => {
      syncApi.pullState().then((res) => {
        if (res.ok && res.data) {
          const snap = res.data
          const all = filterOpen(snap.positions || [])
          // Atomic snapshot — server is final truth
          usePositionsStore.getState().syncSnapshot({
            demoPositions: all.filter((p) => p.mode !== 'live'),
            livePositions: all.filter((p) => p.mode === 'live'),
            demoBalance: snap.demoBalance ? extractBalance(snap.demoBalance).balance : undefined,
            source: 'server',
          })
        }
      })
      pullATState()
      pullJournal()
      // Load settings from server (single source of truth)
      import('../stores/settingsStore').then(({ useSettingsStore }) => {
        useSettingsStore.getState().loadFromServer()
      }).catch(() => {})
      // Load ARES state from server (single source of truth)
      import('../stores/aresStore').then(({ useAresStore }) => {
        useAresStore.getState().loadFromServer()
      }).catch(() => {})
    }, 8000)

    // 4. WS subscription — handles at_update and sync messages
    const unsub = wsService.subscribe((msg: WsMessage) => {
      if (msg.type === 'at_update' && msg.data) {
        applyATUpdate(msg.data)
      }
      if (msg.type === 'sync') {
        // Cross-device sync signal — re-pull everything
        syncApi.pullState().then((res) => {
          if (res.ok && res.data) {
            const all = filterOpen(res.data.positions || [])
            usePositionsStore.getState().setDemoPositions(all.filter((p) => p.mode !== 'live'))
            usePositionsStore.getState().setLivePositions(all.filter((p) => p.mode === 'live'))
            if (res.data.demoBalance) {
              const bal = extractBalance(res.data.demoBalance)
              usePositionsStore.getState().setDemoBalance(bal.balance)
            }
          }
        })
        pullJournal()
      }
      useUiStore.getState().setConnected(true)
    })

    // 5. AT polling fallback — every 30s (old JS already polls at 10s, avoid double-hit)
    pollRef.current = setInterval(pullATState, 30000)

    // 6. Connection status check
    const connInterval = setInterval(() => {
      useUiStore.getState().setConnected(wsService.isConnected())
    }, 3000)

    return () => {
      clearTimeout(initTimer)
      unsub()
      if (pollRef.current) clearInterval(pollRef.current)
      clearInterval(connInterval)
    }
  }, [authenticated])
}
