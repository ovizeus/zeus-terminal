'use strict';

/**
 * Binance Rate-Limit State — persistent across PM2 reloads.
 *
 * Persistence layer for the IP circuit breaker + token bucket. The state
 * lives in DB (`binance_rate_state` single-row table) so PM2 reloads cannot
 * cause a "restart amnesia" cycle where the new process forgets it was
 * already banned and triggers another ban probe.
 *
 * Hot counters live in memory between checkpoints; checkpoints fire every
 * 5s plus on critical events (ban, shutdown, heavy endpoint, threshold).
 *
 * The state machine governs transitions:
 *   NORMAL ↔ WARM ↔ SUPPRESSED
 * with anti-flap and warm-resume early-abort guards (see ./binanceRateState/* TBD).
 *
 * This module exposes pure-ish helpers; the integrating modules
 * (binanceSigner, binanceScheduler) own the actual request gating.
 */

function _getDb() {
  // Lazy require so jest.doMock can intercept.
  return require('./database').db;
}

const DEFAULT_STATE = Object.freeze({
  banned_until: 0,
  ban_reason: null,
  warm_until: 0,
  used_weight_1m: 0,
  used_weight_ts: null,
  burst_calls_10s: 0,
  burst_window_start: null,
  last_heavy_endpoint_ts: null,
  resume_generation: 1,
  consecutive_ban_count: 0,
  last_ban_at: null,
});

/**
 * Load persisted state from DB, returning DEFAULT_STATE if no row exists.
 *
 * @returns {object} state snapshot (plain object, mutable copy of defaults)
 */
function load() {
  const db = _getDb();
  let row;
  try {
    row = db.prepare(`SELECT * FROM binance_rate_state WHERE scope = 'global'`).get();
  } catch (_err) {
    // Migration not yet applied OR DB unreachable → fall back to defaults.
    return { ...DEFAULT_STATE };
  }
  if (!row) return { ...DEFAULT_STATE };
  return {
    banned_until: row.banned_until ?? 0,
    ban_reason: row.ban_reason ?? null,
    warm_until: row.warm_until ?? 0,
    used_weight_1m: row.used_weight_1m ?? 0,
    used_weight_ts: row.used_weight_ts ?? null,
    burst_calls_10s: row.burst_calls_10s ?? 0,
    burst_window_start: row.burst_window_start ?? null,
    last_heavy_endpoint_ts: row.last_heavy_endpoint_ts ?? null,
    resume_generation: row.resume_generation ?? 1,
    consecutive_ban_count: row.consecutive_ban_count ?? 0,
    last_ban_at: row.last_ban_at ?? null,
  };
}

const PERSISTED_COLUMNS = [
  'banned_until',
  'ban_reason',
  'warm_until',
  'used_weight_1m',
  'used_weight_ts',
  'burst_calls_10s',
  'burst_window_start',
  'last_heavy_endpoint_ts',
  'resume_generation',
  'consecutive_ban_count',
  'last_ban_at',
];

/**
 * Persist a partial state update. Fields not included in `partial` retain
 * their current persisted value (read-then-write on the single global row).
 *
 * Always touches `updated_at`.
 *
 * @param {object} partial — subset of state fields to update
 */
function save(partial) {
  const db = _getDb();
  const current = load();
  const merged = { ...current, ...partial };
  const updatedAt = Date.now();

  // UPSERT — single row scope='global'
  const colNames = PERSISTED_COLUMNS.join(', ');
  const colPlaceholders = PERSISTED_COLUMNS.map(() => '?').join(', ');
  const colSetters = PERSISTED_COLUMNS.map(c => `${c}=excluded.${c}`).join(', ');

  db.prepare(`
    INSERT INTO binance_rate_state (scope, ${colNames}, updated_at)
    VALUES ('global', ${colPlaceholders}, ?)
    ON CONFLICT(scope) DO UPDATE SET
      ${colSetters},
      updated_at = excluded.updated_at
  `).run(...PERSISTED_COLUMNS.map(c => merged[c]), updatedAt);
}

// ─── Mode state machine ────────────────────────────────────────────────────
//
// NORMAL      : default — full traffic allowed
// SUPPRESSED  : ban active, ALL outbound Binance traffic blocked
// WARM        : ban expired but ramp-up window active (conservative quota)
//
// Transitions:
//   NORMAL   → SUPPRESSED    on 418/429 detected (recordBan)
//   SUPPRESSED → WARM         on ban_until elapsed (startWarmResume)
//   WARM     → SUPPRESSED    on 418/429 during warm phase (early abort)
//   WARM     → NORMAL        on warm_until elapsed (clearWarm)

/**
 * Compute current mode from state snapshot.
 * @param {object} s — must have banned_until, warm_until
 * @param {number} now — current epoch ms
 * @returns {'NORMAL'|'SUPPRESSED'|'WARM'}
 */
function computeCurrentMode(s, now) {
  if (s.banned_until > now) return 'SUPPRESSED';
  if ((s.warm_until || 0) > now) return 'WARM';
  return 'NORMAL';
}

// ─── Exponential cooldown with anti-pattern jitter ────────────────────────

const WARM_DURATION_BASE_MS = Object.freeze([
  120_000,    // strike 0: 2 min
  300_000,    // strike 1: 5 min
  900_000,    // strike 2: 15 min
  1_800_000,  // strike 3+: 30 min (cap)
]);
const WARM_JITTER_MAX_PCT = 0.15;

/**
 * Compute warm-resume duration based on consecutive ban strikes.
 * Strikes >= 2 add up to ±15% jitter to defeat any periodic pattern
 * detection by Binance's anti-abuse layer.
 *
 * @param {number} strikes — consecutive_ban_count
 * @returns {number} duration in ms
 */
function computeWarmDuration(strikes) {
  const idx = Math.min(strikes, WARM_DURATION_BASE_MS.length - 1);
  const base = WARM_DURATION_BASE_MS[idx];
  if (strikes < 2) return base;
  return base + Math.floor(Math.random() * base * WARM_JITTER_MAX_PCT);
}

// ─── Ban management ────────────────────────────────────────────────────────

const STRIKE_RESET_AFTER_MS = 4 * 3600 * 1000; // 4h clean window resets strikes

/**
 * Record a ban event.
 * - Sets banned_until (never shrinks — only extends to longer deadline)
 * - Increments consecutive_ban_count if last_ban was within STRIKE_RESET_AFTER_MS,
 *   otherwise resets to 1
 * - Updates last_ban_at and ban_reason
 *
 * @param {object} opts
 * @param {number} opts.bannedUntil — epoch ms when ban expires
 * @param {string} opts.reason
 * @param {number} opts.now
 */
function recordBan({ bannedUntil, reason, now }) {
  const current = load();
  const newBannedUntil = Math.max(current.banned_until, bannedUntil);

  let strikes;
  if (current.last_ban_at && (now - current.last_ban_at) < STRIKE_RESET_AFTER_MS) {
    strikes = current.consecutive_ban_count + 1;
  } else {
    strikes = 1;
  }

  save({
    banned_until: newBannedUntil,
    ban_reason: reason,
    consecutive_ban_count: strikes,
    last_ban_at: now,
  });
}

/**
 * Clear current ban (set banned_until=0). Preserves consecutive_ban_count
 * for forensic + exponential-cooldown purposes. Bumps resume_generation so
 * any stale async timers from previous suppression window get invalidated.
 */
function clearBan() {
  const current = load();
  save({
    banned_until: 0,
    resume_generation: current.resume_generation + 1,
  });
}

// ─── Endpoint classification ───────────────────────────────────────────────
//
// CLASS_A — critical trading (balance, positions, orders). Allowed during
//           warm resume. Block ONLY when fully SUPPRESSED.
// CLASS_B — degradable (market data analytics: klines, ticker24h, OI, funding).
//           Queued/delayed during warm resume to keep weight conservative.
// CLASS_C — cheap public (depth, ping, time). Always allowed.
//
// Default for unknown endpoints = B (safe-degradable, not silent flood hole).

const ENDPOINT_CLASS_MAP = Object.freeze({
  // CLASS_A — critical
  '/fapi/v2/balance': 'A',
  '/fapi/v2/positionRisk': 'A',
  '/fapi/v1/order': 'A',
  '/fapi/v1/allOpenOrders': 'A',
  '/fapi/v1/openOrders': 'A',
  '/fapi/v1/leverage': 'A',
  '/fapi/v1/marginType': 'A',
  // [V6 fix 2026-05-20] SL/TP placement endpoints — CRITICAL safety.
  // Pre-fix bug: these defaulted to CLASS_B → rejected during WARM resume,
  // causing _placeProtectionForExistingEntry to fail retries → emergency
  // MARKET close cascade (~613 USD historical loss). Must be CLASS_A.
  '/fapi/v1/algoOrder': 'A',
  '/fapi/v1/openAlgoOrders': 'A',
  '/fapi/v1/batchOrders': 'A',
  // CLASS_B — degradable
  '/fapi/v1/ticker/24hr': 'B',
  '/fapi/v1/klines': 'B',
  '/fapi/v1/markPriceKlines': 'B',
  '/fapi/v1/premiumIndexKlines': 'B',
  '/fapi/v1/openInterest': 'B',
  '/fapi/v1/openInterestHist': 'B',
  '/fapi/v1/fundingRate': 'B',
  '/fapi/v1/premiumIndex': 'B',
  // CLASS_C — cheap public
  '/fapi/v1/depth': 'C',
  '/fapi/v1/ping': 'C',
  '/fapi/v1/time': 'C',
  '/fapi/v1/exchangeInfo': 'C',
});
const DEFAULT_CLASS = 'B';

/**
 * Classify a Binance API path into A/B/C class.
 * Strips query string before lookup. Unknown paths default to B.
 *
 * @param {string} pathOrUrl — e.g. '/fapi/v2/balance' or '/fapi/v1/depth?symbol=BTC'
 * @returns {'A'|'B'|'C'}
 */
function classifyEndpoint(pathOrUrl) {
  if (!pathOrUrl) return DEFAULT_CLASS;
  const path = pathOrUrl.split('?')[0];
  return ENDPOINT_CLASS_MAP[path] || DEFAULT_CLASS;
}

/**
 * During warm-resume window, only CLASS_A (critical) + CLASS_C (cheap)
 * are allowed. CLASS_B (degradable) is queued/dropped.
 *
 * @param {'A'|'B'|'C'} klass
 * @returns {boolean}
 */
function shouldAllowDuringWarm(klass) {
  return klass === 'A' || klass === 'C';
}

// ─── Warm resume state transitions ─────────────────────────────────────────

/**
 * Start warm resume window. Computes duration based on strike count (with
 * jitter on strike >= 2), sets warm_until, bumps resume_generation so old
 * suppression-era timers self-invalidate.
 *
 * @param {object} opts — { now }
 * @returns {{ warm_until: number, resume_generation: number }}
 */
function startWarmResume({ now }) {
  const current = load();
  const duration = computeWarmDuration(current.consecutive_ban_count);
  const warm_until = now + duration;
  const newGen = current.resume_generation + 1;

  save({
    warm_until,
    resume_generation: newGen,
  });

  return { warm_until, resume_generation: newGen };
}

/**
 * Abort warm resume (Binance returned 418/429 during warm probe).
 * Re-enters SUPPRESSED with new ban deadline, clears warm window,
 * bumps resume_generation, increments strike counter.
 *
 * @param {object} opts — { bannedUntil, reason, now }
 */
function abortWarmResume({ bannedUntil, reason, now }) {
  recordBan({ bannedUntil, reason, now });
  const current = load();
  save({
    warm_until: 0, // clear warm immediately
    resume_generation: current.resume_generation + 1,
  });
}

// ─── Natural ban expiry transition (SUPPRESSED → WARM) ────────────────────
//
// When a ban expires naturally (banned_until < now) without an explicit
// clearBan() call, the system would otherwise jump straight from SUPPRESSED
// to NORMAL — bypassing warm resume protection. Pollers all resume
// simultaneously → burst → re-ban (the exact loop we're preventing).
//
// advanceState detects "just-expired" SUPPRESSED and auto-promotes to WARM.
// Called by scheduler.canProceed() lazily so we don't need a separate timer.

/**
 * Advance state machine: SUPPRESSED→WARM on natural ban expiry.
 * Returns true if a transition occurred, false otherwise.
 *
 * @param {object} opts — { now }
 * @returns {boolean}
 */
function advanceState({ now }) {
  const s = load();

  // Need: ban was active at some point (banned_until > 0)
  //       AND ban now expired (banned_until <= now)
  //       AND not already in warm (warm_until <= now)
  if (s.banned_until > 0 && s.banned_until <= now && (s.warm_until || 0) <= now) {
    save({ banned_until: 0 });
    startWarmResume({ now });
    appendTransitionLog({
      from: 'SUPPRESSED',
      to: 'WARM',
      reason: 'ban_expired — auto-start warm resume',
      ts: now,
      consecutive_ban_count: s.consecutive_ban_count,
    });
    return true;
  }

  return false;
}

// ─── Anti-flap transition guard ───────────────────────────────────────────

const MIN_STATE_DURATION_MS = 20_000;

/**
 * Can we transition from current state? Anti-flap protection — minimum
 * 20s in current state before flipping, EXCEPT for hard 418 which always
 * wins (explicit Binance ban cannot be ignored).
 *
 * @param {object} opts
 * @param {number} opts.lastTransitionTs — when current state was entered
 * @param {number} opts.now
 * @param {boolean} opts.isHard418 — true if reason is HTTP 418 ban
 * @returns {boolean}
 */
function canTransition({ lastTransitionTs, now, isHard418 }) {
  if (isHard418) return true;
  if (!lastTransitionTs) return true;
  return (now - lastTransitionTs) >= MIN_STATE_DURATION_MS;
}

// ─── State transition log ──────────────────────────────────────────────────
//
// Single-line structured events for soak observation. Kept bounded at
// last 100 rows (forensic, not heavy analytics).

const TRANSITION_LOG_MAX_ROWS = 100;

/**
 * Append a state transition event to the log table.
 * Best-effort — does not throw if table is missing (defensive boot).
 *
 * @param {object} event — { from, to, reason, ts, ...extra }
 */
function appendTransitionLog(event) {
  const db = _getDb();
  const json = JSON.stringify(event);
  try {
    db.prepare(`INSERT INTO binance_rate_state_log (ts, event_json) VALUES (?, ?)`)
      .run(event.ts, json);
    // Prune to last N
    db.prepare(`
      DELETE FROM binance_rate_state_log
      WHERE id NOT IN (
        SELECT id FROM binance_rate_state_log ORDER BY id DESC LIMIT ?
      )
    `).run(TRANSITION_LOG_MAX_ROWS);
  } catch (_err) {
    // table missing or DB unreachable — silent fail per defensive policy
  }
}

// ─── Clean boot reset ─────────────────────────────────────────────────────
//
// On PM2 restart/reload, if the system is NORMAL (no active ban, no active
// warm) AND the last ban was more than STRIKE_RESET_AFTER_MS ago, reset the
// accumulated consecutive_ban_count and stale weight counters.
//
// Without this, a server that experienced many bans (e.g. 51 strikes) would
// carry that count forever, causing 30-min warm periods on any future hiccup.

/**
 * Reset stale rate state on clean server boot.
 *
 * @param {object} opts — { now }
 * @returns {{ reset: boolean, reason: string }}
 */
function resetOnCleanBoot({ now }) {
  const s = load();
  const mode = computeCurrentMode(s, now);

  if (mode !== 'NORMAL') {
    return { reset: false, reason: `mode=${mode}, not resetting active state` };
  }

  if (s.consecutive_ban_count === 0 && s.used_weight_1m === 0) {
    return { reset: false, reason: 'already clean — no stale state' };
  }

  if (s.last_ban_at && (now - s.last_ban_at) < STRIKE_RESET_AFTER_MS) {
    return { reset: false, reason: `last ban ${Math.round((now - s.last_ban_at) / 60000)}min ago, within 4h window` };
  }

  const prevStrikes = s.consecutive_ban_count;
  save({
    consecutive_ban_count: 0,
    used_weight_1m: 0,
    used_weight_ts: null,
    burst_calls_10s: 0,
    burst_window_start: null,
    banned_until: 0,
    ban_reason: null,
    warm_until: 0,
  });

  appendTransitionLog({
    from: 'STALE',
    to: 'NORMAL',
    reason: 'clean boot reset — stale state cleared',
    ts: now,
    prev_consecutive_ban_count: prevStrikes,
  });

  return { reset: true, reason: `reset ${prevStrikes} strikes + stale counters` };
}

module.exports = {
  DEFAULT_STATE,
  WARM_DURATION_BASE_MS,
  WARM_JITTER_MAX_PCT,
  STRIKE_RESET_AFTER_MS,
  ENDPOINT_CLASS_MAP,
  DEFAULT_CLASS,
  MIN_STATE_DURATION_MS,
  TRANSITION_LOG_MAX_ROWS,
  load,
  save,
  computeCurrentMode,
  computeWarmDuration,
  recordBan,
  clearBan,
  startWarmResume,
  abortWarmResume,
  advanceState,
  canTransition,
  classifyEndpoint,
  shouldAllowDuringWarm,
  appendTransitionLog,
  resetOnCleanBoot,
};
