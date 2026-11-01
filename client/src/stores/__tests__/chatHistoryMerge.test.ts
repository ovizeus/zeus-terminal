// [CHAT WIPE 2026-11-01] "intru in omega dau tap scriu si el nu raspunde".
// Serverul l-a contrazis pe jumatate: ml_voice_log avea replicile pe care OMEGA
// chiar le-a produs la 17:53, 17:59, 18:00 si 18:01. Au existat. El nu le-a
// vazut, fiindca loadHistory INLOCUIA toata conversatia cu ce avea serverul,
// iar fetch-ul ateriza dupa ce el scrisese — luand cu el si mesajul lui, si
// randul in care se scria raspunsul.
import { describe, it, expect } from 'vitest'
import { mergeChatHistory, rowTs } from '../chatHistoryMerge'

const row = (role: string, text: string, ts: number) => ({ role, text, ts } as any)

describe('mergeChatHistory', () => {
  it('REGRESIE: mesajul scris cat fetch-ul era pe drum SUPRAVIETUIESTE', () => {
    const startedAt = 1000
    const server = [row('you', 'vechi', 500), row('omega', 'raspuns vechi', 600)]
    const local = [...server, row('you', 'ce faci', 1200), row('omega', 'scriu...', 1201)]
    const out = mergeChatHistory(server, local, startedAt)
    expect(out.map((r: any) => r.text)).toEqual(['vechi', 'raspuns vechi', 'ce faci', 'scriu...'])
  })

  it('randurile mai vechi decat cererea vin de la server, nu de la client', () => {
    const out = mergeChatHistory([row('you', 'server', 500)], [row('you', 'local stale', 400)], 1000)
    expect(out.map((r: any) => r.text)).toEqual(['server'])
  })

  it('nu dubleaza un rand pe care serverul deja il raporteaza', () => {
    const startedAt = 1000
    const r = row('omega', 'salut', 1500)
    const out = mergeChatHistory([row('you', 'vechi', 500), r], [r], startedAt)
    expect(out).toHaveLength(2)
  })

  it('fara nimic local, rezultatul e exact lista serverului', () => {
    const server = [row('you', 'a', 1), row('omega', 'b', 2)]
    expect(mergeChatHistory(server, [], 1000)).toBe(server)
    expect(mergeChatHistory(server, null, 1000)).toBe(server)
  })

  it('un rand FARA ts nu e tratat ca din 1970 — Number(null) e 0 si trece de isFinite', () => {
    expect(rowTs({ ts: null } as any)).toBeNull()
    expect(rowTs({ ts: undefined } as any)).toBeNull()
    expect(rowTs({ ts: '1500' } as any)).toBeNull()
    expect(rowTs({ ts: 0 } as any)).toBeNull()
    expect(rowTs(null)).toBeNull()
    // si deci nu e pastrat ca fiind "mai nou decat cererea"
    expect(mergeChatHistory([], [{ role: 'you', ts: null } as any], 1000)).toHaveLength(0)
  })

  it('un server care raspunde cu nimic NU sterge ce tocmai ai scris', () => {
    const out = mergeChatHistory([], [row('you', 'abia scris', 2000)], 1000)
    expect(out.map((r: any) => r.text)).toEqual(['abia scris'])
  })

  it('granita e inclusiva: un rand din aceeasi milisecunda cu plecarea cererii se pastreaza', () => {
    const out = mergeChatHistory([], [row('you', 'exact atunci', 1000)], 1000)
    expect(out).toHaveLength(1)
  })
})
