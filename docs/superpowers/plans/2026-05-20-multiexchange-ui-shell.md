# MultiExchange UI Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new dedicated page in Zeus accessed via a ₿ icon in the dock next to Ω. The page lists all current and future exchanges (Binance + Bybit active, OKX/Hyperliquid/Bitget/MEXC/HTX as Coming Soon). Click on an active exchange opens its API credentials form (currently in SettingsHubModal Exchange tab — to be moved here).

**Architecture:** UI-shell-only refactor. ZERO backend changes. The existing `/api/exchange/{status,save,verify,disconnect}` endpoints remain authoritative source of truth. New Zustand store `useMultiExchangeStore` wraps those endpoints with Promise dedup + cache TTL, mirroring `omegaChatStore.ts` pattern. SettingsHubModal Exchange tab is gutted and replaced with a redirect notice pointing to the new MultiExchange page. The dock gets a 16th icon (`multi-exchange`) and the new page is rendered via the existing `dockActive`-based routing in `PanelShell.tsx` (same pattern as OmegaPage).

**Tech Stack:**
- React 18 + TypeScript (functional components + hooks)
- Zustand for state management (per-user server-truth)
- Vitest + React Testing Library for tests
- CSS: existing `app.css` with `.multi-exchange-*` namespace (mirror `.omega-*`)
- Fonts: Orbitron (headers/labels) + JetBrains Mono (numbers/data) + Share Tech Mono (--ff default)
- Colors: existing `--cyan` (#00d4ff), `--gold` (#f0c040), `--grn` (#00d97a) + new amber/coming-soon token

---

## ⚠️ Server-Truth Invariants (Rule 0 — NEVER violate)

Every task below MUST respect these:

1. **All exchange state is per `req.user.id`** — never global, never hardcoded for a specific user.
2. **Display data ALWAYS comes from server** via `/api/exchange/*` endpoints — no client-side faked balance/status/maskedKey/lastVerified.
3. **The mutual-exclusion policy (Binance XOR Bybit, one active exchange max)** is enforced server-side via 409 EXCHANGE_CONFLICT. The client renders the `_isBlocked` UI state derived from server-sourced `accounts[]` ONLY — never decides blocking client-side.
4. **"Coming Soon" pillars (OKX/Hyperliquid/Bitget/MEXC/HTX)** are an explicit UI marker, NOT fake state. They show "Coming Soon — Phase N" with disabled click + no fields rendered. They do NOT pretend the exchange is connected or available.
5. **API credentials NEVER leave the server unencrypted.** Inputs are `type="password"`, posted directly to `/api/exchange/save`, encrypted via `credentialStore.js` before DB persist. Client receives only `maskedKey` (last 4 chars).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `client/src/ui/dock.ts` | MODIFY | Add `multi-exchange` entry to `DOCK_ITEMS` + add to `DOCK_ENABLED` |
| `client/src/components/layout/PanelShell.tsx` | MODIFY | Add `<MultiExchangePage />` panel block + import |
| `client/src/components/multiexchange/MultiExchangePage.tsx` | CREATE | Main page: header + grid of 7 exchange pillars + sub-view router |
| `client/src/components/multiexchange/ExchangeCard.tsx` | CREATE | Single pillar card (used in grid). Props: exchange id, status, accent color |
| `client/src/components/multiexchange/ExchangeDetail.tsx` | CREATE | Inner sub-view when clicking active pillar — full API form (extracted from SettingsHubModal) |
| `client/src/components/multiexchange/ComingSoonCard.tsx` | CREATE | Placeholder pillar for not-yet-implemented exchanges |
| `client/src/stores/multiExchangeStore.ts` | CREATE | Zustand store wrapping `/api/exchange/*` with Promise dedup + 60s TTL cache |
| `client/src/stores/index.ts` | MODIFY | Re-export `useMultiExchangeStore` |
| `client/src/app.css` | MODIFY | Add `.multi-exchange-*` namespace styles + dock icon styling for `multi-exchange` |
| `client/src/components/modals/SettingsHubModal.tsx` | MODIFY | Strip exchange tab JSX (lines 397-493) + handlers (lines 42-110) + state. Tab now shows redirect notice. |
| `client/src/components/multiexchange/__tests__/MultiExchangePage.test.tsx` | CREATE | Component tests: render, load accounts, click pillar, server-truth assertions |
| `client/src/components/multiexchange/__tests__/ExchangeCard.test.tsx` | CREATE | Per-pillar tests: active/inactive/coming-soon states |
| `client/src/stores/__tests__/multiExchangeStore.test.ts` | CREATE | Store tests: dedup, TTL cache, error handling, per-user isolation |
| `server/version.js` | MODIFY | Bump version `1.7.97` → `1.7.98`, build → +1, add changelog entry |

---

## Sequencing Strategy

Tasks are ordered for safe incremental commits. After Tasks 1-7 the new page works end-to-end alongside the old SettingsHubModal tab (both coexist). Only Task 9 removes the old tab — meaning if any of Tasks 1-8 fail tests or smoke check, the old flow remains untouched and we can rollback.

Each task ends with a commit. Total ~10 commits. No PM2 reload needed mid-stream (UI-only, served via Nginx static after `npm run build`).

---

## Task 1: Add ₿ MultiExchange Icon to Dock

**Files:**
- Modify: `client/src/ui/dock.ts:11-72` (DOCK_ITEMS array) and `client/src/ui/dock.ts:79` (DOCK_ENABLED list)
- Test: `client/src/components/__tests__/MultiExchangeDock.test.tsx` (CREATE)

- [ ] **Step 1: Write the failing test**

Create `client/src/components/__tests__/MultiExchangeDock.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { DOCK_ITEMS, DOCK_ENABLED } from '../../ui/dock'

describe('Dock — MultiExchange entry', () => {
  it('registers multi-exchange id with label "MultiExchange" and trading group', () => {
    const entry = DOCK_ITEMS.find((i: any) => i.id === 'multi-exchange')
    expect(entry).toBeDefined()
    expect(entry.label).toBe('MultiExchange')
    expect(entry.group).toBe('trading')
  })

  it('multi-exchange entry includes inline SVG with ₿ glyph path', () => {
    const entry = DOCK_ITEMS.find((i: any) => i.id === 'multi-exchange')
    expect(entry.svg).toMatch(/<path|<circle|<text/) // contains SVG content
    expect(entry.svg.length).toBeGreaterThan(50) // not stub
  })

  it('multi-exchange is in DOCK_ENABLED so it is clickable', () => {
    expect(DOCK_ENABLED).toContain('multi-exchange')
  })

  it('multi-exchange is positioned after omega in DOCK_ITEMS', () => {
    const omegaIdx = DOCK_ITEMS.findIndex((i: any) => i.id === 'omega')
    const meIdx = DOCK_ITEMS.findIndex((i: any) => i.id === 'multi-exchange')
    expect(omegaIdx).toBeGreaterThanOrEqual(0)
    expect(meIdx).toBe(omegaIdx + 1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /root/zeus-terminal/client && npx vitest run src/components/__tests__/MultiExchangeDock.test.tsx --reporter=verbose
```

Expected: FAIL with all 4 tests undefined / not found (`entry` is undefined; DOCK_ENABLED does not contain).

- [ ] **Step 3: Add multi-exchange entry to DOCK_ITEMS in dock.ts**

Modify `client/src/ui/dock.ts`. Find the OMEGA entry (around line 26-27, the one with `id: 'omega'`). Immediately AFTER the omega entry's closing `},` and BEFORE the ares entry, insert:

```typescript
  // [MultiExchange 2026-05-20] ₿ glyph — position 5 (after Omega, before ARES).
  // Bitcoin symbol on a hexagonal hub backdrop. Click → MultiExchangePage with
  // grid of all exchanges (Binance/Bybit active, others Coming Soon).
  { id: 'multi-exchange', label: 'MultiExchange', group: 'trading',
    svg: '<polygon points="12,2 21,7 21,17 12,22 3,17 3,7" fill="currentColor" opacity=".08"/><polygon points="12,2 21,7 21,17 12,22 3,17 3,7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M10 8h3.5c1.4 0 2.3.8 2.3 1.9 0 .9-.5 1.6-1.3 1.8.9.2 1.5 1 1.5 2 0 1.3-1 2.1-2.6 2.1H10V8zm1.3 3.3h1.9c.7 0 1.1-.4 1.1-1s-.4-1-1.1-1h-1.9v2zm0 3.4h2.1c.8 0 1.2-.4 1.2-1.1 0-.6-.4-1-1.2-1h-2.1v2.1z" fill="currentColor" stroke="none"/><line x1="12" y1="6.5" x2="12" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="12" y1="16" x2="12" y2="17.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },

```

- [ ] **Step 4: Add 'multi-exchange' to DOCK_ENABLED**

Modify `client/src/ui/dock.ts:79`. Replace:

```typescript
export var DOCK_ENABLED: any[] = ['autotrade', 'manual-trade', 'dsl', 'omega', 'ares', 'postmortem', 'pnllab', 'aria', 'nova', 'adaptive', 'flow', 'mtf', 'teacher', 'sigreg', 'activity', 'aub'];
```

with:

```typescript
export var DOCK_ENABLED: any[] = ['autotrade', 'manual-trade', 'dsl', 'omega', 'multi-exchange', 'ares', 'postmortem', 'pnllab', 'aria', 'nova', 'adaptive', 'flow', 'mtf', 'teacher', 'sigreg', 'activity', 'aub'];
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /root/zeus-terminal/client && npx vitest run src/components/__tests__/MultiExchangeDock.test.tsx --reporter=verbose
```

Expected: PASS 4/4.

- [ ] **Step 6: Run full client test suite to verify no regression**

```bash
cd /root/zeus-terminal/client && npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: no new failures. Pre-existing flakes (if any) unchanged.

- [ ] **Step 7: Commit**

```bash
cd /root/zeus-terminal && git add client/src/ui/dock.ts client/src/components/__tests__/MultiExchangeDock.test.tsx && git commit -m "feat(multiexchange): add ₿ icon to dock (DOCK_ITEMS + DOCK_ENABLED)

- New 'multi-exchange' entry in DOCK_ITEMS at position 5 (after omega)
- Bitcoin glyph SVG on hexagonal hub backdrop
- Added to DOCK_ENABLED so clickable
- 4 unit tests verify registration, position, SVG content"
```

---

## Task 2: Create MultiExchangeStore (Zustand, per-user server-truth)

**Files:**
- Create: `client/src/stores/multiExchangeStore.ts`
- Modify: `client/src/stores/index.ts` (add re-export)
- Test: `client/src/stores/__tests__/multiExchangeStore.test.ts` (CREATE)

- [ ] **Step 1: Write the failing test**

Create `client/src/stores/__tests__/multiExchangeStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useMultiExchangeStore } from '../multiExchangeStore'

describe('useMultiExchangeStore', () => {
  beforeEach(() => {
    useMultiExchangeStore.setState({
      accounts: {},
      loading: false,
      error: null,
      lastFetchTs: null,
      _loadInFlight: null,
    })
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loadAccounts populates accounts map from server response', async () => {
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        accounts: [
          { exchange: 'binance', mode: 'testnet', maskedKey: '****abcd', lastVerified: '2026-05-20T20:00:00Z' },
        ],
      }),
    } as any)

    await useMultiExchangeStore.getState().loadAccounts()
    expect(mockFetch).toHaveBeenCalledWith('/api/exchange/status', expect.any(Object))
    const state = useMultiExchangeStore.getState()
    expect(state.accounts.binance).toBeDefined()
    expect(state.accounts.binance.mode).toBe('testnet')
    expect(state.accounts.binance.maskedKey).toBe('****abcd')
    expect(state.lastFetchTs).toBeGreaterThan(0)
  })

  it('loadAccounts dedups concurrent calls via _loadInFlight', async () => {
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, accounts: [] }),
    } as any)

    const p1 = useMultiExchangeStore.getState().loadAccounts()
    const p2 = useMultiExchangeStore.getState().loadAccounts()
    await Promise.all([p1, p2])
    expect(mockFetch).toHaveBeenCalledTimes(1) // dedup
  })

  it('loadAccounts respects 60s cache TTL — second call within TTL skips fetch', async () => {
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, accounts: [] }),
    } as any)
    await useMultiExchangeStore.getState().loadAccounts()
    await useMultiExchangeStore.getState().loadAccounts() // within TTL
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('loadAccounts force=true bypasses TTL', async () => {
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, accounts: [] }),
    } as any)
    await useMultiExchangeStore.getState().loadAccounts()
    await useMultiExchangeStore.getState().loadAccounts(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('saveAccount POSTs to /api/exchange/save with exchange+apiKey+apiSecret+mode', async () => {
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, mode: 'testnet', maskedKey: '****wxyz', balance: 100, lastVerified: '2026-05-20T20:00:00Z' }),
    } as any)

    const result = await useMultiExchangeStore.getState().saveAccount('binance', 'KEY123', 'SECRET456', 'testnet')
    expect(mockFetch).toHaveBeenCalledWith('/api/exchange/save', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ exchange: 'binance', apiKey: 'KEY123', apiSecret: 'SECRET456', mode: 'testnet' }),
    }))
    expect(result.ok).toBe(true)
    const state = useMultiExchangeStore.getState()
    expect(state.accounts.binance).toBeDefined()
    expect(state.accounts.binance.balance).toBe(100)
  })

  it('saveAccount surfaces server message on failure (e.g. 409 EXCHANGE_CONFLICT)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: async () => ({ ok: false, message: 'Bybit is blocked because Binance is active', error: 'EXCHANGE_CONFLICT' }),
    } as any)

    const result = await useMultiExchangeStore.getState().saveAccount('bybit', 'K', 'S', 'testnet')
    expect(result.ok).toBe(false)
    expect(result.message).toBe('Bybit is blocked because Binance is active')
  })

  it('verifyAccount POSTs to /api/exchange/verify and updates balance + lastVerified', async () => {
    useMultiExchangeStore.setState({
      accounts: { binance: { connected: true, mode: 'testnet', maskedKey: '****x', balance: 0, lastVerified: '' } },
    })
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, balance: 250.55, lastVerified: '2026-05-20T21:00:00Z' }),
    } as any)

    await useMultiExchangeStore.getState().verifyAccount('binance')
    const state = useMultiExchangeStore.getState()
    expect(state.accounts.binance.balance).toBe(250.55)
    expect(state.accounts.binance.lastVerified).toBe('2026-05-20T21:00:00Z')
  })

  it('disconnectAccount POSTs to /api/exchange/disconnect and removes account from state', async () => {
    useMultiExchangeStore.setState({
      accounts: { binance: { connected: true, mode: 'testnet', maskedKey: '****x', balance: 0, lastVerified: '' } },
    })
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    } as any)

    await useMultiExchangeStore.getState().disconnectAccount('binance')
    const state = useMultiExchangeStore.getState()
    expect(state.accounts.binance).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /root/zeus-terminal/client && npx vitest run src/stores/__tests__/multiExchangeStore.test.ts --reporter=verbose
```

Expected: FAIL — `Cannot find module '../multiExchangeStore'`.

- [ ] **Step 3: Create the store**

Create `client/src/stores/multiExchangeStore.ts`:

```typescript
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
  mode: 'live' | 'testnet'
  maskedKey: string
  balance: number
  lastVerified: string
}

interface SaveResult {
  ok: boolean
  message?: string
  error?: string
  mode?: 'live' | 'testnet'
  maskedKey?: string
  balance?: number
  lastVerified?: string
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
}

async function _postJson(url: string, body: any) {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}

export const useMultiExchangeStore = create<MultiExchangeState>((set, get) => ({
  accounts: {},
  loading: false,
  error: null,
  lastFetchTs: null,
  _loadInFlight: null,

  loadAccounts: async (force?: boolean) => {
    const { lastFetchTs, _loadInFlight } = get()
    if (_loadInFlight) return _loadInFlight
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
}))
```

- [ ] **Step 4: Re-export from stores index**

Modify `client/src/stores/index.ts`. Add at the end of the file (after existing exports):

```typescript
export { useMultiExchangeStore } from './multiExchangeStore'
export type { ExchangeAccount } from './multiExchangeStore'
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /root/zeus-terminal/client && npx vitest run src/stores/__tests__/multiExchangeStore.test.ts --reporter=verbose
```

Expected: PASS 8/8.

- [ ] **Step 6: Commit**

```bash
cd /root/zeus-terminal && git add client/src/stores/multiExchangeStore.ts client/src/stores/index.ts client/src/stores/__tests__/multiExchangeStore.test.ts && git commit -m "feat(multiexchange): add useMultiExchangeStore Zustand store

- Mirrors omegaChatStore pattern: _loadInFlight dedup + 60s TTL cache
- Wraps /api/exchange/{status,save,verify,disconnect}
- Per-user server-truth (req.user.id cookie auth)
- 8 unit tests cover load/dedup/TTL/save/verify/disconnect + 409 conflict surfacing"
```

---

## Task 3: Create ExchangeCard component (single pillar)

**Files:**
- Create: `client/src/components/multiexchange/ExchangeCard.tsx`
- Test: `client/src/components/multiexchange/__tests__/ExchangeCard.test.tsx` (CREATE)

- [ ] **Step 1: Write the failing test**

Create `client/src/components/multiexchange/__tests__/ExchangeCard.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExchangeCard } from '../ExchangeCard'

describe('ExchangeCard', () => {
  it('renders ACTIVE state with connected info (mode, maskedKey, balance)', () => {
    const onClick = vi.fn()
    render(
      <ExchangeCard
        id="binance"
        label="BINANCE"
        status="active"
        account={{ connected: true, mode: 'testnet', maskedKey: '****abcd', balance: 1234.56, lastVerified: '2026-05-20T20:00:00Z' }}
        onClick={onClick}
      />
    )
    expect(screen.getByText(/BINANCE/i)).toBeDefined()
    expect(screen.getByText(/ACTIVE/i)).toBeDefined()
    expect(screen.getByText(/\*\*\*\*abcd/)).toBeDefined()
    expect(screen.getByText(/TESTNET/i)).toBeDefined()
  })

  it('renders INACTIVE state (account undefined) with placeholder', () => {
    const onClick = vi.fn()
    render(
      <ExchangeCard id="bybit" label="BYBIT" status="inactive" account={undefined} onClick={onClick} />
    )
    expect(screen.getByText(/BYBIT/i)).toBeDefined()
    expect(screen.getByText(/INACTIVE/i)).toBeDefined()
  })

  it('renders BLOCKED state (mutual exclusion) with explicit message', () => {
    const onClick = vi.fn()
    render(
      <ExchangeCard id="bybit" label="BYBIT" status="blocked" blockedMessage="Binance is currently active" onClick={onClick} />
    )
    expect(screen.getByText(/BLOCKED/i)).toBeDefined()
    expect(screen.getByText(/Binance is currently active/)).toBeDefined()
  })

  it('fires onClick when active card is clicked', () => {
    const onClick = vi.fn()
    render(
      <ExchangeCard
        id="binance"
        label="BINANCE"
        status="active"
        account={{ connected: true, mode: 'testnet', maskedKey: '****x', balance: 0, lastVerified: '' }}
        onClick={onClick}
      />
    )
    fireEvent.click(screen.getByTestId('exchange-card-binance'))
    expect(onClick).toHaveBeenCalledWith('binance')
  })

  it('does NOT fire onClick when blocked card is clicked', () => {
    const onClick = vi.fn()
    render(
      <ExchangeCard id="bybit" label="BYBIT" status="blocked" blockedMessage="x" onClick={onClick} />
    )
    fireEvent.click(screen.getByTestId('exchange-card-bybit'))
    expect(onClick).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /root/zeus-terminal/client && npx vitest run src/components/multiexchange/__tests__/ExchangeCard.test.tsx --reporter=verbose
```

Expected: FAIL — `Cannot find module '../ExchangeCard'`.

- [ ] **Step 3: Create the component**

Create `client/src/components/multiexchange/ExchangeCard.tsx`:

```typescript
import type { ExchangeAccount } from '../../stores/multiExchangeStore'

export type CardStatus = 'active' | 'inactive' | 'blocked'

interface Props {
  id: string
  label: string
  status: CardStatus
  account?: ExchangeAccount
  blockedMessage?: string
  onClick: (id: string) => void
}

const ACCENT: Record<string, string> = {
  binance: '#f0c040',
  bybit: '#aa44ff',
}

export function ExchangeCard({ id, label, status, account, blockedMessage, onClick }: Props) {
  const accent = ACCENT[id] || '#00d4ff'
  const isClickable = status === 'active' || status === 'inactive'

  const borderColor =
    status === 'active' ? accent :
    status === 'blocked' ? '#ff8844' :
    '#1f2937'

  const statusLabel =
    status === 'active' ? 'ACTIVE' :
    status === 'blocked' ? 'BLOCKED' :
    'INACTIVE'

  const statusColor =
    status === 'active' ? '#00d97a' :
    status === 'blocked' ? '#ff8844' :
    '#6b7280'

  return (
    <div
      data-testid={`exchange-card-${id}`}
      className={`multi-exchange-card multi-exchange-card-${status}`}
      style={{
        background: '#13192a',
        border: `1px solid ${borderColor}${status === 'active' ? '' : '33'}`,
        borderRadius: '6px',
        padding: '14px',
        cursor: isClickable ? 'pointer' : 'not-allowed',
        opacity: status === 'blocked' ? 0.75 : 1,
        boxShadow: status === 'active' ? `0 0 20px ${accent}26` : 'none',
        transition: 'transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
      }}
      onClick={() => { if (isClickable) onClick(id) }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: '14px', letterSpacing: '2px', color: accent }}>
          {label}
        </span>
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 600, fontSize: '10px', letterSpacing: '1px', color: statusColor }}>
          {status === 'active' ? '● ' : status === 'blocked' ? '🔒 ' : '○ '}
          {statusLabel}
        </span>
      </div>

      {status === 'active' && account && (
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#94a3b8', lineHeight: '1.7' }}>
          <div>Mode &nbsp;&nbsp; <span style={{ color: '#f0f4f8' }}>{account.mode.toUpperCase()}</span></div>
          <div>Key &nbsp;&nbsp;&nbsp; <span style={{ color: '#f0f4f8' }}>{account.maskedKey}</span></div>
          <div>Balance &nbsp;<span style={{ color: '#00d97a' }}>${(account.balance || 0).toFixed(2)}</span></div>
        </div>
      )}

      {status === 'inactive' && (
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#6b7280', lineHeight: '1.6' }}>
          No API credentials configured. Click to add.
        </div>
      )}

      {status === 'blocked' && (
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#ff8844', lineHeight: '1.6' }}>
          {blockedMessage || 'Blocked by mutual exclusion policy.'}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /root/zeus-terminal/client && npx vitest run src/components/multiexchange/__tests__/ExchangeCard.test.tsx --reporter=verbose
```

Expected: PASS 5/5.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add client/src/components/multiexchange/ExchangeCard.tsx client/src/components/multiexchange/__tests__/ExchangeCard.test.tsx && git commit -m "feat(multiexchange): add ExchangeCard component

- 3 states: active (cyan/accent glow), inactive (gray), blocked (amber)
- Server-truth: maskedKey/balance/mode all from props.account, never faked
- 5 RTL tests cover render states + click handler + blocked non-click"
```

---

## Task 4: Create ComingSoonCard component

**Files:**
- Create: `client/src/components/multiexchange/ComingSoonCard.tsx`
- Test: `client/src/components/multiexchange/__tests__/ComingSoonCard.test.tsx` (CREATE)

- [ ] **Step 1: Write the failing test**

Create `client/src/components/multiexchange/__tests__/ComingSoonCard.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ComingSoonCard } from '../ComingSoonCard'

describe('ComingSoonCard', () => {
  it('renders label and phase text', () => {
    render(<ComingSoonCard label="OKX" phase="Phase 3 — Jun 2026" />)
    expect(screen.getByText(/OKX/i)).toBeDefined()
    expect(screen.getByText(/COMING SOON/i)).toBeDefined()
    expect(screen.getByText(/Phase 3/i)).toBeDefined()
  })

  it('is non-clickable (no onClick handler)', () => {
    const { container } = render(<ComingSoonCard label="MEXC" phase="Phase 5" />)
    const card = container.firstChild as HTMLElement
    expect(card.style.cursor).toBe('not-allowed')
  })

  it('renders amber accent border', () => {
    const { container } = render(<ComingSoonCard label="HTX" phase="Phase 5" />)
    const card = container.firstChild as HTMLElement
    expect(card.style.border).toContain('#fbbf24')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /root/zeus-terminal/client && npx vitest run src/components/multiexchange/__tests__/ComingSoonCard.test.tsx --reporter=verbose
```

Expected: FAIL — `Cannot find module '../ComingSoonCard'`.

- [ ] **Step 3: Create the component**

Create `client/src/components/multiexchange/ComingSoonCard.tsx`:

```typescript
interface Props {
  label: string
  phase: string
}

export function ComingSoonCard({ label, phase }: Props) {
  return (
    <div
      data-testid={`coming-soon-card-${label.toLowerCase()}`}
      className="multi-exchange-card multi-exchange-card-coming-soon"
      style={{
        background: '#13192a',
        border: '1px dashed #fbbf2466',
        borderRadius: '6px',
        padding: '14px',
        cursor: 'not-allowed',
        opacity: 0.6,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Diagonal stripe overlay for "Coming Soon" feel */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'repeating-linear-gradient(45deg, transparent 0, transparent 8px, #fbbf2408 8px, #fbbf2408 12px)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: '14px', letterSpacing: '2px', color: '#94a3b8' }}>
            {label}
          </span>
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 600, fontSize: '10px', letterSpacing: '1px', color: '#fbbf24' }}>
            ◌ COMING SOON
          </span>
        </div>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#fbbf24cc', lineHeight: '1.6' }}>
          {phase}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /root/zeus-terminal/client && npx vitest run src/components/multiexchange/__tests__/ComingSoonCard.test.tsx --reporter=verbose
```

Expected: PASS 3/3.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add client/src/components/multiexchange/ComingSoonCard.tsx client/src/components/multiexchange/__tests__/ComingSoonCard.test.tsx && git commit -m "feat(multiexchange): add ComingSoonCard component

- Dashed amber border + diagonal stripe overlay
- Non-clickable (cursor: not-allowed)
- Used for OKX/Hyperliquid/Bitget/MEXC/HTX placeholders
- 3 RTL tests"
```

---

## Task 5: Create ExchangeDetail component (inner sub-view with API form)

**Files:**
- Create: `client/src/components/multiexchange/ExchangeDetail.tsx`
- Test: `client/src/components/multiexchange/__tests__/ExchangeDetail.test.tsx` (CREATE)

- [ ] **Step 1: Write the failing test**

Create `client/src/components/multiexchange/__tests__/ExchangeDetail.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ExchangeDetail } from '../ExchangeDetail'
import { useMultiExchangeStore } from '../../../stores/multiExchangeStore'

describe('ExchangeDetail', () => {
  beforeEach(() => {
    useMultiExchangeStore.setState({ accounts: {}, loading: false, error: null, lastFetchTs: null, _loadInFlight: null })
    vi.restoreAllMocks()
  })

  it('renders API key + secret input fields when not connected', () => {
    const onBack = vi.fn()
    render(<ExchangeDetail exchangeId="binance" onBack={onBack} />)
    expect(screen.getByPlaceholderText(/Paste API Key/i)).toBeDefined()
    expect(screen.getByPlaceholderText(/Paste Secret Key/i)).toBeDefined()
    expect(screen.getByText(/VERIFY & SAVE/i)).toBeDefined()
  })

  it('renders connected info + RE-VERIFY + DISCONNECT when account exists', () => {
    useMultiExchangeStore.setState({
      accounts: {
        binance: { connected: true, mode: 'testnet', maskedKey: '****abcd', balance: 100.5, lastVerified: '2026-05-20T20:00:00Z' },
      },
    })
    const onBack = vi.fn()
    render(<ExchangeDetail exchangeId="binance" onBack={onBack} />)
    expect(screen.getByText(/\*\*\*\*abcd/)).toBeDefined()
    expect(screen.getByText(/\$100\.50/)).toBeDefined()
    expect(screen.getByText(/RE-VERIFY/i)).toBeDefined()
    expect(screen.getByText(/DISCONNECT/i)).toBeDefined()
  })

  it('calls saveAccount on VERIFY & SAVE click with form values', async () => {
    const onBack = vi.fn()
    const saveAccount = vi.fn().mockResolvedValue({ ok: true, mode: 'testnet', maskedKey: '****x', balance: 0, lastVerified: '' })
    useMultiExchangeStore.setState({ saveAccount } as any)
    render(<ExchangeDetail exchangeId="binance" onBack={onBack} />)

    const keyInput = screen.getByPlaceholderText(/Paste API Key/i) as HTMLInputElement
    const secretInput = screen.getByPlaceholderText(/Paste Secret Key/i) as HTMLInputElement
    fireEvent.change(keyInput, { target: { value: 'KEY123' } })
    fireEvent.change(secretInput, { target: { value: 'SECRET456' } })

    await act(async () => { fireEvent.click(screen.getByText(/VERIFY & SAVE/i)) })

    expect(saveAccount).toHaveBeenCalledWith('binance', 'KEY123', 'SECRET456', 'testnet')
  })

  it('calls onBack when back button clicked', () => {
    const onBack = vi.fn()
    render(<ExchangeDetail exchangeId="binance" onBack={onBack} />)
    fireEvent.click(screen.getByTestId('exchange-detail-back'))
    expect(onBack).toHaveBeenCalled()
  })

  it('mode toggle defaults to testnet and can switch to live', () => {
    const onBack = vi.fn()
    render(<ExchangeDetail exchangeId="binance" onBack={onBack} />)
    const liveBtn = screen.getByTestId('mode-live')
    const testnetBtn = screen.getByTestId('mode-testnet')
    expect(testnetBtn.getAttribute('data-active')).toBe('true')
    fireEvent.click(liveBtn)
    expect(liveBtn.getAttribute('data-active')).toBe('true')
    expect(testnetBtn.getAttribute('data-active')).toBe('false')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /root/zeus-terminal/client && npx vitest run src/components/multiexchange/__tests__/ExchangeDetail.test.tsx --reporter=verbose
```

Expected: FAIL — `Cannot find module '../ExchangeDetail'`.

- [ ] **Step 3: Create the component**

Create `client/src/components/multiexchange/ExchangeDetail.tsx`:

```typescript
import { useState } from 'react'
import { useMultiExchangeStore } from '../../stores/multiExchangeStore'

const LABEL_MAP: Record<string, string> = {
  binance: 'BINANCE FUTURES',
  bybit: 'BYBIT DERIVATIVES',
}

const ACCENT_MAP: Record<string, string> = {
  binance: '#f0c040',
  bybit: '#aa44ff',
}

interface Props {
  exchangeId: string
  onBack: () => void
}

export function ExchangeDetail({ exchangeId, onBack }: Props) {
  const account = useMultiExchangeStore((s) => s.accounts[exchangeId])
  const saveAccount = useMultiExchangeStore((s) => s.saveAccount)
  const verifyAccount = useMultiExchangeStore((s) => s.verifyAccount)
  const disconnectAccount = useMultiExchangeStore((s) => s.disconnectAccount)

  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [mode, setMode] = useState<'live' | 'testnet'>('testnet')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const label = LABEL_MAP[exchangeId] || exchangeId.toUpperCase()
  const accent = ACCENT_MAP[exchangeId] || '#00d4ff'

  async function handleSave() {
    setLoading(true)
    setMsg(null)
    const r = await saveAccount(exchangeId, apiKey, apiSecret, mode)
    setLoading(false)
    if (r.ok) {
      setMsg({ text: `✓ Connected! Balance: $${(r.balance || 0).toFixed(2)}`, ok: true })
      setApiKey('')
      setApiSecret('')
    } else {
      setMsg({ text: r.message || r.error || 'Error', ok: false })
    }
  }

  async function handleVerify() {
    const r = await verifyAccount(exchangeId)
    setMsg({ text: r.ok ? `✓ Verified! Balance: $${(r.balance || 0).toFixed(2)}` : (r.message || r.error || 'Error'), ok: !!r.ok })
  }

  async function handleDisconnect() {
    const isReal = account?.mode === 'live'
    const confirmMsg = isReal
      ? `Disconnect REAL ${label}?\n\nAny live positions remain on the exchange — Zeus stops managing them.\n\nContinue?`
      : `Disconnect ${label} TESTNET?`
    if (!confirm(confirmMsg)) return
    const r = await disconnectAccount(exchangeId)
    if (!r.ok) setMsg({ text: r.error || 'Error', ok: false })
  }

  return (
    <div className="multi-exchange-detail" style={{ padding: '12px 16px' }}>
      <button
        data-testid="exchange-detail-back"
        onClick={onBack}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#00d4ff',
          fontFamily: 'Orbitron, sans-serif',
          fontSize: '12px',
          cursor: 'pointer',
          marginBottom: '16px',
          padding: '4px 0',
        }}
      >
        ← BACK
      </button>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 900, fontSize: '20px', letterSpacing: '3px', color: accent }}>
          {label}
        </span>
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: '10px', color: account ? '#00d97a' : '#6b7280' }}>
          {account ? `● ${account.mode.toUpperCase()} · ${account.maskedKey}` : '○ disconnected'}
        </span>
      </div>

      <div style={{ fontSize: '11px', color: '#ff8800', marginBottom: '14px', lineHeight: '1.6' }}>
        Keys are encrypted server-side · Use READ + TRADE only (no withdrawal) · Restrict by IP
      </div>

      {account ? (
        <div style={{ background: '#0a1018', border: `1px solid ${accent}33`, borderRadius: '6px', padding: '14px', marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace', lineHeight: '1.8' }}>
            <div>Balance &nbsp;<span style={{ color: '#00d97a' }}>${(account.balance || 0).toFixed(2)}</span></div>
            {account.lastVerified && (
              <div>Last Verified &nbsp;<span style={{ color: '#94a3b8' }}>{new Date(account.lastVerified).toLocaleString('ro-RO')}</span></div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '12px' }}>
            <button className="hub-sbtn" style={{ flex: 1 }} onClick={handleVerify}>RE-VERIFY</button>
            <button className="hub-sbtn" style={{ flex: 1, borderColor: '#ff335533', color: '#ff6655' }} onClick={handleDisconnect}>DISCONNECT</button>
          </div>
        </div>
      ) : (
        <div style={{ background: '#0a1018', border: `1px solid ${accent}33`, borderRadius: '6px', padding: '14px', marginBottom: '12px' }}>
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '10px', color: '#6a9080', marginBottom: '4px' }}>API KEY</div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste API Key"
              style={{ width: '100%', background: '#060c14', border: '1px solid #2a3a4a', color: 'var(--txt)', padding: '6px 10px', borderRadius: '3px', fontFamily: 'var(--ff)', fontSize: '11px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '10px', color: '#6a9080', marginBottom: '4px' }}>SECRET KEY</div>
            <input
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="Paste Secret Key"
              style={{ width: '100%', background: '#060c14', border: '1px solid #2a3a4a', color: 'var(--txt)', padding: '6px 10px', borderRadius: '3px', fontFamily: 'var(--ff)', fontSize: '11px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
            <button
              data-testid="mode-live"
              data-active={mode === 'live'}
              className="hub-sbtn"
              style={{ flex: 1, fontWeight: 700, color: '#ff6655', background: mode === 'live' ? '#ff444433' : 'transparent', border: `1px solid ${mode === 'live' ? '#ff4444' : '#ff444433'}` }}
              onClick={() => setMode('live')}
            >
              ● LIVE
            </button>
            <button
              data-testid="mode-testnet"
              data-active={mode === 'testnet'}
              className="hub-sbtn"
              style={{ flex: 1, fontWeight: 700, background: mode === 'testnet' ? `${accent}22` : 'transparent', border: `1px solid ${mode === 'testnet' ? accent : `${accent}33`}` }}
              onClick={() => setMode('testnet')}
            >
              ◎ TESTNET
            </button>
          </div>
          <button
            className="hub-sbtn pri"
            style={{ width: '100%', fontWeight: 700 }}
            onClick={handleSave}
            disabled={loading || !apiKey || !apiSecret}
          >
            {loading ? 'VERIFYING...' : 'VERIFY & SAVE'}
          </button>
        </div>
      )}

      {msg && (
        <div style={{ marginTop: '8px', fontSize: '11px', color: msg.ok ? '#00d97a' : '#ff5566', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace' }}>
          {msg.text}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /root/zeus-terminal/client && npx vitest run src/components/multiexchange/__tests__/ExchangeDetail.test.tsx --reporter=verbose
```

Expected: PASS 5/5.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add client/src/components/multiexchange/ExchangeDetail.tsx client/src/components/multiexchange/__tests__/ExchangeDetail.test.tsx && git commit -m "feat(multiexchange): add ExchangeDetail inner sub-view component

- Full API form (key/secret/mode toggle/save) when not connected
- Connected info (balance/lastVerified) + RE-VERIFY + DISCONNECT when connected
- DISCONNECT confirmation stricter for REAL mode (same UX as SettingsHubModal)
- Wires to useMultiExchangeStore.saveAccount/verifyAccount/disconnectAccount
- onBack callback for sub-view navigation
- 5 RTL tests"
```

---

## Task 6: Create MultiExchangePage with grid + sub-view router

**Files:**
- Create: `client/src/components/multiexchange/MultiExchangePage.tsx`
- Test: `client/src/components/multiexchange/__tests__/MultiExchangePage.test.tsx` (CREATE)

- [ ] **Step 1: Write the failing test**

Create `client/src/components/multiexchange/__tests__/MultiExchangePage.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MultiExchangePage } from '../MultiExchangePage'
import { useMultiExchangeStore } from '../../../stores/multiExchangeStore'

describe('MultiExchangePage', () => {
  beforeEach(() => {
    useMultiExchangeStore.setState({ accounts: {}, loading: false, error: null, lastFetchTs: null, _loadInFlight: null })
    vi.restoreAllMocks()
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, accounts: [] }),
    } as any)
  })

  it('renders header with MULTIEXCHANGE title', () => {
    render(<MultiExchangePage />)
    expect(screen.getByText(/MULTIEXCHANGE/i)).toBeDefined()
  })

  it('renders all 7 exchange pillars (2 active-able + 5 coming-soon)', async () => {
    render(<MultiExchangePage />)
    await waitFor(() => {
      expect(screen.getByText(/BINANCE/i)).toBeDefined()
      expect(screen.getByText(/BYBIT/i)).toBeDefined()
      expect(screen.getByText(/OKX/i)).toBeDefined()
      expect(screen.getByText(/HYPERLIQUID/i)).toBeDefined()
      expect(screen.getByText(/BITGET/i)).toBeDefined()
      expect(screen.getByText(/MEXC/i)).toBeDefined()
      expect(screen.getByText(/HTX/i)).toBeDefined()
    })
  })

  it('calls loadAccounts on mount', async () => {
    const loadAccounts = vi.fn().mockResolvedValue(undefined)
    useMultiExchangeStore.setState({ loadAccounts } as any)
    render(<MultiExchangePage />)
    await waitFor(() => expect(loadAccounts).toHaveBeenCalled())
  })

  it('renders ACTIVE state for binance when accounts.binance exists', async () => {
    useMultiExchangeStore.setState({
      accounts: { binance: { connected: true, mode: 'live', maskedKey: '****x', balance: 500, lastVerified: '2026-05-20T20:00:00Z' } },
      lastFetchTs: Date.now(),
    })
    render(<MultiExchangePage />)
    await waitFor(() => {
      expect(screen.getByText(/ACTIVE/i)).toBeDefined()
    })
  })

  it('renders BLOCKED state for bybit when binance is active (mutual exclusion)', async () => {
    useMultiExchangeStore.setState({
      accounts: { binance: { connected: true, mode: 'testnet', maskedKey: '****x', balance: 0, lastVerified: '' } },
      lastFetchTs: Date.now(),
    })
    render(<MultiExchangePage />)
    await waitFor(() => {
      expect(screen.getByText(/BLOCKED/i)).toBeDefined()
    })
  })

  it('clicking an inactive card opens ExchangeDetail sub-view', async () => {
    render(<MultiExchangePage />)
    await waitFor(() => screen.getByTestId('exchange-card-binance'))
    await act(async () => { fireEvent.click(screen.getByTestId('exchange-card-binance')) })
    expect(screen.getByTestId('exchange-detail-back')).toBeDefined()
  })

  it('clicking BACK in sub-view returns to grid', async () => {
    render(<MultiExchangePage />)
    await waitFor(() => screen.getByTestId('exchange-card-binance'))
    await act(async () => { fireEvent.click(screen.getByTestId('exchange-card-binance')) })
    await act(async () => { fireEvent.click(screen.getByTestId('exchange-detail-back')) })
    expect(screen.getByText(/MULTIEXCHANGE/i)).toBeDefined()
  })

  it('zeus:page-back custom event when in sub-view: preventDefault to stay on page', async () => {
    render(<MultiExchangePage />)
    await waitFor(() => screen.getByTestId('exchange-card-binance'))
    await act(async () => { fireEvent.click(screen.getByTestId('exchange-card-binance')) })
    const ev = new CustomEvent('zeus:page-back', { cancelable: true })
    await act(async () => { window.dispatchEvent(ev) })
    expect(ev.defaultPrevented).toBe(true)
    // Now back in grid
    expect(screen.getByText(/MULTIEXCHANGE/i)).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /root/zeus-terminal/client && npx vitest run src/components/multiexchange/__tests__/MultiExchangePage.test.tsx --reporter=verbose
```

Expected: FAIL — `Cannot find module '../MultiExchangePage'`.

- [ ] **Step 3: Create the page component**

Create `client/src/components/multiexchange/MultiExchangePage.tsx`:

```typescript
import { useEffect, useState } from 'react'
import { useMultiExchangeStore } from '../../stores/multiExchangeStore'
import { ExchangeCard } from './ExchangeCard'
import { ComingSoonCard } from './ComingSoonCard'
import { ExchangeDetail } from './ExchangeDetail'

const COMING_SOON = [
  { id: 'okx', label: 'OKX', phase: 'Phase 3 — Jun 2026' },
  { id: 'hyperliquid', label: 'HYPERLIQUID', phase: 'Phase 6 — Aug 2026' },
  { id: 'bitget', label: 'BITGET', phase: 'Phase 4 — Jun 2026' },
  { id: 'mexc', label: 'MEXC', phase: 'Phase 5 — Jul 2026' },
  { id: 'htx', label: 'HTX', phase: 'Phase 5 — Jul 2026' },
]

export function MultiExchangePage() {
  const accounts = useMultiExchangeStore((s) => s.accounts)
  const loadAccounts = useMultiExchangeStore((s) => s.loadAccounts)
  const error = useMultiExchangeStore((s) => s.error)

  const [view, setView] = useState<'grid' | string>('grid')

  useEffect(() => {
    loadAccounts().catch(() => {})
  }, [loadAccounts])

  // Sub-view navigation via zeus:page-back event (same pattern as OmegaPage)
  useEffect(() => {
    function onPageBack(e: Event) {
      if (view !== 'grid') {
        e.preventDefault()
        setView('grid')
      }
    }
    window.addEventListener('zeus:page-back', onPageBack)
    return () => window.removeEventListener('zeus:page-back', onPageBack)
  }, [view])

  const activeKeys = Object.keys(accounts).filter((k) => !!accounts[k])
  const activeExchange = activeKeys[0] || null
  const activeCount = activeKeys.length

  function getStatus(id: 'binance' | 'bybit'): 'active' | 'inactive' | 'blocked' {
    if (accounts[id]) return 'active'
    if (activeExchange && activeExchange !== id) return 'blocked'
    return 'inactive'
  }

  function getBlockedMsg(id: 'binance' | 'bybit'): string {
    const activeLabel = activeExchange === 'binance' ? 'Binance' : 'Bybit'
    const targetLabel = id === 'binance' ? 'Binance' : 'Bybit'
    return `BLOCKED — ${targetLabel} cannot be activated because ${activeLabel} is currently active. Zeus allows one active exchange per account. Disconnect ${activeLabel} first.`
  }

  // Sub-view: ExchangeDetail
  if (view !== 'grid') {
    return <ExchangeDetail exchangeId={view} onBack={() => setView('grid')} />
  }

  // Main grid view
  return (
    <div className="multi-exchange-page" style={{ padding: '16px', maxWidth: '900px', margin: '0 auto' }}>
      <div className="multi-exchange-page-header" style={{ marginBottom: '20px' }}>
        <h1 style={{
          fontFamily: 'Orbitron, sans-serif',
          fontWeight: 900,
          fontSize: '24px',
          letterSpacing: '4px',
          color: '#00d4ff',
          margin: 0,
          textShadow: '0 0 20px rgba(0, 212, 255, 0.4)',
        }}>
          ₿ MULTIEXCHANGE
        </h1>
        <div style={{
          fontFamily: 'Orbitron, sans-serif',
          fontSize: '11px',
          letterSpacing: '1px',
          color: '#94a3b8',
          marginTop: '4px',
        }}>
          {COMING_SOON.length + 2} venues · {activeCount} active
        </div>
      </div>

      {error && (
        <div style={{ background: '#3a0d0d', border: '1px solid #ff444466', borderRadius: '4px', padding: '10px', marginBottom: '14px', color: '#ff6655', fontSize: '11px' }}>
          Error loading accounts: {error}
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: '12px',
      }}>
        <ExchangeCard
          id="binance"
          label="BINANCE"
          status={getStatus('binance')}
          account={accounts.binance}
          blockedMessage={getStatus('binance') === 'blocked' ? getBlockedMsg('binance') : undefined}
          onClick={(id) => setView(id)}
        />
        <ExchangeCard
          id="bybit"
          label="BYBIT"
          status={getStatus('bybit')}
          account={accounts.bybit}
          blockedMessage={getStatus('bybit') === 'blocked' ? getBlockedMsg('bybit') : undefined}
          onClick={(id) => setView(id)}
        />
        {COMING_SOON.map((cs) => (
          <ComingSoonCard key={cs.id} label={cs.label} phase={cs.phase} />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /root/zeus-terminal/client && npx vitest run src/components/multiexchange/__tests__/MultiExchangePage.test.tsx --reporter=verbose
```

Expected: PASS 8/8.

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add client/src/components/multiexchange/MultiExchangePage.tsx client/src/components/multiexchange/__tests__/MultiExchangePage.test.tsx && git commit -m "feat(multiexchange): add MultiExchangePage with grid + sub-view router

- Header with ₿ MULTIEXCHANGE title + venue count + active count (server-truth)
- 7 pillars total: Binance + Bybit (real) + OKX/Hyperliquid/Bitget/MEXC/HTX (Coming Soon)
- Mutual exclusion derived from server-sourced accounts (no client-side decision)
- Sub-view navigation: click active/inactive card → ExchangeDetail, BACK or zeus:page-back returns
- Calls loadAccounts on mount via useEffect
- 8 RTL tests"
```

---

## Task 7: Wire MultiExchangePage into PanelShell routing

**Files:**
- Modify: `client/src/components/layout/PanelShell.tsx` (add import + panel block)
- Test: existing test suite verifies no regression

- [ ] **Step 1: Add import to PanelShell.tsx**

Modify `client/src/components/layout/PanelShell.tsx`. Find the line:

```typescript
import { OmegaPage } from '../omega/OmegaPage'
```

Add immediately after it:

```typescript
import { MultiExchangePage } from '../multiexchange/MultiExchangePage'
```

- [ ] **Step 2: Add MultiExchange panel block in zeus-groups**

Modify `client/src/components/layout/PanelShell.tsx`. Find the block:

```typescript
          <div data-panel-id="omega" className={dockActive === 'omega' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <OmegaPage />
          </div>
```

Add IMMEDIATELY AFTER it (before the `ares` block):

```typescript
          <div data-panel-id="multi-exchange" className={dockActive === 'multi-exchange' ? 'zpv-active-panel' : 'zpv-hidden-panel'}>
            <MultiExchangePage />
          </div>
```

- [ ] **Step 3: Run full client test suite**

```bash
cd /root/zeus-terminal/client && npx vitest run --reporter=verbose 2>&1 | tail -40
```

Expected: All existing tests still pass. New tests from Tasks 1-6 also pass.

- [ ] **Step 4: TypeScript compile check**

```bash
cd /root/zeus-terminal/client && npx tsc --noEmit 2>&1 | tail -20
```

Expected: No new TypeScript errors related to MultiExchange files.

- [ ] **Step 5: Build the client**

```bash
cd /root/zeus-terminal/client && npm run build 2>&1 | tail -15
```

Expected: Build succeeds, outputs to `../public/app/`. Verify the new icon SVG appears in the bundled JS:

```bash
grep -o "multi-exchange" /root/zeus-terminal/public/app/assets/*.js 2>/dev/null | head -3
```

Expected: at least 3 matches (icon registration, panel block, page logic).

- [ ] **Step 6: Commit**

```bash
cd /root/zeus-terminal && git add client/src/components/layout/PanelShell.tsx && git commit -m "feat(multiexchange): wire MultiExchangePage into PanelShell routing

- Import MultiExchangePage component
- Add data-panel-id='multi-exchange' panel block in #zeus-groups
- Follows OmegaPage pattern: rendered when dockActive === 'multi-exchange'
- Full test suite green, TypeScript clean, build succeeds"
```

---

## Task 8: Add CSS styling for MultiExchange namespace

**Files:**
- Modify: `client/src/app.css` (add `.multi-exchange-*` namespace at end)

- [ ] **Step 1: Add CSS block at end of app.css**

Append to `client/src/app.css` (after existing styles):

```css
/* ──────────────────────────────────────────────────────────────
 * MultiExchange page (2026-05-20)
 * Dark cyberpunk fintech aesthetic, mirrors .omega-page namespace
 * ────────────────────────────────────────────────────────────── */

.multi-exchange-page {
  min-height: 100vh;
  background: #0a0e1a;
  color: #f0f4f8;
}

.multi-exchange-page-header {
  border-bottom: 1px solid #1f2937;
  padding-bottom: 14px;
}

/* Card hover lift for clickable states */
.multi-exchange-card-active,
.multi-exchange-card-inactive {
  transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}

.multi-exchange-card-active:hover,
.multi-exchange-card-inactive:hover {
  transform: translateY(-2px);
  border-color: #00d4ff !important;
  box-shadow: 0 0 24px rgba(0, 212, 255, 0.18) !important;
}

/* Active status dot pulse animation */
.multi-exchange-card-active span:first-child::before {
  display: inline-block;
}

@keyframes multi-exchange-status-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.multi-exchange-card-active span[style*="00d97a"] {
  animation: multi-exchange-status-pulse 2s ease-in-out infinite;
}

/* Dock icon hover state for multi-exchange (matches omega/etc.) */
#zeus-dock .zd-item[data-id="multi-exchange"] .zd-icon svg {
  color: #f0c040;
  transition: color 0.2s ease, filter 0.2s ease;
}

#zeus-dock .zd-item[data-id="multi-exchange"]:hover .zd-icon svg {
  color: #f0c040;
  filter: drop-shadow(0 0 8px rgba(240, 192, 64, 0.6));
}

#zeus-dock .zd-item[data-id="multi-exchange"].active .zd-icon svg {
  color: #f0c040;
  filter: drop-shadow(0 0 12px rgba(240, 192, 64, 0.8));
}

/* Sub-view back button hover */
.multi-exchange-detail button[data-testid="exchange-detail-back"]:hover {
  color: #00ffff !important;
  text-shadow: 0 0 8px rgba(0, 212, 255, 0.5);
}

/* Page entry fade-up */
@keyframes multi-exchange-fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.multi-exchange-page,
.multi-exchange-detail {
  animation: multi-exchange-fade-up 0.2s ease-out;
}
```

- [ ] **Step 2: Rebuild client to apply CSS**

```bash
cd /root/zeus-terminal/client && npm run build 2>&1 | tail -10
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /root/zeus-terminal && git add client/src/app.css && git commit -m "style(multiexchange): add .multi-exchange-* namespace CSS

- Hover lift effect on active/inactive cards (+ glow shadow)
- Status dot pulse animation 2s (only on active state)
- Dock icon hover/active state with gold accent + drop-shadow
- Sub-view back button hover with cyan glow
- Page entry fade-up animation 200ms"
```

---

## Task 9: Strip Exchange tab from SettingsHubModal + add redirect notice

**Files:**
- Modify: `client/src/components/modals/SettingsHubModal.tsx`

- [ ] **Step 1: Remove exchange-related state and handlers (lines 42-110)**

Modify `client/src/components/modals/SettingsHubModal.tsx`. Delete these lines (currently lines 42-110):

```typescript
  type ExInfo = { connected: boolean; mode: 'live'|'testnet'; maskedKey: string; balance: number; lastVerified: string }
  const [exAccounts, setExAccounts] = useState<Record<string, ExInfo>>({})
  const [exModeFor, setExModeFor] = useState<Record<string, 'live'|'testnet'>>({ binance: 'testnet', bybit: 'testnet' })
  const [exLoadingFor, setExLoadingFor] = useState<Record<string, boolean>>({})
  const [exMsgFor, setExMsgFor] = useState<Record<string, {text: string; ok: boolean}>>({})
```

Also delete:
```typescript
  useEffect(() => {
    if (tab !== 'exchange') return
    api.raw<any>('GET', '/api/exchange/status')
      .then(d => { ... })
      .catch(() => {})
  }, [tab])

  function exSetMsg(ex: string, text: string, ok: boolean) { ... }

  async function exSave(ex: string) { ... }
  async function exVerify(ex: string) { ... }
  async function exDisconnect(ex: string) { ... }
```

(All lines 55-110 — the entire exchange logic block.)

- [ ] **Step 2: Replace exchange tab JSX (lines 397-493) with redirect notice**

In `client/src/components/modals/SettingsHubModal.tsx`, find the block starting `<div id="set-exchange" style={{display:tab==='exchange'?'block':'none', ...}}>` (line 397) and ending at its closing `</div>` (line 493 — careful: there's nested JSX). Replace the ENTIRE block with:

```typescript
      <div id="set-exchange" style={{display:tab==='exchange'?'block':'none', padding:'24px 16px', overflowY:'auto', flex:'1 1 auto'}}>
        <div style={{textAlign:'center', padding:'24px 16px', background:'#0a1018', border:'1px solid #00d4ff33', borderRadius:'6px'}}>
          <div style={{fontFamily:'Orbitron, sans-serif', fontWeight:900, fontSize:'18px', letterSpacing:'3px', color:'#00d4ff', marginBottom:'10px'}}>
            ₿ MULTIEXCHANGE
          </div>
          <div style={{fontSize:'11px', color:'#94a3b8', lineHeight:'1.6', marginBottom:'16px', fontFamily:'JetBrains Mono, monospace'}}>
            Exchange API settings moved to the dedicated MultiExchange page.
            <br />
            Open from the dock icon ₿ next to Ω.
          </div>
          <button
            className="hub-sbtn pri"
            style={{fontWeight:700, padding:'8px 16px'}}
            onClick={() => {
              onClose()
              // Trigger dock click on multi-exchange (legacy dispatch pattern)
              const ev = new CustomEvent('zeus:dock-activate', { detail: { id: 'multi-exchange' } })
              window.dispatchEvent(ev)
            }}
          >
            OPEN MULTIEXCHANGE →
          </button>
        </div>
      </div>
```

- [ ] **Step 3: Wire zeus:dock-activate event listener in PanelShell**

Modify `client/src/components/layout/PanelShell.tsx`. Find the `useEffect` that registers `zeus:page-back` handler (around line 138-148). Just AFTER that useEffect closes (`}, [])` or `[closeModal, openModal]`), add a new useEffect:

```typescript
  // [MultiExchange 2026-05-20] Allow external triggers (e.g. SettingsHubModal
  // redirect button) to programmatically open a dock panel by id.
  useEffect(() => {
    function onDockActivate(e: Event) {
      const ce = e as CustomEvent<{ id: string }>
      const id = ce.detail?.id
      if (!id) return
      setDockActive(id)
      try { sessionStorage.setItem('zeusDock', id) } catch {}
    }
    window.addEventListener('zeus:dock-activate', onDockActivate)
    return () => window.removeEventListener('zeus:dock-activate', onDockActivate)
  }, [])
```

- [ ] **Step 4: Run full client test suite**

```bash
cd /root/zeus-terminal/client && npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: All tests pass. If any SettingsHubModal tests existed that tested the exchange tab specifically, they may fail — update them to assert the redirect notice instead of the form.

- [ ] **Step 5: TypeScript compile check**

```bash
cd /root/zeus-terminal/client && npx tsc --noEmit 2>&1 | tail -10
```

Expected: No new errors. The `api` import may become unused — if so, remove it from the imports at the top of SettingsHubModal.tsx.

- [ ] **Step 6: Build the client**

```bash
cd /root/zeus-terminal/client && npm run build 2>&1 | tail -10
```

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
cd /root/zeus-terminal && git add client/src/components/modals/SettingsHubModal.tsx client/src/components/layout/PanelShell.tsx && git commit -m "refactor(multiexchange): strip Exchange tab from SettingsHubModal + add redirect

- Remove exAccounts/exModeFor/exLoadingFor/exMsgFor state + exSave/exVerify/exDisconnect handlers
- Replace exchange tab JSX with redirect notice pointing to MultiExchange page
- Add 'OPEN MULTIEXCHANGE →' button that closes modal + dispatches zeus:dock-activate
- PanelShell listens for zeus:dock-activate and sets dockActive imperatively
- All exchange functionality now lives in /multiexchange components"
```

---

## Task 10: Version bump + smoke test + final verification

**Files:**
- Modify: `server/version.js`

- [ ] **Step 1: Bump version**

Read current `server/version.js`. Identify current version and build numbers. Then modify to:

```javascript
// Update version field: 1.7.97 → 1.7.98 (or whatever next minor is)
// Bump build field by 1
// Add changelog entry at top of changelog array:
//   'v1.7.98 b{NEW_BUILD} — feat(multiexchange): UI shell with ₿ dock icon + dedicated page (Binance/Bybit active, OKX/Hyperliquid/Bitget/MEXC/HTX coming soon)',
// Update date to today (2026-05-20)
```

Exact format follows existing file structure. The engineer should `cat server/version.js` first to see exact current values.

- [ ] **Step 2: Run full server jest suite to verify nothing backend broke**

```bash
cd /root/zeus-terminal && npx jest --forceExit 2>&1 | tail -10
```

Expected: existing pass count unchanged (no new failures from UI work — backend untouched).

- [ ] **Step 3: Manual smoke test instructions**

After PM2 reload, perform these checks in the browser (operator validates):

```
1. Open Zeus → look at dock → confirm ₿ icon appears next to Ω
2. Hover ₿ → tooltip "MultiExchange" appears + gold drop-shadow glow
3. Click ₿ → page opens with header "₿ MULTIEXCHANGE" + grid of 7 pillars
4. Binance pillar shows current state (ACTIVE if creds exist, INACTIVE otherwise)
5. Bybit pillar shows state respecting mutual exclusion (BLOCKED if Binance active, else INACTIVE)
6. OKX/Hyperliquid/Bitget/MEXC/HTX show COMING SOON with diagonal stripe + amber border
7. Click on Binance pillar (if INACTIVE) → ExchangeDetail opens with API form
8. Enter test key + test secret + TESTNET toggle → click VERIFY & SAVE
9. Verify success message + balance display
10. Click BACK → return to grid, Binance now shows ACTIVE
11. Click on Binance again → see RE-VERIFY + DISCONNECT buttons + balance
12. Click DISCONNECT → confirm dialog → exchange returns to INACTIVE
13. Open Settings hub → Exchange tab → see redirect notice + button
14. Click "OPEN MULTIEXCHANGE →" → modal closes + ₿ page opens
15. PM2 logs: tail -f /root/zeus-terminal/data/logs/pm2-out.log → no errors related to /api/exchange/*
```

- [ ] **Step 4: PM2 reload** (operator-confirmed only)

```bash
pm2 reload zeus --update-env 2>&1 | tail -3
sleep 5
pm2 list | grep zeus
curl -s -o /dev/null -w "HTTP: %{http_code}\n" http://127.0.0.1:3000/health
```

Expected: zeus online, HTTP 200 on health.

- [ ] **Step 5: Commit version bump**

```bash
cd /root/zeus-terminal && git add server/version.js && git commit -m "chore(release): bump v1.7.98 b{N} — multiexchange UI shell SHIPPED

Shipped:
- ₿ dock icon next to Ω
- /multiexchange dedicated page with 7 pillars (2 active-capable + 5 coming-soon)
- ExchangeDetail sub-view for API credentials (mirrors old SettingsHub flow)
- useMultiExchangeStore Zustand store with Promise dedup + 60s TTL cache
- SettingsHubModal Exchange tab replaced with redirect notice
- All UI strings in English (per Zeus UI rule)
- Server-truth invariant preserved: zero fake data, all per req.user.id

Tests added: ~33 new (8 store + 5 card + 3 coming-soon + 5 detail + 8 page + 4 dock)
Backend untouched. Auto-deploy permitted per operator rule."
```

- [ ] **Step 6: Tag the release**

```bash
cd /root/zeus-terminal && git tag multiexchange-ui-shell-COMPLETE-$(date +%Y%m%d-%H%M%S)
git tag --list | tail -3
```

- [ ] **Step 7: Push to origin (operator-confirmed only)**

```bash
cd /root/zeus-terminal && git push origin omega/wave-1-foundation --tags 2>&1 | tail -5
```

Expected: push successful.

---

## Self-Review

After completing all tasks, verify:

**Spec coverage:**
- ✅ ₿ icon in dock (Task 1)
- ✅ MultiExchange page with grid (Task 6)
- ✅ Binance + Bybit pillars (Tasks 3, 6)
- ✅ Coming Soon pillars: OKX, Hyperliquid, Bitget, MEXC, HTX (Tasks 4, 6)
- ✅ Click active/inactive → API settings form (Task 5, 6)
- ✅ Server-truth + per-user (Task 2, baked everywhere)
- ✅ Mutual exclusion preserved (Task 6)
- ✅ Old SettingsHub exchange tab removed + redirect (Task 9)
- ✅ Colors: cyan/gold/purple accents, Orbitron + JetBrains Mono, dark cyberpunk (Task 8)
- ✅ Version bump (Task 10)

**Placeholder scan:** None — every step has exact code or exact commands.

**Type consistency:**
- `ExchangeAccount` interface used in: multiExchangeStore, ExchangeCard props (`account?`), ExchangeDetail (via store).
- `useMultiExchangeStore.saveAccount(exchange, apiKey, apiSecret, mode)` signature matches Task 2 store and Task 5 detail caller.
- `multi-exchange` (kebab-case) used as dock id consistently across dock.ts, PanelShell.tsx, MultiExchangePage tests.

---

## Rollback Plan (if anything breaks post-deploy)

Each task is a separate commit. To rollback:

```bash
# Identify the last good commit before MultiExchange work:
cd /root/zeus-terminal && git log --oneline | head -15

# Revert the last N commits (keep test files as record):
git revert <last-multiexchange-commit>..<earliest-multiexchange-commit>

# Or hard reset (operator-only, destroys local commits):
git reset --hard <commit-before-task-1>
pm2 reload zeus --update-env
```

The UI shell touches ZERO backend code, so rollback is purely client-side. PM2 reload after revert restores the old SettingsHub Exchange tab (file diff reverts the strip).

---

## Notes for Next Phases (NOT in this plan)

After this UI shell ships:

- **Phase 1: Bybit data feeds + execution complete** (~50-80h) — adds Bybit WS adapter for klines/trades/bookTicker, Bybit REST for markPrice/exchangeInfo, brain refactor exchange-aware.
- **Phase 2-5: OKX, Bitget, MEXC, HTX** — each ~30-50h reusing the pattern locked in Phase 1.
- **Phase 6: Hyperliquid** (~30-40h) — special architecture (wallet-based, on-chain).
- **Phase 7-8: burn-in + revisit Binance** — operator gate.

Each future phase will replace the corresponding "Coming Soon" pillar with a real ExchangeDetail flow + backend integration. The UI shell from this plan is the canvas.
