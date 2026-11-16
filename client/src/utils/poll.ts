// [2026-11-16] Bucla de cereri cu doua garzi (furtuna de cereri, investigata dupa b389).
// Ce s-a vazut: telefonul in fundal ~2 min — Android tine reteaua oprita, dar intervalele
// panourilor tot pornesc cereri; ele stau la coada si la revenire pleaca TOATE deodata
// (724 de cereri in 20 s, 17:14). Aici:
//   1. nu porneste o cerere noua cat cea dinainte n-a raspuns (coada nu se mai poate forma);
//   2. cat aplicatia e ascunsa nu cere nimic (cu `runHidden` — pentru fluxurile de pret — da);
//   3. la revenire cere O SINGURA data, imediat.
// O cerere blocata nu tine bucla oprita la nesfarsit: dupa `stuckMs` se accepta una noua.
import { isTabVisible, onVisibilityChange } from './tabVisibility'

export interface PollOpts {
  /** Ruleaza si cu aplicatia ascunsa (garda 1 ramane). Implicit: nu. */
  runHidden?: boolean
  /** Prima rulare imediat. Implicit: da. */
  immediate?: boolean
  /** Dupa cat timp o cerere fara raspuns nu mai blocheaza bucla. Implicit: max(30 s, 10 × ms). */
  stuckMs?: number
}

export function startPoll(fn: () => unknown, ms: number, opts: PollOpts = {}): () => void {
  const stuckMs = opts.stuckMs ?? Math.max(30_000, ms * 10)
  let busySince = 0
  let stopped = false
  const tick = async (): Promise<void> => {
    if (stopped) return
    if (busySince && Date.now() - busySince < stuckMs) return
    if (!opts.runHidden && !isTabVisible()) return
    const mine = Date.now()
    busySince = mine
    try { await fn() } catch { /* fiecare panou isi trateaza erorile */ } finally { if (busySince === mine) busySince = 0 }
  }
  const id = setInterval(() => { void tick() }, ms)
  const off = opts.runHidden ? () => {} : onVisibilityChange((v) => { if (v) void tick() })
  if (opts.immediate !== false) void tick()
  return () => { stopped = true; clearInterval(id); off() }
}
