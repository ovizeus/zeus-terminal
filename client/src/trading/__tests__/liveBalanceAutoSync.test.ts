import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    startLiveBalanceAutoSync,
    stopLiveBalanceAutoSync,
    _getStateForTest,
} from '../liveBalanceAutoSync'

describe('liveBalanceAutoSync', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        stopLiveBalanceAutoSync()
    })

    afterEach(() => {
        stopLiveBalanceAutoSync()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('does NOT schedule when env is DEMO', () => {
        const syncFn = vi.fn().mockResolvedValue(null)
        startLiveBalanceAutoSync({ env: 'DEMO', apiConfigured: true, syncFn, intervalMs: 60000 })
        expect(syncFn).not.toHaveBeenCalled()
        expect(_getStateForTest().intervalActive).toBe(false)
    })

    it('does NOT schedule when env is null (locked)', () => {
        const syncFn = vi.fn().mockResolvedValue(null)
        startLiveBalanceAutoSync({ env: null, apiConfigured: true, syncFn, intervalMs: 60000 })
        expect(syncFn).not.toHaveBeenCalled()
        expect(_getStateForTest().intervalActive).toBe(false)
    })

    it('does NOT schedule when apiConfigured=false', () => {
        const syncFn = vi.fn().mockResolvedValue(null)
        startLiveBalanceAutoSync({ env: 'TESTNET', apiConfigured: false, syncFn, intervalMs: 60000 })
        expect(syncFn).not.toHaveBeenCalled()
        expect(_getStateForTest().intervalActive).toBe(false)
    })

    it('TESTNET + apiConfigured triggers immediate sync', () => {
        const syncFn = vi.fn().mockResolvedValue(null)
        startLiveBalanceAutoSync({ env: 'TESTNET', apiConfigured: true, syncFn, intervalMs: 60000 })
        expect(syncFn).toHaveBeenCalledTimes(1)
    })

    it('REAL + apiConfigured triggers immediate sync', () => {
        const syncFn = vi.fn().mockResolvedValue(null)
        startLiveBalanceAutoSync({ env: 'REAL', apiConfigured: true, syncFn, intervalMs: 60000 })
        expect(syncFn).toHaveBeenCalledTimes(1)
    })

    it('schedules periodic sync at intervalMs after immediate fire', () => {
        const syncFn = vi.fn().mockResolvedValue(null)
        startLiveBalanceAutoSync({ env: 'TESTNET', apiConfigured: true, syncFn, intervalMs: 60000 })
        expect(syncFn).toHaveBeenCalledTimes(1)  // immediate
        vi.advanceTimersByTime(60000)
        expect(syncFn).toHaveBeenCalledTimes(2)  // +1 tick
        vi.advanceTimersByTime(60000)
        expect(syncFn).toHaveBeenCalledTimes(3)  // +2 tick
    })

    it('stopLiveBalanceAutoSync clears scheduled interval', () => {
        const syncFn = vi.fn().mockResolvedValue(null)
        startLiveBalanceAutoSync({ env: 'TESTNET', apiConfigured: true, syncFn, intervalMs: 60000 })
        expect(syncFn).toHaveBeenCalledTimes(1)
        stopLiveBalanceAutoSync()
        expect(_getStateForTest().intervalActive).toBe(false)
        vi.advanceTimersByTime(120000)
        expect(syncFn).toHaveBeenCalledTimes(1)  // no extra fires after stop
    })

    it('idempotent: starting twice with same env+apiConfigured does NOT double-fire immediate sync', () => {
        const syncFn = vi.fn().mockResolvedValue(null)
        startLiveBalanceAutoSync({ env: 'TESTNET', apiConfigured: true, syncFn, intervalMs: 60000 })
        startLiveBalanceAutoSync({ env: 'TESTNET', apiConfigured: true, syncFn, intervalMs: 60000 })
        expect(syncFn).toHaveBeenCalledTimes(1)  // second call is no-op
    })

    it('env transition TESTNET→REAL re-fires immediate sync', () => {
        const syncFn = vi.fn().mockResolvedValue(null)
        startLiveBalanceAutoSync({ env: 'TESTNET', apiConfigured: true, syncFn, intervalMs: 60000 })
        expect(syncFn).toHaveBeenCalledTimes(1)
        startLiveBalanceAutoSync({ env: 'REAL', apiConfigured: true, syncFn, intervalMs: 60000 })
        expect(syncFn).toHaveBeenCalledTimes(2)
    })

    it('env transition TESTNET→DEMO stops the interval', () => {
        const syncFn = vi.fn().mockResolvedValue(null)
        startLiveBalanceAutoSync({ env: 'TESTNET', apiConfigured: true, syncFn, intervalMs: 60000 })
        expect(syncFn).toHaveBeenCalledTimes(1)
        startLiveBalanceAutoSync({ env: 'DEMO', apiConfigured: true, syncFn, intervalMs: 60000 })
        expect(_getStateForTest().intervalActive).toBe(false)
        vi.advanceTimersByTime(120000)
        expect(syncFn).toHaveBeenCalledTimes(1)  // no further fires
    })

    it('rejects intervalMs below 10s (safety floor against runaway)', () => {
        const syncFn = vi.fn().mockResolvedValue(null)
        startLiveBalanceAutoSync({ env: 'TESTNET', apiConfigured: true, syncFn, intervalMs: 5000 })
        // Clamped to 10s minimum
        expect(_getStateForTest().intervalMs).toBe(10000)
    })

    it('swallows sync errors so interval stays alive', async () => {
        const syncFn = vi.fn().mockRejectedValue(new Error('circuit breaker open'))
        startLiveBalanceAutoSync({ env: 'TESTNET', apiConfigured: true, syncFn, intervalMs: 60000 })
        await vi.advanceTimersByTimeAsync(0) // flush microtasks (immediate sync promise)
        expect(syncFn).toHaveBeenCalledTimes(1)
        // Next tick should still fire despite previous error
        await vi.advanceTimersByTimeAsync(60000)
        expect(syncFn).toHaveBeenCalledTimes(2)
    })
})
