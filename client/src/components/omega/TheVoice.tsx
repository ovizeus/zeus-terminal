import { useEffect, useRef, useState } from 'react'
import { firstClippedIndex, type Measured } from './voiceClip'
import type { Utterance } from './omegaApi'
import { MOOD_COLOR, MOOD_GLYPH, fmtTime, fetchVoice } from './omegaApi'

/**
 * The Voice — OMEGA thought stream feed.
 *
 * Renders ml_voice_log utterances in reverse-chronological order, mood-
 * colored, with custom glyph + timestamp.
 *
 * [Wave 8 H] History/replay slider — operator can scroll back N hours
 * to see brain state at past time. 0h = live. >0h = static historical
 * window. When in history mode, parent's live feed is replaced by
 * locally-fetched snapshot.
 *
 * [Wave 8 C] Confidence + regime chips inline per utterance.
 */
interface Props {
    utterances: Utterance[]
    loading: boolean
}

const HISTORY_OPTIONS = [
    { label: 'LIVE', hours: 0 },
    { label: '1h', hours: 1 },
    { label: '6h', hours: 6 },
    { label: '24h', hours: 24 },
    { label: '7d', hours: 24 * 7 },
]

export function TheVoice({ utterances, loading }: Props) {
    const listRef = useRef<HTMLDivElement | null>(null)
    const lastTopIdRef = useRef<number | null>(null)
    const [historyHours, setHistoryHours] = useState(0)
    const [historyData, setHistoryData] = useState<Utterance[] | null>(null)
    const [historyLoading, setHistoryLoading] = useState(false)

    useEffect(() => {
        if (historyHours === 0) {
            setHistoryData(null)
            return
        }
        setHistoryLoading(true)
        const now = Date.now()
        const sinceTs = now - historyHours * 3600 * 1000
        fetchVoice(200, { sinceTs, untilTs: now })
            .then(setHistoryData)
            .catch(() => setHistoryData([]))
            .finally(() => setHistoryLoading(false))
    }, [historyHours])

    const displayed = historyData != null ? historyData : utterances
    const isLoadingShown = historyData != null ? historyLoading : loading

    // [2026-11-01] Taie gandul care nu incape INTREG, in loc sa-l lase o felie.
    // Se face dupa asezare, fiindca inaltimea unui gand depinde de cate randuri
    // de text are, iar inaltimea zonei vine din grila paginii — nu se potrivesc
    // niciodata exact. Doar cand lista e la inceput: daca operatorul a derulat,
    // vrea sa citeasca, deci se arata tot si nimic nu dispare sub degetul lui.
    const [clipFrom, setClipFrom] = useState(-1)
    const rowsRef = useRef<Array<HTMLDivElement | null>>([])

    useEffect(() => {
        const box = listRef.current
        if (!box) return
        let raf = 0
        const measure = () => {
            const el = listRef.current
            if (!el) return
            if (el.scrollTop > 1) { setClipFrom(-1); return }   // deruleaza → arata tot
            const items: Measured[] = rowsRef.current
                .slice(0, displayed.length)
                .filter(Boolean)
                .map((r) => ({ top: (r as HTMLDivElement).offsetTop, height: (r as HTMLDivElement).offsetHeight }))
            setClipFrom(firstClippedIndex(items, el.clientHeight))
        }
        const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure) }
        schedule()
        const onScroll = () => schedule()
        box.addEventListener('scroll', onScroll, { passive: true })
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
        if (ro) ro.observe(box)
        return () => {
            cancelAnimationFrame(raf)
            box.removeEventListener('scroll', onScroll)
            if (ro) ro.disconnect()
        }
    }, [displayed])

    useEffect(() => {
        if (displayed.length === 0) return
        const topId = displayed[0].id
        if (lastTopIdRef.current !== null && topId !== lastTopIdRef.current && listRef.current) {
            listRef.current.scrollTop = 0
        }
        lastTopIdRef.current = topId
    }, [displayed])

    return (
        <section className="omega-voice">
            {/* [2026-11-01] Titlul si butoanele de interval stau pe UN SINGUR rand.
                Pe telefonul operatorului erau doua randuri care mancau ~80px din
                cei ~278px ai zonei, si ramanea loc pentru UN singur gand intreg,
                al doilea aparand ca o fantoma: doar ora, stinsa, fara text.
                Cei ~44px recuperati aici sunt exact cat trebuie pentru al doilea
                gand. Numarul de ganduri se ascunde sub 460px, unde nu incape. */}
            <div className="omega-voice-header omega-voice-header-compact">
                <span className="omega-voice-title">THE VOICE</span>
                <div className="omega-voice-history-bar">
                    {HISTORY_OPTIONS.map(opt => (
                        <button
                            key={opt.hours}
                            className={`omega-voice-history-btn${historyHours === opt.hours ? ' active' : ''}`}
                            onClick={() => setHistoryHours(opt.hours)}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
                <span className="omega-voice-count">
                    {isLoadingShown ? '...' : `${displayed.length} thought${displayed.length === 1 ? '' : 's'}`}
                </span>
            </div>
            <div className="omega-voice-feed" ref={listRef}>
                {displayed.length === 0 ? (
                    <div className="omega-voice-empty">
                        <div className="omega-voice-empty-glyph">⟡</div>
                        <div className="omega-voice-empty-text">
                            {isLoadingShown
                                ? 'connecting to OMEGA…'
                                : historyHours > 0
                                    ? `no thoughts in last ${historyHours}h.`
                                    : 'brain quiet right now — no recent thoughts. waiting for confidence ≥ 30 or regime shift to start narrating.'}
                        </div>
                    </div>
                ) : (
                    displayed.map((u, idx) => {
                        // [Wave 8 C] Confidence display per utterance. Parses contextJson
                        // for {confidence, score, regime} hints when brain thoughts surface.
                        let ctx: any = null
                        try { ctx = u.context_json ? JSON.parse(u.context_json) : null } catch (_) { ctx = null }
                        const confNum = ctx && (ctx.confidence ?? ctx.conf ?? ctx.score)
                        const confPct = typeof confNum === 'number' && isFinite(confNum)
                            ? (confNum > 1 ? Math.round(confNum) : Math.round(confNum * 100))
                            : null
                        const regime = ctx && ctx.regime ? String(ctx.regime) : null
                        return (
                        <div
                            key={u.id}
                            ref={(el) => { rowsRef.current[idx] = el }}
                            className={`omega-utter omega-utter-${u.utterance_type.toLowerCase()}${clipFrom >= 0 && idx >= clipFrom ? ' omega-utter-clipped' : ''}`}
                            style={{ borderLeftColor: MOOD_COLOR[u.mood] }}
                        >
                            <div className="omega-utter-head">
                                <span className="omega-utter-glyph" style={{ color: MOOD_COLOR[u.mood] }}>{MOOD_GLYPH[u.mood]}</span>
                                <span className="omega-utter-time">{fmtTime(u.created_at)}</span>
                                <span className="omega-utter-type">{u.utterance_type}</span>
                                {confPct != null && (
                                    <span className="omega-utter-conf" style={{ color: MOOD_COLOR[u.mood] }}>
                                        conf {confPct}
                                    </span>
                                )}
                                {regime && (
                                    <span className="omega-utter-regime">{regime}</span>
                                )}
                            </div>
                            <div className="omega-utter-text" style={{ color: u.utterance_type === 'CRITICAL_ALERT' ? MOOD_COLOR[u.mood] : undefined }}>
                                {u.text}
                            </div>
                        </div>
                        )
                    })
                )}
            </div>
        </section>
    )
}
