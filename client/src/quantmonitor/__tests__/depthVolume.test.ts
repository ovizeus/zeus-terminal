import { describe, it, expect } from 'vitest'
import { sumDepthVolume } from '../engines/depth'

// [DEPTH BRIDGE 2026-10-21] `S.obBV` / `S.obAV` (volumul total din carte, pe bid
// si pe ask) sunt CITITE in 11 locuri — index.ts:66, intel.ts de 6 ori, flow.ts,
// frame.ts prin aliasurile `_qmObBV`/`_qmObAV` — si scrise in ZERO.
// Consecinţele, dovedite in auditul b294:
//   - `_qmDeltaHist` primea mereu `0 - 0`, deci istoricul de delta era numai
//     zerouri si **CVD Divergence nu putea semnala NICIODATA** (nici dUp nici
//     dDn nu pot deveni true pe o serie constanta de zerouri).
//   - scorul **SMF rămanea blocat pe 0 / NEUT** permanent (flow.ts:88 compara
//     obBV cu obAV, deci 0 > 0 e mereu fals in ambele sensuri).
// Datele existau tot timpul: `S.bids` / `S.asks` se populeaza din fluxul
// depth20 (marketDataWS.ts:176-177). Lipsea doar agregarea — aceeasi punte
// neterminata ca cele 28 reparate in b294.
//
// Exista DOUA surse de carte de ordine, cu forme diferite: fluxul direct scrie
// obiecte `{p, q}`, iar proxy-ul scrie `msg.bids` a carui forma nu e garantata.
// De aceea ajutorul accepta ambele forme — altfel puntea ar functiona pe o cale
// si ar tacea pe cealalta, adica exact felul de bug pe care il reparam.
describe('sumDepthVolume — agregarea volumului din carte', () => {
  it('insumeaza forma {p, q} (fluxul depth20 direct)', () => {
    expect(sumDepthVolume([{ p: 100, q: 1.5 }, { p: 99, q: 2.5 }])).toBe(4)
  })

  it('insumeaza si forma tuplu [p, q] (calea prin proxy)', () => {
    expect(sumDepthVolume([[100, 1.5], [99, 2.5]])).toBe(4)
  })

  it('accepta si siruri numerice, cum vin de la bursa', () => {
    expect(sumDepthVolume([{ p: '100', q: '1.5' }, ['99', '2.5']] as any)).toBe(4)
  })

  it('carte goala sau lipsa → 0, nu NaN', () => {
    expect(sumDepthVolume([])).toBe(0)
    expect(sumDepthVolume(undefined as any)).toBe(0)
    expect(sumDepthVolume(null as any)).toBe(0)
    expect(sumDepthVolume('aiurea' as any)).toBe(0)
  })

  it('sare peste nivelurile stricate fara sa otraveasca totalul cu NaN', () => {
    expect(sumDepthVolume([{ p: 1, q: 2 }, null, { p: 2 }, { p: 3, q: NaN }, { p: 4, q: 3 }] as any)).toBe(5)
  })

  it('ignora cantitati negative (o carte nu are volum negativ)', () => {
    expect(sumDepthVolume([{ p: 1, q: 2 }, { p: 2, q: -5 }])).toBe(2)
  })

  it('Infinity nu devine total: nivelul e sarit', () => {
    expect(sumDepthVolume([{ p: 1, q: 2 }, { p: 2, q: Infinity }])).toBe(2)
  })

  it('un total real dintr-o carte de 20 de niveluri e pozitiv si finit', () => {
    const book = Array.from({ length: 20 }, (_, i) => ({ p: 100 - i, q: 0.5 }))
    const t = sumDepthVolume(book)
    expect(t).toBeCloseTo(10)
    expect(Number.isFinite(t)).toBe(true)
  })
})
