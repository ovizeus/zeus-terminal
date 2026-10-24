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
  tapAccepted,
  suspendedChartOptions,
  dragGesture,
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

describe('suspendedChartOptions — chartul nu are voie sa se mute cand desenezi pe el', () => {
  // De ce: `marketDataChart.ts` tine `pressedMouseMove`, `horzTouchDrag` si
  // `vertTouchDrag` pe true, iar drawingTools NU suspenda nimic. Deci cand tragi cu
  // unealta armata, lightweight-charts panorameaza chartul sub tine: pe mouse nu se
  // deseneaza nimic, iar pe atingere punctul 2 se calculeaza pe scala DEJA mutata.
  // Asta e ce suspenda TradingView cat timp o unealta de desen e activa.
  const live = {
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
  }

  it('taie toate gesturile de TRAGERE care mutau chartul', () => {
    const o = suspendedChartOptions(live)
    expect(o.handleScroll.pressedMouseMove).toBe(false)
    expect(o.handleScroll.horzTouchDrag).toBe(false)
    expect(o.handleScroll.vertTouchDrag).toBe(false)
    expect(o.handleScale.axisPressedMouseMove).toBe(false)
  })

  // Zoom-ul rămâne: in TradingView poti da zoom cat timp desenezi, doar panoramarea
  // prin tragere e cea care se bate cu desenul.
  it('pastreaza zoom-ul pe rotita si pe pinch', () => {
    const o = suspendedChartOptions(live)
    expect(o.handleScroll.mouseWheel).toBe(true)
    expect(o.handleScale.mouseWheel).toBe(true)
    expect(o.handleScale.pinch).toBe(true)
  })

  it('accepta forma booleana a opţiunilor', () => {
    const o = suspendedChartOptions({ handleScroll: true, handleScale: true })
    expect(o.handleScroll.mouseWheel).toBe(true)
    expect(o.handleScroll.pressedMouseMove).toBe(false)
    expect(o.handleScale.pinch).toBe(true)
    expect(o.handleScale.axisPressedMouseMove).toBe(false)
  })

  it('nu reaprinde ce era deja stins', () => {
    const o = suspendedChartOptions({ handleScroll: false, handleScale: false })
    expect(o.handleScroll.mouseWheel).toBe(false)
    expect(o.handleScale.pinch).toBe(false)
  })

  it('pe optiuni lipsa cade pe implicitele bibliotecii, dar tot cu tragerea stinsa', () => {
    const o = suspendedChartOptions(undefined)
    expect(o.handleScroll.mouseWheel).toBe(true)
    expect(o.handleScroll.pressedMouseMove).toBe(false)
    expect(o.handleScale.axisPressedMouseMove).toBe(false)
  })

  // `axisPressedMouseMove` poate fi si obiect {time, price} — tot trebuie stins.
  it('stinge si forma-obiect a tragerii pe axa', () => {
    const o = suspendedChartOptions({ handleScale: { axisPressedMouseMove: { time: true, price: true } } })
    expect(o.handleScale.axisPressedMouseMove).toBe(false)
  })
})

describe('dragGesture — tragere sau atingere, acelasi prag ca pe mobil', () => {
  it('peste prag e tragere', () => {
    expect(dragGesture({ x: 10, y: 10 }, { x: 40, y: 12 })).toBe('drag')
  })

  // Sub prag TREBUIE sa rămână atingere, altfel un simplu clic ar porni fluxul de
  // tragere si ar pune punctul 2 peste punctul 1 — adica exact linia de lungime zero
  // pe care tocmai am interzis-o. Fluxul clic-clic nu are voie sa fie rupt de fixul asta.
  it('sub prag e atingere, deci fluxul clic-clic rămâne neatins', () => {
    expect(dragGesture({ x: 10, y: 10 }, { x: 13, y: 11 })).toBe('tap')
    expect(dragGesture({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe('tap')
  })

  it('pragul e acelasi cu cel din calea de atingere: 8px pe suma deplasarilor', () => {
    expect(dragGesture({ x: 0, y: 0 }, { x: 8, y: 0 })).toBe('tap')
    expect(dragGesture({ x: 0, y: 0 }, { x: 9, y: 0 })).toBe('drag')
    expect(dragGesture({ x: 0, y: 0 }, { x: 5, y: 4 })).toBe('drag')
  })

  it('fara puncte valide nu decide nimic', () => {
    expect(dragGesture(null as any, { x: 1, y: 1 })).toBe(null)
    expect(dragGesture({ x: NaN, y: 0 }, { x: 50, y: 0 })).toBe(null)
  })
})

describe('tapAccepted — filtrul de atingere rapida arunca atingerile ATENTE', () => {
  // `drawingTools.ts` avea, pe calea de atingere, un filtru de „tap rapid": peste
  // 300 ms sau peste 10 px, gestul era aruncat COMPLET si fara nicio reacţie. Filtrul
  // avea sens cat timp chartul se panorama la tragere — trebuia sa deosebeasca o
  // atingere de o panoramare. Dar pe telefon o atingere ATENTA pe un nivel de preţ
  // trece des de 300 ms, deci operatorul apasa si nu se intampla nimic, fara nici
  // macar un mesaj. Iar de la b307 panoramarea e suspendata cat timp o unealta e
  // armata, deci distincţia nu mai e necesara: pe un chart care nu se mai mişca, o
  // apasare lunga nu poate fi altceva decat intenţia de a desena.
  it('cand o unealta e armata, o atingere LENTA e acceptata', () => {
    expect(tapAccepted('hline', 850, 0)).toBe(true)
  })

  it('cand o unealta e armata, degetul care aluneca puţin nu mai strica nimic', () => {
    expect(tapAccepted('tline', 120, 26)).toBe(true)
  })

  // Fara unealta armata filtrul rămâne EXACT cum era: acolo chartul chiar se
  // panoramează, deci atingerea trebuie deosebita de tragere.
  it('fara unealta armata pastreaza pragurile vechi: 300 ms si 10 px', () => {
    expect(tapAccepted(null, 300, 10)).toBe(true)
    expect(tapAccepted(null, 301, 0)).toBe(false)
    expect(tapAccepted(null, 100, 11)).toBe(false)
  })

  it('nu cade pe valori lipsa sau nefinite', () => {
    expect(tapAccepted(null, NaN, 0)).toBe(false)
    expect(tapAccepted('hline', NaN, NaN)).toBe(true)
  })
})
