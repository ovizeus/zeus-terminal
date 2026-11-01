// [CHAT WIPE 2026-11-01] Cursa exacta pe care a trait-o: deschide chatul,
// TalkWithMe se monteaza si cheama loadHistory, el scrie imediat, iar raspunsul
// serverului ateriza DUPA si stergea si mesajul lui, si randul in care se
// scria replica. Replicile existau in ml_voice_log; pe ecran nu ajungeau.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useOmegaChatStore } from '../omegaChatStore'

function resetStore() {
  useOmegaChatStore.setState({ history: [], loading: false, error: null, lastFetchTs: null, _loadInFlight: null } as any)
}

describe('loadHistory nu mai sterge ce scrii cat e pe drum', () => {
  beforeEach(() => { resetStore(); vi.restoreAllMocks() })

  it('REGRESIE: mesajul trimis in timpul incarcarii ramane pe ecran', async () => {
    let release: (v: any) => void = () => {}
    const gate = new Promise((r) => { release = r })
    vi.stubGlobal('fetch', vi.fn(async () => {
      await gate
      return { ok: true, json: async () => ({ ok: true, history: [{ role: 'you', text: 'vechi', ts: 10 }] }) }
    }) as any)

    const p = useOmegaChatStore.getState().loadHistory()
    // ...si cat timp cererea e pe drum, el scrie si incepe sa curga raspunsul.
    useOmegaChatStore.setState((s: any) => ({
      history: [...s.history,
        { role: 'you', text: 'ce faci', ts: Date.now() + 5 },
        { role: 'omega', text: 'scriu...', ts: Date.now() + 6 }],
    }))
    release(null)
    await p

    const texts = useOmegaChatStore.getState().history.map((r: any) => r.text)
    expect(texts).toContain('ce faci')
    expect(texts).toContain('scriu...')
    expect(texts).toContain('vechi') // si istoricul serverului e tot acolo
  })

  it('fara nimic scris intre timp, istoricul serverului e adoptat intocmai', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ ok: true, history: [{ role: 'you', text: 'a', ts: 1 }, { role: 'omega', text: 'b', ts: 2 }] }),
    })) as any)
    await useOmegaChatStore.getState().loadHistory()
    expect(useOmegaChatStore.getState().history.map((r: any) => r.text)).toEqual(['a', 'b'])
  })

  it('REGRESIE: o incarcare esuata isi marcheaza incercarea, ca sa nu reincerce in bucla', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: 'boom' }) })) as any)
    await useOmegaChatStore.getState().loadHistory()
    const st = useOmegaChatStore.getState()
    expect(st.error).toBeTruthy()
    // Fara asta, dedup-ul de 60s nu se armeaza niciodata si fiecare apelant
    // re-cere — un endpoint picat devenea o rafala de cereri.
    expect(st.lastFetchTs).not.toBeNull()
  })

  it('o incarcare esuata NU sterge conversatia de pe ecran', async () => {
    useOmegaChatStore.setState({ history: [{ role: 'you', text: 'tinut', ts: 5 } as any] } as any)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }) as any)
    await useOmegaChatStore.getState().loadHistory()
    expect(useOmegaChatStore.getState().history.map((r: any) => r.text)).toEqual(['tinut'])
  })
})
