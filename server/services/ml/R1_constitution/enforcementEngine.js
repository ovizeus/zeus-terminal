'use strict';

// [Wave 5] R1 Enforcement Engine — evaluates a decision against the 7
// constitutional principles. Returns { allowed, violations } where
// violations is an array of {id, name, severity, detail}. Hard-severity
// violations set allowed=false; soft/advisory may pass through depending
// on enforcementMode.
//
// Defense in depth: existing per-feature guards (correlationGuard,
// drawdownGuard, reflection) continue to operate independently. R1 is
// the centralized observability + last-line check.

const { db } = require('../../database');
const principles = require('./principles');

const _principleMap = Object.fromEntries(principles.list().map(p => [p.id, p]));

function _violation(id, detail) {
    const p = _principleMap[id];
    return {
        id,
        name: p.name,
        severity: p.severity,
        detail,
    };
}

function evaluate({ userId, decision }) {
    const violations = [];
    const d = decision || {};
    const sizePct = (d.balance > 0 && d.size != null) ? (d.size / d.balance) * 100 : 0;

    // 1. MAX_POSITION_SIZE_PCT
    if (sizePct > _principleMap.MAX_POSITION_SIZE_PCT.threshold) {
        violations.push(_violation('MAX_POSITION_SIZE_PCT', `size ${sizePct.toFixed(1)}% > 25%`));
    }

    // 2. MAX_LEVERAGE
    if (d.leverage != null && d.leverage > _principleMap.MAX_LEVERAGE.threshold) {
        violations.push(_violation('MAX_LEVERAGE', `leverage ${d.leverage}x > 25x`));
    }

    // 3. NO_REVENGE_TRADE — 3 consecutive losses within 30min
    if (Array.isArray(d.recentCloses) && d.recentCloses.length >= 3) {
        const cooldownMs = _principleMap.NO_REVENGE_TRADE.threshold.cooldownMs;
        const last3 = d.recentCloses.slice(0, 3);
        const allLosses = last3.every(c => (c.closePnl || 0) < 0);
        const mostRecentAgeMs = Date.now() - (last3[0].closedAt || 0);
        if (allLosses && mostRecentAgeMs < cooldownMs) {
            const remainMs = cooldownMs - mostRecentAgeMs;
            violations.push(_violation('NO_REVENGE_TRADE', `3 losses in row; wait ${Math.ceil(remainMs / 60000)}min`));
        }
    }

    // 4. NO_OPPOSITE_ENTRY_ON_OPEN — same-mode (any symbol). Extended
    //    2026-05-19: not just same-symbol opposite, but ANY opposite-direction
    //    position în same mode. Operator policy: no mixed LONG+SHORT book per
    //    mode. Cross-mode allowed per Wave 8 sandbox model.
    if (Array.isArray(d.openPositions) && d.symbol && d.side) {
        const opposite = d.side === 'LONG' ? 'SHORT' : 'LONG';
        const decMode = d.mode || 'demo';
        const conflict = d.openPositions.find(p =>
            p.side === opposite &&
            (p.mode || 'demo') === decMode
        );
        if (conflict) {
            const reason = conflict.symbol === d.symbol
                ? `${d.side} blocked — ${opposite} ${d.symbol} already open (same mode ${decMode})`
                : `${d.side} ${d.symbol} blocked — book on ${decMode} already has ${opposite} ${conflict.symbol} (no mixed bias)`;
            violations.push(_violation('NO_OPPOSITE_ENTRY_ON_OPEN', reason));
        }
    }

    // 5. MAX_CORRELATED_EXPOSURE
    if (d.correlatedExposure && d.correlatedExposure.totalPct != null) {
        if (d.correlatedExposure.totalPct > _principleMap.MAX_CORRELATED_EXPOSURE.threshold) {
            violations.push(_violation('MAX_CORRELATED_EXPOSURE',
                `correlated exposure ${d.correlatedExposure.totalPct.toFixed(1)}% > 50%`));
        }
    }

    // 6. MIN_REFLECTION_CONFIDENCE
    if (d.reflection && d.reflection.proceed === false) {
        const concernsStr = Array.isArray(d.reflection.concerns)
            ? d.reflection.concerns.join(',')
            : '';
        violations.push(_violation('MIN_REFLECTION_CONFIDENCE',
            `reflection blocked: ${concernsStr || 'no detail'}`));
    }

    // 7. NO_LIVE_WITHOUT_SL — applies only when mode is 'live'
    if (d.mode === 'live' && (d.sl == null || d.sl === 0)) {
        violations.push(_violation('NO_LIVE_WITHOUT_SL', 'live entry without SL set'));
    }

    const hardViolation = violations.some(v => v.severity === 'hard' || v.severity === 'soft');

    return {
        allowed: !hardViolation,
        violations,
    };
}

function logViolations({ userId, decision, violations, enforcementMode }) {
    if (!Array.isArray(violations) || violations.length === 0) return;
    const mode = enforcementMode === 'blocking' ? 'blocking' : 'advisory';
    const payload = JSON.stringify({
        symbol: decision && decision.symbol,
        side: decision && decision.side,
        size: decision && decision.size,
        leverage: decision && decision.leverage,
        sl: decision && decision.sl,
        mode: decision && decision.mode,
    });
    const stmt = db.prepare(
        `INSERT INTO ml_r1_violations
         (user_id, principle_id, principle_name, symbol, side, severity,
          decision_payload_json, enforcement_mode, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const now = Date.now();
    for (const v of violations) {
        try {
            stmt.run(
                userId, v.id, v.name,
                decision && decision.symbol, decision && decision.side,
                v.severity, payload, mode, now
            );
        } catch (_) { /* never block on log error */ }
    }
}

module.exports = { evaluate, logViolations };
