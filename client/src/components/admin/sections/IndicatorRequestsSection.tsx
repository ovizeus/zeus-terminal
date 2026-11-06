import { useCallback, useEffect, useState } from 'react'

/**
 * Admin — Indicator Requests.
 *
 * [2026-11-06] The operator's side of Build Your Own Indicator: the buyer's
 * full spec, their screenshots, and the only three moves that matter — start
 * building, deliver, or decline. Declining says out loud that the money goes
 * back, because that is the standing decision and nobody should have to
 * remember it at the moment they press the button.
 *
 * Drafts never appear here. They are the buyer's private scratch space.
 */

interface Attachment { id: number; filename: string; mime: string; bytes: number }
interface Req {
  id: number; userId: number; email: string | null
  tier: string; title: string; spec: Record<string, unknown>; notes: string
  status: string; priceCents: number; currency: string
  isBypass: boolean; paymentRef: string | null; billingMode: string | null
  declineReason: string | null; adminNote: string | null
  submittedAt: number | null; deliveredAt: number | null
}

const STATUS_COLOR: Record<string, string> = {
  awaiting_payment: '#f0c040', paid: '#00afff', in_progress: '#00afff',
  delivered: '#00ff88', declined: '#ff4455', refunded: '#8aa8c4',
}
/** Mirrors byoiPricing.TRANSITIONS. The server refuses anything else anyway —
 *  this only keeps impossible buttons off the screen. */
const NEXT: Record<string, string[]> = {
  awaiting_payment: [], paid: ['in_progress', 'declined'],
  in_progress: ['delivered', 'declined'], delivered: [], declined: ['refunded'], refunded: [],
}
const MOVE_LABEL: Record<string, string> = {
  in_progress: 'Start building', delivered: 'Mark delivered',
  declined: 'Decline', refunded: 'Mark refunded',
}

function api(url: string, opts: RequestInit = {}) {
  return fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1', ...(opts.headers || {}) },
    ...opts,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
}
function money(cents: number) { return '$' + (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2) }
function when(ms: number | null) { return ms ? new Date(ms).toLocaleString() : '—' }

export function IndicatorRequestsSection() {
  const [rows, setRows] = useState<Req[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  // [2026-11-06] Delivering is not a plain status move: it registers the slug
  // of the indicator that was actually BUILT, and decides whether it goes
  // public. The buyer could only ask; granting is the operator's call, because
  // a public indicator lands in every user's list and that list is the product.
  const [deliver, setDeliver] = useState<{ id: number; slug: string; visibility: string; author: string } | null>(null)

  const load = useCallback(() => {
    api('/api/byoi/admin/requests').then(({ body }) => { if (body && body.ok) setRows(body.requests) })
  }, [])
  useEffect(() => { load() }, [load])

  async function doDeliver(r: Req) {
    if (!deliver) return
    const res = await api(`/api/byoi/admin/request/${r.id}/deliver`, {
      method: 'POST',
      body: JSON.stringify({ slug: deliver.slug, visibility: deliver.visibility, authorLabel: deliver.author, adminNote: note.trim() || undefined }),
    })
    if (!res.body.ok) { alert(res.body.error || 'Could not deliver'); return }
    setDeliver(null); setNote(''); load()
  }

  async function move(r: Req, to: string) {
    if (to === 'delivered') {
      // Open the registration form instead; the plain status move would mark
      // it delivered with no indicator behind it.
      const wanted = String(r.spec.visibility || 'private')
      setDeliver({ id: r.id, slug: '', visibility: 'private', author: wanted === 'public_request' ? (r.email || '').split('@')[0] : '' })
      return
    }
    if (to === 'declined' && !note.trim()) {
      // A decline with no reason is a refund the buyer cannot understand.
      alert('Give a reason — the buyer sees it, and it is the only explanation they get.')
      return
    }
    if (!confirm(to === 'declined'
      ? `Decline "${r.title}"? This owes ${money(r.priceCents)} back to ${r.email || 'the buyer'}.`
      : `Move "${r.title}" to ${MOVE_LABEL[to]}?`)) return
    setBusy(true)
    const res = await api(`/api/byoi/admin/request/${r.id}/status`, {
      method: 'POST', body: JSON.stringify({ status: to, declineReason: to === 'declined' ? note.trim() : undefined, adminNote: note.trim() || undefined }),
    })
    setBusy(false)
    if (!res.body.ok) { alert(res.body.error || 'Could not change status'); return }
    if (res.body.refundOwed) alert(`Declined. ${money(r.priceCents)} is owed back to ${r.email || 'the buyer'} — mark it refunded once the money has actually left.`)
    setNote(''); load()
  }

  const pending = rows.filter((r) => r.status === 'paid' || r.status === 'in_progress').length

  return (
    <div className="zac-section">
      <div className="zac-sec-hdr">
        <h2>Indicator Requests</h2>
        <span className="zac-sec-sub">{rows.length} total · {pending} waiting on you</span>
      </div>

      {rows.length === 0 && <div className="zac-empty">No requests yet.</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r) => {
          const isOpen = open === r.id
          return (
            <div key={r.id} style={{ background: 'linear-gradient(160deg,#0b1120,#0d1528)', border: '1px solid #12253a', borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : r.id)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#c0d8ec' }}>{r.title || 'Untitled'}</div>
                  <div style={{ fontSize: 11, color: '#50647a', marginTop: 2 }}>
                    {r.email || `user ${r.userId}`} · {r.tier} · {money(r.priceCents)} · {when(r.submittedAt)}
                    {r.isBypass && <span style={{ color: '#f0c040' }}> · TEST ORDER, no money taken</span>}
                  </div>
                </div>
                <span style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 700, color: STATUS_COLOR[r.status] || '#8aa8c4' }}>
                  {r.status.replace('_', ' ')}
                </span>
                <span style={{ color: '#50647a', fontSize: 12 }}>{isOpen ? '▾' : '▸'}</span>
              </div>

              {isOpen && (
                <div style={{ marginTop: 12, borderTop: '1px solid #12253a', paddingTop: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 8, marginBottom: 12 }}>
                    {Object.entries(r.spec).filter(([k]) => k !== 'notes').map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', color: '#667d93', marginBottom: 2 }}>{k}</div>
                        <div style={{ fontSize: 12, color: '#c0d8ec', wordBreak: 'break-word' }}>
                          {Array.isArray(v) ? (v as unknown[]).map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') || '—'
                            : typeof v === 'boolean' ? (v ? 'yes' : 'no')
                              : String(v || '—')}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', color: '#667d93', marginBottom: 4 }}>In their words</div>
                  <div style={{ fontSize: 13, color: '#c0d8ec', lineHeight: 1.6, whiteSpace: 'pre-wrap', background: '#0a1119', border: '1px solid #12253a', borderRadius: 6, padding: 10, marginBottom: 12 }}>
                    {String(r.spec.notes || r.notes || '—')}
                  </div>

                  <AttachmentStrip requestId={r.id} />

                  {r.declineReason && (
                    <div style={{ fontSize: 12, color: '#ff4455', marginBottom: 10 }}>Declined: {r.declineReason}</div>
                  )}

                  {NEXT[r.status]?.length > 0 && (
                    <>
                      <input value={note} onChange={(e) => setNote(e.target.value)}
                        placeholder="Note to the buyer (required when declining)"
                        style={{ width: '100%', background: '#0a1119', border: '1px solid #1e2a3a', borderRadius: 6, color: '#c0d8ec', fontSize: 12, padding: '8px 10px', marginBottom: 8, fontFamily: 'var(--ff)' }} />
                      {deliver && deliver.id === r.id && (
                        <div style={{ background: '#0a1119', border: '1px solid #1e2a3a', borderRadius: 6, padding: 12, marginBottom: 10 }}>
                          <div style={{ fontSize: 11, color: '#8aa8c4', marginBottom: 8, lineHeight: 1.5 }}>
                            Register the indicator you built. The slug must match its id in the chart code —
                            a row here promises a working toggle.
                            {String(r.spec.visibility || '') === 'public_request' && (
                              <><br /><b style={{ color: '#f0c040' }}>They asked for this to be public.</b> Your call.</>
                            )}
                          </div>
                          <input value={deliver.slug} onChange={(e) => setDeliver({ ...deliver, slug: e.target.value })}
                            placeholder="slug, e.g. ovi_wave"
                            style={{ width: '100%', background: '#0b1120', border: '1px solid #1e2a3a', borderRadius: 6, color: '#c0d8ec', fontSize: 12, padding: '8px 10px', marginBottom: 8, fontFamily: 'monospace' }} />
                          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                            {['private', 'public'].map((v) => (
                              <button key={v} onClick={() => setDeliver({ ...deliver, visibility: v })}
                                style={{
                                  flex: 1, background: deliver.visibility === v ? 'rgba(0,175,255,0.1)' : 'none',
                                  border: `1px solid ${deliver.visibility === v ? '#00afff' : '#1e2a3a'}`,
                                  color: deliver.visibility === v ? '#00afff' : '#8aa8c4',
                                  borderRadius: 6, fontSize: 12, padding: '7px 0', cursor: 'pointer', fontFamily: 'var(--ff)',
                                }}>{v === 'private' ? 'Only them' : 'Everyone'}</button>
                            ))}
                          </div>
                          {deliver.visibility === 'public' && (
                            <input value={deliver.author} onChange={(e) => setDeliver({ ...deliver, author: e.target.value })}
                              placeholder="credit, shown as “by …”"
                              style={{ width: '100%', background: '#0b1120', border: '1px solid #1e2a3a', borderRadius: 6, color: '#c0d8ec', fontSize: 12, padding: '8px 10px', marginBottom: 8, fontFamily: 'var(--ff)' }} />
                          )}
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => setDeliver(null)}
                              style={{ flex: 1, background: 'none', border: '1px solid #1e2a3a', color: '#8aa8c4', borderRadius: 6, fontSize: 12, padding: '8px 0', cursor: 'pointer', fontFamily: 'var(--ff)' }}>Cancel</button>
                            <button onClick={() => doDeliver(r)}
                              style={{ flex: 1, background: '#00ff88', border: '1px solid #00ff88', color: '#061018', borderRadius: 6, fontSize: 12, fontWeight: 700, padding: '8px 0', cursor: 'pointer', fontFamily: 'var(--ff)' }}>Register &amp; deliver</button>
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {NEXT[r.status].map((to) => (
                          <button key={to} disabled={busy} onClick={() => move(r, to)}
                            style={{
                              background: to === 'declined' ? 'none' : '#00ff88',
                              border: `1px solid ${to === 'declined' ? '#ff445555' : '#00ff88'}`,
                              color: to === 'declined' ? '#ff4455' : '#061018',
                              borderRadius: 6, fontSize: 12, fontWeight: 700, padding: '8px 14px', cursor: 'pointer', fontFamily: 'var(--ff)',
                            }}>
                            {MOVE_LABEL[to]}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Thumbnails load lazily, one request each: a list of six screenshots should
 *  not weigh down the page the operator opens twenty times a day. */
function AttachmentStrip({ requestId }: { requestId: number }) {
  const [atts, setAtts] = useState<Attachment[] | null>(null)
  useEffect(() => {
    api('/api/byoi/admin/requests').then(({ body }) => {
      if (!body || !body.ok) return
      const mine = (body.requests as Array<{ id: number; attachments: Attachment[] }>).find((x) => x.id === requestId)
      setAtts(mine ? mine.attachments : [])
    })
  }, [requestId])
  if (!atts || atts.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
      {atts.map((a) => (
        <a key={a.id} href={`/api/byoi/attachment/${a.id}`} target="_blank" rel="noreferrer">
          <img src={`/api/byoi/attachment/${a.id}`} alt={a.filename}
            style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '1px solid #1e2a3a' }} />
        </a>
      ))}
    </div>
  )
}
