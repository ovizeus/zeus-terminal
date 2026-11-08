import { useCallback, useEffect, useRef, useState } from 'react'
import { ModalOverlay, ModalHeader } from './ModalOverlay'

/**
 * Build Your Own Indicator — the buyer's side.
 *
 * [2026-11-06] The form is NOT defined here. It is served by /api/byoi/config
 * from server/services/byoiSpec.js and rendered generically below, so the form
 * a buyer fills and the rules that validate it cannot drift apart, and a new
 * field is a server edit rather than a client rebuild.
 */

type FieldType = 'text' | 'textarea' | 'select' | 'multi' | 'color' | 'bool' | 'rows'
interface Option { v: string; l: string }
interface Column { key: string; label: string; max: number }
import { visibleFields, requiredTier, gatingOptions, tierTooLow, tierRank } from './byoiFormRules'

interface Field {
  key: string; type: FieldType; label: string; required?: boolean
  max?: number; min?: number; maxRows?: number; def?: string; hint?: string
  options?: Option[]; columns?: Column[]
  showIf?: { key: string; in?: string[]; has?: string }
}
interface Tier { id: string; label: string; price_cents: number; price: string; quote_only: boolean; blurb: string }
interface Attachment { id: number; filename: string; mime: string; bytes: number }
interface Req {
  id: number; tier: string; title: string; spec: Record<string, unknown>; notes: string
  status: string; priceCents: number; isBypass: boolean; declineReason: string | null
  updatedAt: number; attachments: Attachment[]
}
interface Config {
  optionTier?: Record<string, string>
  fields: Field[]; tiers: Tier[]; billingMode: string; canSubmit: boolean
  maxAttachments: number; maxAttachmentBytes: number; allowedMime: string[]
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', awaiting_payment: 'Awaiting payment', paid: 'Received',
  in_progress: 'Being built', delivered: 'Delivered', declined: 'Declined', refunded: 'Refunded',
}
const STATUS_COLOR: Record<string, string> = {
  draft: '#8aa8c4', awaiting_payment: '#f0c040', paid: '#00afff',
  in_progress: '#00afff', delivered: '#00ff88', declined: '#ff4455', refunded: '#8aa8c4',
}

const L: React.CSSProperties = { fontSize: 9, letterSpacing: 1.4, textTransform: 'uppercase', color: '#667d93', fontWeight: 700, marginBottom: 5, display: 'block' }
const INPUT: React.CSSProperties = { width: '100%', background: '#0a1119', border: '1px solid #1e2a3a', borderRadius: 6, color: '#c0d8ec', fontFamily: 'var(--ff)', fontSize: 13, padding: '8px 10px', outline: 'none' }
const HINT: React.CSSProperties = { fontSize: 10, color: '#50647a', marginTop: 4, lineHeight: 1.4 }
const CARD: React.CSSProperties = { background: 'linear-gradient(160deg,#0b1120,#0d1528)', border: '1px solid #12253a', borderRadius: 8, padding: 12 }
const BTN: React.CSSProperties = { background: 'none', border: '1px solid #1e2a3a', borderRadius: 6, color: '#8aa8c4', fontFamily: 'var(--ff)', fontSize: 12, fontWeight: 600, padding: '8px 14px', cursor: 'pointer' }
const BTN_GO: React.CSSProperties = { ...BTN, background: '#00ff88', border: '1px solid #00ff88', color: '#061018', fontWeight: 700 }

function api(url: string, opts: RequestInit = {}) {
  return fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1', ...(opts.headers || {}) },
    ...opts,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
}

export function BuildIndicatorModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [list, setList] = useState<Req[]>([])
  const [view, setView] = useState<'list' | 'edit'>('list')
  const [editing, setEditing] = useState<Req | null>(null)
  const [tier, setTier] = useState('signature')
  const [spec, setSpec] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const reload = useCallback(() => {
    api('/api/byoi/requests').then(({ body }) => { if (body && body.ok) setList(body.requests) })
  }, [])

  useEffect(() => {
    if (!visible) return
    api('/api/byoi/config').then(({ body }) => { if (body && body.ok) setCfg(body) })
    reload()
  }, [visible, reload])

  function startNew() {
    setEditing(null); setTier('signature'); setSpec({}); setErrors({}); setMsg(''); setView('edit')
  }
  function openDraft(r: Req) {
    setEditing(r); setTier(r.tier); setSpec(r.spec || {}); setErrors({}); setMsg(''); setView('edit')
  }
  function set(key: string, value: unknown) {
    setSpec((s) => ({ ...s, [key]: value }))
  }

  async function save(): Promise<Req | null> {
    setBusy(true); setMsg(''); setErrors({})
    const payload = { tier, spec }
    const res = editing
      ? await api(`/api/byoi/draft/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) })
      : await api('/api/byoi/draft', { method: 'POST', body: JSON.stringify(payload) })
    setBusy(false)
    if (!res.body.ok) {
      setErrors(res.body.errors || {})
      setMsg(res.body.error || 'Could not save')
      return null
    }
    setEditing(res.body.request)
    reload()
    setMsg('Draft saved')
    return res.body.request as Req
  }

  async function doSend() {
    setConfirming(false)
    const saved = await save()
    if (!saved) return
    setBusy(true)
    const res = await api(`/api/byoi/submit/${saved.id}`, { method: 'POST', body: JSON.stringify({}) })
    setBusy(false)
    if (res.status === 402) {
      // The gate refused. Say which wall was hit, in the buyer's words.
      setMsg(res.body.error === 'not_launched'
        ? 'Orders open when Zeus launches. Your draft is saved — it will be waiting.'
        : 'Payment is required before this can be sent.')
      return
    }
    if (!res.body.ok) {
      setErrors(res.body.errors || {})
      setMsg(res.body.error === 'incomplete' ? 'Some required answers are still missing.' : (res.body.error || 'Could not send'))
      return
    }
    setMsg('Sent. We have it.')
    reload(); setView('list')
  }

  async function remove(r: Req) {
    await api(`/api/byoi/draft/${r.id}`, { method: 'DELETE' })
    reload()
  }

  async function addFile(f: File) {
    if (!cfg || !editing) { setMsg('Save the draft first, then attach.'); return }
    if (cfg.allowedMime.indexOf(f.type) === -1) { setMsg('Images only.'); return }
    if (f.size > cfg.maxAttachmentBytes) { setMsg('That image is too large.'); return }
    const b64 = await new Promise<string>((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result || '').split(',')[1] || '')
      fr.readAsDataURL(f)
    })
    const res = await api(`/api/byoi/draft/${editing.id}/attachment`, {
      method: 'POST', body: JSON.stringify({ filename: f.name, mime: f.type, dataB64: b64 }),
    })
    if (!res.body.ok) { setMsg(res.body.error || 'Could not attach'); return }
    const fresh = await api(`/api/byoi/requests`)
    if (fresh.body.ok) {
      setList(fresh.body.requests)
      const mine = (fresh.body.requests as Req[]).find((x) => x.id === editing.id)
      if (mine) setEditing(mine)
    }
  }

  const activeTier = cfg?.tiers.find((t) => t.id === tier)

  // What the ticked options actually require, and which ones forced it.
  const optionTier = cfg?.optionTier || {}
  const tooLow = cfg ? tierTooLow(optionTier, cfg.fields, spec, tier) : false
  const needsTier = tooLow ? requiredTier(optionTier, cfg!.fields, spec) : ''
  const needsTierLabel = cfg?.tiers.find((t) => t.id === needsTier)?.label || needsTier
  const needsTierPrice = cfg?.tiers.find((t) => t.id === needsTier)?.price || ''
  const gatingLabels = cfg && tooLow ? gatingOptions(optionTier, cfg.fields, spec, tier) : []

  /**
   * The price tag on an option that costs more than the tier in hand. Shown
   * before it is ticked, so nobody picks something and finds out at checkout.
   * Nothing is shown once the order already carries that tier.
   */
  function gatedLabel(key: string, value: string): string {
    const need = (cfg?.optionTier || {})[`${key}:${value}`]
    if (!need || tierRank(need) <= tierRank(tier)) return ''
    return cfg?.tiers.find((t) => t.id === need)?.price || ''
  }

  function renderField(f: Field) {
    const err = errors[f.key]
    const v = spec[f.key]
    const label = (
      <label style={L}>
        {f.label}{f.required ? <span style={{ color: '#ff4455' }}> *</span> : null}
      </label>
    )
    let control: React.ReactNode = null

    if (f.type === 'text') {
      control = <input style={INPUT} maxLength={f.max} value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} />
    } else if (f.type === 'textarea') {
      control = <textarea style={{ ...INPUT, minHeight: 110, resize: 'vertical', lineHeight: 1.5 }} maxLength={f.max} value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} />
    } else if (f.type === 'select') {
      control = (
        <select style={INPUT} value={String(v ?? f.def ?? '')} onChange={(e) => set(f.key, e.target.value)}>
          <option value="">—</option>
          {f.options?.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
      )
    } else if (f.type === 'multi') {
      const arr = Array.isArray(v) ? (v as string[]) : []
      control = (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {f.options?.map((o) => {
            const on = arr.indexOf(o.v) !== -1
            return (
              <button key={o.v} type="button"
                onClick={() => set(f.key, on ? arr.filter((x) => x !== o.v) : [...arr, o.v])}
                style={{
                  ...BTN, padding: '6px 11px', fontSize: 12,
                  borderColor: on ? '#00afff' : '#1e2a3a',
                  color: on ? '#00afff' : '#8aa8c4',
                  background: on ? 'rgba(0,175,255,0.08)' : 'none',
                }}>
                {on ? '✓ ' : ''}{o.l}
                {gatedLabel(f.key, o.v) && (
                  <span style={{ marginLeft: 5, fontSize: 10, color: '#f0c040', opacity: 0.9 }}>
                    {gatedLabel(f.key, o.v)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )
    } else if (f.type === 'color') {
      const cur = String(v ?? f.def ?? '#00afff')
      control = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="color" value={cur} onChange={(e) => set(f.key, e.target.value)}
            style={{ width: 44, height: 30, padding: 0, border: '1px solid #1e2a3a', borderRadius: 6, background: '#0a1119', cursor: 'pointer' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#8aa8c4' }}>{cur}</span>
        </div>
      )
    } else if (f.type === 'bool') {
      const on = v === true
      control = (
        <button type="button" onClick={() => set(f.key, !on)}
          style={{ ...BTN, borderColor: on ? '#f0c040' : '#1e2a3a', color: on ? '#f0c040' : '#8aa8c4', background: on ? 'rgba(240,192,64,0.08)' : 'none' }}>
          {on ? '✓ Yes' : 'No'}
        </button>
      )
    } else if (f.type === 'rows') {
      const rows = Array.isArray(v) ? (v as Record<string, string>[]) : []
      const cols = f.columns || []
      control = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: 'flex', gap: 6 }}>
              {cols.map((c) => (
                <input key={c.key} style={{ ...INPUT, flex: 1 }} placeholder={c.label} maxLength={c.max}
                  value={row[c.key] || ''}
                  onChange={(e) => {
                    const next = rows.map((r, j) => (j === i ? { ...r, [c.key]: e.target.value } : r))
                    set(f.key, next)
                  }} />
              ))}
              <button type="button" style={{ ...BTN, padding: '0 10px' }} onClick={() => set(f.key, rows.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          {rows.length < (f.maxRows || 8) && (
            <button type="button" style={{ ...BTN, alignSelf: 'flex-start' }} onClick={() => set(f.key, [...rows, {}])}>+ Add input</button>
          )}
        </div>
      )
    }

    return (
      <div key={f.key} style={{ marginBottom: 16 }}>
        {label}
        {control}
        {f.hint && <div style={HINT}>{f.hint}</div>}
        {err && <div style={{ ...HINT, color: '#ff4455' }}>{err}</div>}
      </div>
    )
  }

  return (
    <ModalOverlay id="byoiModal" visible={visible} onClose={onClose} maxWidth="760px">
      <ModalHeader title="Build Your Own Indicator" onClose={onClose} />

      <div style={{ padding: '4px 2px 10px', maxHeight: '72vh', overflowY: 'auto' }}>

        {view === 'list' && (
          <>
            <div style={{ fontSize: 12, color: '#8aa8c4', lineHeight: 1.6, marginBottom: 14 }}>
              Describe the indicator you want and we build it into your chart. Save as many drafts
              as you like; nothing is sent, and nothing is charged, until you press Send.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 8, marginBottom: 16 }}>
              {cfg?.tiers.map((t) => (
                <div key={t.id} style={CARD}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: 700, color: '#c0d8ec' }}>{t.label}</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: t.quote_only ? '#f0c040' : '#00ff88' }}>{t.quote_only ? 'Quote' : t.price}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#667d93', lineHeight: 1.45 }}>{t.blurb}</div>
                </div>
              ))}
            </div>

            <button style={{ ...BTN_GO, width: '100%', padding: '11px 0' }} onClick={startNew}>+ New indicator</button>

            {list.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div style={L}>Your requests</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {list.map((r) => (
                    <div key={r.id} style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: '#c0d8ec', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.title || 'Untitled'}
                        </div>
                        <div style={{ fontSize: 10, color: '#50647a', marginTop: 2 }}>
                          {r.tier} · {r.attachments.length} image{r.attachments.length === 1 ? '' : 's'}
                          {r.declineReason ? ` · ${r.declineReason}` : ''}
                        </div>
                      </div>
                      <span style={{ fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 700, color: STATUS_COLOR[r.status] || '#8aa8c4' }}>
                        {STATUS_LABEL[r.status] || r.status}
                      </span>
                      {r.status === 'draft' && (
                        <>
                          <button style={{ ...BTN, padding: '5px 10px' }} onClick={() => openDraft(r)}>Edit</button>
                          <button style={{ ...BTN, padding: '5px 10px', color: '#ff4455', borderColor: '#ff445533' }} onClick={() => remove(r)}>✕</button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {view === 'edit' && cfg && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {cfg.tiers.map((t) => (
                <button key={t.id} type="button" onClick={() => setTier(t.id)}
                  style={{
                    ...BTN, flex: 1, flexDirection: 'column', display: 'flex', gap: 2, padding: '9px 8px',
                    borderColor: tier === t.id ? '#00afff' : '#1e2a3a',
                    background: tier === t.id ? 'rgba(0,175,255,0.08)' : 'none',
                  }}>
                  <span style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: tier === t.id ? '#00afff' : '#8aa8c4' }}>{t.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: t.quote_only ? '#f0c040' : '#00ff88' }}>{t.quote_only ? 'Quote' : t.price}</span>
                </button>
              ))}
            </div>

            {/* [2026-11-07] Said BEFORE he pays, and it offers the upgrade
                instead of blocking him: a lost sale is worse than an upsell.
                The server refuses an under-tiered order on its own regardless. */}
            {needsTier && (
              <div style={{
                marginBottom: 16, padding: '10px 12px', borderRadius: 8,
                border: '1px solid #3a3420', background: 'rgba(240,192,64,0.07)',
                fontSize: 12, color: '#f0c040', lineHeight: 1.6,
              }}>
                <div>
                  {gatingLabels.length === 1
                    ? `"${gatingLabels[0]}" needs the ${needsTierLabel} tier.`
                    : `${gatingLabels.slice(0, 3).join(', ')} need the ${needsTierLabel} tier.`}
                </div>
                <button type="button" onClick={() => setTier(needsTier)}
                  style={{ ...BTN, marginTop: 8, borderColor: '#f0c040', color: '#f0c040', fontSize: 12 }}>
                  Move this order to {needsTierLabel}{needsTierPrice ? ` — ${needsTierPrice}` : ''}
                </button>
              </div>
            )}

            {visibleFields(cfg.fields, spec).map((f) => renderField(f as Field))}

            <div style={{ marginBottom: 16 }}>
              <label style={L}>Screenshots or sketches</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {editing?.attachments.map((a) => (
                  <img key={a.id} src={`/api/byoi/attachment/${a.id}`} alt={a.filename}
                    style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid #1e2a3a' }} />
                ))}
                <button type="button" style={BTN} onClick={() => fileRef.current?.click()}
                  disabled={!editing || (editing.attachments.length >= cfg.maxAttachments)}>
                  + Add image
                </button>
                <input ref={fileRef} type="file" accept={cfg.allowedMime.join(',')} style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) addFile(f); e.target.value = '' }} />
              </div>
              {!editing && <div style={HINT}>Save the draft once and the image button wakes up.</div>}
            </div>

            {msg && (
              <div style={{ ...CARD, marginBottom: 12, borderColor: '#00afff33', fontSize: 12, color: '#c0d8ec' }}>{msg}</div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={BTN} onClick={() => { setView('list'); setMsg('') }}>Back</button>
              <button style={BTN} disabled={busy} onClick={() => { save() }}>Save draft</button>
              <button style={{ ...BTN_GO, flex: 1, minWidth: 140 }} disabled={busy}
                onClick={() => setConfirming(true)}>
                Send{activeTier && !activeTier.quote_only ? ` · ${activeTier.price}` : ''}
              </button>
            </div>

            {!cfg.canSubmit && (
              <div style={{ ...HINT, marginTop: 10 }}>
                Orders open when Zeus launches. Drafts are saved and will be waiting.
              </div>
            )}
          </>
        )}
      </div>

      {confirming && activeTier && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(3,7,12,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirming(false) }}>
          <div style={{ ...CARD, maxWidth: 380, padding: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#c0d8ec', marginBottom: 8 }}>Send this indicator?</div>
            <div style={{ fontSize: 12, color: '#8aa8c4', lineHeight: 1.6, marginBottom: 14 }}>
              {activeTier.quote_only
                ? <>We read your description and come back with a quote. <b>Nothing is charged now.</b></>
                : <>You are ordering <b style={{ color: '#c0d8ec' }}>{String(spec.title || 'your indicator')}</b> on the {activeTier.label} tier for <b style={{ color: '#00ff88' }}>{activeTier.price}</b>. Once sent, the draft is locked and goes to the build queue.</>}
              <br /><br />
              If we cannot build what you asked for, the order is declined and <b>refunded in full</b>.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...BTN, flex: 1 }} onClick={() => setConfirming(false)}>Cancel</button>
              <button style={{ ...BTN_GO, flex: 1 }} onClick={doSend}>Yes, send it</button>
            </div>
          </div>
        </div>
      )}
    </ModalOverlay>
  )
}
