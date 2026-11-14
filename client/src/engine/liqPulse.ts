// ═══════════════════════════════════════════════════════════════════════════
// PULSUL LICHIDARILOR — cat s-a lichidat ACUM, pe moneda din chart, fata de
// normalul ei
// ═══════════════════════════════════════════════════════════════════════════
// [2026-11-14] Cadranul LIQ din cockpit aduna lichidarile TUTUROR monedelor din
// ultimul minut si le raporta la un prag fix de 1 milion $. Doua probleme:
//   - pragul fix nu inseamna nimic: 1 milion $/minut e liniste pe BTC si
//     cutremur pe o moneda mica;
//   - trecea prin filtrul personal `liqMinUsd`, deci doi oameni vedeau cifre
//     diferite pentru aceeasi piata.
// Aici: evenimentele fluxului de pe server, nefiltrate, pe moneda din chart,
// pe 5 minute, masurate fata de media acelei monede din ultimele 24 de ore.
//
// Functiile de calcul sunt pure; starea (inelul de evenimente si media) e
// tinuta separat, jos.

export type LiqTick = { symbol: string; usd: number; isLong: boolean; ts: number }
export type LiqPulse = { usd: number; longUsd: number; shortUsd: number; n: number }

export const PULSE_WINDOW_MS = 5 * 60_000
export const BALANCE_WINDOW_MS = 15 * 60_000
const KEEP_MS = 20 * 60_000
const MAX_EVENTS = 6000

/** Ce s-a lichidat pe `symbol` in ultimele `windowMs`. */
export function pulseOf(events: LiqTick[], symbol: string, now: number, windowMs: number): LiqPulse {
    const out: LiqPulse = { usd: 0, longUsd: 0, shortUsd: 0, n: 0 }
    if (!Array.isArray(events) || !symbol || !(windowMs > 0)) return out
    const cutoff = now - windowMs
    for (const e of events) {
        if (!e || e.symbol !== symbol) continue
        const usd = Number(e.usd), ts = Number(e.ts)
        if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(ts) || ts < cutoff || ts > now + 5000) continue
        out.usd += usd
        if (e.isLong) out.longUsd += usd; else out.shortUsd += usd
        out.n++
    }
    return out
}

/**
 * Scorul 0..100 al cadranului: de cate ori e fereastra peste media ei.
 * Media (×1) → 25, dublul → 50, de patru ori sau mai mult → 100.
 * Fara medie cunoscuta → null: cadranul ramane gol, nu inventeaza o scara.
 */
export function liqPulseScore(windowUsd: number, baselineUsd: number | null | undefined): number | null {
    const b = Number(baselineUsd)
    if (!Number.isFinite(b) || b <= 0) return null
    const u = Number(windowUsd)
    if (!Number.isFinite(u) || u <= 0) return 0
    return Math.max(0, Math.min(100, Math.round((u / b) * 25)))
}

/** Media pe o fereastra de `windowMs`, din totalul si vechimea datelor de pe server. */
export function baselinePerWindow(totalUsd: number, sinceTs: number, now: number, windowMs: number, maxSpanMs = 86_400_000): number | null {
    const tot = Number(totalUsd), since = Number(sinceTs)
    if (!Number.isFinite(tot) || tot <= 0 || !Number.isFinite(since) || since <= 0 || !(windowMs > 0)) return null
    const span = Math.min(maxSpanMs, now - since)
    // Sub o ora de istoric, „media" ar fi cateva evenimente: nu e o medie.
    if (!(span >= 3_600_000)) return null
    return tot / (span / windowMs)
}

/** Cat la suta din fereastra sunt longuri lichidate; null daca nu s-a lichidat nimic. */
export function longSharePct(p: LiqPulse): number | null {
    return p && p.usd > 0 ? Math.round((p.longUsd / p.usd) * 100) : null
}

export function fmtUsdShort(v: number): string {
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) return '$0'
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M'
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K'
    return '$' + Math.round(n)
}

// ── Starea ─────────────────────────────────────────────────────────────────
let _events: LiqTick[] = []
let _lastPrune = 0
const _baseline = new Map<string, { usd: number | null; at: number }>()
const _inflight = new Set<string>()
const BASELINE_TTL_MS = 5 * 60_000

/** Chemata pentru FIECARE lichidare venita de pe fluxul serverului. */
export function recordLiq(e: { symbol?: unknown; usd?: unknown; isLong?: unknown; ts?: unknown }): void {
    const symbol = typeof e?.symbol === 'string' ? e.symbol.toUpperCase() : ''
    const usd = Number(e?.usd), ts = Number(e?.ts)
    if (!symbol || !Number.isFinite(usd) || usd <= 0 || !Number.isFinite(ts) || ts <= 0) return
    _events.push({ symbol, usd, isLong: !!e.isLong, ts })
    if (_events.length > MAX_EVENTS) _events = _events.slice(-Math.floor(MAX_EVENTS * 0.8))
}

/** Evenimentele pastrate, dupa ce le arunca pe cele prea vechi. */
export function recentLiqs(now: number): LiqTick[] {
    // Evenimentele NU vin in ordinea timpului (incalzirea de la pornire le
    // reda pe bursa), deci „primul e vechi?" nu spune nimic: se cerne tot, cel
    // mult o data la 5 secunde.
    if (now - _lastPrune >= 5000 || now < _lastPrune) {
        const cutoff = now - KEEP_MS
        _events = _events.filter((e) => e.ts >= cutoff)
        _lastPrune = now
    }
    return _events
}

export function baselineOf(symbol: string): number | null {
    const b = _baseline.get(symbol)
    return b ? b.usd : null
}

/**
 * Improspateaza media monedei, cel mult o data la 5 minute. Nu arunca si nu se
 * asteapta: cadranul foloseste ce are.
 */
export function refreshBaseline(symbol: string, price: number, now: number, fetchImpl?: typeof fetch): void {
    if (!symbol || !(price > 0)) return
    const cur = _baseline.get(symbol)
    if ((cur && now - cur.at < BASELINE_TTL_MS) || _inflight.has(symbol)) return
    const f = fetchImpl || (typeof fetch === 'function' ? fetch : null)
    if (!f) return
    _inflight.add(symbol)
    const url = `/api/market/liq-panel?symbol=${encodeURIComponent(symbol)}&ref=${encodeURIComponent(String(price))}&days=1&cols=12`
    Promise.resolve(f(url, { credentials: 'same-origin' } as RequestInit))
        .then((r: any) => (r && r.ok ? r.json() : null))
        .then((j: any) => {
            const st = j && j.stats
            const usd = st ? baselinePerWindow(st.totalUsd, st.since, Date.now(), PULSE_WINDOW_MS) : null
            _baseline.set(symbol, { usd, at: Date.now() })
        })
        .catch(() => { _baseline.set(symbol, { usd: cur ? cur.usd : null, at: Date.now() }) })
        .finally(() => { _inflight.delete(symbol) })
}

export function _resetLiqPulseForTest(): void { _events = []; _lastPrune = 0; _baseline.clear(); _inflight.clear() }
