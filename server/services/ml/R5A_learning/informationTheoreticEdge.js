'use strict';

/**
 * OMEGA R5A Learning — informationTheoreticEdge (canonical §73)
 *
 * §73 INFORMATION-THEORETIC EDGE MEASUREMENT.
 * Source: /root/_review/ml_brain/ml_brain_canonic.txt lines 1976-1977.
 *
 * "Edge masurat in BITS, nu in procente. MI zero = zero predictive
 *  content, indiferent cat arata frumos pe backtest."
 *
 * R5A. Mutual Information edge quantification + redundancy/synergy
 * detection between signals.
 *
 * MI(X;Y) = H(Y) - H(Y|X)  in bits (log2)
 *
 * Detects:
 *   - signals with ZERO MI (no predictive content)
 *   - redundant signal pairs (same information repeated)
 *   - synergistic pairs (X+Y > MI(X) + MI(Y) → genuine interaction)
 */

const { db } = require('../../database');

const OUTCOME_BINS = Object.freeze(['win', 'loss', 'scratch']);
const SIGNAL_VALUE_BINS = 10;
const MIN_SAMPLES_FOR_MI = 30;
const REDUNDANCY_THRESHOLD = 0.85;

// ── Helpers ─────────────────────────────────────────────────────────
function _required(params, key) {
    if (!params || params[key] === undefined || params[key] === null) {
        throw new Error(`informationTheoreticEdge: missing ${key}`);
    }
    return params[key];
}

function _discretize(value) {
    if (typeof value !== 'number' || isNaN(value)) return 0;
    const clamped = Math.max(0, Math.min(1, value));
    const bin = Math.floor(clamped * SIGNAL_VALUE_BINS);
    return Math.min(SIGNAL_VALUE_BINS - 1, bin);
}

function _log2(x) {
    if (x <= 0) return 0;
    return Math.log2(x);
}

function _entropy(probs) {
    let h = 0;
    for (const p of probs) {
        if (p > 0) h -= p * _log2(p);
    }
    return h;
}

// ── Prepared statements ────────────────────────────────────────────
const _stmts = {
    getJointCount: db.prepare(`
        SELECT count FROM ml_signal_mi_observations
        WHERE user_id = ? AND resolved_env = ?
          AND signal_id = ? AND signal_value_bin = ? AND outcome = ?
    `),
    upsertJoint: db.prepare(`
        INSERT INTO ml_signal_mi_observations
        (user_id, resolved_env, signal_id, signal_value_bin, outcome, count, last_updated)
        VALUES (?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(user_id, resolved_env, signal_id, signal_value_bin, outcome) DO UPDATE SET
            count = count + 1,
            last_updated = excluded.last_updated
    `),
    getAllJointForSignal: db.prepare(`
        SELECT signal_value_bin, outcome, count FROM ml_signal_mi_observations
        WHERE user_id = ? AND resolved_env = ? AND signal_id = ?
    `),
    upsertMIScore: db.prepare(`
        INSERT INTO ml_signal_mi_scores
        (user_id, resolved_env, signal_id, mutual_information_bits,
         joint_entropy_bits, sample_count, last_computed)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, resolved_env, signal_id) DO UPDATE SET
            mutual_information_bits = excluded.mutual_information_bits,
            joint_entropy_bits = excluded.joint_entropy_bits,
            sample_count = excluded.sample_count,
            last_computed = excluded.last_computed
    `),
    getMIScore: db.prepare(`
        SELECT * FROM ml_signal_mi_scores
        WHERE user_id = ? AND resolved_env = ? AND signal_id = ?
    `),
    rankBySignal: db.prepare(`
        SELECT signal_id, mutual_information_bits, sample_count, last_computed
        FROM ml_signal_mi_scores
        WHERE user_id = ? AND resolved_env = ?
          AND (? = 0 OR last_computed >= ?)
        ORDER BY mutual_information_bits DESC
    `)
};

// ── recordSignalOutcome ────────────────────────────────────────────
function recordSignalOutcome(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const signalId = _required(params, 'signalId');
    const signalValue = _required(params, 'signalValue');
    const outcome = _required(params, 'outcome');
    const ts = (params && params.ts) ? params.ts : Date.now();

    if (!OUTCOME_BINS.includes(outcome)) {
        throw new Error(`informationTheoreticEdge: invalid outcome "${outcome}"`);
    }

    const bin = _discretize(signalValue);
    _stmts.upsertJoint.run(userId, env, signalId, bin, outcome, ts);

    return { recorded: true, bin };
}

// ── computeMutualInformation ───────────────────────────────────────
function computeMutualInformation(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const signalId = _required(params, 'signalId');

    const rows = _stmts.getAllJointForSignal.all(userId, env, signalId);

    let total = 0;
    for (const r of rows) total += r.count;

    if (total < MIN_SAMPLES_FOR_MI) {
        return { sufficient: false, miBits: 0, sampleCount: total };
    }

    // Joint distribution P(X=bin, Y=outcome)
    const joint = {};   // key: `${bin}|${outcome}`
    const pX = {};      // P(X=bin)
    const pY = {};      // P(Y=outcome)

    for (const r of rows) {
        const k = `${r.signal_value_bin}|${r.outcome}`;
        joint[k] = (joint[k] || 0) + r.count;
        pX[r.signal_value_bin] = (pX[r.signal_value_bin] || 0) + r.count;
        pY[r.outcome] = (pY[r.outcome] || 0) + r.count;
    }

    // Normalize
    for (const k of Object.keys(joint)) joint[k] /= total;
    for (const k of Object.keys(pX)) pX[k] /= total;
    for (const k of Object.keys(pY)) pY[k] /= total;

    // MI = Σ P(x,y) log2 [ P(x,y) / (P(x)P(y)) ]
    let mi = 0;
    let jointH = 0;
    for (const k of Object.keys(joint)) {
        const p = joint[k];
        if (p > 0) jointH -= p * _log2(p);
        const [binStr, outcome] = k.split('|');
        const px = pX[binStr] || 0;
        const py = pY[outcome] || 0;
        if (px > 0 && py > 0 && p > 0) {
            mi += p * _log2(p / (px * py));
        }
    }

    // Numerical: clamp tiny negatives to 0
    if (mi < 0 && mi > -1e-9) mi = 0;

    return {
        sufficient: true,
        miBits: mi,
        jointEntropyBits: jointH,
        sampleCount: total
    };
}

// ── recordMIScore ──────────────────────────────────────────────────
function recordMIScore(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const signalId = _required(params, 'signalId');
    const miBits = _required(params, 'miBits');
    const jointEntropy = _required(params, 'jointEntropy');
    const sampleCount = _required(params, 'sampleCount');
    const ts = (params && params.ts) ? params.ts : Date.now();

    _stmts.upsertMIScore.run(
        userId, env, signalId,
        miBits, jointEntropy, sampleCount, ts
    );
    return { recorded: true };
}

// ── computeAndRecordMI ─────────────────────────────────────────────
function computeAndRecordMI(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const signalId = _required(params, 'signalId');

    const r = computeMutualInformation({ userId, resolvedEnv: env, signalId });
    if (!r.sufficient) return r;

    recordMIScore({
        userId, resolvedEnv: env, signalId,
        miBits: r.miBits, jointEntropy: r.jointEntropyBits,
        sampleCount: r.sampleCount
    });

    return r;
}

// ── detectSynergy ──────────────────────────────────────────────────
function detectSynergy(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const signalIdA = _required(params, 'signalIdA');
    const signalIdB = _required(params, 'signalIdB');
    const jointMIBits = _required(params, 'jointMIBits');

    const miA = computeMutualInformation({
        userId, resolvedEnv: env, signalId: signalIdA
    });
    const miB = computeMutualInformation({
        userId, resolvedEnv: env, signalId: signalIdB
    });

    if (!miA.sufficient || !miB.sufficient) {
        return { synergistic: false, reason: 'insufficient_samples' };
    }

    const sumIndividual = miA.miBits + miB.miBits;
    const synergyMargin = jointMIBits - sumIndividual;
    const synergistic = synergyMargin > Math.abs(sumIndividual) * 0.05;

    return {
        synergistic,
        jointMIBits,
        sumIndividualMI: sumIndividual,
        synergyMargin
    };
}

// ── detectRedundancy ───────────────────────────────────────────────
function detectRedundancy(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const signalIds = _required(params, 'signalIds');
    const threshold = (params && typeof params.threshold === 'number')
        ? params.threshold : REDUNDANCY_THRESHOLD;

    if (!Array.isArray(signalIds) || signalIds.length < 2) {
        return { pairs: [] };
    }

    // Build joint distributions for each signal
    const distributions = {};
    for (const sid of signalIds) {
        const rows = _stmts.getAllJointForSignal.all(userId, env, sid);
        const vec = new Array(SIGNAL_VALUE_BINS * OUTCOME_BINS.length).fill(0);
        let total = 0;
        for (const r of rows) {
            const outIdx = OUTCOME_BINS.indexOf(r.outcome);
            if (outIdx >= 0) {
                vec[r.signal_value_bin * OUTCOME_BINS.length + outIdx] = r.count;
                total += r.count;
            }
        }
        if (total > 0) {
            for (let i = 0; i < vec.length; i++) vec[i] /= total;
        }
        distributions[sid] = vec;
    }

    const pairs = [];
    for (let i = 0; i < signalIds.length; i++) {
        for (let j = i + 1; j < signalIds.length; j++) {
            const v1 = distributions[signalIds[i]];
            const v2 = distributions[signalIds[j]];
            let dot = 0, n1 = 0, n2 = 0;
            for (let k = 0; k < v1.length; k++) {
                dot += v1[k] * v2[k];
                n1 += v1[k] * v1[k];
                n2 += v2[k] * v2[k];
            }
            const cos = (n1 > 0 && n2 > 0) ? dot / (Math.sqrt(n1) * Math.sqrt(n2)) : 0;
            if (cos >= threshold) {
                pairs.push({
                    signalA: signalIds[i],
                    signalB: signalIds[j],
                    cosineSimilarity: cos
                });
            }
        }
    }

    return { pairs };
}

// ── getMIRanking ───────────────────────────────────────────────────
function getMIRanking(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const lookbackDays = (params && params.lookbackDays) ? params.lookbackDays : 90;

    const since = Date.now() - lookbackDays * 86400000;
    return _stmts.rankBySignal.all(
        userId, env,
        since > 0 ? 1 : 0, since
    );
}

// ── getMIScore ─────────────────────────────────────────────────────
function getMIScore(params) {
    const userId = _required(params, 'userId');
    const env = _required(params, 'resolvedEnv');
    const signalId = _required(params, 'signalId');
    const row = _stmts.getMIScore.get(userId, env, signalId);
    return row || null;
}

module.exports = {
    OUTCOME_BINS,
    SIGNAL_VALUE_BINS,
    MIN_SAMPLES_FOR_MI,
    REDUNDANCY_THRESHOLD,
    recordSignalOutcome,
    computeMutualInformation,
    recordMIScore,
    computeAndRecordMI,
    detectSynergy,
    detectRedundancy,
    getMIRanking,
    getMIScore
};
