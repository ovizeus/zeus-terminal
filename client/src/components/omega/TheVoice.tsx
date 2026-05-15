import { useEffect, useRef } from 'react'
import type { Utterance } from './omegaApi'
import { MOOD_COLOR, MOOD_GLYPH, fmtTime } from './omegaApi'

/**
 * The Voice — OMEGA thought stream feed.
 *
 * Renders ml_voice_log utterances in reverse-chronological order, mood-
 * colored, with custom glyph + timestamp. Empty state: "awaiting omega
 * learning..." until Wave 2+ starts generating thoughts.
 *
 * Auto-scrolls to top when new utterances arrive (most recent first).
 * Read-only; parent owns data fetching + refresh cadence.
 */
interface Props {
    utterances: Utterance[]
    loading: boolean
}

export function TheVoice({ utterances, loading }: Props) {
    const listRef = useRef<HTMLDivElement | null>(null)
    const lastTopIdRef = useRef<number | null>(null)

    useEffect(() => {
        if (utterances.length === 0) return
        const topId = utterances[0].id
        if (lastTopIdRef.current !== null && topId !== lastTopIdRef.current && listRef.current) {
            listRef.current.scrollTop = 0
        }
        lastTopIdRef.current = topId
    }, [utterances])

    return (
        <section className="omega-voice">
            <div className="omega-voice-header">
                <span className="omega-voice-title">► THE VOICE ◄</span>
                <span className="omega-voice-count">
                    {loading ? '...' : `${utterances.length} thought${utterances.length === 1 ? '' : 's'}`}
                </span>
            </div>
            <div className="omega-voice-feed" ref={listRef}>
                {utterances.length === 0 ? (
                    <div className="omega-voice-empty">
                        <div className="omega-voice-empty-glyph">⟡</div>
                        <div className="omega-voice-empty-text">
                            {loading ? 'connecting to OMEGA...' : 'awaiting omega learning — Wave 2 will wake the bandit and i\'ll start thinking out loud here.'}
                        </div>
                    </div>
                ) : (
                    utterances.map(u => (
                        <div key={u.id} className={`omega-utter omega-utter-${u.utterance_type.toLowerCase()}`} style={{ borderLeftColor: MOOD_COLOR[u.mood] }}>
                            <div className="omega-utter-head">
                                <span className="omega-utter-glyph" style={{ color: MOOD_COLOR[u.mood] }}>{MOOD_GLYPH[u.mood]}</span>
                                <span className="omega-utter-time">{fmtTime(u.created_at)}</span>
                                <span className="omega-utter-type">{u.utterance_type}</span>
                            </div>
                            <div className="omega-utter-text" style={{ color: u.utterance_type === 'CRITICAL_ALERT' ? MOOD_COLOR[u.mood] : undefined }}>
                                {u.text}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </section>
    )
}
