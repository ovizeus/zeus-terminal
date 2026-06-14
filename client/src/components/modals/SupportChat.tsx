import { useEffect, useRef, useState } from 'react'
import { useSupportStore } from '../../stores/supportStore'

/** Live text chat with the operator. Used inside the Settings SUPPORT tab.
 *  Reuses /api/support REST + the live support.message WS frame (handled in
 *  useServerSync → supportStore). Amethyst-themed via #supportChat in app.css. */
export function SupportChat({ active }: { active: boolean }) {
  const thread = useSupportStore((s) => s.thread)
  const setThread = useSupportStore((s) => s.setThread)
  const appendLocal = useSupportStore((s) => s.appendLocal)
  const clearUserUnread = useSupportStore((s) => s.clearUserUnread)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // Load thread when the tab becomes active; mark replies read.
  useEffect(() => {
    if (!active) return
    const ac = new AbortController()
    fetch('/api/support/thread', { credentials: 'include', signal: ac.signal })
      .then((r) => r.json())
      .then((j) => { if (j && j.ok) { setThread(j.messages || []); clearUserUnread() } })
      .catch(() => {})
    return () => ac.abort()
  }, [active, setThread, clearUserUnread])

  // Auto-scroll to newest.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [thread, active])

  const send = async () => {
    const msg = text.trim()
    if (!msg || sending) return
    setSending(true)
    setText('')
    try {
      const r = await fetch('/api/support/send', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })
      const j = await r.json()
      if (j && j.ok && j.msg) appendLocal(j.msg)
      else setText(msg)
    } catch (_) { setText(msg) }
    setSending(false)
  }

  return (
    <div id="supportChat">
      <div className="msec">LIVE CHAT WITH SUPPORT</div>
      <div className="sc-note">We&apos;re not always online — we&apos;ll reply as soon as we can.</div>
      <div className="sc-list" ref={listRef}>
        {thread.length === 0 && <div className="sc-empty">No messages yet. Say hello 👋</div>}
        {thread.map((m) => (
          <div key={m.id} className={'sc-bubble ' + (m.sender === 'user' ? 'sc-me' : 'sc-them')}>
            <div className="sc-msg">{m.message}</div>
          </div>
        ))}
      </div>
      <div className="sc-input-row">
        <textarea
          className="sc-input"
          value={text}
          placeholder="Type your message…"
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <button className="sc-send" disabled={!text.trim() || sending} onClick={send}>Send</button>
      </div>
    </div>
  )
}
