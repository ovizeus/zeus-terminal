import { describe, test, expect } from 'vitest'
import { createTabSync, type TabSyncMessage } from '../tabSync'

describe('tabSync — BroadcastChannel wrapper', () => {
    test('createTabSync exposes publish + subscribe', () => {
        const sync = createTabSync('test-channel')
        expect(typeof sync.publish).toBe('function')
        expect(typeof sync.subscribe).toBe('function')
        expect(typeof sync.close).toBe('function')
        sync.close()
    })

    test('publish on one instance triggers subscribe callback on another', async () => {
        const a = createTabSync('test-channel-2')
        const b = createTabSync('test-channel-2')
        const received: TabSyncMessage[] = []
        b.subscribe((msg) => { received.push(msg) })
        a.publish({ type: 'at_state', data: { hello: 'world' } })
        // BroadcastChannel is async — wait one tick
        await new Promise(r => setTimeout(r, 10))
        expect(received.length).toBe(1)
        expect(received[0].type).toBe('at_state')
        expect((received[0].data as any).hello).toBe('world')
        a.close()
        b.close()
    })

    test('subscriber does NOT receive own published message (loopback off)', async () => {
        const a = createTabSync('test-channel-3')
        const received: TabSyncMessage[] = []
        a.subscribe((msg) => { received.push(msg) })
        a.publish({ type: 'at_state', data: {} })
        await new Promise(r => setTimeout(r, 10))
        expect(received.length).toBe(0)  // BroadcastChannel does not self-deliver
        a.close()
    })

    test('subscribe returns unsubscribe fn', async () => {
        const a = createTabSync('test-channel-4')
        const b = createTabSync('test-channel-4')
        const received: TabSyncMessage[] = []
        const off = b.subscribe((msg) => { received.push(msg) })
        off()
        a.publish({ type: 'at_state', data: {} })
        await new Promise(r => setTimeout(r, 10))
        expect(received.length).toBe(0)
        a.close()
        b.close()
    })

    test('falls back to no-op when BroadcastChannel undefined', () => {
        const orig = (globalThis as any).BroadcastChannel
        ;(globalThis as any).BroadcastChannel = undefined
        try {
            const sync = createTabSync('fallback')
            sync.subscribe(() => { throw new Error('should not fire') })
            sync.publish({ type: 'at_state', data: {} })
            sync.close()
            // No throw, no listener fires. Pass.
            expect(true).toBe(true)
        } finally {
            ;(globalThis as any).BroadcastChannel = orig
        }
    })
})
