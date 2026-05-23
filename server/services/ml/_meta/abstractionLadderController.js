'use strict';

/**
 * OMEGA _meta — abstractionLadderController (canonical §131)
 *
 * §131 ABSTRACTION LADDER CONTROLLER / LEVEL-OF-THOUGHT SWITCHER.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 3798-3842.
 *
 * "Nu orice situatie trebuie gandita la acelasi nivel de abstractie...
 *  un sistem poate ramane blocat prea jos in detalii sau prea sus in
 *  povesti generale... abstraction levels explicite: tick/microstructure,
 *  execution, intraday structure, HTF regime, macro/cross-asset, strategic/
 *  constitutional... ladder switch logic + cost-benefit pentru urcare sau
 *  coborare de nivel + semnale pentru descend into details / rise to
 *  principle + logging al nivelului dominant de gandire per decizie...
 *  'la ce nivel trebuie sa gandesc problema asta ca sa o inteleg corect?'...
 *  previne overfitting la detalii + orbire prin abstractie excesiva."
 *
 * Distinct from §114 conceptLibrary (R5A — SEMANTIC abstraction, what
 * concepts mean), §123 ontologyRevisionEngine (R5B — vocabulary evolution),
 * §117 epistemicProvenance (_audit — lineage), §116 constitutionalCharter
 * Layer (R1 — content rules). §131 = horizontal level-of-thought switcher
 * (where to operate cognitively), NOT semantic content.
 */

const { db } = require('../../database');

const ABSTRACTION_LEVELS = Object.freeze([
    'tick_microstructure',
    'execution',
    'intraday_structure',
    'htf_regime',
    'macro_cross_asset',
    'strategic_constitutional'
]);

const LEVEL_ORDER = Object.freeze({
    tick_microstructure: 0,
    execution: 1,
    intraday_structure: 2,
    htf_regime: 3,
    macro_cross_asset: 4,
    strategic_constitutional: 5
});

const SWITCH_ACTIONS = Object.freeze([
    'initial', 'descend', 'rise', 'stay'
]);

const SWITCH_PENALTY = 0.10;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`abstractionLadderController: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertEntry: db.prepare(`
        INSERT INTO ml_abstraction_log
        (user_id, resolved_env, entry_id, decision_id,
         abstraction_level, prev_level, switch_action,
         cost_score, benefit_score, net_value, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listByDecision: db.prepare(`
        SELECT * FROM ml_abstraction_log
        WHERE user_id = ? AND resolved_env = ? AND decision_id = ?
        ORDER BY ts ASC
    `),
    latestByDecision: db.prepare(`
        SELECT * FROM ml_abstraction_log
        WHERE user_id = ? AND resolved_env = ? AND decision_id = ?
        ORDER BY ts DESC LIMIT 1
    `),
    distribution: db.prepare(`
        SELECT abstraction_level, COUNT(*) AS cnt
        FROM ml_abstraction_log
        WHERE user_id = ? AND resolved_env = ? AND ts >= ?
        GROUP BY abstraction_level
    `)
};

// ── computeNetValue (pure) ─────────────────────────────────────────
function computeNetValue(params) {
    const cost = _required(params, 'costScore');
    const benefit = _required(params, 'benefitScore');
    if (cost < 0 || cost > 1) {
        throw new Error('abstractionLadderController: costScore must be in [0,1]');
    }
    if (benefit < 0 || benefit > 1) {
        throw new Error('abstractionLadderController: benefitScore must be in [0,1]');
    }
    return { netValue: benefit - cost };
}

// ── classifySwitchAction (pure) ────────────────────────────────────
function classifySwitchAction(params) {
    const newLevel = _required(params, 'newLevel');
    const prevLevel = params && params.prevLevel;
    if (!ABSTRACTION_LEVELS.includes(newLevel)) {
        throw new Error(
            `abstractionLadderController: invalid new level "${newLevel}"`
        );
    }
    if (prevLevel === null || prevLevel === undefined) {
        return { switchAction: 'initial' };
    }
    if (!ABSTRACTION_LEVELS.includes(prevLevel)) {
        throw new Error(
            `abstractionLadderController: invalid prevLevel "${prevLevel}"`
        );
    }
    const oldIdx = LEVEL_ORDER[prevLevel];
    const newIdx = LEVEL_ORDER[newLevel];
    if (newIdx > oldIdx) return { switchAction: 'rise' };
    if (newIdx < oldIdx) return { switchAction: 'descend' };
    return { switchAction: 'stay' };
}

// ── selectOptimalLevel (pure) ──────────────────────────────────────
// max net_value, tiebreak by lower cost
function selectOptimalLevel(params) {
    const candidates = _required(params, 'candidates');
    if (!Array.isArray(candidates) || candidates.length === 0) {
        throw new Error(
            'abstractionLadderController: candidates must be non-empty array'
        );
    }
    let best = null;
    let bestNet = -Infinity;
    for (const c of candidates) {
        if (!ABSTRACTION_LEVELS.includes(c.level)) {
            throw new Error(
                `abstractionLadderController: invalid candidate level "${c.level}"`
            );
        }
        const net = c.benefit - c.cost;
        if (net > bestNet) {
            best = c; bestNet = net;
        } else if (net === bestNet && c.cost < best.cost) {
            best = c;
        }
    }
    return {
        optimalLevel: best.level,
        netValue: bestNet,
        cost: best.cost,
        benefit: best.benefit
    };
}

// ── shouldSwitch (pure) ────────────────────────────────────────────
function shouldSwitch(params) {
    const current = _required(params, 'currentNetValue');
    const candidate = _required(params, 'candidateNetValue');
    const penalty = (params && params.switchPenalty !== undefined)
        ? params.switchPenalty : SWITCH_PENALTY;
    const delta = candidate - current;
    return { shouldSwitch: delta >= penalty, delta, penalty };
}

// ── logAbstraction ─────────────────────────────────────────────────
function logAbstraction(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const entryId = _required(params, 'entryId');
    const decisionId = _required(params, 'decisionId');
    const abstractionLevel = _required(params, 'abstractionLevel');
    const prevLevel = params && params.prevLevel ? params.prevLevel : null;
    const cost = _required(params, 'costScore');
    const benefit = _required(params, 'benefitScore');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!ABSTRACTION_LEVELS.includes(abstractionLevel)) {
        throw new Error(
            `abstractionLadderController: invalid abstraction level "${abstractionLevel}"`
        );
    }
    if (prevLevel !== null && !ABSTRACTION_LEVELS.includes(prevLevel)) {
        throw new Error(
            `abstractionLadderController: invalid prevLevel "${prevLevel}"`
        );
    }
    if (cost < 0 || cost > 1) {
        throw new Error('abstractionLadderController: costScore must be in [0,1]');
    }
    if (benefit < 0 || benefit > 1) {
        throw new Error('abstractionLadderController: benefitScore must be in [0,1]');
    }

    const { switchAction } = classifySwitchAction({
        prevLevel, newLevel: abstractionLevel
    });
    const { netValue } = computeNetValue({
        costScore: cost, benefitScore: benefit
    });

    try {
        _stmts.insertEntry.run(
            userId, env, entryId, decisionId,
            abstractionLevel, prevLevel, switchAction,
            cost, benefit, netValue, ts
        );
        return {
            logged: true, entryId, switchAction, netValue
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `abstractionLadderController: duplicate entryId "${entryId}"`
            );
        }
        throw err;
    }
}

// ── getDecisionHistory ─────────────────────────────────────────────
function getDecisionHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const rows = _stmts.listByDecision.all(userId, env, decisionId);
    return rows.map(r => ({
        entryId: r.entry_id,
        decisionId: r.decision_id,
        abstractionLevel: r.abstraction_level,
        prevLevel: r.prev_level,
        switchAction: r.switch_action,
        costScore: r.cost_score,
        benefitScore: r.benefit_score,
        netValue: r.net_value,
        ts: r.ts
    }));
}

// ── getLatestForDecision ───────────────────────────────────────────
function getLatestForDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const decisionId = _required(params, 'decisionId');
    const r = _stmts.latestByDecision.get(userId, env, decisionId);
    if (!r) return null;
    return {
        entryId: r.entry_id,
        decisionId: r.decision_id,
        abstractionLevel: r.abstraction_level,
        prevLevel: r.prev_level,
        switchAction: r.switch_action,
        costScore: r.cost_score,
        benefitScore: r.benefit_score,
        netValue: r.net_value,
        ts: r.ts
    };
}

// ── getLevelDistribution ───────────────────────────────────────────
function getLevelDistribution(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sinceTs = (params && params.sinceTs !== undefined)
        ? params.sinceTs : 0;
    const rows = _stmts.distribution.all(userId, env, sinceTs);
    const dist = {};
    for (const r of rows) {
        dist[r.abstraction_level] = r.cnt;
    }
    return dist;
}

module.exports = {
    ABSTRACTION_LEVELS,
    LEVEL_ORDER,
    SWITCH_ACTIONS,
    SWITCH_PENALTY,
    computeNetValue,
    classifySwitchAction,
    selectOptimalLevel,
    shouldSwitch,
    logAbstraction,
    getDecisionHistory,
    getLatestForDecision,
    getLevelDistribution
};
