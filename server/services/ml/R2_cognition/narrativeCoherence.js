'use strict';

/**
 * OMEGA R2 Cognition — narrativeCoherence (canonical §100)
 *
 * §100 NARRATIVE COHERENCE ENGINE.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt line 2617.
 *
 * "Construieste explicit povestea cauzala din spatele trade-ului: de ce se
 *  miscă pretul, cine vinde, cine cumpara, ce se intampla cu cei prinsi pe
 *  picior gresit, si cum se termina logic aceasta secventa. Daca semnalele
 *  individuale sunt verzi DAR povestea nu are sens intern, trade-ul se
 *  blocheaza. Si invers: daca povestea e puternica si coerenta, botul poate
 *  actiona cu size mai mare chiar daca unele semnale sunt absente.
 *  Diferit de thesis graph (dependente logice) — narrative engine mapeaza
 *  plauzibilitate cauzala umana."
 *
 * Distinct from §24 detectorRegistry and §25 explainability (which explain
 * AFTER). §100 = causal narrative coherence BEFORE/DURING decision.
 */

const { db } = require('../../database');

const NARRATIVE_STATUSES = Object.freeze(['COHERENT', 'INCOHERENT', 'PENDING']);
const DECISION_OUTCOMES = Object.freeze([
    'BLOCK', 'REDUCE', 'NORMAL', 'AMPLIFY'
]);
const NARRATIVE_FIELDS = Object.freeze([
    'whyMoving', 'whoSelling', 'whoBuying',
    'trappedSide', 'expectedResolution'
]);

const DEFAULT_COHERENCE_THRESHOLD = 0.60;
const AMPLIFY_THRESHOLD = 0.85;

function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`narrativeCoherence: missing ${key}`);
    }
    return params[key];
}

const _stmts = {
    insertThread: db.prepare(`
        INSERT INTO ml_narrative_threads
        (user_id, resolved_env, thread_id, why_moving, who_selling,
         who_buying, trapped_side, expected_resolution,
         coherence_score, status, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getThread: db.prepare(`
        SELECT * FROM ml_narrative_threads WHERE thread_id = ?
    `),
    listThreads: db.prepare(`
        SELECT * FROM ml_narrative_threads
        WHERE user_id = ? AND resolved_env = ?
        ORDER BY ts DESC LIMIT ?
    `),
    updateThreadScore: db.prepare(`
        UPDATE ml_narrative_threads
        SET coherence_score = ?, status = ?
        WHERE user_id = ? AND resolved_env = ? AND thread_id = ?
    `),
    insertLink: db.prepare(`
        INSERT INTO ml_narrative_arc_links
        (user_id, resolved_env, link_id, thread_id, signal_id,
         supports, contribution, reason, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listLinksByThread: db.prepare(`
        SELECT * FROM ml_narrative_arc_links
        WHERE user_id = ? AND resolved_env = ? AND thread_id = ?
        ORDER BY ts ASC
    `)
};

// ── computeCoherenceScore (pure) ───────────────────────────────────
function computeCoherenceScore(params) {
    const thread = _required(params, 'thread');
    const links = (params && params.links) ? params.links : [];

    // 1) completeness: how many narrative fields filled
    let filled = 0;
    for (const field of NARRATIVE_FIELDS) {
        const v = thread[field];
        if (v !== undefined && v !== null && String(v).trim().length > 0) {
            filled++;
        }
    }
    const completeness = filled / NARRATIVE_FIELDS.length;

    // 2) support consistency: supporting links / total links
    let supportConsistency = 1.0;   // no links = neutral
    if (links.length > 0) {
        const supporting = links.filter(l => !!l.supports).length;
        supportConsistency = supporting / links.length;
    }

    const score = 0.6 * completeness + 0.4 * supportConsistency;
    let status;
    if (score >= DEFAULT_COHERENCE_THRESHOLD) status = 'COHERENT';
    else if (filled === 0) status = 'PENDING';
    else status = 'INCOHERENT';

    return {
        coherenceScore: score,
        completeness, supportConsistency,
        filledFields: filled, totalFields: NARRATIVE_FIELDS.length,
        linkCount: links.length,
        status
    };
}

// ── evaluateNarrativeDecision (pure) ───────────────────────────────
function evaluateNarrativeDecision(params) {
    const coherenceScore = _required(params, 'coherenceScore');
    const signalAggregateStrength = _required(params, 'signalAggregateStrength');
    const coherenceThreshold = (params && params.coherenceThreshold !== undefined)
        ? params.coherenceThreshold : DEFAULT_COHERENCE_THRESHOLD;
    const amplifyThreshold = (params && params.amplifyThreshold !== undefined)
        ? params.amplifyThreshold : AMPLIFY_THRESHOLD;

    if (coherenceScore < coherenceThreshold) {
        if (signalAggregateStrength >= 0.7) {
            return {
                decision: 'BLOCK',
                reason: 'false_confidence_no_narrative'
            };
        }
        return { decision: 'REDUCE', reason: 'weak_narrative_weak_signals' };
    }
    if (coherenceScore >= amplifyThreshold) {
        return {
            decision: 'AMPLIFY',
            reason: 'strong_narrative_can_compensate_partial_signals'
        };
    }
    return { decision: 'NORMAL', reason: 'narrative_adequate' };
}

// ── buildNarrativeThread ───────────────────────────────────────────
function buildNarrativeThread(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const threadId = _required(params, 'threadId');
    const whyMoving = (params && params.whyMoving) ? params.whyMoving : null;
    const whoSelling = (params && params.whoSelling) ? params.whoSelling : null;
    const whoBuying = (params && params.whoBuying) ? params.whoBuying : null;
    const trappedSide = (params && params.trappedSide) ? params.trappedSide : null;
    const expectedResolution = (params && params.expectedResolution) ? params.expectedResolution : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    // initial score with no links
    const cls = computeCoherenceScore({
        thread: { whyMoving, whoSelling, whoBuying, trappedSide, expectedResolution },
        links: []
    });

    try {
        _stmts.insertThread.run(
            userId, env, threadId, whyMoving, whoSelling, whoBuying,
            trappedSide, expectedResolution,
            cls.coherenceScore, cls.status, ts
        );
        return {
            built: true, threadId,
            coherenceScore: cls.coherenceScore,
            status: cls.status
        };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`narrativeCoherence: duplicate threadId "${threadId}"`);
        }
        throw err;
    }
}

// ── attachSignalToNarrative ────────────────────────────────────────
function attachSignalToNarrative(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const linkId = _required(params, 'linkId');
    const threadId = _required(params, 'threadId');
    const signalId = _required(params, 'signalId');
    const supports = _required(params, 'supports');
    const contribution = (params && params.contribution !== undefined) ? params.contribution : null;
    const reason = (params && params.reason) ? params.reason : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    const thread = _stmts.getThread.get(threadId);
    if (!thread) {
        throw new Error(`narrativeCoherence: thread "${threadId}" not found`);
    }
    if (thread.user_id !== userId || thread.resolved_env !== env) {
        throw new Error('narrativeCoherence: thread not owned by user/env');
    }

    try {
        _stmts.insertLink.run(
            userId, env, linkId, threadId, signalId,
            supports ? 1 : 0, contribution, reason, ts
        );
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`narrativeCoherence: duplicate linkId "${linkId}"`);
        }
        throw err;
    }

    // recompute coherence score using the new link
    const allLinks = _stmts.listLinksByThread.all(userId, env, threadId);
    const cls = computeCoherenceScore({
        thread: {
            whyMoving: thread.why_moving,
            whoSelling: thread.who_selling,
            whoBuying: thread.who_buying,
            trappedSide: thread.trapped_side,
            expectedResolution: thread.expected_resolution
        },
        links: allLinks.map(l => ({ supports: !!l.supports }))
    });
    _stmts.updateThreadScore.run(
        cls.coherenceScore, cls.status, userId, env, threadId
    );

    return {
        attached: true, linkId,
        newCoherenceScore: cls.coherenceScore,
        newStatus: cls.status
    };
}

// ── getNarrativeAudit ──────────────────────────────────────────────
function getNarrativeAudit(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const threadId = _required(params, 'threadId');

    const thread = _stmts.getThread.get(threadId);
    if (!thread) {
        throw new Error(`narrativeCoherence: thread "${threadId}" not found`);
    }
    if (thread.user_id !== userId || thread.resolved_env !== env) {
        throw new Error('narrativeCoherence: thread not owned by user/env');
    }

    const links = _stmts.listLinksByThread.all(userId, env, threadId);
    return {
        threadId: thread.thread_id,
        narrative: {
            whyMoving: thread.why_moving,
            whoSelling: thread.who_selling,
            whoBuying: thread.who_buying,
            trappedSide: thread.trapped_side,
            expectedResolution: thread.expected_resolution
        },
        coherenceScore: thread.coherence_score,
        status: thread.status,
        ts: thread.ts,
        links: links.map(l => ({
            linkId: l.link_id, signalId: l.signal_id,
            supports: !!l.supports,
            contribution: l.contribution, reason: l.reason, ts: l.ts
        }))
    };
}

// ── getThreadHistory ───────────────────────────────────────────────
function getThreadHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const limit = (params && params.limit) ? params.limit : 100;

    const rows = _stmts.listThreads.all(userId, env, limit);
    return rows.map(r => ({
        threadId: r.thread_id,
        coherenceScore: r.coherence_score,
        status: r.status,
        ts: r.ts
    }));
}

module.exports = {
    NARRATIVE_STATUSES,
    DECISION_OUTCOMES,
    NARRATIVE_FIELDS,
    DEFAULT_COHERENCE_THRESHOLD,
    AMPLIFY_THRESHOLD,
    computeCoherenceScore,
    evaluateNarrativeDecision,
    buildNarrativeThread,
    attachSignalToNarrative,
    getNarrativeAudit,
    getThreadHistory
};
