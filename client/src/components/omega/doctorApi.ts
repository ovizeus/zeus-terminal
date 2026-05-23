/**
 * OMEGA Doctor UI client (D-4). Thin fetch wrappers around /api/omega/doctor/*.
 * All endpoints admin-only on server; frontend additionally hides UI for non-admin.
 */

export type CognitiveState = 'HEALTHY' | 'DEGRADED' | 'COMPROMISED' | 'SAFE_MODE' | 'DEAD'
export type Severity = 'P0' | 'P1' | 'P2' | 'P3' | 'P0-FLOOD'
export type Verdict = 'real_incident' | 'false_positive' | 'inconclusive' | 'partial'
export type RoleTag =
    | 'hot_path_critical'
    | 'hot_path_assist'
    | 'shadow_assist'
    | 'governance'
    | 'forensic'
    | 'introspection_meta'
    | 'philosophical'

export interface DoctorStateResponse {
    ok: boolean
    state: CognitiveState
    reason: string
    activeP0: number
    activeP1: number
    hotPathCriticalQuarantined: number
    hotPathAssistQuarantined: number
    quotaStatus: {
        p0_24h: number
        p1_1h: number
        p2_1h: number
        p0_flood_24h: number
    }
    lowTrustModules: Array<{ moduleId: string; trustScore: number; observationCount: number }>
    downweightedModules: Array<{ moduleId: string; fpRate: number }>
}

export interface DoctorEvent {
    event_id: string
    severity: Severity
    module_id: string
    event_type: string
    payload_json: string
    verdict: Verdict | null
    ts: number
}

export interface DoctorModule {
    moduleId: string
    roleTag: RoleTag
    criticality: 'low' | 'medium' | 'high' | 'critical'
    runtimeMode: 'live' | 'shadow' | 'offline'
    contract: {
        acceptedInputs: string[]
        emittedOutputs: string[]
        authorityScope: string
        maxRuntimeMs: number
        allowedDeps: string[]
        forbiddenDeps: string[]
        failurePolicy: string
    }
    registeredAt: number
}

const _baseHeaders: HeadersInit = { 'x-zeus-request': '1' }

async function _request<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
        credentials: 'include',
        headers: { ..._baseHeaders, ...(init?.headers ?? {}) },
        ...init,
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
        throw new Error(body?.error || `request failed: ${res.status}`)
    }
    return body as T
}

export function fetchDoctorState(): Promise<DoctorStateResponse> {
    return _request<DoctorStateResponse>('/api/omega/doctor/state')
}

export function fetchDoctorEvents(opts?: { since?: number; limit?: number }): Promise<{ ok: boolean; events: DoctorEvent[]; limit: number }> {
    const params = new URLSearchParams()
    if (opts?.since) params.set('since', String(opts.since))
    if (opts?.limit) params.set('limit', String(opts.limit))
    const q = params.toString()
    return _request(`/api/omega/doctor/events${q ? '?' + q : ''}`)
}

export function fetchDoctorModules(roleTag?: RoleTag): Promise<{ ok: boolean; modules: DoctorModule[] }> {
    const q = roleTag ? `?roleTag=${roleTag}` : ''
    return _request(`/api/omega/doctor/modules${q}`)
}

export function postDoctorVerdict(eventId: string, verdict: Verdict): Promise<{ ok: boolean; verdict: Verdict; eventId: string }> {
    return _request('/api/omega/doctor/verdict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, verdict }),
    })
}

export function fetchDoctorQuota(): Promise<{ ok: boolean; p0_24h: number; p1_1h: number; p2_1h: number; p0_flood_24h: number }> {
    return _request('/api/omega/doctor/quota')
}
