import { useState, useRef, useEffect } from 'react'
import type { Mood } from './omegaApi'
import { sendChat, MOOD_COLOR } from './omegaApi'

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
    const inputRef = useRef<HTMLInputElement | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)

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
        setHistory(prev => [...prev, userRow])
        setInput('')
        try {
            const reply = await sendChat(text)
            const omegaRow: ChatRow = { role: 'omega', text: reply.reply, mood: reply.mood, ts: Date.now() }
            setHistory(prev => [...prev, omegaRow])
            if (voiceOn && typeof window.speechSynthesis !== 'undefined') {
                try {
                    const utt = new SpeechSynthesisUtterance(reply.reply)
                    utt.rate = 0.95
                    utt.pitch = 0.85
                    window.speechSynthesis.speak(utt)
                } catch (_) { /* TTS optional */ }
            }
            onUtteranceLogged()
        } catch (err: any) {
            setError(String(err && err.message || err))
        } finally {
            setSending(false)
            setTimeout(() => inputRef.current?.focus(), 50)
        }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
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
                <input
                    ref={inputRef}
                    className="omega-chat-input"
                    placeholder="ask omega anything..."
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Escape') {
                            setExpanded(false);
                            (e.target as HTMLInputElement).blur();
                        } else {
                            handleKeyDown(e);
                        }
                    }}
                    onFocus={() => setExpanded(true)}
                    disabled={sending}
                    maxLength={500}
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
