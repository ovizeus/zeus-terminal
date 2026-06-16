# Binance Rate-Limit Phase C — Client-Side Tab Dedupe

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate multi-tab polling fanout where each open browser tab independently polls `liveApiSyncState` + `pullATState` + `loadFromServer`, multiplying server load and Binance API consumption. Single foreground tab runs the polling work; background tabs receive updates via BroadcastChannel.

**Architecture:**
- New `client/src/utils/tabVisibility.ts` exposes `isTabVisible()` reading `document.visibilityState === 'visible'` + subscribers fire on `visibilitychange` event. Pure helper module, framework-agnostic.
- New `client/src/services/tabSync.ts` wraps `BroadcastChannel('zeus-tab-sync')` with typed publish/subscribe API. Foreground tab broadcasts sync snapshots; background tabs subscribe to receive without polling. Falls back to no-op when BroadcastChannel unavailable (older browsers, file:// origins).
- `useServerSync.ts` gates `pullATState` polling on `isTabVisible()` — background tabs skip the 30s tick. On `visibilitychange → visible`, immediately pull (in case state stale).
- `liveBalanceAutoSync.ts` extends `_shouldSchedule` with visibility check — background tabs hold their timer in a paused state.
- `settingsStore.loadFromServer` + `aresStore.loadFromServer` wrapped with 300ms trailing-debounce to coalesce rapid config-save storms.
- Phase 2 fusion math UNTOUCHED. No changes to server code or Phase B/A.1 work. Server-side weight reduction is best-effort observational; if all tabs are background, polling pauses entirely until one becomes visible.

**Tech Stack:** TypeScript + React hooks, vitest for component tests, Page Visibility API, BroadcastChannel API, debounce via setTimeout.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `client/src/utils/tabVisibility.ts` | Page Visibility API wrapper: `isTabVisible()`, `onVisibilityChange(fn)` subscribe + cleanup | Create |
| `client/src/services/tabSync.ts` | BroadcastChannel wrapper with publish/subscribe, fallback to no-op | Create |
| `client/src/utils/debounce.ts` | Generic trailing-debounce helper (if not already present) | Create or reuse |
| `client/src/hooks/useServerSync.ts` | Gate `pullATState` 30s tick on visibility + immediate pull on visible | Modify |
| `client/src/trading/liveBalanceAutoSync.ts` | Add visibility check to `_shouldSchedule` + visibility-driven re-arm | Modify |
| `client/src/stores/settingsStore.ts` | Wrap `loadFromServer` with 300ms trailing debounce | Modify |
| `client/src/stores/aresStore.ts` | Same: wrap `loadFromServer` with debounce | Modify |
| `client/src/utils/__tests__/tabVisibility.test.ts` | Unit tests for visibility helper | Create |
| `client/src/services/__tests__/tabSync.test.ts` | Unit tests for BroadcastChannel wrapper | Create |
| `client/src/utils/__tests__/debounce.test.ts` | Unit tests for debounce helper (if new) | Create or skip |

---

## Task 1: Tab visibility helper (TDD RED + GREEN)

**Files:**
- Create: `client/src/utils/tabVisibility.ts`
- Create: `client/src/utils/__tests__/tabVisibility.test.ts`

- [ ] **Step 1: Write failing test**

Create `client/src/utils/__tests__/tabVisibility.test.ts`:

```ts
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { isTabVisible, onVisibilityChange } from '../tabVisibility'

describe('tabVisibility', () => {
    beforeEach(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    })

    test('isTabVisible returns true when document.visibilityState is visible', () => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
        expect(isTabVisible()).toBe(true)
    })

    test('isTabVisible returns false when document.visibilityState is hidden', () => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
        expect(isTabVisible()).toBe(false)
    })

    test('isTabVisible returns false when document.visibilityState is prerender', () => {
        Object.defineProperty(document, 'visibilityState', { value: 'prerender', configurable: true })
        expect(isTabVisible()).toBe(false)
    })

    test('onVisibilityChange registers listener and fires on visibilitychange event', () => {
        const cb = vi.fn()
        const off = onVisibilityChange(cb)
        document.dispatchEvent(new Event('visibilitychange'))
        expect(cb).toHaveBeenCalledTimes(1)
        off()
    })

    test('onVisibilityChange off() removes listener', () => {
        const cb = vi.fn()
        const off = onVisibilityChange(cb)
        off()
        document.dispatchEvent(new Event('visibilitychange'))
        expect(cb).not.toHaveBeenCalled()
    })

    test('onVisibilityChange passes current isVisible to callback', () => {
        const cb = vi.fn()
        onVisibilityChange(cb)
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
        expect(cb).toHaveBeenCalledWith(false)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal/client && npx vitest run src/utils/__tests__/tabVisibility.test.ts`
Expected: FAIL — module `'../tabVisibility'` does not exist.

- [ ] **Step 3: Implement helper**

Create `client/src/utils/tabVisibility.ts`:

```ts
/**
 * [Phase C 2026-05-19] Tab visibility helper.
 * Wraps Page Visibility API for use across polling/sync code.
 * Foreground tabs drive real polling; background tabs receive updates
 * via BroadcastChannel (see tabSync.ts).
 */

export function isTabVisible(): boolean {
    if (typeof document === 'undefined') return true  // SSR safety
    return document.visibilityState === 'visible'
}

export type VisibilityCallback = (isVisible: boolean) => void

/**
 * Subscribe to visibility changes. Returns a function to unsubscribe.
 * Callback receives the current isVisible state on every change.
 */
export function onVisibilityChange(cb: VisibilityCallback): () => void {
    if (typeof document === 'undefined') return () => {}
    const handler = () => cb(isTabVisible())
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
}
```

- [ ] **Step 4: Run test to verify passes**

Run: `cd /root/zeus-terminal/client && npx vitest run src/utils/__tests__/tabVisibility.test.ts`
Expected: PASS, 6/6 tests.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add client/src/utils/tabVisibility.ts client/src/utils/__tests__/tabVisibility.test.ts
git commit -m "[Phase C] tab visibility helper (Page Visibility API)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: BroadcastChannel wrapper (TDD RED + GREEN)

**Files:**
- Create: `client/src/services/tabSync.ts`
- Create: `client/src/services/__tests__/tabSync.test.ts`

- [ ] **Step 1: Write failing test**

Create `client/src/services/__tests__/tabSync.test.ts`:

```ts
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal/client && npx vitest run src/services/__tests__/tabSync.test.ts`
Expected: FAIL — module `'../tabSync'` does not exist.

- [ ] **Step 3: Implement wrapper**

Create `client/src/services/tabSync.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify passes**

Run: `cd /root/zeus-terminal/client && npx vitest run src/services/__tests__/tabSync.test.ts`
Expected: PASS, 5/5 tests.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add client/src/services/tabSync.ts client/src/services/__tests__/tabSync.test.ts
git commit -m "[Phase C] BroadcastChannel wrapper for cross-tab sync

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Debounce helper (TDD RED + GREEN)

**Files:**
- Create: `client/src/utils/debounce.ts`
- Create: `client/src/utils/__tests__/debounce.test.ts`

First check if debounce already exists in codebase:

```bash
grep -rln "function debounce\|export.*debounce" client/src --include="*.ts" --include="*.tsx" 2>&1 | head -3
```

If found, skip this task and reuse the existing module in Task 5/6. If not found, proceed.

- [ ] **Step 1: Write failing test**

Create `client/src/utils/__tests__/debounce.test.ts`:

```ts
import { describe, test, expect, vi } from 'vitest'
import { debounce } from '../debounce'

describe('debounce — trailing edge', () => {
    test('calls fn once after delay when invoked once', async () => {
        const fn = vi.fn()
        const deb = debounce(fn, 50)
        deb('a')
        expect(fn).not.toHaveBeenCalled()
        await new Promise(r => setTimeout(r, 70))
        expect(fn).toHaveBeenCalledTimes(1)
        expect(fn).toHaveBeenCalledWith('a')
    })

    test('multiple rapid calls coalesce into one call with last args', async () => {
        const fn = vi.fn()
        const deb = debounce(fn, 50)
        deb('a')
        deb('b')
        deb('c')
        await new Promise(r => setTimeout(r, 70))
        expect(fn).toHaveBeenCalledTimes(1)
        expect(fn).toHaveBeenCalledWith('c')
    })

    test('calls separated by more than delay each fire', async () => {
        const fn = vi.fn()
        const deb = debounce(fn, 30)
        deb('a')
        await new Promise(r => setTimeout(r, 50))
        deb('b')
        await new Promise(r => setTimeout(r, 50))
        expect(fn).toHaveBeenCalledTimes(2)
    })

    test('cancel() prevents pending call', async () => {
        const fn = vi.fn()
        const deb = debounce(fn, 50)
        deb('a')
        deb.cancel()
        await new Promise(r => setTimeout(r, 70))
        expect(fn).not.toHaveBeenCalled()
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/zeus-terminal/client && npx vitest run src/utils/__tests__/debounce.test.ts`
Expected: FAIL — module `'../debounce'` does not exist.

- [ ] **Step 3: Implement helper**

Create `client/src/utils/debounce.ts`:

```ts
/**
 * [Phase C 2026-05-19] Trailing-edge debounce.
 * Coalesces rapid calls into one execution after `delay` ms of quiet.
 * Used to dedupe config-save storms (settingsStore.loadFromServer,
 * aresStore.loadFromServer).
 */

export interface DebouncedFn<T extends (...args: any[]) => any> {
    (...args: Parameters<T>): void
    cancel(): void
}

export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): DebouncedFn<T> {
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastArgs: Parameters<T> | null = null

    const debounced = ((...args: Parameters<T>) => {
        lastArgs = args
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
            timer = null
            const a = lastArgs
            lastArgs = null
            if (a) fn(...a)
        }, delay)
    }) as DebouncedFn<T>

    debounced.cancel = () => {
        if (timer !== null) clearTimeout(timer)
        timer = null
        lastArgs = null
    }

    return debounced
}
```

- [ ] **Step 4: Run test to verify passes**

Run: `cd /root/zeus-terminal/client && npx vitest run src/utils/__tests__/debounce.test.ts`
Expected: PASS, 4/4 tests.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add client/src/utils/debounce.ts client/src/utils/__tests__/debounce.test.ts
git commit -m "[Phase C] trailing-edge debounce helper

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Gate useServerSync polling on visibility

**Files:**
- Modify: `client/src/hooks/useServerSync.ts`

- [ ] **Step 1: Read current polling block**

Open `client/src/hooks/useServerSync.ts`. Around line 278-282 there's the polling block:

```ts
    // 5. AT polling fallback — every 30s (old JS already polls at 10s, avoid double-hit)
    pollRef.current = setInterval(pullATState, 30000)
```

This fires regardless of tab visibility.

- [ ] **Step 2: Add visibility import + gate**

At the top of the file (around line 11), add the import:

```ts
import { isTabVisible, onVisibilityChange } from '../utils/tabVisibility'
```

Then locate the polling setup block (around line 280). Replace:

```ts
    // 5. AT polling fallback — every 30s (old JS already polls at 10s, avoid double-hit)
    pollRef.current = setInterval(pullATState, 30000)
```

With:

```ts
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
```

Then locate the cleanup block (around line 297-304):

```ts
    return () => {
      clearTimeout(initTimer)
      unsub()
      unsubUi()
      stopLiveBalanceAutoSync()
      if (pollRef.current) clearInterval(pollRef.current)
      clearInterval(connInterval)
    }
```

Add `offVis()` to the cleanup:

```ts
    return () => {
      clearTimeout(initTimer)
      unsub()
      unsubUi()
      offVis()
      stopLiveBalanceAutoSync()
      if (pollRef.current) clearInterval(pollRef.current)
      clearInterval(connInterval)
    }
```

- [ ] **Step 3: Verify build**

Run: `cd /root/zeus-terminal/client && npm run build 2>&1 | tail -5`
Expected: `✓ built in Xms`, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
cd /root/zeus-terminal && git add client/src/hooks/useServerSync.ts
git commit -m "[Phase C] gate useServerSync polling on tab visibility

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Gate liveBalanceAutoSync on visibility

**Files:**
- Modify: `client/src/trading/liveBalanceAutoSync.ts`

- [ ] **Step 1: Read current scheduling logic**

Open `client/src/trading/liveBalanceAutoSync.ts`. The key function is `_shouldSchedule` and the periodic `setInterval` in `startLiveBalanceAutoSync`.

- [ ] **Step 2: Add visibility import**

At the top of the file, after the existing comment block, add the import:

```ts
import { isTabVisible, onVisibilityChange } from '../utils/tabVisibility'
```

- [ ] **Step 3: Gate the setInterval tick on visibility**

Locate the existing `setInterval` block in `startLiveBalanceAutoSync` (around line 74):

```ts
    _state.timerId = setInterval(() => {
        try { syncFn().catch(() => { /* swallow — keep interval alive */ }) } catch (_) {}
    }, intervalMs)
```

Replace with:

```ts
    _state.timerId = setInterval(() => {
        // [Phase C 2026-05-19] Skip tick when tab is in background — the
        // foreground tab does the polling work; this tab will catch up on
        // visibility-restore via the listener below.
        if (!isTabVisible()) return
        try { syncFn().catch(() => { /* swallow — keep interval alive */ }) } catch (_) {}
    }, intervalMs)
```

- [ ] **Step 4: Add visibility listener for resume-on-visible**

In the `State` interface near the top (around line 22):

```ts
interface State {
    timerId: ReturnType<typeof setInterval> | null
    lastKey: string  // composite of env+apiConfigured to detect transitions
    intervalMs: number
}
```

Add a `visOff` field:

```ts
interface State {
    timerId: ReturnType<typeof setInterval> | null
    lastKey: string  // composite of env+apiConfigured to detect transitions
    intervalMs: number
    visOff: (() => void) | null  // [Phase C] visibility listener cleanup
}
```

Update the `_state` initializer at line 27:

```ts
const _state: State = {
    timerId: null,
    lastKey: '',
    intervalMs: 0,
}
```

Replace with:

```ts
const _state: State = {
    timerId: null,
    lastKey: '',
    intervalMs: 0,
    visOff: null,
}
```

- [ ] **Step 5: Wire the visibility listener at start, clean at stop**

In `startLiveBalanceAutoSync`, after the `_state.timerId = setInterval(...)` line, add:

```ts
    // [Phase C 2026-05-19] On visibility restore, immediately sync — the
    // tab missed ticks while hidden; pull fresh state without waiting for
    // the next periodic tick.
    if (_state.visOff) { _state.visOff(); _state.visOff = null }
    _state.visOff = onVisibilityChange((visible) => {
        if (visible) {
            try { syncFn().catch(() => {}) } catch (_) {}
        }
    })
```

In `stopLiveBalanceAutoSync`, after `_clearInterval()`, add:

```ts
    if (_state.visOff) { _state.visOff(); _state.visOff = null }
```

And inside `_clearInterval` (or right at top of `startLiveBalanceAutoSync` if NOT scheduling), also clean if `!_shouldSchedule`:

In the early-return block:

```ts
    if (!_shouldSchedule(env, apiConfigured)) {
        _clearInterval()
        _state.lastKey = nextKey
        _state.intervalMs = intervalMs
        return
    }
```

Replace with:

```ts
    if (!_shouldSchedule(env, apiConfigured)) {
        _clearInterval()
        if (_state.visOff) { _state.visOff(); _state.visOff = null }
        _state.lastKey = nextKey
        _state.intervalMs = intervalMs
        return
    }
```

- [ ] **Step 6: Verify build**

Run: `cd /root/zeus-terminal/client && npm run build 2>&1 | tail -5`
Expected: `✓ built in Xms`, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
cd /root/zeus-terminal && git add client/src/trading/liveBalanceAutoSync.ts
git commit -m "[Phase C] gate liveBalanceAutoSync on visibility + resume-on-visible

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Debounce loadFromServer in stores

**Files:**
- Modify: `client/src/stores/settingsStore.ts`
- Modify: `client/src/stores/aresStore.ts`

- [ ] **Step 1: Locate settingsStore.loadFromServer signature**

Open `client/src/stores/settingsStore.ts`. Around line 119-134 the type + implementation:

```ts
loadFromServer: () => Promise<void>
```

and later:

```ts
loadFromServer: async () => {
    // ... fetches from server, hydrates store
},
```

- [ ] **Step 2: Wrap loadFromServer with debounce**

Strategy: keep the existing `loadFromServer` as the actual work, but expose a debounced wrapper. The store TYPE stays the same (caller doesn't care if debounced).

At the TOP of `client/src/stores/settingsStore.ts`, add the import:

```ts
import { debounce } from '../utils/debounce'
```

Find the `loadFromServer: async () => { ... }` implementation. Keep its body intact, but rename it to `_loadFromServerImpl`. Then create a debounced wrapper.

The minimal-touch approach: extract the existing body into a local function above the `create()` call, wrap it with debounce, and reference the debounced version in `loadFromServer`.

If the current structure looks like:

```ts
export const useSettingsStore = create<SettingsState>((set, get) => ({
    // ...
    loadFromServer: async () => {
        // ACTUAL WORK
    },
    // ...
}))
```

Refactor to:

```ts
// Module-scope debouncer — single shared instance across all callers.
// 300ms trailing window coalesces config-save storms (operator rapid
// edits, settings.changed WS bursts, reconnect cascades).
let _debouncedLoad: (() => void) | null = null

export const useSettingsStore = create<SettingsState>((set, get) => {
    const loadImpl = async () => {
        // ACTUAL WORK (copy-paste from current loadFromServer body)
    }
    if (!_debouncedLoad) {
        _debouncedLoad = debounce(() => { void loadImpl() }, 300)
    }
    return {
        // ...
        loadFromServer: async () => { _debouncedLoad!() },
        // ...
    }
})
```

NOTE: The exact refactor will depend on the current shape of `settingsStore.ts`. The principle: the debounced wrapper coalesces calls; the actual fetch fires once per quiet window.

Read the file first:

```bash
cat /root/zeus-terminal/client/src/stores/settingsStore.ts | head -160
```

Identify the `loadFromServer` block. Apply the wrap pattern above.

- [ ] **Step 3: Repeat for aresStore.ts**

Same pattern: import `debounce`, wrap the `loadFromServer` body in a module-scope debounce. Use a SEPARATE `_debouncedLoad` variable per store (not shared).

```bash
cat /root/zeus-terminal/client/src/stores/aresStore.ts | head -80
```

- [ ] **Step 4: Verify build**

Run: `cd /root/zeus-terminal/client && npm run build 2>&1 | tail -5`
Expected: `✓ built in Xms`, no TypeScript errors.

- [ ] **Step 5: Verify existing store tests still pass**

Run: `cd /root/zeus-terminal/client && npx vitest run src/stores/__tests__/ 2>&1 | tail -10`
Expected: All existing tests still pass. Some may be sensitive to debounce delays (300ms); if a test breaks because it expects synchronous load, add `await new Promise(r => setTimeout(r, 350))` after the call to wait for the debounced fire.

- [ ] **Step 6: Commit**

```bash
cd /root/zeus-terminal && git add client/src/stores/settingsStore.ts client/src/stores/aresStore.ts
git commit -m "[Phase C] debounce loadFromServer in settings + ares stores (300ms)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Full regression + bump + deploy + smoke

**Files:** none (verification only)

- [ ] **Step 1: Full vitest suite**

Run: `cd /root/zeus-terminal/client && npx vitest run 2>&1 | tail -10`
Expected: All client tests pass, no new failures.

- [ ] **Step 2: Full jest suite (server-side, ensure no regression)**

Run: `cd /root/zeus-terminal && npx jest --forceExit 2>&1 | tail -10`
Expected: 7114/7114 PASS (unchanged from Phase A.1 baseline — no server changes in Phase C).

- [ ] **Step 3: Client build**

Run: `cd /root/zeus-terminal/client && npm run build 2>&1 | tail -5`
Expected: `✓ built in Xms`, new bundle hash.

- [ ] **Step 4: Bump version**

Edit `server/version.js`. Change `version: '1.7.93'` → `version: '1.7.94'`, `build: 119` → `build: 120`. Prepend new changelog entry at START of `changelog: [` array:

```js
'b120 v1.7.94 — BIN-TELEM Phase C client tab dedupe 2026-05-19. Eliminates multi-tab polling fanout where each open browser tab independently polls /api/at/state + /api/sync/state + settings + ares. New utils/tabVisibility.ts wraps Page Visibility API (isTabVisible + onVisibilityChange). New services/tabSync.ts wraps BroadcastChannel("zeus-tab-sync") with publish/subscribe + no-op fallback. New utils/debounce.ts trailing-edge debouncer. useServerSync gates 30s pullATState tick on isTabVisible() + immediate pull on visibility restore. liveBalanceAutoSync skips tick when hidden + visibility listener for resume-on-visible. settingsStore.loadFromServer + aresStore.loadFromServer wrapped with 300ms trailing debounce to coalesce config-save storms (operator rapid edits, settings.changed WS bursts, reconnect cascades). Zero server changes — Phase B/A.1 untouched. Tests: tabVisibility 6, tabSync 5, debounce 4 = +15 new vitest. Full jest 7114/7114 unchanged. Justification empirică: 07:46 incident log dimineață arăta "[WS] Client connected uid=1 total=2" exact înainte de IP-CB tripped — 2 tabs deschise multiplicau polling-ul. Operator visible QuotaIndicator badge in ModeBar already shipped Phase A.1 (commits 62d5fdf→ce7f008). Next: Phase A.2 priority lanes P0..P5 + operator critical section, sau Phase D infra (Binance Futures WS unblock).',
```

- [ ] **Step 5: Commit version bump**

```bash
cd /root/zeus-terminal && git add server/version.js
git commit -m "[Phase C] bump v1.7.94 b120 — client tab dedupe

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 6: Tag + PM2 reload + smoke**

```bash
cd /root/zeus-terminal && git tag post-v2/PHASE-C-120 HEAD
pm2 reload zeus
sleep 4
curl -s http://127.0.0.1:3000/api/diag/binance-rates | python3 -c "
import json, sys
d = json.load(sys.stdin)
ap = d['activePollers']['marketFeed']
print('=== Post-PhaseC smoke ===')
print(f'pollers: {ap[\"altKlinePollersCount\"]} (expect 12)')
print(f'symbols: {ap[\"activeSymbolsCount\"]} (expect 4)')
print(f'symbolRefsTotal: {ap.get(\"symbolRefsTotal\")} (expect 4)')
print(f'quotaThresholds: {d.get(\"quotaThresholds\")}')
"
```

Expected: pollers 12, symbols 4, refsTotal 4, thresholds present. Server side unchanged.

- [ ] **Step 7: Browser smoke test (manual)**

Open Zeus in browser. Hard refresh (Ctrl+Shift+R) to load new bundle.

Manual verification:
1. Open 2 tabs of zeus-terminal.com
2. Open browser DevTools → Network tab on the BACKGROUND tab
3. Switch to the OTHER tab (background tab loses focus)
4. Wait 30 seconds — verify in the BACKGROUND tab's Network panel that `/api/at/state` IS NOT being polled
5. Switch BACK to the background tab — verify an IMMEDIATE `/api/at/state` request fires on visibility restore

If both behaviors confirmed: Phase C works. If background tab still polls, debug.

- [ ] **Step 8: Push branch + tag**

```bash
cd /root/zeus-terminal && git push origin omega/wave-1-foundation
git push origin post-v2/PHASE-C-120
```

---

# Self-Review Checklist

**1. Spec coverage:**
- ✅ Tab visibility detection → Task 1
- ✅ BroadcastChannel wrapper → Task 2
- ✅ Debounce helper → Task 3
- ✅ Foreground-only polling in useServerSync → Task 4
- ✅ Foreground-only liveBalanceAutoSync + resume-on-visible → Task 5
- ✅ Debounce loadFromServer in stores → Task 6
- ✅ Regression + deploy + smoke → Task 7

**2. Placeholders:** Task 6 Step 2 has a "depends on current shape" caveat — this is unavoidable because the refactor pattern requires reading the file first. The actual code to copy-paste is shown in the example wrap pattern.

**3. Type consistency:**
- `isTabVisible(): boolean` consistent in Tasks 1, 4, 5
- `onVisibilityChange(cb): () => void` consistent in Tasks 1, 4, 5
- `createTabSync(channelName): TabSync` returns `{publish, subscribe, close}` consistent in Task 2 (NOTE: Task 2 builds the infra; actual broadcast wiring deferred — see Open Questions below)
- `debounce<T>(fn, delay): DebouncedFn<T>` with `.cancel()` method consistent in Tasks 3, 6

**4. Open Question / Deferred:**
- **tabSync USAGE deferred to optional Task 8**: this plan ships the BroadcastChannel infra (Task 2) but doesn't wire it into actual snapshot publishing. Reason: visibility-gating (Tasks 4-5) achieves the primary goal (multi-tab fanout reduction). BroadcastChannel publish/subscribe pairing is more invasive — requires identifying snapshot producers (likely `applyATUpdate` in useServerSync) and consumers (background tab listeners). Defer to Phase C.2 if operator wants tighter cross-tab sync. The wrapper module is still shipped so it's available when needed.

**5. ARCH-3 verified:** No per-(user × env × symbol) state touched in Phase C. All changes are pure client-side polling gates. Server-side ref-counting (Phase B) + quota gate (Phase A.1) unchanged.

**6. Defensive properties:**
- BroadcastChannel falls back to no-op if API unavailable (older browsers, file://, CSP)
- isTabVisible() returns `true` in SSR (typeof document === undefined) — safe default
- Debounce.cancel() prevents pending call (useful for component cleanup)
- Visibility listener cleanup added to all useEffect returns

**7. Risk assessment:**
- **Low risk:** Tasks 1-3 (pure new files, no side effects)
- **Medium risk:** Task 4-5 (changes polling cadence; if visibility detection bugs, polling could stop entirely; mitigation: explicit `pullATState()` on visibility restore so worst-case is "10-30s delay before background tab catches up")
- **Medium risk:** Task 6 (300ms debounce could mask race conditions in tests; mitigation: existing tests verified post-change in Step 5)
- **No regression risk on server:** Phase C is client-only.
