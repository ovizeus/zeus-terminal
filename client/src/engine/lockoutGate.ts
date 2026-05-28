// Task S8-P0-1 (2026-05-28) — Server-authoritative AT lockout gate helper.
//
// Consolidates the `w._serverATEnabled` check pattern (originally inline
// in autotrade.ts:664 and dsl.ts:75) into one testable place. Used by
// brain compute paths that must NOT mutate AT params or trigger trade
// decisions when the server is authoritative.
//
// Returns false on any access error (CSP, SSR, etc.) — fail-open to
// client-AT mode, since the gate is a DEFENSE layer for users who happen
// to be on server-AT. Users intentionally running CLIENT_AT mode must
// not regress.
//
// Strict === true check: truthy non-boolean values (1, 'true', etc.) do
// NOT lock the client. The flag is always set boolean by state.ts:1150
// and serverATCache (P0-3); any other value is a bug somewhere and we
// fail-safe to UNLOCKED.

export function serverOwnsAT(): boolean {
    try {
        if (typeof window === 'undefined') return false;
        return (window as any)._serverATEnabled === true;
    } catch (_) {
        return false;
    }
}
