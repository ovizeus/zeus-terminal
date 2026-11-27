// [2026-11-27] Asteapta o promisiune cel mult `ms`. Nu o anuleaza (ex. inchiderea pozitiilor continua
// pe server) — doar spune interfetei sa nu mai stea agatata. „Close all" ramanea pe „Closing…" cat
// timp serverul intarzia (pana la 40 s pe 22 nov).
export type Timed<T> = { timedOut: false; value: T } | { timedOut: true }

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<Timed<T>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve({ timedOut: true }), ms)
    p.then((value) => { clearTimeout(t); resolve({ timedOut: false, value }) },
      (err) => { clearTimeout(t); reject(err) })
  })
}
