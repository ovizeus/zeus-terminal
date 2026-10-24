import { describe, it, expect } from 'vitest'
import { parseBlocks, parseInlineTokens } from '../bookParse'

// Cartea e plina de tabele si de blocuri de cod. Randorul vechi nu le cunostea,
// deci pe telefon ieseau randuri de `|` si `|---|---|`. Capturile din
// data/book_uploads (24 oct) arata exact asta.

describe('parseBlocks — tabele', () => {
  it('face un tabel dintr-un cap + separator + randuri', () => {
    const md = [
      '| Cos | Ce inseamna |',
      '|---|---|',
      '| ALE MELE | le fac eu |',
      '| ALE TALE | decizia ta |',
    ].join('\n')
    const b = parseBlocks(md)
    expect(b).toHaveLength(1)
    expect(b[0]).toEqual({
      kind: 'table',
      head: ['Cos', 'Ce inseamna'],
      rows: [['ALE MELE', 'le fac eu'], ['ALE TALE', 'decizia ta']],
    })
  })

  it('pastreaza celulele goale din cap — cartea are tabele cu prima coloana fara titlu', () => {
    const md = '| | Cos | Cate |\n|---|---|---|\n| 🔧 | ALE MELE | 3 |'
    const t = parseBlocks(md)[0] as any
    expect(t.kind).toBe('table')
    expect(t.head).toEqual(['', 'Cos', 'Cate'])
    expect(t.rows).toEqual([['🔧', 'ALE MELE', '3']])
  })

  it('accepta separator cu aliniere (`:---`, `---:`, `:---:`)', () => {
    const md = '| a | b |\n|:---|---:|\n| 1 | 2 |'
    expect((parseBlocks(md)[0] as any).kind).toBe('table')
  })

  it('NU face tabel dintr-un rand cu `|` fara separator — ramane paragraf', () => {
    const md = '| doar un rand cu bara |\nalt text'
    const b = parseBlocks(md)
    expect(b.every((x) => x.kind !== 'table')).toBe(true)
  })

  it('un rand de tabel cu mai putine celule decat capul nu pierde coloane', () => {
    const md = '| a | b | c |\n|---|---|---|\n| 1 | 2 |'
    const t = parseBlocks(md)[0] as any
    expect(t.rows[0]).toEqual(['1', '2', ''])
  })
})

describe('parseBlocks — blocuri de cod', () => {
  it('ia tot ce e intre ``` ca text brut, cu limbajul', () => {
    const md = '```bash\nsudo -u zeus python3 -I scripts/book-split.py\n```'
    expect(parseBlocks(md)).toEqual([
      { kind: 'code', lang: 'bash', text: 'sudo -u zeus python3 -I scripts/book-split.py' },
    ])
  })

  it('NU interpreteaza markdown-ul din interiorul blocului', () => {
    const md = '```\n## nu e titlu\n| nu e | tabel |\n|---|---|\n**nu e** bold\n```'
    const b = parseBlocks(md)
    expect(b).toHaveLength(1)
    expect((b[0] as any).kind).toBe('code')
    expect((b[0] as any).text).toContain('## nu e titlu')
    expect((b[0] as any).text).toContain('**nu e** bold')
  })

  it('un bloc neinchis la capatul cartii nu inghite nimic in liniste — se inchide singur', () => {
    const b = parseBlocks('```\nceva\n')
    expect((b[0] as any).kind).toBe('code')
    expect((b[0] as any).text).toBe('ceva')
  })
})

describe('parseBlocks — citate', () => {
  it('grupeaza randurile `>` intr-un singur citat si le re-parseaza inauntru', () => {
    const md = '> ### Titlu in citat\n> text normal'
    const b = parseBlocks(md)
    expect(b).toHaveLength(1)
    const q = b[0] as any
    expect(q.kind).toBe('quote')
    expect(q.blocks[0]).toEqual({ kind: 'h', level: 3, text: 'Titlu in citat' })
    expect(q.blocks[1]).toEqual({ kind: 'p', text: 'text normal' })
  })

  it('un `>` singur e rand gol in citat, NU un caracter pe ecran', () => {
    // capturile arata un `>` ratacit pe pagina
    const b = parseBlocks('> unu\n>\n> doi')
    const q = b[0] as any
    expect(q.kind).toBe('quote')
    expect(JSON.stringify(q.blocks)).not.toContain('">"')
  })

  it('un tabel inauntrul unui citat ramane tabel', () => {
    const b = parseBlocks('> | a | b |\n> |---|---|\n> | 1 | 2 |')
    const q = b[0] as any
    expect(q.blocks[0].kind).toBe('table')
  })
})

describe('parseBlocks — restul', () => {
  it('titluri pe trei niveluri', () => {
    const b = parseBlocks('# unu\n## doi\n### trei')
    expect(b.map((x: any) => [x.kind, x.level])).toEqual([['h', 1], ['h', 2], ['h', 3]])
  })

  it('linie orizontala, lista cu bulina si lista numerotata', () => {
    const b = parseBlocks('---\n- un punct\n3. al treilea')
    expect(b[0].kind).toBe('hr')
    expect(b[1]).toEqual({ kind: 'li', text: 'un punct' })
    expect(b[2]).toEqual({ kind: 'oli', n: '3', text: 'al treilea' })
  })

  it('randurile goale nu produc blocuri de text', () => {
    const b = parseBlocks('text\n\n\nalt text')
    expect(b.filter((x) => x.kind === 'p')).toHaveLength(2)
  })
})

describe('parseInlineTokens', () => {
  it('rupe bold, italic si cod', () => {
    const t = parseInlineTokens('un **bold**, un `cod` si un *italic*')
    expect(t.filter((x) => x.kind === 'bold').map((x: any) => x.text)).toEqual(['bold'])
    expect(t.filter((x) => x.kind === 'code').map((x: any) => x.text)).toEqual(['cod'])
    expect(t.filter((x) => x.kind === 'em').map((x: any) => x.text)).toEqual(['italic'])
  })

  it('leaga `[eticheta](tinta)` — capturile arata markup-ul brut pe ecran', () => {
    const t = parseInlineTokens('vezi [docs/book/START.md](book/START.md) acum')
    const link = t.find((x) => x.kind === 'link') as any
    expect(link).toBeTruthy()
    expect(link.text).toBe('docs/book/START.md')
    expect(link.href).toBe('book/START.md')
  })

  it('o tinta relativa NU e adresa web — randorul trebuie sa stie ca nu e de apasat', () => {
    const rel = parseInlineTokens('[x](book/START.md)').find((t) => t.kind === 'link') as any
    const abs = parseInlineTokens('[x](https://zeus.ro)').find((t) => t.kind === 'link') as any
    expect(rel.external).toBe(false)
    expect(abs.external).toBe(true)
  })

  it('textul fara marcaje ramane intreg, intr-o bucata', () => {
    expect(parseInlineTokens('text simplu')).toEqual([{ kind: 'text', text: 'text simplu' }])
  })
})

describe('plainText', () => {
  it('scoate marcajele din titlu — in lista de sectiuni nu se arata `**`', async () => {
    const { plainText } = await import('../bookParse')
    expect(plainText('⏸️ R16 — **DECIZIA OPERATORULUI: A, nu facem nimic**'))
      .toBe('⏸️ R16 — DECIZIA OPERATORULUI: A, nu facem nimic')
  })

  it('pastreaza eticheta legaturii, nu tinta', async () => {
    const { plainText } = await import('../bookParse')
    expect(plainText('vezi [START](book/START.md) acum')).toBe('vezi START acum')
  })
})
