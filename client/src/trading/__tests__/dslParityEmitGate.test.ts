import { describe, it, expect, beforeEach, vi } from 'vitest'
import { _dslParityEmitEnabled } from '../dsl'

// [SYNC FIX 2026-10-21] `dsl_parity_log` avea 649 833 de rânduri si TOATE
// `source='server'` — zero de la client, deci alaturarea client-server dadea
// exact 0 perechi si monitorul nu putea raporta nicio nepotrivire, oricat
// creştea. Cauza nu era un jurnal stricat: ţeava a fost dovedita functionala
// separat (schema + INSERT + alaturare reconstruite verbatim prind o divergenţa
// injectata). Lipsea alimentarea: emisia clientului era pazita de
// `localStorage.getItem('zeus_dsl_parity_shadow') === 'true'`, un semafor cu UN
// cititor si ZERO scriitori in tot codul, fara comutator in interfaţa.
// Sora care MERGE (paritatea de brain, 2 316 randuri) nu are niciun semafor:
// emite direct, best-effort, iar serverul decide daca scrie
// (MF.PARITY_SHADOW_ENABLED) si intoarce {ok:true, logged:false} cand nu.
// Deci alinierea e la comportamentul deja dovedit, nu o politica noua:
// emite implicit, cu opt-OUT pentru cine vrea sa taie traficul.
describe('_dslParityEmitEnabled — opt-OUT, nu opt-in', () => {
  beforeEach(() => { try { localStorage.clear() } catch (_) {} })

  it('IMPLICIT pornit — fara nicio cheie setata (asta repara jurnalul gol)', () => {
    expect(_dslParityEmitEnabled()).toBe(true)
  })

  it("rămane pornit pe valoarea veche 'true' (compatibil cu cine o avea setata)", () => {
    localStorage.setItem('zeus_dsl_parity_shadow', 'true')
    expect(_dslParityEmitEnabled()).toBe(true)
  })

  it("se poate OPRI explicit cu 'false'", () => {
    localStorage.setItem('zeus_dsl_parity_shadow', 'false')
    expect(_dslParityEmitEnabled()).toBe(false)
  })

  it('o valoare fara sens nu opreşte emisia (doar „false" opreşte)', () => {
    localStorage.setItem('zeus_dsl_parity_shadow', 'aiurea')
    expect(_dslParityEmitEnabled()).toBe(true)
  })

  it('localStorage care ARUNCA (fereastra privata, date blocate) → pornit, fara excepţie', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocat') })
    expect(() => _dslParityEmitEnabled()).not.toThrow()
    expect(_dslParityEmitEnabled()).toBe(true)
    spy.mockRestore()
  })
})
