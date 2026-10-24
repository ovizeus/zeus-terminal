import { useEffect, useState } from 'react'
import { renderMarkdown } from '../bookRender'

// ─── "Book of All" — monitorul personal al operatorului ───
// [2026-10-24] Cartea are coşuri pe disc (`docs/book/`, generate de
// `scripts/book-split.py`). El o citeşte de pe telefon, DIN APLICAŢIE, deci
// coşurile trebuie să ajungă aici, altfel pentru el nu există: „pai intru in
// book si e la fel".
//
// Intrarea e START.md. De acolo: un coş → o secţiune. Cartea întreagă rămâne
// la un buton distanţă, şi e tot ce se arată dacă folderele lipsesc de pe disc.

type Item = { file: string; title: string; date: string | null }
type Cat = { id: string; title: string; desc: string | null; count: number; items: Item[] }
type Tree = { start: string | null; cats: Cat[]; updatedAt: string | null }

const CAT_ICONS: Record<string, string> = {
  '1-DE-FACUT': '🔧',
  '2-DECIZII-ALE-TALE': '🙋',
  '3-IN-COLECTARE': '🔭',
  '4-LIVRATE': '✅',
  '5-MASURATORI': '📏',
  '6-RETRACTARI': '⛔',
  '7-INCIDENTE': '🚨',
  '8-REGULI': '📜',
  '9-ARHIVA': '🗄️',
}

const CARD: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
  padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.07)', color: 'inherit', font: 'inherit',
}

function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 14px' }}>{children}</div>
  )
}

function Btn({ onClick, children, accent }: { onClick: () => void; children: React.ReactNode; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 13px', borderRadius: 9, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
        background: accent ? 'rgba(183,148,255,0.14)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${accent ? 'rgba(183,148,255,0.4)' : 'rgba(255,255,255,0.1)'}`,
        color: accent ? '#b794ff' : '#aeb4c2',
      }}
    >
      {children}
    </button>
  )
}

export function BookSection() {
  const [tree, setTree] = useState<Tree | null>(null)
  const [full, setFull] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<{ cat?: Cat; item?: Item; all?: boolean }>({})
  const [section, setSection] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/admin/book/tree', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (alive && d && Array.isArray(d.cats) && d.cats.length) setTree(d) })
      .catch(() => { /* fără coşuri pe disc — rămâne cartea întreagă, de mai jos */ })
      .finally(() => {
        if (!alive) return
        fetch('/api/admin/book', { credentials: 'same-origin' })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then((d) => { if (alive) setFull(d.markdown || '') })
          .catch((e) => { if (alive) setError(String(e.message || e)) })
      })
    return () => { alive = false }
  }, [])

  function openItem(cat: Cat, item: Item) {
    setSection(null)
    setView({ cat, item })
    const q = `cat=${encodeURIComponent(cat.id)}&file=${encodeURIComponent(item.file)}`
    fetch(`/api/admin/book/section?${q}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setSection(d.markdown || ''))
      .catch((e) => setSection(`## Nu s-a putut citi secţiunea\n\n${String(e.message || e)}`))
  }

  const wrap: React.CSSProperties = { maxWidth: 860, margin: '0 auto', padding: '8px 4px 60px' }

  if (error && !tree && full === null) {
    return (
      <div style={wrap}>
        <div style={{ padding: 16, borderRadius: 10, background: 'rgba(255,92,122,0.1)', color: '#ff5c7a', fontSize: 13 }}>
          Nu s-a putut încărca cartea: {error}
        </div>
      </div>
    )
  }

  if (!tree && full === null) {
    return <div style={wrap}><div style={{ padding: 30, textAlign: 'center', color: '#8a93a8', fontSize: 13 }}>Se încarcă cartea…</div></div>
  }

  // ── o secţiune ──
  if (view.item && view.cat) {
    return (
      <div style={wrap}>
        <Bar>
          <Btn onClick={() => { setView({ cat: view.cat }); setSection(null) }}>← {view.cat.id}</Btn>
          <Btn onClick={() => { setView({}); setSection(null) }}>🧭 START</Btn>
        </Bar>
        {section === null
          ? <div style={{ padding: 24, textAlign: 'center', color: '#8a93a8', fontSize: 13 }}>Se încarcă…</div>
          : renderMarkdown(section)}
      </div>
    )
  }

  // ── un coş ──
  if (view.cat) {
    return (
      <div style={wrap}>
        <Bar><Btn onClick={() => setView({})}>← 🧭 START</Btn></Bar>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: '0 0 4px' }}>
          {CAT_ICONS[view.cat.id] || '•'} {view.cat.title}
        </h1>
        {view.cat.desc && <p style={{ color: '#8a93a8', fontSize: 13, margin: '0 0 14px' }}>{view.cat.desc}</p>}
        <div style={{ display: 'grid', gap: 8 }}>
          {view.cat.items.map((it) => (
            <button key={it.file} style={CARD} onClick={() => openItem(view.cat as Cat, it)}>
              {it.date && <span style={{ color: '#5f6678', fontSize: 11, display: 'block', marginBottom: 3 }}>{it.date}</span>}
              <span style={{ color: '#c4cad8', fontSize: 13.5, lineHeight: 1.45 }}>{it.title}</span>
            </button>
          ))}
          {!view.cat.items.length && <div style={{ color: '#5f6678', fontSize: 13 }}>Gol.</div>}
        </div>
      </div>
    )
  }

  // ── cartea întreagă ──
  if (view.all || !tree) {
    return (
      <div style={wrap}>
        {tree && <Bar><Btn onClick={() => setView({})}>← 🧭 START</Btn></Bar>}
        {full !== null ? renderMarkdown(full) : <div style={{ color: '#8a93a8', fontSize: 13 }}>Se încarcă…</div>}
      </div>
    )
  }

  // ── intrarea: START.md + coşurile ──
  return (
    <div style={wrap}>
      {tree.start ? renderMarkdown(tree.start) : null}
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#b794ff', margin: '22px 0 12px', padding: '8px 14px', borderRadius: 10, background: 'rgba(183,148,255,0.14)', borderLeft: '3px solid #b794ff' }}>
        🗂️ Coşurile
      </h2>
      <div style={{ display: 'grid', gap: 8 }}>
        {tree.cats.map((c) => (
          <button key={c.id} style={CARD} onClick={() => setView({ cat: c })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 17 }}>{CAT_ICONS[c.id] || '•'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ color: '#fff', fontSize: 13.5, fontWeight: 700, display: 'block' }}>{c.title}</span>
                {c.desc && <span style={{ color: '#8a93a8', fontSize: 11.5, lineHeight: 1.4, display: 'block', marginTop: 2 }}>{c.desc}</span>}
              </span>
              <span style={{ flex: '0 0 auto', minWidth: 26, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, background: 'rgba(183,148,255,0.14)', color: '#b794ff', fontWeight: 700, fontSize: 12 }}>{c.count}</span>
            </div>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        <Btn onClick={() => setView({ all: true })} accent>📖 Cartea întreagă, în ordine cronologică</Btn>
      </div>
      {tree.updatedAt && (
        <div style={{ marginTop: 24, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)', color: '#5f6678', fontSize: 11.5, textAlign: 'right' }}>
          fişier actualizat: {new Date(tree.updatedAt).toLocaleString('ro-RO')}
        </div>
      )}
    </div>
  )
}
