'use strict';

/**
 * OMEGA _meta — semanticMemoryConsolidation (canonical §143)
 *
 * §143 SEMANTIC MEMORY CONSOLIDATION — de la episoade concrete la principii
 * profunde.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt line 4711.
 *
 * "Spec-ul are episodic memory (65) care recunoaște similitudini cu momente
 *  din trecut. Are concept library (114) care comprimă pattern-uri în
 *  abstracții reutilizabile. Dar nu există mecanismul de consolidare care
 *  transformă episoadele în înțelegere profundă — procesul analog somnului
 *  la oameni... Periodic, sistemul examinează grupuri de episoade înrudite
 *  și extrage principiul structural comun — nu 'am văzut sweep + reclaim
 *  de 47 de ori', ci 'sweep-ul autentic se distinge de cel fals prin
 *  distribuția volumului în primele 3 secunde după atingerea nivelului'.
 *  Principiul extras e testabil, generalizabil și transferabil... Fără
 *  consolidare, sistemul poate fi expert în trecut fără să devină înțelept
 *  față de viitor."
 *
 * Process: cluster related episodes → extract structural principle →
 * score (generalizability + testability + transferability) → status
 * (extracted | tested | promoted | rejected). DAG transitions enforce
 * progression to terminal states.
 *
 * Distinct from §65 episodicMemory (storage), §114 conceptLibrary
 * (compression), §123 ontologyRevisionEngine (vocab evolution), §138
 * counterOntologySandbox (alien frames), §140 cognitiveContainmentZones
 * (idea quarantine). §143 = ACTIVE periodic consolidation process.
 */

const { db } = require('../../database');

const TRIGGER_KINDS = Object.freeze([
    'scheduled', 'episode_threshold', 'manual'
]);

const PRINCIPLE_STATUSES = Object.freeze([
    'extracted', 'tested', 'promoted', 'rejected'
]);

const SESSION_STATUSES = Object.freeze(['open', 'closed']);

const QUALITY_THRESHOLDS = Object.freeze({
    promote: 0.70, reject: 0.30
});

// Generalizability heaviest = "applies beyond training set" most important
// per PDF emphasis "generalizabilă și transferabilă în contexte noi".
const QUALITY_WEIGHTS = Object.freeze({
    generalizability: 0.40,
    testability: 0.30,
    transferability: 0.30
});

const MIN_EPISODES_FOR_CLUSTER = 5;

// Valid transitions (DAG): extracted → tested → promoted | rejected.
// Also: extracted → promoted (direct, for very high quality).
// Also: extracted → rejected (direct, for clear failures).
// promoted + rejected terminal.
const VALID_PRINCIPLE_TRANSITIONS = Object.freeze({
    extracted: Object.freeze(['tested', 'promoted', 'rejected']),
    tested: Object.freeze(['promoted', 'rejected']),
    promoted: Object.freeze([]),
    rejected: Object.freeze([])
});

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`semanticMemoryConsolidation: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertSession: db.prepare(`
        INSERT INTO ml_consolidation_sessions
        (user_id, resolved_env, session_id, trigger_kind, session_status,
         episodes_examined_count, clusters_formed_count,
         principles_extracted_count, principles_promoted_count,
         principles_rejected_count, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateSessionAggregates: db.prepare(`
        UPDATE ml_consolidation_sessions
        SET session_status = ?,
            episodes_examined_count = ?,
            clusters_formed_count = ?,
            principles_extracted_count = ?,
            principles_promoted_count = ?,
            principles_rejected_count = ?,
            ts = ?
        WHERE user_id = ? AND resolved_env = ? AND session_id = ?
    `),
    getSession: db.prepare(`
        SELECT * FROM ml_consolidation_sessions
        WHERE user_id = ? AND resolved_env = ? AND session_id = ?
    `),
    listSessions: db.prepare(`
        SELECT * FROM ml_consolidation_sessions
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    insertPrinciple: db.prepare(`
        INSERT INTO ml_consolidated_principles
        (user_id, resolved_env, principle_id, session_id, principle_text,
         source_episode_ids_json, generalizability_score,
         testability_score, transferability_score,
         overall_quality_score, status, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updatePrincipleStatus: db.prepare(`
        UPDATE ml_consolidated_principles
        SET status = ?, ts = ?
        WHERE user_id = ? AND resolved_env = ? AND principle_id = ?
    `),
    getPrinciple: db.prepare(`
        SELECT * FROM ml_consolidated_principles
        WHERE user_id = ? AND resolved_env = ? AND principle_id = ?
    `),
    listPromotedPrinciples: db.prepare(`
        SELECT * FROM ml_consolidated_principles
        WHERE user_id = ? AND resolved_env = ? AND status = 'promoted'
        ORDER BY ts DESC LIMIT ?
    `)
};

// ── computeOverallQuality (pure) ───────────────────────────────────
function computeOverallQuality(params) {
    const gen = _required(params, 'generalizability');
    const test = _required(params, 'testability');
    const transf = _required(params, 'transferability');
    for (const [k, v] of [['generalizability', gen],
                          ['testability', test],
                          ['transferability', transf]]) {
        if (v < 0 || v > 1) {
            throw new Error(
                `semanticMemoryConsolidation: ${k} must be in [0,1]`
            );
        }
    }
    const W = QUALITY_WEIGHTS;
    const score = gen * W.generalizability +
                  test * W.testability +
                  transf * W.transferability;
    return { qualityScore: Math.max(0, Math.min(1, score)) };
}

// ── classifyPrincipleQuality (pure) ────────────────────────────────
// Recommends what status a principle SHOULD be classified as based on its
// quality score. NOT the actual current status (that's tracked in DB).
function classifyPrincipleQuality(params) {
    const score = _required(params, 'qualityScore');
    if (score < 0 || score > 1) {
        throw new Error(
            'semanticMemoryConsolidation: qualityScore must be in [0,1]'
        );
    }
    if (score >= QUALITY_THRESHOLDS.promote) return { candidate: 'promoted' };
    if (score < QUALITY_THRESHOLDS.reject) return { candidate: 'rejected' };
    return { candidate: 'tested' };
}

// ── assessClusterFormability (pure) ────────────────────────────────
function assessClusterFormability(params) {
    const count = _required(params, 'episodeCount');
    if (count < 0) {
        throw new Error('semanticMemoryConsolidation: episodeCount ≥ 0');
    }
    return { formable: count >= MIN_EPISODES_FOR_CLUSTER };
}

// ── isValidPrincipleTransition (pure) ──────────────────────────────
function isValidPrincipleTransition(params) {
    const from = _required(params, 'fromStatus');
    const to = _required(params, 'toStatus');
    if (!PRINCIPLE_STATUSES.includes(from)) {
        throw new Error(
            `semanticMemoryConsolidation: invalid fromStatus "${from}"`
        );
    }
    if (!PRINCIPLE_STATUSES.includes(to)) {
        throw new Error(
            `semanticMemoryConsolidation: invalid toStatus "${to}"`
        );
    }
    return { valid: VALID_PRINCIPLE_TRANSITIONS[from].includes(to) };
}

// ── startConsolidationSession ──────────────────────────────────────
function startConsolidationSession(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sessionId = _required(params, 'sessionId');
    const triggerKind = _required(params, 'triggerKind');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!TRIGGER_KINDS.includes(triggerKind)) {
        throw new Error(
            `semanticMemoryConsolidation: invalid triggerKind "${triggerKind}"`
        );
    }
    try {
        _stmts.insertSession.run(
            userId, env, sessionId, triggerKind, 'open',
            0, 0, 0, 0, 0, ts
        );
        return {
            started: true, sessionId, sessionStatus: 'open'
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `semanticMemoryConsolidation: duplicate sessionId "${sessionId}"`
            );
        }
        throw err;
    }
}

// ── recordExtractedPrinciple (integration) ─────────────────────────
function recordExtractedPrinciple(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const principleId = _required(params, 'principleId');
    const sessionId = _required(params, 'sessionId');
    const text = _required(params, 'principleText');
    const sourceEpisodes = _required(params, 'sourceEpisodeIds');
    const gen = _required(params, 'generalizability');
    const testS = _required(params, 'testability');
    const transf = _required(params, 'transferability');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!Array.isArray(sourceEpisodes)) {
        throw new Error(
            'semanticMemoryConsolidation: sourceEpisodeIds must be array'
        );
    }
    const { formable } = assessClusterFormability({
        episodeCount: sourceEpisodes.length
    });
    if (!formable) {
        throw new Error(
            `semanticMemoryConsolidation: insufficient source episodes (${sourceEpisodes.length} < MIN_EPISODES_FOR_CLUSTER ${MIN_EPISODES_FOR_CLUSTER})`
        );
    }
    const { qualityScore } = computeOverallQuality({
        generalizability: gen, testability: testS, transferability: transf
    });

    try {
        _stmts.insertPrinciple.run(
            userId, env, principleId, sessionId, text,
            JSON.stringify(sourceEpisodes),
            gen, testS, transf, qualityScore,
            'extracted', ts
        );
        return {
            recorded: true, principleId,
            qualityScore, status: 'extracted'
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(
                `semanticMemoryConsolidation: duplicate principleId "${principleId}"`
            );
        }
        if (err.message && err.message.toLowerCase().includes('foreign key')) {
            throw err;
        }
        throw err;
    }
}

// ── transitionPrincipleStatus ──────────────────────────────────────
function transitionPrincipleStatus(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const principleId = _required(params, 'principleId');
    const newStatus = _required(params, 'newStatus');
    const reason = _required(params, 'reason');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!PRINCIPLE_STATUSES.includes(newStatus)) {
        throw new Error(
            `semanticMemoryConsolidation: invalid newStatus "${newStatus}"`
        );
    }
    const p = _stmts.getPrinciple.get(userId, env, principleId);
    if (!p) {
        throw new Error(
            `semanticMemoryConsolidation: principle not found "${principleId}"`
        );
    }
    const trans = isValidPrincipleTransition({
        fromStatus: p.status, toStatus: newStatus
    });
    if (!trans.valid) {
        throw new Error(
            `semanticMemoryConsolidation: invalid transition from "${p.status}" to "${newStatus}" (terminal or skip)`
        );
    }
    _stmts.updatePrincipleStatus.run(newStatus, ts, userId, env, principleId);
    return {
        transitioned: true, principleId,
        oldStatus: p.status, newStatus, reason
    };
}

// ── closeSession ───────────────────────────────────────────────────
function closeSession(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const sessionId = _required(params, 'sessionId');
    const agg = _required(params, 'aggregates');
    const ts = (params && params.ts) ? params.ts : Date.now();

    const sess = _stmts.getSession.get(userId, env, sessionId);
    if (!sess) {
        throw new Error(
            `semanticMemoryConsolidation: session not found "${sessionId}"`
        );
    }
    _stmts.updateSessionAggregates.run(
        'closed',
        agg.episodesExaminedCount,
        agg.clustersFormedCount,
        agg.principlesExtractedCount,
        agg.principlesPromotedCount,
        agg.principlesRejectedCount,
        ts,
        userId, env, sessionId
    );
    return { closed: true, sessionId };
}

function _rowToSession(r) {
    return {
        sessionId: r.session_id,
        triggerKind: r.trigger_kind,
        sessionStatus: r.session_status,
        episodesExaminedCount: r.episodes_examined_count,
        clustersFormedCount: r.clusters_formed_count,
        principlesExtractedCount: r.principles_extracted_count,
        principlesPromotedCount: r.principles_promoted_count,
        principlesRejectedCount: r.principles_rejected_count,
        ts: r.ts
    };
}

function _rowToPrinciple(r) {
    return {
        principleId: r.principle_id,
        sessionId: r.session_id,
        principleText: r.principle_text,
        sourceEpisodeIds: JSON.parse(r.source_episode_ids_json),
        generalizabilityScore: r.generalizability_score,
        testabilityScore: r.testability_score,
        transferabilityScore: r.transferability_score,
        overallQualityScore: r.overall_quality_score,
        status: r.status,
        ts: r.ts
    };
}

// ── getSessionHistory ──────────────────────────────────────────────
function getSessionHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;
    const rows = _stmts.listSessions.all(userId, env, limit);
    return rows.map(_rowToSession);
}

// ── getPromotedPrinciples ──────────────────────────────────────────
function getPromotedPrinciples(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;
    const rows = _stmts.listPromotedPrinciples.all(userId, env, limit);
    return rows.map(_rowToPrinciple);
}

module.exports = {
    TRIGGER_KINDS,
    PRINCIPLE_STATUSES,
    SESSION_STATUSES,
    QUALITY_THRESHOLDS,
    QUALITY_WEIGHTS,
    MIN_EPISODES_FOR_CLUSTER,
    VALID_PRINCIPLE_TRANSITIONS,
    computeOverallQuality,
    classifyPrincipleQuality,
    assessClusterFormability,
    isValidPrincipleTransition,
    startConsolidationSession,
    recordExtractedPrinciple,
    transitionPrincipleStatus,
    closeSession,
    getSessionHistory,
    getPromotedPrinciples
};
