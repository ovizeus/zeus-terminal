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
import { liveApiSyncState } from '../trading/liveApi'
import { startLiveBalanceAutoSync, stopLiveBalanceAutoSync } from '../trading/liveBalanceAutoSync'
import { isTabVisible, onVisibilityChange } from '../utils/tabVisibility'
import type { WsMessage, ServerATState, ServerDemoBalance } from '../types'

const LIVE_BALANCE_REFRESH_MS = 60000

function _refreshLiveBalanceFor(env: 'DEMO' | 'TESTNET' | 'REAL' | null, apiConfigured: boolean): void {
  startLiveBalanceAutoSync({
    env, apiConfigured,
    syncFn: () => liveApiSyncState(),
    intervalMs: LIVE_BALANCE_REFRESH_MS,
  })
}

/** Extract numeric balance from server's demoBalance (can be number or {balance,pnl,startBalance}) */
function extractBalance(raw: number | ServerDemoBalance | undefined): { balance: number; pnl: number } {
  if (raw == null) return { balance: 10000, pnl: 0 }
  if (typeof raw === 'number') return { balance: raw, pnl: 0 }
  return { balance: raw.balance ?? 10000, pnl: raw.pnl ?? 0 }
}

/** Filter to only open positions */








/** Apply a full AT state update to all relevant stores */
function applyATUpdate(data: ServerATState) {
  const posStore = usePositionsStore.getState()
  const atStore = useATStore.getState()

  // [FIX DUP] Positions are NOT overwritten from server — state.ts _applyServerATState
  // merges server state into TP.demoPositions with proper handling of manual client
  // positions (that server doesn't know about). React store is kept in sync via
  // usePositionsBridge listening to 'zeus:positionsChanged' events on TP writes.
  // Writing positions here would wipe client-only manual positions before server
  // registration completes (race condition).

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
    killReason: data.killReason ?? null,
    killLoss: data.killLoss ?? 0,
    killLimit: data.killLimit ?? 0,
    killBalRef: data.killBalRef ?? 0,
    killModeAtTrigger: data.killModeAtTrigger ?? null,
    killActiveAt: data.killActiveAt ?? 0,
    maxDayProtect: data.maxDayProtect ?? null, // [T-MAXTRADES] server protection state
    // [KILL-REARM 2026-06-07] Baseline for the client kill check. Server
    // resetKill keeps dailyPnL (the re-arm baseline lives in pnlAtReset) —
    // the client must mirror it or it re-triggers at the same loss
    // seconds after every deactivation (operator-reported, 2× same $).
    pnlAtReset: data.pnlAtReset ?? 0,
    totalTrades: (stats.entries || 0),
    wins: stats.wins || 0,
    losses: stats.losses || 0,
    totalPnL: stats.pnl || 0,
    dailyPnL: data.dailyPnL ?? stats.dailyPnL ?? 0,
    _modeConfirmed: true,
    _serverMode: data.mode || 'demo',
    _serverStats: stats as unknown as Record<string, unknown>,
    _serverDemoStats: demoStats as unknown as Record<string, unknown> | null,
    _serverLiveStats: liveStats as unknown as Record<string, unknown> | null,
  })

  // --- UI env info ---
  // Phase 2C: executionEnv / executionBlockedReason are canonical truth from server.
  // ?? (not ||) preserves null — null means "non-demo blocked" and consumers must show LOCKED.
  // [Phase 3D] resolvedEnv now uses ?? (not ||) so server null stays null — no false REAL fallback.
  // [Phase 12.A — Batch B] activeExchange was already in the at_update payload
  // since Phase 2A (serverAT.js getFullState()), but the client never mapped
  // it into the store. Added here so every at_update keeps the store's
  // activeExchange aligned with server truth; the typed exchange.changed
  // handler (below, in the WS subscribe block) covers the save/disconnect/
  // verify + connect warm-start paths that don't emit at_update.
  useUiStore.getState().patch({
    apiConfigured: !!data.apiConfigured,
    exchangeMode: data.exchangeMode || null,
    resolvedEnv: (data.resolvedEnv ?? null) as 'DEMO' | 'TESTNET' | 'REAL' | null,
    executionEnv: (data.executionEnv ?? null) as 'DEMO' | 'TESTNET' | 'REAL' | null,
    executionBlockedReason: (data.executionBlockedReason ?? null) as 'NO_ACTIVE_API_CREDENTIALS' | 'INVALID_ACTIVE_API_CONFIGURATION' | null,
    activeExchange: (data.activeExchange ?? null) as 'binance' | 'bybit' | null,
  })

  // [Phase 2 S6-B4] Demo-authority window mirrors — read-model only. Mirror
  // here too so the REST pullATState fallback path (used at reconnect /
  // boot warm-start) keeps the window flags in sync with the WS handler in
  // core/state.ts:_applyServerATState. Both writers are idempotent for the
  // same payload. S6-B5 will read these flags to gate the client AT engine
  // for demo users; S6-B4 is pure read-model.
  if ('serverATDemoEnabled' in (data as Record<string, unknown>)) {
    (window as any)._serverATDemoEnabled = !!data.serverATDemoEnabled
  }
  if ('serverBrainDemoEnabled' in (data as Record<string, unknown>)) {
    (window as any)._serverBrainDemoEnabled = !!data.serverBrainDemoEnabled
  }
}

// [JOURNAL-FIX 2026-06-01] Map a server at_closed row → the bottom-journal
// (positionsStore.journal / <JournalRow>) entry shape. The bottom journal was
// fed ONLY by client-side addTradeToJournal (client closes), so SERVER-side
// closes (DSL_PL/HIT_SL/RECON_PHANTOM) never showed there. at_closed has no
// explicit exitPrice → fall back to _lastPrice (last tracked price at close).
export function serverRowToPanelEntry(raw: unknown): Record<string, unknown> {
  const row = raw as Record<string, unknown>
  const closeTs = Number(row.closeTs || 0)
  let time = ''
  try { if (closeTs) time = new Date(closeTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { /* ignore */ }
  return {
    id: String(row.seq || row.id || ''),
    time,
    side: String(row.side || 'LONG'),
    sym: String(row.symbol || ''),
    entry: Number(row.price || row.entryPrice || 0),
    exit: Number(row.exitPrice || row.closePrice || row._lastPrice || 0),
    size: Number(row.size || 0),
    pnl: Number(row.closePnl || row.pnl || 0),
    reason: String(row.closeReason || row.reason || ''),
    lev: Number(row.lev || row.leverage || 0),
    autoTrade: !!row.autoTrade,
    journalEvent: 'CLOSE',
    isLive: String(row.mode || '') === 'live',
    openTs: Number(row.ts || row.openTs || 0),
    closedAt: closeTs,
    mode: String(row.mode || 'demo'),
  }
}

/** Pull journal entries from server */
async function pullJournal() {
  try {
    const res = await api.get<unknown[]>('/api/sync/journal')
    if (res.ok && Array.isArray(res.data)) {
      useJournalStore.getState().setEntries(
        res.data.map((raw: unknown) => {
          const row = raw as Record<string, unknown>
          // [Phase 12.A — Batch G] Exchange + env snapshots — strict whitelist,
          // null fallback honest (legacy rows pre-Batch-G have no stamp).
          const _rowExch = row.exchange
          const _rowEnv = row.env
          return ({
          id: String(row.seq || row.id || ''),
          symbol: String(row.symbol || ''),
          side: String(row.side || 'LONG') as 'LONG' | 'SHORT',
          entryPrice: Number(row.price || row.entryPrice || 0),
          exitPrice: Number(row.exitPrice || row.closePrice || 0),
          pnl: Number(row.closePnl || row.pnl || 0),
          exitReason: String(row.closeReason || row.reason || ''),
          openTs: Number(row.ts || row.openTs || 0),
          closeTs: Number(row.closeTs || 0),
          mode: String(row.mode || 'demo') as 'demo' | 'live',
          exchange: (_rowExch === 'binance' || _rowExch === 'bybit') ? _rowExch : null,
          env: (_rowEnv === 'DEMO' || _rowEnv === 'TESTNET' || _rowEnv === 'REAL') ? _rowEnv : null,
        })
        }),
      )
      // [JOURNAL-FIX 2026-06-01] Also feed the BOTTOM journal (positionsStore.journal),
      // which was previously client-close-only and missed all server-side closes.
      // at_closed is the single source of truth (superset). Merge so a just-
      // client-closed trade not yet synced isn't dropped (dedupe by id).
      try {
        const panelEntries = res.data.map(serverRowToPanelEntry)
        const serverIds = new Set(panelEntries.map((e) => String(e.id)))
        const ps = usePositionsStore.getState()
        const localOnly = (ps.journal || []).filter((e: { id?: unknown }) => !serverIds.has(String(e.id)))
        ps.setJournal([...panelEntries, ...localOnly])
      } catch { /* bottom-journal merge is best-effort */ }
    }
  } catch {
    // Journal pull failed — not critical
  }
}

/** Pull AT state via REST (polling fallback, same as old frontend's _atPollOnce) */
async function pullATState() {
  try {
    // /api/at/state returns getFullState() directly (no {ok,data} wrapper)
    const data = await api.raw<ServerATState>('GET', '/api/at/state')
    if (data) applyATUpdate(data)
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
          // [FIX DUP] Only sync demoBalance from initial pull — positions are handled
          // by state.ts _applyServerATState + usePositionsBridge to avoid race with
          // client-only manual positions not yet registered on server.
          if (snap.demoBalance) {
            const bal = extractBalance(snap.demoBalance)
            usePositionsStore.getState().setDemoBalance(bal.balance)
          }
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

    // 4. WS subscription — handles at_update, sync, reconnect, and exchange.changed
    const unsub = wsService.subscribe((msg: WsMessage) => {
      if (msg.type === 'at_update' && msg.data) {
        applyATUpdate(msg.data)
      }
      // [Phase 12.A — Batch B] Typed exchange.changed frame. Emitted by the
      // server on /api/exchange/{save,disconnect,verify} success AND as a
      // warm-start on every WS connect. Field names on the wire are
      // shortened (exchange / mode); map to the longer store field names
      // here. ?? null preserves canonical null (blocked / no creds).
      // Patches only the 5 exchange/env fields this frame carries — does
      // NOT touch positions, stats, kill-switch, or any engine state.
      if (msg.type === 'exchange.changed' && msg.data) {
        const d = msg.data
        useUiStore.getState().patch({
          activeExchange: (d.exchange ?? null) as 'binance' | 'bybit' | null,
          exchangeMode: d.mode || null,
          apiConfigured: !!d.apiConfigured,
          executionEnv: (d.executionEnv ?? null) as 'DEMO' | 'TESTNET' | 'REAL' | null,
          executionBlockedReason: (d.executionBlockedReason ?? null) as 'NO_ACTIVE_API_CREDENTIALS' | 'INVALID_ACTIVE_API_CONFIGURATION' | null,
        })
        // Live balance refresh is wired via the uiStore subscription below
        // (see section 7) — it re-arms whenever executionEnv/apiConfigured flip.
      }
      if (msg.type === 'support.message' && msg.data) {
        import('../stores/supportStore').then(({ useSupportStore }) => {
          useSupportStore.getState().onIncoming(msg.data)
        }).catch(() => {})
      }
      if (msg.type === 'sync') {
        // Cross-device sync signal — re-pull balance only; positions via state.ts bridge
        syncApi.pullState().then((res) => {
          if (res.ok && res.data && res.data.demoBalance) {
            const bal = extractBalance(res.data.demoBalance)
            usePositionsStore.getState().setDemoBalance(bal.balance)
          }
        })
        pullJournal()
      }
      if (msg.type === 'reconnect') {
        // [Phase 3E] WS reconnected after a close — pull canonical truth immediately
        // (do not wait for server push or 30s polling tick). This refreshes AT state,
        // env flags (resolvedEnv/executionEnv/exchangeMode/activeExchange), and
        // position ownership fields (state.ts bridge merges positions with
        // autoTrade/sourceMode/controlMode/mode preserved via _mapServerPos).
        pullATState()
        // [Phase 8A1] Also re-pull server settings and ARES on reconnect. Without this
        // a stale client that missed settings.changed pushes during the disconnect
        // window keeps rendering default values (e.g. LIVE appears to "revert to
        // defaults" after a reconnect). Server is canonical — match boot behavior.
        import('../stores/settingsStore').then(({ useSettingsStore }) => {
          useSettingsStore.getState().loadFromServer()
        }).catch(() => {})
        import('../stores/aresStore').then(({ useAresStore }) => {
          useAresStore.getState().loadFromServer()
        }).catch(() => {})
        // [Phase 8B2] Re-pull /api/sync/state on reconnect so demoBalance
        // and the positions snapshot (consumed by state.ts bridge path) are
        // refreshed. Missed positions.changed pushes during the disconnect
        // window could otherwise leave the client showing a closed position
        // or missing a newly opened one until the next 30s poll.
        syncApi.pullState().then((res) => {
          if (res.ok && res.data && res.data.demoBalance) {
            const bal = extractBalance(res.data.demoBalance)
            usePositionsStore.getState().setDemoBalance(bal.balance)
          }
        }).catch(() => {})
        // [Phase 8B5] Reset lastSnapshotTs so the first post-reconnect
        // positions.changed is accepted even if the server side's
        // updated_at went backwards (rare but possible after a server
        // restart or clock rewind). Monotonic dedup resumes from the new
        // baseline as soon as that first snapshot applies.
        usePositionsStore.getState().resetSnapshotTs()
      }
      useUiStore.getState().setConnected(true)
    })

    // 5. AT polling fallback — every 30s, gated on tab visibility.
    // [Phase C 2026-05-19] Background tabs skip the tick to reduce
    // multi-tab fanout. Foreground tab does the work; background tabs
    // receive updates via WS or the next visible transition.
    pollRef.current = setInterval(() => {
        if (isTabVisible()) pullATState()
    }, 30000)

    // [Phase C 2026-05-19] Immediate pull when tab becomes visible after
    // being hidden — state may be stale.
    const offVis = onVisibilityChange((visible) => {
        if (visible) pullATState()
    })

    // 6. Connection status check
    const connInterval = setInterval(() => {
      useUiStore.getState().setConnected(wsService.isConnected())
    }, 3000)

    // 7. Live balance auto-sync — single subscription that re-evaluates whenever
    //    executionEnv or apiConfigured flips (regardless of source: at_update,
    //    exchange.changed WS frame, REST pullATState, etc.). Recovers TP.liveBalance
    //    after circuit-breaker stalls and on first boot when API is configured.
    const _ui0 = useUiStore.getState()
    _refreshLiveBalanceFor(_ui0.executionEnv, _ui0.apiConfigured)
    const unsubUi = useUiStore.subscribe((s) => {
      _refreshLiveBalanceFor(s.executionEnv, s.apiConfigured)
    })

    return () => {
      clearTimeout(initTimer)
      unsub()
      unsubUi()
      offVis()
      stopLiveBalanceAutoSync()
      if (pollRef.current) clearInterval(pollRef.current)
      clearInterval(connInterval)
    }
  }, [authenticated])
}
