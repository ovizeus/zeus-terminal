import { describe, it, expect } from 'vitest'
import { bundleIdFromHtml, currentBundleId, decideUpdate, IDLE_NEEDED_MS } from '../autoUpdate'

// [2026-11-15] Dupa un build, aplicatia se reincarca singura pe versiunea noua —
// dar nu peste mana omului, si niciodata in bucla.
const base = { current: 'index-AAA.js', latest: 'index-BBB.js', tried: null as string | null, hidden: false, idleMs: 0, typing: false, modalOpen: false }

describe('numele pachetului', () => {
    it('se citeste din pagina-coaja', () => {
        expect(bundleIdFromHtml('<script type="module" crossorigin src="/app/assets/index-HUucMnWo.js"></script>')).toBe('index-HUucMnWo.js')
        expect(bundleIdFromHtml('<link href="/app/assets/index-Ctoj_DQg.css"><script src="/app/assets/index-Dp-Zv_1.js">')).toBe('index-Dp-Zv_1.js')
    })
    it('o pagina care nu e coaja aplicatiei (login, eroare) nu da niciun nume', () => {
        expect(bundleIdFromHtml('<html><body>login</body></html>')).toBeNull()
        expect(bundleIdFromHtml('')).toBeNull()
        expect(bundleIdFromHtml(null)).toBeNull()
    })
    it('pachetul curent se citeste din pagina care ruleaza', () => {
        document.head.innerHTML = '<script src="/app/assets/index-CUR123.js"></script>'
        expect(currentBundleId()).toBe('index-CUR123.js')
        document.head.innerHTML = ''
        expect(currentBundleId()).toBeNull()
    })
})

describe('decideUpdate', () => {
    it('acelasi pachet sau unul necunoscut: nimic', () => {
        expect(decideUpdate({ ...base, latest: 'index-AAA.js' })).toBe('none')
        expect(decideUpdate({ ...base, latest: null })).toBe('none')
        expect(decideUpdate({ ...base, current: null })).toBe('none')
    })
    it('in fundal se reincarca pe loc', () => {
        expect(decideUpdate({ ...base, hidden: true })).toBe('reload')
        expect(decideUpdate({ ...base, hidden: true, typing: true, modalOpen: true })).toBe('reload')
    })
    it('in fata: doar dupa 20 de secunde fara nicio atingere', () => {
        expect(decideUpdate({ ...base, idleMs: IDLE_NEEDED_MS - 1 })).toBe('wait')
        expect(decideUpdate({ ...base, idleMs: IDLE_NEEDED_MS })).toBe('reload')
    })
    it('⛔ niciodata peste mana omului: cat scrie sau are o fereastra deschisa, asteapta', () => {
        expect(decideUpdate({ ...base, idleMs: 10 * 60_000, typing: true })).toBe('wait')
        expect(decideUpdate({ ...base, idleMs: 10 * 60_000, modalOpen: true })).toBe('wait')
    })
    it('⛔ fara bucla: daca am reincarcat deja pentru pachetul asta si tot nu-l avem, nu mai incercam', () => {
        expect(decideUpdate({ ...base, tried: 'index-BBB.js', hidden: true })).toBe('none')
        expect(decideUpdate({ ...base, tried: 'index-BBB.js', idleMs: 10 * 60_000 })).toBe('none')
    })
    it('…dar un pachet si mai nou e incercat din nou', () => {
        expect(decideUpdate({ ...base, tried: 'index-BBB.js', latest: 'index-CCC.js', hidden: true })).toBe('reload')
    })
})
