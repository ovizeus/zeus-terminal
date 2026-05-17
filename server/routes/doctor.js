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

module.exports = router;
