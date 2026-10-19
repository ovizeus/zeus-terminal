import { useEffect, useRef, useState } from 'react'

// ─── Backup Zeus — operator-triggered, encrypted, downloadable once.
// The passphrase is typed here, used server-side in memory to derive the key,
// and never stored. Nobody — including the server — can decrypt the file later
// without it, so the UI says that plainly instead of implying a recovery path.
// Verified state is shown explicitly: on 2026-10-18 four nightly backups looked
// perfectly healthy in a listing and were all malformed.

type Item = {
  id: string; createdAt: number; size: number; verified: boolean
  sha256: string | null; dbBytes: number | null; note: string | null
}
type Job = { startedAt: number; state: 'running' | 'done' | 'failed'; error: string | null; id: string | null } | null

const ACCENT = '#4fd1ff'
const DANGER = '#ff5c7a'
const OK = '#3ddc97'

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}
function fmtDate(ms: number): string {
  try { return new Date(ms).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

export function BackupSection() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [job, setJob] = useState<Job>(null)
  const [error, setError] = useState<string | null>(null)
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)

  const load = () => {
    fetch('/api/admin/backups', { credentials: 'same-origin' })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d) => { setItems(d.items || []); setJob(d.job || null); setError(null) })
      .catch((e) => setError(String(e.message || e)))
  }
  useEffect(load, [])

  // Poll only while a backup is actually running — a 3 GB snapshot takes minutes.
  useEffect(() => {
    if (job && job.state === 'running') {
      if (pollRef.current == null) pollRef.current = window.setInterval(load, 3000)
    } else if (pollRef.current != null) {
      window.clearInterval(pollRef.current); pollRef.current = null
    }
    return () => { if (pollRef.current != null) { window.clearInterval(pollRef.current); pollRef.current = null } }
  }, [job && job.state])

  const create = async () => {
    if (pass.length < 8) { setError('Parola trebuie să aibă minimum 8 caractere.'); return }
    if (pass !== pass2) { setError('Cele două parole nu coincid.'); return }
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/admin/backups', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' },
        body: JSON.stringify({ passphrase: pass, note: note || null }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setPass(''); setPass2(''); setNote('')
      load()
    } catch (e: any) { setError(String(e.message || e)) } finally { setBusy(false) }
  }

  // Two steps on purpose: mint a single-use 5-minute token, then hand the
  // browser a URL that stops working the moment it is used.
  const download = async (it: Item) => {
    setError(null)
    try {
      const r = await fetch(`/api/admin/backups/${encodeURIComponent(it.id)}/token`, {
        method: 'POST', credentials: 'same-origin', headers: { 'X-Zeus-Request': '1' },
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.token) throw new Error(j.error || `HTTP ${r.status}`)
      window.location.href = `/api/admin/backups/${encodeURIComponent(it.id)}/download?t=${encodeURIComponent(j.token)}`
    } catch (e: any) { setError(String(e.message || e)) }
  }

  const remove = async (it: Item) => {
    setError(null)
    try {
      const r = await fetch(`/api/admin/backups/${encodeURIComponent(it.id)}`, {
        method: 'DELETE', credentials: 'same-origin', headers: { 'X-Zeus-Request': '1' },
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`) }
      setConfirmDel(null); load()
    } catch (e: any) { setError(String(e.message || e)) }
  }

  const running = !!(job && job.state === 'running')

  return (
    <div style={{ padding: '26px 28px', maxWidth: 1000 }}>
      <div style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#e8ecf4' }}>Backup Zeus</h2>
        <div style={{ color: '#8a93a8', fontSize: 13, marginTop: 4 }}>
          Copie completă a bazei, criptată cu parola ta. Verificată înainte de a-ți fi oferită.
        </div>
      </div>

      {/* The one thing that must not be misunderstood. */}
      <div style={{ margin: '18px 0', padding: '12px 14px', borderRadius: 10, background: 'rgba(255,92,122,0.08)', border: `1px solid rgba(255,92,122,0.25)` }}>
        <div style={{ color: DANGER, fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Parola nu se poate recupera</div>
        <div style={{ color: '#cdd3e0', fontSize: 12.5, lineHeight: 1.55 }}>
          Cheia se derivă din parolă în memorie și nu se salvează nicăieri. Dacă o uiți, fișierul e
          pierdut definitiv — nici serverul nu îl mai poate deschide. Fișierul conține cheile de
          exchange, hash-urile de parole și datele tuturor utilizatorilor: ține-l ca pe un seif.
        </div>
      </div>

      {/* Create */}
      <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 18, marginBottom: 22, background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <input type="password" autoComplete="new-password" placeholder="Parolă (min. 8 caractere)" value={pass}
            onChange={(e) => setPass(e.target.value)} disabled={running}
            style={{ padding: '10px 12px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', background: '#0c0f16', color: '#e8ecf4', fontSize: 13.5 }} />
          <input type="password" autoComplete="new-password" placeholder="Confirmă parola" value={pass2}
            onChange={(e) => setPass2(e.target.value)} disabled={running}
            style={{ padding: '10px 12px', borderRadius: 9, border: `1px solid ${pass2 && pass !== pass2 ? DANGER : 'rgba(255,255,255,0.12)'}`, background: '#0c0f16', color: '#e8ecf4', fontSize: 13.5 }} />
        </div>
        <input type="text" placeholder="Notă (opțional) — ex. „înainte de migrare”" value={note} maxLength={200}
          onChange={(e) => setNote(e.target.value)} disabled={running}
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', background: '#0c0f16', color: '#e8ecf4', fontSize: 13.5, marginBottom: 12 }} />
        <button onClick={create} disabled={busy || running}
          style={{ padding: '11px 20px', borderRadius: 10, border: 'none', cursor: busy || running ? 'default' : 'pointer', background: busy || running ? 'rgba(255,255,255,0.08)' : ACCENT, color: busy || running ? '#8a93a8' : '#061018', fontSize: 13.5, fontWeight: 700 }}>
          {running ? 'Backup în curs…' : busy ? 'Se pornește…' : 'Creează backup complet'}
        </button>
        {running && (
          <span style={{ marginLeft: 12, color: '#8a93a8', fontSize: 12.5 }}>
            durează câteva minute — poți naviga, se face în fundal
          </span>
        )}
      </div>

      {job && job.state === 'failed' && job.error && (
        <div style={{ padding: 12, borderRadius: 10, background: 'rgba(255,92,122,0.1)', color: DANGER, fontSize: 13, marginBottom: 16 }}>
          Ultimul backup a eșuat: {job.error}
        </div>
      )}
      {error && <div style={{ padding: 12, borderRadius: 10, background: 'rgba(255,92,122,0.1)', color: DANGER, fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {items === null && !error && <div style={{ padding: 24, textAlign: 'center', color: '#8a93a8', fontSize: 13 }}>Se încarcă…</div>}
      {items !== null && items.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: '#5f6678', fontSize: 13 }}>Niciun backup încă.</div>
      )}

      {items !== null && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((it) => (
            <div key={it.id} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 16px', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <div style={{ color: '#e8ecf4', fontSize: 13.5, fontWeight: 600 }}>{fmtDate(it.createdAt)}</div>
                  <div style={{ color: '#5f6678', fontSize: 11.5, marginTop: 3, wordBreak: 'break-all' }}>{it.id}</div>
                  {it.note && <div style={{ color: '#8a93a8', fontSize: 12, marginTop: 4, fontStyle: 'italic' }}>{it.note}</div>}
                </div>
                <div style={{ color: '#cdd3e0', fontSize: 12.5, whiteSpace: 'nowrap' }}>
                  {fmtSize(it.size)}
                  {it.dbBytes ? <span style={{ color: '#5f6678' }}> &nbsp;(bază {fmtSize(it.dbBytes)})</span> : null}
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 700, padding: '4px 9px', borderRadius: 999, whiteSpace: 'nowrap',
                  color: it.verified ? OK : DANGER,
                  background: it.verified ? 'rgba(61,220,151,0.12)' : 'rgba(255,92,122,0.12)' }}>
                  {it.verified ? '✓ verificat' : '✕ neverificat'}
                </div>
                <button onClick={() => download(it)} disabled={!it.verified}
                  title={it.verified ? 'Link de unică folosință, valabil 5 minute' : 'Un backup neverificat nu se oferă la download'}
                  style={{ padding: '8px 14px', borderRadius: 9, border: `1px solid ${it.verified ? ACCENT : 'rgba(255,255,255,0.12)'}`, cursor: it.verified ? 'pointer' : 'default', background: 'transparent', color: it.verified ? ACCENT : '#5f6678', fontSize: 12.5, fontWeight: 600 }}>
                  Descarcă
                </button>
                {confirmDel === it.id ? (
                  <>
                    <button onClick={() => remove(it)} style={{ padding: '8px 12px', borderRadius: 9, border: 'none', cursor: 'pointer', background: DANGER, color: '#fff', fontSize: 12.5, fontWeight: 700 }}>Confirmă</button>
                    <button onClick={() => setConfirmDel(null)} style={{ padding: '8px 12px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', background: 'transparent', color: '#8a93a8', fontSize: 12.5 }}>Anulează</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmDel(it.id)} style={{ padding: '8px 12px', borderRadius: 9, border: '1px solid rgba(255,92,122,0.35)', cursor: 'pointer', background: 'transparent', color: DANGER, fontSize: 12.5, fontWeight: 600 }}>Șterge</button>
                )}
              </div>
              {it.sha256 && (
                <div style={{ color: '#4a5162', fontSize: 10.5, marginTop: 8, wordBreak: 'break-all', fontFamily: 'monospace' }}>
                  sha256 {it.sha256}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 22, color: '#5f6678', fontSize: 12, lineHeight: 1.6 }}>
        Decriptare oriunde, fără Zeus: <code style={{ color: '#8a93a8' }}>node decrypt-zeus-backup.js &lt;fișier&gt; restored.db</code>{' '}
        (scriptul e în <code style={{ color: '#8a93a8' }}>scripts/decrypt-zeus-backup.js</code> — ține o copie lângă backup-uri).
      </div>
    </div>
  )
}
