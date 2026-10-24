import type { Block, Inline } from './bookParse'
import { parseBlocks, parseInlineTokens } from './bookParse'

// ─── Book of All — randarea blocurilor ───
// Parsarea stă în `bookParse.ts` (pură, testată). Aici e doar aspectul.
// Telefonul e ecranul real: tabelele primesc derulare proprie pe orizontală,
// ca să nu împingă pagina în lateral.

export type Accent = { color: string; glow: string }
const ACCENTS: Record<string, Accent> = {
  bug: { color: '#ff5c7a', glow: 'rgba(255,92,122,0.16)' },
  monitor: { color: '#ffb454', glow: 'rgba(255,180,84,0.14)' },
  plan: { color: '#4fd1ff', glow: 'rgba(79,209,255,0.14)' },
  default: { color: '#b794ff', glow: 'rgba(183,148,255,0.14)' },
}

export function accentFor(heading: string): Accent {
  const h = heading.toUpperCase()
  if (h.includes('BUG')) return ACCENTS.bug
  if (h.includes('MONITORING') || h.includes('MAKE') || h.includes('TO MAKE')) return ACCENTS.monitor
  if (h.includes('PLAN')) return ACCENTS.plan
  return ACCENTS.default
}

function inlineNodes(text: string, key: string): React.ReactNode[] {
  return parseInlineTokens(text).map((t: Inline, i) => {
    const k = `${key}-${i}`
    switch (t.kind) {
      case 'bold':
        return <strong key={k} style={{ color: '#fff', fontWeight: 700 }}>{t.text}</strong>
      case 'em':
        return <em key={k} style={{ color: '#8a93a8' }}>{t.text}</em>
      case 'code':
        return <code key={k} style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4, fontSize: '0.88em', color: '#9fe6c4', wordBreak: 'break-word' }}>{t.text}</code>
      case 'link':
        // o ţintă relativă (`book/START.md`) nu duce nicăieri din aplicaţie:
        // se arată eticheta, nu markup-ul brut, şi nu se preface că e de apăsat
        return t.external
          ? <a key={k} href={t.href} target="_blank" rel="noreferrer" style={{ color: '#4fd1ff', textDecoration: 'underline' }}>{t.text}</a>
          : <span key={k} style={{ color: '#9fe6c4' }}>{t.text}</span>
      default:
        return <span key={k}>{t.text}</span>
    }
  })
}

function renderBlock(b: Block, key: string, accentRef: { cur: Accent }): React.ReactNode {
  switch (b.kind) {
    case 'h': {
      if (b.level === 1) {
        return <h1 key={key} style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: '0 0 4px', letterSpacing: '-0.02em' }}>{inlineNodes(b.text, key)}</h1>
      }
      if (b.level === 2) {
        accentRef.cur = accentFor(b.text)
        const a = accentRef.cur
        return (
          <h2 key={key} style={{ fontSize: 16, fontWeight: 700, color: a.color, margin: '22px 0 12px', padding: '8px 14px', borderRadius: 10, background: a.glow, borderLeft: `3px solid ${a.color}` }}>
            {inlineNodes(b.text, key)}
          </h2>
        )
      }
      return <h3 key={key} style={{ fontSize: 14, fontWeight: 700, color: '#cdd3e0', margin: '14px 0 6px' }}>{inlineNodes(b.text, key)}</h3>
    }
    case 'hr':
      return <hr key={key} style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '18px 0' }} />
    case 'li':
      return (
        <div key={key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '3px 0 3px 12px' }}>
          <span style={{ flex: '0 0 auto', marginTop: 7, width: 5, height: 5, borderRadius: '50%', background: accentRef.cur.color }} />
          <span style={{ color: '#aeb4c2', fontSize: 13, lineHeight: 1.55 }}>{inlineNodes(b.text, key)}</span>
        </div>
      )
    case 'oli':
      return (
        <div key={key} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '9px 12px', margin: '6px 0', borderRadius: 10, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <span style={{ flex: '0 0 auto', minWidth: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, background: accentRef.cur.glow, color: accentRef.cur.color, fontWeight: 700, fontSize: 12.5 }}>{b.n}</span>
          <span style={{ color: '#c4cad8', fontSize: 13.5, lineHeight: 1.55, paddingTop: 1 }}>{inlineNodes(b.text, key)}</span>
        </div>
      )
    case 'code':
      return (
        <pre key={key} style={{ margin: '10px 0', padding: '12px 14px', borderRadius: 10, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.07)', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <code style={{ color: '#9fe6c4', fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{b.text}</code>
        </pre>
      )
    case 'table':
      return (
        <div key={key} style={{ margin: '10px 0', overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: Math.max(260, b.head.length * 110) }}>
            <thead>
              <tr>
                {b.head.map((h, c) => (
                  <th key={c} style={{ textAlign: 'left', padding: '8px 10px', background: 'rgba(255,255,255,0.05)', color: '#cdd3e0', fontSize: 12, fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' }}>{inlineNodes(h, `${key}-h${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri} style={{ background: ri % 2 ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
                  {r.map((cell, ci) => (
                    <td key={ci} style={{ padding: '8px 10px', color: '#aeb4c2', fontSize: 12.5, lineHeight: 1.5, verticalAlign: 'top', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{inlineNodes(cell, `${key}-${ri}-${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'quote':
      return (
        <div key={key} style={{ padding: '4px 0 4px 12px', borderLeft: '2px solid rgba(255,255,255,0.1)', margin: '6px 0' }}>
          {b.blocks.map((inner, i) => renderBlock(inner, `${key}-q${i}`, accentRef))}
        </div>
      )
    default:
      return <p key={key} style={{ color: '#aeb4c2', fontSize: 13.5, lineHeight: 1.6, margin: '6px 0' }}>{inlineNodes((b as any).text, key)}</p>
  }
}

export function renderMarkdown(md: string): React.ReactNode[] {
  const accentRef = { cur: ACCENTS.default }
  return parseBlocks(md).map((b, i) => renderBlock(b, `b${i}`, accentRef))
}
