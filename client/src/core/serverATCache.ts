// Task S8-P0-3 (2026-05-28) — Boot-time persistence for _serverATEnabled.
//
// The race: between client boot and the first /api/at/state response,
// w._serverATEnabled defaults to false (state.ts line 838). If the user
// triggers a manual trade or the brain cycle fires in that window, the
// client AT engine sees "no lockout" and may dispatch a trade even when
// the server is actually authoritative (SERVER_AT_TESTNET=true).
//
// Fix: persist the last known server-active state in localStorage. At
// boot, read it BEFORE any trading code runs and seed _serverATEnabled
// accordingly. Preboot response still overrides; this just closes the
// window between mount and first network response (~50-500ms).
//
// Storage key versioned (v1) so future schema changes can migrate cleanly.

const STORAGE_KEY = 'zeus._serverATEnabled.v1';

function _storage(): Storage | null {
    try {
        // typeof guard for non-browser contexts (SSR, jest without jsdom)
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch (_) {
        return null;
    }
}

/**
 * Read the cached server-AT-enabled flag. Returns false when:
 *  - No cached value (fresh install / first boot)
 *  - localStorage unavailable (non-browser, quota, security policy)
 *  - Cached value is anything other than the literal string 'true'
 *
 * Fail-safe default is false (UNLOCKED) to avoid regressing users who
 * intentionally run client-AT mode (CLIENT_AT=true, SERVER_AT=false).
 */
export function readCached(): boolean {
    const s = _storage();
    if (!s) return false;
    try {
        return s.getItem(STORAGE_KEY) === 'true';
    } catch (_) {
        return false;
    }
}

/**
 * Persist the current server-AT-enabled flag for next session.
 * Best-effort: failures (quota, security) swallowed silently.
 */
export function writeCached(value: boolean): void {
    const s = _storage();
    if (!s) return;
    try {
        s.setItem(STORAGE_KEY, String(!!value));
    } catch (_) {
        /* best-effort */
    }
}

/** Test helper — clears any in-module state (currently none, but reserved). */
export function _testReset(): void {
    /* no module-level state to reset; reserved for future caching layer */
}

// ── [2026-10-27] Aceeaşi cursă, pentru autoritatea pe DEMO ──
//
// Operatorul: „am 27 de poziţii pe demo deschise care tot dispar şi apar".
//
// Bucla, găsită cap-coadă: la fiecare pornire clientul îşi RESTAUREAZĂ
// poziţiile demo din starea salvată local (bootstrapStartApp), fiindcă în acel
// moment `w._serverATDemoEnabled` e încă `false` — răspunsul serverului n-a
// ajuns. Apoi vine instantaneul autoritar al serverului, care are ZERO poziţii
// demo, şi le şterge. La următorul refresh se restaurează din nou.
//
// Deci nu e nevoie de niciun flip de steag: e exact cursa pentru care a fost
// scris modulul ăsta, doar că flagul de demo n-avea memorie între sesiuni.

const DEMO_KEY = 'zeus._serverATDemoEnabled.v1';

/** Ultima valoare ştiută a autorităţii serverului pe demo. Implicit false. */
export function readCachedDemo(): boolean {
    const s = _storage();
    if (!s) return false;
    try {
        return s.getItem(DEMO_KEY) === 'true';
    } catch (_) {
        return false;
    }
}

/** O ţine minte pentru următoarea pornire. Best-effort, ca sora ei. */
export function writeCachedDemo(value: boolean): void {
    const s = _storage();
    if (!s) return;
    try {
        s.setItem(DEMO_KEY, String(!!value));
    } catch (_) {
        /* best-effort */
    }
}
