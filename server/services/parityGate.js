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

module.exports = { evaluateParityGate, SP1_THRESHOLDS };
