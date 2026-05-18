'use strict';

/**
 * OMEGA UI API Routes (Wave 1 read-only UI scope)
 *
 * Surfaces ml_voice_log / ml_decision_snapshots / ring health to the client.
 * Strict per-user isolation (req.user.id from JWT middleware). Read-only —
 * no mutation paths. Chat POST returns stub responses until Wave 8 wires
 * the real `chatResponder` from `_voice/chatResponder.js`.
 *
 * All endpoints require authenticated session (sessionAuth middleware
 * applied at /api/* level in server.js).
 */

const express = require('express');
const router = express.Router();

const { db } = require('../services/database');
const voiceLogger = require('../services/ml/_voice/voiceLogger');
const chatResponder = require('../services/ml/_voice/chatResponder');
const auditTrail = require('../services/ml/_audit/auditTrail');
const R0 = require('../services/ml/R0_substrate');
// [OMEGA Wave 2 UI Bonus 2026-05-15] R5A measurement triad surfacing
const attribution = require('../services/ml/R5A_learning/attributionEngine');
const calibration = require('../services/ml/R5A_learning/calibration');
const drift = require('../services/ml/R5A_learning/driftDetection');

const MOODS = ['CALM', 'FOCUSED', 'EXCITED', 'NERVOUS', 'ANGRY', 'SAD', 'BORED'];

function _requireUser(req, res) {
    if (!req.user || !req.user.id) {
        res.status(401).json({ ok: false, error: 'unauthorized' });
        return null;
    }
    return req.user.id;
}

// ── GET /api/omega/voice?limit=N ──────────────────────────────────────────
// Returns most recent utterances for the authenticated user.
router.get('/voice', (req, res) => {
    const userId = _requireUser(req, res);
    if (!userId) return;
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 50));
    try {
        const rows = voiceLogger.getRecent({ userId, limit });
        res.json({ ok: true, utterances: rows });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
});

// ── GET /api/omega/mood ─────────────────────────────────────────────────────
// Returns current mood for Orb animation, derived from REAL Ring5 audit
// activity in the last 5 minutes. Fall back to demo cycle when no audit data
// exists yet (very early in deployment or after a clean).
//
// Mood resolution:
//   accepted dominant       -> EXCITED  (proposer firing successfully)
//   rejected dominant       -> NERVOUS  (wants to act, blocked by reflection)
//   skipped/no_proposal     -> FOCUSED  (eligibility OK, ML neutral signal)
//   skipped/not_eligible    -> CALM     (bandit cold, still learning)
//   no rows at all          -> BORED    (decision flow stalled)
//
// Intensity = audit_rows_last_1min / 30 clamped [0.1, 1.0].
function _resolveRing5Mood() {
    try {
        const nowMs = Date.now();
        const since5m = nowMs - 5 * 60 * 1000;
        const since1m = nowMs - 60 * 1000;

        // Check ml_influence_audit table exists (Day 3+ schema).
        const has = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_influence_audit'"
        ).get();
        if (!has) return null;

        const dist = db.prepare(`
            SELECT gate_status, gate_reason, COUNT(*) AS n
            FROM ml_influence_audit
            WHERE created_at >= ?
            GROUP BY gate_status, gate_reason
        `).all(since5m);

        const total = dist.reduce((s, r) => s + r.n, 0);
        if (total === 0) return null; // fall back to demo cycle

        let accepted = 0, rejected = 0, skippedNoProp = 0, skippedNotElig = 0;
        for (const r of dist) {
            if (r.gate_status === 'accepted') accepted += r.n;
            else if (r.gate_status === 'rejected') rejected += r.n;
            else if (r.gate_status === 'skipped') {
                if (r.gate_reason === 'no_proposal') skippedNoProp += r.n;
                else if (r.gate_reason && r.gate_reason.startsWith('not_eligible_')) skippedNotElig += r.n;
            }
        }

        const last1m = db.prepare(
            "SELECT COUNT(*) AS n FROM ml_influence_audit WHERE created_at >= ?"
        ).get(since1m).n;

        let mood;
        const acceptRatio = accepted / total;
        const rejectRatio = rejected / total;
        const noPropRatio = skippedNoProp / total;
        if (acceptRatio > 0.10) mood = 'EXCITED';
        else if (rejectRatio > 0.10) mood = 'NERVOUS';
        else if (noPropRatio > 0.30) mood = 'FOCUSED';
        else if (skippedNotElig / total > 0.50) mood = 'CALM';
        else mood = 'CALM';

        const intensity = Math.max(0.1, Math.min(1.0, last1m / 30));

        return {
            mood,
            intensity,
            source: 'ring5_activity',
            metrics: {
                total_5m: total,
                accepted_5m: accepted,
                rejected_5m: rejected,
                skipped_no_proposal_5m: skippedNoProp,
                skipped_not_eligible_5m: skippedNotElig,
                rows_last_1m: last1m
            }
        };
    } catch (_) {
        return null; // any error -> fall back to demo cycle
    }
}

router.get('/mood', (req, res) => {
    const userId = _requireUser(req, res);
    if (!userId) return;

    const real = _resolveRing5Mood();
    if (real) {
        return res.json({ ok: true, ...real });
    }

    // Fallback: deterministic demo cycle (used only when no audit rows yet)
    const cycleMs = 14_000;
    const idx = Math.floor((Date.now() / cycleMs) % MOODS.length);
    const mood = MOODS[idx];
    const phase = ((Date.now() % cycleMs) / cycleMs);
    const intensity = mood === 'EXCITED' || mood === 'ANGRY' ? 0.7 + 0.3 * Math.sin(phase * Math.PI * 4)
        : mood === 'NERVOUS' ? 0.5 + 0.5 * Math.random()
        : mood === 'BORED' || mood === 'SAD' ? 0.25 + 0.1 * Math.sin(phase * Math.PI * 2)
        : 0.5 + 0.2 * Math.sin(phase * Math.PI * 2);
    res.json({
        ok: true,
        mood,
        intensity: Math.max(0, Math.min(1, intensity)),
        source: 'demo_cycle',
        next_change_ms: cycleMs - (Date.now() % cycleMs)
    });
});

// ── GET /api/omega/health ───────────────────────────────────────────────────
// Returns R0 substrate health + open utterance count + recent decision counts.
router.get('/health', (req, res) => {
    const userId = _requireUser(req, res);
    if (!userId) return;
    try {
        const r0 = R0.getHealth();
        const since24h = Date.now() - 24 * 3600 * 1000;
        const utterancesLast24h = db.prepare(
            `SELECT COUNT(*) AS n FROM ml_voice_log WHERE user_id = ? AND created_at >= ?`
        ).get(userId, since24h).n;
        const decisionsLast24h = db.prepare(
            `SELECT COUNT(*) AS n FROM ml_decision_snapshots WHERE user_id = ? AND created_at >= ?`
        ).get(userId, since24h).n;
        res.json({
            ok: true,
            R0: r0,
            utterances_24h: utterancesLast24h,
            decisions_24h: decisionsLast24h,
            wave: 'WAVE 1 — read-only UI mode (ML not yet learning)'
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
});

// ── GET /api/omega/r5a-stats ────────────────────────────────────────
// Wave 2 R5A measurement triad summary: attribution aggregate stats +
// calibration_quality + drift_score (7-day ref window vs 24h current).
// Read-only; null-safe if no attribution data exists yet (Wave 1 state).
router.get('/r5a-stats', (req, res) => {
    const userId = _requireUser(req, res);
    if (!userId) return;
    try {
        const env = String(req.query.env || 'DEMO');
        const validEnv = ['DEMO', 'TESTNET', 'REAL'].includes(env) ? env : 'DEMO';
        const now = Date.now();
        const sevenDaysAgo = now - 7 * 86_400_000;
        const oneDayAgo = now - 86_400_000;

        const stats = attribution.getAttributionStats({
            userId, resolvedEnv: validEnv, sinceMs: 0
        });
        const calib = calibration.getCalibration({
            userId, resolvedEnv: validEnv, sinceMs: 0
        });
        const driftResult = drift.getDrift({
            userId, resolvedEnv: validEnv,
            referenceWindow: { fromMs: sevenDaysAgo, toMs: oneDayAgo },
            currentWindow: { fromMs: oneDayAgo, toMs: now }
        });

        res.json({
            ok: true,
            env: validEnv,
            attribution: stats,
            calibration: {
                sample_count: calib.sample_count,
                brier_score: calib.brier_score,
                ece: calib.ece,
                calibration_quality: calib.calibration_quality
            },
            drift: {
                sample_count: driftResult.sample_count,
                drift_score: driftResult.drift_score,
                drift_level: driftResult.drift_level,
                outcome_drift: driftResult.outcome_drift,
                score_drift: driftResult.score_drift
            },
            wave: 'WAVE 2 — R5A measurement triad operational (attribution + calibration + drift)'
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
});

// ── POST /api/omega/chat ────────────────────────────────────────────────────
// Stub chat responder. Real implementation in Wave 8 wires `_voice/chatResponder.js`
// which consumes ring state. For now: state-aware basic responses based on
// open positions count + AT state. Persists every exchange to ml_voice_log
// so the Voice feed shows the conversation too.
router.post('/chat', express.json(), async (req, res) => {
    const userId = _requireUser(req, res);
    if (!userId) return;
    const question = String(req.body && req.body.text || '').slice(0, 500).trim();
    if (!question) {
        return res.status(400).json({ ok: false, error: 'text required' });
    }

    // [Day 26] Smart local responder + Groq LLM fallback for unscripted Qs.
    let reply, mood = 'CALM', llmFallback = false, llmModel = null;
    try {
        const r = await chatResponder.respond({ userId, text: question });
        reply = r.reply;
        mood = r.mood;
        llmFallback = !!r.llmFallback;
        llmModel = r.llmModel || null;
    } catch (err) {
        reply = `brain hiccup: ${err.message}. try again or ask 'help'.`;
        mood = 'SAD';
    }

    try {
        voiceLogger.logUtterance({
            userId, utteranceType: 'CHAT_REPLY', mood, text: reply,
            templateId: llmFallback ? 'wave1_groq_llm' : 'wave1_smart_responder',
            contextJson: JSON.stringify({ question, llmFallback, llmModel })
        });
    } catch (_) { /* defensive — never fail chat on log error */ }

    res.json({ ok: true, reply, mood });
});

module.exports = router;
