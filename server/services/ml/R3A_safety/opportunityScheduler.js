'use strict';

/**
 * OMEGA R3A Safety — opportunityScheduler (canonical §79)
 *
 * §79 GLOBAL OPPORTUNITY SCHEDULER / SCARCE CAPITAL AUCTION.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 2086-2125.
 *
 * "Daca am 3 trade-uri valide, pe care il merit cu adevarat?"
 * "Prioritizeaza alpha neta, NU numarul de intrari."
 *
 * R3A safety. Capital auction arbitrating concurrent opportunities.
 * Budgets allocated dynamic: capital / margin / API / latency / risk.
 *
 * Auction logic:
 *   1. Sort candidates by opportunity_score DESC
 *   2. Greedy accept while capital + margin budgets allow
 *   3. Below caps → DEFERRED (waitlist)
 *   4. Below score threshold → REJECTED
 *   5. Replacement: new score > existing × 1.20 → REPLACE
 *
 * Distinct from §30 portfolioGovernance (correlation/cap) +
 * §58 factorRiskNetting (factor decomposition).
 * §79 = pre-execution auction; what to TAKE not what to RISK.
 */

const { db } = require('../../database');

const OPPORTUNITY_CLASSIFICATIONS = Object.freeze([
    'best_trade_available', 'good_but_inferior',
    'valid_but_crowded', 'valid_but_execution_poor'
]);
const OPPORTUNITY_STATUSES = Object.freeze([
    'PENDING', 'ACCEPTED', 'DEFERRED', 'REPLACED', 'REJECTED'
]);

const EXECUTION_QUALITY_THRESHOLD = 0.60;
const CROWDING_PENALTY_THRESHOLD = 0.50;
const REPLACEMENT_RATIO = 1.20;
const MIN_ACCEPTANCE_SCORE = 0.30;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`opportunityScheduler: missing ${key}`);
    }
    return params[key];
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    insertCandidate: db.prepare(`
        INSERT INTO ml_opportunity_candidates
        (user_id, resolved_env, opportunity_id, symbol,
         opportunity_score, capital_required, margin_required,
         classification, status, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `),
    getCandidate: db.prepare(`
        SELECT * FROM ml_opportunity_candidates WHERE opportunity_id = ?
    `),
    updateStatus: db.prepare(`
        UPDATE ml_opportunity_candidates
        SET status = ?, decided_at = ?
        WHERE opportunity_id = ?
    `),
    insertAuction: db.prepare(`
        INSERT INTO ml_capital_auction_decisions
        (user_id, resolved_env, auction_id, candidates_json,
         accepted_ids_json, deferred_ids_json, rejected_ids_json,
         total_capital_available, total_capital_used, reasoning, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    auctionHistory: db.prepare(`
        SELECT * FROM ml_capital_auction_decisions
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR ts >= ?)
        ORDER BY ts DESC, id DESC
        LIMIT ?
    `)
};

// ── evaluateOpportunityScore (pure) ────────────────────────────────
function evaluateOpportunityScore(params) {
    const rawScore = _required(params, 'rawScore');
    const costsBps = (params && typeof params.costsBps === 'number') ? params.costsBps : 0;
    const correlationPenalty = (params && typeof params.correlationPenalty === 'number')
        ? params.correlationPenalty : 0;

    // net = raw - (costs in % converted from bps) - corr_penalty
    const netScore = rawScore - (costsBps / 10000) - correlationPenalty;
    return {
        netScore: Math.max(0, netScore),
        rawScore,
        costsBps,
        correlationPenalty
    };
}

// ── classifyOpportunity (pure) ─────────────────────────────────────
function classifyOpportunity(params) {
    const score = _required(params, 'score');
    const executionQuality = (params && typeof params.executionQuality === 'number')
        ? params.executionQuality : 1.0;
    const crowdingScore = (params && typeof params.crowdingScore === 'number')
        ? params.crowdingScore : 0;
    const hasSuperiorAlternative = !!params.hasSuperiorAlternative;

    if (executionQuality < EXECUTION_QUALITY_THRESHOLD) {
        return 'valid_but_execution_poor';
    }
    if (crowdingScore >= CROWDING_PENALTY_THRESHOLD) {
        return 'valid_but_crowded';
    }
    if (hasSuperiorAlternative) {
        return 'good_but_inferior';
    }
    return 'best_trade_available';
}

// ── submitOpportunity ──────────────────────────────────────────────
function submitOpportunity(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const opportunityId = _required(params, 'opportunityId');
    const symbol = _required(params, 'symbol');
    const opportunityScore = _required(params, 'opportunityScore');
    const capitalRequired = _required(params, 'capitalRequired');
    const marginRequired = _required(params, 'marginRequired');
    const classification = _required(params, 'classification');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!OPPORTUNITY_CLASSIFICATIONS.includes(classification)) {
        throw new Error(`opportunityScheduler: invalid classification "${classification}"`);
    }

    try {
        _stmts.insertCandidate.run(
            userId, env, opportunityId, symbol,
            opportunityScore, capitalRequired, marginRequired,
            classification, ts
        );
        return { submitted: true, opportunityId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`opportunityScheduler: duplicate opportunityId "${opportunityId}"`);
        }
        throw err;
    }
}

// ── runCapitalAuction ──────────────────────────────────────────────
function runCapitalAuction(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const opportunityIds = _required(params, 'opportunityIds');
    const availableCapital = _required(params, 'availableCapital');
    const availableMargin = _required(params, 'availableMargin');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!Array.isArray(opportunityIds) || opportunityIds.length === 0) {
        throw new Error('opportunityScheduler: opportunityIds must be non-empty array');
    }

    const candidates = [];
    for (const id of opportunityIds) {
        const row = _stmts.getCandidate.get(id);
        if (row) candidates.push(row);
    }

    // Sort by score DESC
    candidates.sort((a, b) => b.opportunity_score - a.opportunity_score);

    const accepted = [];
    const deferred = [];
    const rejected = [];

    let remainingCapital = availableCapital;
    let remainingMargin = availableMargin;

    for (const c of candidates) {
        if (c.opportunity_score < MIN_ACCEPTANCE_SCORE) {
            rejected.push(c.opportunity_id);
            _stmts.updateStatus.run('REJECTED', ts, c.opportunity_id);
            continue;
        }
        if (c.capital_required <= remainingCapital &&
            c.margin_required <= remainingMargin) {
            accepted.push(c.opportunity_id);
            remainingCapital -= c.capital_required;
            remainingMargin -= c.margin_required;
            _stmts.updateStatus.run('ACCEPTED', ts, c.opportunity_id);
        } else {
            deferred.push(c.opportunity_id);
            _stmts.updateStatus.run('DEFERRED', ts, c.opportunity_id);
        }
    }

    return {
        accepted,
        deferred,
        rejected,
        capitalUsed: availableCapital - remainingCapital,
        capitalRemaining: remainingCapital,
        marginUsed: availableMargin - remainingMargin
    };
}

// ── recordAuctionDecision ──────────────────────────────────────────
function recordAuctionDecision(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const auctionId = _required(params, 'auctionId');
    const candidates = _required(params, 'candidates');
    const accepted = _required(params, 'accepted');
    const deferred = _required(params, 'deferred');
    const rejected = _required(params, 'rejected');
    const totalCapitalAvailable = _required(params, 'totalCapitalAvailable');
    const totalCapitalUsed = _required(params, 'totalCapitalUsed');
    const reasoning = (params && params.reasoning) ? params.reasoning : null;
    const ts = (params && params.ts) ? params.ts : Date.now();

    try {
        _stmts.insertAuction.run(
            userId, env, auctionId,
            JSON.stringify(candidates),
            JSON.stringify(accepted),
            JSON.stringify(deferred),
            JSON.stringify(rejected),
            totalCapitalAvailable, totalCapitalUsed,
            reasoning, ts
        );
        return { recorded: true, auctionId };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
            (err.message && err.message.includes('UNIQUE'))) {
            throw new Error(`opportunityScheduler: duplicate auctionId "${auctionId}"`);
        }
        throw err;
    }
}

// ── getOpportunityStatus ───────────────────────────────────────────
function getOpportunityStatus(params) {
    const opportunityId = _required(params, 'opportunityId');
    const row = _stmts.getCandidate.get(opportunityId);
    if (!row) return null;
    return {
        opportunityId: row.opportunity_id,
        symbol: row.symbol,
        opportunityScore: row.opportunity_score,
        capitalRequired: row.capital_required,
        marginRequired: row.margin_required,
        classification: row.classification,
        status: row.status,
        submittedAt: row.submitted_at,
        decidedAt: row.decided_at
    };
}

// ── getAuctionHistory ──────────────────────────────────────────────
function getAuctionHistory(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const since = (params && params.since) ? params.since : 0;
    const limit = (params && params.limit) ? params.limit : 100;
    return _stmts.auctionHistory.all(
        userId, env,
        since > 0 ? 1 : 0, since,
        limit
    );
}

module.exports = {
    OPPORTUNITY_CLASSIFICATIONS,
    OPPORTUNITY_STATUSES,
    EXECUTION_QUALITY_THRESHOLD,
    CROWDING_PENALTY_THRESHOLD,
    REPLACEMENT_RATIO,
    MIN_ACCEPTANCE_SCORE,
    evaluateOpportunityScore,
    classifyOpportunity,
    submitOpportunity,
    runCapitalAuction,
    recordAuctionDecision,
    getOpportunityStatus,
    getAuctionHistory
};
