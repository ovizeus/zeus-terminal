/* ───────────────────────────────────────────────────────────────
   Zeus Terminal — anunţul de desen | 2026-10-24
   Un singur loc care spune, VIZIBIL, de ce nu s-a putut desena.

   De ce exista: trei runde de reparaturi pe „nu pot desena", si de fiecare data
   operatorul a vazut NIMIC. Fiecare cale de eşec era sau complet muta, sau anunţata
   printr-un toast de 12px, lipit jos-dreapta, care dispărea in 1,2 secunde. El intra
   de pe telefon. Nu a vazut niciodata vreun motiv, deci nici eu.

   Sta separat de drawingTools.ts dinadins: cand motivul eşecului E CHIAR ca modulul
   de desen nu s-a incarcat, mesajul trebuie sa vina de altundeva, altfel tace exact
   in cazul in care conteaza cel mai mult.
   ─────────────────────────────────────────────────────────────── */

export const DRAW_NOTICE_ID = 'zeus-draw-notice'

let _timer: any = null

/**
 * Arata un mesaj peste tot, centrat jos, lizibil, si fara sa fure atingerile.
 * Intoarce cate milisecunde rămâne pe ecran, ca durata sa fie verificabila.
 */
export function showDrawNotice(msg: string, ms = 3200): number {
  try {
    let el = document.getElementById(DRAW_NOTICE_ID)
    if (!el) {
      el = document.createElement('div')
      el.id = DRAW_NOTICE_ID
      document.body.appendChild(el)
    }
    // Centrat, nu in colţ; 14px, nu 12; si deasupra oricui (app.css nu trece de 10000).
    el.style.position = 'fixed'
    el.style.bottom = '84px'
    el.style.left = '50%'
    el.style.transform = 'translateX(-50%)'
    el.style.zIndex = '100002'
    el.style.maxWidth = '86vw'
    el.style.padding = '10px 16px'
    el.style.borderRadius = '10px'
    el.style.background = '#1a2530'
    el.style.border = '1px solid #f0c04055'
    el.style.color = '#f0c040'
    el.style.fontFamily = 'monospace'
    el.style.fontSize = '14px'
    el.style.lineHeight = '1.35'
    el.style.textAlign = 'center'
    el.style.pointerEvents = 'none'
    el.style.boxShadow = '0 4px 18px #0008'
    el.style.opacity = '1'
    el.textContent = msg
    clearTimeout(_timer)
    _timer = setTimeout(function () { if (el) el.style.opacity = '0' }, ms)
  } catch (_) { /* un anunţ, nu o functie: nu are voie sa doboare desenul */ }
  return ms
}
