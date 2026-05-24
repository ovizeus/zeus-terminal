import { useCallback, useEffect, useRef, useState } from 'react'
import { TheOrb } from './TheOrb'
import { TheVoice } from './TheVoice'
import { TalkWithMe } from './TalkWithMe'
import { ReportCard } from './ReportCard'
import { R5AStats } from './R5AStats'
import { DoctorPanel } from './DoctorPanel'
import { Ring5Panel } from './Ring5Panel'
import { useATStore, useUiStore } from '../../stores'
import { useAuthStore } from '../../stores/authStore'
import type { Utterance, Mood, HealthState } from './omegaApi'
import { fetchVoice, fetchMood, fetchHealth } from './omegaApi'
import * as omegaTts from '../../audio/omegaTts'
import * as omegaAmbient from '../../audio/omegaAmbient'

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
type OmegaView = 'main' | 'doctor' | 'ring5' | 'report'

export function OmegaPage() {
    const [view, setView] = useState<OmegaView>('main')
    const [mood, setMood] = useState<Mood>('CALM')
    const [intensity, setIntensity] = useState(0.5)
    const [utterances, setUtterances] = useState<Utterance[]>([])
    const [voiceLoading, setVoiceLoading] = useState(true)
    const [health, setHealth] = useState<HealthState | null>(null)
    const [voiceOn, setVoiceOn] = useState(false)
    const [ttsSpeed, setTtsSpeed] = useState(omegaTts.getSpeed())
    const [ttsVol, setTtsVol] = useState(omegaTts.getVolume())
    const prevUtterancesRef = useRef<number>(0)
    const [refreshTick, setRefreshTick] = useState(0)
    const role = useAuthStore((s) => s.role)
    const isAdmin = role === 'admin'
    const engineMode = useATStore((s) => s.mode) || 'demo'
    const executionEnv = useUiStore((s) => s.executionEnv)
    // Resolve label: DEMO if engineMode demo OR env DEMO; TESTNET/REAL from env; LOCKED if no creds
    const modeLabel = (engineMode === 'demo' || executionEnv === 'DEMO') ? 'DEMO'
        : executionEnv === 'TESTNET' ? 'TESTNET'
        : executionEnv === 'REAL' ? 'REAL'
        : 'LOCKED'
    const modeColorClass = modeLabel === 'DEMO' ? 'omega-mode-demo'
        : modeLabel === 'TESTNET' ? 'omega-mode-testnet'
        : modeLabel === 'REAL' ? 'omega-mode-real'
        : 'omega-mode-locked'

    // [Voice TTS] Ambient start/stop on voiceOn toggle
    useEffect(() => {
        if (voiceOn) { omegaAmbient.startAmbient() } else { omegaAmbient.stopAmbient(); omegaTts.stop() }
        return () => { omegaAmbient.stopAmbient() }
    }, [voiceOn])

    // [Voice TTS] Auto-read new thoughts from TheVoice stream
    useEffect(() => {
        if (!voiceOn || utterances.length === 0) return
        const newCount = utterances.length
        if (prevUtterancesRef.current > 0 && newCount > prevUtterancesRef.current) {
            const newest = utterances[0]
            if (newest && newest.text && (Date.now() - (newest.created_at || 0)) < 30000) {
                const priority = ['ALERT', 'CAUTIOUS', 'NERVOUS'].includes(newest.mood)
                omegaTts.speak(newest.text, priority)
                omegaAmbient.pulseDecision()
            }
        }
        prevUtterancesRef.current = newCount
    }, [utterances, voiceOn])

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

    // Intercept PageView "Back" when in dedicated sub-view (Ring5/Doctor).
    // Back returns to OMEGA main instead of closing the OMEGA panel entirely.
    useEffect(() => {
        function onPageBack(e: Event) {
            if (view !== 'main') {
                e.preventDefault()
                setView('main')
            }
        }
        window.addEventListener('zeus:page-back', onPageBack)
        return () => window.removeEventListener('zeus:page-back', onPageBack)
    }, [view])

    const handleUtteranceLogged = useCallback(() => {
        // Chat reply was logged to ml_voice_log — trigger a refresh
        setRefreshTick(t => t + 1)
    }, [])

    if (view === 'doctor' && isAdmin) {
        return (
            <div className="omega-page omega-page-dedicated" data-mood={mood}>
                <div className="omega-page-header">
                    <h1 className="omega-page-title">
                        <span className="omega-title-name">OMEGA DOCTOR</span>
                        <span className="omega-title-tag">D-4 admin-only</span>
                    </h1>
                </div>
                <div className="omega-page-dedicated-body">
                    <DoctorPanel />
                </div>
            </div>
        )
    }

    if (view === 'ring5' && isAdmin) {
        return (
            <div className="omega-page omega-page-dedicated" data-mood={mood}>
                <div className="omega-page-header">
                    <h1 className="omega-page-title">
                        <span className="omega-title-name">RING5</span>
                        <span className="omega-title-tag">Phase B · admin-only</span>
                    </h1>
                </div>
                <div className="omega-page-dedicated-body">
                    <Ring5Panel forceExpanded />
                </div>
            </div>
        )
    }

    if (view === 'report') {
        return (
            <div className="omega-page omega-page-dedicated" data-mood={mood}>
                <div className="omega-page-header">
                    <h1 className="omega-page-title">
                        <span className="omega-title-name">REPORT</span>
                        <span className="omega-title-tag">Wave 8 P · operator dashboard</span>
                    </h1>
                </div>
                <div className="omega-page-dedicated-body">
                    <ReportCard />
                </div>
            </div>
        )
    }

    return (
        <div className="omega-page" data-mood={mood}>
            <div className="omega-page-header">
                <h1 className="omega-page-title">
                    <span className="omega-title-glyph">Ω</span>
                    <span className="omega-title-name">OMEGA</span>
                    <span className={`omega-mode-badge ${modeColorClass}`} title={`execution env: ${modeLabel}`}>
                        {modeLabel}
                    </span>
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
                        type="button"
                        className="omega-nav-button"
                        onClick={() => setView('report')}
                        title="Open performance report card (Wave 8 P)"
                    >
                        REPORT
                    </button>
                    {isAdmin && (
                        <>
                            <button
                                type="button"
                                className="omega-nav-button"
                                onClick={() => setView('ring5')}
                                title="Open Ring5 influence pipeline observability"
                            >
                                RING5
                            </button>
                            <button
                                type="button"
                                className="omega-nav-button"
                                onClick={() => setView('doctor')}
                                title="Open Doctor cognitive diagnostics"
                            >
                                DOCTOR
                            </button>
                        </>
                    )}
                    <button
                        className={`omega-voice-toggle${voiceOn ? ' on' : ''}`}
                        onClick={() => setVoiceOn(v => !v)}
                        aria-label="toggle TTS voice"
                        title={voiceOn ? 'Voice ON — click to mute' : 'Voice OFF — click to enable TTS'}
                    >
                        {voiceOn ? '🔊 ON' : '🔇 OFF'}
                    </button>
                    {voiceOn && (
                        <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', fontSize: '9px', color: '#889' }}>
                            <label title="Speed">⚡<input type="range" min="0.5" max="2" step="0.1" value={ttsSpeed}
                                onChange={e => { const v = parseFloat(e.target.value); setTtsSpeed(v); omegaTts.setSpeed(v) }}
                                style={{ width: '40px', verticalAlign: 'middle' }} />{ttsSpeed.toFixed(1)}x</label>
                            <label title="Volume">🔈<input type="range" min="0" max="1" step="0.05" value={ttsVol}
                                onChange={e => { const v = parseFloat(e.target.value); setTtsVol(v); omegaTts.setVolume(v); omegaAmbient.setAmbientVolume(v) }}
                                style={{ width: '40px', verticalAlign: 'middle' }} />{Math.round(ttsVol * 100)}%</label>
                        </span>
                    )}
                </div>
            </div>

            <R5AStats />

            {/* [Day 29] Layout: 2-row grid (orb + voice) — chat moved to
                sticky bottom container below for WhatsApp-style UX. */}
            <div className="omega-page-grid omega-page-grid-no-chat">
                <div className="omega-page-orb-zone">
                    <TheOrb mood={mood} intensity={intensity} />
                </div>
                <div className="omega-page-voice-zone">
                    <TheVoice utterances={utterances} loading={voiceLoading} />
                </div>
            </div>

            {/* [Day 29] Chat sticky bottom — WhatsApp style.
                Default: header + input row. Tap input → expand. ESC → collapse. */}
            <div className="omega-page-chat-sticky">
                <TalkWithMe voiceOn={voiceOn} onUtteranceLogged={handleUtteranceLogged} />
            </div>
        </div>
    )
}

