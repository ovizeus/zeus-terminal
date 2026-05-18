'use strict';

/**
 * OMEGA chat responder — smart local intent-based answers using real Zeus state.
 *
 * NO LLM dependency — 100% deterministic, fast (<10ms), zero API cost.
 * Each intent handler queries live DB/services and produces a natural reply
 * with concrete numbers + context.
 *
 * Intent detection: regex against lowercased question, ordered specific→generic.
 * If no intent matches → 'help' fallback.
 */

const { db } = require('../../database');

// Lazy require to avoid circular deps via serverAT → database → this module.
let _serverAT = null;
function _getAT() {
    if (_serverAT === null) {
        try { _serverAT = require('../../serverAT'); } catch (_) { _serverAT = false; }
    }
    return _serverAT || null;
}

const SYMBOL_RE = /\b(btc|eth|sol|bnb|xrp|doge|ada|zec|btcusdt|ethusdt|solusdt|bnbusdt)\b/i;

function _normSymbol(s) {
    if (!s) return null;
    const u = s.toUpperCase();
    if (u.endsWith('USDT')) return u;
    return u + 'USDT';
}

function _fmtPnl(n) {
    if (n == null || !isFinite(n)) return '$0.00';
    const sign = n >= 0 ? '+' : '';
    return `${sign}$${n.toFixed(2)}`;
}

function _fmtAge(ms) {
    if (ms < 60000) return Math.round(ms / 1000) + 's';
    if (ms < 3600000) return Math.round(ms / 60000) + 'm';
    return (ms / 3600000).toFixed(1) + 'h';
}

// ── Intent: greeting ──────────────────────────────────────────────────
function _replyGreeting(ctx) {
    const t = new Date().getHours();
    const tod = t < 6 ? 'late' : t < 12 ? 'morning' : t < 18 ? 'afternoon' : 'evening';
    const mood = _currentMood();
    return {
        reply: `yo boss. omega here, ${tod} ${tod === 'late' ? '(grinding)' : ''}. mood ${mood.toLowerCase()}, brain pulse ${ctx.brainHbAvgMs}ms. ask me about positions, pnl, mood, bandit, decisions, alerts, or any symbol (btc/eth/sol/bnb).`,
        mood
    };
}

// ── Intent: positions ─────────────────────────────────────────────────
function _replyPositions(ctx) {
    const at = _getAT();
    if (!at || !at.getOpenPositions) {
        return { reply: 'serverAT not available — can\'t see positions right now.', mood: 'SAD' };
    }
    // List positions for the asking user (uid passed in ctx).
    const pos = (at.getOpenPositions(ctx.userId) || []);
    if (pos.length === 0) {
        return { reply: 'no positions open. market quiet for you. flat.', mood: 'BORED' };
    }
    const lines = pos.slice(0, 5).map(p => {
        const ageMs = Date.now() - (p.ts || Date.now());
        const slStr = p.sl ? `SL $${p.sl.toFixed(2)}` : 'no SL';
        return `  ${p.side} ${p.symbol} @ $${(p.price || 0).toFixed(2)} (${p.mode || '?'}, ${slStr}, ${_fmtAge(ageMs)} old)`;
    }).join('\n');
    const moreStr = pos.length > 5 ? `\n  +${pos.length - 5} more...` : '';
    return {
        reply: `${pos.length} position${pos.length > 1 ? 's' : ''} open:\n${lines}${moreStr}`,
        mood: pos.length > 0 ? 'FOCUSED' : 'CALM'
    };
}

// ── Intent: pnl / today ───────────────────────────────────────────────
function _replyPnl(ctx) {
    try {
        const rows = db.prepare(`
            SELECT data FROM at_closed
            WHERE closed_at >= datetime('now','-1 day')
            ORDER BY closed_at DESC
            LIMIT 50
        `).all();
        const userTrades = rows
            .map(r => { try { return JSON.parse(r.data); } catch (_) { return null; } })
            .filter(t => t && t.userId === ctx.userId);
        if (userTrades.length === 0) {
            return { reply: 'no closed trades today for you. patience boss.', mood: 'CALM' };
        }
        const wins = userTrades.filter(t => (t.closePnl || 0) > 0).length;
        const losses = userTrades.filter(t => (t.closePnl || 0) < 0).length;
        const totalPnl = userTrades.reduce((s, t) => s + (t.closePnl || 0), 0);
        const biggestWin = userTrades.reduce((m, t) => (t.closePnl || 0) > (m?.closePnl || -Infinity) ? t : m, null);
        const biggestLoss = userTrades.reduce((m, t) => (t.closePnl || 0) < (m?.closePnl || Infinity) ? t : m, null);
        const wr = userTrades.length > 0 ? (wins / userTrades.length * 100).toFixed(0) : '0';
        const bw = biggestWin ? ` best: ${biggestWin.side} ${biggestWin.symbol} ${_fmtPnl(biggestWin.closePnl)}.` : '';
        const bl = biggestLoss && (biggestLoss.closePnl || 0) < 0 ? ` worst: ${biggestLoss.side} ${biggestLoss.symbol} ${_fmtPnl(biggestLoss.closePnl)}.` : '';
        const moodOut = totalPnl > 0 ? 'EXCITED' : totalPnl < 0 ? 'SAD' : 'CALM';
        return {
            reply: `last 24h: ${userTrades.length} trades closed, ${wins}W/${losses}L (${wr}% win rate). net ${_fmtPnl(totalPnl)}.${bw}${bl}`,
            mood: moodOut
        };
    } catch (err) {
        return { reply: `couldn't query trades: ${err.message}`, mood: 'SAD' };
    }
}

// ── Intent: mood / feeling ────────────────────────────────────────────
function _replyMood(ctx) {
    const mood = _currentMood();
    const since5m = Date.now() - 5 * 60 * 1000;
    const dist = db.prepare(`
        SELECT gate_status, COUNT(*) AS n
        FROM ml_influence_audit
        WHERE created_at >= ?
        GROUP BY gate_status
    `).all(since5m);
    const total = dist.reduce((s, r) => s + r.n, 0);
    const accepted = dist.find(r => r.gate_status === 'accepted')?.n || 0;
    const rejected = dist.find(r => r.gate_status === 'rejected')?.n || 0;
    const skipped = dist.find(r => r.gate_status === 'skipped')?.n || 0;
    let reason;
    if (total === 0) reason = 'no audit rows last 5min — pipeline idle or just rebooted';
    else if (accepted > 0) reason = `${accepted} accepted of ${total} = proposer firing, vibing`;
    else if (rejected > 0) reason = `${rejected} rejected of ${total} = reflection blocking, second-guessing`;
    else reason = `${skipped} skipped of ${total} = bandit cold or no eligible cells`;
    return {
        reply: `feeling ${mood.toLowerCase()}. ${reason}. brain heartbeat avg ${ctx.brainHbAvgMs}ms.`,
        mood
    };
}

// ── Intent: bandit / ring5 / influence ────────────────────────────────
function _replyBandit(ctx) {
    let cellsCount = 0, topCell = null, hasInfluence = false;
    try {
        cellsCount = db.prepare('SELECT COUNT(*) AS n FROM ml_bandit_posteriors WHERE level=4').get().n;
        if (cellsCount > 0) {
            topCell = db.prepare(`
                SELECT cell_key, alpha, beta, observation_count
                FROM ml_bandit_posteriors WHERE level=4
                ORDER BY observation_count DESC LIMIT 1
            `).get();
        }
        const vrow = db.prepare(`
            SELECT id, state FROM ml_governance_versions
            WHERE component_id='ring5-bandit-influence-phase4' AND state='ACTIVE'
            LIMIT 1
        `).get();
        if (vrow) {
            const preReg = db.prepare(`
                SELECT state FROM ml_hypothesis_pre_registrations
                WHERE version_id = ? AND state IN ('REGISTERED','EVALUATING')
                LIMIT 1
            `).get(vrow.id);
            hasInfluence = !!preReg;
        }
    } catch (_) { /* */ }
    let line1 = `bandit: ${cellsCount} L4 cell${cellsCount === 1 ? '' : 's'} learned`;
    if (topCell) {
        const wr = topCell.observation_count > 0
            ? ((topCell.alpha - 1) / topCell.observation_count * 100).toFixed(0) : '?';
        line1 += `. top: ${topCell.cell_key} (${topCell.observation_count} obs, ${wr}% wr, α=${topCell.alpha}/β=${topCell.beta})`;
    } else {
        line1 += '. all cold — waiting for trade closes to fill';
    }
    const line2 = hasInfluence
        ? 'influence: ACTIVE. seed + preReg live. eligibility passes for cells ≥30 obs.'
        : 'influence: INACTIVE. seed via Ring5 panel button to activate.';
    return {
        reply: `${line1}\n${line2}`,
        mood: hasInfluence && cellsCount > 0 ? 'FOCUSED' : 'BORED'
    };
}

// ── Intent: decisions / audit ─────────────────────────────────────────
function _replyDecisions(ctx) {
    const since5m = Date.now() - 5 * 60 * 1000;
    const bySymbol = db.prepare(`
        SELECT symbol, regime, COUNT(*) AS n
        FROM ml_influence_audit
        WHERE created_at >= ?
        GROUP BY symbol, regime
        ORDER BY n DESC LIMIT 5
    `).all(since5m);
    if (bySymbol.length === 0) {
        return { reply: 'no decisions last 5min. brain idle.', mood: 'BORED' };
    }
    const lines = bySymbol.map(b => `  ${b.symbol} (${b.regime}): ${b.n}`).join('\n');
    const total = bySymbol.reduce((s, b) => s + b.n, 0);
    return {
        reply: `last 5min: ${total} decisions across ${bySymbol.length} symbol/regime pair${bySymbol.length > 1 ? 's' : ''}:\n${lines}`,
        mood: 'FOCUSED'
    };
}

// ── Intent: doctor / alerts / problems ────────────────────────────────
function _replyDoctor(ctx) {
    let cogState = '?', activeP0 = 0, activeP1 = 0;
    let recent = [];
    try {
        const analyzer = require('../_doctor/analyzer');
        const result = analyzer.analyze({ nowTs: Date.now() });
        cogState = result.state;
        activeP0 = result.activeP0;
        activeP1 = result.activeP1;
    } catch (_) { /* */ }
    try {
        recent = db.prepare(`
            SELECT severity, module_id, ts FROM ml_diagnostic_events
            WHERE ts >= (strftime('%s','now')-3600)*1000
            ORDER BY ts DESC LIMIT 3
        `).all();
    } catch (_) { /* */ }
    const moodOut = activeP0 > 0 ? 'NERVOUS' : activeP1 > 0 ? 'FOCUSED' : 'CALM';
    let line2;
    if (recent.length === 0) {
        line2 = 'last hour: no diagnostic events. quiet.';
    } else {
        line2 = `last hour top ${recent.length}: ` + recent.map(r => `${r.severity} ${r.module_id}`).join('; ');
    }
    return {
        reply: `cognitive state ${cogState}. active P0=${activeP0}, P1=${activeP1}. ${line2}`,
        mood: moodOut
    };
}

// ── Intent: symbol-specific ───────────────────────────────────────────
function _replySymbol(ctx, symbol) {
    const sym = _normSymbol(symbol);
    if (!sym) return _replyHelp(ctx);
    const since5m = Date.now() - 5 * 60 * 1000;
    const rows = db.prepare(`
        SELECT regime, phase2_dir, phase2_confidence, phase2_score, gate_status, created_at
        FROM ml_influence_audit
        WHERE symbol = ? AND created_at >= ?
        ORDER BY created_at DESC LIMIT 10
    `).all(sym, since5m);
    if (rows.length === 0) {
        return { reply: `no recent decisions on ${sym}. asleep on that one.`, mood: 'BORED' };
    }
    const latest = rows[0];
    const ageS = Math.round((Date.now() - latest.created_at) / 1000);
    const avgConf = (rows.reduce((s, r) => s + (r.phase2_confidence || 0), 0) / rows.length).toFixed(0);
    const regimeMix = {};
    for (const r of rows) regimeMix[r.regime] = (regimeMix[r.regime] || 0) + 1;
    const regimeStr = Object.entries(regimeMix).map(([k, v]) => `${k}×${v}`).join(', ');
    return {
        reply: `${sym} last 5min: ${rows.length} decisions. latest ${ageS}s ago — regime ${latest.regime}, dir ${latest.phase2_dir}, conf ${latest.phase2_confidence}, status ${latest.gate_status}. avg conf ${avgConf}. regimes seen: ${regimeStr}.`,
        mood: 'FOCUSED'
    };
}

// ── Intent: help ──────────────────────────────────────────────────────
function _replyHelp(ctx) {
    return {
        reply: 'i can answer about: positions/open, pnl/today, mood/feeling, bandit/ring5, decisions/audit, doctor/alerts, or any symbol (btc/eth/sol/bnb). example: "how is btc" or "any alerts".',
        mood: 'CALM'
    };
}

// ── Helper: current Ring5 mood ────────────────────────────────────────
function _currentMood() {
    try {
        const since5m = Date.now() - 5 * 60 * 1000;
        const dist = db.prepare(`
            SELECT gate_status, gate_reason, COUNT(*) AS n
            FROM ml_influence_audit
            WHERE created_at >= ?
            GROUP BY gate_status, gate_reason
        `).all(since5m);
        const total = dist.reduce((s, r) => s + r.n, 0);
        if (total === 0) return 'BORED';
        let accepted = 0, rejected = 0, skippedNoProp = 0;
        for (const r of dist) {
            if (r.gate_status === 'accepted') accepted += r.n;
            else if (r.gate_status === 'rejected') rejected += r.n;
            else if (r.gate_status === 'skipped' && r.gate_reason === 'no_proposal') skippedNoProp += r.n;
        }
        if (accepted / total > 0.1) return 'EXCITED';
        if (rejected / total > 0.1) return 'NERVOUS';
        if (skippedNoProp / total > 0.3) return 'FOCUSED';
        return 'CALM';
    } catch (_) {
        return 'CALM';
    }
}

// ── Helper: brain heartbeat avg ──────────────────────────────────────
function _brainHbAvgMs() {
    try {
        const row = db.prepare(`
            SELECT AVG(latency_ms) AS avg
            FROM ml_module_heartbeats
            WHERE module_id='serverBrain' AND ts >= (strftime('%s','now')-300)*1000
        `).get();
        return row && row.avg != null ? Math.round(row.avg) : 0;
    } catch (_) { return 0; }
}

// ── Main entry ────────────────────────────────────────────────────────
function respond(params) {
    const userId = params.userId;
    const text = String(params.text || '').toLowerCase().trim();
    if (!userId) throw new Error('chatResponder: userId required');
    if (!text) return { reply: 'speak boss.', mood: 'CALM' };

    const ctx = {
        userId,
        brainHbAvgMs: _brainHbAvgMs(),
        nowMs: Date.now()
    };

    // Order: specific intents → generic.
    if (text.match(/\b(hi|hello|hey|yo|sup|salut|buna|bună)\b/)) return _replyGreeting(ctx);
    if (text.match(/\b(help|ce poti|what can|commands)\b/)) return _replyHelp(ctx);

    // Symbol-specific first (more specific than "decisions" generic).
    const symMatch = text.match(SYMBOL_RE);
    if (symMatch) return _replySymbol(ctx, symMatch[1]);

    if (text.match(/\b(position|positions|open|long|short|pozitii|poziție|deschise)\b/)) return _replyPositions(ctx);
    if (text.match(/\b(pnl|p&l|profit|today|azi|cum stau|wins|losses|trades|24h)\b/)) return _replyPnl(ctx);
    if (text.match(/\b(mood|feel|feeling|ce simti|cum esti|emotion|stare)\b/)) return _replyMood(ctx);
    if (text.match(/\b(bandit|ring5|influence|learn|learning|eligibility)\b/)) return _replyBandit(ctx);
    if (text.match(/\b(decision|decisions|audit|brain|gandire|decizii)\b/)) return _replyDecisions(ctx);
    if (text.match(/\b(alert|alerts|doctor|problem|problems|error|errors|probleme|sanatate|health)\b/)) return _replyDoctor(ctx);

    // Fallback: rude or unknown → still helpful.
    if (text.match(/\b(fuck|shit|wtf|hell|dammit|fute)\b/)) {
        return { reply: 'easy boss. breathe. markets do that. what do you want — positions, pnl, mood?', mood: 'CALM' };
    }
    return _replyHelp(ctx);
}

module.exports = { respond };
