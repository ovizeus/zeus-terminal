// Zeus Terminal — Telegram Bot Command Handler (Multi-User)
// Each user with configured telegram gets their own bot polling instance
// Zero dependencies — uses Node.js built-in https
'use strict';

const https = require('https');
const config = require('../config');

// Per-bot instance: { userId, token, chatId, offset, polling, timer }
const _bots = new Map();
const _RELOAD_INTERVAL = 60000; // check for new users every 60s
let _reloadTimer = null;
let _running = false;

// ── Helpers ──

function _apiCall(token, method, body) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : '';
        const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: '/bot' + token + '/' + method,
            method: body ? 'POST' : 'GET',
            headers: body
                ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
                : {},
            timeout: 35000,
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve({ ok: false, error: data.slice(0, 200) }); }
            });
        });
        req.on('error', (e) => reject(e));
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        if (payload) req.write(payload);
        req.end();
    });
}

async function _reply(token, chatId, text) {
    const res = await _apiCall(token, 'sendMessage', {
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
    });
    // Fallback: if Markdown parse fails (400), retry as plain text
    if (!res.ok && res.error_code === 400) {
        return _apiCall(token, 'sendMessage', {
            chat_id: chatId,
            text: text,
            disable_web_page_preview: true,
        });
    }
    return res;
}

// ── Data providers (lazy-loaded to avoid circular deps) ──

let _serverBrain, _serverAT, _serverState, _MF, _riskGuard;
function _load() {
    if (!_serverBrain) {
        _serverBrain = require('./serverBrain');
        _serverAT = require('./serverAT');
        _serverState = require('./serverState');
        _MF = require('../migrationFlags');
        _riskGuard = require('./riskGuard');
    }
}

// ── Command Handlers (now receive bot context) ──

async function cmdStatus(bot) {
    _load();
    const uptime = Math.floor(process.uptime());
    const mem = process.memoryUsage();
    const flags = _MF.getAll();
    const feedReady = _serverState.isDataReady();
    const brain = _serverBrain.getStatus ? _serverBrain.getStatus() : null;

    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);

    let text = '📊 *Zeus Terminal Status*\n\n';
    text += '⏱ Uptime: `' + h + 'h ' + m + 'm`\n';
    text += '💾 RAM: `' + Math.round(mem.rss / 1048576) + ' MB`\n';
    text += '📡 Feed: ' + (feedReady ? '✅ Live' : '❌ Down') + '\n';
    text += '🧠 Brain: ' + (brain && brain.running ? '✅ Running (cycle ' + brain.cycleCount + ')' : '❌ Off') + '\n';
    text += '⚙️ Trading: ' + (config.tradingEnabled ? '✅ ENABLED' : '🔒 Disabled') + '\n\n';
    text += '*Flags:*\n';
    for (const [k, v] of Object.entries(flags)) {
        text += (v ? '🟢' : '⚪') + ' ' + k + '\n';
    }
    return _reply(bot.token, bot.chatId, text);
}

async function cmdBrain(bot) {
    _load();
    const brain = _serverBrain.getStatus ? _serverBrain.getStatus() : null;
    if (!brain || !brain.lastDecision) return _reply(bot.token, bot.chatId, '🧠 Brain not active or no decisions yet.');

    const d = brain.lastDecision;
    const f = d.fusion;
    const r = d.regime;
    const g = d.gates;

    let text = '🧠 *Brain — Last Decision*\n\n';
    text += '💰 BTC: `$' + (d.price ? d.price.toFixed(0) : '?') + '`\n';
    text += '📈 Regime: `' + r.regime + '` (' + r.trendBias + ', ' + r.volatilityState + ')\n';
    text += '🎯 Confluence: `' + d.confluence.score + '/100`\n';
    text += '🧭 Direction: `' + f.dir + '`\n';
    text += '📋 Decision: `' + f.decision + '`\n';
    text += '💪 Confidence: `' + f.confidence + '%`\n';
    if (f.reasons && f.reasons.length) {
        text += '📝 Reason: `' + f.reasons.join(', ') + '`\n';
    }
    text += '\n*Gates:* ' + (g.allOk ? '✅ All OK' : '❌ Blocked') + '\n';
    if (!g.allOk && g.reasons && g.reasons.length) {
        text += 'Failed: `' + g.reasons.join(', ') + '`\n';
    }
    text += '\n🔄 Cycle: `' + brain.cycleCount + '`';
    return _reply(bot.token, bot.chatId, text);
}

async function cmdPrice(bot) {
    _load();
    const snap = _serverState.getSnapshot();
    if (!snap || !snap.price) return _reply(bot.token, bot.chatId, '❌ No price data available.');

    const ind = snap.indicators || {};
    let text = '💰 *BTCUSDT*\n\n';
    text += 'Price: `$' + snap.price.toFixed(2) + '`\n';
    text += 'RSI (4h): `' + (ind.rsi != null ? ind.rsi.toFixed(1) : '?') + '`\n';
    text += 'ADX: `' + (ind.adx != null ? ind.adx.toFixed(1) : '?') + '`\n';
    text += 'MACD: `' + (ind.macdDir || '?') + '` (hist: `' + (ind.macdHist != null ? ind.macdHist.toFixed(0) : '?') + '`)\n';
    text += 'BB: `' + (ind.bbSqueeze ? '🔴 SQUEEZE' : 'Normal') + '` (BW: `' + (ind.bbBandwidth != null ? (ind.bbBandwidth * 100).toFixed(1) + '%' : '?') + '`)\n';
    text += 'FR: `' + (snap.fr != null ? (snap.fr * 10000).toFixed(2) + ' bps' : '?') + '`\n';
    text += 'OI: `' + (snap.oi != null ? snap.oi.toFixed(0) + ' BTC' : '?') + '`\n\n';
    text += 'Regime: `' + (ind.regime || '?') + '` (`' + (ind.regimeConf || 0) + '%`)\n';
    text += 'Trend: `' + (ind.trendBias || '?') + '`\n';
    text += 'Volatility: `' + (ind.volatilityState || '?') + '`\n';
    text += 'Trap Risk: `' + (ind.trapRisk || 0) + '%`\n';
    text += 'Confluence: `' + (ind.confluence || 0) + '` (align: `' + (ind.confluenceAlignment || 0) + '`)';
    return _reply(bot.token, bot.chatId, text);
}

async function cmdRegime(bot) {
    _load();
    const snap = _serverState.getSnapshot();
    if (!snap || !snap.indicators) return _reply(bot.token, bot.chatId, '❌ No data available.');

    const ind = snap.indicators;
    const brain = _serverBrain.getStatus ? _serverBrain.getStatus() : null;

    let text = '🌐 *Market Regime*\n\n';
    text += '📈 Regime: *' + (ind.regime || '?') + '*\n';
    text += '🎯 Confidence: `' + (ind.regimeConf || 0) + '%`\n';
    text += '📊 Trend Bias: `' + (ind.trendBias || '?') + '`\n';
    text += '🌊 Volatility: `' + (ind.volatilityState || '?') + '`\n';
    text += '⚠️ Trap Risk: `' + (ind.trapRisk || 0) + '%`\n';
    text += '💥 Breakout Str: `' + (ind.breakoutStr || 0) + '`\n';
    text += '🕯 Wick Chaos: `' + (ind.wickChaos || 0) + '`\n';

    if (ind.divergence) {
        text += '↗️ Divergence: `' + ind.divergence.type + '` (`' + ind.divergence.conf + '%`)\n';
    }
    if (ind.climax) {
        text += '🔥 Climax: `' + ind.climax + '`\n';
    }

    if (brain && brain.prevRegime) {
        text += '\n📜 Previous: `' + brain.prevRegime + '`';
    }
    return _reply(bot.token, bot.chatId, text);
}

async function cmdShadow(bot) {
    _load();
    // [MULTI-USER] bot.userId always set by _startBot — no fallback
    if (!bot.userId) return _reply(bot.token, bot.chatId, '❌ No user context');
    const uid = bot.userId;
    const state = _serverAT.getFullState ? _serverAT.getFullState(uid) : { mode: '?', stats: _serverAT.getStats(uid), positions: _serverAT.getOpenPositions(uid), demoBalance: { balance: 0, pnl: 0 } };
    const stats = state.stats || _serverAT.getStats(uid);
    const positions = state.positions || _serverAT.getOpenPositions(uid);
    const bal = state.demoBalance || { balance: 0, pnl: 0 };
    const mode = (state.mode || 'demo').toUpperCase();

    let text = '🤖 *AT Engine (' + mode + ')*\n\n';
    text += 'Mode: ' + (mode === 'LIVE' ? '🔴 LIVE' : '🎮 DEMO') + '\n';
    text += 'Balance: `$' + (bal.balance || 0).toFixed(2) + '` (PnL: `$' + (bal.pnl || 0).toFixed(2) + '`)\n';
    text += 'Entries: `' + stats.entries + '` | Exits: `' + stats.exits + '`\n';
    text += 'Open: `' + (stats.openCount || 0) + '`\n';
    text += 'PnL: `$' + (stats.pnl || 0).toFixed(2) + '`\n';
    text += 'Daily PnL: `$' + (stats.dailyPnL || 0).toFixed(2) + '` (Demo: `$' + (stats.dailyPnLDemo || 0).toFixed(2) + '` | Live: `$' + (stats.dailyPnLLive || 0).toFixed(2) + '`)\n';
    text += 'Kill Switch: ' + (stats.killActive ? '🛑 ACTIVE' : '🟢 Off') + '\n';
    text += 'Wins: `' + stats.wins + '` | Losses: `' + stats.losses + '`\n';
    text += 'Win Rate: `' + (stats.winRate || 0).toFixed(1) + '%`\n';

    if (positions && positions.length) {
        const dslStates = stats.dslStates || {};
        text += '\n*Open Positions:*\n';
        for (const p of positions) {
            const dsl = dslStates[String(p.seq)] || p.dsl || {};
            const dslPhase = dsl.phase || 'WAIT';
            const dslSL = dsl.currentSL ? '$' + dsl.currentSL.toFixed(0) : '-';
            const mTag = (p.mode || 'demo') === 'live' ? '🔴' : '🎮';
            text += '• ' + mTag + ' `' + p.side + '` @ `$' + (p.price || 0).toFixed(0) + '`';
            text += ' | SL: `' + dslSL + '` TP: `$' + (p.tp || 0).toFixed(0) + '`';
            text += ' | DSL: `' + dslPhase + '`';
            if (dsl.progress != null) text += ' `' + dsl.progress.toFixed(0) + '%`';
            if (dsl.ttpArmed) text += ' 📈TTP';
            text += '\n';
        }
    }
    return _reply(bot.token, bot.chatId, text);
}

async function cmdPositions(bot) {
    _load();
    // [MULTI-USER] No fallback to user 1
    if (!bot.userId) return _reply(bot.token, bot.chatId, '❌ No user context');
    const positions = _serverAT.getOpenPositions(bot.userId) || [];

    if (!positions.length) {
        return _reply(bot.token, bot.chatId, '📭 No open positions.');
    }

    let text = '📋 *Open Positions*\n';
    for (const p of positions) {
        const age = Math.round((Date.now() - p.ts) / 60000);
        const mTag = (p.mode || 'demo') === 'live' ? '🔴' : '🎮';
        text += '\n' + mTag + ' `' + p.side + '` `' + (p.symbol || '?') + '` @ `$' + (p.price || 0).toFixed(0) + '`';
        text += '\n   SL: `$' + (p.sl || 0).toFixed(0) + '` TP: `$' + (p.tp || 0).toFixed(0) + '`';
        text += ' | ' + age + 'm ago';
        if (p.live && p.live.status === 'LIVE') text += ' | qty: `' + (p.live.executedQty || p.qty || '?') + '`';
        text += '\n';
    }
    return _reply(bot.token, bot.chatId, text);
}

async function cmdPnl(bot) {
    _load();
    // [MULTI-USER] No fallback to user 1
    if (!bot.userId) return _reply(bot.token, bot.chatId, '❌ No user context');
    const uid = bot.userId;
    const stats = _serverAT.getStats(uid);
    const live = _serverAT.getLiveStats(uid);
    const bal = _serverAT.getDemoBalance ? _serverAT.getDemoBalance(uid) : { balance: 0, pnl: 0 };
    const mode = _serverAT.getMode ? _serverAT.getMode(uid) : 'demo';

    let text = '💵 *PnL Summary*\n\n';
    text += 'Mode: ' + (mode === 'live' ? '🔴 LIVE' : '🎮 DEMO') + '\n';
    text += 'Demo Balance: `$' + (bal.balance || 0).toFixed(2) + '` (PnL: `$' + (bal.pnl || 0).toFixed(2) + '`)\n\n';

    text += '*Overall:*\n';
    text += 'PnL: `$' + (stats.pnl || 0).toFixed(2) + '`\n';
    text += 'Trades: `' + stats.entries + '` | W/L: `' + stats.wins + '/' + stats.losses + '`\n';
    text += 'Win Rate: `' + (stats.winRate || 0).toFixed(1) + '%`\n\n';

    text += '*Live Execution:*\n';
    text += 'PnL: `$' + (live.pnl || 0).toFixed(2) + '`\n';
    text += 'Trades: `' + (live.entries || 0) + '` | W/L: `' + (live.wins || 0) + '/' + (live.losses || 0) + '`\n';
    text += 'Win Rate: `' + (live.winRate || 0).toFixed(1) + '%`\n';
    text += 'Blocked: `' + (live.blocked || 0) + '` | Errors: `' + (live.errors || 0) + '`';
    return _reply(bot.token, bot.chatId, text);
}

async function cmdLive(bot) {
    _load();
    // [MULTI-USER] No fallback to user 1
    if (!bot.userId) return _reply(bot.token, bot.chatId, '❌ No user context');
    const stats = _serverAT.getLiveStats(bot.userId);
    const positions = _serverAT.getLivePositions(bot.userId) || [];

    let text = '🔴 *Live Trading*\n\n';
    text += 'Status: ' + (config.tradingEnabled ? '✅ ENABLED' : '🔒 Disabled') + '\n';
    text += 'Entries: `' + (stats.entries || 0) + '` | Exits: `' + (stats.exits || 0) + '`\n';
    text += 'PnL: `$' + (stats.pnl || 0).toFixed(2) + '`\n';
    text += 'Wins: `' + (stats.wins || 0) + '` | Losses: `' + (stats.losses || 0) + '`\n';
    text += 'Win Rate: `' + (stats.winRate || 0).toFixed(1) + '%`\n';
    text += 'Blocked: `' + (stats.blocked || 0) + '` | Errors: `' + (stats.errors || 0) + '`';

    if (positions.length) {
        text += '\n\n*Open:*\n';
        for (const p of positions) {
            text += '• `' + (p.symbol || '?') + '` `' + (p.side || p.positionSide || '?') + '`';
            text += ' qty: `' + (p.positionAmt || p.qty || '?') + '`\n';
        }
    }
    return _reply(bot.token, bot.chatId, text);
}

async function cmdLogs(bot) {
    _load();
    const brain = _serverBrain.getStatus ? _serverBrain.getStatus() : null;
    if (!brain || !brain.recentLog || !brain.recentLog.length) {
        return _reply(bot.token, bot.chatId, '📜 No brain logs yet.');
    }

    const last = brain.recentLog.slice(-8);
    let text = '📜 *Last ' + last.length + ' Brain Decisions*\n\n';
    for (const l of last) {
        const time = new Date(l.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const e = l.extra || {};
        text += '`' + time + '` C' + l.cycle + ': `' + l.type + '`';
        if (e.regime) text += ' ' + e.regime;
        if (e.score != null) text += ' s=' + e.score;
        if (e.confidence != null) text += ' c=' + e.confidence + '%';
        text += '\n';
    }
    return _reply(bot.token, bot.chatId, text);
}

async function cmdKill(bot, args) {
    _load();
    const userId = bot.userId;
    const state = _riskGuard.getDailyState('AT', userId);

    if (args === 'on') {
        _riskGuard.setEmergencyKill(true, userId);
        return _reply(bot.token, bot.chatId, '🛑 *EMERGENCY KILL ACTIVATED*\nAll trading blocked.');
    } else if (args === 'off') {
        _riskGuard.setEmergencyKill(false, userId);
        return _reply(bot.token, bot.chatId, '🟢 *Kill switch deactivated*\nTrading resumed.');
    }

    let text = '🛑 *Emergency Kill Switch*\n\n';
    text += 'Status: ' + (state && state.emergencyKill ? '🔴 *ACTIVE* — all trading blocked' : '🟢 Inactive') + '\n\n';
    text += 'Use `/kill on` to activate\n';
    text += 'Use `/kill off` to deactivate';
    return _reply(bot.token, bot.chatId, text);
}

async function cmdHelp(bot) {
    const text = '🤖 *Zeus Terminal Bot*\n\n' +
        '*Info:*\n' +
        '📊 /status — Server status & flags\n' +
        '🧠 /brain — Last brain decision\n' +
        '💰 /price — BTC price & indicators\n' +
        '🌐 /regime — Market regime details\n' +
        '📜 /logs — Last 8 brain decisions\n\n' +
        '*Trading:*\n' +
        '👻 /shadow — Shadow AT stats\n' +
        '🔴 /live — Live trading stats\n' +
        '📋 /positions — All open positions\n' +
        '💵 /pnl — PnL summary\n' +
        '🛑 /kill — Emergency kill switch\n\n' +
        '❓ /help — This message';
    return _reply(bot.token, bot.chatId, text);
}

const COMMANDS = {
    '/start': (bot) => cmdHelp(bot),
    '/help': (bot) => cmdHelp(bot),
    '/status': cmdStatus,
    '/brain': cmdBrain,
    '/price': cmdPrice,
    '/regime': cmdRegime,
    '/shadow': cmdShadow,
    '/positions': cmdPositions,
    '/pnl': cmdPnl,
    '/live': cmdLive,
    '/logs': cmdLogs,
    '/kill': (bot, args) => cmdKill(bot, args),
};

// ── Per-Bot Polling ──

async function _processUpdate(bot, update) {
    const msg = update.message;
    if (!msg || !msg.text || !msg.chat) return;

    // Security: only respond to the authorized chat for this bot
    if (String(msg.chat.id) !== String(bot.chatId)) {
        console.warn('[TG-BOT] Unauthorized chat for user ' + bot.userId + ':', msg.chat.id);
        return;
    }

    const cmd = msg.text.split(' ')[0].split('@')[0].toLowerCase();
    const args = msg.text.split(' ').slice(1).join(' ').trim();
    const handler = COMMANDS[cmd];
    if (handler) {
        try { await handler(bot, args); }
        catch (e) { console.error('[TG-BOT] Command error (user ' + bot.userId + '):', cmd, e.message); }
    }
}

async function _pollBot(bot) {
    if (!bot.polling) return;
    try {
        const res = await _apiCall(bot.token, 'getUpdates', {
            offset: bot.offset,
            timeout: 30,
            allowed_updates: ['message'],
        });
        if (res.ok && res.result && res.result.length) {
            for (const upd of res.result) {
                bot.offset = upd.update_id + 1;
                await _processUpdate(bot, upd);
            }
        }
    } catch (e) {
        // Backoff on error
        await new Promise(r => setTimeout(r, 5000));
    }
    if (bot.polling) bot.timer = setTimeout(() => _pollBot(bot), 500);
}

function _startBot(userId, token, chatId) {
    if (_bots.has(userId)) return; // already polling
    const bot = { userId, token, chatId, offset: 0, polling: true, timer: null };
    _bots.set(userId, bot);
    console.log('[TG-BOT] Started polling for user ' + userId + ' (chat: ' + chatId + ')');
    _pollBot(bot);
}

function _stopBot(userId) {
    const bot = _bots.get(userId);
    if (!bot) return;
    bot.polling = false;
    if (bot.timer) { clearTimeout(bot.timer); bot.timer = null; }
    _bots.delete(userId);
    console.log('[TG-BOT] Stopped polling for user ' + userId);
}

// ── Load all user bots from DB ──

// [ZT-AUD-#16 / C14] Track per-user decrypt failures so we mark the row broken
// in the DB after a few attempts. Without this, _reloadBots ran every 60s and
// printed the same warning forever, with no surfaced signal to the user.
const _decryptFailCount = new Map();
const _DECRYPT_FAIL_THRESHOLD = 3;

function _reloadBots() {
    try {
        const db = require('./database');
        const { decrypt } = require('./encryption');
        const users = db.getAllTelegramUsers();
        const activeIds = new Set();

        for (const u of users) {
            activeIds.add(u.id);
            if (!_bots.has(u.id)) {
                try {
                    const token = decrypt(u.telegram_bot_token_enc);
                    _decryptFailCount.delete(u.id);
                    _startBot(u.id, token, u.telegram_chat_id);
                } catch (e) {
                    const n = (_decryptFailCount.get(u.id) || 0) + 1;
                    _decryptFailCount.set(u.id, n);
                    console.warn('[TG-BOT] Failed to decrypt token for user ' + u.id + ' (attempt ' + n + '):', e.message);
                    if (n >= _DECRYPT_FAIL_THRESHOLD) {
                        try {
                            db.markTelegramBroken(u.id, e.message);
                            db.auditLog(u.id, 'TELEGRAM_TOKEN_BROKEN', { reason: e.message }, null);
                            console.warn('[TG-BOT] User ' + u.id + ' marked broken — UI must prompt re-add token');
                        } catch (_) { /* */ }
                        _decryptFailCount.delete(u.id);
                    }
                }
            }
        }

        // Also start global admin bot if configured and not from DB
        const gToken = config.telegram.botToken;
        const gChatId = config.telegram.chatId;
        if (gToken && gChatId && !_bots.has('global')) {
            const bot = { userId: 'global', token: gToken, chatId: gChatId, offset: 0, polling: true, timer: null };
            _bots.set('global', bot);
            console.log('[TG-BOT] Started global admin bot (chat: ' + gChatId + ')');
            _pollBot(bot);
        }

        // Stop bots for users who removed their telegram config
        for (const [id] of _bots) {
            if (id !== 'global' && !activeIds.has(id)) {
                _stopBot(id);
            }
        }
    } catch (e) {
        console.warn('[TG-BOT] Reload error:', e.message);
    }
}

// ── Public API ──

function start() {
    if (_running) return;
    _running = true;
    // Initial load (with small delay to let DB initialize)
    setTimeout(() => {
        _reloadBots();
        // Periodically check for new/removed user bots
        _reloadTimer = setInterval(_reloadBots, _RELOAD_INTERVAL);
    }, 3000);
    console.log('[TG-BOT] Multi-user bot manager started');
}

function stop() {
    _running = false;
    if (_reloadTimer) { clearInterval(_reloadTimer); _reloadTimer = null; }
    for (const [id] of _bots) {
        _stopBot(id);
    }
    console.log('[TG-BOT] All bot polling stopped');
}

module.exports = { start, stop };
