import { useEffect, useState } from 'react'

// ─── "Book of All" — operator's personal monitor ───
// Read-only render of docs/BOOK_OF_ALL.md (maintained by the assistant).
// A tiny line-based markdown renderer for a CONTROLLED input subset (headings,
// blockquote, numbered/bullet lists, **bold**/*italic*/`code`, hr). No external
// markdown dependency — the input format is ours, so a small renderer is safe.

type Accent = { color: string; glow: string }
const ACCENTS: Record<string, Accent> = {
  bug: { color: '#ff5c7a', glow: 'rgba(255,92,122,0.16)' },
  monitor: { color: '#ffb454', glow: 'rgba(255,180,84,0.14)' },
  plan: { color: '#4fd1ff', glow: 'rgba(79,209,255,0.14)' },
  default: { color: '#b794ff', glow: 'rgba(183,148,255,0.14)' },
}

function accentFor(heading: string): Accent {
  const h = heading.toUpperCase()
  if (h.includes('BUG')) return ACCENTS.bug
  if (h.includes('MONITORING') || h.includes('MAKE') || h.includes('TO MAKE')) return ACCENTS.monitor
  if (h.includes('PLAN')) return ACCENTS.plan
  return ACCENTS.default
}

function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-${i}`} style={{ color: '#fff', fontWeight: 700 }}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('`')) {
      nodes.push(<code key={`${keyPrefix}-${i}`} style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4, fontSize: '0.88em', color: '#9fe6c4' }}>{tok.slice(1, -1)}</code>)
    } else {
      nodes.push(<em key={`${keyPrefix}-${i}`} style={{ color: '#8a93a8' }}>{tok.slice(1, -1)}</em>)
    }
    last = m.index + tok.length
    i++
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.split('\n')
  const out: React.ReactNode[] = []
  let accent = ACCENTS.default
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\s+$/, '')
    const key = `l${idx}`
    if (!line.trim()) { out.push(<div key={key} style={{ height: 8 }} />); return }
    if (line === '---') { out.push(<hr key={key} style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '18px 0' }} />); return }
    if (line.startsWith('# ')) {
      out.push(<h1 key={key} style={{ fontSize: 26, fontWeight: 800, color: '#fff', margin: '0 0 4px', letterSpacing: '-0.02em' }}>{parseInline(line.slice(2), key)}</h1>)
      return
    }
    if (line.startsWith('## ')) {
      accent = accentFor(line)
      out.push(
        <h2 key={key} style={{ fontSize: 17, fontWeight: 700, color: accent.color, margin: '22px 0 12px', padding: '8px 14px', borderRadius: 10, background: accent.glow, borderLeft: `3px solid ${accent.color}` }}>
          {parseInline(line.slice(3), key)}
        </h2>
      )
      return
    }
    if (line.startsWith('### ')) {
      out.push(<h3 key={key} style={{ fontSize: 14, fontWeight: 700, color: '#cdd3e0', margin: '14px 0 6px' }}>{parseInline(line.slice(4), key)}</h3>)
      return
    }
    if (line.startsWith('> ')) {
      out.push(<div key={key} style={{ color: '#8a93a8', fontSize: 13, lineHeight: 1.5, padding: '4px 0 4px 12px', borderLeft: '2px solid rgba(255,255,255,0.1)', margin: '2px 0' }}>{parseInline(line.slice(2), key)}</div>)
      return
    }
    const numbered = line.match(/^(\d+)\.\s+(.*)/)
    if (numbered) {
      out.push(
        <div key={key} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '9px 12px', margin: '6px 0', borderRadius: 10, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <span style={{ flex: '0 0 auto', minWidth: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, background: accent.glow, color: accent.color, fontWeight: 700, fontSize: 12.5 }}>{numbered[1]}</span>
          <span style={{ color: '#c4cad8', fontSize: 13.5, lineHeight: 1.55, paddingTop: 1 }}>{parseInline(numbered[2], key)}</span>
        </div>
      )
      return
    }
    if (line.startsWith('- ')) {
      out.push(
        <div key={key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '3px 0 3px 16px' }}>
          <span style={{ flex: '0 0 auto', marginTop: 7, width: 5, height: 5, borderRadius: '50%', background: accent.color }} />
          <span style={{ color: '#aeb4c2', fontSize: 13, lineHeight: 1.55 }}>{parseInline(line.slice(2), key)}</span>
        </div>
      )
      return
    }
    out.push(<p key={key} style={{ color: '#aeb4c2', fontSize: 13.5, lineHeight: 1.6, margin: '6px 0' }}>{parseInline(line, key)}</p>)
  })
  return out
}

export function BookSection() {
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/admin/book', { credentials: 'same-origin' })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d) => { if (!alive) return; setMarkdown(d.markdown || ''); setUpdatedAt(d.updatedAt || null) })
      .catch((e) => { if (alive) setError(String(e.message || e)) })
    return () => { alive = false }
  }, [])

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '8px 4px 60px' }}>
      {error && (
        <div style={{ padding: 16, borderRadius: 10, background: 'rgba(255,92,122,0.1)', color: '#ff5c7a', fontSize: 13 }}>
          Nu s-a putut încărca cartea: {error}
        </div>
      )}
      {!error && markdown === null && (
        <div style={{ padding: 30, textAlign: 'center', color: '#8a93a8', fontSize: 13 }}>Se încarcă cartea…</div>
      )}
      {!error && markdown !== null && (
        <>
          {renderMarkdown(markdown)}
          {updatedAt && (
            <div style={{ marginTop: 24, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)', color: '#5f6678', fontSize: 11.5, textAlign: 'right' }}>
              fișier actualizat: {new Date(updatedAt).toLocaleString('ro-RO')}
            </div>
          )}
        </>
      )}
    </div>
  )
}
