import { useEffect, useRef, useState } from 'react'
import { generateVault, unlock, encryptItem, decryptMeta, decryptFile, type VaultKeyBlob } from './vaultCryptoClient'

// [VAULT 2026-06-26] Zero-knowledge vault. The private key (after unlock) lives
// ONLY in this component's memory and is cleared on auto-lock / unmount.

type Row = { id: number; category: string; type: string; enc_key: string; meta_iv: string; meta_ct: string; file_iv?: string; size: number; added_by: string; created_at: number }
type Item = { id: number; category: string; type: string; name: string; note?: string; content?: string; fileName?: string; fileIv?: string; aesKey: CryptoKey; size: number; addedBy: string; createdAt: number }

const ACCENT = '#b794ff'
const AUTO_LOCK_MS = 5 * 60 * 1000
const CATS = ['Backups', 'Passwords', 'App', 'Keys', 'Docs', 'Other']

function fmtSize(b: number): string { return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB` }
function fmtDate(ms: number): string { try { return new Date(ms).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' }
const btn = (bg: string): React.CSSProperties => ({ padding: '8px 16px', borderRadius: 9, border: 'none', background: bg, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' })

export function VaultSection() {
  const [hasVault, setHasVault] = useState<boolean | null>(null)
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [locked, setLocked] = useState(true)
  const [items, setItems] = useState<Item[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const privRef = useRef<CryptoKey | null>(null)
  const lockTimer = useRef<number | null>(null)

  // forms
  const [pw1, setPw1] = useState(''); const [pw2, setPw2] = useState(''); const [ack, setAck] = useState(false)
  const [unlockPw, setUnlockPw] = useState('')
  const [naCat, setNaCat] = useState('Passwords'); const [naName, setNaName] = useState(''); const [naNote, setNaNote] = useState(''); const [naContent, setNaContent] = useState('')
  const [nfCat, setNfCat] = useState('Backups'); const [nfName, setNfName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/admin/vault/meta', { credentials: 'same-origin' }).then(r => r.json()).then(d => {
      if (d && d.ok) { setHasVault(!!d.hasVault); setPublicKey(d.publicKey || null) }
    }).catch(() => setError('Nu s-a putut contacta seiful'))
    return () => doLock()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const armLock = () => {
    if (lockTimer.current) window.clearTimeout(lockTimer.current)
    lockTimer.current = window.setTimeout(() => doLock(), AUTO_LOCK_MS)
  }
  const doLock = () => {
    privRef.current = null; setLocked(true); setItems([]); setUnlockPw('')
    if (lockTimer.current) { window.clearTimeout(lockTimer.current); lockTimer.current = null }
  }

  const createVault = async () => {
    setError(null)
    if (pw1.length < 8) return setError('Parola seifului: minim 8 caractere.')
    if (pw1 !== pw2) return setError('Parolele nu se potrivesc.')
    if (!ack) return setError('Confirmă că ai notat parola — fără ea, conținutul e pierdut definitiv.')
    setBusy(true)
    try {
      const blob = await generateVault(pw1)
      const r = await fetch('/api/admin/vault/setup', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Zeus-Request': '1' }, body: JSON.stringify(blob) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`) }
      setPublicKey(blob.publicKey); setHasVault(true); setPw1(''); setPw2(''); setAck(false)
    } catch (e: any) { setError(String(e.message || e)) }
    finally { setBusy(false) }
  }

  const doUnlock = async () => {
    setError(null); setBusy(true)
    try {
      const kr = await fetch('/api/admin/vault/key', { credentials: 'same-origin' })
      if (!kr.ok) throw new Error('Nu s-a putut citi cheia')
      const blob = await kr.json() as VaultKeyBlob & { ok: boolean }
      const priv = await unlock(unlockPw, blob)
      privRef.current = priv; setLocked(false); setUnlockPw(''); armLock()
      await loadItems(priv)
    } catch (e: any) { setError(e.message === 'WRONG_PASSWORD' ? 'Parolă greșită.' : String(e.message || e)) }
    finally { setBusy(false) }
  }

  const loadItems = async (priv: CryptoKey) => {
    const r = await fetch('/api/admin/vault/items', { credentials: 'same-origin' })
    const d = await r.json()
    const rows: Row[] = (d && d.items) || []
    const out: Item[] = []
    for (const row of rows) {
      try {
        const { meta, aesKey } = await decryptMeta(priv, row)
        out.push({ id: row.id, category: row.category, type: row.type, name: meta.name, note: meta.note, content: meta.content, fileName: meta.fileName, fileIv: row.file_iv, aesKey, size: row.size, addedBy: row.added_by, createdAt: row.created_at })
      } catch { /* skip undecryptable row */ }
    }
    setItems(out)
  }

  const addNote = async () => {
    if (!publicKey || !naName.trim()) return setError('Pune un nume.')
    setBusy(true); setError(null); armLock()
    try {
      const type = naContent.startsWith('http') ? 'link' : 'secret'
      const e = await encryptItem(publicKey, naCat, type, { name: naName.trim(), note: naNote.trim(), content: naContent })
      const fd = new FormData()
      fd.append('category', e.category); fd.append('type', e.type); fd.append('encKey', e.encKey); fd.append('metaIv', e.metaIv); fd.append('metaCt', e.metaCt)
      const r = await fetch('/api/admin/vault/items', { method: 'POST', credentials: 'same-origin', headers: { 'X-Zeus-Request': '1' }, body: fd })
      if (!r.ok) throw new Error('Adăugare eșuată')
      setNaName(''); setNaNote(''); setNaContent('')
      if (privRef.current) await loadItems(privRef.current)
    } catch (e: any) { setError(String(e.message || e)) } finally { setBusy(false) }
  }

  const addFile = async () => {
    const f = fileRef.current?.files?.[0]
    if (!publicKey || !f) return setError('Alege un fișier.')
    setBusy(true); setError(null); armLock()
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      const e = await encryptItem(publicKey, nfCat, 'file', { name: nfName.trim() || f.name, fileName: f.name }, bytes)
      const fd = new FormData()
      fd.append('category', e.category); fd.append('type', 'file'); fd.append('encKey', e.encKey); fd.append('metaIv', e.metaIv); fd.append('metaCt', e.metaCt); fd.append('fileIv', e.fileIv!)
      fd.append('file', new Blob([e.fileBlob! as unknown as BlobPart]), 'blob.enc')
      const r = await fetch('/api/admin/vault/items', { method: 'POST', credentials: 'same-origin', headers: { 'X-Zeus-Request': '1' }, body: fd })
      if (!r.ok) throw new Error('Upload eșuat')
      setNfName(''); if (fileRef.current) fileRef.current.value = ''
      if (privRef.current) await loadItems(privRef.current)
    } catch (e: any) { setError(String(e.message || e)) } finally { setBusy(false) }
  }

  const downloadFile = async (it: Item) => {
    setBusy(true); setError(null); armLock()
    try {
      const r = await fetch(`/api/admin/vault/items/${it.id}/file`, { credentials: 'same-origin' })
      if (!r.ok) throw new Error('Download eșuat')
      const encBlob = new Uint8Array(await r.arrayBuffer())
      const plain = await decryptFile(it.aesKey, it.fileIv!, encBlob)
      const url = URL.createObjectURL(new Blob([plain as unknown as BlobPart]))
      const a = document.createElement('a'); a.href = url; a.download = it.fileName || it.name; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch (e: any) { setError(String(e.message || e)) } finally { setBusy(false) }
  }

  const copySecret = (it: Item) => { try { navigator.clipboard.writeText(it.content || '') } catch { /* */ } ; armLock() }

  const del = async (it: Item) => {
    if (!window.confirm(`Ștergi „${it.name}" din seif?`)) return
    armLock()
    try {
      const r = await fetch(`/api/admin/vault/items/${it.id}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Zeus-Request': '1' } })
      if (!r.ok) throw new Error('Ștergere eșuată')
      setItems(prev => prev.filter(x => x.id !== it.id))
    } catch (e: any) { setError(String(e.message || e)) }
  }

  // ── render ──
  const wrap: React.CSSProperties = { maxWidth: 860, margin: '0 auto', padding: '8px 4px 60px' }
  const errBox = error ? <div style={{ padding: 11, borderRadius: 9, background: 'rgba(255,92,122,0.1)', color: '#ff5c7a', fontSize: 13, margin: '10px 0' }}>{error}</div> : null
  const title = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
      <span style={{ fontSize: 20, color: ACCENT }}>{locked ? '🔒' : '🔓'}</span>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: 0 }}>Vault</h1>
    </div>
  )

  if (hasVault === null) return <div style={wrap}>{title}<div style={{ color: '#8a93a8', padding: 24 }}>Se încarcă…</div></div>

  if (!hasVault) return (
    <div style={wrap}>{title}
      <div style={{ color: '#8a93a8', fontSize: 13, marginBottom: 16 }}>Seif zero-knowledge — parola NU pleacă niciodată de pe device-ul tău. Nici contul spart nici serverul spart nu pot citi conținutul.</div>
      {errBox}
      <div style={{ padding: 18, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ color: '#cdd3e0', fontWeight: 700 }}>Creează seiful — setează o parolă de seif (alta decât login-ul)</div>
        <input type="password" placeholder="Parolă seif (min 8)" value={pw1} onChange={e => setPw1(e.target.value)} style={inp} />
        <input type="password" placeholder="Repetă parola" value={pw2} onChange={e => setPw2(e.target.value)} style={inp} />
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: '#ffb454', fontSize: 12.5 }}>
          <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} style={{ marginTop: 2 }} />
          <span>Am notat parola într-un loc sigur (hârtie/extern). <b>Dacă o uit, conținutul e pierdut DEFINITIV</b> — ăsta e prețul securității zero-knowledge.</span>
        </label>
        <button onClick={createVault} disabled={busy} style={btn(ACCENT)}>{busy ? 'Se creează…' : 'Creează seiful'}</button>
      </div>
    </div>
  )

  if (locked) return (
    <div style={wrap}>{title}
      <div style={{ color: '#8a93a8', fontSize: 13, marginBottom: 16 }}>Seiful e încuiat. Introdu parola de seif (doar a ta) ca să-l descui.</div>
      {errBox}
      <div style={{ padding: 18, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
        <input type="password" placeholder="Parolă seif" value={unlockPw} onChange={e => setUnlockPw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doUnlock() }} style={inp} autoFocus />
        <button onClick={doUnlock} disabled={busy} style={btn(ACCENT)}>{busy ? 'Se descuie…' : '🔓 Descuie'}</button>
      </div>
    </div>
  )

  // unlocked
  const byCat: Record<string, Item[]> = {}
  for (const it of items) (byCat[it.category] = byCat[it.category] || []).push(it)
  const cats = Object.keys(byCat).sort()

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {title}
        <button onClick={doLock} style={btn('rgba(255,255,255,0.08)')}>🔒 Încuie</button>
      </div>
      <div style={{ color: '#8a93a8', fontSize: 12.5, marginBottom: 14 }}>Descuiat — se re-încuie singur după 5 min. {items.length} elemente.</div>
      {errBox}

      {/* Add forms */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 22 }}>
        <div style={{ padding: 14, borderRadius: 11, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ color: '#cdd3e0', fontWeight: 700, fontSize: 13 }}>📝 Notă / parolă / link</div>
          <select value={naCat} onChange={e => setNaCat(e.target.value)} style={inp}>{CATS.map(c => <option key={c} value={c}>{c}</option>)}</select>
          <input placeholder="Nume (ex: Parolă Binance)" value={naName} onChange={e => setNaName(e.target.value)} style={inp} />
          <input placeholder="Descriere / ce e (opțional)" value={naNote} onChange={e => setNaNote(e.target.value)} style={inp} />
          <textarea placeholder="Conținut (parola / nota / link)" value={naContent} onChange={e => setNaContent(e.target.value)} style={{ ...inp, minHeight: 56, resize: 'vertical' }} />
          <button onClick={addNote} disabled={busy} style={btn(ACCENT)}>Adaugă</button>
        </div>
        <div style={{ padding: 14, borderRadius: 11, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ color: '#cdd3e0', fontWeight: 700, fontSize: 13 }}>📎 Fișier (poză/doc/pdf/backup)</div>
          <select value={nfCat} onChange={e => setNfCat(e.target.value)} style={inp}>{CATS.map(c => <option key={c} value={c}>{c}</option>)}</select>
          <input placeholder="Nume (opțional)" value={nfName} onChange={e => setNfName(e.target.value)} style={inp} />
          <input ref={fileRef} type="file" style={{ ...inp, padding: 7 }} />
          <div style={{ color: '#5f6678', fontSize: 11 }}>Criptat pe device-ul tău înainte de upload.</div>
          <button onClick={addFile} disabled={busy} style={btn(ACCENT)}>{busy ? 'Se criptează…' : 'Urcă criptat'}</button>
        </div>
      </div>

      {/* Compartments */}
      {cats.length === 0 && <div style={{ color: '#5f6678', textAlign: 'center', padding: 24 }}>Seif gol. Adaugă ceva sus, sau cere-mi mie să-ți pun backup-uri/linkuri.</div>}
      {cats.map(cat => (
        <div key={cat} style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: ACCENT, margin: '0 0 8px', padding: '6px 12px', borderRadius: 9, background: 'rgba(183,148,255,0.12)', borderLeft: `3px solid ${ACCENT}` }}>{cat} <span style={{ color: '#7a8099', fontWeight: 500 }}>· {byCat[cat].length}</span></h2>
          {byCat[cat].map((it, i) => (
            <div key={it.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '9px 12px', margin: '5px 0', borderRadius: 9, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ flex: '0 0 auto', minWidth: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: 'rgba(183,148,255,0.14)', color: ACCENT, fontWeight: 700, fontSize: 12 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#fff', fontSize: 13.5, fontWeight: 600 }}>{it.type === 'file' ? '📎 ' : it.type === 'link' ? '🔗 ' : '🔑 '}{it.name}</div>
                {it.note && <div style={{ color: '#8a93a8', fontSize: 12, marginTop: 2 }}>{it.note}</div>}
                {it.type !== 'file' && it.content && <div style={{ color: '#9fe6c4', fontSize: 12.5, marginTop: 3, fontFamily: 'monospace', wordBreak: 'break-all' }}>{it.content}</div>}
                <div style={{ color: '#5f6678', fontSize: 10.5, marginTop: 3 }}>{it.addedBy === 'assistant' ? 'pus de asistent' : 'al tău'} · {fmtDate(it.createdAt)}{it.type === 'file' ? ` · ${fmtSize(it.size)}` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {it.type === 'file' && <button onClick={() => downloadFile(it)} style={{ ...btn('rgba(79,209,255,0.14)'), color: '#4fd1ff', padding: '4px 10px', fontSize: 11.5 }}>Download</button>}
                {it.type !== 'file' && <button onClick={() => copySecret(it)} style={{ ...btn('rgba(159,230,196,0.12)'), color: '#9fe6c4', padding: '4px 10px', fontSize: 11.5 }}>Copy</button>}
                <button onClick={() => del(it)} style={{ ...btn('rgba(255,92,122,0.12)'), color: '#ff5c7a', padding: '4px 10px', fontSize: 11.5 }}>Șterge</button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
