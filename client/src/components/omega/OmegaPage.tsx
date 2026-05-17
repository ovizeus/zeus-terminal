import { useState, useEffect, useCallback } from 'react'
import { TheOrb } from './TheOrb'
import { TheVoice } from './TheVoice'
import { TalkWithMe } from './TalkWithMe'
import { R5AStats } from './R5AStats'
import { DoctorPanel } from './DoctorPanel'
import { useAuthStore } from '../../stores/authStore'
import type { Utterance, Mood, HealthState } from './omegaApi'
import { fetchVoice, fetchMood, fetchHealth } from './omegaApi'

/**
 * OMEGA Page — dedicated dock view for the ML system.
 *
 * Three zones (top → bottom):
 *   1. THE ORB — alien-light Canvas reactive to mood
 *   2. THE VOICE — thought stream feed from ml_voice_log
 *   3. TALK WITH ME — chat panel
 *
 * Read-only Wave 1 scope: backend dormant, demo mood cycle, stub chat
 * responder. Wave 8 polish wires real intelligence end-to-end.
 *
 * Refresh cadence: mood polled every 2s (cheap, drives orb animation feel
 * of "alive"), voice + health polled every 5s. Aborts in-flight requests
 * on unmount.
 */
export function OmegaPage() {
    const [mood, setMood] = useState<Mood>('CALM')
    const [intensity, setIntensity] = useState(0.5)
    const [utterances, setUtterances] = useState<Utterance[]>([])
    const [voiceLoading, setVoiceLoading] = useState(true)
    const [health, setHealth] = useState<HealthState | null>(null)
    const [voiceOn, setVoiceOn] = useState(false)
    const [refreshTick, setRefreshTick] = useState(0)

    // Mood polling — fast cadence so orb feels alive
    useEffect(() => {
        let alive = true
        async function poll() {
            try {
                const m = await fetchMood()
                if (!alive) return
                setMood(m.mood)
                setIntensity(m.intensity)
            } catch (_) { /* silent — orb keeps last known mood */ }
        }
        poll()
        const id = setInterval(poll, 2000)
        return () => { alive = false; clearInterval(id) }
    }, [])

    // Voice + health polling — slower cadence
    useEffect(() => {
        let alive = true
        async function poll() {
            try {
                const [v, h] = await Promise.all([fetchVoice(80), fetchHealth()])
                if (!alive) return
                setUtterances(v)
                setHealth(h)
            } catch (_) { /* silent */ }
            finally { if (alive) setVoiceLoading(false) }
        }
        poll()
        const id = setInterval(poll, 5000)
        return () => { alive = false; clearInterval(id) }
    }, [refreshTick])

    const handleUtteranceLogged = useCallback(() => {
        // Chat reply was logged to ml_voice_log — trigger a refresh
        setRefreshTick(t => t + 1)
    }, [])

    return (
        <div className="omega-page" data-mood={mood}>
            <div className="omega-page-header">
                <h1 className="omega-page-title">
                    <span className="omega-title-glyph">Ω</span>
                    <span className="omega-title-name">OMEGA</span>
                    <span className="omega-title-tag">read-only · wave 1 foundation</span>
                </h1>
                <div className="omega-page-meta">
                    {health && (
                        <>
                            <span className="omega-meta-item">
                                <span className="omega-meta-label">R0</span>
                                <span className={`omega-meta-val omega-state-${health.R0.state.toLowerCase()}`}>{health.R0.state}</span>
                            </span>
                            <span className="omega-meta-item">
                                <span className="omega-meta-label">V·24h</span>
                                <span className="omega-meta-val">{health.utterances_24h}</span>
                            </span>
                            <span className="omega-meta-item">
                                <span className="omega-meta-label">D·24h</span>
                                <span className="omega-meta-val">{health.decisions_24h}</span>
                            </span>
                        </>
                    )}
                    <button
                        className={`omega-voice-toggle${voiceOn ? ' on' : ''}`}
                        onClick={() => setVoiceOn(v => !v)}
                        aria-label="toggle TTS voice"
                        title={voiceOn ? 'Voice ON — click to mute' : 'Voice OFF — click to enable TTS'}
                    >
                        {voiceOn ? '🔊 VOICE ON' : '🔇 VOICE OFF'}
                    </button>
                </div>
            </div>

            <R5AStats />

            <div className="omega-page-grid">
                <div className="omega-page-orb-zone">
                    <TheOrb mood={mood} intensity={intensity} />
                </div>
                <div className="omega-page-voice-zone">
                    <TheVoice utterances={utterances} loading={voiceLoading} />
                </div>
                <div className="omega-page-chat-zone">
                    <TalkWithMe voiceOn={voiceOn} onUtteranceLogged={handleUtteranceLogged} />
                </div>
            </div>

            <DoctorZone />
        </div>
    )
}

function DoctorZone() {
    const role = useAuthStore((s) => s.role)
    if (role !== 'admin') return null
    return (
        <div className="omega-page-doctor-zone">
            <DoctorPanel />
        </div>
    )
}
