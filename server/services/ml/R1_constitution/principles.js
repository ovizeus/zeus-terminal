'use strict';

// [Wave 5] R1 Constitution — locked principles. Source of truth for the
// 7 hard rules that govern Zeus brain decisions. Each principle has:
//   id           — stable ID (used in DB + audit)
//   name         — human-readable label
//   severity     — 'hard' (must block) | 'soft' (warn) | 'advisory'
//   description  — why the rule exists
//   threshold    — numeric / config value when applicable
//
// Hard rules cannot be silently changed — operator must explicitly
// modify here and ship via commit. Defense in depth: even if downstream
// enforcement (correlationGuard, drawdownGuard, etc.) is bypassed, R1
// evaluate() catches it at the centralized layer.

const PRINCIPLES = [
    {
        id: 'MAX_POSITION_SIZE_PCT',
        name: 'Max position size 25% of balance',
        severity: 'hard',
        description: 'No single position may consume more than 25% of available balance.',
        threshold: 25,
    },
    {
        id: 'MAX_LEVERAGE',
        name: 'Max leverage 25x',
        severity: 'hard',
        description: 'Leverage capped at 25x regardless of operator intent. Zeus risk math degrades above this point.',
        threshold: 25,
    },
    {
        id: 'NO_REVENGE_TRADE',
        name: 'No revenge trade — 30min cooldown after 3 losses',
        severity: 'hard',
        description: '3 consecutive losses → mandatory 30min cooldown before next entry. Prevents tilt-driven escalation.',
        threshold: { lossesInRow: 3, cooldownMs: 30 * 60 * 1000 },
    },
    {
        id: 'NO_OPPOSITE_ENTRY_ON_OPEN',
        name: 'No opposite-side entry while same-symbol open',
        severity: 'hard',
        description: 'Cannot open SHORT if a LONG is open on same symbol (and vice versa). Must close/reverse explicitly.',
        threshold: null,
    },
    {
        id: 'MAX_CORRELATED_EXPOSURE',
        name: 'Correlated exposure ≤ 50% of balance',
        severity: 'hard',
        description: 'Sum of all positions on correlated assets (corr ≥ 80%) may not exceed 50% of balance.',
        threshold: 50,
    },
    {
        id: 'MIN_REFLECTION_CONFIDENCE',
        name: 'Reflection gate must not block',
        severity: 'soft',
        description: 'If serverReflection.questionEntry returns proceed=false, entry blocked. Brain itself disagreed.',
        threshold: null,
    },
    {
        id: 'NO_LIVE_WITHOUT_SL',
        name: 'Live entries require SL set',
        severity: 'hard',
        description: 'All LIVE (non-demo) entries must have an explicit SL price. Zeus risk math + emergency close depend on it.',
        threshold: null,
    },
];

function list() {
    return PRINCIPLES.slice();
}

function get(id) {
    return PRINCIPLES.find(p => p.id === id) || null;
}

module.exports = { list, get };
