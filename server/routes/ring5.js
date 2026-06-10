// Zeus Terminal — Ring5 ML influence pipeline admin-only API routes.
// Per ML Plan v3 Phase B Day 5 Phase 7. Mirrors routes/doctor.js shape.
'use strict';

const express = require('express');
const router = express.Router();

const { db } = require('../services/database');
const influenceEligibility = require('../services/ml/_ring5/influenceEligibility');
const banditPosteriors = require('../services/ml/_ring5/banditPosteriors');
const effectiveStatus = require('../services/ml/_ring5/effectiveStatus');
const versionRegistry = require('../services/ml/R5B_governance/versionRegistry');
const preRegistration = require('../services/ml/R5B_governance/preRegistration');

const INFLUENCE_COMPONENT_TYPE = 'model';
const INFLUENCE_COMPONENT_ID = 'ring5-bandit-influence-phase4';
const INFLUENCE_VERSION = 'v1.0.0';
const TERMINAL_PREREG_STATES = new Set(['PASS', 'FAIL', 'INVALID']);
const SEED_EVAL_WINDOW_DAYS = 30;

function _requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'admin only' });
    }
    next();
}

const MAX_AUDIT_LIMIT = 1000;
const DEFAULT_AUDIT_LIMIT = 100;
const VALID_STATUSES = new Set(['accepted', 'rejected', 'skipped']);

// GET /api/ring5/audit?since=ts&limit=N&status=accepted|rejected|skipped
router.get('/audit', _requireAdmin, (req, res) => {
    try {
        let limit = parseInt(req.query.limit, 10);
        if (isNaN(limit) || limit <= 0) limit = DEFAULT_AUDIT_LIMIT;
        if (limit > MAX_AUDIT_LIMIT) limit = MAX_AUDIT_LIMIT;

        const since = parseInt(req.query.since, 10);
        const status = req.query.status;

        const conds = [];
        const params = [];
        if (!isNaN(since) && since > 0) {
            conds.push('created_at >= ?');
            params.push(since);
        }
        if (status && VALID_STATUSES.has(status)) {
            conds.push('gate_status = ?');
            params.push(status);
        }
        const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

        const sql = `
            SELECT id, user_id, env, symbol, regime,
                   phase2_dir, phase2_confidence, phase2_score,
                   proposed_dir, proposed_confidence, proposed_score,
                   gate_status, gate_reason, rationale_json, created_at
            FROM ml_influence_audit ${where}
            ORDER BY created_at DESC
            LIMIT ?
        `;
        const rows = db.prepare(sql).all(...params, limit);

        res.status(200).json({ ok: true, rows, count: rows.length });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/ring5/eligibility?userId=X&env=DEMO&symbol=Y&regime=Z
router.get('/eligibility', _requireAdmin, (req, res) => {
    try {
        const userId = parseInt(req.query.userId, 10);
        const env = req.query.env;
        const symbol = req.query.symbol;
        const regime = req.query.regime;
        if (!userId || !env || !symbol || !regime) {
            return res.status(400).json({
                ok: false,
                error: 'missing required query params: userId, env, symbol, regime'
            });
        }
        const eligibility = influenceEligibility.checkEligibility({
            userId, env, symbol, regime, nowTs: Date.now()
        });
        res.status(200).json({ ok: true, eligibility });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/ring5/posteriors?userId=X&env=DEMO&symbol=Y&regime=Z
router.get('/posteriors', _requireAdmin, (req, res) => {
    try {
        const userId = parseInt(req.query.userId, 10);
        const env = req.query.env;
        const symbol = req.query.symbol;
        const regime = req.query.regime;
        if (!userId || !env || !symbol || !regime) {
            return res.status(400).json({
                ok: false,
                error: 'missing required query params: userId, env, symbol, regime'
            });
        }
        const nowTs = Date.now();
        const posteriors = {
            L0: banditPosteriors.getPosterior({ level: 0, cellKey: 'global' }),
            L1: banditPosteriors.getPosterior({ level: 1, cellKey: env }),
            L2: banditPosteriors.getPosterior({ level: 2, cellKey: `${env}:${symbol}` }),
            L3: banditPosteriors.getPosterior({ level: 3, cellKey: `${env}:${symbol}:${regime}` }),
            L4: banditPosteriors.getPosterior({ level: 4, cellKey: `${userId}:${env}:${symbol}:${regime}` })
        };
        const effective = effectiveStatus.resolve({ userId, env, symbol, regime, nowTs });
        res.status(200).json({ ok: true, posteriors, effective });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/ring5/audit/timeseries — bucketed counts for sparkline.
// Default: 5min buckets across last 2h (24 points).
router.get('/audit/timeseries', _requireAdmin, (req, res) => {
    try {
        const bucketMs = 300000; // 5 min
        const windowMs = 2 * 3600 * 1000; // 2h
        const nowMs = Date.now();
        const sinceMs = nowMs - windowMs;
        const rows = db.prepare(`
            SELECT
                CAST((created_at - ?) / ? AS INTEGER) AS bucket_idx,
                SUM(CASE WHEN gate_status='accepted' THEN 1 ELSE 0 END) AS accepted,
                SUM(CASE WHEN gate_status='rejected' THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN gate_status='skipped'  THEN 1 ELSE 0 END) AS skipped,
                COUNT(*) AS n
            FROM ml_influence_audit
            WHERE created_at >= ?
            GROUP BY bucket_idx
            ORDER BY bucket_idx ASC
        `).all(sinceMs, bucketMs, sinceMs);
        const buckets = rows.map(r => ({
            ts: sinceMs + r.bucket_idx * bucketMs,
            n: r.n, accepted: r.accepted, rejected: r.rejected, skipped: r.skipped
        }));
        res.status(200).json({ ok: true, bucketMs, windowMs, buckets });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/ring5/audit/aggregate?since=ts
// Group audit rows by (symbol, regime, gate_status). Default window = last 24h.
router.get('/audit/aggregate', _requireAdmin, (req, res) => {
    try {
        const sinceRaw = req.query.since;
        let since;
        if (sinceRaw !== undefined) {
            const parsed = parseInt(sinceRaw, 10);
            since = isNaN(parsed) ? Date.now() - 24 * 3600 * 1000 : parsed;
        } else {
            since = Date.now() - 24 * 3600 * 1000;
        }
        const where = since > 0 ? 'WHERE created_at >= ?' : '';
        const params = since > 0 ? [since] : [];
        const buckets = db.prepare(`
            SELECT symbol, regime, gate_status, COUNT(*) as n,
                   AVG(phase2_confidence) as avg_p2_conf,
                   AVG(proposed_confidence) as avg_proposed_conf
            FROM ml_influence_audit
            ${where}
            GROUP BY symbol, regime, gate_status
            ORDER BY n DESC, symbol ASC, regime ASC, gate_status ASC
        `).all(...params);
        const totalRows = buckets.reduce((s, b) => s + b.n, 0);
        res.status(200).json({ ok: true, buckets, totalRows, since });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/ring5/cells?limit=N
// List L4 bandit cells sorted by observation count descending.
router.get('/cells', _requireAdmin, (req, res) => {
    try {
        let limit = parseInt(req.query.limit, 10);
        if (isNaN(limit) || limit <= 0) limit = 100;
        if (limit > 500) limit = 500;
        const rows = db.prepare(`
            SELECT cell_key as cellKey, alpha, beta,
                   observation_count as observationCount,
                   updated_at as updatedAt
            FROM ml_bandit_posteriors
            WHERE level = 4
            ORDER BY observation_count DESC, updated_at DESC
            LIMIT ?
        `).all(limit);
        res.status(200).json({ ok: true, cells: rows });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/ring5/influence/seed — idempotent activator. Creates active version
// + non-terminal preReg for the influence component if none exist. Returns
// existing IDs if already active. Required for eligibility gate to ever pass.
router.post('/influence/seed', _requireAdmin, (req, res) => {
    try {
        const now = Date.now();

        let activeVersion = versionRegistry.getActive(INFLUENCE_COMPONENT_TYPE, INFLUENCE_COMPONENT_ID);
        let activeReg = null;
        if (activeVersion) {
            const regs = preRegistration.getRegistrationsForVersion(activeVersion.id);
            activeReg = regs.find(r => !TERMINAL_PREREG_STATES.has(r.state)) || null;
        }

        if (activeVersion && activeReg) {
            return res.status(200).json({
                ok: true,
                status: 'already_active',
                versionId: activeVersion.id,
                preRegId: activeReg.id
            });
        }

        if (!activeVersion) {
            const proposed = versionRegistry.proposeVersion({
                componentType: INFLUENCE_COMPONENT_TYPE,
                componentId: INFLUENCE_COMPONENT_ID,
                version: INFLUENCE_VERSION,
                config: { phase: 'Phase 4 influence proposer; confidence-only delta' },
                motivation: 'operator-activated seed via /api/ring5/influence/seed',
                actor: 'operator:' + (req.user.id || 'unknown')
            });
            versionRegistry.activateVersion({ id: proposed.id });
            activeVersion = { id: proposed.id };
        }

        const evalToMs = now + SEED_EVAL_WINDOW_DAYS * 86400000;
        const preReg = preRegistration.registerHypothesis({
            versionId: activeVersion.id,
            hypothesis: 'Ring5 confidence delta proposer (boost/cut) yields net-positive impact on closed-trade outcomes vs phase2-only baseline.',
            predictedMetrics: { winRateDelta: 0.03, expectedSharpeDelta: 0.10 },
            successCriteria: [
                { metric: 'winRateDelta', op: '>=', value: 0.00 }
            ],
            evalWindow: { fromMs: now, toMs: evalToMs },
            actor: 'operator:' + (req.user.id || 'unknown')
        });

        res.status(200).json({
            ok: true,
            status: 'seeded',
            versionId: activeVersion.id,
            preRegId: preReg.id
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/ring5/influence/status — current active version + preReg state.
router.get('/influence/status', _requireAdmin, (req, res) => {
    try {
        const activeVersion = versionRegistry.getActive(INFLUENCE_COMPONENT_TYPE, INFLUENCE_COMPONENT_ID);
        if (!activeVersion) {
            return res.status(200).json({
                ok: true, active: false,
                versionId: null, preRegId: null, preRegState: null
            });
        }
        const regs = preRegistration.getRegistrationsForVersion(activeVersion.id);
        const activeReg = regs.find(r => !TERMINAL_PREREG_STATES.has(r.state)) || null;
        res.status(200).json({
            ok: true,
            active: !!activeReg,
            versionId: activeVersion.id,
            preRegId: activeReg ? activeReg.id : null,
            preRegState: activeReg ? activeReg.state : null
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// [REAL-GATE P0-3 2026-06-09] Per-user REAL ML influence consent.
// Self-service (req.user.id only — no cross-user access), audited in store.
// NOT admin-gated: any authenticated user manages only their own consent.
const mlLiveOptin = require('../services/ml/mlLiveOptin');

router.get('/live-optin', (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'auth required' });
    res.json({ ok: true, optedIn: mlLiveOptin.isOptedIn(req.user.id) });
});

router.post('/live-optin', (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'auth required' });
    // Strict boolean: anything other than literal true is treated as revoke (fail-closed).
    const optedIn = req.body && req.body.optedIn === true;
    try {
        const result = mlLiveOptin.setOptin(req.user.id, optedIn, 'api', req.ip || null);
        res.json({ ok: true, ...result });
    } catch (err) {
        // GRANT path is transactional with its audit row and throws if the audit
        // cannot be written — do not report success without an audit trail.
        console.error('[ring5/live-optin] setOptin failed:', err.message);
        res.status(500).json({ ok: false, error: 'optin update failed' });
    }
});

module.exports = router;
