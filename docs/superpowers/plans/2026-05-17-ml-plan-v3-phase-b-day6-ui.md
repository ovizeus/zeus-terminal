# ML Plan v3 — Phase B Day 6 (Ring5 UI Panel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task.

**Goal:** Build a standalone `Ring5Panel` React component (mirrors `DoctorPanel` pattern) consuming the Day 5 `/api/ring5/*` endpoints. Three sections: (1) audit table — recent 50 attempts with status color coding; (2) eligibility check — operator-input form (userId/env/symbol/regime) returning live eligibility result; (3) posteriors viewer — same input form returning L0..L4 + effective resolve. Mounted in `OmegaPage` next to `DoctorPanel`. Polling 5s for audit. Manual operator validation in dev browser. NO Jest tests for React component (no existing pattern); type-checks via tsc.

**Architecture:** `client/src/components/omega/ring5Api.ts` exports 3 typed fetch helpers + TS interfaces matching server response shapes. `Ring5Panel.tsx` uses `useState` + `useEffect` polling pattern identical to `DoctorPanel.tsx`. CSS extends `client/src/app.css` with `.omega-ring5-*` rule namespace. Three sections rendered conditionally; eligibility/posteriors sections have query-form on top (4 input fields + submit button) and result block below.

**Tech Stack:** React 18 + TypeScript + Vite. No new deps. Manual smoke test in dev browser at end.

**Branch:** `omega/wave-1-foundation` (continuation).

**Gate:** Phase B Day 5 SHIPPED 2026-05-17 (tag `ml-plan-v3-phase-b-day5-phase7-COMPLETE-20260517-223037`). 3 admin endpoints live + tested.

**Reference patterns:**
- `client/src/components/omega/DoctorPanel.tsx` — component shape + polling
- `client/src/components/omega/doctorApi.ts` — fetch helper + types
- `client/src/app.css:6254+` — `.omega-doctor-*` CSS rules to mirror

---

## File Structure

- **Create:** `client/src/components/omega/ring5Api.ts` — 3 fetch helpers + types
- **Create:** `client/src/components/omega/Ring5Panel.tsx` — main component
- **Modify:** `client/src/components/omega/OmegaPage.tsx` — mount Ring5Panel
- **Modify:** `client/src/app.css` — append `.omega-ring5-*` styles

---

## Task 6.1: ring5Api.ts client fetch helper

**Files:**
- Create: `client/src/components/omega/ring5Api.ts`

**Contract:**
- Three exports:
  - `fetchRing5Audit(params: {since?, limit?, status?}) → Promise<Ring5AuditResponse>`
  - `fetchRing5Eligibility(params: {userId, env, symbol, regime}) → Promise<Ring5EligibilityResponse>`
  - `fetchRing5Posteriors(params: {userId, env, symbol, regime}) → Promise<Ring5PosteriorsResponse>`
- Use `fetch` with credentials: 'include' (matches doctorApi pattern)
- Throw on `!res.ok` with parsed error message

- [ ] **Step 1: Create ring5Api.ts**

Create `client/src/components/omega/ring5Api.ts`:

```typescript
/**
 * Ring5 UI client (Day 6). Thin fetch wrappers around /api/ring5/*.
 * All endpoints admin-only on server; frontend additionally hides UI for non-admin.
 */

export type Ring5GateStatus = 'accepted' | 'rejected' | 'skipped'

export interface Ring5AuditRow {
    id: number
    user_id: number
    env: 'DEMO' | 'TESTNET' | 'REAL'
    symbol: string
    regime: string
    phase2_dir: string
    phase2_confidence: number
    phase2_score: number
    proposed_dir: string
    proposed_confidence: number
    proposed_score: number
    gate_status: Ring5GateStatus
    gate_reason: string
    rationale_json: string
    created_at: number
}

export interface Ring5AuditResponse {
    ok: boolean
    rows: Ring5AuditRow[]
    count: number
}

export interface Ring5EligibilityResult {
    eligible: boolean
    reason: string
    observationCount: number
    preRegStatus: string | null
    versionId: number | null
}

export interface Ring5EligibilityResponse {
    ok: boolean
    eligibility: Ring5EligibilityResult
}

export interface Ring5Posterior {
    id: number
    level: number
    cellKey: string
    alpha: number
    beta: number
    observationCount: number
    updatedAt: number
}

export interface Ring5PosteriorsResponse {
    ok: boolean
    posteriors: {
        L0: Ring5Posterior | null
        L1: Ring5Posterior | null
        L2: Ring5Posterior | null
        L3: Ring5Posterior | null
        L4: Ring5Posterior | null
    }
    effective: {
        level: number
        cellKey: string
        alpha: number
        beta: number
        observationCount: number
        cacheHit: boolean
    }
}

async function _get<T>(path: string): Promise<T> {
    const res = await fetch(path, { credentials: 'include' })
    if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`
        try {
            const body = await res.json()
            if (body && body.error) msg = body.error
        } catch { /* keep statusText */ }
        throw new Error(msg)
    }
    return res.json() as Promise<T>
}

export async function fetchRing5Audit(
    params: { since?: number; limit?: number; status?: Ring5GateStatus } = {}
): Promise<Ring5AuditResponse> {
    const q = new URLSearchParams()
    if (params.since !== undefined) q.set('since', String(params.since))
    if (params.limit !== undefined) q.set('limit', String(params.limit))
    if (params.status) q.set('status', params.status)
    const qs = q.toString()
    return _get<Ring5AuditResponse>(`/api/ring5/audit${qs ? '?' + qs : ''}`)
}

export async function fetchRing5Eligibility(
    params: { userId: number; env: string; symbol: string; regime: string }
): Promise<Ring5EligibilityResponse> {
    const q = new URLSearchParams({
        userId: String(params.userId),
        env: params.env,
        symbol: params.symbol,
        regime: params.regime,
    })
    return _get<Ring5EligibilityResponse>(`/api/ring5/eligibility?${q.toString()}`)
}

export async function fetchRing5Posteriors(
    params: { userId: number; env: string; symbol: string; regime: string }
): Promise<Ring5PosteriorsResponse> {
    const q = new URLSearchParams({
        userId: String(params.userId),
        env: params.env,
        symbol: params.symbol,
        regime: params.regime,
    })
    return _get<Ring5PosteriorsResponse>(`/api/ring5/posteriors?${q.toString()}`)
}
```

- [ ] **Step 2: TypeScript compile check**

Run: `cd /root/zeus-terminal/client && npx tsc --noEmit src/components/omega/ring5Api.ts 2>&1 | head -10`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /root/zeus-terminal && git add client/src/components/omega/ring5Api.ts && git commit -m "feat(ml-phase-b-day6): ring5Api.ts — typed fetch helpers for /api/ring5/*

Mirrors doctorApi.ts pattern:
  - fetchRing5Audit (since/limit/status filters)
  - fetchRing5Eligibility (4 required params)
  - fetchRing5Posteriors (4 required params)

TS interfaces match server response shapes from server/routes/ring5.js.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6.2: Ring5Panel.tsx component

**Files:**
- Create: `client/src/components/omega/Ring5Panel.tsx`

**Layout:**
- Header (title + admin-only tag)
- Section 1: Audit (auto-polling 5s, table of last 50 rows)
- Section 2: Eligibility (form + result)
- Section 3: Posteriors (form + result with all 5 levels + effective row)
- Error/loading states

- [ ] **Step 1: Create Ring5Panel.tsx**

Create `client/src/components/omega/Ring5Panel.tsx`:

```typescript
/**
 * Ring5 UI panel (Day 6) — admin-only observability for ML Plan v3 Phase B
 * influence pipeline. Three sections: audit trail (polled), live eligibility
 * check (form), live posteriors viewer (form).
 */

import { useCallback, useEffect, useState } from 'react'
import {
    fetchRing5Audit,
    fetchRing5Eligibility,
    fetchRing5Posteriors,
    type Ring5AuditRow,
    type Ring5EligibilityResult,
    type Ring5PosteriorsResponse,
} from './ring5Api'

const POLL_INTERVAL_MS = 5000
const AUDIT_LIMIT = 50

function fmtTs(ts: number): string {
    const d = new Date(ts)
    return d.toISOString().slice(11, 23)
}

function statusClass(status: string): string {
    switch (status) {
        case 'accepted': return 'omega-ring5-status-accepted'
        case 'rejected': return 'omega-ring5-status-rejected'
        case 'skipped': return 'omega-ring5-status-skipped'
        default: return ''
    }
}

interface QueryForm {
    userId: string
    env: string
    symbol: string
    regime: string
}

const DEFAULT_FORM: QueryForm = {
    userId: '1', env: 'DEMO', symbol: 'BTCUSDT', regime: 'trending'
}

export function Ring5Panel() {
    const [audit, setAudit] = useState<Ring5AuditRow[]>([])
    const [auditLoading, setAuditLoading] = useState(false)
    const [auditError, setAuditError] = useState<string | null>(null)

    const [eligForm, setEligForm] = useState<QueryForm>(DEFAULT_FORM)
    const [eligResult, setEligResult] = useState<Ring5EligibilityResult | null>(null)
    const [eligError, setEligError] = useState<string | null>(null)

    const [postForm, setPostForm] = useState<QueryForm>(DEFAULT_FORM)
    const [postResult, setPostResult] = useState<Ring5PosteriorsResponse | null>(null)
    const [postError, setPostError] = useState<string | null>(null)

    const reloadAudit = useCallback(async () => {
        setAuditLoading(true)
        setAuditError(null)
        try {
            const res = await fetchRing5Audit({ limit: AUDIT_LIMIT })
            setAudit(res.rows)
        } catch (err) {
            setAuditError(err instanceof Error ? err.message : String(err))
        } finally {
            setAuditLoading(false)
        }
    }, [])

    useEffect(() => {
        reloadAudit()
        const t = setInterval(reloadAudit, POLL_INTERVAL_MS)
        return () => clearInterval(t)
    }, [reloadAudit])

    async function handleCheckEligibility(e: React.FormEvent) {
        e.preventDefault()
        setEligError(null)
        try {
            const res = await fetchRing5Eligibility({
                userId: parseInt(eligForm.userId, 10),
                env: eligForm.env,
                symbol: eligForm.symbol,
                regime: eligForm.regime,
            })
            setEligResult(res.eligibility)
        } catch (err) {
            setEligError(err instanceof Error ? err.message : String(err))
            setEligResult(null)
        }
    }

    async function handleQueryPosteriors(e: React.FormEvent) {
        e.preventDefault()
        setPostError(null)
        try {
            const res = await fetchRing5Posteriors({
                userId: parseInt(postForm.userId, 10),
                env: postForm.env,
                symbol: postForm.symbol,
                regime: postForm.regime,
            })
            setPostResult(res)
        } catch (err) {
            setPostError(err instanceof Error ? err.message : String(err))
            setPostResult(null)
        }
    }

    return (
        <div className="omega-ring5-panel">
            <div className="omega-ring5-header">
                <span className="omega-ring5-title">RING5 INFLUENCE PIPELINE</span>
                <span className="omega-ring5-tag">Day 5 admin-only</span>
            </div>

            <section className="omega-ring5-section">
                <h3 className="omega-ring5-section-title">
                    Audit trail (last {AUDIT_LIMIT}, polled {POLL_INTERVAL_MS / 1000}s)
                </h3>
                {auditError && <div className="omega-ring5-error">{auditError}</div>}
                {auditLoading && audit.length === 0 && (
                    <div className="omega-ring5-loading">Loading…</div>
                )}
                {audit.length === 0 && !auditLoading && !auditError && (
                    <div className="omega-ring5-empty">No audit rows yet.</div>
                )}
                {audit.length > 0 && (
                    <table className="omega-ring5-audit-table">
                        <thead>
                            <tr>
                                <th>TS</th>
                                <th>User</th>
                                <th>Env</th>
                                <th>Symbol</th>
                                <th>Regime</th>
                                <th>P2 dir/conf</th>
                                <th>Proposed conf</th>
                                <th>Status</th>
                                <th>Reason</th>
                            </tr>
                        </thead>
                        <tbody>
                            {audit.map(r => (
                                <tr key={r.id}>
                                    <td>{fmtTs(r.created_at)}</td>
                                    <td>{r.user_id}</td>
                                    <td>{r.env}</td>
                                    <td>{r.symbol}</td>
                                    <td>{r.regime}</td>
                                    <td>{r.phase2_dir} / {r.phase2_confidence}</td>
                                    <td>{r.proposed_confidence}</td>
                                    <td className={statusClass(r.gate_status)}>{r.gate_status}</td>
                                    <td>{r.gate_reason}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>

            <section className="omega-ring5-section">
                <h3 className="omega-ring5-section-title">Eligibility check (live)</h3>
                <form className="omega-ring5-form" onSubmit={handleCheckEligibility}>
                    <input
                        placeholder="userId"
                        value={eligForm.userId}
                        onChange={e => setEligForm({ ...eligForm, userId: e.target.value })}
                    />
                    <input
                        placeholder="env"
                        value={eligForm.env}
                        onChange={e => setEligForm({ ...eligForm, env: e.target.value })}
                    />
                    <input
                        placeholder="symbol"
                        value={eligForm.symbol}
                        onChange={e => setEligForm({ ...eligForm, symbol: e.target.value })}
                    />
                    <input
                        placeholder="regime"
                        value={eligForm.regime}
                        onChange={e => setEligForm({ ...eligForm, regime: e.target.value })}
                    />
                    <button type="submit">Check</button>
                </form>
                {eligError && <div className="omega-ring5-error">{eligError}</div>}
                {eligResult && (
                    <div className="omega-ring5-result">
                        <div>
                            Eligible: <strong>{eligResult.eligible ? 'YES' : 'NO'}</strong>
                        </div>
                        <div>Reason: <code>{eligResult.reason}</code></div>
                        <div>Observations: <strong>{eligResult.observationCount}</strong></div>
                        <div>PreReg status: <code>{eligResult.preRegStatus ?? '—'}</code></div>
                        <div>Version ID: <code>{eligResult.versionId ?? '—'}</code></div>
                    </div>
                )}
            </section>

            <section className="omega-ring5-section">
                <h3 className="omega-ring5-section-title">Posteriors viewer (live)</h3>
                <form className="omega-ring5-form" onSubmit={handleQueryPosteriors}>
                    <input
                        placeholder="userId"
                        value={postForm.userId}
                        onChange={e => setPostForm({ ...postForm, userId: e.target.value })}
                    />
                    <input
                        placeholder="env"
                        value={postForm.env}
                        onChange={e => setPostForm({ ...postForm, env: e.target.value })}
                    />
                    <input
                        placeholder="symbol"
                        value={postForm.symbol}
                        onChange={e => setPostForm({ ...postForm, symbol: e.target.value })}
                    />
                    <input
                        placeholder="regime"
                        value={postForm.regime}
                        onChange={e => setPostForm({ ...postForm, regime: e.target.value })}
                    />
                    <button type="submit">Query</button>
                </form>
                {postError && <div className="omega-ring5-error">{postError}</div>}
                {postResult && (
                    <table className="omega-ring5-post-table">
                        <thead>
                            <tr>
                                <th>Level</th>
                                <th>Cell key</th>
                                <th>α</th>
                                <th>β</th>
                                <th>Observations</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(['L0', 'L1', 'L2', 'L3', 'L4'] as const).map(k => {
                                const p = postResult.posteriors[k]
                                return (
                                    <tr key={k}>
                                        <td>{k}</td>
                                        <td>{p ? p.cellKey : '—'}</td>
                                        <td>{p ? p.alpha : '—'}</td>
                                        <td>{p ? p.beta : '—'}</td>
                                        <td>{p ? p.observationCount : '—'}</td>
                                    </tr>
                                )
                            })}
                            <tr className="omega-ring5-post-effective">
                                <td>effective</td>
                                <td>{postResult.effective.cellKey}</td>
                                <td>{postResult.effective.alpha}</td>
                                <td>{postResult.effective.beta}</td>
                                <td>{postResult.effective.observationCount}</td>
                            </tr>
                        </tbody>
                    </table>
                )}
            </section>
        </div>
    )
}
```

- [ ] **Step 2: TypeScript compile check**

Run: `cd /root/zeus-terminal/client && npx tsc --noEmit src/components/omega/Ring5Panel.tsx 2>&1 | head -20`
Expected: no errors. If errors like JSX-related: switch to `npx tsc --noEmit` (full tsc) and check only Ring5Panel + ring5Api errors.

- [ ] **Step 3: Commit**

```bash
cd /root/zeus-terminal && git add client/src/components/omega/Ring5Panel.tsx && git commit -m "feat(ml-phase-b-day6): Ring5Panel.tsx — observability UI for influence pipeline

Three sections:
  - Audit trail (last 50, polled 5s) with status color coding
  - Eligibility check (form: userId/env/symbol/regime -> result)
  - Posteriors viewer (form -> L0..L4 + effective resolve table)

Mirrors DoctorPanel pattern (useState + useEffect + interval).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6.3: CSS + OmegaPage mount

**Files:**
- Modify: `client/src/app.css` — append `.omega-ring5-*` rules
- Modify: `client/src/components/omega/OmegaPage.tsx` — import + mount

- [ ] **Step 1: Find current CSS anchor**

Run: `grep -n "^/\* Doctor\|omega-doctor-panel" /root/zeus-terminal/client/src/app.css | head -3`
Expected: line near 6254 where Doctor styles start.

- [ ] **Step 2: Append Ring5 styles at end of app.css**

Add at end of `client/src/app.css`:

```css
/* ── Ring5 panel (Day 6 Phase B observability) ───────────────────── */
.omega-ring5-panel { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; padding: 12px; border: 1px solid rgba(255,255,255,0.08); border-radius: 4px; background: rgba(0,0,0,0.2); }
.omega-ring5-header { display: flex; align-items: center; gap: 8px; }
.omega-ring5-title { font-weight: 700; letter-spacing: 0.5px; }
.omega-ring5-tag { font-size: 11px; opacity: 0.6; padding: 2px 6px; border-radius: 3px; background: rgba(255,255,255,0.08); }
.omega-ring5-section { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.08); }
.omega-ring5-section-title { font-size: 12px; margin: 0; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.5px; }
.omega-ring5-loading, .omega-ring5-empty, .omega-ring5-error { font-size: 12px; padding: 6px; opacity: 0.7; }
.omega-ring5-error { color: #ff6b6b; opacity: 1; }
.omega-ring5-form { display: flex; gap: 6px; flex-wrap: wrap; font-size: 12px; }
.omega-ring5-form input { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.15); color: inherit; padding: 3px 6px; min-width: 90px; }
.omega-ring5-form button { background: #00d4ff; color: #000; border: 0; padding: 3px 12px; cursor: pointer; }
.omega-ring5-form button:hover { background: #00b8e0; }
.omega-ring5-result { font-size: 12px; line-height: 1.6; padding-top: 4px; }
.omega-ring5-result code { background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 2px; }
.omega-ring5-audit-table, .omega-ring5-post-table { width: 100%; font-size: 11px; border-collapse: collapse; }
.omega-ring5-audit-table th, .omega-ring5-audit-table td,
.omega-ring5-post-table th, .omega-ring5-post-table td { padding: 4px 6px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.06); }
.omega-ring5-audit-table th, .omega-ring5-post-table th { opacity: 0.7; font-weight: 600; }
.omega-ring5-status-accepted { color: #4caf50; font-weight: 600; }
.omega-ring5-status-rejected { color: #ff6b6b; font-weight: 600; }
.omega-ring5-status-skipped { color: #ffa726; font-weight: 600; }
.omega-ring5-post-effective { background: rgba(0,212,255,0.08); font-weight: 600; }
```

- [ ] **Step 3: Mount Ring5Panel in OmegaPage**

Edit `client/src/components/omega/OmegaPage.tsx`:

(a) Add import near top:
```typescript
import { Ring5Panel } from './Ring5Panel'
```

(b) Find the line where `<DoctorPanel />` is rendered and add `<Ring5Panel />` right after it.

- [ ] **Step 4: TypeScript compile check (full)**

Run: `cd /root/zeus-terminal/client && npx tsc --noEmit 2>&1 | tail -20`
Expected: no errors (or only pre-existing errors unrelated to Ring5).

- [ ] **Step 5: Commit**

```bash
cd /root/zeus-terminal && git add client/src/app.css client/src/components/omega/OmegaPage.tsx && git commit -m "feat(ml-phase-b-day6): mount Ring5Panel + add CSS in app.css

Ring5Panel mounted in OmegaPage next to DoctorPanel.
CSS namespace .omega-ring5-* mirrors .omega-doctor-* conventions.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6.4: Day 6 closeout

- [ ] **Step 1: Full regression (server tests still must pass)**

Run: `cd /root/zeus-terminal && npx jest --maxWorkers=2 2>&1 | tail -8`
Expected: tests unchanged vs Day 5 (6768/6771). UI work doesn't add Jest tests; client tests run separately.

- [ ] **Step 2: Client TS check (full)**

Run: `cd /root/zeus-terminal/client && npx tsc --noEmit 2>&1 | tail -20`
Expected: no new errors related to Ring5*.

- [ ] **Step 3: Tag**

```bash
cd /root/zeus-terminal && TAG="ml-plan-v3-phase-b-day6-ui-COMPLETE-$(date -u +%Y%m%d-%H%M%S)" && git tag -a "$TAG" -m "ML Plan v3 Phase B Day 6 — Ring5 UI Panel COMPLETE

Day 6 deliverables:
- client/src/components/omega/ring5Api.ts (typed fetch helpers)
- client/src/components/omega/Ring5Panel.tsx (3 sections: audit + eligibility + posteriors)
- client/src/app.css extended with .omega-ring5-* namespace
- OmegaPage mounts Ring5Panel next to DoctorPanel

Manual operator validation in dev browser required. No automated React tests (no existing pattern). TS compile clean."
```

- [ ] **Step 4: Push**

```bash
cd /root/zeus-terminal && git push origin HEAD --tags
```

- [ ] **Step 5: Memory update**

Append Day 6 SHIPPED note to ML Plan v3 ACTIVE RESUMED memory entry.

- [ ] **Step 6: Dev browser smoke test (operator-driven)**

```bash
cd /root/zeus-terminal/client && npm run dev
# Open browser → /omega (or wherever OmegaPage is mounted)
# Expect: Ring5 panel visible below Doctor panel
# Expect: Audit table shows "No audit rows yet" (clean DB) OR existing data
# Test eligibility form: userId=1 env=DEMO symbol=BTCUSDT regime=trending → "Eligible: NO, reason: insufficient_observations"
# Test posteriors form: same params → table with all 5 levels showing "—" + effective row showing L0 default
```

---

## Self-Review

**1. Spec coverage:**
- 3 UI sections ✅ (audit + eligibility + posteriors)
- Polling 5s ✅
- Admin-only enforced server-side (UI shows error on 403) ✅
- TypeScript types matching server response shapes ✅

**2. Placeholder scan:** None.

**3. Type consistency:**
- `Ring5GateStatus` enum matches server CHECK constraint
- `Ring5Posterior` shape matches `_hydrate` output in banditPosteriors.js
- `Ring5EligibilityResult` matches `checkEligibility` return shape
- Form state types consistent across both eligibility + posteriors forms

---

## Execution Handoff

Plan saved. Inline executing-plans.
