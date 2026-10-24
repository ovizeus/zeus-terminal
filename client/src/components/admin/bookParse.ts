// ─── Book of All — parser de markdown, fără React ───
// Intrarea e `docs/BOOK_OF_ALL.md`, scris de asistent, deci un subset CONTROLAT.
// Separat de randare ca să poată fi testat pe blocuri, nu pe pixeli.
//
// [2026-10-24] Rescris după capturile operatorului: randorul vechi nu cunoştea
// nici tabele, nici blocuri de cod, nici legături. Cartea e plină de toate trei,
// deci pe telefon ieşeau rânduri de `|` şi de `|---|---|` peste tot.

export type Block =
  | { kind: 'h'; level: 1 | 2 | 3; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'li'; text: string }
  | { kind: 'oli'; n: string; text: string }
  | { kind: 'hr' }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'quote'; blocks: Block[] }

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string; external: boolean }

const FENCE = /^```(.*)$/
const TABLE_ROW = /^\|(.*)\|\s*$/
// separatorul poate purta aliniere: |---| |:---| |---:| |:---:|
const TABLE_SEP = /^\|(\s*:?-{3,}:?\s*\|)+\s*$/

/** `| a | b |` → ['a','b'] — pastreaza celulele goale, cartea are tabele cu prima coloana fara titlu */
function cells(line: string): string[] {
  const m = line.match(TABLE_ROW)
  if (!m) return []
  return m[1].split('|').map((c) => c.trim())
}

export function parseBlocks(md: string): Block[] {
  const lines = String(md ?? '').split('\n')
  const out: Block[] = []
  let i = 0

  while (i < lines.length) {
    const raw = lines[i].replace(/\s+$/, '')
    const line = raw.trim()

    // bloc de cod — tot ce e inauntru e text brut, NU se mai parseaza
    const fence = raw.match(FENCE)
    if (fence) {
      const lang = fence[1].trim()
      const body: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i].replace(/\s+$/, ''))) {
        body.push(lines[i])
        i++
      }
      i++ // sare peste ``` de inchidere (sau peste capat, daca blocul n-a fost inchis)
      while (body.length && !body[body.length - 1].trim()) body.pop() // randuri goale la coada
      out.push({ kind: 'code', lang, text: body.join('\n') })
      continue
    }

    // tabel — doar daca randul urmator e separator; altfel un `|` ramane text
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1].trim())) {
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && TABLE_ROW.test(lines[i].trim())) {
        const r = cells(lines[i].trim())
        // un rand mai scurt nu trebuie sa stramte tabelul
        while (r.length < head.length) r.push('')
        rows.push(r.slice(0, Math.max(head.length, r.length)))
        i++
      }
      out.push({ kind: 'table', head, rows })
      continue
    }

    // citat — se aduna randurile `>` si se re-parseaza continutul
    if (line === '>' || line.startsWith('> ')) {
      const inner: string[] = []
      while (i < lines.length) {
        const l = lines[i].replace(/\s+$/, '')
        const t = l.trim()
        if (t === '>') { inner.push(''); i++; continue }       // `>` singur = rand gol, nu un caracter pe ecran
        if (t.startsWith('> ')) { inner.push(t.slice(2)); i++; continue }
        break
      }
      out.push({ kind: 'quote', blocks: parseBlocks(inner.join('\n')) })
      continue
    }

    i++

    if (!line) continue
    if (/^-{3,}$/.test(line)) { out.push({ kind: 'hr' }); continue }
    if (line.startsWith('### ')) { out.push({ kind: 'h', level: 3, text: line.slice(4) }); continue }
    if (line.startsWith('## ')) { out.push({ kind: 'h', level: 2, text: line.slice(3) }); continue }
    if (line.startsWith('# ')) { out.push({ kind: 'h', level: 1, text: line.slice(2) }); continue }

    const num = line.match(/^(\d+)\.\s+(.*)$/)
    if (num) { out.push({ kind: 'oli', n: num[1], text: num[2] }); continue }
    if (line.startsWith('- ')) { out.push({ kind: 'li', text: line.slice(2) }); continue }

    out.push({ kind: 'p', text: line })
  }

  return out
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)]+\))/g

export function parseInlineTokens(text: string): Inline[] {
  const src = String(text ?? '')
  const out: Inline[] = []
  let last = 0
  let m: RegExpExecArray | null
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(src)) !== null) {
    if (m.index > last) out.push({ kind: 'text', text: src.slice(last, m.index) })
    const tok = m[0]
    if (tok.startsWith('**')) {
      out.push({ kind: 'bold', text: tok.slice(2, -2) })
    } else if (tok.startsWith('`')) {
      out.push({ kind: 'code', text: tok.slice(1, -1) })
    } else if (tok.startsWith('[')) {
      const cut = tok.indexOf('](')
      const label = tok.slice(1, cut)
      const href = tok.slice(cut + 2, -1)
      // o ţinta relativa (`book/START.md`) nu e adresa web: randorul n-o face de apasat
      out.push({ kind: 'link', text: label, href, external: /^https?:\/\//i.test(href) })
    } else {
      out.push({ kind: 'em', text: tok.slice(1, -1) })
    }
    last = m.index + tok.length
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) })
  return out
}
