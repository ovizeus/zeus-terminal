// [2026-11-15] Lacatul de PIN apare din PRIMUL cadru, nu dupa ce s-a incarcat
// aplicatia.
//
// Operatorul: „ies cu totul din Zeus, intru, se incarca, intra in aplicatie si
// abia dupa 1,5–2 secunde imi cere amprenta sau codul — nu trebuie sa intre in
// aplicatie si apoi sa pun amprenta". Cauza: verificarea PIN-ului intreba
// serverul abia la capatul pornirii (`startApp`, dupa mai multe cereri
// asteptate), iar aplicatia era deja pe ecran.
//
// Acum dispozitivul tine minte, pe cont, ca acel cont are PIN. La autentificare,
// daca stie ca are si sesiunea nu e deblocata, lacatul e pus ODATA cu aplicatia.
// Serverul ramane cel care hotaraste: daca spune ca nu exista PIN, lacatul se
// ridica si semnul se sterge. Semnul nu poate deschide nimic — doar inchide mai
// devreme.
//
// Cheia poarta id-ul contului (`zeus_pin_hint:<uid>`) si se citeste cu functiile
// NEscopate ale browserului, ca sa fie aceeasi inainte si dupa ce state.ts isi
// pune scoparea pe localStorage.
import { usePinLockStore } from '../stores/pinLockStore'

const w = window as any
const PREFIX = 'zeus_pin_hint:'
const UNLOCKED = 'zeus_pin_unlocked'

function _get(k: string): string | null {
    try { return (typeof w._lsOrigGet === 'function' ? w._lsOrigGet(k) : localStorage.getItem(k)) } catch { return null }
}
function _set(k: string, v: string): void {
    try { if (typeof w._lsOrigSet === 'function') w._lsOrigSet(k, v); else localStorage.setItem(k, v) } catch { /* mod privat */ }
}
function _del(k: string): void {
    try { if (typeof w._lsOrigRemove === 'function') w._lsOrigRemove(k); else localStorage.removeItem(k) } catch { /* mod privat */ }
}

export function currentUid(): string | null {
    const u = w._zeusUserId
    if (u !== undefined && u !== null && String(u) !== '') return String(u)
    try { const m = /(?:^|;\s*)zeus_uid=([^;]+)/.exec(document.cookie || ''); return m ? decodeURIComponent(m[1]) : null } catch { return null }
}

export function pinHintGet(uid: string | null | undefined): boolean {
    return !!uid && _get(PREFIX + uid) === '1'
}
export function pinHintSet(uid: string | null | undefined, hasPin: boolean): void {
    if (!uid) return
    if (hasPin) _set(PREFIX + uid, '1'); else _del(PREFIX + uid)
}

export function sessionUnlocked(): boolean {
    try { return sessionStorage.getItem(UNLOCKED) === '1' } catch { return false }
}

/** Chemata la autentificare: daca acest cont are PIN si sesiunea nu e deblocata, pune lacatul acum. */
export function lockEarlyIfKnown(uid: string | null | undefined): boolean {
    if (!pinHintGet(uid) || sessionUnlocked()) return false
    usePinLockStore.getState().setMessage('')
    usePinLockStore.getState().setVisible(true)
    return true
}
