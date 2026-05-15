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

export async function sendChat(text: string): Promise<{ ok: true; reply: string; mood: Mood }> {
    const resp = await fetch('/api/omega/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
    })
    return _json<{ ok: true; reply: string; mood: Mood }>(resp)
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
