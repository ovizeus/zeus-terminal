import { useEffect, useRef, useState } from 'react'

// ─── Uploads — operator uploads screenshots + docs, the assistant reads them
// off disk to fix things, the operator deletes them after. Newest first.

type Item = { id: string; name: string; uploadedAt: number; size: number; kind: 'image' | 'doc'; ext: string }

const ACCENT = '#4fd1ff'
function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}
function fmtDate(ms: number): string {
  try { return new Date(ms).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

export function UploadsSection() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = () => {
    fetch('/api/admin/uploads', { credentials: 'same-origin' })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d) => { setItems(d.items || []); setError(null) })
      .catch((e) => setError(String(e.message || e)))
  }
  useEffect(load, [])

  const upload = async (files: FileList | null) => {
    if (!files || !files.length) return
    setBusy(true); setError(null)
    try {
      const fd = new FormData()
      Array.from(files).forEach((f, i) => fd.append(`file${i}`, f))
      const r = await fetch('/api/admin/uploads', { method: 'POST', credentials: 'same-origin', headers: { 'X-Zeus-Request': '1' }, body: fd })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`) }
      load()
    } catch (e: any) { setError(String(e.message || e)) }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = '' }
  }

  const remove = async (it: Item) => {
    if (!window.confirm(`Ștergi „${it.name}"?`)) return
    try {
      const r = await fetch(`/api/admin/uploads/${encodeURIComponent(it.id)}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Zeus-Request': '1' } })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setItems((prev) => (prev || []).filter((x) => x.id !== it.id))
    } catch (e: any) { setError(String(e.message || e)) }
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '8px 4px 60px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: '0 0 4px' }}>Uploads</h1>
      <div style={{ color: '#8a93a8', fontSize: 13, marginBottom: 16 }}>
        Urcă capturi sau documente (imagini, PDF, txt, csv, log, md, json — max 15MB). Le analizez, apoi le ștergi tu după ce-i reparat.
      </div>

      {/* Dropzone + upload button */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        style={{ cursor: 'pointer', border: `2px dashed ${drag ? ACCENT : 'rgba(255,255,255,0.14)'}`, background: drag ? 'rgba(79,209,255,0.07)' : 'rgba(255,255,255,0.02)', borderRadius: 14, padding: '26px 18px', textAlign: 'center', marginBottom: 22, transition: 'all 0.15s' }}
      >
        <div style={{ color: ACCENT, fontSize: 26, marginBottom: 6 }}>↥</div>
        <div style={{ color: '#cdd3e0', fontSize: 14, fontWeight: 600 }}>{busy ? 'Se urcă…' : 'Trage fișiere aici sau click pentru a alege'}</div>
        <div style={{ color: '#5f6678', fontSize: 11.5, marginTop: 4 }}>poți urca mai multe odată</div>
        <input ref={inputRef} type="file" multiple accept="image/*,.pdf,.txt,.csv,.log,.md,.json" style={{ display: 'none' }} onChange={(e) => upload(e.target.files)} />
      </div>

      {error && <div style={{ padding: 12, borderRadius: 10, background: 'rgba(255,92,122,0.1)', color: '#ff5c7a', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {items === null && !error && <div style={{ padding: 24, textAlign: 'center', color: '#8a93a8', fontSize: 13 }}>Se încarcă…</div>}
      {items !== null && items.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#5f6678', fontSize: 13 }}>Niciun fișier urcat încă.</div>}

      {items !== null && items.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
          {items.map((it, idx) => (
            <div key={it.id} style={{ borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: `1px solid ${idx === 0 ? 'rgba(79,209,255,0.4)' : 'rgba(255,255,255,0.07)'}`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <a href={`/api/admin/uploads/${encodeURIComponent(it.id)}/raw`} target="_blank" rel="noreferrer" style={{ display: 'block', height: 130, background: '#0c0f16', position: 'relative' }}>
                {it.kind === 'image' ? (
                  <img src={`/api/admin/uploads/${encodeURIComponent(it.id)}/raw`} alt={it.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#7a8aa0' }}>
                    <div style={{ fontSize: 30, color: ACCENT }}>▦</div>
                    <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#9fb2c8', textTransform: 'uppercase' }}>{it.ext}</div>
                  </div>
                )}
                {idx === 0 && <span style={{ position: 'absolute', top: 6, left: 6, fontSize: 9.5, fontWeight: 700, color: '#0c0f16', background: ACCENT, padding: '2px 6px', borderRadius: 5 }}>ULTIMA</span>}
              </a>
              <div style={{ padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                <div title={it.name} style={{ color: '#cdd3e0', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
                <div style={{ color: '#6b7385', fontSize: 11 }}>{fmtDate(it.uploadedAt)} · {fmtSize(it.size)}</div>
                <button onClick={() => remove(it)} style={{ marginTop: 4, alignSelf: 'flex-start', background: 'rgba(255,92,122,0.12)', color: '#ff5c7a', border: '1px solid rgba(255,92,122,0.25)', borderRadius: 7, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer' }}>Șterge</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
