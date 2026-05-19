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
const logger = require('../services/logger');

const MOODS = ['CALM', 'FOCUSED', 'EXCITED', 'NERVOUS', 'ANGRY', 'SAD', 'BORED'];

function _requireUser(req, res) {
    if (!req.user || !req.user.id) {
        res.status(401).json({ ok: false, error: 'unauthorized' });
        return null;
    }
    return req.user.id;
}

// ── GET /api/omega/constitution/violations?limit=N ──────────────────────────
// [Wave 5] R1 Constitution audit — last N violations per authenticated user.
// Logged in advisory mode by serverBrain; future UI surfacing.
router.get('/constitution/violations', (req, res) => {
    const userId = _requireUser(req, res);
    if (!userId) return;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    try {
        const rows = db.prepare(
            `SELECT id, principle_id, principle_name, symbol, side, severity,
                    enforcement_mode, ts
             FROM ml_r1_violations
             WHERE user_id = ?
             ORDER BY ts DESC LIMIT ?`
        ).all(userId, limit);
        res.json({ ok: true, ts: Date.now(), violations: rows });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/omega/dd-status ────────────────────────────────────────────────
// [Wave 8 D] DD awareness — daily drawdown % + tier + color hint for
// OmegaPage header indicator. Green <3%, Yellow 3-7%, Red >7%.
router.get('/dd-status', (req, res) => {
    const userId = _requireUser(req, res);
    if (!userId) return;
    try {
        const ddGuard = require('../services/serverDrawdownGuard');
        const serverAT = require('../services/serverAT');
        const us = serverAT.getUserState ? serverAT.getUserState(userId) : null;
        const dailyPnL = us ? (us.dailyPnL || 0) : 0;
        const refBalance = us
            ? (us.engineMode === 'live' ? (us.liveBalanceRef || 0) : (us.demoBalance || 10000))
            : 10000;
        const assess = ddGuard.assessDrawdown(dailyPnL, refBalance);
        const drawdownPct = assess.drawdownPct || 0;
        let color = 'green';
        if (drawdownPct >= 7) color = 'red';
        else if (drawdownPct >= 3) color = 'yellow';
        res.json({
            ok: true,
            drawdownPct: +drawdownPct.toFixed(2),
            dailyPnL: +dailyPnL.toFixed(2),
            refBalance: +refBalance.toFixed(2),
            tier: assess.tier ? assess.tier.label : 'GREEN',
            locked: !!assess.locked,
            color,
            ts: Date.now(),
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/omega/audit/chain/recent?limit=N ───────────────────────────────
// [Wave 7b] Chained audit trail — last N entries (admin observability).
router.get('/audit/chain/recent', (req, res) => {
    try {
        const chain = require('../services/ml/_audit/chainedTrail');
        const limit = parseInt(req.query.limit, 10) || 50;
        res.json({ ok: true, ts: Date.now(), entries: chain.recent(limit) });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/omega/audit/chain/verify[?fromTs=&toTs=] ──────────────────────
// [Wave 7b] Walk chain + recompute hashes. Returns {ok, entries, firstBroken, reason}.
router.get('/audit/chain/verify', (req, res) => {
    try {
        const chain = require('../services/ml/_audit/chainedTrail');
        const opts = {};
        if (req.query.fromTs) opts.fromTs = parseInt(req.query.fromTs, 10);
        if (req.query.toTs) opts.toTs = parseInt(req.query.toTs, 10);
        const result = chain.verify(opts);
        res.json({ ok: true, ts: Date.now(), result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/omega/audit/chain/head ─────────────────────────────────────────
// [Wave 7b] Current head (latest entry_hash + id + kind + ts).
router.get('/audit/chain/head', (_req, res) => {
    try {
        const chain = require('../services/ml/_audit/chainedTrail');
        res.json({ ok: true, head: chain.head() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/omega/inter-ring/recent?limit=N ────────────────────────────────
// [Wave 7a] R7 Meta — last N inter-ring call traces (admin observability).
// Records every caller→callee invocation with input/output summaries +
// duration + ok flag. Default 50, cap 500.
router.get('/inter-ring/recent', (req, res) => {
    try {
        const tracer = require('../services/ml/R7_meta/interRingTracer');
        const limit = parseInt(req.query.limit, 10) || 50;
        res.json({ ok: true, ts: Date.now(), traces: tracer.recent(limit) });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/omega/ring5/bandit/posterior?limit=N ───────────────────────────
// [Wave 9 Worktrack B] Ring5 Thompson Sampling bandit posterior dashboard.
// Decision-support for operator T+48h "Seed influence" go/no-go: surfaces
// per-cell (level × env × symbol × regime) alpha/beta posterior, observation
// count vs eligibility threshold (30 obs), and computed posterior_mean.
// Read-only. Default 200 cells, capped at 500.
router.get('/ring5/bandit/posterior', (req, res) => {
    const ELIGIBILITY_THRESHOLD = 30;
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 200));
    try {
        const total = db.prepare('SELECT COUNT(*) AS n FROM ml_bandit_posteriors').get();
        const eligible = db.prepare(
            'SELECT COUNT(*) AS n FROM ml_bandit_posteriors WHERE observation_count >= ?'
        ).get(ELIGIBILITY_THRESHOLD);
        const rows = db.prepare(
            `SELECT level, cell_key, alpha, beta, observation_count, updated_at
             FROM ml_bandit_posteriors
             ORDER BY observation_count DESC, level ASC
             LIMIT ?`
        ).all(limit);
        const cells = rows.map(r => {
            const parts = (typeof r.cell_key === 'string') ? r.cell_key.split(':') : [];
            const env = parts.length >= 4 ? parts[1] : null;
            const symbol = parts.length >= 4 ? parts[2] : null;
            const regime = parts.length >= 4 ? parts[3] : null;
            const denom = (r.alpha || 0) + (r.beta || 0);
            return {
                level: r.level,
                cell_key: r.cell_key,
                env, symbol, regime,
                alpha: r.alpha, beta: r.beta,
                observation_count: r.observation_count,
                posterior_mean: denom > 0 ? r.alpha / denom : null,
                eligible: r.observation_count >= ELIGIBILITY_THRESHOLD,
                updated_at: r.updated_at,
            };
        });
        res.json({
            ok: true,
            ts: Date.now(),
            summary: {
                total_cells: total ? total.n : 0,
                eligible_cells: eligible ? eligible.n : 0,
                threshold_obs: ELIGIBILITY_THRESHOLD,
            },
            cells,
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/omega/constitution/principles ──────────────────────────────────
// [Wave 5] Returns the 7 locked principles (id, name, severity, description).
router.get('/constitution/principles', (_req, res) => {
    try {
        const principles = require('../services/ml/R1_constitution/principles');
        res.json({ ok: true, principles: principles.list() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/omega/voice?limit=N[&sinceTs=&untilTs=&include_chat=1] ─────────
// Returns most recent utterances for the authenticated user.
// [Wave 8 H] sinceTs/untilTs window enable time-travel replay in TheVoice UI.
router.get('/voice', (req, res) => {
    const userId = _requireUser(req, res);
    if (!userId) return;
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 50));
    const sinceTs = req.query.sinceTs ? parseInt(req.query.sinceTs, 10) : null;
    const untilTs = req.query.untilTs ? parseInt(req.query.untilTs, 10) : null;
    try {
        const includeChat = req.query.include_chat === '1';
        let rows;
        if (sinceTs != null || untilTs != null) {
            // Time-window query — direct SQL with bounds + chat-filter consistent
            const lo = sinceTs != null ? sinceTs : 0;
            const hi = untilTs != null ? untilTs : Date.now();
            const sql = includeChat
                ? `SELECT * FROM ml_voice_log WHERE user_id = ? AND created_at >= ? AND created_at <= ?
                   ORDER BY created_at DESC LIMIT ?`
                : `SELECT * FROM ml_voice_log WHERE user_id = ? AND utterance_type != 'CHAT_REPLY'
                   AND created_at >= ? AND created_at <= ?
                   ORDER BY created_at DESC LIMIT ?`;
            rows = db.prepare(sql).all(userId, lo, hi, limit);
        } else {
            rows = includeChat
                ? voiceLogger.getRecent({ userId, limit })
                : voiceLogger.getRecentThoughts({ userId, limit });
        }
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

// ── POST /api/omega/chat-stream ─────────────────────────────────────────────
// [Day 32D] SSE-style streaming chat. Frames:
//   data: {"type":"chunk","text":"hello"}\n\n
//   data: {"type":"done","mood":"FOCUSED","model":"groq","streamed":true}\n\n
// Local intents emit a single chunk + done. LLM fallback streams tokens.
router.post('/chat-stream', express.json(), async (req, res) => {
    const userId = _requireUser(req, res);
    if (!userId) return;
    const question = String(req.body && req.body.text || '').slice(0, 500).trim();
    if (!question) {
        return res.status(400).json({ ok: false, error: 'text required' });
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');  // disable nginx buffering if proxied
    res.flushHeaders && res.flushHeaders();

    const send = (obj) => {
        try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (_) { /* socket dead */ }
    };

    try {
        const result = await chatResponder.respondStream({
            userId, text: question,
            onChunk: (text) => send({ type: 'chunk', text }),
        });
        send({
            type: 'done',
            mood: result.mood,
            streamed: !!result.streamed,
            model: result.llmModel || null,
            llmFallback: !!result.llmFallback,
        });
        try {
            voiceLogger.logUtterance({
                userId, utteranceType: 'CHAT_REPLY',
                mood: result.mood, text: result.reply,
                templateId: result.streamed ? 'wave1_groq_stream' : (result.llmFallback ? 'wave1_groq_llm' : 'wave1_smart_responder'),
                contextJson: JSON.stringify({ question, llmFallback: !!result.llmFallback, llmModel: result.llmModel || null }),
            });
        } catch (_) { /* never fail stream on log error */ }
    } catch (err) {
        send({ type: 'error', error: err.message || String(err) });
    } finally {
        try { res.end(); } catch (_) {}
    }
});

// [Sub-A 2026-05-19] In-memory rate limit for DELETE /chat/history.
// 1 clear per user per 15 seconds. Reset on process restart (acceptable —
// next restart unblocks anyway). Stored as Map<userId, lastClearedAtMs>.
const _CLEAR_RATE_LIMIT_MS = 15 * 1000;
const _lastClearByUser = new Map();

function _canClearNow(userId) {
    const now = Date.now();
    const last = _lastClearByUser.get(userId);
    if (last == null) return { allowed: true, remainingSec: 0 };
    const elapsed = now - last;
    if (elapsed >= _CLEAR_RATE_LIMIT_MS) return { allowed: true, remainingSec: 0 };
    return { allowed: false, remainingSec: Math.ceil((_CLEAR_RATE_LIMIT_MS - elapsed) / 1000) };
}

function _markCleared(userId) {
    _lastClearByUser.set(userId, Date.now());
}

// Test helper — clears rate-limit Map (called from tests)
function _resetRateLimitForTest() {
    _lastClearByUser.clear();
}

// ── GET /api/omega/chat/history?limit=N ─────────────────────────────────────
// [Sub-A 2026-05-19] Per-user chat history for TalkWithMe mount load + brain
// rehydration. Reads ml_voice_log rows of type CHAT_REPLY, expands each into
// [you, omega] ChatRow pair. Edge cases for missing user question render
// placeholder '(?)' instead of skipping rows.
router.get('/chat/history', (req, res) => {
    const userId = _requireUser(req, res);
    if (!userId) return;
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
    const dbRows = Math.ceil(limit / 2);
    try {
        const rows = db.prepare(`
            SELECT id, mood, text, context_json, created_at
            FROM ml_voice_log
            WHERE user_id = ? AND utterance_type = 'CHAT_REPLY'
            ORDER BY created_at DESC
            LIMIT ?
        `).all(userId, dbRows);
        const totalRow = db.prepare(`
            SELECT COUNT(*) as c FROM ml_voice_log
            WHERE user_id = ? AND utterance_type = 'CHAT_REPLY'
        `).get(userId);
        const total = totalRow ? totalRow.c : 0;

        // Expand rows into ChatRow pairs (you, omega). Reverse to chronological.
        const history = [];
        for (const row of rows.reverse()) {
            let questionText = '(?)';
            if (row.context_json) {
                try {
                    const ctx = JSON.parse(row.context_json);
                    if (ctx && typeof ctx.question === 'string' && ctx.question.length > 0) {
                        questionText = ctx.question;
                    }
                } catch (parseErr) {
                    logger.warn('OMEGA', `[chat/history] malformed context_json on row id=${row.id} uid=${userId}: ${parseErr.message}`);
                }
            }
            history.push({ role: 'you', text: questionText, ts: row.created_at - 1 });
            history.push({ role: 'omega', text: row.text, mood: row.mood, ts: row.created_at });
        }
        res.json({ ok: true, history, total });
    } catch (err) {
        logger.error('OMEGA', `[chat/history] error uid=${userId}: ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── DELETE /api/omega/chat/history ──────────────────────────────────────────
// [Sub-A 2026-05-19] Per-user nuclear wipe of chat-type utterances.
// Preserves THOUGHT (brain narration) and CRITICAL_ALERT (operator alerts).
// Rate limit: 1 per user per 15s. Creates audit_log entry on every call.
// Invalidates chatResponder in-memory _convoHistory for this user.
router.delete('/chat/history', (req, res) => {
    const userId = _requireUser(req, res);
    if (!userId) return;
    const gate = _canClearNow(userId);
    if (!gate.allowed) {
        return res.status(429).json({
            ok: false,
            error: `Rate limit: wait ${gate.remainingSec}s before next clear`,
            remainingSec: gate.remainingSec,
        });
    }
    try {
        const result = db.prepare(`
            DELETE FROM ml_voice_log
            WHERE user_id = ? AND utterance_type IN ('CHAT_REPLY', 'GREETING', 'FAREWELL', 'REACTION')
        `).run(userId);
        const deletedCount = result.changes || 0;

        // Audit log entry (best-effort, never block response)
        try {
            db.prepare(`
                INSERT INTO audit_log (user_id, action, details, ip, created_at)
                VALUES (?, 'OMEGA_CHAT_HISTORY_CLEARED', ?, ?, ?)
            `).run(userId, JSON.stringify({ deletedCount, ip: req.ip }), req.ip || null, Date.now());
        } catch (auditErr) {
            logger.warn('OMEGA', `[chat/history] audit_log write failed uid=${userId}: ${auditErr.message}`);
        }

        // Invalidate chatResponder cache for this user (best-effort)
        try {
            const chatResponderModule = require('../services/ml/_voice/chatResponder');
            if (typeof chatResponderModule._invalidateConvoHistory === 'function') {
                chatResponderModule._invalidateConvoHistory(userId);
            }
        } catch (invErr) { /* swallow — telemetry never blocks */ }

        _markCleared(userId);
        res.json({ ok: true, deletedCount });
    } catch (err) {
        logger.error('OMEGA', `[chat/history DELETE] error uid=${userId}: ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// [Day 30.2] Server-side TTS proxy — Google Translate unofficial endpoint.
// Returns MP3 audio for the given text+lang. Works cross-platform (mobile +
// desktop) without browser SpeechSynthesis quirks. No API key needed.
// Limitations: 200-char max per request; unofficial endpoint may change.
router.get('/tts', async (req, res) => {
    const userId = _requireUser(req, res);
    if (!userId) return;
    const text = String(req.query.text || '').slice(0, 200).trim();
    const lang = String(req.query.lang || 'en').slice(0, 8);
    if (!text) {
        return res.status(400).json({ ok: false, error: 'text required' });
    }
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${encodeURIComponent(lang)}&client=tw-ob`;
        const upstream = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Zeus/1.0)' }
        });
        if (!upstream.ok) {
            return res.status(502).json({ ok: false, error: `upstream_${upstream.status}` });
        }
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.send(buf);
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err && err.message || err) });
    }
});

module.exports = router;
module.exports._resetRateLimitForTest = _resetRateLimitForTest;
