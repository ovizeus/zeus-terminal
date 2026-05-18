/**
 * OMEGA UI API Client (Wave 1 read-only)
 *
 * Thin fetch wrappers around `/api/omega/*` endpoints. All authenticated via
 * the existing JWT cookie set by sessionAuth middleware — no extra headers
 * needed. Returns typed shapes; errors surface as thrown Errors.
 */

export type Mood = 'CALM' | 'FOCUSED' | 'EXCITED' | 'NERVOUS' | 'ANGRY' | 'SAD' | 'BORED'

export type UtteranceType = 'THOUGHT' | 'CHAT_REPLY' | 'GREETING' | 'FAREWELL' | 'CRITICAL_ALERT' | 'REACTION'

export interface Utterance {
    id: number
    user_id: number
    utterance_type: UtteranceType
    mood: Mood
    text: string
    template_id: string | null
    context_json: string | null
    decision_digest: string | null
    created_at: number
}

export interface MoodState {
    ok: true
    mood: Mood
    intensity: number
    source: string
    next_change_ms: number
}

export interface HealthState {
    ok: true
    R0: { ring_id: string; state: string; last_heartbeat: number; last_updated_at: number }
    utterances_24h: number
    decisions_24h: number
    wave: string
}

async function _json<T>(resp: Response): Promise<T> {
    if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new Error(`OMEGA API ${resp.status}: ${text || resp.statusText}`)
    }
    return resp.json() as Promise<T>
}

export async function fetchVoice(limit = 50): Promise<Utterance[]> {
    const resp = await fetch(`/api/omega/voice?limit=${limit}`, { credentials: 'include' })
    const data = await _json<{ ok: true; utterances: Utterance[] }>(resp)
    return data.utterances
}

export async function fetchMood(): Promise<MoodState> {
    const resp = await fetch('/api/omega/mood', { credentials: 'include' })
    return _json<MoodState>(resp)
}

export async function fetchHealth(): Promise<HealthState> {
    const resp = await fetch('/api/omega/health', { credentials: 'include' })
    return _json<HealthState>(resp)
}

export interface R5aStats {
    ok: true
    env: string
    attribution: {
        total_count: number
        hit_rate: number
        avg_pnl_pct: number
        outcome_breakdown: Record<string, number>
    }
    calibration: {
        sample_count: number
        brier_score: number
        ece: number
        calibration_quality: number
    }
    drift: {
        sample_count: { reference: number; current: number }
        drift_score: number
        drift_level: 'STABLE' | 'MODERATE' | 'UNSTABLE'
        outcome_drift: { psi: number; ks_d: number; ks_p: number; level: string }
        score_drift: { psi: number; ks_d: number; ks_p: number; level: string }
    }
    wave: string
}

export async function fetchR5aStats(env = 'DEMO'): Promise<R5aStats> {
    const resp = await fetch(`/api/omega/r5a-stats?env=${env}`, { credentials: 'include' })
    return _json<R5aStats>(resp)
}

export async function sendChat(text: string): Promise<{ ok: true; reply: string; mood: Mood }> {
    const resp = await fetch('/api/omega/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
    })
    return _json<{ ok: true; reply: string; mood: Mood }>(resp)
}

// [Day 32D] Streaming chat — calls /api/omega/chat-stream and dispatches
// each SSE chunk through onChunk. Resolves with the final mood + model once
// the 'done' frame arrives. Falls back gracefully on parse errors.
export interface StreamChatResult { reply: string; mood: Mood; streamed: boolean; model: string | null }
export async function sendChatStream(
    text: string,
    onChunk: (partial: string) => void,
): Promise<StreamChatResult> {
    const resp = await fetch('/api/omega/chat-stream', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
    })
    if (!resp.ok || !resp.body) throw new Error(`chat-stream HTTP ${resp.status}`)
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let acc = ''
    let mood: Mood = 'CALM'
    let model: string | null = null
    let streamed = false
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nlIdx
        while ((nlIdx = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, nlIdx)
            buffer = buffer.slice(nlIdx + 2)
            for (const line of frame.split('\n')) {
                if (!line.startsWith('data:')) continue
                const payload = line.slice(5).trim()
                if (!payload) continue
                let parsed: any
                try { parsed = JSON.parse(payload) } catch (_) { continue }
                if (parsed && parsed.type === 'chunk' && typeof parsed.text === 'string') {
                    acc += parsed.text
                    try { onChunk(parsed.text) } catch (_) {}
                } else if (parsed && parsed.type === 'done') {
                    mood = (parsed.mood as Mood) || 'CALM'
                    model = parsed.model || null
                    streamed = !!parsed.streamed
                } else if (parsed && parsed.type === 'error') {
                    throw new Error(parsed.error || 'stream_error')
                }
            }
        }
    }
    return { reply: acc, mood, streamed, model }
}

/** Mood → hex color (cyan/purple/red palette, NO gold per Zeus ops rules). */
export const MOOD_COLOR: Record<Mood, string> = {
    CALM: '#00d4ff',       // cyan
    FOCUSED: '#b3f0ff',    // bright cyan-white
    EXCITED: '#ff00d4',    // electric magenta (alien pop, gold-free)
    NERVOUS: '#ff8800',    // orange
    ANGRY: '#ff1744',      // hard red
    SAD: '#6a4f8a',        // dim purple-grey
    BORED: '#5a6a7a'       // cold steel grey
}

/** Mood → unicode glyph marker for Voice feed. */
export const MOOD_GLYPH: Record<Mood, string> = {
    CALM: '◯',
    FOCUSED: '◉',
    EXCITED: '✦',
    NERVOUS: '⚠',
    ANGRY: '▲',
    SAD: '◐',
    BORED: '·'
}

/** Format epoch-ms timestamp as HH:MM:SS (local). */
export function fmtTime(ts: number): string {
    const d = new Date(ts)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
}
