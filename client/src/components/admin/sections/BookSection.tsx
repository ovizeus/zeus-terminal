import { useEffect, useState } from 'react'
import { renderMarkdown } from '../bookRender'
import { plainText } from '../bookParse'

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

const CAT_TINTS: Record<string, string> = {
  '1-DE-FACUT': '#4fd1ff',
  '2-DECIZII-ALE-TALE': '#ffb454',
  '3-IN-COLECTARE': '#9fe6c4',
  '4-LIVRATE': '#5fd38d',
  '5-MASURATORI': '#b794ff',
  '6-RETRACTARI': '#ff5c7a',
  '7-INCIDENTE': '#ff5c7a',
  '8-REGULI': '#cdd3e0',
  '9-ARHIVA': '#8a93a8',
}

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

// Placuta de folder: pictograma mare + titlu + numarul de secţiuni.
// Intrarea in carte e DOAR grila asta — se reperează din ochi, nu se citeşte.
const TILE: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 6, cursor: 'pointer', textAlign: 'center', padding: '16px 8px 14px',
  borderRadius: 14, background: 'rgba(255,255,255,0.035)',
  border: '1px solid rgba(255,255,255,0.08)', color: 'inherit', font: 'inherit',
  minHeight: 104, position: 'relative',
}

function Tile({ icon, title, count, tint, onClick }: {
  icon: string; title: string; count?: number; tint?: string; onClick: () => void
}) {
  const c = tint || '#b794ff'
  return (
    <button style={TILE} onClick={onClick}>
      <span style={{ fontSize: 28, lineHeight: 1 }}>{icon}</span>
      <span style={{ color: '#cdd3e0', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.02em', lineHeight: 1.25 }}>{title}</span>
      {typeof count === 'number' && (
        <span style={{ position: 'absolute', top: 8, right: 8, minWidth: 20, height: 18, padding: '0 5px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7,
          background: `${c}22`, color: c, fontWeight: 700, fontSize: 11 }}>{count}</span>
      )}
    </button>
  )
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
  const [view, setView] = useState<{ cat?: Cat; item?: Item; all?: boolean; start?: boolean }>({})
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

  // ── START: starea de acum ──
  if (view.start) {
    return (
      <div style={wrap}>
        <Bar><Btn onClick={() => setView({})}>← 🗂️ Foldere</Btn></Bar>
        {tree && tree.start ? renderMarkdown(tree.start) : <div style={{ color: '#8a93a8', fontSize: 13 }}>Fără START.md pe disc.</div>}
      </div>
    )
  }

  // ── o secţiune ──
  if (view.item && view.cat) {
    return (
      <div style={wrap}>
        <Bar>
          <Btn onClick={() => { setView({ cat: view.cat }); setSection(null) }}>← {view.cat.id}</Btn>
          <Btn onClick={() => { setView({}); setSection(null) }}>🗂️ Foldere</Btn>
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
        <Bar><Btn onClick={() => setView({})}>← 🗂️ Foldere</Btn></Bar>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: '0 0 4px' }}>
          {CAT_ICONS[view.cat.id] || '•'} {view.cat.title}
        </h1>
        {view.cat.desc && <p style={{ color: '#8a93a8', fontSize: 13, margin: '0 0 14px' }}>{view.cat.desc}</p>}
        <div style={{ display: 'grid', gap: 8 }}>
          {view.cat.items.map((it) => (
            <button key={it.file} style={CARD} onClick={() => openItem(view.cat as Cat, it)}>
              {it.date && <span style={{ color: '#5f6678', fontSize: 11, display: 'block', marginBottom: 3 }}>{it.date}</span>}
              <span style={{ color: '#c4cad8', fontSize: 13.5, lineHeight: 1.45 }}>{plainText(it.title)}</span>
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
        {tree && <Bar><Btn onClick={() => setView({})}>← 🗂️ Foldere</Btn></Bar>}
        {full !== null ? renderMarkdown(full) : <div style={{ color: '#8a93a8', fontSize: 13 }}>Se încarcă…</div>}
      </div>
    )
  }

  // ── intrarea: DOAR folderele ──
  // El a cerut-o explicit: „cand intru sa vad doar folderele si cand intru in
  // folder sa vad continutul, asa le reperez mai repede". Deci nimic de citit
  // aici: pictograma, titlu, cat e inauntru.
  return (
    <div style={wrap}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 10 }}>
        <Tile icon="🧭" title="START" tint="#4fd1ff" onClick={() => setView({ start: true })} />
        {tree.cats.map((c) => (
          <Tile
            key={c.id}
            icon={CAT_ICONS[c.id] || '📁'}
            title={c.title}
            count={c.count}
            tint={CAT_TINTS[c.id]}
            onClick={() => setView({ cat: c })}
          />
        ))}
        <Tile icon="📖" title="CARTEA ÎNTREAGĂ" tint="#8a93a8" onClick={() => setView({ all: true })} />
      </div>
      {tree.updatedAt && (
        <div style={{ marginTop: 20, color: '#5f6678', fontSize: 11.5, textAlign: 'right' }}>
          actualizat: {new Date(tree.updatedAt).toLocaleString('ro-RO')}
        </div>
      )}
    </div>
  )
}
