// [2026-10-24] Desenul pe chart: „dungile nu se pun".
//
// Cauza: DOUĂ surse de adevăr pentru „ce unealtă e armată". React ţine `drawTool`
// în ChartControls (de el atârnă aspectul butonului ŞI aritmetica de toggle), iar
// modulul ţine `_activeTool` (de el atârnă dacă un clic desenează cu adevărat).
// După fiecare linie plasată, `_handleChartAction` cheamă `_deactivate()`, deci
// modulul se dezarmează — şi nimeni nu-i spune React-ului. Rezultat: butonul arată
// în continuare armat, clicul pe chart nu mai face nimic, iar re-armarea cere DOUĂ
// apăsări, fiindcă prima trimite `null` (React crede că stinge ce e deja aprins).
//
// Modulul trebuie să fie singura sursă de adevăr, iar React oglinda lui. Astea sunt
// bucăţile pure de care au nevoie ambele părţi; IIFE-ul din drawingTools.ts cere un
// chart viu, deci altfel nu s-ar putea testa (acelaşi motiv ca la drawingScope.ts).
import { describe, it, expect, vi } from 'vitest'
import {
  resolveToolToggle,
  tlineSeriesData,
  needsHandleContainer,
  emitDrawTool,
  subscribeDrawTool,
  DRAW_TOOL_EVENT,
} from '../drawToolArming'

describe('resolveToolToggle — o singură aritmetică de armare, folosită de ambele părţi', () => {
  it('armează unealta cerută când nimic nu e armat', () => {
    expect(resolveToolToggle(null, 'hline')).toBe('hline')
  })

  it('a doua apăsare pe ACEEAŞI unealtă o dezarmează', () => {
    expect(resolveToolToggle('hline', 'hline')).toBe(null)
  })

  it('apăsarea pe ALTĂ unealtă comută direct, fără pas intermediar', () => {
    expect(resolveToolToggle('hline', 'tline')).toBe('tline')
  })

  it('`null` cerut explicit dezarmează', () => {
    expect(resolveToolToggle('eraser', null)).toBe(null)
  })

  // Regresia exactă: React calcula toggle-ul din starea LUI, rămasă aprinsă după ce
  // modulul se dezarmase singur. Cu modulul ca sursă unică, prima apăsare după o
  // plasare reuşeşte să armeze din nou — nu mai e nevoie de două.
  it('după o plasare (modul dezarmat) o singură apăsare re-armează', () => {
    const afterPlacement = null            // ce ştie MODULUL, nu React
    expect(resolveToolToggle(afterPlacement, 'hline')).toBe('hline')
  })
})

describe('tlineSeriesData — garda pe timpi egali, care exista doar în funcţia-soră', () => {
  it('normalizează două puncte în ordine crescătoare pe timp', () => {
    expect(tlineSeriesData({ time: 100, price: 10 }, { time: 200, price: 20 }))
      .toEqual([{ time: 100, value: 10 }, { time: 200, value: 20 }])
  })

  it('punctele date invers ies ordonate, cu valorile legate de timpul LOR', () => {
    expect(tlineSeriesData({ time: 200, price: 20 }, { time: 100, price: 10 }))
      .toEqual([{ time: 100, value: 10 }, { time: 200, value: 20 }])
  })

  // Ambele clicuri pe aceeaşi lumânare: `Math.round(log)` dă acelaşi index pentru
  // clicuri la câţiva pixeli pe un chart depărtat. Datele ajungeau cu doi timpi
  // identici în setData, care în build-ul de PRODUCŢIE nu aruncă (verificarea de
  // ordine e eliminată) — punctele se colapsează într-unul şi linia e INVIZIBILĂ.
  // Refuzăm limpede, în loc să producem un artefact pe care nu-l vede nimeni.
  it('refuză două puncte pe aceeaşi lumânare în loc să deseneze invizibil', () => {
    expect(tlineSeriesData({ time: 100, price: 10 }, { time: 100, price: 20 })).toBe(null)
  })

  it('refuză timpi sau preţuri care nu sunt numere finite', () => {
    expect(tlineSeriesData({ time: NaN, price: 10 }, { time: 200, price: 20 })).toBe(null)
    expect(tlineSeriesData({ time: 100, price: Infinity }, { time: 200, price: 20 })).toBe(null)
    expect(tlineSeriesData(null as any, { time: 200, price: 20 })).toBe(null)
  })
})

describe('needsHandleContainer — containerul memorat poate fi DETAŞAT după o re-montare', () => {
  it('cere container când nu există niciunul', () => {
    expect(needsHandleContainer(null)).toBe(true)
  })

  // `_handleContainer` era memorat şi niciodată revalidat. După ce panoul de chart
  // se re-montează, nodul rămâne în variabilă dar iese din document, deci mânerele
  // şi butoanele de ştergere se adăugau în afara paginii: linia se vedea, dar nu
  // puteai nici să o muţi, nici să o ştergi.
  it('cere container nou când cel memorat nu mai e în document', () => {
    const detached = document.createElement('div')
    expect(detached.isConnected).toBe(false)
    expect(needsHandleContainer(detached)).toBe(true)
  })

  it('nu cere nimic când containerul memorat e încă în document', () => {
    const attached = document.createElement('div')
    document.body.appendChild(attached)
    expect(needsHandleContainer(attached)).toBe(false)
    attached.remove()
  })
})

describe('magistrala de armare — cum află React că modulul s-a dezarmat singur', () => {
  it('abonatul primeşte unealta emisă', () => {
    const seen: any[] = []
    const off = subscribeDrawTool((t) => seen.push(t))
    emitDrawTool('tline')
    emitDrawTool(null)
    off()
    expect(seen).toEqual(['tline', null])
  })

  it('dezabonarea opreşte livrarea', () => {
    const cb = vi.fn()
    const off = subscribeDrawTool(cb)
    off()
    emitDrawTool('hline')
    expect(cb).not.toHaveBeenCalled()
  })

  it('emite pe numele de eveniment aşteptat de restul aplicaţiei', () => {
    const cb = vi.fn()
    window.addEventListener(DRAW_TOOL_EVENT, cb)
    emitDrawTool('eraser')
    window.removeEventListener(DRAW_TOOL_EVENT, cb)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(DRAW_TOOL_EVENT).toBe('zeus:drawToolChanged')
  })
})
