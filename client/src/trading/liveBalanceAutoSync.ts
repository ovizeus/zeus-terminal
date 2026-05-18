// Zeus — trading/liveBalanceAutoSync.ts
// Periodic + on-change balance refresh helper for LIVE / TESTNET modes.
//
// Why this exists (2026-05-18 audit):
//   liveApiSyncState() was only triggered at 5 discrete moments (AT start,
//   demo→live transition, connectLiveAPI init, tab focus, post-trade). When
//   Binance circuit breaker opened or the first sync returned 0, TP.liveBalance
//   stayed stuck — operator had to manually press "Verify balance" in API
//   Settings to recover. This module wires a periodic sync (default 60s) +
//   immediate sync on every env/apiConfigured transition.

type Env = 'DEMO' | 'TESTNET' | 'REAL' | null

interface StartOpts {
    env: Env
    apiConfigured: boolean
    syncFn: () => Promise<unknown>
    intervalMs: number
}

interface State {
    timerId: ReturnType<typeof setInterval> | null
    lastKey: string  // composite of env+apiConfigured to detect transitions
    intervalMs: number
}

const _state: State = {
    timerId: null,
    lastKey: '',
    intervalMs: 0,
}

const MIN_INTERVAL_MS = 10000

function _shouldSchedule(env: Env, apiConfigured: boolean): boolean {
    return apiConfigured && (env === 'TESTNET' || env === 'REAL')
}

function _makeKey(env: Env, apiConfigured: boolean): string {
    return `${env || 'null'}|${apiConfigured ? '1' : '0'}`
}

function _clearInterval(): void {
    if (_state.timerId !== null) {
        clearInterval(_state.timerId)
        _state.timerId = null
    }
}

export function startLiveBalanceAutoSync(opts: StartOpts): void {
    const { env, apiConfigured, syncFn } = opts
    const intervalMs = Math.max(MIN_INTERVAL_MS, opts.intervalMs | 0)
    const nextKey = _makeKey(env, apiConfigured)

    if (!_shouldSchedule(env, apiConfigured)) {
        _clearInterval()
        _state.lastKey = nextKey
        _state.intervalMs = intervalMs
        return
    }

    // Idempotent: same env+apiConfigured already running → no-op
    if (_state.timerId !== null && _state.lastKey === nextKey) {
        return
    }

    _clearInterval()
    _state.lastKey = nextKey
    _state.intervalMs = intervalMs

    // Immediate fire — recovers from stale 0 balance after circuit breaker / first boot
    try { syncFn().catch(() => { /* swallow — interval continues */ }) } catch (_) {}

    _state.timerId = setInterval(() => {
        try { syncFn().catch(() => { /* swallow — keep interval alive */ }) } catch (_) {}
    }, intervalMs)
}

export function stopLiveBalanceAutoSync(): void {
    _clearInterval()
    _state.lastKey = ''
    _state.intervalMs = 0
}

export function _getStateForTest(): { intervalActive: boolean; intervalMs: number; lastKey: string } {
    return {
        intervalActive: _state.timerId !== null,
        intervalMs: _state.intervalMs,
        lastKey: _state.lastKey,
    }
}
