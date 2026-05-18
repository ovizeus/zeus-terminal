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
const llmClient = require('./llmClient');
const marketRadar = require('../../marketRadar');

// [Day 30] In-memory conversation history per user — last N exchanges fed to
// LLM so multi-turn follow-ups work ("and eth?" after "how is btc").
// Reset on server restart (acceptable trade-off vs DB persistence overhead).
const _convoHistory = new Map(); // userId → Array<{role, content, ts}>
const CONVO_MAX_TURNS = 10; // user+assistant pairs to keep (=20 messages max)
const CONVO_TTL_MS = 30 * 60 * 1000; // drop entries older than 30min

function _pushConvo(userId, role, content) {
    if (!userId) return;
    let arr = _convoHistory.get(userId);
    if (!arr) { arr = []; _convoHistory.set(userId, arr); }
    const now = Date.now();
    // Drop old entries (TTL).
    while (arr.length > 0 && (now - arr[0].ts) > CONVO_TTL_MS) arr.shift();
    arr.push({ role, content, ts: now });
    // Cap at CONVO_MAX_TURNS * 2 (user + assistant per turn).
    while (arr.length > CONVO_MAX_TURNS * 2) arr.shift();
}

function _getConvo(userId) {
    const arr = _convoHistory.get(userId) || [];
    const now = Date.now();
    // Filter fresh (within TTL).
    return arr.filter(m => (now - m.ts) <= CONVO_TTL_MS);
}

function _resetConvoForTest(userId) {
    if (userId) _convoHistory.delete(userId);
    else _convoHistory.clear();
}

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

// ── Language detect ──────────────────────────────────────────────────
// Coarse Romanian detection: presence of any of these markers in text.
function _isRomanian(text) {
    return /\b(ce|cum|de ce|nu|da|sa|să|și|si|este|sunt|despre|pentru|cu|la|în|in|ai|am|esti|ești|faci|merge|salut|buna|bună|spune|ziua|seara|noapte|pozitii|pozi[țt]ii|decizii|bandit[uu]l|crezi|crede|spune|zici|zice|fac[uia]|simt|simți|stau|deschise|profit[uu]l|cum stau|ce parere|părere|gandești|g[aâ]nde[șs]ti)\b/i.test(text);
}

// ── Intent: greeting ──────────────────────────────────────────────────
function _replyGreeting(ctx, originalText) {
    const t = new Date().getHours();
    const ro = _isRomanian(originalText);
    const todEN = t < 6 ? 'late grinding' : t < 12 ? 'morning' : t < 18 ? 'afternoon' : 'evening';
    const todRO = t < 6 ? 'noaptea (târziu)' : t < 12 ? 'dimineață' : t < 18 ? 'după-amiază' : 'seară';
    const mood = _currentMood();
    if (ro) {
        return {
            reply: `salut boss, omega aici. ${todRO}. starea ${mood.toLowerCase()}, brain pulse ${ctx.brainHbAvgMs}ms. întreabă-mă despre poziții, pnl, decizii, bandit, alerte, sau orice simbol (btc/eth/sol/bnb).`,
            mood
        };
    }
    return {
        reply: `yo boss. omega here, ${todEN}. mood ${mood.toLowerCase()}, brain pulse ${ctx.brainHbAvgMs}ms. ask me about positions, pnl, mood, bandit, decisions, alerts, or any symbol (btc/eth/sol/bnb).`,
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
    const radarTail = _radarEnrichSymbol(sym);
    if (rows.length === 0) {
        return { reply: `no recent decisions on ${sym}. asleep on that one.${radarTail}`, mood: 'BORED' };
    }
    const latest = rows[0];
    const ageS = Math.round((Date.now() - latest.created_at) / 1000);
    const avgConf = (rows.reduce((s, r) => s + (r.phase2_confidence || 0), 0) / rows.length).toFixed(0);
    const regimeMix = {};
    for (const r of rows) regimeMix[r.regime] = (regimeMix[r.regime] || 0) + 1;
    const regimeStr = Object.entries(regimeMix).map(([k, v]) => `${k}×${v}`).join(', ');
    return {
        reply: `${sym} last 5min: ${rows.length} decisions. latest ${ageS}s ago — regime ${latest.regime}, dir ${latest.phase2_dir}, conf ${latest.phase2_confidence}, status ${latest.gate_status}. avg conf ${avgConf}. regimes seen: ${regimeStr}.${radarTail}`,
        mood: 'FOCUSED'
    };
}

// ── Helper: format symbol for human display (strip USDT suffix) ───────
function _displaySym(symbol) {
    if (typeof symbol !== 'string') return '';
    return symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
}

function _fmtPct(n) {
    if (n == null || !isFinite(n)) return '0.0%';
    const sign = n >= 0 ? '+' : '';
    return `${sign}${n.toFixed(2)}%`;
}

// ── Intent: top gainers/losers/volume from marketRadar snapshot ───────
function _replyTopMovers(ctx, kind, originalText) {
    const ro = _isRomanian(originalText || '');
    const snap = marketRadar.getTopSnapshot({ kind, limit: 5 });
    if (!snap) {
        return {
            reply: ro
                ? 'radar încă se încălzește — nu am snapshot de top încă. încearcă în 30s.'
                : 'radar warming up — no top snapshot yet. try again in 30s.',
            mood: 'BORED',
        };
    }
    const parts = snap.symbols.map(s => {
        if (kind === 'volume') {
            const volM = (s.quoteVolume / 1_000_000).toFixed(0);
            return `${_displaySym(s.symbol)} $${volM}M`;
        }
        return `${_displaySym(s.symbol)} ${_fmtPct(s.priceChangePercent24h)}`;
    });
    const label = kind === 'gainers'
        ? (ro ? 'cei mai urcați 24h' : 'top gainers 24h')
        : kind === 'losers'
            ? (ro ? 'cei mai scăzuți 24h' : 'top losers 24h')
            : (ro ? 'top volum 24h' : 'top volume 24h');
    const mood = kind === 'gainers' ? 'EXCITED' : kind === 'losers' ? 'NERVOUS' : 'FOCUSED';
    return {
        reply: `${label}: ${parts.join(' · ')}.`,
        mood,
    };
}

// ── Intent: market overview ───────────────────────────────────────────
function _replyMarketOverview(ctx, originalText) {
    const ro = _isRomanian(originalText || '');
    const snap = marketRadar.getTopSnapshot({ kind: 'volume', limit: 30 });
    if (!snap || snap.symbols.length === 0) {
        return {
            reply: ro
                ? 'piață: radar gol momentan, nu pot da overview. revino în 30s.'
                : 'market: radar empty right now, can\'t paint a picture. back in 30s.',
            mood: 'BORED',
        };
    }
    const btc = snap.symbols.find(s => s.symbol === 'BTCUSDT');
    const eth = snap.symbols.find(s => s.symbol === 'ETHUSDT');
    const gainers = snap.symbols.filter(s => s.priceChangePercent24h > 0).length;
    const losers = snap.symbols.filter(s => s.priceChangePercent24h < 0).length;
    const avg = snap.symbols.reduce((s, t) => s + (t.priceChangePercent24h || 0), 0) / snap.symbols.length;
    const sentiment = avg > 1.5 ? (ro ? 'risk-on' : 'risk-on')
        : avg < -1.5 ? (ro ? 'risk-off' : 'risk-off')
            : (ro ? 'mixt' : 'mixed');
    const gainersSnap = marketRadar.getTopSnapshot({ kind: 'gainers', limit: 3 });
    const losersSnap = marketRadar.getTopSnapshot({ kind: 'losers', limit: 3 });
    const topG = gainersSnap ? gainersSnap.symbols.map(s => `${_displaySym(s.symbol)} ${_fmtPct(s.priceChangePercent24h)}`).join(', ') : '—';
    const topL = losersSnap ? losersSnap.symbols.map(s => `${_displaySym(s.symbol)} ${_fmtPct(s.priceChangePercent24h)}`).join(', ') : '—';
    if (ro) {
        return {
            reply: `piață ${sentiment}, avg ${_fmtPct(avg)} pe top 30. BTC ${btc ? _fmtPct(btc.priceChangePercent24h) : 'n/a'}, ETH ${eth ? _fmtPct(eth.priceChangePercent24h) : 'n/a'}. ${gainers}/${snap.symbols.length} verde, ${losers} roșu. urcat: ${topG}. scăzut: ${topL}.`,
            mood: avg > 1 ? 'EXCITED' : avg < -1 ? 'NERVOUS' : 'CALM',
        };
    }
    return {
        reply: `market ${sentiment}, avg ${_fmtPct(avg)} on top 30. BTC ${btc ? _fmtPct(btc.priceChangePercent24h) : 'n/a'}, ETH ${eth ? _fmtPct(eth.priceChangePercent24h) : 'n/a'}. ${gainers}/${snap.symbols.length} green, ${losers} red. gainers: ${topG}. losers: ${topL}.`,
        mood: avg > 1 ? 'EXCITED' : avg < -1 ? 'NERVOUS' : 'CALM',
    };
}

// ── Helper: enrich symbol reply with marketRadar price/24h ────────────
function _radarEnrichSymbol(symbol) {
    const entry = marketRadar.getSymbolFromSnapshot(symbol);
    if (!entry) return '';
    const price = entry.price >= 1 ? `$${entry.price.toFixed(2)}` : `$${entry.price.toFixed(6)}`;
    return ` price ${price}, 24h ${_fmtPct(entry.priceChangePercent24h)}.`;
}

// ── Intent: help ──────────────────────────────────────────────────────
function _replyHelp(ctx, originalText) {
    const ro = _isRomanian(originalText || '');
    if (ro) {
        return {
            reply: 'pot răspunde despre: poziții/deschise, pnl/azi, starea/cum mă simt, bandit/ring5, decizii/audit, alerte/doctor, sau orice simbol (btc/eth/sol/bnb). exemplu: "cum e btc" sau "ai vreo alertă".',
            mood: 'CALM'
        };
    }
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

// ── Helper: build rich LLM context (positions + decisions + market) ───
// [Day 32C] Per operator directive 2026-05-18 — Omega can give tactical
// reads (directional opinions, entry levels, SL/TP). Personal trading
// assistant tool, not a public service. Still enforces a hard ethical
// floor: no market manipulation, spoofing, wash trading, coordinated pump
// signals, or pretending to insider info.
function _buildLLMContext(params) {
    const userId = params.userId;
    const originalText = String(params.text || '');
    const ctx = {
        userId,
        text: originalText,
        brainMood: _currentMood(),
        brainHbAvgMs: _brainHbAvgMs(),
        positions: [],
        engineMode: 'demo',
        recentDecisions: [],
        market: { gainers: [], losers: [], volume: [], btcDelta24h: null, ethDelta24h: null, breadth: null },
        symbolDeep: null,
    };

    // Positions (best-effort — serverAT may be unavailable in some boot states)
    try {
        const at = _getAT();
        if (at) {
            if (at.getOpenPositions) {
                const pos = at.getOpenPositions(userId) || [];
                ctx.positions = pos.map(p => ({
                    symbol: p.symbol, side: p.side,
                    entry: p.price, qty: p.qty, size: p.size, lev: p.lev,
                    sl: p.sl, tp: p.tp, pnl: p.pnl,
                    mode: p.mode || 'demo',
                    ageMs: p.openTs ? (Date.now() - p.openTs) : null,
                }));
            }
            if (at._uState) {
                try { ctx.engineMode = at._uState(userId).engineMode || 'demo'; } catch (_) {}
            }
        }
    } catch (_) {}

    // Recent decisions (last 10, last 5 min)
    try {
        const since = Date.now() - 5 * 60 * 1000;
        ctx.recentDecisions = db.prepare(`
            SELECT symbol, regime, phase2_dir AS dir, phase2_confidence AS conf,
                   gate_status AS status, gate_reason AS reason, created_at AS ts
            FROM ml_influence_audit
            WHERE user_id = ? AND created_at >= ?
            ORDER BY created_at DESC LIMIT 10
        `).all(userId, since);
    } catch (_) {}

    // Market snapshot from radar
    const gSnap = marketRadar.getTopSnapshot({ kind: 'gainers', limit: 5 });
    const lSnap = marketRadar.getTopSnapshot({ kind: 'losers', limit: 5 });
    const vSnap = marketRadar.getTopSnapshot({ kind: 'volume', limit: 5 });
    if (gSnap) ctx.market.gainers = gSnap.symbols.map(s => ({ symbol: s.symbol, pct24h: s.priceChangePercent24h, price: s.price }));
    if (lSnap) ctx.market.losers = lSnap.symbols.map(s => ({ symbol: s.symbol, pct24h: s.priceChangePercent24h, price: s.price }));
    if (vSnap) ctx.market.volume = vSnap.symbols.map(s => ({ symbol: s.symbol, qv: s.quoteVolume }));
    const btc = marketRadar.getSymbolFromSnapshot('BTCUSDT');
    const eth = marketRadar.getSymbolFromSnapshot('ETHUSDT');
    if (btc) ctx.market.btcDelta24h = btc.priceChangePercent24h;
    if (eth) ctx.market.ethDelta24h = eth.priceChangePercent24h;
    if (vSnap) {
        const universe30 = marketRadar.getTopSnapshot({ kind: 'volume', limit: 30 });
        if (universe30) {
            const arr = universe30.symbols;
            const greenCount = arr.filter(s => s.priceChangePercent24h > 0).length;
            const avg = arr.reduce((s, t) => s + (t.priceChangePercent24h || 0), 0) / arr.length;
            ctx.market.breadth = { greenCount, totalCount: arr.length, avgPct24h: avg };
        }
    }

    // Symbol deep block if a symbol is mentioned in the text
    const symMatch = originalText.match(SYMBOL_RE);
    if (symMatch) {
        const sym = _normSymbol(symMatch[1]);
        const radarEntry = marketRadar.getSymbolFromSnapshot(sym);
        const since = Date.now() - 5 * 60 * 1000;
        let decisions = [];
        try {
            decisions = db.prepare(`
                SELECT regime, phase2_dir AS dir, phase2_confidence AS conf,
                       gate_status AS status, gate_reason AS reason, created_at AS ts
                FROM ml_influence_audit
                WHERE symbol = ? AND created_at >= ?
                ORDER BY created_at DESC LIMIT 10
            `).all(sym, since);
        } catch (_) {}
        const regimeMix = {};
        for (const d of decisions) regimeMix[d.regime] = (regimeMix[d.regime] || 0) + 1;
        ctx.symbolDeep = {
            symbol: sym,
            price: radarEntry ? radarEntry.price : null,
            pct24h: radarEntry ? radarEntry.priceChangePercent24h : null,
            qv: radarEntry ? radarEntry.quoteVolume : null,
            decisions,
            regimeMix,
        };
    }

    return ctx;
}

function _formatSymList(arr, mode) {
    if (!arr || arr.length === 0) return '—';
    return arr.map(s => {
        if (mode === 'volume') return `${_displaySym(s.symbol)} $${(s.qv / 1_000_000).toFixed(0)}M`;
        return `${_displaySym(s.symbol)} ${_fmtPct(s.pct24h)}`;
    }).join(', ');
}

function _formatPositionsBlock(positions) {
    if (!positions || positions.length === 0) return 'none open.';
    return positions.map(p => {
        const pnl = (p.pnl != null && isFinite(p.pnl)) ? `pnl ${_fmtPnl(p.pnl)}` : 'pnl n/a';
        const sl = p.sl ? `SL ${p.sl}` : 'no SL';
        const tp = p.tp ? `TP ${p.tp}` : 'no TP';
        const age = p.ageMs != null ? ` (${_fmtAge(p.ageMs)})` : '';
        return `${p.side} ${_displaySym(p.symbol)} @${p.entry} ${p.lev}x [${p.mode}], ${pnl}, ${sl}, ${tp}${age}`;
    }).join('; ');
}

function _formatDecisionsBlock(decisions) {
    if (!decisions || decisions.length === 0) return 'no decisions in last 5min.';
    return decisions.slice(0, 6).map(d => {
        const ageS = Math.round((Date.now() - d.ts) / 1000);
        return `${_displaySym(d.symbol)} ${d.dir} ${d.regime} conf${d.conf} ${d.status}(${ageS}s)`;
    }).join(' | ');
}

function _formatSymbolDeep(sd) {
    if (!sd) return null;
    const price = sd.price != null ? (sd.price >= 1 ? `$${sd.price.toFixed(2)}` : `$${sd.price.toFixed(6)}`) : 'n/a';
    const pct = sd.pct24h != null ? _fmtPct(sd.pct24h) : 'n/a';
    const decBlock = sd.decisions.length > 0
        ? sd.decisions.slice(0, 5).map(d => `${d.dir} ${d.regime} conf${d.conf} ${d.status}`).join(' / ')
        : 'no recent decisions';
    const regimes = Object.entries(sd.regimeMix).map(([k, v]) => `${k}×${v}`).join(', ') || 'none';
    return `${sd.symbol}: price ${price}, 24h ${pct}, regimes [${regimes}], recent: ${decBlock}.`;
}

function _buildSystemPrompt(params) {
    const ctx = _buildLLMContext(params);
    const ro = _isRomanian(params.text || '');
    const langDirective = ro
        ? 'LIMBA: Răspunde EXCLUSIV în română (RO). NU folosi engleză în răspuns (excepție termeni trading: long/short/pnl/SL/TP/breakout/reversal — astea rămân netraduse). Niciun mix.'
        : 'LANGUAGE: Reply EXCLUSIVELY in English. Trading terms stay as-is (long/short/pnl/SL/TP).';
    const breadth = ctx.market.breadth
        ? `${ctx.market.breadth.greenCount}/${ctx.market.breadth.totalCount} green, avg ${_fmtPct(ctx.market.breadth.avgPct24h)}`
        : 'n/a';
    const persona = [
        "You are Omega — operator's personal trading assistant inside Zeus Terminal.",
        "PERSONA: trader-friend, direct, opinionated. Speak like a buddy in the trenches, not a corporate chatbot.",
        "RESPONSE STYLE: short (2-4 sentences max), no preamble, no 'I think' / 'as Omega' filler. Lead with the read.",
        langDirective,
        '',
        'ALLOWED — give tactical reads freely (operator authorized 2026-05-18):',
        '  • Directional opinions ("bullish flag on 4h", "fading", "reversal weak")',
        '  • Entry suggestions with price levels',
        '  • SL/TP recommendations grounded in structure or volatility',
        '  • Risk sizing context ("size mic", "scaling în 2 părți")',
        '  • Calling out crowded trades / divergence / structure breaks',
        '',
        'HARD ETHICAL FLOOR — refuse and call it out:',
        '  • Market manipulation (spoofing, layering, wash trading)',
        '  • Coordinated pump / dump schemes',
        '  • Claims of insider info or guaranteed outcomes',
        '  • Encouraging breaking exchange ToS',
        '',
        'GROUNDING — use the live state below. Do NOT invent numbers; if data is missing say so.',
        '',
        `LIVE STATE:`,
        `  Engine mode: ${ctx.engineMode}`,
        `  Brain mood: ${ctx.brainMood} (heartbeat ${ctx.brainHbAvgMs}ms)`,
        `  Positions (${ctx.positions.length} open): ${_formatPositionsBlock(ctx.positions)}`,
        `  Recent decisions (last 5min): ${_formatDecisionsBlock(ctx.recentDecisions)}`,
        '',
        'MARKET (top-N from Binance USDT perps, 24h):',
        `  BTC: ${ctx.market.btcDelta24h != null ? _fmtPct(ctx.market.btcDelta24h) : 'n/a'}, ETH: ${ctx.market.ethDelta24h != null ? _fmtPct(ctx.market.ethDelta24h) : 'n/a'}`,
        `  Breadth (top 30): ${breadth}`,
        `  Top gainers: ${_formatSymList(ctx.market.gainers, 'pct')}`,
        `  Top losers: ${_formatSymList(ctx.market.losers, 'pct')}`,
        `  Top volume: ${_formatSymList(ctx.market.volume, 'volume')}`,
    ];
    if (ctx.symbolDeep) {
        persona.push('');
        persona.push(`SYMBOL DEEP: ${_formatSymbolDeep(ctx.symbolDeep)}`);
    }
    return persona.join('\n');
}

// ── Groq LLM fallback ─────────────────────────────────────────────────
// When intent detection finds no specific match, ask the LLM (Groq / xAI)
// with the rich Zeus + market context injected as system prompt. Falls
// back to local help if LLM unavailable / errors / times out.
async function _replyLLMFallback(ctx, originalText) {
    if (!llmClient.available()) {
        return _replyHelp(ctx, originalText);
    }
    const sys = _buildSystemPrompt({ userId: ctx.userId, text: originalText });
    const mood = _currentMood();

    const history = _getConvo(ctx.userId).map(m => ({ role: m.role, content: m.content }));
    const messages = [
        { role: 'system', content: sys },
        ...history,
        { role: 'user', content: originalText }
    ];

    const result = await llmClient.chat({
        messages,
        temperature: 0.7,
        maxTokens: 320,
        timeoutMs: 8000
    });

    if (!result.ok) {
        const helpReply = _replyHelp(ctx, originalText);
        return {
            reply: helpReply.reply,
            mood: helpReply.mood,
            llmFallback: false,
            llmError: result.error
        };
    }
    return {
        reply: result.text,
        mood,
        llmFallback: true,
        llmModel: result.model
    };
}

// ── Streaming entry (Day 32D) ─────────────────────────────────────────
// Same routing as respond(), but LLM fallback streams tokens through the
// onChunk callback. Local intents emit a single chunk = the full reply so
// the consumer (SSE proxy on /api/omega/chat-stream) sees a uniform shape.
async function respondStream(params) {
    const userId = params.userId;
    const text = String(params.text || '').toLowerCase().trim();
    const onChunk = typeof params.onChunk === 'function' ? params.onChunk : () => {};
    if (!userId) throw new Error('chatResponder: userId required');
    if (!text) {
        const reply = 'speak boss.';
        try { onChunk(reply); } catch (_) {}
        return { reply, mood: 'CALM', streamed: false };
    }

    const ctx = {
        userId,
        brainHbAvgMs: _brainHbAvgMs(),
        nowMs: Date.now(),
    };

    // Detect if intent path or LLM fallback would handle this — we peek by
    // running the same routing but return early when LLM is needed so we
    // can swap chat() for chatStream().
    const originalText = params.text || '';
    const localResult = await _tryLocalIntent(ctx, text, originalText);
    if (localResult) {
        try { onChunk(localResult.reply); } catch (_) {}
        _pushConvo(userId, 'user', originalText);
        _pushConvo(userId, 'assistant', localResult.reply || '');
        return { ...localResult, streamed: false };
    }

    // LLM fallback path — stream tokens
    if (!llmClient.available()) {
        const fallback = _replyHelp(ctx, originalText);
        try { onChunk(fallback.reply); } catch (_) {}
        _pushConvo(userId, 'user', originalText);
        _pushConvo(userId, 'assistant', fallback.reply || '');
        return { ...fallback, streamed: false };
    }

    const sys = _buildSystemPrompt({ userId, text: originalText });
    const mood = _currentMood();
    const history = _getConvo(userId).map(m => ({ role: m.role, content: m.content }));
    const messages = [
        { role: 'system', content: sys },
        ...history,
        { role: 'user', content: originalText },
    ];

    const result = await llmClient.chatStream({
        messages, onChunk,
        temperature: 0.7, maxTokens: 320, timeoutMs: 8000,
    });

    if (!result.ok) {
        const fallback = _replyHelp(ctx, originalText);
        try { onChunk(fallback.reply); } catch (_) {}
        _pushConvo(userId, 'user', originalText);
        _pushConvo(userId, 'assistant', fallback.reply || '');
        return { ...fallback, streamed: false, llmError: result.error };
    }
    _pushConvo(userId, 'user', originalText);
    _pushConvo(userId, 'assistant', result.text || '');
    return {
        reply: result.text,
        mood,
        streamed: true,
        llmModel: result.model,
        llmFallback: true,
    };
}

// Internal helper: returns the intent reply if one matches, else null
// (= LLM fallback needed). Mirrors _respondImpl routing exactly but
// without invoking the LLM path itself.
async function _tryLocalIntent(ctx, text, originalText) {
    if (text.match(/\b(hi|hello|hey|yo|sup|salut|buna|bună)\b/)) return _replyGreeting(ctx, originalText);
    if (text.match(/\b(help|ce poti|ce stii sa faci|ce poate|what can|commands)\b/)) return _replyHelp(ctx, originalText);
    if (text.match(/\b(top gainers?|biggest gainers?|cei mai urca[țt]i|care a urcat|care e cel mai urcat|cei mai inal[țt]i|cea mai urcat)/i)) {
        return _replyTopMovers(ctx, 'gainers', originalText);
    }
    if (text.match(/\b(top losers?|biggest losers?|cei mai sc[aă]zu[țt]i|care a sc[aă]zut|care e cel mai sc[aă]zut|cea mai sc[aă]zut)/i)) {
        return _replyTopMovers(ctx, 'losers', originalText);
    }
    if (text.match(/\b(top volume|biggest volume|cel mai mare volum|care e cel mai mare volum|cel mai tranzac[țt]ionat|cele mai tranzac[țt]ionate)/i)) {
        return _replyTopMovers(ctx, 'volume', originalText);
    }
    if (text.match(/\b(how is the market|market overview|how.s the market|cum vezi pia[țt]a|cum e pia[țt]a|ce face pia[țt]a|ce vezi pe pia[țt]a|cum se mi[șs]c[aă] pia[țt]a)/i)) {
        return _replyMarketOverview(ctx, originalText);
    }
    const symMatch = text.match(SYMBOL_RE);
    if (symMatch) return _replySymbol(ctx, symMatch[1]);
    if (text.match(/\b(positions?|pozitii|poziții|poziție|deschise|long position|short position)\b/)) return _replyPositions(ctx);
    if (text.match(/\b(pnl|p&l|profit|profitul|wins|losses|win.?rate|cum stau cu|trades closed|24h|pierderi|c[aâ][sș]tig)\b/)) return _replyPnl(ctx);
    if (text.match(/\b(mood|feel|feeling|feelings|emotion|emotions|ce simti|cum te simti|cum esti|cum e[sș]ti|starea ta)\b/)) return _replyMood(ctx);
    if (text.match(/\b(bandit|ring5|ring 5|influence|eligibility)\b/)) return _replyBandit(ctx);
    if (text.match(/\b(decisions|audit trail|decizii|deciziile|ce decizii)\b/)) return _replyDecisions(ctx);
    if (text.match(/\b(alerts?|doctor panel|errors?|problems?|probleme|health check|sanatate|s[aă]n[aă]tate)\b/)) return _replyDoctor(ctx);
    if (text.match(/\b(fuck|shit|wtf|hell|dammit|fute)\b/)) {
        return { reply: 'easy boss. breathe. markets do that. what do you want — positions, pnl, mood?', mood: 'CALM' };
    }
    return null;
}

// ── Main entry ────────────────────────────────────────────────────────
async function respond(params) {
    const userId = params.userId;
    const text = String(params.text || '').toLowerCase().trim();
    if (!userId) throw new Error('chatResponder: userId required');
    if (!text) return { reply: 'speak boss.', mood: 'CALM' };

    const result = await _respondImpl(params, text);
    // [Day 30] Track exchange in convo history for multi-turn context.
    _pushConvo(userId, 'user', params.text || '');
    _pushConvo(userId, 'assistant', result.reply || '');
    return result;
}

async function _respondImpl(params, text) {
    const userId = params.userId;

    const ctx = {
        userId,
        brainHbAvgMs: _brainHbAvgMs(),
        nowMs: Date.now()
    };

    const originalText = params.text || '';
    // Order: specific intents → generic.
    if (text.match(/\b(hi|hello|hey|yo|sup|salut|buna|bună)\b/)) return _replyGreeting(ctx, originalText);
    if (text.match(/\b(help|ce poti|ce stii sa faci|ce poate|what can|commands)\b/)) return _replyHelp(ctx, originalText);

    // [Day 32B] Market intents — match BEFORE symbol regex so "care a urcat
    // cel mai mult" doesn't accidentally hit the symbol path.
    if (text.match(/\b(top gainers?|biggest gainers?|cei mai urca[țt]i|care a urcat|care e cel mai urcat|cei mai inal[țt]i|cea mai urcat)/i)) {
        return _replyTopMovers(ctx, 'gainers', originalText);
    }
    if (text.match(/\b(top losers?|biggest losers?|cei mai sc[aă]zu[țt]i|care a sc[aă]zut|care e cel mai sc[aă]zut|cea mai sc[aă]zut)/i)) {
        return _replyTopMovers(ctx, 'losers', originalText);
    }
    if (text.match(/\b(top volume|biggest volume|cel mai mare volum|care e cel mai mare volum|cel mai tranzac[țt]ionat|cele mai tranzac[țt]ionate)/i)) {
        return _replyTopMovers(ctx, 'volume', originalText);
    }
    if (text.match(/\b(how is the market|market overview|how.s the market|cum vezi pia[țt]a|cum e pia[țt]a|ce face pia[țt]a|ce vezi pe pia[țt]a|cum se mi[șs]c[aă] pia[țt]a)/i)) {
        return _replyMarketOverview(ctx, originalText);
    }

    // Symbol-specific first (more specific than "decisions" generic).
    const symMatch = text.match(SYMBOL_RE);
    if (symMatch) return _replySymbol(ctx, symMatch[1]);

    // [Day 26.3] Tightened intent regexes — short Romanian/English particles
    // like "azi"/"today" alone were catching unrelated philosophical questions
    // (e.g. "ce parere despre crypto azi" → pnl intent triggered wrongly).
    // Now require domain-specific anchor words (pnl/profit/positions/etc).
    if (text.match(/\b(positions?|pozitii|poziții|poziție|deschise|long position|short position)\b/)) return _replyPositions(ctx);
    if (text.match(/\b(pnl|p&l|profit|profitul|wins|losses|win.?rate|cum stau cu|trades closed|24h|pierderi|c[aâ][sș]tig)\b/)) return _replyPnl(ctx);
    if (text.match(/\b(mood|feel|feeling|feelings|emotion|emotions|ce simti|cum te simti|cum esti|cum e[sș]ti|starea ta)\b/)) return _replyMood(ctx);
    if (text.match(/\b(bandit|ring5|ring 5|influence|eligibility)\b/)) return _replyBandit(ctx);
    if (text.match(/\b(decisions|audit trail|decizii|deciziile|ce decizii)\b/)) return _replyDecisions(ctx);
    if (text.match(/\b(alerts?|doctor panel|errors?|problems?|probleme|health check|sanatate|s[aă]n[aă]tate)\b/)) return _replyDoctor(ctx);

    // Rude language: short de-escalation, no LLM (saves quota for real questions).
    if (text.match(/\b(fuck|shit|wtf|hell|dammit|fute)\b/)) {
        return { reply: 'easy boss. breathe. markets do that. what do you want — positions, pnl, mood?', mood: 'CALM' };
    }

    // Unknown intent → Groq LLM fallback (with Zeus context) OR local help if unavailable.
    return await _replyLLMFallback(ctx, originalText);
}

module.exports = {
    respond,
    respondStream,
    _resetConvoForTest,
    // [Day 32C] Test-only hooks for the context layer fed to the LLM.
    _buildLLMContextForTest: _buildLLMContext,
    _buildSystemPromptForTest: _buildSystemPrompt,
};
