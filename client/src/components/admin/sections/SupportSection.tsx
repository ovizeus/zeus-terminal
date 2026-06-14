import { useEffect, useRef, useState } from 'react'
import { useSupportStore } from '../../../stores/supportStore'
import type { SupportMsg } from '../../../stores/supportStore'

interface Convo { user_id: number; email: string | null; last_message: string; last_at: string; unread_count: number }

/** Operator inbox: conversation list (left) + thread & reply (right).
 *  Realtime: a new user message bumps adminUnread (header badge) via WS; this
 *  panel refetches the inbox to refresh the list. Amethyst via #adminSupport. */
export function SupportSection() {
  const [convos, setConvos] = useState<Convo[]>([])
  const [activeUid, setActiveUid] = useState<number | null>(null)
  const [thread, setThread] = useState<SupportMsg[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const adminUnread = useSupportStore((s) => s.adminUnread)
  const setAdminUnread = useSupportStore((s) => s.setAdminUnread)
  const prevUnread = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const threadAbort = useRef<AbortController | null>(null)

  const loadInbox = () => {
    fetch('/api/support/inbox', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (j && j.ok) { setConvos(j.conversations || []); setAdminUnread(j.totalUnread || 0) } })
      .catch(() => {})
  }

  // Initial load (once on mount).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadInbox() }, [])
  // Refetch only on a genuine WS-driven increase in unread.
  useEffect(() => {
    if (adminUnread > prevUnread.current) loadInbox()
    prevUnread.current = adminUnread
  }, [adminUnread])

  const openThread = (uid: number) => {
    threadAbort.current?.abort()
    const ctrl = new AbortController()
    threadAbort.current = ctrl
    setActiveUid(uid)
    fetch('/api/support/thread/' + uid, { credentials: 'include', signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => { if (j && j.ok) { setThread(j.messages || []); loadInbox() } })
      .catch(() => {})
  }

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }, [thread])

  const reply = async () => {
    const msg = text.trim()
    if (!msg || sending || !activeUid) return
    setSending(true); setText('')
    try {
      const r = await fetch('/api/support/reply/' + activeUid, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })
      const j = await r.json()
      if (j && j.ok && j.msg) setThread((t) => [...t, j.msg])
      else setText(msg)
    } catch (_) { setText(msg) }
    setSending(false)
  }

  return (
    <div id="adminSupport">
      <div className="as-cols">
        <div className="as-list">
          {convos.length === 0 && <div className="as-empty">No conversations yet.</div>}
          {convos.map((c) => (
            <div key={c.user_id}
                 className={'as-convo' + (c.user_id === activeUid ? ' as-active' : '')}
                 onClick={() => openThread(c.user_id)}>
              <div className="as-email">{c.email || ('user #' + c.user_id)}</div>
              <div className="as-snip">{c.last_message}</div>
              {c.unread_count > 0 && <span className="as-dot">{c.unread_count}</span>}
            </div>
          ))}
        </div>
        <div className="as-thread">
          {activeUid == null && <div className="as-empty">Select a conversation.</div>}
          {activeUid != null && (
            <>
              <div className="as-msgs" ref={listRef}>
                {thread.map((m) => (
                  <div key={m.id} className={'as-bubble ' + (m.sender === 'admin' ? 'as-me' : 'as-them')}>
                    {m.message}
                  </div>
                ))}
              </div>
              <div className="as-input-row">
                <textarea className="as-input" rows={2} value={text}
                          placeholder="Reply..."
                          onChange={(e) => setText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); reply() } }} />
                <button className="as-send" disabled={!text.trim() || sending} onClick={reply}>Send</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
