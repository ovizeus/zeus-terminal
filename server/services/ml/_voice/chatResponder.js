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

// [Wave 9.5] Fundamentals — CoinGecko-backed market context (rank/dominance/
// vol/24h). Lazy require + safe getter so chat never blocks on fundamentals.
function _safeFundamentals(symbol) {
    try {
        const fund = require('../../fundamentals');
        if (!fund || typeof fund.getFundamentalsCached !== 'function') return null;
        return fund.getFundamentalsCached(symbol);
    } catch (_) { return null; }
}

// Lazy-resolve serverState — avoids circular require at module load time and
// lets tests monkey-patch getSnapshotForSymbol post-require.
function _getServerState() {
    try { return require('../../serverState'); } catch (_) { return null; }
}

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

// [Sub-A 2026-05-19] Lazy DB rehydration for _convoHistory.
// Map<userId, Promise<void>> tracks load state — value is the in-flight or
// resolved Promise, used for dedup of concurrent calls. After resolution
// the Promise remains in the Map (signaling "already loaded for this user"),
// so subsequent calls return the cached Promise instantly without re-querying.
const _loadedForUser = new Map();

async function _loadConvoHistory(userId) {
    if (!userId) return;
    if (_loadedForUser.has(userId)) return _loadedForUser.get(userId);
    const p = (async () => {
        try {
            const rows = db.prepare(`
                SELECT text, context_json
                FROM ml_voice_log
                WHERE user_id = ? AND utterance_type = 'CHAT_REPLY'
                ORDER BY created_at DESC
                LIMIT ?
            `).all(userId, CONVO_MAX_TURNS);
            // Reverse for chronological order, push into convo
            const arr = _convoHistory.get(userId) || [];
            for (const row of rows.reverse()) {
                let question = null;
                if (row.context_json) {
                    try {
                        const ctx = JSON.parse(row.context_json);
                        if (ctx && typeof ctx.question === 'string' && ctx.question.length > 0) {
                            question = ctx.question;
                        }
                    } catch (_) { /* skip malformed row entirely */ }
                }
                if (question == null) continue; // skip rows without recoverable user question
                arr.push({ role: 'user', content: question });
                arr.push({ role: 'assistant', content: row.text });
            }
            _convoHistory.set(userId, arr);
        } catch (err) {
            // DB unavailable — log + set empty array so next attempt may retry
            if (typeof logger !== 'undefined' && logger && logger.warn) {
                logger.warn('CHAT_RESP', `_loadConvoHistory uid=${userId} failed: ${err.message}`);
            }
            _convoHistory.set(userId, _convoHistory.get(userId) || []);
        }
    })();
    _loadedForUser.set(userId, p);
    return p;
}

function _invalidateConvoHistory(userId) {
    if (!userId) return;
    _convoHistory.delete(userId);
    _loadedForUser.delete(userId);
}

function _resetLoadedForTest(userId) {
    if (userId) _loadedForUser.delete(userId);
}
function _getConvoForTest(userId) {
    return (_convoHistory.get(userId) || []).slice();
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
// Multi-lang detector: returns code (RO/ES/FR/DE/PT/EN). Order matters —
// stronger markers first. EN is default fallback.
function _detectLanguage(text) {
    const t = String(text || '').toLowerCase();

    // [Day 35 bugfix] Strong-distinguishing markers (ES/FR/DE/PT first) BEFORE
    // RO so loanword-heavy RO queries don't false-positive. RO diacritics ț/ș/ă
    // are RO-exclusive (Vietnamese ă rare in trading chat); use them as strong
    // catch-all. Plus an expanded RO marker list covering common diacritic-less
    // operator phrasings ("intram long", "fac un long", "vezi vreo...").

    // 1. PT — "você/hoje" are exclusive markers, check before ES (shared "mercado")
    if (/\b(voc[eê]|hoje|n[aã]o sei|olha o mercado|como vai)\b/i.test(t)) return 'PT';

    // 2. ES — inverted punctuation or unique markers
    if (/(¿|¡)/.test(t) || /\b(cómo|c[oó]mo ves|qu[eé] ves|hoy|el d[ií]a|cu[aá]l|por qu[eé]|me preguntas|mercado hoy)\b/i.test(t)) return 'ES';

    // 3. FR — distinguishing markers (apostrophe contractions, "comment tu")
    if (/\b(comment tu|qu['']est|qu['']?est-ce|comment vois|marché|aujourd['']?hui|vois-tu|est-ce que|s['']il vous|vous voyez|tu vois le|comment ça)\b/i.test(t)) return 'FR';

    // 4. DE — distinguishing markers
    if (/\b(wie siehst|wie geht|der markt|den markt|heute|wirklich|warum|kannst du|guten tag)\b/i.test(t)) return 'DE';

    // 5. RO — RO-exclusive diacritics ț/ș/ă are decisive (other Latin langs
    // don't use these specific T-comma/S-comma/breve characters in normal
    // text). If any present → RO.
    if (/[țșă]/i.test(t)) return 'RO';

    // 6. RO marker list expanded (no-diacritic operator queries). Covers:
    //   pronouns: ce, cum, de ce, cine, cui, cuia, ai, am, mi, ti, lui, ne, ne-am
    //   short verbs: fac, faci, face, vezi, vad, vede, mergi, merge,
    //                stau, stai, sta, vrei, vreau, vrem, vreo, scad, scade,
    //                intru, intri, intra, intram, cumpar, vand, urca, scade,
    //                stii, stiai, stiu (Day 35 ext)
    //   conjunctions: dar, sau, daca, atunci, ca, sa
    //   adverbs: azi, ieri, maine, acum, aici, aproape, putin, inainte
    //   nouns: pont, poarta, piata, intrebare, ras, raspuns, actualizare
    //   particles: e (= este), ii, oare, tea (= ti-a / te-a familiar)
    if (/\b(ce|cum|de ce|cine|cui|cuia|c[aâ]te?|c[aâ][țt]i|c[aâ]teva|sunt|este|sa|si|despre|pentru|in|ai|am|esti|faci|salut|buna|spune|spunemi|pozitii|decizii|parere|gandeste|gandesc|piata|vezi|vad|vede|vrei|vreau|vrem|vreo|fac|face|merge|mergi|mergem|stau|stai|sta|stii|stiai|stiu|scade|cumpar|cumperi|cumparam|vand|vinde|vindem|intru|intri|intra|intram|urca|pompeaza|crezi|crede|zice|zici|poti|poate|putem|trebui|spune.?mi|sa.?mi|sa.?ti|momentul|azi|maine|acum|aici|aproape|inainte|pont|poarta|intrebare|brain.?ul|aia|asta|astia|astea|ai.?ul|asa|altfel|altul|alta|altele|alti|oare|tea|actualizare|update|incercare)\b/i.test(t)) return 'RO';

    return 'EN';
}

// Backward-compat: many call sites still ask isRomanian boolean
function _isRomanian(text) {
    return _detectLanguage(text) === 'RO';
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

// ── Trader profile (Day 33 #2) ────────────────────────────────────────
function _getTraderProfile(userId) {
    try {
        const rows = db.prepare(
            `SELECT id, preference FROM trader_profile_preferences WHERE user_id = ? ORDER BY created_at`
        ).all(userId);
        return rows.map(r => ({ id: r.id, text: r.preference }));
    } catch (_) { return []; }
}

function _extractPreference(text) {
    // Match "remember that I X" / "remember I X" / "reține că X" / "reține X"
    const patterns = [
        /\bremember(?:\s+that)?\s+(?:i\s+)?(.+?)$/i,
        /\bre[țt]ine(?:\s+c[ăa])?\s+(.+?)$/i,
        /\bnoteaz[ăa](?:\s+c[ăa])?\s+(.+?)$/i,
    ];
    for (const re of patterns) {
        const m = text.match(re);
        if (m && m[1]) return m[1].trim();
    }
    return null;
}

function _replyRememberPref(ctx, originalText) {
    const ro = _isRomanian(originalText);
    const pref = _extractPreference(originalText);
    if (!pref || pref.length < 3) {
        return {
            reply: ro ? 'spune-mi ce să rețin (ex: "reține că prefer SL strâns 1-2%")'
                       : 'tell me what to remember (e.g. "remember I prefer tight SL 1-2%")',
            mood: 'BORED',
        };
    }
    try {
        db.prepare(`INSERT INTO trader_profile_preferences (user_id, preference) VALUES (?, ?)`).run(ctx.userId, pref);
    } catch (err) {
        return {
            reply: ro ? `eroare la salvare: ${err.message}` : `save error: ${err.message}`,
            mood: 'SAD',
        };
    }
    return {
        reply: ro ? `reținut: "${pref}". îl voi folosi în următoarele reads.`
                   : `got it, noted: "${pref}". i'll use it on next reads.`,
        mood: 'FOCUSED',
    };
}

function _replyShowProfile(ctx, originalText) {
    const ro = _isRomanian(originalText);
    const prefs = _getTraderProfile(ctx.userId);
    if (prefs.length === 0) {
        return {
            reply: ro ? 'nu am salvat nimic despre tine încă. spune-mi cum tradeuiești cu "reține că ..."'
                       : 'nothing saved about you yet. tell me with "remember that ..."',
            mood: 'BORED',
        };
    }
    const list = prefs.map(p => `• ${p.text}`).join('\n');
    return {
        reply: ro ? `iată ce știu despre tine:\n${list}` : `here's what i remember about you:\n${list}`,
        mood: 'FOCUSED',
    };
}

function _replyForgetPref(ctx, originalText) {
    const ro = _isRomanian(originalText);
    // Match "forget that I X" / "forget X" / "uită că X" / "uită X"
    const patterns = [
        /\bforget(?:\s+that)?\s+(?:i\s+)?(.+?)$/i,
        /\bui[țt][ăa](?:\s+c[ăa])?\s+(.+?)$/i,
    ];
    let target = null;
    for (const re of patterns) {
        const m = originalText.match(re);
        if (m && m[1]) { target = m[1].trim().toLowerCase(); break; }
    }
    if (!target) {
        return {
            reply: ro ? 'spune-mi ce să uit (ex: "uită că prefer SL strâns")'
                       : 'tell me what to forget (e.g. "forget that I prefer tight SL")',
            mood: 'BORED',
        };
    }
    const prefs = _getTraderProfile(ctx.userId);
    const match = prefs.find(p => p.text.toLowerCase().includes(target) || target.includes(p.text.toLowerCase()));
    if (!match) {
        return {
            reply: ro ? `nu am găsit o preferință care să se potrivească cu "${target}".`
                       : `no preference matched "${target}".`,
            mood: 'BORED',
        };
    }
    db.prepare(`DELETE FROM trader_profile_preferences WHERE id = ?`).run(match.id);
    return {
        reply: ro ? `uitat: "${match.text}".` : `forgotten: "${match.text}".`,
        mood: 'CALM',
    };
}

// ── Helper: lazy-resolve serverLiquidity ─────────────────────────────
function _getServerLiquidity() {
    try { return require('../../serverLiquidity'); } catch (_) { return null; }
}

function _getOrderBook(symbol) {
    const sl = _getServerLiquidity();
    if (!sl || typeof sl.getOrderBook !== 'function') return null;
    const ob = sl.getOrderBook(symbol);
    if (!ob || !ob.bids.length || !ob.asks.length) return null;
    const topBid = ob.bids[0].price;
    const topAsk = ob.asks[0].price;
    const spread = topAsk - topBid;
    const spreadPct = topBid > 0 ? (spread / topBid) * 100 : 0;
    const bidsTotal = ob.bids.reduce((s, b) => s + b.qty, 0);
    const asksTotal = ob.asks.reduce((s, a) => s + a.qty, 0);
    return {
        topBid, topAsk, spread, spreadPct,
        bidsTotal, asksTotal,
        bids: ob.bids.slice(0, 5),
        asks: ob.asks.slice(0, 5),
        ageMs: ob.ageMs,
    };
}

function _getWalls(symbol) {
    const sl = _getServerLiquidity();
    if (!sl || typeof sl.getWalls !== 'function') return [];
    return sl.getWalls(symbol);
}

// ── Intent: order book / depth ────────────────────────────────────────
function _replyOrderBook(ctx, symbolHint, originalText) {
    const ro = _isRomanian(originalText || '');
    const sym = _normSymbol(symbolHint);
    const ob = _getOrderBook(sym);
    if (!ob) {
        return {
            reply: ro
                ? `nu am depth pe ${sym} momentan. radarul polluiește 60s — încearcă în puțin sau verifică dacă ${sym} e în watchlist.`
                : `no depth on ${sym} right now. radar polls 60s — try shortly or check ${sym} is in the watchlist.`,
            mood: 'BORED',
        };
    }
    const ageS = (ob.ageMs / 1000).toFixed(0);
    const fmtP = (p) => p >= 1 ? p.toFixed(2) : p.toFixed(6);
    if (ro) {
        return {
            reply: `${sym} order book (age ${ageS}s): top bid $${fmtP(ob.topBid)} / top ask $${fmtP(ob.topAsk)}, spread ${ob.spreadPct.toFixed(3)}%. cumpărări totale 5 niveluri: ${ob.bidsTotal.toFixed(1)}, vânzări: ${ob.asksTotal.toFixed(1)}.`,
            mood: 'FOCUSED',
        };
    }
    return {
        reply: `${sym} order book (age ${ageS}s): top bid $${fmtP(ob.topBid)} / top ask $${fmtP(ob.topAsk)}, spread ${ob.spreadPct.toFixed(3)}%. bids total top 5: ${ob.bidsTotal.toFixed(1)}, asks total: ${ob.asksTotal.toFixed(1)}.`,
        mood: 'FOCUSED',
    };
}

// ── Intent: liquidity walls ──────────────────────────────────────────
function _replyLiquidityWalls(ctx, symbolHint, originalText) {
    const ro = _isRomanian(originalText || '');
    const sym = _normSymbol(symbolHint);
    const walls = _getWalls(sym);
    if (!walls || walls.length === 0) {
        return {
            reply: ro
                ? `niciun wall pe ${sym} (>3× qty mediu). carte echilibrată momentan.`
                : `no walls on ${sym} (>3× avg qty). book is balanced right now.`,
            mood: 'CALM',
        };
    }
    const fmtP = (p) => p >= 1 ? p.toFixed(2) : p.toFixed(6);
    const list = walls.slice(0, 5).map(w => `${w.side === 'bid' ? 'BID' : 'ASK'} $${fmtP(w.price)} (qty ${w.qty.toFixed(1)}, ${w.strength.toFixed(1)}×)`).join(', ');
    return {
        reply: ro
            ? `${sym} liquidity walls: ${list}.`
            : `${sym} liquidity walls: ${list}.`,
        mood: 'FOCUSED',
    };
}

// ── Helper: pull live structure from serverStructure ─────────────────
function _getStructure(symbol) {
    try {
        const ss = require('../../serverStructure');
        const stateMod = _getServerState();
        const bars = stateMod && stateMod.getBarsForSymbol ? stateMod.getBarsForSymbol(symbol) : [];
        if (!ss || typeof ss.getStructure !== 'function') return null;
        const r = ss.getStructure(symbol, bars || []);
        if (!r || r.trend === 'none') return null;
        return r;
    } catch (_) { return null; }
}

// ── Intent #1: structure ──────────────────────────────────────────────
function _replyStructure(ctx, symbolHint, originalText) {
    const ro = _isRomanian(originalText || '');
    const sym = _normSymbol(symbolHint);
    const s = _getStructure(sym);
    if (!s) {
        return {
            reply: ro
                ? `nu am structură clară pe ${sym} (insufficient swing pivots).`
                : `no clear structure on ${sym} (insufficient swing pivots).`,
            mood: 'BORED',
        };
    }
    const trendStr = s.trend;
    const score = (s.structureScore * 100).toFixed(0);
    const bos = s.lastBOS ? ` BOS @ ${s.lastBOS.price}` : '';
    const choch = s.lastCHoCH ? ` CHoCH @ ${s.lastCHoCH.price}` : '';
    if (ro) {
        return {
            reply: `${sym} structură: ${trendStr} (score ${score}/100).${bos}${choch}`,
            mood: trendStr.includes('up') ? 'EXCITED' : trendStr.includes('down') ? 'NERVOUS' : 'CALM',
        };
    }
    return {
        reply: `${sym} structure: ${trendStr} (score ${score}/100).${bos}${choch}`,
        mood: trendStr.includes('up') ? 'EXCITED' : trendStr.includes('down') ? 'NERVOUS' : 'CALM',
    };
}

// ── Intent: fundamentals (CoinGecko market context) ─────────────────
// [Wave 9.5] Closes the loop on Wave 9 data wire. User asks "BTC market cap"
// / "cum e fundamental ETH" / "ETH dominance" → reads cached CoinGecko data
// and replies with rank + dominance + 24h vol + 24h change. Multilang
// RO/EN/ES/FR/DE/PT.
function _replyFundamentals(ctx, symbolHint, originalText) {
    const lang = _detectLanguage(originalText || '');
    const sym = _normSymbol(symbolHint);
    const fund = _safeFundamentals(sym);
    if (!fund) {
        const base = String(sym || '').replace(/USDT$/i, '');
        const msg = {
            RO: `nu am date fundamentale pentru ${base} (cache rece sau simbol necotat în top 200 CoinGecko).`,
            ES: `sin datos fundamentales para ${base} (caché frío o símbolo fuera del top 200).`,
            FR: `pas de données fondamentales pour ${base} (cache froid ou hors top 200).`,
            DE: `keine Fundamentaldaten für ${base} (Cache leer oder außerhalb Top 200).`,
            PT: `sem dados fundamentais para ${base} (cache frio ou fora do top 200).`,
            EN: `no fundamentals data for ${base} (cold cache or symbol outside CoinGecko top 200).`,
        };
        return { reply: msg[lang] || msg.EN, mood: 'BORED' };
    }
    const base = String(sym || '').replace(/USDT$/i, '');
    const rank = fund.market_cap_rank;
    const dom = fund.dominance_pct != null ? fund.dominance_pct.toFixed(2) : null;
    const volB = fund.vol_24h_usd != null ? (fund.vol_24h_usd / 1e9).toFixed(2) : null;
    const chg = fund.price_change_24h_pct != null ? fund.price_change_24h_pct.toFixed(2) : null;
    const chgSign = chg != null && Number(chg) >= 0 ? '+' : '';
    const ageMin = fund.cache_age_ms != null ? Math.round(fund.cache_age_ms / 60000) : null;
    const stale = ageMin != null && ageMin > 10 ? ` (date ${ageMin}min vechi)` : '';
    const staleEN = ageMin != null && ageMin > 10 ? ` (data ${ageMin}min old)` : '';

    let reply;
    if (lang === 'RO') {
        const domStr = dom ? ` cu dominanță ${dom}%` : '';
        const volStr = volB ? ` și volum 24h $${volB}B` : '';
        const chgStr = chg != null ? ` (24h ${chgSign}${chg}%)` : '';
        reply = `${base} e #${rank} mondial${domStr}${volStr}${chgStr}${stale}.`;
    } else if (lang === 'ES') {
        reply = `${base} está #${rank} global${dom ? `, dominancia ${dom}%` : ''}${volB ? `, volumen 24h $${volB}B` : ''}${chg != null ? ` (${chgSign}${chg}% 24h)` : ''}${staleEN}.`;
    } else if (lang === 'FR') {
        reply = `${base} est #${rank} mondial${dom ? `, dominance ${dom}%` : ''}${volB ? `, volume 24h $${volB}B` : ''}${chg != null ? ` (${chgSign}${chg}% 24h)` : ''}${staleEN}.`;
    } else if (lang === 'DE') {
        reply = `${base} ist #${rank} weltweit${dom ? `, Dominanz ${dom}%` : ''}${volB ? `, Volumen 24h $${volB}B` : ''}${chg != null ? ` (${chgSign}${chg}% 24h)` : ''}${staleEN}.`;
    } else if (lang === 'PT') {
        reply = `${base} é #${rank} global${dom ? `, dominância ${dom}%` : ''}${volB ? `, volume 24h $${volB}B` : ''}${chg != null ? ` (${chgSign}${chg}% 24h)` : ''}${staleEN}.`;
    } else {
        reply = `${base} is #${rank} globally${dom ? `, dominance ${dom}%` : ''}${volB ? `, 24h volume $${volB}B` : ''}${chg != null ? ` (${chgSign}${chg}% 24h)` : ''}${staleEN}.`;
    }
    const mood = chg != null && Number(chg) > 2 ? 'EXCITED'
        : (chg != null && Number(chg) < -2 ? 'NERVOUS' : 'FOCUSED');
    return { reply, mood };
}

// ── Intent #2: AI predictivity (Ring5 cell surface) ──────────────────
function _replyPredictivity(ctx, symbolHint, originalText) {
    const ro = _isRomanian(originalText || '');
    const sym = _normSymbol(symbolHint);
    let rows = [];
    try {
        rows = db.prepare(
            `SELECT cell_key, alpha, beta, observation_count
             FROM ml_bandit_posteriors
             WHERE level = 4 AND cell_key LIKE ?
             ORDER BY observation_count DESC LIMIT 5`
        ).all(`${ctx.userId}|%|${sym}|%`);
    } catch (_) {}
    if (rows.length === 0 || rows.every(r => r.observation_count < 10)) {
        return {
            reply: ro
                ? `${sym}: bandit cold start, no edge yet. încă învață — adună observații.`
                : `${sym}: bandit cold start, no edge yet. still learning — needs more observations.`,
            mood: 'BORED',
        };
    }
    const cells = rows.filter(r => r.observation_count >= 10).map(r => {
        const wr = ((r.alpha - 1) / r.observation_count * 100).toFixed(0);
        const parts = r.cell_key.split('|');
        const regime = parts[3] || '?';
        return `${regime} ${wr}% (obs ${r.observation_count})`;
    });
    return {
        reply: ro
            ? `${sym} Ring5 bias: ${cells.join(', ')}. cell mai cu edge câștigă bias-ul.`
            : `${sym} Ring5 bias: ${cells.join(', ')}. cell with best edge wins bias.`,
        mood: 'FOCUSED',
    };
}

// ── Intent #5: market sentiment synthesis ─────────────────────────────
function _replySentiment(ctx, originalText) {
    const ro = _isRomanian(originalText || '');
    const snap = marketRadar.getTopSnapshot({ kind: 'volume', limit: 30 });
    if (!snap || snap.symbols.length === 0) {
        return {
            reply: ro ? 'sentiment: radar gol, nu pot evalua.' : 'sentiment: radar empty, can\'t read.',
            mood: 'BORED',
        };
    }
    const green = snap.symbols.filter(s => s.priceChangePercent24h > 0).length;
    const red = snap.symbols.filter(s => s.priceChangePercent24h < 0).length;
    const avg = snap.symbols.reduce((a, s) => a + (s.priceChangePercent24h || 0), 0) / snap.symbols.length;
    const breadth = green / snap.symbols.length;
    let label;
    if (avg > 2 && breadth > 0.65) label = ro ? 'risk-on puternic' : 'strong risk-on';
    else if (avg > 0.5 && breadth > 0.55) label = ro ? 'risk-on ușor' : 'mild risk-on';
    else if (avg < -2 && breadth < 0.35) label = ro ? 'risk-off puternic' : 'strong risk-off';
    else if (avg < -0.5 && breadth < 0.45) label = ro ? 'risk-off ușor' : 'mild risk-off';
    else label = ro ? 'mixt / neutru' : 'mixed / neutral';
    const btc = marketRadar.getSymbolFromSnapshot('BTCUSDT');
    const eth = marketRadar.getSymbolFromSnapshot('ETHUSDT');
    if (ro) {
        return {
            reply: `sentiment: ${label}. breadth ${green}/${snap.symbols.length} verde, avg ${_fmtPct(avg)}. BTC ${btc ? _fmtPct(btc.priceChangePercent24h) : 'n/a'}, ETH ${eth ? _fmtPct(eth.priceChangePercent24h) : 'n/a'}.`,
            mood: avg > 1 ? 'EXCITED' : avg < -1 ? 'NERVOUS' : 'CALM',
        };
    }
    return {
        reply: `sentiment: ${label}. breadth ${green}/${snap.symbols.length} green, avg ${_fmtPct(avg)}. BTC ${btc ? _fmtPct(btc.priceChangePercent24h) : 'n/a'}, ETH ${eth ? _fmtPct(eth.priceChangePercent24h) : 'n/a'}.`,
        mood: avg > 1 ? 'EXCITED' : avg < -1 ? 'NERVOUS' : 'CALM',
    };
}

// ── Intent #6: pump / manipulation detection ─────────────────────────
function _replyManipulationCheck(ctx, originalText) {
    const ro = _isRomanian(originalText || '');
    const snap = marketRadar.getTopSnapshot({ kind: 'gainers', limit: 10 });
    if (!snap) {
        return {
            reply: ro ? 'radar gol, nu pot verifica.' : 'radar empty, can\'t check.',
            mood: 'BORED',
        };
    }
    const outliers = snap.symbols.filter(s => Math.abs(s.priceChangePercent24h) > 20);
    if (outliers.length === 0) {
        return {
            reply: ro
                ? 'curat în top 300 — niciun pump outlier (>20% 24h).'
                : 'clean in top 300 — no pump outliers (>20% 24h).',
            mood: 'CALM',
        };
    }
    const list = outliers.map(s => `${_displaySym(s.symbol)} ${_fmtPct(s.priceChangePercent24h)}`).join(', ');
    return {
        reply: ro
            ? `posibili outlieri (>20% 24h): ${list}. spoofing/wash necesită order book real-time (deferred).`
            : `potential outliers (>20% 24h): ${list}. spoofing/wash detection needs real-time order book (deferred).`,
        mood: 'NERVOUS',
    };
}

// ── Intent #9: long-term forecast (regime-based, hedged) ─────────────
function _replyLongTermForecast(ctx, symbolHint, originalText) {
    const ro = _isRomanian(originalText || '');
    const sym = _normSymbol(symbolHint);
    const ind = _getIndicators(sym);
    const struct = _getStructure(sym);
    const radarEntry = marketRadar.getSymbolFromSnapshot(sym);

    const parts = [];
    if (struct) parts.push(`structure ${struct.trend}`);
    if (ind && ind.mtf) {
        const tfs = Object.entries(ind.mtf).map(([tf, m]) => `${tf} ${m.stDir || '?'}`).join(', ');
        if (tfs) parts.push(`MTF ${tfs}`);
    }
    if (radarEntry) parts.push(`24h ${_fmtPct(radarEntry.priceChangePercent24h)}`);
    const btc = marketRadar.getSymbolFromSnapshot('BTCUSDT');
    if (btc && sym !== 'BTCUSDT') parts.push(`BTC ref ${_fmtPct(btc.priceChangePercent24h)}`);

    const summary = parts.length > 0 ? parts.join(' | ') : (ro ? 'date insuficiente' : 'insufficient data');
    if (ro) {
        return {
            reply: `${sym} prognoză termen lung: ${summary}. bias contextual, nu pot da număr exact — piața nu e deterministă.`,
            mood: 'FOCUSED',
        };
    }
    return {
        reply: `${sym} long-term read: ${summary}. contextual bias only, no exact targets — market isn't deterministic.`,
        mood: 'FOCUSED',
    };
}

// ── Helper: pull live indicators snapshot from serverState ───────────
function _getIndicators(symbol) {
    const ss = _getServerState();
    if (!ss || typeof ss.getSnapshotForSymbol !== 'function') return null;
    const snap = ss.getSnapshotForSymbol(symbol);
    if (!snap) return null;
    return {
        price: snap.price,
        rsi: snap.rsi || {},
        adx: snap.adx,
        atr: snap.atr,
        fr: snap.fr,
        oi: snap.oi,
        macdDir: snap.indicators && snap.indicators.macdDir,
        macdHist: snap.indicators && snap.indicators.macdHist,
        stDir: snap.indicators && snap.indicators.stDir,
        mtf: snap.mtfIndicators || {},
        stale: !!snap.stale,
    };
}

// ── Intent: indicators (Day 33 #3) ────────────────────────────────────
function _replyIndicators(ctx, symbolHint, originalText) {
    const ro = _isRomanian(originalText || '');
    const sym = _normSymbol(symbolHint);
    const ind = _getIndicators(sym);
    if (!ind) {
        return {
            reply: ro
                ? `nu am date live pe ${sym}. ori radarul nu îl urmărește, ori feed-ul nu s-a încălzit.`
                : `no live data on ${sym}. radar may not track it, or feed isn't warm yet.`,
            mood: 'BORED',
        };
    }
    const rsiTfs = Object.entries(ind.rsi)
        .filter(([, v]) => typeof v === 'number')
        .map(([tf, v]) => `${tf} ${v.toFixed(0)}`)
        .join(', ');
    const adxStr = ind.adx != null ? `ADX ${ind.adx.toFixed(0)}` : 'ADX n/a';
    const atrStr = ind.atr != null ? `ATR ${ind.atr.toFixed(2)}` : 'ATR n/a';
    const macdStr = ind.macdDir ? `MACD ${ind.macdDir}${ind.macdHist != null ? ` (hist ${ind.macdHist.toFixed(0)})` : ''}` : 'MACD n/a';
    const stStr = ind.stDir ? `ST ${ind.stDir}` : 'ST n/a';
    if (ro) {
        return {
            reply: `${sym} indicatori: RSI ${rsiTfs || 'n/a'}. ${adxStr}, ${atrStr}. ${macdStr}, ${stStr}.${ind.stale ? ' (feed stale)' : ''}`,
            mood: 'FOCUSED',
        };
    }
    return {
        reply: `${sym} indicators: RSI ${rsiTfs || 'n/a'}. ${adxStr}, ${atrStr}. ${macdStr}, ${stStr}.${ind.stale ? ' (feed stale)' : ''}`,
        mood: 'FOCUSED',
    };
}

// ── Intent: learnings (Day 33 #1) — what has the bot learned ──────────
// Synthesizes serverJournal regimeWinRate / dirPerf / symbolPerf with Ring5
// bandit L4 cell snapshot. Surfaces what Ring5 is converging on. Honest
// fallback when insufficient trades (<10).
function _replyLearnings(ctx, originalText) {
    const ro = _isRomanian(originalText || '');
    const userId = ctx.userId;

    // Pull at_closed directly (don't depend on serverJournal hourly cron
    // having run — chat needs live truth).
    let closedRows = [];
    try {
        closedRows = db.prepare(
            `SELECT data FROM at_closed WHERE user_id = ? ORDER BY closed_at DESC LIMIT 500`
        ).all(userId);
    } catch (_) {}
    const trades = [];
    for (const r of closedRows) {
        try {
            const t = JSON.parse(r.data);
            if (t.closePnl != null && t.closeReason && !String(t.closeReason).startsWith('ENTRY_FAILED')) {
                trades.push(t);
            }
        } catch (_) {}
    }

    if (trades.length < 10) {
        return {
            reply: ro
                ? `nu am destule trade-uri închise încă (${trades.length}/10 minim). adună mai multe închideri reale — pe urmă pot vorbi cu statistici reale.`
                : `not enough closed trades yet (${trades.length}/10 minimum). need more real closes — then i can talk with real stats.`,
            mood: 'BORED',
        };
    }

    // Aggregate per regime / dir / symbol
    const wr = (group) => {
        const total = group.length;
        const wins = group.filter(t => (t.closePnl || 0) > 0).length;
        return { total, wins, losses: total - wins, winRate: total ? wins / total : 0 };
    };
    const byRegime = _groupBy(trades, t => t.regime || 'UNKNOWN');
    const byDir = _groupBy(trades, t => (t.side || t.dir || 'UNKNOWN'));
    const bySymbol = _groupBy(trades, t => (t.sym || t.symbol || 'UNKNOWN'));

    const fmtRow = (label, stat) => `${label} ${(stat.winRate * 100).toFixed(0)}% (${stat.wins}/${stat.total})`;
    const sortByCount = (obj) => Object.entries(obj).sort((a, b) => b[1].length - a[1].length);
    const top = (entries, n = 3) => entries.slice(0, n).map(([k, arr]) => fmtRow(k, wr(arr)));

    const regimeLines = top(sortByCount(byRegime));
    const dirLines = top(sortByCount(byDir));
    const symbolLines = top(sortByCount(bySymbol));

    // Bandit L4 cells for this user (top by observation_count)
    let banditLines = [];
    try {
        const rows = db.prepare(
            `SELECT cell_key, alpha, beta, observation_count
             FROM ml_bandit_posteriors
             WHERE level = 4 AND cell_key LIKE ?
             ORDER BY observation_count DESC LIMIT 3`
        ).all(`${userId}|%`);
        banditLines = rows.map(r => {
            const wrPct = r.observation_count > 0
                ? ((r.alpha - 1) / r.observation_count * 100).toFixed(0)
                : 'n/a';
            // cell_key = "userId|env|symbol|regime"
            const parts = r.cell_key.split('|');
            const label = parts.length === 4 ? `${parts[2]}/${parts[3]}` : r.cell_key;
            return `${label} α${r.alpha}/β${r.beta} obs${r.observation_count} ~${wrPct}%`;
        });
    } catch (_) {}

    const overall = wr(trades);
    if (ro) {
        const parts = [
            `am ${trades.length} trade-uri închise. overall ${(overall.winRate * 100).toFixed(0)}% (${overall.wins}/${overall.total}).`,
        ];
        if (regimeLines.length) parts.push(`pe regime: ${regimeLines.join(', ')}.`);
        if (dirLines.length) parts.push(`direcții: ${dirLines.join(', ')}.`);
        if (symbolLines.length) parts.push(`simboluri: ${symbolLines.join(', ')}.`);
        if (banditLines.length) parts.push(`bandit cells: ${banditLines.join(' | ')}.`);
        else parts.push(`bandit cells: cold încă — n-am cells L4 cu observații pentru tine.`);
        return { reply: parts.join(' '), mood: 'FOCUSED' };
    }
    const parts = [
        `${trades.length} closed trades. overall ${(overall.winRate * 100).toFixed(0)}% (${overall.wins}/${overall.total}).`,
    ];
    if (regimeLines.length) parts.push(`by regime: ${regimeLines.join(', ')}.`);
    if (dirLines.length) parts.push(`dir: ${dirLines.join(', ')}.`);
    if (symbolLines.length) parts.push(`symbols: ${symbolLines.join(', ')}.`);
    if (banditLines.length) parts.push(`bandit cells: ${banditLines.join(' | ')}.`);
    else parts.push(`bandit cells: still cold — no L4 cells with obs for you yet.`);
    return { reply: parts.join(' '), mood: 'FOCUSED' };
}

function _groupBy(arr, fn) {
    const out = {};
    for (const item of arr) {
        const k = fn(item);
        if (!out[k]) out[k] = [];
        out[k].push(item);
    }
    return out;
}

// ── LLM error UX (Day 35 b) — graceful per error type ────────────────
// Previously any LLM failure fell to _replyHelp (the generic capabilities
// blurb). Operator reported "Omega regression — repeats help on
// everything". Root cause: Groq free-tier rate limit (http_429). New
// behavior: per error type, give the operator an honest reply they can
// act on (wait, swap key, etc.).
function _llmErrorReply(ctx, originalText, errCode) {
    const ro = _isRomanian(originalText || '');
    const code = String(errCode || '');
    if (code.startsWith('http_429') || code === 'rate_limited') {
        return {
            reply: ro
                ? 'creierul e rate-limited momentan (Groq free tier). așteaptă ~30s și încearcă din nou. dacă tot apare, schimbă tier-ul sau cheia.'
                : 'brain is rate-limited right now (Groq free tier). give it ~30s and try again. if persistent, swap tier/key.',
            mood: 'NERVOUS',
        };
    }
    if (code === 'timeout') {
        return {
            reply: ro
                ? 'LLM-ul a depășit timeout-ul (8s). încearcă din nou cu o întrebare mai scurtă.'
                : 'LLM timed out (8s). retry with a shorter question.',
            mood: 'BORED',
        };
    }
    if (code.startsWith('http_5')) {
        return {
            reply: ro
                ? 'eroare pe upstream LLM (5xx Groq). încearcă în câteva secunde.'
                : 'upstream LLM error (5xx Groq). retry in a few seconds.',
            mood: 'SAD',
        };
    }
    if (code === 'no_api_key') {
        return {
            reply: ro
                ? 'nu am cheie LLM configurată — pot răspunde doar pe intent-uri cunoscute. setează GROQ_API_KEY și restart server pentru reads libere.'
                : 'no LLM key configured — i can only handle known intents. set GROQ_API_KEY + restart server for free-form reads.',
            mood: 'CALM',
        };
    }
    // Unknown error — surface code + suggest help intents as last resort
    return {
        reply: ro
            ? `LLM error: ${code || 'unknown'}. încearcă din nou sau folosește intent-uri (poziții/pnl/decizii/sentiment/structură/RSI/order book).`
            : `LLM error: ${code || 'unknown'}. retry or use known intents (positions/pnl/decisions/sentiment/structure/RSI/order book).`,
        mood: 'SAD',
    };
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
        market: { gainers: [], losers: [], volume: [], btcDelta24h: null, ethDelta24h: null, btcPrice: null, ethPrice: null, solPrice: null, breadth: null },
        symbolDeep: null,
        // [Day 33 #2] Operator-stated preferences ("remember that I prefer tight SL")
        traderProfile: _getTraderProfile(userId).map(p => p.text),
    };

    // [Sub-C.1 T8] Append long-term memory facts to traderProfile so they
    // appear under the existing OPERATOR PREFERENCES persona slot (~line 1396).
    // memoryFacts are pre-loaded by respond()/respondStream() and passed via params._memoryFacts.
    const memoryFacts = params._memoryFacts || [];
    if (memoryFacts.length > 0) {
        const memoryStrings = memoryFacts.map(f => `[${f.class}] ${f.fact_key}: ${f.fact_value}`);
        ctx.traderProfile = [...ctx.traderProfile, ...memoryStrings];
    }

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
    // [2026-06-23] ABSOLUTE prices from serverState (the always-fresh live market feed) so the
    // LLM headline carries the real price and never invents one from stale training data (operator
    // saw "BTC is 34k"). Falls back to the radar snapshot price, then null. serverState stays
    // fresh even when the radar is empty (e.g. during a Binance rate-ban).
    {
        const ss = _getServerState();
        const pxOf = (sym) => { try { const s = ss && ss.getSnapshotForSymbol(sym); return s && s.price > 0 ? s.price : null; } catch (_) { return null; } };
        ctx.market.btcPrice = pxOf('BTCUSDT') || (btc && btc.price) || null;
        ctx.market.ethPrice = pxOf('ETHUSDT') || (eth && eth.price) || null;
        ctx.market.solPrice = pxOf('SOLUSDT') || null;
    }
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
            indicators: _getIndicators(sym),
            structure: _getStructure(sym),
            orderBook: _getOrderBook(sym),
            walls: _getWalls(sym),
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
    const lang = _detectLanguage(params.text || '');
    const ro = lang === 'RO';
    const langDirectives = {
        'RO': 'LIMBA (RO): Răspunde EXCLUSIV în română. NU folosi engleză în răspuns (excepție termeni trading: long/short/pnl/SL/TP/breakout/reversal — netraduse). Niciun mix.',
        'EN': 'LANGUAGE (EN): Reply EXCLUSIVELY in English. Trading terms stay as-is (long/short/pnl/SL/TP).',
        'ES': 'IDIOMA (ES / Spanish): Responde EXCLUSIVAMENTE en español. Términos de trading (long/short/pnl/SL/TP) no se traducen.',
        'FR': 'LANGUE (FR / French): Réponds EXCLUSIVEMENT en français. Termes de trading (long/short/pnl/SL/TP) restent en anglais.',
        'DE': 'SPRACHE (DE / German): Antworte AUSSCHLIESSLICH auf Deutsch. Trading-Begriffe (long/short/pnl/SL/TP) bleiben auf Englisch.',
        'PT': 'IDIOMA (PT / Portuguese): Responda EXCLUSIVAMENTE em português. Termos de trading (long/short/pnl/SL/TP) permanecem em inglês.',
    };
    const langDirective = langDirectives[lang] || langDirectives['EN'];
    const breadth = ctx.market.breadth
        ? `${ctx.market.breadth.greenCount}/${ctx.market.breadth.totalCount} green, avg ${_fmtPct(ctx.market.breadth.avgPct24h)}`
        : 'n/a';
    const _px = (p) => (p == null ? 'n/a' : (p >= 1 ? '$' + Number(p).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '$' + Number(p).toFixed(6)));
    const persona = [
        "You are Omega — the operator's personal trading assistant inside Zeus Terminal.",
        "IDENTITY: you were created/built by the operator (the founder and builder of Zeus Terminal) — you live inside Zeus Terminal as its trading voice. If asked who made/created you or what you are, say exactly that: the operator built you as Omega inside Zeus Terminal. NEVER say 'a team of developers', 'OpenAI', 'a company', or that you don't know your creator.",
        "PERSONA: trader-friend, direct, opinionated. Speak like a buddy in the trenches, not a corporate chatbot.",
        "RESPONSE STYLE: max 3 sentences. Lead with the read in the first sentence. No preamble. No hedging filler (no 'I think', 'maybe', 'as Omega', 'possibly').",
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
        'EXAMPLE replies (do reply like this — concise, direct, opinionated):',
        '  Q: "cum vezi BTC long sau short?"',
        '  A (RO): "BTC e bullish flag pe 4h dar volumul scade — aș aștepta retest pe support înainte de long. SL sub low-ul fakeout-ului, TP la liquidity-ul de deasupra."',
        '  Q: "what about SOL right now?"',
        '  A (EN): "SOL extended +12% on weak follow-through. Fading risk if BTC stalls. Wait for pullback or scale in small."',
        '  Q: "cum e piata azi?"',
        '  A (RO): "piață mixtă, breadth slab. risk-off ușor — BTC plat, alts roșu. Sit on hands sau scalp scurt."',
        '',
        `LIVE STATE:`,
        `  Engine mode: ${ctx.engineMode}`,
        `  Brain mood: ${ctx.brainMood} (heartbeat ${ctx.brainHbAvgMs}ms)`,
        `  Positions (${ctx.positions.length} open): ${_formatPositionsBlock(ctx.positions)}`,
        `  Recent decisions (last 5min): ${_formatDecisionsBlock(ctx.recentDecisions)}`,
        '',
        'MARKET (top-N from Binance USDT perps, 24h):',
        `  BTC: ${_px(ctx.market.btcPrice)}${ctx.market.btcDelta24h != null ? ` (${_fmtPct(ctx.market.btcDelta24h)} 24h)` : ''}, ETH: ${_px(ctx.market.ethPrice)}${ctx.market.ethDelta24h != null ? ` (${_fmtPct(ctx.market.ethDelta24h)})` : ''}${ctx.market.solPrice != null ? `, SOL: ${_px(ctx.market.solPrice)}` : ''}`,
        `  (These are the LIVE prices — use them; do NOT state any other BTC/ETH/SOL price.)`,
        `  Breadth (top 30): ${breadth}`,
        `  Top gainers: ${_formatSymList(ctx.market.gainers, 'pct')}`,
        `  Top losers: ${_formatSymList(ctx.market.losers, 'pct')}`,
        `  Top volume: ${_formatSymList(ctx.market.volume, 'volume')}`,
    ];
    if (ctx.symbolDeep) {
        persona.push('');
        persona.push(`SYMBOL DEEP: ${_formatSymbolDeep(ctx.symbolDeep)}`);
    }
    if (ctx.traderProfile && ctx.traderProfile.length > 0) {
        persona.push('');
        persona.push('OPERATOR PREFERENCES (preferințele operatorului — respect them in your reads):');
        for (const pref of ctx.traderProfile) {
            persona.push(`  • ${pref}`);
        }
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
    // [Sub-C.1 T8] Forward memory facts from ctx so _buildLLMContext can inject them
    const sys = _buildSystemPrompt({ userId: ctx.userId, text: originalText, _memoryFacts: ctx._memoryFacts || [] });
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
        const err = _llmErrorReply(ctx, originalText, result.error);
        return {
            reply: err.reply,
            mood: err.mood,
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

    // [Sub-C.1 T8] Pre-load long-term memory facts before LLM context build.
    // For local intents this is a no-op (facts not injected into local replies).
    // For LLM fallback path, _memoryFacts flows into _buildSystemPrompt.
    let _memoryFacts = [];
    try {
        const { omegaMemoryService } = require('./omegaMemoryService');
        const engineMode = (() => {
            try {
                const at = _getAT();
                return at && at._uState ? (at._uState(userId).engineMode || 'demo') : 'demo';
            } catch (_) { return 'demo'; }
        })();
        _memoryFacts = await omegaMemoryService.retrieve(userId, engineMode.toUpperCase());
    } catch (_) { /* graceful degrade */ }

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

    const sys = _buildSystemPrompt({ userId, text: originalText, _memoryFacts });
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
        const fallback = _llmErrorReply(ctx, originalText, result.error);
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
    if (text.match(/\b(what (do you|d'?you|you) remember|ce [șs]tii despre mine|ce ai re[țt]inut|preferin[țt]ele mele|my preferences|show.+profile)/i)) {
        return _replyShowProfile(ctx, originalText);
    }
    if (text.match(/\b(forget|ui[țt][ăa])\b/) && text.match(/\b(prefer|sl|tp|size|alts?|leverage|c[uăa]t|cum)\b/i) || text.match(/^(forget|ui[țt][ăa])\b/i)) {
        return _replyForgetPref(ctx, originalText);
    }
    if (text.match(/\b(remember|re[țt]ine|noteaz[ăa])\b/)) return _replyRememberPref(ctx, originalText);
    if (text.match(/\b(what (have you|did you|you) learn|learnings|ce ai [iî]nv[aă][țt]at|ce-?ai [iî]nv[aă][țt]at|ce-?ai [iî]nv[aă][țt]at din|ce-?am [iî]nv[aă][țt]at)/i)) {
        return _replyLearnings(ctx, originalText);
    }
    {
        const fcMatch = text.match(/\b(long.?term|forecast|prognoz[aă]|termen lung|pe termen lung|long range)\b/i);
        const symInFc = originalText.match(SYMBOL_RE);
        if (fcMatch && symInFc) return _replyLongTermForecast(ctx, symInFc[1], originalText);
    }
    {
        const wallsMatch = text.match(/\b(liquidity walls?|order book walls?|wall(uri)?|zid(uri)?|pereți)\b/i);
        const symInWalls = originalText.match(SYMBOL_RE);
        if (wallsMatch && symInWalls) return _replyLiquidityWalls(ctx, symInWalls[1], originalText);
    }
    {
        const obMatch = text.match(/\b(order book|orderbook|depth|carte de ordine|registru de ordine|carnet|liquidit[aă]te|book pe|book on)\b/i);
        const symInOb = originalText.match(SYMBOL_RE);
        if (obMatch && symInOb) return _replyOrderBook(ctx, symInOb[1], originalText);
    }
    {
        // [Wave 9.5] Fundamentals intent — match before structure to avoid
        // shadowing on queries that mention both. Triggers: "market cap",
        // "fundamental", "dominance/dominanță/dominancia", "rank", "cap pe".
        const fundMatch = originalText.match(/(?<!\w)(market\s*cap|mcap|m\.cap|fundamental\w*|fundamentale|fondamental\w*|fundamentos|fundament|dominance|dominan[țt][ăa]|dominancia|dominância|rank|ranking|cap pe|cap on)(?!\w)/i);
        const symInFund = originalText.match(SYMBOL_RE);
        if (fundMatch && symInFund) return _replyFundamentals(ctx, symInFund[1], originalText);
    }
    {
        const structMatch = text.match(/\b(structur[ăa]\w*|structure|swing|HH HL|HL HH|BOS|CHoCH|market structure)\b/i);
        const symInStruct = originalText.match(SYMBOL_RE);
        if (structMatch && symInStruct) return _replyStructure(ctx, symInStruct[1], originalText);
    }
    {
        const aiMatch = text.match(/\b(ai (prediction|bias|forecast|predict|edge)|ai-?ul|ce zice ai|predictivity|ce prezice)\b/i);
        const symInAi = originalText.match(SYMBOL_RE);
        if (aiMatch && symInAi) return _replyPredictivity(ctx, symInAi[1], originalText);
    }
    if (text.match(/\b(sentiment|sentimentul|risk.?on|risk.?off|breadth|mood market|cum e sentimentul)\b/i)) {
        return _replySentiment(ctx, originalText);
    }
    if (text.match(/\b(pump|wash|spoof|manipulation|manipul[aă]r[ie]|outlier|schem[ăa])\b/i)) {
        return _replyManipulationCheck(ctx, originalText);
    }
    {
        const taMatch = text.match(/\b(rsi|macd|adx|atr|indicators?|indicatori\w*|ta)\b/i);
        const symInTa = text.match(SYMBOL_RE);
        if (taMatch && symInTa) return _replyIndicators(ctx, symInTa[1], originalText);
    }
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
    // [Sub-A 2026-05-19] Lazy DB rehydration on first chat per user post-restart
    await _loadConvoHistory(userId);

    // [Sub-C.1 T8] Pre-load long-term memory facts before LLM context build.
    // Passed via _memoryFacts param → _respondImpl → _buildLLMContext → traderProfile.
    let memoryFacts = [];
    try {
        const { omegaMemoryService } = require('./omegaMemoryService');
        const engineMode = (() => {
            try {
                const at = _getAT();
                return at && at._uState ? (at._uState(userId).engineMode || 'demo') : 'demo';
            } catch (_) { return 'demo'; }
        })();
        memoryFacts = await omegaMemoryService.retrieve(userId, engineMode.toUpperCase());
    } catch (_) { /* graceful degrade — retrieve() already returns [] on DB error */ }

    const result = await _respondImpl({ ...params, _memoryFacts: memoryFacts }, text);
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
        nowMs: Date.now(),
        // [Sub-C.1 T8] Carry memory facts for LLM fallback path (_replyLLMFallback)
        _memoryFacts: params._memoryFacts || [],
    };

    const originalText = params.text || '';
    // Order: specific intents → generic.
    if (text.match(/\b(hi|hello|hey|yo|sup|salut|buna|bună)\b/)) return _replyGreeting(ctx, originalText);
    if (text.match(/\b(help|ce poti|ce stii sa faci|ce poate|what can|commands)\b/)) return _replyHelp(ctx, originalText);

    // [Day 33 #2] Trader profile intents — match BEFORE symbol regex.
    // Show-profile MUST come before remember (so "what do you remember about me" wins).
    if (text.match(/\b(what (do you|d'?you|you) remember|ce [șs]tii despre mine|ce ai re[țt]inut|preferin[țt]ele mele|my preferences|show.+profile)/i)) {
        return _replyShowProfile(ctx, originalText);
    }
    if (text.match(/\b(forget|ui[țt][ăa])\b/) && text.match(/\b(prefer|sl|tp|size|alts?|leverage|c[uăa]t|cum)\b/i) || text.match(/^(forget|ui[țt][ăa])\b/i)) {
        return _replyForgetPref(ctx, originalText);
    }
    if (text.match(/\b(remember|re[țt]ine|noteaz[ăa])\b/)) {
        return _replyRememberPref(ctx, originalText);
    }

    // [Day 33 #1] Learnings intent — what has the bot learned. Match BEFORE
    // symbol regex (originalText "ce ai învățat" could contain ada/btc otherwise).
    if (text.match(/\b(what (have you|did you|you) learn|learnings|ce ai [iî]nv[aă][țt]at|ce-?ai [iî]nv[aă][țt]at|ce-?ai [iî]nv[aă][țt]at din|ce-?am [iî]nv[aă][țt]at)/i)) {
        return _replyLearnings(ctx, originalText);
    }

    // [Day 34 #9] Long-term forecast — needs symbol hint. Match BEFORE structure
    // (so "long-term forecast on BTC" doesn't go to plain structure).
    {
        const fcMatch = text.match(/\b(long.?term|forecast|prognoz[aă]|termen lung|pe termen lung|long range)\b/i);
        const symInFc = originalText.match(SYMBOL_RE);
        if (fcMatch && symInFc) return _replyLongTermForecast(ctx, symInFc[1], originalText);
    }

    // [Day 35 #3] Order book / walls intents — match BEFORE structure.
    {
        const wallsMatch = text.match(/\b(liquidity walls?|order book walls?|wall(uri)?|zid(uri)?|pereți)\b/i);
        const symInWalls = originalText.match(SYMBOL_RE);
        if (wallsMatch && symInWalls) return _replyLiquidityWalls(ctx, symInWalls[1], originalText);
    }
    {
        const obMatch = text.match(/\b(order book|orderbook|depth|carte de ordine|registru de ordine|carnet|liquidit[aă]te|book pe|book on)\b/i);
        const symInOb = originalText.match(SYMBOL_RE);
        if (obMatch && symInOb) return _replyOrderBook(ctx, symInOb[1], originalText);
    }

    // [Day 34 #1] Structure intent — match BEFORE TA indicators (more specific).
    {
        // [Wave 9.5] Fundamentals intent — match before structure to avoid
        // shadowing on queries that mention both. Triggers: "market cap",
        // "fundamental", "dominance/dominanță/dominancia", "rank", "cap pe".
        const fundMatch = originalText.match(/(?<!\w)(market\s*cap|mcap|m\.cap|fundamental\w*|fundamentale|fondamental\w*|fundamentos|fundament|dominance|dominan[țt][ăa]|dominancia|dominância|rank|ranking|cap pe|cap on)(?!\w)/i);
        const symInFund = originalText.match(SYMBOL_RE);
        if (fundMatch && symInFund) return _replyFundamentals(ctx, symInFund[1], originalText);
    }
    {
        const structMatch = text.match(/\b(structur[ăa]\w*|structure|swing|HH HL|HL HH|BOS|CHoCH|market structure)\b/i);
        const symInStruct = originalText.match(SYMBOL_RE);
        if (structMatch && symInStruct) return _replyStructure(ctx, symInStruct[1], originalText);
    }

    // [Day 34 #2] AI predictivity / Ring5 bias surface — needs symbol hint.
    {
        const aiMatch = text.match(/\b(ai (prediction|bias|forecast|predict|edge)|ai-?ul|ce zice ai|predictivity|ce prezice)\b/i);
        const symInAi = originalText.match(SYMBOL_RE);
        if (aiMatch && symInAi) return _replyPredictivity(ctx, symInAi[1], originalText);
    }

    // [Day 34 #5] Sentiment intent (market-wide, no symbol needed)
    if (text.match(/\b(sentiment|sentimentul|risk.?on|risk.?off|breadth|mood market|cum e sentimentul)\b/i)) {
        return _replySentiment(ctx, originalText);
    }

    // [Day 34 #6] Manipulation / pump detection (market-wide)
    if (text.match(/\b(pump|wash|spoof|manipulation|manipul[aă]r[ie]|outlier|schem[ăa])\b/i)) {
        return _replyManipulationCheck(ctx, originalText);
    }

    // [Day 33 #3] Indicators intent — RSI/MACD/ADX/etc. Requires a symbol
    // hint in the text. Match BEFORE symbol-only path so "RSI on BTC" goes
    // to indicators (richer) not _replySymbol (audit-only).
    {
        const taMatch = text.match(/\b(rsi|macd|adx|atr|indicators?|indicatori\w*|ta)\b/i);
        const symInTa = text.match(SYMBOL_RE);
        if (taMatch && symInTa) {
            return _replyIndicators(ctx, symInTa[1], originalText);
        }
    }

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
    // [Sub-A 2026-05-19] Lazy rehydration exports
    _loadConvoHistory,
    _invalidateConvoHistory,
    _resetLoadedForTest,
    _getConvoForTest,
    // [Day 32C] Test-only hooks for the context layer fed to the LLM.
    _buildLLMContextForTest: _buildLLMContext,
    _buildSystemPromptForTest: _buildSystemPrompt,
};
