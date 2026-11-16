import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// [2026-11-15] Operatorul: „cand activez alertele ramane mesajul acolo, nu dispare
// … si scrie in romana Alerte OFF / Alerte ON". In `toast`, durata 0 inseamna
// „ramai pana te inlocuieste altceva" — pastrata DOAR pentru conditii de blocare.
const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8')

describe('mesajul de la comutatorul de alerte', () => {
    const src = read('../dom2.ts')
    it('e in engleza si dispare singur', () => {
        expect(src).toMatch(/toast\(en \? 'Alerts ON' : 'Alerts OFF', 2500,/)
        expect(src).not.toMatch(/Alerte (ON|OFF)/)
    })
    it('nici celelalte mesaje din fisier nu mai sunt in romana', () => {
        expect(src).not.toMatch(/toast\('[^']*(aplicate|Culori)/)
    })
})

describe('confirmarile simple nu mai raman lipite pe ecran', () => {
    const FILES = ['../../utils/dev.ts', '../../engine/brain.ts', '../../engine/arianova.ts', '../../ui/panels.ts',
        '../../engine/aub.ts', '../../services/storage.ts', '../../trading/dsl.ts']
    it.each(FILES)('%s: niciun toast cu durata 0', (f) => {
        const sticky = read(f).split('\n').filter((l) => /toast\([^\n]*, 0[,)]/.test(l) && !/^\s*\/\//.test(l))
        expect(sticky).toEqual([])
    })
    it('⛔ pozitia NEPROTEJATA ramane lipita, dinadins', () => {
        const at = read('../../trading/autotrade.ts')
        expect(at).toMatch(/UNPROTECTED — ' \+ pos\._unprotectedReason, 0,/)
    })
    // [2026-11-15] Operatorul a cerut explicit ca „Kill switch active — press
    // RESET…" sa dispara singur: starea ramane vizibila in panoul AT (KILL
    // ACTIVE + butonul RESET), deci mesajul nu mai are nevoie sa stea pe ecran.
    it('mesajul de kill switch dispare singur', () => {
        const at = read('../../trading/autotrade.ts')
        expect(at).not.toMatch(/toast\('Kill switch active[^']*', 0,/)
        expect(at).toMatch(/toast\('Kill switch active[^']*', 6000,/)
    })
})
