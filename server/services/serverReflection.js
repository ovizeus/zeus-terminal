// Zeus Terminal — Brain Reflection Engine (Meta-Cognitive Layer)
// Self-reflective system: post-trade analysis, pre-trade questioning,
// learned rules, mistake patterns, session reviews.
// The brain doesn't just trade — it THINKS about how it trades.
// *** Per-user isolated: all state keyed by userId ***
'use strict';

const logger = require('./logger');
const db = require('./database');

// ══════════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════════
const REFLECTION_INTERVAL = 1800000;   // 30min session review cycle
const SESSION_REVIEW_INTERVAL = 21600000; // 6h full session review
const MAX_RULES = 50;                  // max learned rules
const MAX_THOUGHTS = 100;              // ring buffer for live thoughts
const MAX_ANTI_PATTERNS = 30;
const MIN_PATTERN_OCCURRENCES = 3;     // need 3+ occurrences to create rule

// ══════════════════════════════════════════════════════════════════
// Per-user state (Map<userId, ...>)
// ══════════════════════════════════════════════════════════════════
const _learnedRules    = new Map();  // userId → [{ id, rule, reason, createdAt, hitCount, active }]
const _antiPatterns    = new Map();  // userId → [{ id, pattern, lossRate, occurrences, createdAt }]
const _thoughts        = new Map();  // userId → [{ ts, symbol, type, text, severity }]
const _sessionReviews  = new Map();  // userId → [{ ts, period, summary, trades, winRate, conclusions }]
const _selfScores      = new Map();  // userId → { accuracyToday, streak, ... }
const _dslRecs         = new Map();  // userId → [{ symbol, regime, param, current, recommended, reason }]
const _calibrations    = new Map();  // userId → { '70-80': { predicted, wins, total } }
const _skippedTrades   = new Map();  // userId → [{ ts, symbol, dir, confidence, price }]

let _reflectionTimer = null;
let _sessionTimer = null;

// ── helpers to get/init per-user state ──
function _rules(uid)       { if (!_learnedRules.has(uid)) _learnedRules.set(uid, []); return _learnedRules.get(uid); }
function _patterns(uid)    { if (!_antiPatterns.has(uid)) _antiPatterns.set(uid, []); return _antiPatterns.get(uid); }
function _tht(uid)         { if (!_thoughts.has(uid)) _thoughts.set(uid, []); return _thoughts.get(uid); }
function _reviews(uid)     { if (!_sessionReviews.has(uid)) _sessionReviews.set(uid, []); return _sessionReviews.get(uid); }
function _score(uid) {
    if (!_selfScores.has(uid)) _selfScores.set(uid, {
        accuracyToday: null, streak: 0, bestStreak: 0,
        regretTrades: 0, avoidedLosses: 0, decisionsToday: 0, correctToday: 0,
    });
    return _selfScores.get(uid);
}
function _dsl(uid)         { if (!_dslRecs.has(uid)) _dslRecs.set(uid, []); return _dslRecs.get(uid); }
function _cal(uid)         { if (!_calibrations.has(uid)) _calibrations.set(uid, {}); return _calibrations.get(uid); }
function _skipped(uid)     { if (!_skippedTrades.has(uid)) _skippedTrades.set(uid, []); return _skippedTrades.get(uid); }

// ══════════════════════════════════════════════════════════════════
// Start / Stop
// ══════════════════════════════════════════════════════════════════
function start() {
    if (_reflectionTimer) return;
    _restoreAllUsers();
    _reflectionTimer = setInterval(_reflectionCycle, REFLECTION_INTERVAL);
    _sessionTimer = setInterval(_sessionReview, SESSION_REVIEW_INTERVAL);
    setTimeout(_reflectionCycle, 60000);
    logger.info('REFLECTION', 'Brain reflection engine started (per-user)');
}

function stop() {
    if (_reflectionTimer) { clearInterval(_reflectionTimer); _reflectionTimer = null; }
    if (_sessionTimer) { clearInterval(_sessionTimer); _sessionTimer = null; }
}

// ══════════════════════════════════════════════════════════════════
// CORE: Post-Trade Reflection (called after each trade closes)
// ══════════════════════════════════════════════════════════════════
function reflectOnTrade(trade, marketContext, userId) {
    if (!trade || trade.closePnl == null || !userId) return;

    const isWin = trade.closePnl > 0;
    const snap = trade.entrySnapshot || {};
    const reasons = [];

    // ── Analyze WHY it won or lost ──
    if (snap.mtfAlignment != null && snap.mtfAlignment < 0.4 && !isWin) {
        reasons.push('MTF was misaligned at entry (' + Math.round(snap.mtfAlignment * 100) + '%)');
    }
    if (snap.mtfAlignment != null && snap.mtfAlignment > 0.7 && isWin) {
        reasons.push('MTF alignment was strong (' + Math.round(snap.mtfAlignment * 100) + '%)');
    }

    if (snap.structureTrend) {
        const enteredWithStructure = (trade.side === 'LONG' && snap.structureTrend === 'uptrend') ||
                                     (trade.side === 'SHORT' && snap.structureTrend === 'downtrend');
        if (!enteredWithStructure && !isWin) {
            reasons.push('Entered against market structure (' + snap.structureTrend + ')');
        }
        if (enteredWithStructure && isWin) {
            reasons.push('Structure confirmed entry direction');
        }
    }

    if (snap.regime) {
        if (['VOLATILE', 'CHAOS'].includes(snap.regime) && !isWin) {
            reasons.push('Entered in dangerous regime: ' + snap.regime);
        }
        if (snap.regime === 'RANGE' && trade.tier === 'LARGE' && !isWin) {
            reasons.push('Large position in RANGE regime — too aggressive');
        }
    }

    if (snap.liquidityGrabRisk > 60 && !isWin) {
        reasons.push('High liquidity trap risk at entry (' + snap.liquidityGrabRisk + '%)');
    }

    if (snap.confidence > 80 && !isWin) {
        reasons.push('High confidence (' + snap.confidence + '%) but lost — overconfident');
    }
    if (snap.confidence < 65 && isWin) {
        reasons.push('Low confidence (' + snap.confidence + '%) but won — could enter more decisively');
    }

    if (snap.cvdAligned === false && !isWin) {
        reasons.push('Order flow (CVD) was against entry direction');
    }

    if (trade.closeTs && trade.openTs) {
        const holdMin = (trade.closeTs - trade.openTs) / 60000;
        if (trade.mfe && trade.mfe > Math.abs(trade.closePnl) * 2 && !isWin) {
            reasons.push('Had ' + trade.mfe.toFixed(2) + ' MFE but ended in loss — exit too late');
        }
        if (holdMin < 5 && !isWin) {
            reasons.push('Closed very quickly (' + Math.round(holdMin) + 'min) — possible noise entry');
        }
    }

    // ── Generate thought ──
    const thought = {
        ts: Date.now(),
        symbol: trade.symbol,
        type: isWin ? 'win_reflection' : 'loss_reflection',
        severity: isWin ? 'info' : (reasons.length > 2 ? 'critical' : 'warning'),
        text: _buildReflectionText(trade, isWin, reasons),
        reasons,
        pnl: trade.closePnl,
        confidence: snap.confidence,
        regime: snap.regime,
    };
    _addThought(userId, thought);

    // ── Try to create/reinforce learned rules from patterns ──
    if (!isWin && reasons.length > 0) {
        _detectPatternAndLearn(userId, trade, reasons, marketContext);
    }

    // ── Update self-score ──
    const ss = _score(userId);
    if (isWin) {
        ss.streak++;
        if (ss.streak > ss.bestStreak) ss.bestStreak = ss.streak;
        ss.correctToday++;
    } else {
        ss.streak = 0;
    }
    ss.decisionsToday++;

    logger.info('REFLECTION', `[${trade.symbol}] uid=${userId} ${isWin ? 'WIN' : 'LOSS'} reflection: ${reasons.length} insights | PnL=${trade.closePnl.toFixed(2)}`);
}

// ══════════════════════════════════════════════════════════════════
// CORE: Pre-Trade Questioning (called before each entry)
// ══════════════════════════════════════════════════════════════════
function questionEntry(symbol, dir, confidence, regime, marketContext, userId) {
    if (!userId) return { proceed: true, concerns: [], adjustments: {}, totalPenalty: 0 };

    const concerns = [];
    const adjustments = {};
    let proceed = true;
    const rules = _rules(userId);
    const patterns = _patterns(userId);

    // ── 1. Check learned rules ──
    for (const rule of rules) {
        if (!rule.active) continue;
        const match = _ruleMatchesContext(rule, symbol, dir, regime, marketContext);
        if (match) {
            concerns.push({ type: 'learned_rule', rule: rule.rule, id: rule.id, severity: 'high' });
            rule.hitCount++;
            if (rule.blockEntry) {
                proceed = false;
                _addThought(userId, {
                    ts: Date.now(), symbol, type: 'rule_block',
                    severity: 'critical',
                    text: `BLOCKED by rule #${rule.id}: ${rule.rule}`,
                });
            }
        }
    }

    // ── 2. Check anti-patterns ──
    for (const ap of patterns) {
        if (_antiPatternMatches(ap, symbol, dir, regime, marketContext)) {
            concerns.push({ type: 'anti_pattern', pattern: ap.pattern, lossRate: ap.lossRate, severity: 'high' });
            if (ap.lossRate > 0.7) {
                proceed = false;
                _addThought(userId, {
                    ts: Date.now(), symbol, type: 'pattern_block',
                    severity: 'critical',
                    text: `BLOCKED by anti-pattern: ${ap.pattern} (${Math.round(ap.lossRate * 100)}% loss rate)`,
                });
            }
        }
    }

    // ── 3. Recent performance check ──
    const recentTrades = _getRecentTrades(symbol, 5, userId);
    const recentLosses = recentTrades.filter(t => t.closePnl <= 0).length;
    if (recentLosses >= 4) {
        concerns.push({ type: 'losing_streak', count: recentLosses, severity: 'high' });
        _addThought(userId, {
            ts: Date.now(), symbol, type: 'streak_warning',
            severity: 'warning',
            text: `${symbol}: ${recentLosses}/5 recent trades were losses. Caution.`,
        });
        adjustments.confidencePenalty = -10;
    } else if (recentLosses >= 3) {
        concerns.push({ type: 'poor_recent', count: recentLosses, severity: 'medium' });
        adjustments.confidencePenalty = -5;
    }

    // ── 4. Regime awareness ──
    if (['VOLATILE', 'CHAOS', 'LIQUIDATION_EVENT'].includes(regime)) {
        concerns.push({ type: 'dangerous_regime', regime, severity: 'high' });
        _addThought(userId, {
            ts: Date.now(), symbol, type: 'regime_caution',
            severity: 'warning',
            text: `${symbol}: Regime is ${regime}. Extra caution required.`,
        });
    }

    // ── 5. Market structure check ──
    if (marketContext && marketContext.structure) {
        const struct = marketContext.structure;
        if (struct.lastCHoCH && struct.lastCHoCH.dir) {
            const chochAgainst = (dir === 'LONG' && struct.lastCHoCH.dir === 'bearish') ||
                                 (dir === 'SHORT' && struct.lastCHoCH.dir === 'bullish');
            if (chochAgainst) {
                concerns.push({ type: 'choch_against', dir: struct.lastCHoCH.dir, severity: 'high' });
                adjustments.confidencePenalty = (adjustments.confidencePenalty || 0) - 8;
            }
        }
    }

    // ── 6. Liquidity trap check ──
    if (marketContext && marketContext.liquidity) {
        const liq = marketContext.liquidity;
        if (liq.liquidityGrabRisk > 0.6) {
            concerns.push({ type: 'liquidity_trap', risk: Math.round(liq.liquidityGrabRisk * 100), severity: 'high' });
        }
    }

    // ── 7. Correlation check ──
    if (marketContext && marketContext.openPositions) {
        const sameDir = marketContext.openPositions.filter(p => p.side === dir);
        if (sameDir.length >= 2) {
            concerns.push({ type: 'correlation_risk', openSameDir: sameDir.length, severity: 'medium' });
            _addThought(userId, {
                ts: Date.now(), symbol, type: 'correlation_warning',
                severity: 'warning',
                text: `Already ${sameDir.length} ${dir} positions open. Correlation risk.`,
            });
        }
    }

    // ── Generate pre-trade thought ──
    if (concerns.length > 0) {
        _addThought(userId, {
            ts: Date.now(), symbol, type: 'pre_trade_check',
            severity: proceed ? 'info' : 'critical',
            text: `${symbol} ${dir}: ${concerns.length} concern(s). ${proceed ? 'Proceeding with caution.' : 'ENTRY BLOCKED.'}`,
            concerns: concerns.map(c => c.type),
        });
    }

    return {
        proceed,
        concerns,
        adjustments,
        totalPenalty: adjustments.confidencePenalty || 0,
    };
}

// ══════════════════════════════════════════════════════════════════
// Pattern Detection + Rule Learning
// ══════════════════════════════════════════════════════════════════
function _detectPatternAndLearn(userId, trade, reasons, ctx) {
    const fp = {
        regime: trade.regime || (trade.entrySnapshot && trade.entrySnapshot.regime) || 'UNKNOWN',
        dir: trade.side,
        reasons: reasons.sort().join('|'),
    };
    const fpKey = `${fp.regime}:${fp.dir}:${fp.reasons}`;
    const patterns = _patterns(userId);

    const existing = patterns.find(ap => ap.fingerprint === fpKey);
    if (existing) {
        existing.occurrences++;
        existing.lastSeen = Date.now();
        if (existing.occurrences >= MIN_PATTERN_OCCURRENCES && existing.lossRate > 0.65 && !existing.ruleCreated) {
            _createRule(userId,
                `Avoid ${fp.dir} in ${fp.regime} when: ${reasons[0]}`,
                `Pattern seen ${existing.occurrences}x with ${Math.round(existing.lossRate * 100)}% loss rate`,
                fp,
                existing.lossRate > 0.8
            );
            existing.ruleCreated = true;
        }
    } else {
        if (patterns.length >= MAX_ANTI_PATTERNS) patterns.shift();
        patterns.push({
            fingerprint: fpKey,
            pattern: `${fp.dir} in ${fp.regime}: ${reasons[0]}`,
            regime: fp.regime,
            dir: fp.dir,
            lossRate: 1.0,
            occurrences: 1,
            wins: 0,
            losses: 1,
            createdAt: Date.now(),
            lastSeen: Date.now(),
            ruleCreated: false,
        });
    }
}

function _createRule(userId, rule, reason, context, blockEntry) {
    const rules = _rules(userId);
    const id = rules.length + 1;
    if (rules.length >= MAX_RULES) rules.shift();
    const newRule = {
        id,
        rule,
        reason,
        context,
        blockEntry: !!blockEntry,
        active: true,
        hitCount: 0,
        createdAt: Date.now(),
    };
    rules.push(newRule);
    _persistRules(userId);

    _addThought(userId, {
        ts: Date.now(), symbol: null, type: 'rule_created',
        severity: 'info',
        text: `NEW RULE #${id}: ${rule} | Reason: ${reason}${blockEntry ? ' [BLOCKING]' : ''}`,
    });

    logger.info('REFLECTION', `uid=${userId} Learned rule #${id}: ${rule} (block=${blockEntry})`);
}

// ══════════════════════════════════════════════════════════════════
// DSL Parameter Recommendations
// ══════════════════════════════════════════════════════════════════
function analyzeDSLParams(userId, regime, currentParams) {
    const trades = _getRecentTradesForRegime(userId, regime, 20);
    if (trades.length < 5) return null;

    const recommendations = [];

    const maes = trades.filter(t => t.mae != null).map(t => Math.abs(t.mae));
    const mfes = trades.filter(t => t.mfe != null).map(t => t.mfe);
    if (maes.length >= 5) {
        const avgMAE = maes.reduce((s, v) => s + v, 0) / maes.length;
        const slPct = currentParams.slPct || 1.5;
        if (avgMAE > slPct * 0.9) {
            const recommended = Math.round(avgMAE * 1.2 * 100) / 100;
            recommendations.push({
                param: 'slPct', current: slPct, recommended,
                reason: `Avg MAE in ${regime} is ${avgMAE.toFixed(2)}% — SL of ${slPct}% gets hit prematurely`,
                regime,
            });
        }
        if (avgMAE < slPct * 0.5 && maes.length >= 10) {
            const recommended = Math.round(Math.max(avgMAE * 1.5, slPct * 0.7) * 100) / 100;
            recommendations.push({
                param: 'slPct', current: slPct, recommended,
                reason: `Avg MAE in ${regime} is only ${avgMAE.toFixed(2)}% — SL of ${slPct}% wastes risk`,
                regime,
            });
        }
    }

    if (mfes.length >= 5 && maes.length >= 5) {
        const avgMFE = mfes.reduce((s, v) => s + v, 0) / mfes.length;
        const avgMAE = maes.reduce((s, v) => s + v, 0) / maes.length;
        const actualRR = avgMAE > 0 ? avgMFE / avgMAE : 0;
        const currentRR = currentParams.rr || 2;
        if (actualRR < currentRR * 0.6 && trades.length >= 10) {
            recommendations.push({
                param: 'rr', current: currentRR,
                recommended: Math.round(Math.max(actualRR * 0.9, 1.0) * 10) / 10,
                reason: `Actual R:R in ${regime} is ${actualRR.toFixed(1)} — target of ${currentRR} rarely reached`,
                regime,
            });
        }
    }

    if (recommendations.length > 0) {
        const dsl = _dsl(userId);
        for (const rec of recommendations) {
            const idx = dsl.findIndex(r => r.param === rec.param && r.regime === rec.regime);
            if (idx >= 0) dsl[idx] = rec;
            else dsl.push(rec);
        }
    }

    return recommendations.length > 0 ? recommendations : null;
}

// ══════════════════════════════════════════════════════════════════
// Confidence Calibration
// ══════════════════════════════════════════════════════════════════
function updateCalibration(predictedConf, actualWin, userId) {
    if (!userId) return;
    const cal = _cal(userId);
    const bucket = Math.floor(predictedConf / 10) * 10;
    const key = `${bucket}-${bucket + 10}`;
    if (!cal[key]) cal[key] = { predicted: bucket + 5, wins: 0, total: 0 };
    cal[key].total++;
    if (actualWin) cal[key].wins++;
}

function getCalibrationAdjustment(confidence, userId) {
    if (!userId) return 0;
    const cal = _cal(userId);
    const bucket = Math.floor(confidence / 10) * 10;
    const key = `${bucket}-${bucket + 10}`;
    const c = cal[key];
    if (!c || c.total < 10) return 0;

    const actualWR = c.wins / c.total;
    const predictedWR = c.predicted / 100;
    return Math.round((actualWR - predictedWR) * 100);
}

function getCalibrationData(userId) {
    if (!userId) return {};
    const cal = _cal(userId);
    const result = {};
    for (const [key, val] of Object.entries(cal)) {
        if (val.total >= 3) {
            result[key] = {
                predicted: val.predicted,
                actualWinRate: Math.round((val.wins / val.total) * 100),
                samples: val.total,
                gap: Math.round(((val.wins / val.total) - val.predicted / 100) * 100),
            };
        }
    }
    return result;
}

// ══════════════════════════════════════════════════════════════════
// Session Review (6h cycle)
// ══════════════════════════════════════════════════════════════════
function _sessionReview() {
    try {
        const userRows = db.db.prepare('SELECT DISTINCT user_id FROM at_closed WHERE user_id IS NOT NULL').all();
        for (const row of userRows) {
            _reviewForUser(row.user_id);
        }
    } catch (err) {
        logger.error('REFLECTION', `Session review failed: ${err.message}`);
    }
}

function _reviewForUser(userId) {
    const trades = _getRecentTrades(null, 50, userId);
    const cutoff = Date.now() - 86400000;
    const recent = trades.filter(t => (t.closeTs || t._closedAt) > cutoff);
    if (recent.length < 3) return;

    const wins = recent.filter(t => t.closePnl > 0);
    const losses = recent.filter(t => t.closePnl <= 0);
    const winRate = wins.length / recent.length;
    const totalPnl = recent.reduce((s, t) => s + (t.closePnl || 0), 0);

    const lossRegimes = {};
    for (const t of losses) {
        const r = t.regime || 'UNKNOWN';
        lossRegimes[r] = (lossRegimes[r] || 0) + 1;
    }
    const worstRegime = Object.entries(lossRegimes).sort((a, b) => b[1] - a[1])[0];

    const winRegimes = {};
    for (const t of wins) {
        const r = t.regime || 'UNKNOWN';
        winRegimes[r] = (winRegimes[r] || 0) + 1;
    }
    const bestRegime = Object.entries(winRegimes).sort((a, b) => b[1] - a[1])[0];

    const conclusions = [];
    if (worstRegime && worstRegime[1] >= 3) {
        conclusions.push(`Most losses in ${worstRegime[0]} regime (${worstRegime[1]}x) — consider raising confMin`);
    }
    if (bestRegime && bestRegime[1] >= 3) {
        conclusions.push(`Best performance in ${bestRegime[0]} regime (${bestRegime[1]} wins)`);
    }
    if (winRate < 0.4) conclusions.push('Win rate below 40% — brain should be more selective');
    if (winRate > 0.65) conclusions.push('Win rate above 65% — current approach is working well');

    const review = {
        ts: Date.now(),
        period: '24h',
        userId,
        trades: recent.length,
        wins: wins.length,
        losses: losses.length,
        winRate: Math.round(winRate * 100),
        totalPnl: Math.round(totalPnl * 100) / 100,
        conclusions,
        worstRegime: worstRegime ? worstRegime[0] : null,
        bestRegime: bestRegime ? bestRegime[0] : null,
    };

    const reviews = _reviews(userId);
    reviews.push(review);
    if (reviews.length > 10) reviews.shift();

    _addThought(userId, {
        ts: Date.now(), symbol: null, type: 'session_review',
        severity: winRate < 0.4 ? 'critical' : 'info',
        text: `SESSION REVIEW (24h): ${recent.length} trades, ${wins.length}W/${losses.length}L, WR=${Math.round(winRate * 100)}%, PnL=${totalPnl.toFixed(2)}`,
    });

    // ── DSL recommendations from session ──
    const regimeParams = require('./serverRegimeParams');
    for (const regime of Object.keys(regimeParams.REGIME_PROFILES)) {
        const stc = regimeParams.getAdaptedParams(regime, {});
        analyzeDSLParams(userId, regime, stc);
    }

    logger.info('REFLECTION', `Session review uid=${userId}: ${recent.length} trades, WR=${Math.round(winRate * 100)}%`);
}

// ══════════════════════════════════════════════════════════════════
// Reflection Cycle (30min — lighter analysis)
// ══════════════════════════════════════════════════════════════════
function _reflectionCycle() {
    // Reset daily counters at midnight UTC — per user
    const hour = new Date().getUTCHours();
    const min = new Date().getUTCMinutes();
    if (hour === 0 && min < 30) {
        for (const [uid, ss] of _selfScores) {
            ss.accuracyToday = ss.decisionsToday > 0
                ? Math.round((ss.correctToday / ss.decisionsToday) * 100) : null;
            ss.decisionsToday = 0;
            ss.correctToday = 0;
            ss.regretTrades = 0;
            ss.avoidedLosses = 0;
        }
    }

    // ── Decay old anti-patterns (30+ days) — per user ──
    const cutoff = Date.now() - 30 * 86400000;
    for (const [uid, patterns] of _antiPatterns) {
        for (let i = patterns.length - 1; i >= 0; i--) {
            if (patterns[i].lastSeen < cutoff) patterns.splice(i, 1);
        }
    }

    // ── Decay old rules — per user ──
    for (const [uid, rules] of _learnedRules) {
        for (const rule of rules) {
            if (rule.hitCount === 0 && (Date.now() - rule.createdAt) > 14 * 86400000) {
                rule.active = false;
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// Track skipped trades for regret/avoidance analysis
// ══════════════════════════════════════════════════════════════════
function trackSkippedTrade(symbol, dir, confidence, price, userId) {
    if (!userId) return;
    const sk = _skipped(userId);
    sk.push({ ts: Date.now(), symbol, dir, confidence, price });
    if (sk.length > 50) sk.shift();
}

function evaluateSkipped(symbol, currentPrice, userId) {
    if (!userId) return;
    const sk = _skipped(userId);
    const ss = _score(userId);
    const now = Date.now();
    for (let i = sk.length - 1; i >= 0; i--) {
        const s = sk[i];
        if (s.symbol !== symbol) continue;
        if (now - s.ts > 1800000) {
            const pctMove = ((currentPrice - s.price) / s.price) * 100;
            const wouldHaveWon = (s.dir === 'LONG' && pctMove > 0.5) || (s.dir === 'SHORT' && pctMove < -0.5);
            const wouldHaveLost = (s.dir === 'LONG' && pctMove < -0.5) || (s.dir === 'SHORT' && pctMove > 0.5);

            if (wouldHaveWon) ss.regretTrades++;
            if (wouldHaveLost) ss.avoidedLosses++;

            sk.splice(i, 1);
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════
function _addThought(userId, thought) {
    const t = _tht(userId);
    t.push(thought);
    if (t.length > MAX_THOUGHTS) t.splice(0, t.length - MAX_THOUGHTS);
}

function _buildReflectionText(trade, isWin, reasons) {
    const sym = trade.symbol || '?';
    const side = trade.side || '?';
    const pnl = trade.closePnl ? trade.closePnl.toFixed(2) : '0';
    const conf = (trade.entrySnapshot && trade.entrySnapshot.confidence) || '?';

    if (isWin) {
        return `${sym} ${side} WIN +${pnl} (conf=${conf}). ${reasons.length > 0 ? reasons.join('. ') + '.' : 'Clean trade.'}`;
    } else {
        return `${sym} ${side} LOSS ${pnl} (conf=${conf}). WHY: ${reasons.length > 0 ? reasons.join('. ') + '.' : 'No clear pattern — noise?'}`;
    }
}

function _ruleMatchesContext(rule, symbol, dir, regime, ctx) {
    if (!rule.context) return false;
    const c = rule.context;
    if (c.regime && c.regime !== regime) return false;
    if (c.dir && c.dir !== dir) return false;
    if (c.reasons && ctx) return true;
    return c.regime === regime && c.dir === dir;
}

function _antiPatternMatches(ap, symbol, dir, regime, ctx) {
    return ap.regime === regime && ap.dir === dir;
}

function _getRecentTrades(symbol, limit, userId) {
    try {
        if (!userId) return [];
        const rows = db.journalGetClosed(userId, limit || 10, 0);
        const trades = [];
        for (const row of rows) {
            try {
                const t = JSON.parse(row.data);
                t._closedAt = row.closed_at;
                if (!symbol || t.symbol === symbol) trades.push(t);
            } catch (_) {}
        }
        return trades.sort((a, b) => (b.closeTs || b._closedAt || 0) - (a.closeTs || a._closedAt || 0)).slice(0, limit || 10);
    } catch (err) {
        return [];
    }
}

function _getRecentTradesForRegime(userId, regime, limit) {
    const trades = _getRecentTrades(null, 200, userId);
    return trades.filter(t => (t.regime || 'UNKNOWN') === regime).slice(0, limit);
}

// ══════════════════════════════════════════════════════════════════
// Persistence (per-user to SQLite)
// ══════════════════════════════════════════════════════════════════
function _persistRules(userId) {
    try {
        // Key includes userId because at_state PK is just `key`
        db.atSetState(`brain:learnedRules:${userId}`, _rules(userId), userId);
        db.atSetState(`brain:antiPatterns:${userId}`, _patterns(userId), userId);
        db.atSetState(`brain:calibration:${userId}`, _cal(userId), userId);
    } catch (err) {
        logger.error('REFLECTION', `Persist rules failed uid=${userId}: ${err.message}`);
    }
}

function _restoreForUser(userId) {
    try {
        // Try per-user key first, fall back to old global key for migration
        let rules = db.atGetState(`brain:learnedRules:${userId}`);
        if (!rules) rules = db.atGetState('brain:learnedRules');
        if (Array.isArray(rules)) {
            _learnedRules.set(userId, rules);
            logger.info('REFLECTION', `uid=${userId} restored ${rules.length} learned rules`);
        }
        let patterns = db.atGetState(`brain:antiPatterns:${userId}`);
        if (!patterns) patterns = db.atGetState('brain:antiPatterns');
        if (Array.isArray(patterns)) {
            _antiPatterns.set(userId, patterns);
        }
        let cal = db.atGetState(`brain:calibration:${userId}`);
        if (!cal) cal = db.atGetState('brain:calibration');
        if (cal && typeof cal === 'object') {
            _calibrations.set(userId, cal);
        }
    } catch (err) {
        logger.error('REFLECTION', `Restore rules failed uid=${userId}: ${err.message}`);
    }
}

function _restoreAllUsers() {
    try {
        const userRows = db.db.prepare('SELECT DISTINCT user_id FROM at_closed WHERE user_id IS NOT NULL').all();
        for (const row of userRows) {
            _restoreForUser(row.user_id);
        }
        // Also try loading from at_state table
        try {
            const stateRows = db.db.prepare("SELECT DISTINCT user_id FROM at_state WHERE key LIKE 'brain:%' AND user_id IS NOT NULL").all();
            for (const row of stateRows) {
                if (!_learnedRules.has(row.user_id)) _restoreForUser(row.user_id);
            }
        } catch (_) {}
    } catch (err) {
        logger.error('REFLECTION', `Restore all users failed: ${err.message}`);
    }
}

// ══════════════════════════════════════════════════════════════════
// Public API — for UI and Brain integration
// ══════════════════════════════════════════════════════════════════
function getThoughts(limit, userId) {
    if (!userId) return [];
    return _tht(userId).slice(-(limit || 30));
}

function getLearnedRules(userId) {
    if (!userId) return [];
    return _rules(userId).filter(r => r.active);
}

function getSelfScore(userId) {
    if (!userId) return {};
    const ss = _score(userId);
    return Object.assign({}, ss, {
        accuracyToday: ss.decisionsToday > 0
            ? Math.round((ss.correctToday / ss.decisionsToday) * 100) : null,
    });
}

function getDSLRecommendations(userId) {
    if (!userId) return [];
    return _dsl(userId).slice();
}

function getSessionReviews(userId) {
    if (!userId) return [];
    return _reviews(userId).slice(-3);
}

function getDashboard(userId) {
    if (!userId) return { ts: Date.now(), thoughts: [], selfScore: {}, learnedRules: [], antiPatterns: [], calibration: {}, dslRecommendations: [], sessionReviews: [] };
    return {
        ts: Date.now(),
        thoughts: getThoughts(20, userId),
        selfScore: getSelfScore(userId),
        learnedRules: getLearnedRules(userId),
        antiPatterns: _patterns(userId).filter(ap => ap.occurrences >= 2).slice(-15),
        calibration: getCalibrationData(userId),
        dslRecommendations: getDSLRecommendations(userId),
        sessionReviews: getSessionReviews(userId),
    };
}

module.exports = {
    start,
    stop,
    reflectOnTrade,
    questionEntry,
    trackSkippedTrade,
    evaluateSkipped,
    updateCalibration,
    getCalibrationAdjustment,
    analyzeDSLParams,
    getThoughts,
    getLearnedRules,
    getSelfScore,
    getDSLRecommendations,
    getSessionReviews,
    getDashboard,
};
