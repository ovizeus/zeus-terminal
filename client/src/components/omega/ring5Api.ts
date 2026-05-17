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
