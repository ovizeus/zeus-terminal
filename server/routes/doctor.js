// Zeus Terminal — OMEGA Doctor D-4 admin-only API routes.
// Per docs/omega/FAILURE_ONTOLOGY.md + project_omega_doctor_layer_locked.md.
'use strict';

const express = require('express');
const router = express.Router();

const { db } = require('../services/database');
const registry = require('../services/ml/_doctor/moduleRegistry');
const analyzer = require('../services/ml/_doctor/analyzer');
const severityClassifier = require('../services/ml/_doctor/severityClassifier');
const falsePositiveAuditor = require('../services/ml/_doctor/falsePositiveAuditor');
const quarantineManager = require('../services/ml/_doctor/quarantineManager');
const shedManager = require('../services/ml/_doctor/shedManager');
const overrideJournal = require('../services/ml/_doctor/overrideJournal');

function _requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'admin only' });
    }
    next();
}

const MAX_EVENTS_LIMIT = 1000;
const DEFAULT_EVENTS_LIMIT = 100;

// GET /api/omega/doctor/state
// Returns current cognitive state + dashboard counts.
router.get('/state', _requireAdmin, (req, res) => {
    try {
        const dashboard = analyzer.analyze({ nowTs: Date.now() });
        res.status(200).json({ ok: true, ...dashboard });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/omega/doctor/events?since=<ts>&limit=<n>
// Returns recent diagnostic events ordered by ts desc.
router.get('/events', _requireAdmin, (req, res) => {
    try {
        let limit = parseInt(req.query.limit, 10);
        if (isNaN(limit) || limit <= 0) limit = DEFAULT_EVENTS_LIMIT;
        if (limit > MAX_EVENTS_LIMIT) limit = MAX_EVENTS_LIMIT;

        const since = parseInt(req.query.since, 10);
        let rows;
        if (!isNaN(since) && since > 0) {
            rows = db.prepare(`
                SELECT event_id, severity, module_id, event_type,
                       payload_json, verdict, ts
                FROM ml_diagnostic_events
                WHERE ts >= ?
                ORDER BY ts DESC
                LIMIT ?
            `).all(since, limit);
        } else {
            rows = db.prepare(`
                SELECT event_id, severity, module_id, event_type,
                       payload_json, verdict, ts
                FROM ml_diagnostic_events
                ORDER BY ts DESC
                LIMIT ?
            `).all(limit);
        }
        res.status(200).json({ ok: true, events: rows, limit });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/omega/doctor/modules?roleTag=<tag>
// Returns registered modules; optional filter by roleTag.
router.get('/modules', _requireAdmin, (req, res) => {
    try {
        const roleTag = req.query.roleTag;
        let modules;
        if (roleTag) {
            if (!registry.ROLE_TAGS.includes(roleTag)) {
                return res.status(400).json({ ok: false, error: `invalid roleTag: ${roleTag}` });
            }
            modules = registry.getModulesByTag({ roleTag });
        } else {
            modules = registry.listAll();
        }
        res.status(200).json({ ok: true, modules });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/omega/doctor/verdict
// Body: { eventId, verdict }
// Sets verdict on a P0/P1 alert post-hoc. Per FAILURE_ONTOLOGY FP audit workflow.
router.post('/verdict', _requireAdmin, (req, res) => {
    const body = req.body || {};
    const eventId = body.eventId;
    const verdict = body.verdict;

    if (!eventId || !verdict) {
        return res.status(400).json({ ok: false, error: 'eventId and verdict required' });
    }
    if (!falsePositiveAuditor.VERDICTS.includes(verdict)) {
        return res.status(400).json({
            ok: false, error: `invalid verdict; allowed: ${falsePositiveAuditor.VERDICTS.join(',')}`
        });
    }

    try {
        const r = falsePositiveAuditor.setVerdict({ eventId, verdict });
        res.status(200).json({ ok: true, ...r });
    } catch (err) {
        if (err.message.includes('not found')) {
            return res.status(404).json({ ok: false, error: err.message });
        }
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/omega/doctor/quota
// Returns rolling severity quota status (anti-fatigue counters).
router.get('/quota', _requireAdmin, (req, res) => {
    try {
        const status = severityClassifier.getQuotaStatus({ nowTs: Date.now() });
        res.status(200).json({ ok: true, ...status });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// === D-5 routes ===

// POST /api/omega/doctor/quarantine
// Body: { moduleId, action, reason }
router.post('/quarantine', _requireAdmin, (req, res) => {
    const body = req.body || {};
    const { moduleId, action, reason } = body;
    if (!moduleId || !action || !reason) {
        return res.status(400).json({ ok: false, error: 'moduleId/action/reason required' });
    }
    try {
        const r = quarantineManager.quarantine({
            moduleId, action, reason,
            operatorId: req.user.id, ts: Date.now()
        });
        res.status(200).json({ ok: true, ...r });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

// POST /api/omega/doctor/lift
// Body: { moduleId, liftReason }
router.post('/lift', _requireAdmin, (req, res) => {
    const body = req.body || {};
    const { moduleId, liftReason } = body;
    if (!moduleId || !liftReason) {
        return res.status(400).json({ ok: false, error: 'moduleId/liftReason required' });
    }
    try {
        const r = quarantineManager.lift({
            moduleId, liftReason, ts: Date.now()
        });
        res.status(200).json({ ok: true, ...r });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

// GET /api/omega/doctor/quarantines
// List of active quarantines.
router.get('/quarantines', _requireAdmin, (req, res) => {
    res.status(200).json({
        ok: true,
        active: quarantineManager.getActiveQuarantines(),
        counts: quarantineManager.getActiveCountsByRole()
    });
});

// GET /api/omega/doctor/shed-state
router.get('/shed-state', _requireAdmin, (req, res) => {
    res.status(200).json({
        ok: true,
        state: shedManager.getCurrentState(),
        thresholds: shedManager.SHED_THRESHOLDS
    });
});

// POST /api/omega/doctor/shed-state
// Body: { state, reason }
router.post('/shed-state', _requireAdmin, (req, res) => {
    const body = req.body || {};
    const { state, reason } = body;
    if (state == null || !reason) {
        return res.status(400).json({ ok: false, error: 'state/reason required' });
    }
    try {
        const r = shedManager.setState({ state, reason, ts: Date.now() });
        res.status(200).json({ ok: true, ...r });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

// POST /api/omega/doctor/override
// Body: { moduleId, doctorRecommendedAction, operatorForcedAction, operatorReason }
router.post('/override', _requireAdmin, (req, res) => {
    const body = req.body || {};
    const { moduleId, doctorRecommendedAction, operatorForcedAction, operatorReason } = body;
    if (!moduleId || !doctorRecommendedAction || !operatorForcedAction || !operatorReason) {
        return res.status(400).json({ ok: false,
            error: 'moduleId/doctorRecommendedAction/operatorForcedAction/operatorReason required' });
    }
    try {
        const r = overrideJournal.recordOverride({
            moduleId, doctorRecommendedAction, operatorForcedAction,
            operatorReason, operatorId: req.user.id, ts: Date.now()
        });
        res.status(200).json({ ok: true, ...r });
    } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

// POST /api/omega/doctor/override-verdict
// Body: { id, outcomeVerdict }
router.post('/override-verdict', _requireAdmin, (req, res) => {
    const body = req.body || {};
    const { id, outcomeVerdict } = body;
    if (id == null || !outcomeVerdict) {
        return res.status(400).json({ ok: false, error: 'id/outcomeVerdict required' });
    }
    try {
        const r = overrideJournal.setOutcomeVerdict({ id, outcomeVerdict });
        res.status(200).json({ ok: true, ...r });
    } catch (err) {
        const status = err.message.includes('not found') ? 404 : 400;
        res.status(status).json({ ok: false, error: err.message });
    }
});

// GET /api/omega/doctor/overrides
router.get('/overrides', _requireAdmin, (req, res) => {
    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit <= 0) limit = 50;
    if (limit > 500) limit = 500;
    res.status(200).json({
        ok: true,
        overrides: overrideJournal.listRecentOverrides({ limit })
    });
});

// ─── D-6: Cognitive Snapshots ──────────────────────────────────────────────
router.post('/snapshots', _requireAdmin, (req, res) => {
    try {
        const cs = require('../services/ml/_doctor/cognitiveSnapshot');
        const result = cs.captureSnapshot({ triggerType: 'manual' });
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.get('/snapshots', _requireAdmin, (req, res) => {
    try {
        const cs = require('../services/ml/_doctor/cognitiveSnapshot');
        const since = req.query.since ? Number(req.query.since) : undefined;
        const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 50;
        res.json({ ok: true, snapshots: cs.listSnapshots({ since, limit }) });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.get('/snapshots/:id', _requireAdmin, (req, res) => {
    try {
        const cs = require('../services/ml/_doctor/cognitiveSnapshot');
        const snap = cs.getSnapshot(Number(req.params.id));
        if (!snap) return res.status(404).json({ ok: false, error: 'Snapshot not found' });
        res.json({ ok: true, snapshot: snap });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ─── D-6: Causal Blame Tree ───────────────────────────────────────────────
router.get('/causal-chain/:moduleId', _requireAdmin, (req, res) => {
    try {
        const cc = require('../services/ml/_doctor/causalChain');
        const tree = cc.buildBlameTree({
            moduleId: req.params.moduleId,
            maxDepth: req.query.maxDepth ? Number(req.query.maxDepth) : undefined,
        });
        res.json({ ok: true, ...tree });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ─── D-6: Semantic Conflict Map ───────────────────────────────────────────
router.get('/conflict-map', _requireAdmin, (req, res) => {
    try {
        const cm = require('../services/ml/_doctor/conflictMap');
        const result = cm.compareSnapshots({
            fromId: Number(req.query.from),
            toId: req.query.to ? Number(req.query.to) : undefined,
        });
        if (result.error) return res.status(400).json({ ok: false, error: result.error });
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ─── D-7: Cognitive Sandbox ───────────────────────────────────────────────
router.post('/sandbox/create', _requireAdmin, (req, res) => {
    try {
        const sb = require('../services/ml/_doctor/cognitiveSandbox');
        const result = sb.createExperiment({
            moduleId: req.body.moduleId,
            name: req.body.name,
            variantAConfig: req.body.variantAConfig || {},
            variantBConfig: req.body.variantBConfig || {},
            allocationPctB: req.body.allocationPctB,
            actor: 'admin',
        });
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.get('/sandbox/:id', _requireAdmin, (req, res) => {
    try {
        const sb = require('../services/ml/_doctor/cognitiveSandbox');
        const status = sb.getExperimentStatus({ experimentId: Number(req.params.id) });
        if (status.error) return res.status(400).json({ ok: false, error: status.error });
        res.json({ ok: true, ...status });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.post('/sandbox/:id/complete', _requireAdmin, (req, res) => {
    try {
        const sb = require('../services/ml/_doctor/cognitiveSandbox');
        const result = sb.completeExperiment({ experimentId: Number(req.params.id) });
        if (result.error) return res.status(400).json({ ok: false, error: result.error });
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
