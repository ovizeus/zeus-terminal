/**
 * [Phase C 2026-05-19] Cross-tab sync via BroadcastChannel.
 * Foreground tab publishes snapshots (AT state, positions, balance);
 * background tabs subscribe to receive without polling. Falls back to
 * no-op for environments without BroadcastChannel (very old browsers,
 * file:// origins, restrictive CSP).
 */

export type TabSyncMessageType =
    | 'at_state'
    | 'positions'
    | 'balance'
    | 'settings_changed'
    | 'ares_changed'
    | 'foreground_heartbeat'

export interface TabSyncMessage {
    type: TabSyncMessageType
    data: unknown
    ts: number
}

export interface TabSync {
    publish(msg: Omit<TabSyncMessage, 'ts'>): void
    subscribe(cb: (msg: TabSyncMessage) => void): () => void
    close(): void
}

function _noopSync(): TabSync {
    return {
        publish() {},
        subscribe() { return () => {} },
        close() {},
    }
}

export function createTabSync(channelName: string): TabSync {
    if (typeof globalThis === 'undefined') return _noopSync()
    const BC = (globalThis as any).BroadcastChannel
    if (typeof BC !== 'function') return _noopSync()

    let ch: any
    try {
        ch = new BC(channelName)
    } catch (_) {
        return _noopSync()
    }

    return {
        publish(msg) {
            try {
                ch.postMessage({ ...msg, ts: Date.now() })
            } catch (_) {
                // swallow — channel may be closed
            }
        },
        subscribe(cb) {
            const handler = (ev: MessageEvent) => {
                try {
                    if (ev.data && typeof ev.data === 'object') cb(ev.data as TabSyncMessage)
                } catch (_) { /* swallow listener errors */ }
            }
            ch.addEventListener('message', handler)
            return () => ch.removeEventListener('message', handler)
        },
        close() {
            try { ch.close() } catch (_) { /* swallow */ }
        },
    }
}
