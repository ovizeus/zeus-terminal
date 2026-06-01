// [SP1] Pure gate evaluation over queryParityReport output. No DB access here —
// the caller passes the report so this stays unit-testable and side-effect-free.
// Direction-only parity gate (spec 2026-05-31, Option A): sizing parity is SP1.5.

// Locked pre-soak. DO NOT tune these to make a soak pass.
//   N = min direction+tier agreement %
//   P = min paired cycles (pairing-integrity floor — a few paired rows must not
//       read false-100%; queryParityReport excludes unpaired from the denominator)
//   U = max unpaired ratio = unpaired / (paired + unpaired)
//   M = sustained days (evaluated by the caller over the window)
const SP1_THRESHOLDS = { N: 98, P: 500, U: 0.05, M: 3 };

function evaluateParityGate(report, thresholds) {
    const t = thresholds || SP1_THRESHOLDS;
    const tot = (report && report.totals) || {};
    const pct = Number(tot.primaryAgreementPct);
    const pairs = Number(tot.primaryPairs) || 0;
    const unpaired = Number(tot.primaryUnpaired) || 0;
    const denom = pairs + unpaired;
    const unpairedRatio = denom > 0 ? unpaired / denom : 1;

    const failures = [];
    if (!(pct >= t.N)) failures.push('agreement');
    if (!(pairs >= t.P)) failures.push('paired');
    if (!(unpairedRatio <= t.U)) failures.push('unpairedRatio');

    return {
        pass: failures.length === 0,
        failures,
        metrics: { agreementPct: pct, pairs, unpaired, unpairedRatio: Number(unpairedRatio.toFixed(4)) },
        thresholds: t,
    };
}

// [SP1] Compute the soak window for a user. The window STARTS at the explicit
// soak-start timestamp (when the *continuous* server emission began on deploy) —
// client rows from before that can never pair (server emitted nothing then) and
// would poison the unpaired ratio, so they are excluded. soakStartTs is passed
// by the caller (read from the marker file); if null, falls back to the first
// server row in the DB. `now` is passed for determinism in tests.
function soakWindow(db, userId, now, soakStartTs, thresholds) {
    const t = thresholds || SP1_THRESHOLDS;
    let start = (soakStartTs != null && !isNaN(Number(soakStartTs))) ? Number(soakStartTs) : null;
    if (start == null) {
        const row = db.db.prepare(
            "SELECT MIN(created_at) AS firstTs FROM brain_parity_log WHERE source='server' AND user_id=?"
        ).get(userId);
        start = row && row.firstTs ? Number(row.firstTs) : null;
    }
    const mWindowStart = now - t.M * 24 * 3600 * 1000;
    // since = the later of (M-day rolling window, soak start)
    const since = start != null ? Math.max(mWindowStart, start) : mWindowStart;
    const daysElapsed = start != null ? (now - start) / (24 * 3600 * 1000) : 0;
    return { since, soakStart: start, daysElapsed: Number(daysElapsed.toFixed(2)) };
}

module.exports = { evaluateParityGate, SP1_THRESHOLDS, soakWindow };
