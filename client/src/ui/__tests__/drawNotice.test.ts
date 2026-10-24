// [2026-10-24] Trei runde pe acelasi simptom, si de fiecare data operatorul a vazut
// NIMIC. Fiecare cale de eşec din desen era sau complet muta, sau anunţata printr-un
// toast de 12px, jos-dreapta, care dispare in 1,2 s — pe telefon, invizibil.
//
// Si mai rau: `unregisterChart()` pune pe globale un `_noopStub`, care e un Proxy
// peste o functie, deci TRUTHY. Verificarea `if (!_series())` din `_activate` trecea,
// `createPriceLine` intorcea `undefined`, linia se adauga in lista fara nimic desenat,
// si nu aparea nicio eroare. Exact „apas si nu face nimic".
import { describe, it, expect } from 'vitest'
import { drawBlockReason, DRAW_BLOCK_MESSAGE } from '../drawToolArming'
import { showDrawNotice, DRAW_NOTICE_ID } from '../drawNotice'

describe('drawBlockReason — de ce NU se poate desena, spus pe nume', () => {
  it('modulul nelegat e primul lucru de raportat', () => {
    expect(drawBlockReason(false, false)).toBe('module-not-loaded')
    expect(drawBlockReason(false, true)).toBe('module-not-loaded')
  })

  // Cazul `_noopStub`: modulul e legat, dar chartul e un ciot. Truthy, deci vechea
  // verificare il accepta. Puntea are `isChartReady()`, care spune adevarul.
  it('chartul care nu e gata (sau e un ciot) e raportat separat', () => {
    expect(drawBlockReason(true, false)).toBe('chart-not-ready')
  })

  it('cand totul e pe loc nu blocheaza nimic', () => {
    expect(drawBlockReason(true, true)).toBe(null)
  })

  it('fiecare motiv are un mesaj pentru om, nu un cod', () => {
    for (const k of ['module-not-loaded', 'chart-not-ready']) {
      expect(typeof DRAW_BLOCK_MESSAGE[k]).toBe('string')
      expect(DRAW_BLOCK_MESSAGE[k].length).toBeGreaterThan(10)
    }
  })
})

describe('showDrawNotice — mesajul trebuie sa fie de VAZUT pe telefon', () => {
  it('pune mesajul in pagina', () => {
    showDrawNotice('ceva s-a oprit')
    const el = document.getElementById(DRAW_NOTICE_ID)!
    expect(el).toBeTruthy()
    expect(el.textContent).toBe('ceva s-a oprit')
  })

  it('refoloseste acelasi element, nu stivuieste mesaje', () => {
    showDrawNotice('unu'); showDrawNotice('doi')
    expect(document.querySelectorAll('#' + DRAW_NOTICE_ID).length).toBe(1)
    expect(document.getElementById(DRAW_NOTICE_ID)!.textContent).toBe('doi')
  })

  // Vechiul toast: 12px, jos-dreapta, 1,2 s. Pe telefon nu il vezi. Astea sunt
  // cerintele care au costat trei runde, deci sunt pinuite ca test.
  it('e centrat, nu lipit in colţ', () => {
    showDrawNotice('x')
    const st = document.getElementById(DRAW_NOTICE_ID)!.style
    expect(st.left).toBe('50%')
    expect(st.transform).toContain('translateX(-50%)')
  })

  it('e lizibil: cel putin 13px', () => {
    showDrawNotice('x')
    expect(parseFloat(document.getElementById(DRAW_NOTICE_ID)!.style.fontSize)).toBeGreaterThanOrEqual(13)
  })

  it('nu fura atingerile de pe chart', () => {
    showDrawNotice('x')
    expect(document.getElementById(DRAW_NOTICE_ID)!.style.pointerEvents).toBe('none')
  })

  it('sta destul ca sa fie citit', () => {
    expect(showDrawNotice('x')).toBeGreaterThanOrEqual(2500)
  })
})
