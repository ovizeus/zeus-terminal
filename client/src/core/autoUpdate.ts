// ═══════════════════════════════════════════════════════════════════════════
// ACTUALIZARE AUTOMATA — fiecare utilizator ajunge singur pe versiunea curenta
// ═══════════════════════════════════════════════════════════════════════════
// [2026-11-15] Pana acum, dupa fiecare build, omul trebuia sa inchida si sa
// redeschida aplicatia ca sa vada schimbarea. Exista o verificare veche
// (`_checkAppUpdate`), dar se uita doar la versiunea SERVERULUI si cerea o
// apasare pe „INSTALL" — iar cele mai multe livrari sunt doar de aplicatie si
// nu schimba versiunea serverului, deci nici macar nu le vedea.
//
// Aici semnalul e pachetul insusi: pagina-coaja (`/app/index.html`, servita
// fara cache) numeste pachetul curent (`assets/index-<hash>.js`). Daca numele
// difera de cel incarcat, exista o versiune noua si aplicatia se reincarca
// SINGURA — dar nu peste mana omului:
//   - in fundal (tab ascuns): pe loc;
//   - in fata: cand omul nu a atins nimic de 20 de secunde, nu scrie intr-un
//     camp si nu are o fereastra deschisa;
//   - altfel asteapta, cu o banda mica „Update now".
// O reincarcare care nu a adus pachetul nou NU se repeta (fara bucla).
//
// Functiile de decizie sunt pure; partea care atinge pagina e jos.

export const CHECK_EVERY_MS = 60_000
export const IDLE_NEEDED_MS = 20_000
const TRIED_KEY = 'zeus_autoupdate_tried'
const DONE_KEY = 'zeus_autoupdate_done'

/** Numele pachetului principal dintr-o pagina-coaja. */
export function bundleIdFromHtml(html: unknown): string | null {
    const m = /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(String(html || ''))
    return m ? m[1] : null
}

/** Numele pachetului care ruleaza acum, citit din pagina. */
export function currentBundleId(doc: Document = document): string | null {
    try {
        for (const s of Array.from(doc.querySelectorAll('script[src]'))) {
            const id = bundleIdFromHtml(s.getAttribute('src'))
            if (id) return id
        }
    } catch { /* fara DOM */ }
    return null
}

export type UpdateDecision = 'none' | 'reload' | 'wait'

/**
 * Ce se face acum. `tried` = pachetul pentru care am reincarcat deja o data in
 * sesiunea asta: daca tot nu-l avem, nu mai incercam (altfel ar fi o bucla).
 */
export function decideUpdate(i: {
    current: string | null; latest: string | null; tried: string | null
    hidden: boolean; idleMs: number; typing: boolean; modalOpen: boolean
}): UpdateDecision {
    if (!i.current || !i.latest || i.latest === i.current) return 'none'
    if (i.tried && i.tried === i.latest) return 'none'
    if (i.hidden) return 'reload'
    if (i.typing || i.modalOpen) return 'wait'
    return i.idleMs >= IDLE_NEEDED_MS ? 'reload' : 'wait'
}

// ── Partea care atinge pagina ──────────────────────────────────────────────
let _started = false
let _lastActivity = Date.now()
let _latest: string | null = null
let _checkTimer: ReturnType<typeof setInterval> | null = null
let _waitTimer: ReturnType<typeof setInterval> | null = null

function _typing(): boolean {
    try {
        const a = document.activeElement as HTMLElement | null
        if (!a) return false
        const tag = (a.tagName || '').toLowerCase()
        return tag === 'input' || tag === 'textarea' || tag === 'select' || a.isContentEditable === true
    } catch { return false }
}

function _modalOpen(): boolean {
    try {
        // Orice fereastra a aplicatiei (.mover vizibil), ecranul de PIN sau panoul de admin.
        const movers = Array.from(document.querySelectorAll<HTMLElement>('.mover, .zac, #pinLockScreen, .zbeta-ov'))
        return movers.some((m) => m.offsetParent !== null || getComputedStyle(m).display !== 'none')
    } catch { return false }
}

function _get(key: string): string | null { try { return sessionStorage.getItem(key) } catch { return null } }
function _set(key: string, v: string): void { try { sessionStorage.setItem(key, v) } catch { /* mod privat */ } }
function _del(key: string): void { try { sessionStorage.removeItem(key) } catch { /* mod privat */ } }

function _reload(): void {
    if (_latest) { _set(TRIED_KEY, _latest); _set(DONE_KEY, _latest) }
    try { location.reload() } catch { /* nimic de facut */ }
}

function _banner(show: boolean): void {
    const id = 'zeus-autoupdate-bar'
    let el = document.getElementById(id)
    if (!show) { if (el) el.remove(); return }
    if (el) return
    el = document.createElement('div')
    el.id = id
    el.setAttribute('role', 'status')
    el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:2000001;' +
        'display:flex;align-items:center;gap:12px;padding:9px 12px 9px 14px;border-radius:10px;' +
        'background:rgba(13,20,28,.96);border:1px solid #2a3b4b;box-shadow:0 10px 34px rgba(0,0,0,.55);' +
        "font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:12.5px;color:#c4cfda;max-width:calc(100vw - 24px)"
    const txt = document.createElement('span')
    txt.textContent = 'A new version is ready — it will load when you pause.'
    const btn = document.createElement('button')
    btn.textContent = 'Update now'
    btn.style.cssText = 'flex:0 0 auto;padding:6px 12px;border-radius:7px;border:1px solid rgba(143,180,217,.5);' +
        'background:rgba(143,180,217,.14);color:#e9eef4;font:600 12px inherit;cursor:pointer'
    btn.onclick = () => _reload()
    el.appendChild(txt); el.appendChild(btn)
    document.body.appendChild(el)
}

function _evaluate(): void {
    const d = decideUpdate({
        current: currentBundleId(), latest: _latest, tried: _get(TRIED_KEY),
        hidden: typeof document !== 'undefined' && document.hidden === true,
        idleMs: Date.now() - _lastActivity, typing: _typing(), modalOpen: _modalOpen(),
    })
    if (d === 'reload') { _banner(false); _reload(); return }
    if (d === 'wait') {
        _banner(true)
        if (!_waitTimer) _waitTimer = setInterval(_evaluate, 5000)
        return
    }
    _banner(false)
    if (_waitTimer) { clearInterval(_waitTimer); _waitTimer = null }
}

async function _check(): Promise<void> {
    try {
        const r = await fetch('/app/index.html?nc=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' })
        if (!r || !r.ok) return
        const id = bundleIdFromHtml(await r.text())
        if (!id) return                       // pagina de login sau altceva: nu e coaja aplicatiei
        _latest = id
        _evaluate()
    } catch { /* fara retea: la urmatoarea verificare */ }
}

/** Porneste verificarea. Se cheama o singura data, la pornirea aplicatiei. */
export function startAutoUpdate(): void {
    if (_started || typeof window === 'undefined' || typeof document === 'undefined') return
    _started = true
    // Dupa o reincarcare facuta de noi: daca pachetul nou chiar ruleaza, spunem o data.
    const done = _get(DONE_KEY)
    if (done) {
        _del(DONE_KEY)
        if (currentBundleId() === done) {
            _del(TRIED_KEY)
            setTimeout(() => {
                import('../data/marketDataHelpers').then((m) => m.toast('Zeus Terminal updated to the latest version', 4000)).catch(() => { /* afisaj */ })
            }, 2500)
        }
    }
    const bump = () => { _lastActivity = Date.now() }
    for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) window.addEventListener(ev, bump, { passive: true, capture: true })
    document.addEventListener('visibilitychange', () => { if (document.hidden) _evaluate(); else void _check() })
    window.addEventListener('online', () => { void _check() })
    _checkTimer = setInterval(() => { void _check() }, CHECK_EVERY_MS)
    setTimeout(() => { void _check() }, 15_000)
}

export function _stopAutoUpdateForTest(): void {
    if (_checkTimer) clearInterval(_checkTimer)
    if (_waitTimer) clearInterval(_waitTimer)
    _checkTimer = null; _waitTimer = null; _started = false; _latest = null
}
