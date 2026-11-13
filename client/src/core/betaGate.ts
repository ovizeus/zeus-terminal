// ═══════════════════════════════════════════════════════════════════════════
// BETA — conturile 'viewer' vad chartul, indicatorii, datele de piata si
// lichidarile. Ce inseamna activitate e sub lacat pana la lansare.
// ═══════════════════════════════════════════════════════════════════════════
// [BETA-GATE 2026-11-13] ⚠️ Fisierul asta NU e poarta. Poarta e pe server
// (`server/middleware/viewerGate.js`): un viewer care ocoleste aplicatia tot
// primeste 403. Aici sunt doar lacatele si mesajul, ca omul sa inteleaga de ce
// un buton nu se deschide, in loc sa creada ca s-a stricat ceva.
//
// Pictogramele raman LA VEDERE, cu lacat — nu dispar. O aplicatie din care
// lipseste jumatate arata goala sau defecta; una cu lacate arata ce urmeaza.
//
// Text vizibil in ENGLEZA (R-P-10).

export type AccessLevel = 'viewer' | 'full'

export const BETA_MESSAGE =
    'Zeus Terminal is in beta. Trading tools open at public launch and are, for now, available to the Zeus Terminal team only.'
export const BETA_BADGE = 'BETA · view-only access'

/**
 * Nivelul din raspunsul `/auth/me`. Cade INCHIS: fara un 'full' explicit de la
 * server, contul e viewer. Adminul e mereu full.
 */
export function accessLevelFrom(me: { role?: unknown; accessLevel?: unknown } | null | undefined): AccessLevel {
    if (!me) return 'viewer'
    if (me.role === 'admin') return 'full'
    return me.accessLevel === 'full' ? 'full' : 'viewer'
}

// Pictogramele din dock care tin de activitate.
const LOCKED_DOCK: Record<string, string> = {
    'autotrade': 'AutoTrade',
    'manual-trade': 'Manual Trade',
    'dsl': 'DSL',
    'dsl-drive': 'DSL Drive',
    'omega': 'OMEGA',
    'multi-exchange': 'MultiExchange',
    'ares': 'ARES',
    'theia': 'THEIA',
    'postmortem': 'Post-Mortem',
    'pnllab': 'PnL Lab',
    'activity': 'Activity',
}

// Ferestrele (modale) care tin de activitate, plus BYOI.
const LOCKED_MODAL: Record<string, string> = {
    'byoi': 'Build Your Own Indicator',
    'compare': 'Compare',
    'decisionlog': 'Decision Log',
    'exposure': 'Exposure',
    'missed': 'Missed Trades',
    'performance': 'Performance',
    'regime': 'Regime History',
    'session': 'Session Review',
}

export function isDockLocked(id: string, level: AccessLevel): boolean {
    return level !== 'full' && Object.prototype.hasOwnProperty.call(LOCKED_DOCK, id)
}
export function isModalLocked(id: string, level: AccessLevel): boolean {
    return level !== 'full' && Object.prototype.hasOwnProperty.call(LOCKED_MODAL, id)
}
/** Numele aratat in mesaj; pentru un id necunoscut, un nume generic. */
export function lockedLabel(id: string): string {
    return LOCKED_DOCK[id] || LOCKED_MODAL[id] || 'This feature'
}

// Zonele de API care sunt sigur inchise pentru viewer. E o OGLINDA partiala a
// listei de pe server, folosita doar ca sa nu trimitem cereri pe care serverul
// le-ar refuza oricum (aplicatia veche le cere in bucla). Contine numai zone
// de activitate; tot ce nu e aici merge la server, care hotaraste.
const LOCKED_API: Array<[string, string]> = [
    ['/api/at/', 'AutoTrade'], ['/api/tc/', 'AutoTrade'], ['/api/panic', 'AutoTrade'],
    ['/api/order/', 'Trading'], ['/api/positions', 'Trading'], ['/api/balance', 'Trading'],
    ['/api/openOrders', 'Trading'], ['/api/leverage', 'Trading'], ['/api/manual/', 'Trading'],
    ['/api/addon', 'Trading'], ['/api/risk/', 'Trading'], ['/api/exchange/', 'Trading'],
    ['/api/ares/', 'ARES'], ['/api/user/ares', 'ARES'],
    ['/api/dsl/', 'DSL'], ['/api/dsldrive/', 'DSL'],
    ['/api/brain/', 'Brain'],
    ['/api/omega/', 'OMEGA'], ['/api/ring5/', 'OMEGA'],
    ['/api/journal', 'Journal'], ['/api/sync/journal', 'Journal'], ['/api/performance', 'Journal'], ['/api/session-review', 'Journal'],
    ['/api/compare', 'Journal'], ['/api/missed-trades', 'Journal'], ['/api/regime-history', 'Journal'],
    ['/api/exposure', 'Journal'], ['/api/dashboard', 'Journal'],
    ['/api/leaderboard', 'Leaderboard'],
]

/** Numele zonei inchise in care cade o cale de API, sau null daca nu e una. */
export function lockedApiFeature(url: string): string | null {
    let p = String(url || '')
    try { if (/^https?:/i.test(p)) p = new URL(p).pathname } catch { return null }
    p = p.split('?')[0].split('#')[0]
    if (!p.startsWith('/api/')) return null
    for (const [prefix, name] of LOCKED_API) {
        const bare = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
        if (p === bare || p.startsWith(prefix.endsWith('/') ? prefix : prefix + '/') || (!prefix.endsWith('/') && p === prefix)) return name
    }
    return null
}

// ── Starea mesajului (o singura fereastra, oriunde ar fi apasat butonul) ──
type Listener = (feature: string | null) => void
let _notice: string | null = null
const _listeners = new Set<Listener>()
let _level: AccessLevel = 'viewer'
// ⚠️ „Nu stim inca" nu e acelasi lucru cu „viewer". La pornire, pana raspunde
// `/auth/me`, nivelul e necunoscut — iar aplicatia veche trimite deja cereri.
// Daca garda de fetch le-ar opri pe atunci, le-ar opri si unui cont FULL, la
// fiecare reincarcare de pagina. Deci garda taie doar cand serverul a SPUS ca
// e viewer; cat timp nu stim, cererea pleaca si hotaraste serverul.
let _known = false

/** `known` = nivelul vine de la server, nu dintr-o presupunere. */
export function setAccessLevel(level: AccessLevel, known = true): void {
    _level = level === 'full' ? 'full' : 'viewer'
    _known = !!known
    try { document.body.classList.toggle('zeus-viewer', _known && _level !== 'full') } catch { /* fara DOM */ }
}
/** Inapoi la „nu stim" (logout). */
export function resetAccessLevel(): void { setAccessLevel('viewer', false) }
export function isAccessLevelKnown(): boolean { return _known }
export function getAccessLevel(): AccessLevel { return _level }
export function showBetaNotice(feature: string): void { _notice = feature || 'This feature'; _listeners.forEach((l) => l(_notice)) }
export function hideBetaNotice(): void { _notice = null; _listeners.forEach((l) => l(null)) }
export function currentBetaNotice(): string | null { return _notice }
export function onBetaNotice(l: Listener): () => void { _listeners.add(l); return () => { _listeners.delete(l) } }

/**
 * Inveleste `fetch` o singura data: pentru un cont confirmat 'viewer', o
 * cerere catre o zona inchisa primeste pe loc un 403 `beta_locked`, fara retea.
 *
 * ⚠️ Garda NU arata niciodata mesajul de beta. [2026-11-13] Prima varianta il
 * arata la orice SCRIERE refuzata, pe ideea ca „un buton neprevazut tot explica
 * de ce". In realitate aplicatia veche scrie singura, in fundal (sincronizare
 * de configuratie, rapoarte), deci fereastra sarea pe ecran fara ca omul sa fi
 * atins ceva — operatorul: „mesajele sunt abuzive, apar din cand in cand".
 * Mesajul apare DOAR la o apasare: pictograma din dock, o fereastra sub lacat,
 * comutatorul de mod. Garda tace.
 */
export function installBetaFetchGuard(target: { fetch: typeof fetch } = globalThis as any): void {
    const g = target as any
    if (!g || typeof g.fetch !== 'function' || g.__zeusBetaGuard) return
    const real: typeof fetch = g.fetch.bind(g)
    g.__zeusBetaGuard = true
    g.fetch = async (input: any, init?: any) => {
        if (_known && _level !== 'full') {
            const url = typeof input === 'string' ? input : (input && input.url) || String(input)
            const feature = lockedApiFeature(url)
            if (feature) {
                return new Response(JSON.stringify({ error: 'beta_locked', feature, message: BETA_MESSAGE }),
                    { status: 403, headers: { 'Content-Type': 'application/json' } })
            }
        }
        return real(input, init)
    }
}
