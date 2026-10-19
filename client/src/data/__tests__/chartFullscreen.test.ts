// Fullscreen-ul panoului chart — „ca TradingView".
//
// Cerut de operator pe 2026-10-19. Ce facea butonul inainte:
//   * punea clasa `fsm` pe #csec (position:fixed, inset:0) — deci acoperea
//     ecranul paginii, DAR fara API-ul nativ de fullscreen, deci bara de
//     browser rămânea;
//   * dadea chartului principal `window.innerHeight - 100`, o constanta
//     ghicita, fara sa scada toolbar-ul, legenda si panourile de indicatori
//     active — deci cu indicatori aprinsi ultimele panouri erau TAIATE de
//     `overflow:hidden`;
//   * ASCUNDEA panoul CVD (`#cc`) in fullscreen, exact opusul cerintei „tot ce
//     e chart si indicatori";
//   * iar `_resizeCharts()` (resize, orientationchange, bara de browser pe
//     Android) folosea `getChartH()`, care intoarce 400px FIX si nu stie de
//     fullscreen — deci orice redimensionare readucea chartul la 400px in
//     mijlocul ecranului plin.
//
// Testele de aici fixeaza aritmetica inaltimii si contractul cu API-ul nativ.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  FS_MIN_CHART_H,
  computeFullscreenChartHeight,
  measureOccupiedHeight,
  resolveChartHeight,
  enterNativeFullscreen,
  exitNativeFullscreen,
  isNativeFullscreen,
} from '../chartFullscreen'

describe('computeFullscreenChartHeight', () => {
  it('da chartului tot ce ramane din ecran dupa toolbar, legenda si panouri', () => {
    // 1080 ecran − 44 toolbar − 26 legenda − 3 panouri de 60 = 830
    expect(computeFullscreenChartHeight(1080, 44 + 26 + 180)).toBe(830)
  })

  it('nu depinde de o constanta: mai multe panouri aprinse = chart mai mic, nu taiat', () => {
    const putine = computeFullscreenChartHeight(1000, 70 + 60)
    const multe = computeFullscreenChartHeight(1000, 70 + 60 * 6)
    expect(putine).toBe(870)
    expect(multe).toBe(570)
    // Suma rămâne exact ecranul — nimic nu iese din viewport, deci nimic taiat.
    expect(multe + 70 + 60 * 6).toBe(1000)
  })

  it('se opreste la un minim in loc sa dea inaltime negativa', () => {
    expect(computeFullscreenChartHeight(400, 2000)).toBe(FS_MIN_CHART_H)
    expect(computeFullscreenChartHeight(400, 2000)).toBeGreaterThan(0)
  })

  it('intoarce intregi — lightweight-charts nu primeste fractii de pixel', () => {
    expect(Number.isInteger(computeFullscreenChartHeight(812.5, 70.25))).toBe(true)
    expect(computeFullscreenChartHeight(812.5, 70.25)).toBe(742)
  })

  it('un viewport absurd nu produce NaN', () => {
    expect(computeFullscreenChartHeight(NaN, 10)).toBe(FS_MIN_CHART_H)
    expect(computeFullscreenChartHeight(1000, NaN)).toBe(FS_MIN_CHART_H)
  })
})

describe('measureOccupiedHeight', () => {
  function section(children: Array<{ id?: string; h?: number; hidden?: boolean }>) {
    const sec = document.createElement('section')
    sec.id = 'csec'
    for (const c of children) {
      const d = document.createElement('div')
      if (c.id) d.id = c.id
      if (c.h != null) d.style.height = `${c.h}px`
      if (c.hidden) d.style.display = 'none'
      sec.appendChild(d)
    }
    document.body.appendChild(sec)
    return sec
  }

  afterEach(() => { document.body.innerHTML = '' })

  it('aduna doar copiii VIZIBILI si sare peste gazda chartului', () => {
    const sec = section([
      { h: 44 },                 // toolbar
      { id: 'mc', h: 400 },      // gazda chartului — nu se numara
      { h: 26 },                 // legenda
      { id: 'cc', h: 60 },       // CVD aprins
      { id: 'rsiChart', h: 60, hidden: true },  // stins
    ])
    expect(measureOccupiedHeight(sec, 'mc')).toBe(44 + 26 + 60)
  })

  it('un panou de indicator nou aprins intra automat in socoteala', () => {
    // Nicio lista hardcodata de id-uri: masoara ce e in DOM. Un indicator
    // adaugat maine nu cere nicio modificare aici.
    const sec = section([{ h: 44 }, { id: 'mc', h: 400 }, { id: 'indicatorInventatMaine', h: 95 }])
    expect(measureOccupiedHeight(sec, 'mc')).toBe(44 + 95)
  })

  it('o secțiune fara copii inseamna zero, nu eroare', () => {
    expect(measureOccupiedHeight(section([]), 'mc')).toBe(0)
  })
})

describe('resolveChartHeight — garda impotriva revenirii la 400px', () => {
  it('in afara fullscreen-ului intoarce inaltimea normala', () => {
    expect(resolveChartHeight({ fullscreen: false, viewportH: 1080, occupiedH: 70, normalH: 400 })).toBe(400)
  })

  it('IN fullscreen ignora inaltimea normala si umple ecranul', () => {
    // Asta e bug-ul: _resizeCharts dadea 400 si in fullscreen.
    expect(resolveChartHeight({ fullscreen: true, viewportH: 1080, occupiedH: 70, normalH: 400 })).toBe(1010)
  })
})

describe('API-ul nativ de fullscreen', () => {
  let el: HTMLElement

  beforeEach(() => {
    el = document.createElement('div')
    document.body.appendChild(el)
  })

  afterEach(() => {
    document.body.innerHTML = ''
    delete (document as any).fullscreenElement
  })

  it('cere fullscreen real pe element si raporteaza reusita', async () => {
    const req = vi.fn().mockResolvedValue(undefined)
    ;(el as any).requestFullscreen = req
    await expect(enterNativeFullscreen(el)).resolves.toBe(true)
    expect(req).toHaveBeenCalledTimes(1)
  })

  it('cand browserul REFUZA, nu arunca — raporteaza false si lasa CSS-ul sa acopere ecranul', async () => {
    ;(el as any).requestFullscreen = vi.fn().mockRejectedValue(new Error('denied'))
    await expect(enterNativeFullscreen(el)).resolves.toBe(false)
  })

  it('cand API-ul nu exista deloc (iOS vechi), raporteaza false fara sa arunce', async () => {
    await expect(enterNativeFullscreen(el)).resolves.toBe(false)
  })

  it('accepta si varianta webkit', async () => {
    const req = vi.fn().mockResolvedValue(undefined)
    ;(el as any).webkitRequestFullscreen = req
    await expect(enterNativeFullscreen(el)).resolves.toBe(true)
    expect(req).toHaveBeenCalledTimes(1)
  })

  it('iesirea se cere doar daca suntem chiar in fullscreen', async () => {
    const exit = vi.fn().mockResolvedValue(undefined)
    ;(document as any).exitFullscreen = exit

    ;(document as any).fullscreenElement = null
    await exitNativeFullscreen()
    expect(exit).not.toHaveBeenCalled()

    ;(document as any).fullscreenElement = el
    await exitNativeFullscreen()
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('isNativeFullscreen citeste starea reala a documentului', () => {
    ;(document as any).fullscreenElement = null
    expect(isNativeFullscreen()).toBe(false)
    ;(document as any).fullscreenElement = el
    expect(isNativeFullscreen()).toBe(true)
  })
})
