'use strict';

// [BIN-TELEM 2026-05-19] Binance Telemetry — instrumentation pure, zero side
// effects pe call path. Capturăm: per-source counter, per-host weight,
// X-MBX-USED-WEIGHT-1M header (ground truth quota IP). Scop diagnosticare
// 429 rate-limit (incident 07:47:54 UTC 2026-05-19).
//
// In-memory ring buffer ultimele RING_WINDOW_MS (1h default). Pruning lazy
// la fiecare recordCall + la getSnapshot. Nu interferează cu request path —
// recordCall e sync, wrapFetch try/catch isolation.

const RING_WINDOW_MS = 60 * 60 * 1000;   // 1h
const ONE_MIN_MS = 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
const TOP_ENDPOINTS_N = 10;

let _bootTs = Date.now();
let _now = null;  // override for tests
let _ring = [];   // { ts, host, path, source, weight, status, latencyMs, usedWeight }
let _pollersProvider = null;
let _lastRateLogTs = {};  // 'host|status' → ts of last 429/418 WARN (anti log-spam)

function _ts() { return _now == null ? Date.now() : _now; }

function _prune() {
    const cutoff = _ts() - RING_WINDOW_MS;
    while (_ring.length && _ring[0].ts < cutoff) _ring.shift();
}

function recordCall(entry) {
    if (!entry || typeof entry !== 'object') return;
    _ring.push({
        ts: _ts(),
        host: entry.host || 'unknown',
        path: entry.path || '/',
        source: entry.source || 'unknown',
        weight: typeof entry.weight === 'number' ? entry.weight : 0,
        status: typeof entry.status === 'number' ? entry.status : 0,
        latencyMs: typeof entry.latencyMs === 'number' ? entry.latencyMs : 0,
        usedWeight: entry.blockedByPressure ? null : (typeof entry.usedWeight === 'number' ? entry.usedWeight : null),
        networkError: !!entry.networkError,
        blockedByPressure: !!entry.blockedByPressure,
        rejectedByScheduler: !!entry.rejectedByScheduler,
    });
    _prune();
}

// [Phase A.1 2026-05-19] Quota pressure gate. Reads X-MBX-USED-WEIGHT-1M
// (captured in byHost.lastUsedWeight) and blocks new requests when quota
// crosses threshold. Env overrides: BINANCE_QUOTA_CAP / BINANCE_QUOTA_BLOCK_PUBLIC_PCT / BINANCE_QUOTA_BLOCK_SIGNED_PCT.
function _intEnv(name, def) {
    const v = parseInt(process.env[name], 10);
    return Number.isFinite(v) && v > 0 ? v : def;
}
const QUOTA_CAP = _intEnv('BINANCE_QUOTA_CAP', 6000);
const BLOCK_PUBLIC_PCT = _intEnv('BINANCE_QUOTA_BLOCK_PUBLIC_PCT', 95);
const BLOCK_SIGNED_PCT = _intEnv('BINANCE_QUOTA_BLOCK_SIGNED_PCT', 97);

// X-MBX-USED-WEIGHT-1M is Binance's 1-MINUTE rolling counter. The telemetry ring
// keeps RING_WINDOW_MS = 1h of history, so trusting the "last reading" over that
// whole window let a single momentary spike (e.g. a reload boot burst at 104%)
// gate ALL analytics for up to an hour — and since blocked requests record
// usedWeight:null, no fresh reading ever arrived to clear it (self-sustaining
// deadlock). Only trust a reading from within ~1 Binance window (+margin).
const QUOTA_FRESHNESS_MS = 75 * 1000;

// [BOOT-STAGGER C 2026-06-05] The gate is otherwise BLIND at boot: pressure
// comes from response headers, but at t=0 nothing has responded yet → 0 →
// every lane fires freely → boot burst (the 418-ban class of incident,
// 2026-06-04/05). While the process is young AND no fresh reading exists for
// the host, assume conservative pressure: P5 defers, P4 sheds
// probabilistically, P0-P3 unaffected (0.85 < their thresholds). First real
// header for the host immediately replaces the assumption with truth.
const BOOT_BLIND_MS = 120 * 1000;
const BOOT_BLIND_PRESSURE = 0.85;

function getQuotaPressure(host) {
    _prune();
    const cutoff = _ts() - QUOTA_FRESHNESS_MS;
    // Most-recent usedWeight reading for this host. If it's stale (older than one
    // counter window) treat pressure as unknown so a real probe can go out
    // and refresh it, instead of blocking forever on an hour-old number.
    for (let i = _ring.length - 1; i >= 0; i--) {
        const e = _ring[i];
        if (e.host === host && e.usedWeight != null) {
            if (e.ts >= cutoff) return e.usedWeight / QUOTA_CAP;
            break; // most-recent reading is stale → pressure unknown
        }
    }
    // Unknown pressure: conservative during the boot-blind window, 0 after
    // (0 = let a probe refresh it — the stale-reading deadlock fix).
    if ((_ts() - _bootTs) < BOOT_BLIND_MS) return BOOT_BLIND_PRESSURE;
    return 0;
}

function isSignedSource(src) {
    if (typeof src !== 'string') return false;
    return src.startsWith('signer:') || src.startsWith('serverAT:');
}

function shouldBlockForPressure(host, src) {
    const pressure = getQuotaPressure(host);
    const cap = isSignedSource(src) ? (BLOCK_SIGNED_PCT / 100) : (BLOCK_PUBLIC_PCT / 100);
    return pressure >= cap;
}

function parseUsedWeight(headers) {
    if (!headers) return null;
    let raw = null;
    if (typeof headers.get === 'function') {
        raw = headers.get('x-mbx-used-weight-1m');
    } else if (typeof headers === 'object') {
        // Case-insensitive lookup over plain object
        for (const k of Object.keys(headers)) {
            if (k.toLowerCase() === 'x-mbx-used-weight-1m') { raw = headers[k]; break; }
        }
    }
    if (raw == null || raw === '') return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
}

// [BOOT-STAGGER D] Rate-limited (10s per host+status) persistent WARN for
// real rate-limit responses. Keep cheap and non-throwing.
const RATE_LOG_INTERVAL_MS = 10 * 1000;
function _logRateEvent(status, host, src, path, usedWeight) {
    try {
        const key = host + '|' + status;
        const now = _ts();
        if (_lastRateLogTs[key] != null && (now - _lastRateLogTs[key]) < RATE_LOG_INTERVAL_MS) return;
        _lastRateLogTs[key] = now;
        require('./logger').warn('BINANCE_RATE',
            `HTTP ${status} from ${host}${path} src=${src} usedWeight=${usedWeight != null ? usedWeight : '?'}/${QUOTA_CAP}` +
            (status === 418 ? ' — IP BAN response' : ' — rate limited'));
    } catch (_) { /* logging must never break the request path */ }
}

async function wrapFetch(fetchFn, url, opts) {
    const src = (opts && opts.__src) || 'unknown';
    let host = 'unknown', path = '/';
    try {
        const u = new URL(url);
        host = u.host;
        path = u.pathname;
    } catch (_) { /* leave defaults */ }

    // [Phase A.2 2026-05-19] Scheduler — priority lanes + critical section.
    // Sits BEFORE Phase A.1 gate so lane-based rejection fires earlier than
    // the binary header threshold. P0 (order ops) and P1 (recon) are never
    // rejected by the scheduler; P2-P5 follow threshold table.
    // When scheduler explicitly marks P0/P1 as accepted, bypass A.1 entirely —
    // P0 order ops must never be blocked even at extreme quota pressure.
    const pressure = getQuotaPressure(host);
    let _scheduler = null;
    let _skipA1 = false;  // set true when scheduler explicitly accepts P0/P1
    try { _scheduler = require('./binanceScheduler'); } catch (_) { _scheduler = null; }
    if (_scheduler) {
        const decision = _scheduler.canProceed({ pressure, src, path });
        if (!decision.accept) {
            recordCall({
                host, path, source: src,
                weight: 0,
                status: 503,
                latencyMs: 0,
                usedWeight: null,
                rejectedByScheduler: true,
            });
            const msg = `synthetic 503 scheduler backpressure — lane=${decision.lane} pressure=${(pressure * 100).toFixed(1)}% reason=${decision.reason}`;
            return {
                status: 503,
                ok: false,
                headers: { get: () => null },
                json: async () => ({
                    code: 'BINANCE_SCHEDULER_BACKPRESSURE',
                    lane: decision.lane,
                    pressure: decision.pressure,
                    retryable: !!decision.retryable,
                    synthetic: true,
                    reason: decision.reason,
                    msg,
                }),
            };
        }
        // P0 accepted by scheduler — skip A.1 gate (order execution is sacred,
        // must never be blocked even at extreme quota pressure).
        // NOTE: P1 (recon/listenKey) deliberately does NOT skip A.1 — at ≥97%
        // signed pressure even recon pauses to avoid earning the 418 ban
        // (behaviour pinned by binanceTelemetry.test.js "P1 DOES block at 97%").
        if (decision.lane === 'P0') _skipA1 = true;
    }

    // [Phase A.1 2026-05-19] Preemptive gate — if Binance reported usedWeight
    // is over threshold, refuse to issue the request and synthesize a 429
    // response. Caller (signer or public poller) handles 429 via existing
    // logic (binanceSigner._setIpBan fallback 60s; public next-tick retry).
    if (!_skipA1 && shouldBlockForPressure(host, src)) {
        const pressure = getQuotaPressure(host);
        const lastUsed = Math.round(pressure * QUOTA_CAP);
        recordCall({
            host, path, source: src,
            weight: 0,
            status: 429,
            latencyMs: 0,
            usedWeight: lastUsed,
            blockedByPressure: true,
        });
        const msg = `preemptive synthetic 429 — quota pressure ${(pressure * 100).toFixed(1)}% (lastUsedWeight=${lastUsed}/${QUOTA_CAP})`;
        return {
            status: 429,
            ok: false,
            headers: { get: (k) => k.toLowerCase() === 'x-mbx-used-weight-1m' ? String(lastUsed) : null },
            json: async () => ({ msg, code: -1003 }),
        };
    }

    const t0 = Date.now();
    try {
        const res = await fetchFn(url, opts);
        const latencyMs = Date.now() - t0;
        const usedWeight = parseUsedWeight(res && res.headers);
        recordCall({
            host, path, source: src,
            weight: (opts && typeof opts.__weight === 'number') ? opts.__weight : 0,
            status: res ? res.status : 0,
            latencyMs,
            usedWeight,
        });
        // [BOOT-STAGGER D 2026-06-05] Real 429/418 were INVISIBLE in logs —
        // the 2026-06-05 06:06 pre-restart ban left zero trace of who earned
        // it. WARN-log them persistently (rate-limited per host+status).
        if (res && (res.status === 429 || res.status === 418)) {
            _logRateEvent(res.status, host, src, path, usedWeight);
        }
        return res;
    } catch (err) {
        const latencyMs = Date.now() - t0;
        recordCall({
            host, path, source: src,
            weight: 0,
            status: 0,
            latencyMs,
            networkError: true,
        });
        throw err;
    }
}

function _aggregateBySource() {
    _prune();
    const out = {};
    for (const e of _ring) {
        if (!out[e.source]) {
            out[e.source] = { calls: 0, weightSum: 0, errors2xx: 0, errors4xx: 0, errors5xx: 0, networkErrors: 0, latencySum: 0, blockedByPressure: 0, rejectedByScheduler: 0 };
        }
        const s = out[e.source];
        s.calls++;
        s.weightSum += e.weight;
        s.latencySum += e.latencyMs;
        if (e.blockedByPressure) s.blockedByPressure++;
        if (e.rejectedByScheduler) s.rejectedByScheduler++;
        if (e.networkError) s.networkErrors++;
        else if (e.status >= 200 && e.status < 300) {
            // Successes — but flag 200s only with non-ok-aware status (treat 2xx as success)
            // Per spec test: errors2xx counts ALL 2xx responses (the name "errors2xx" is
            // unfortunate; it's really "responses2xx"). Test asserts 1 for status=200.
            s.errors2xx++;
        } else if (e.status >= 400 && e.status < 500) s.errors4xx++;
        else if (e.status >= 500) s.errors5xx++;
    }
    return out;
}

function _aggregateByHost() {
    _prune();
    const out = {};
    for (const e of _ring) {
        if (!out[e.host]) out[e.host] = { calls: 0, weightSum: 0, peakUsedWeight: 0, lastUsedWeight: null };
        const h = out[e.host];
        h.calls++;
        h.weightSum += e.weight;
        if (e.usedWeight != null) {
            if (e.usedWeight > h.peakUsedWeight) h.peakUsedWeight = e.usedWeight;
            h.lastUsedWeight = e.usedWeight;
        }
    }
    return out;
}

function _topEndpoints() {
    _prune();
    const counts = new Map();
    for (const e of _ring) {
        const k = e.host + '|' + e.path;
        const v = counts.get(k) || { host: e.host, path: e.path, calls: 0 };
        v.calls++;
        counts.set(k, v);
    }
    return Array.from(counts.values())
        .sort((a, b) => b.calls - a.calls)
        .slice(0, TOP_ENDPOINTS_N);
}

function _countSince(sinceMs) {
    _prune();
    const cutoff = _ts() - sinceMs;
    let n = 0;
    for (const e of _ring) if (e.ts >= cutoff) n++;
    return n;
}

function registerActivePollersProvider(fn) {
    _pollersProvider = typeof fn === 'function' ? fn : null;
}

function getSnapshot() {
    _prune();
    let activePollers = null;
    if (_pollersProvider) {
        try { activePollers = _pollersProvider(); } catch (_) { activePollers = null; }
    }
    const byHost = _aggregateByHost();
    const quotaPressure = {};
    for (const host of Object.keys(byHost)) {
        // Mirror the LIVE gate (freshness-filtered) so the diagnostic snapshot
        // can't show a stale-high 104% while the gate is actually passing
        // traffic — that mismatch is what made the deadlock hard to read.
        quotaPressure[host] = getQuotaPressure(host);
    }
    // [BOOT-STAGGER review fix] During boot-blind there may be NO ring entries
    // yet for a host (byHost empty) while the live gate is returning 0.85 —
    // an operator watching the snapshot right after a reload would see 0% and
    // conclude the gate is clear while P4/P5 are actually being shed. Surface
    // the synthetic pressure for the known Binance hosts too.
    for (const knownHost of ['fapi.binance.com', 'testnet.binancefuture.com']) {
        if (!(knownHost in quotaPressure)) quotaPressure[knownHost] = getQuotaPressure(knownHost);
    }
    let schedulerStats = null;
    let activeCriticalSections = 0;
    try {
        const sch = require('./binanceScheduler');
        schedulerStats = sch.getStats();
        activeCriticalSections = sch.getActiveCriticalSections();
    } catch (_) { /* optional */ }
    return {
        bootTs: _bootTs,
        uptimeMs: _ts() - _bootTs,
        totalCalls: _ring.length,
        callsPer1min: _countSince(ONE_MIN_MS),
        callsPer5min: _countSince(FIVE_MIN_MS),
        bySource: _aggregateBySource(),
        byHost,
        topEndpoints: _topEndpoints(),
        activePollers,
        quotaPressure,
        quotaThresholds: {
            cap: QUOTA_CAP,
            blockPublicPct: BLOCK_PUBLIC_PCT,
            blockSignedPct: BLOCK_SIGNED_PCT,
        },
        schedulerStats,
        activeCriticalSections,
    };
}

// ─── Test helpers ───
function _resetForTest() {
    _ring = [];
    _now = null;
    _pollersProvider = null;
    _lastRateLogTs = {};
    // Default tests to STEADY-STATE (boot-blind window long past). Suites that
    // exercise the boot-blind window set _setBootTsForTest explicitly.
    _bootTs = 0;
}
function _setNowForTest(ts) { _now = ts; }
function _setBootTsForTest(ts) { _bootTs = ts; }

module.exports = {
    recordCall,
    parseUsedWeight,
    getQuotaPressure,
    isSignedSource,
    shouldBlockForPressure,
    wrapFetch,
    registerActivePollersProvider,
    getSnapshot,
    _resetForTest,
    _setNowForTest,
    _setBootTsForTest,
};
