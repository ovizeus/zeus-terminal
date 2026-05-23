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

export interface Ring5InfluenceStatusResponse {
    ok: boolean
    active: boolean
    versionId: number | null
    preRegId: number | null
    preRegState: string | null
}

export interface Ring5SeedResponse {
    ok: boolean
    status: 'seeded' | 'already_active'
    versionId: number
    preRegId: number
}

export async function fetchRing5InfluenceStatus(): Promise<Ring5InfluenceStatusResponse> {
    return _get<Ring5InfluenceStatusResponse>('/api/ring5/influence/status')
}

export async function postRing5InfluenceSeed(): Promise<Ring5SeedResponse> {
    const res = await fetch('/api/ring5/influence/seed', {
        method: 'POST',
        credentials: 'include'
    })
    if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`
        try {
            const body = await res.json()
            if (body && body.error) msg = body.error
        } catch { /* keep statusText */ }
        throw new Error(msg)
    }
    return res.json() as Promise<Ring5SeedResponse>
}

export interface Ring5AggregateBucket {
    symbol: string
    regime: string
    gate_status: Ring5GateStatus
    n: number
    avg_p2_conf: number
    avg_proposed_conf: number
}

export interface Ring5AggregateResponse {
    ok: boolean
    buckets: Ring5AggregateBucket[]
    totalRows: number
    since: number
}

export interface Ring5Cell {
    cellKey: string
    alpha: number
    beta: number
    observationCount: number
    updatedAt: number
}

export interface Ring5CellsResponse {
    ok: boolean
    cells: Ring5Cell[]
}

export interface Ring5TimeseriesBucket {
    ts: number
    n: number
    accepted: number
    rejected: number
    skipped: number
}

export interface Ring5TimeseriesResponse {
    ok: boolean
    bucketMs: number
    windowMs: number
    buckets: Ring5TimeseriesBucket[]
}

export async function fetchRing5Timeseries(): Promise<Ring5TimeseriesResponse> {
    return _get<Ring5TimeseriesResponse>('/api/ring5/audit/timeseries')
}

export async function fetchRing5Aggregate(
    params: { since?: number } = {}
): Promise<Ring5AggregateResponse> {
    const q = new URLSearchParams()
    if (params.since !== undefined) q.set('since', String(params.since))
    const qs = q.toString()
    return _get<Ring5AggregateResponse>(`/api/ring5/audit/aggregate${qs ? '?' + qs : ''}`)
}

export async function fetchRing5Cells(
    params: { limit?: number } = {}
): Promise<Ring5CellsResponse> {
    const q = new URLSearchParams()
    if (params.limit !== undefined) q.set('limit', String(params.limit))
    const qs = q.toString()
    return _get<Ring5CellsResponse>(`/api/ring5/cells${qs ? '?' + qs : ''}`)
}

// [Wave 9 Worktrack B] Bandit posterior eligibility tracker — decision-support
// view for operator T+48h seed go/no-go. Returns summary (total/eligible) +
// per-cell parsed (env/symbol/regime) + posterior_mean + eligibility flag.
export interface Ring5BanditCell {
    level: number
    cell_key: string
    env: string | null
    symbol: string | null
    regime: string | null
    alpha: number
    beta: number
    observation_count: number
    posterior_mean: number | null
    eligible: boolean
    updated_at: number
}
export interface Ring5BanditPosteriorResponse {
    ok: boolean
    ts: number
    summary: {
        total_cells: number
        eligible_cells: number
        threshold_obs: number
    }
    cells: Ring5BanditCell[]
}
export async function fetchRing5BanditPosterior(
    params: { limit?: number } = {}
): Promise<Ring5BanditPosteriorResponse> {
    const q = new URLSearchParams()
    if (params.limit !== undefined) q.set('limit', String(params.limit))
    const qs = q.toString()
    return _get<Ring5BanditPosteriorResponse>(`/api/omega/ring5/bandit/posterior${qs ? '?' + qs : ''}`)
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
