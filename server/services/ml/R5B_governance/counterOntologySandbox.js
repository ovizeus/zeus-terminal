'use strict';

/**
 * OMEGA R5B Governance — counterOntologySandbox (canonical §138)
 *
 * §138 COUNTER-ONTOLOGY SANDBOX / ALIEN FRAME GENERATOR.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 4091-4137.
 *
 * "Uneori sistemul nu greseste pentru ca parametrii sunt slabi, ci pentru
 *  ca intreaga ontologie in care gandeste cazul este prea ingusta...
 *  ontology revision poate ajusta primitivele existente, plural selves pot
 *  oferi paradigme diferite, dar toate pot ramane captive in aceeasi
 *  familie de concepte... lipseste capacitatea de a genera cadre 'straine',
 *  aproape nefiresti pentru sistemul actual... examples: flow-as-pressure,
 *  market-as-network-fracture, liquidity-as-phase-transition, positioning-
 *  as-ecological-saturation, volatility-as-energy-release... 'daca limbajul
 *  meu de acum e prea sarac, prin ce alta lume conceptuala as putea
 *  intelege cazul?'..."
 *
 * Reguli stricte (canonical):
 * - "ontologiile straine nu intra direct in live"
 * - "trebuie testate in sandbox, shadow si replay"
 * - "novelty fara putere explicativa reala este respinsa"
 * - "orice nou cadru trebuie sa aduca valoare, nu doar exotism"
 *
 * Distinct from §123 ontologyRevisionEngine (R5B — modifies existing
 * primitives, same family), §124 pluralSelfChamber (R6 — rival worldviews
 * same conceptual family), §114 conceptLibrary (R5A — registru semantic),
 * §134 representationDebtTracker (_meta — drift detection). §138 = alien
 * frame generator (entirely new conceptual families) with strict
 * sandbox/shadow/live_candidate progression ladder.
 */

const { db } = require('../../database');

const FRAME_MODES = Object.freeze([
    'sandbox', 'shadow', 'live_candidate'
]);
const EVALUATION_WEIGHTS = Object.freeze({
    explanatory_novelty: 0.25,
    predictive_novelty: 0.30,
    semantic_compression: 0.20,
    stability: 0.25
});
const MIN_NOVELTY_FOR_PROMOTION = 0.40;
const MIN_VALUE_FOR_PROMOTION = 0.50;
const MIN_STABILITY_FOR_PROMOTION = 0.30;

const _SCORE_KEYS = [
    'explanatoryNovelty', 'predictiveNovelty',
    'semanticCompression', 'stability'
];

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`counterOntologySandbox: missing ${key}`);
    }
    return params[key];
}

function _validateScoreInputs(params) {
    for (const k of _SCORE_KEYS) {
        if (!params || params[k] === undefined || params[k] === null) {
            throw new Error(`counterOntologySandbox: missing ${k}`);
        }
        if (params[k] < 0 || params[k] > 1) {
            throw new Error(
                `counterOntologySandbox: ${k} must be in [0,1], got ${params[k]}`
            );
        }
    }
}

const _stmts = {
    insertFrame: db.prepare(`
        INSERT INTO ml_alien_frames
        (user_id, resolved_env, frame_id, frame_name, frame_description,
         primary_primitives_json, source_metaphor, mode,
         explanatory_novelty, predictive_novelty, semantic_compression,
         stability_score, overall_value_score, active, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateFrameScores: db.prepare(`
        UPDATE ml_alien_frames
        SET explanatory_novelty = ?, predictive_novelty = ?,
            semantic_compression = ?, stability_score = ?,
            overall_value_score = ?, ts = ?
        WHERE user_id = ? AND resolved_env = ? AND frame_id = ?
    `),
    updateFrameMode: db.prepare(`
        UPDATE ml_alien_frames
        SET mode = ?, ts = ?
        WHERE user_id = ? AND resolved_env = ? AND frame_id = ?
    `),
    getFrame: db.prepare(`
        SELECT * FROM ml_alien_frames
        WHERE user_id = ? AND resolved_env = ? AND frame_id = ?
    `),
    listByMode: db.prepare(`
        SELECT * FROM ml_alien_frames
        WHERE user_id = ? AND resolved_env = ? AND mode = ?
        ORDER BY ts DESC LIMIT ?
    `),
    insertComparison: db.prepare(`
        INSERT INTO ml_alien_frame_comparisons
        (user_id, resolved_env, comparison_id, frame_id,
         baseline_ontology_id, test_case_count,
         frame_wins_count, baseline_wins_count,
         draw_count, frame_advantage_score, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
};

// ── computeOverallValueScore (pure) ────────────────────────────────
function computeOverallValueScore(params) {
    _validateScoreInputs(params);
    const W = EVALUATION_WEIGHTS;
    const score =
        params.explanatoryNovelty * W.explanatory_novelty +
        params.predictiveNovelty  * W.predictive_novelty +
        params.semanticCompression * W.semantic_compression +
        params.stability          * W.stability;
    return { valueScore: Math.max(0, Math.min(1, score)) };
}

// ── canPromoteToShadow (pure) ──────────────────────────────────────
function canPromoteToShadow(params) {
    const value = _required(params, 'valueScore');
    const novelty = _required(params, 'novelty');
    const stability = _required(params, 'stability');
    if (value < 0 || value > 1 || novelty < 0 || novelty > 1 ||
        stability < 0 || stability > 1) {
        throw new Error('counterOntologySandbox: scores must be in [0,1]');
    }
    const canPromote = (value >= MIN_VALUE_FOR_PROMOTION) &&
                       (novelty >= MIN_NOVELTY_FOR_PROMOTION) &&
                       (stability >= MIN_STABILITY_FOR_PROMOTION);
    return {
        canPromote,
        value, novelty, stability,
        reasons: canPromote ? [] : [
            value < MIN_VALUE_FOR_PROMOTION ? 'value_below_threshold' : null,
            novelty < MIN_NOVELTY_FOR_PROMOTION ? 'novelty_below_threshold' : null,
            stability < MIN_STABILITY_FOR_PROMOTION ? 'stability_below_threshold' : null
        ].filter(x => x !== null)
    };
}

// ── canPromoteToLiveCandidate (pure) ───────────────────────────────
// Strict gate: need positive advantage + sufficient value + stability
function canPromoteToLiveCandidate(params) {
    const advantage = _required(params, 'frameAdvantageScore');
    const value = _required(params, 'valueScore');
    const stability = _required(params, 'stability');
    if (advantage < -1 || advantage > 1) {
        throw new Error(
            'counterOntologySandbox: frameAdvantageScore must be in [-1,1]'
        );
    }
    if (value < 0 || value > 1 || stability < 0 || stability > 1) {
        throw new Error('counterOntologySandbox: scores must be in [0,1]');
    }
    // Advantage must be meaningfully positive (≥ 0.20)
    const canPromote = (advantage >= 0.20) &&
                       (value >= MIN_VALUE_FOR_PROMOTION) &&
                       (stability >= MIN_STABILITY_FOR_PROMOTION);
    return { canPromote, advantage, value, stability };
}

// ── evaluatePromotion (pure) ───────────────────────────────────────
function evaluatePromotion(params) {
    const currentMode = _required(params, 'currentMode');
    const valueScore = _required(params, 'valueScore');
    const explanatory = _required(params, 'explanatoryNovelty');
    const predictive = _required(params, 'predictiveNovelty');
    const stability = _required(params, 'stability');

    if (!FRAME_MODES.includes(currentMode)) {
        throw new Error(
            `counterOntologySandbox: invalid currentMode "${currentMode}"`
        );
    }

    const novelty = Math.max(explanatory, predictive);

    if (currentMode === 'live_candidate') {
        return { verdict: 'stay', reason: 'terminal_mode' };
    }

    if (currentMode === 'sandbox') {
        // Quarantine if novelty completely absent
        if (explanatory < 0.20 && predictive < 0.20) {
            return { verdict: 'quarantine', reason: 'no_novelty' };
        }
        const gate = canPromoteToShadow({
            valueScore, novelty, stability
        });
        if (gate.canPromote) {
            return { verdict: 'promote_to_shadow', reasons: [] };
        }
        return { verdict: 'stay', reasons: gate.reasons };
    }

    // currentMode === 'shadow'
    // Without explicit advantage, use value+stability as proxy
    if (valueScore >= 0.70 && stability >= 0.50) {
        return { verdict: 'promote_to_live_candidate', reasons: [] };
    }
    return { verdict: 'stay', reasons: ['needs_advantage_evidence'] };
}

// ── computeFrameAdvantage (pure) ───────────────────────────────────
// (frame_wins - baseline_wins) / total, clamped [-1, 1]
function computeFrameAdvantage(params) {
    const fWins = _required(params, 'frameWinsCount');
    const bWins = _required(params, 'baselineWinsCount');
    const draws = _required(params, 'drawCount');
    if (fWins < 0 || bWins < 0 || draws < 0) {
        throw new Error(
            'counterOntologySandbox: counts must be non-negative'
        );
    }
    const total = fWins + bWins + draws;
    if (total === 0) return { frameAdvantageScore: 0 };
    const raw = (fWins - bWins) / total;
    return {
        frameAdvantageScore: Math.max(-1, Math.min(1, raw))
    };
}

// ── registerAlienFrame ─────────────────────────────────────────────
function registerAlienFrame(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const frameId = _required(params, 'frameId');
    const name = _required(params, 'frameName');
    const description = _required(params, 'frameDescription');
    const primitives = _required(params, 'primaryPrimitives');
    const metaphor = _required(params, 'sourceMetaphor');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!Array.isArray(primitives)) {
        throw new Error(
            'counterOntologySandbox: primaryPrimitives must be array'
        );
    }
    try {
        _stmts.insertFrame.run(
            userId, env, frameId, name, description,
            JSON.stringify(primitives), metaphor,
            'sandbox',  // always start in sandbox
            0, 0, 0, 0, 0,  // initial scores zero
            1,  // active
            ts
        );
        return {
            registered: true, frameId,
            mode: 'sandbox'
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `counterOntologySandbox: duplicate frameId "${frameId}"`
            );
        }
        throw err;
    }
}

// ── evaluateFrame ──────────────────────────────────────────────────
function evaluateFrame(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const frameId = _required(params, 'frameId');
    const ts = (params && params.ts) ? params.ts : Date.now();

    _validateScoreInputs(params);

    const existing = _stmts.getFrame.get(userId, env, frameId);
    if (!existing) {
        throw new Error(
            `counterOntologySandbox: frame not found "${frameId}"`
        );
    }

    const { valueScore } = computeOverallValueScore(params);

    _stmts.updateFrameScores.run(
        params.explanatoryNovelty, params.predictiveNovelty,
        params.semanticCompression, params.stability,
        valueScore, ts,
        userId, env, frameId
    );
    return {
        evaluated: true, frameId,
        valueScore, mode: existing.mode
    };
}

// ── recordFrameComparison ──────────────────────────────────────────
function recordFrameComparison(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const compId = _required(params, 'comparisonId');
    const frameId = _required(params, 'frameId');
    const baselineId = _required(params, 'baselineOntologyId');
    const fWins = _required(params, 'frameWinsCount');
    const bWins = _required(params, 'baselineWinsCount');
    const draws = _required(params, 'drawCount');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (fWins < 0 || bWins < 0 || draws < 0) {
        throw new Error(
            'counterOntologySandbox: counts must be non-negative'
        );
    }

    const total = fWins + bWins + draws;
    const { frameAdvantageScore } = computeFrameAdvantage({
        frameWinsCount: fWins,
        baselineWinsCount: bWins,
        drawCount: draws
    });

    try {
        _stmts.insertComparison.run(
            userId, env, compId, frameId, baselineId,
            total, fWins, bWins, draws,
            frameAdvantageScore, ts
        );
        return {
            recorded: true, comparisonId: compId,
            frameAdvantageScore
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `counterOntologySandbox: duplicate comparisonId "${compId}"`
            );
        }
        throw err;
    }
}

// ── promoteFrame ───────────────────────────────────────────────────
const _VALID_TRANSITIONS = Object.freeze({
    sandbox: ['shadow'],
    shadow: ['live_candidate'],
    live_candidate: []
});

function promoteFrame(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const frameId = _required(params, 'frameId');
    const targetMode = _required(params, 'targetMode');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!FRAME_MODES.includes(targetMode)) {
        throw new Error(
            `counterOntologySandbox: invalid targetMode "${targetMode}"`
        );
    }

    const existing = _stmts.getFrame.get(userId, env, frameId);
    if (!existing) {
        throw new Error(
            `counterOntologySandbox: frame not found "${frameId}"`
        );
    }

    const allowedTargets = _VALID_TRANSITIONS[existing.mode];
    if (!allowedTargets.includes(targetMode)) {
        throw new Error(
            `counterOntologySandbox: invalid transition from "${existing.mode}" to "${targetMode}" (cannot skip stages)`
        );
    }

    // Check promotion criteria
    if (targetMode === 'shadow') {
        const novelty = Math.max(
            existing.explanatory_novelty,
            existing.predictive_novelty
        );
        const gate = canPromoteToShadow({
            valueScore: existing.overall_value_score,
            novelty,
            stability: existing.stability_score
        });
        if (!gate.canPromote) {
            throw new Error(
                `counterOntologySandbox: insufficient criteria for shadow (${gate.reasons.join(', ')})`
            );
        }
    } else if (targetMode === 'live_candidate') {
        // For live_candidate, frame already passed shadow gate; ensure
        // value + stability haven't degraded. Proven-advantage check via
        // comparison data is operator-driven (canPromoteToLiveCandidate).
        if (existing.overall_value_score < MIN_VALUE_FOR_PROMOTION ||
            existing.stability_score < MIN_STABILITY_FOR_PROMOTION) {
            throw new Error(
                'counterOntologySandbox: insufficient criteria for live_candidate (value/stability degraded)'
            );
        }
    }

    _stmts.updateFrameMode.run(targetMode, ts, userId, env, frameId);
    return {
        promoted: true, frameId,
        oldMode: existing.mode,
        newMode: targetMode
    };
}

function _rowToFrame(r) {
    return {
        frameId: r.frame_id,
        frameName: r.frame_name,
        frameDescription: r.frame_description,
        primaryPrimitives: JSON.parse(r.primary_primitives_json),
        sourceMetaphor: r.source_metaphor,
        mode: r.mode,
        explanatoryNovelty: r.explanatory_novelty,
        predictiveNovelty: r.predictive_novelty,
        semanticCompression: r.semantic_compression,
        stabilityScore: r.stability_score,
        overallValueScore: r.overall_value_score,
        active: r.active === 1,
        ts: r.ts
    };
}

// ── getFramesInMode ────────────────────────────────────────────────
function getFramesInMode(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const mode = _required(params, 'mode');
    const limit = (params && params.limit) ? params.limit : 100;

    if (!FRAME_MODES.includes(mode)) {
        throw new Error(`counterOntologySandbox: invalid mode "${mode}"`);
    }
    const rows = _stmts.listByMode.all(userId, env, mode, limit);
    return rows.map(_rowToFrame);
}

// ── getFrameById ───────────────────────────────────────────────────
function getFrameById(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const frameId = _required(params, 'frameId');
    const r = _stmts.getFrame.get(userId, env, frameId);
    if (!r) return null;
    return _rowToFrame(r);
}

module.exports = {
    FRAME_MODES,
    EVALUATION_WEIGHTS,
    MIN_NOVELTY_FOR_PROMOTION,
    MIN_VALUE_FOR_PROMOTION,
    MIN_STABILITY_FOR_PROMOTION,
    computeOverallValueScore,
    canPromoteToShadow,
    canPromoteToLiveCandidate,
    evaluatePromotion,
    computeFrameAdvantage,
    registerAlienFrame,
    evaluateFrame,
    recordFrameComparison,
    promoteFrame,
    getFramesInMode,
    getFrameById
};
