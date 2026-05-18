import { useState, useRef, useEffect } from 'react'
import type { Mood } from './omegaApi'
import { sendChatStream, MOOD_COLOR } from './omegaApi'

/**
 * Talk With Me — OMEGA chat panel.
 *
 * Operator types a question, OMEGA replies in character. Wave 1 = stub
 * responder (state-aware basic phrases). Wave 8 polish: real chatResponder
 * that consumes all rings' state. Replies appear inline + persist to
 * ml_voice_log so the Voice feed also shows the conversation.
 *
 * Optional browser SpeechSynthesis when voiceOn enabled. ON/OFF + speed
 * controls live in parent OmegaPage settings header.
 */
interface Props {
    voiceOn: boolean
    onUtteranceLogged: () => void
}

interface ChatRow {
    role: 'you' | 'omega'
    text: string
    mood?: Mood
    ts: number
}

export function TalkWithMe({ voiceOn, onUtteranceLogged }: Props) {
    const [history, setHistory] = useState<ChatRow[]>([])
    const [input, setInput] = useState('')
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [expanded, setExpanded] = useState(false)
    const inputRef = useRef<HTMLTextAreaElement | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)

    // [Day 35] Auto-grow textarea up to 6 lines, then scroll. Run on every input change.
    useEffect(() => {
        const el = inputRef.current
        if (!el) return
        el.style.height = 'auto'
        const newH = Math.min(el.scrollHeight, 160) // ~6 lines × ~26px
        el.style.height = newH + 'px'
    }, [input])

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [history])

    async function handleSend() {
        const text = input.trim()
        if (!text || sending) return
        setError(null)
        setSending(true)
        const userRow: ChatRow = { role: 'you', text, ts: Date.now() }
        // [Day 32D] Streaming — append an omega placeholder row immediately
        // and mutate its text as chunks arrive. Final mood comes from 'done' frame.
        const omegaTs = Date.now()
        const omegaPlaceholder: ChatRow = { role: 'omega', text: '', mood: 'CALM', ts: omegaTs }
        setHistory(prev => [...prev, userRow, omegaPlaceholder])
        setInput('')
        try {
            const reply = await sendChatStream(text, (chunk) => {
                setHistory(prev => {
                    const next = prev.slice()
                    // last row is the omega placeholder
                    const last = next[next.length - 1]
                    if (last && last.role === 'omega' && last.ts === omegaTs) {
                        next[next.length - 1] = { ...last, text: (last.text || '') + chunk }
                    }
                    return next
                })
            })
            // Patch final mood on the row in case 'done' carried a refined mood
            setHistory(prev => {
                const next = prev.slice()
                const last = next[next.length - 1]
                if (last && last.role === 'omega' && last.ts === omegaTs) {
                    next[next.length - 1] = { ...last, mood: reply.mood, text: reply.reply || last.text }
                }
                return next
            })
            if (voiceOn) {
                // [Day 30.2] Server-side TTS via /api/omega/tts (Google Translate
                // proxy → MP3). Works reliably cross-platform: desktop + mobile,
                // no SpeechSynthesis API quirks. Chunks long replies to 180-char
                // segments (Google limit ~200). Plays sequentially.
                try {
                    const txt = reply.reply.slice(0, 1000) // hard cap to avoid endless queue
                    const isRo = /\b(este|sunt|despre|pentru|cu|în|ai|am|esti|ești|faci|salut|bună|și|ce|cum|nu|da|să|simt|gândesc|părere)\b/i.test(txt)
                    const lang = isRo ? 'ro' : 'en'
                    // Split into ≤180-char chunks at sentence boundaries when possible.
                    const chunks: string[] = []
                    const parts = txt.split(/([.!?]\s+|,\s+)/g) // keep delimiter via capture
                    let buf = ''
                    for (const p of parts) {
                        if ((buf + p).length > 180) {
                            if (buf) chunks.push(buf.trim())
                            buf = p
                        } else {
                            buf += p
                        }
                    }
                    if (buf.trim()) chunks.push(buf.trim())
                    // Play chunks sequentially.
                    let i = 0
                    const playNext = () => {
                        if (i >= chunks.length) return
                        const chunk = chunks[i++]
                        const audio = new Audio(`/api/omega/tts?text=${encodeURIComponent(chunk)}&lang=${lang}`)
                        audio.onended = playNext
                        audio.onerror = (ev) => console.warn('[TTS] audio error', ev)
                        audio.play().catch(err => console.warn('[TTS] play() rejected', err))
                    }
                    playNext()
                } catch (err) {
                    console.warn('[TTS] threw', err)
                }
            }
            onUtteranceLogged()
        } catch (err: any) {
            setError(String(err && err.message || err))
        } finally {
            setSending(false)
            setTimeout(() => inputRef.current?.focus(), 50)
        }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        // [Day 35] Enter sends, Shift+Enter inserts newline (textarea convention).
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    return (
        <section className={`omega-chat${expanded ? ' omega-chat-expanded' : ''}`}>
            <div className="omega-chat-header" onClick={() => setExpanded(e => !e)}>
                <span className="omega-chat-title">💬 TALK WITH ME</span>
                <span className="omega-chat-hint">
                    {expanded ? 'tap to minimize · esc' : history.length > 0 ? `${history.length} messages — tap to open` : 'tap to chat'}
                </span>
            </div>
            <div className="omega-chat-scroll" ref={scrollRef}>
                {history.length === 0 ? (
                    <div className="omega-chat-empty">
                        <div className="omega-chat-empty-glyph">Ω</div>
                        <div className="omega-chat-empty-text">say something boss. i'm here.</div>
                    </div>
                ) : (
                    history.map((row, i) => (
                        <div key={i} className={`omega-chat-row omega-chat-${row.role}`}>
                            <div className="omega-chat-bubble" style={row.role === 'omega' && row.mood ? { borderColor: MOOD_COLOR[row.mood] } : undefined}>
                                <span className="omega-chat-prefix">{row.role === 'you' ? 'YOU' : 'Ω'}</span>
                                <span className="omega-chat-text">{row.text}</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
            {error && <div className="omega-chat-error">⚠ {error}</div>}
            <div className="omega-chat-input-row">
                <textarea
                    ref={inputRef}
                    className="omega-chat-input"
                    placeholder="ask omega anything... (Shift+Enter = newline, Enter = send)"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Escape') {
                            setExpanded(false);
                            (e.target as HTMLTextAreaElement).blur();
                        } else {
                            handleKeyDown(e);
                        }
                    }}
                    onFocus={() => setExpanded(true)}
                    disabled={sending}
                    maxLength={5000}
                    rows={1}
                />
                <button
                    className="omega-chat-send"
                    onClick={handleSend}
                    disabled={sending || !input.trim()}
                    aria-label="send to omega"
                >
                    {sending ? '◌' : '→'}
                </button>
            </div>
        </section>
    )
}
