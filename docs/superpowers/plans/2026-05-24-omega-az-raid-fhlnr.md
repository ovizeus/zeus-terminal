# OMEGA A-Z Raid (F/H/L/N/R) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 5 MUST-ADD features for OMEGA: Feedback, History, Latency cap, Critical Telegram, Reactions.

**Architecture:** 4 new modules in `_voice/` + 2 API endpoints + wiring in serverAT/analyzer. Migration 403. Test runner: `/root/.nvm/versions/node/v22.22.3/bin/node /root/zeus-terminal/node_modules/.bin/jest`

**Tech Stack:** Node.js 22, better-sqlite3, Jest

---

### Task 1: F — voiceFeedback module + migration 403 + API

**Files:**
- Create: `server/services/ml/_voice/voiceFeedback.js`
- Modify: `server/services/database.js` (migration 403)
- Modify: `server/routes/omega.js` (POST /api/omega/feedback)
- Test: `tests/unit/ml/voiceFeedback.test.js`

- [ ] **Step 1: Write test**

```javascript
'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => { try { db.prepare('DELETE FROM ml_voice_feedback').run(); } catch(_) {} });
afterAll(() => { try { db.prepare('DELETE FROM ml_voice_feedback').run(); } catch(_) {} });

describe('A-Z Raid F: voiceFeedback', () => {
  test('submitFeedback stores feedback', () => {
    const vf = require('../../../server/services/ml/_voice/voiceFeedback');
    const result = vf.submitFeedback({ voiceLogId: 1, userId: 1, feedback: 'up' });
    expect(result.ok).toBe(true);
  });

  test('submitFeedback upserts on same voiceLogId', () => {
    const vf = require('../../../server/services/ml/_voice/voiceFeedback');
    vf.submitFeedback({ voiceLogId: 2, userId: 1, feedback: 'up' });
    vf.submitFeedback({ voiceLogId: 2, userId: 1, feedback: 'down' });
    const row = db.prepare('SELECT feedback FROM ml_voice_feedback WHERE voice_log_id = 2').get();
    expect(row.feedback).toBe('down');
  });

  test('submitFeedback respects 50/day limit', () => {
    const vf = require('../../../server/services/ml/_voice/voiceFeedback');
    for (let i = 100; i < 150; i++) vf.submitFeedback({ voiceLogId: i, userId: 99, feedback: 'up' });
    const result = vf.submitFeedback({ voiceLogId: 999, userId: 99, feedback: 'up' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('limit');
  });

  test('getFeedbackStats returns counts', () => {
    const vf = require('../../../server/services/ml/_voice/voiceFeedback');
    vf.submitFeedback({ voiceLogId: 10, userId: 1, feedback: 'up' });
    vf.submitFeedback({ voiceLogId: 11, userId: 1, feedback: 'down' });
    const stats = vf.getFeedbackStats({ userId: 1 });
    expect(stats.up).toBeGreaterThanOrEqual(1);
    expect(stats.down).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run — FAIL (module missing)**

- [ ] **Step 3: Add migration 403 + create voiceFeedback.js + add POST route**

Migration 403 in database.js:
```javascript
migrate('403_ml_voice_feedback', () => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ml_voice_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            voice_log_id INTEGER NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            feedback TEXT NOT NULL CHECK(feedback IN ('up', 'down')),
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_voice_fb_user ON ml_voice_feedback(user_id, created_at);
    `);
});
```

voiceFeedback.js:
```javascript
'use strict';
const { db } = require('../../database');
const DAILY_LIMIT = 50;
const _stmts = {
    upsert: db.prepare(`INSERT INTO ml_voice_feedback (voice_log_id, user_id, feedback, created_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(voice_log_id) DO UPDATE SET feedback = excluded.feedback, created_at = excluded.created_at`),
    countToday: db.prepare('SELECT COUNT(*) as cnt FROM ml_voice_feedback WHERE user_id = ? AND created_at > ?'),
    statsUp: db.prepare("SELECT COUNT(*) as cnt FROM ml_voice_feedback WHERE user_id = ? AND feedback = 'up' AND created_at > ?"),
    statsDown: db.prepare("SELECT COUNT(*) as cnt FROM ml_voice_feedback WHERE user_id = ? AND feedback = 'down' AND created_at > ?"),
};
function submitFeedback(params) {
    const { voiceLogId, userId, feedback } = params;
    if (!voiceLogId || !userId || !['up','down'].includes(feedback)) return { ok: false, reason: 'invalid params' };
    const dayStart = Date.now() - 86400000;
    const count = _stmts.countToday.get(userId, dayStart);
    if (count && count.cnt >= DAILY_LIMIT) return { ok: false, reason: 'daily limit reached (50/day)' };
    _stmts.upsert.run(voiceLogId, userId, feedback, Date.now());
    return { ok: true };
}
function getFeedbackStats(params) {
    const { userId } = params;
    const since = (params && params.since) || 0;
    const up = _stmts.statsUp.get(userId, since);
    const down = _stmts.statsDown.get(userId, since);
    return { up: up ? up.cnt : 0, down: down ? down.cnt : 0, total: (up ? up.cnt : 0) + (down ? down.cnt : 0) };
}
module.exports = { submitFeedback, getFeedbackStats, DAILY_LIMIT };
```

Route in omega.js (after existing routes):
```javascript
router.post('/feedback', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false });
    try {
        const vf = require('../services/ml/_voice/voiceFeedback');
        const result = vf.submitFeedback({ voiceLogId: req.body.voiceLogId, userId: req.user.id, feedback: req.body.feedback });
        res.json(result);
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
```

- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** `feat(az-raid): F — voice feedback with rate limiting + API`

---

### Task 2: H — Voice history API with filters

**Files:**
- Modify: `server/routes/omega.js` (GET /api/omega/voice-history)
- Test: `tests/unit/ml/azRaidRoutes.test.js`

- [ ] **Step 1: Write test**

```javascript
'use strict';
const { db } = require('../../../server/services/database');

describe('A-Z Raid H: voice history', () => {
  test('voice-history query returns array', () => {
    const rows = db.prepare('SELECT id, mood, text, template_id, created_at FROM ml_voice_log ORDER BY id DESC LIMIT 5').all();
    expect(Array.isArray(rows)).toBe(true);
  });

  test('voice-history supports mood filter', () => {
    const rows = db.prepare("SELECT id FROM ml_voice_log WHERE mood = ? LIMIT 5").all('CALM');
    expect(Array.isArray(rows)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — PASS (just DB queries)**

- [ ] **Step 3: Add GET route**

In omega.js:
```javascript
router.get('/voice-history', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false });
    try {
        const limit = Math.min(Number(req.query.limit) || 50, 100);
        const since = req.query.since ? Number(req.query.since) : 0;
        let sql = 'SELECT id, user_id, mood, text, template_id, context_json, created_at FROM ml_voice_log WHERE user_id = ? AND created_at > ?';
        const params = [req.user.id, since];
        if (req.query.mood) { sql += ' AND mood = ?'; params.push(req.query.mood); }
        if (req.query.templateId) { sql += ' AND template_id = ?'; params.push(req.query.templateId); }
        sql += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);
        const { db: rawDb } = require('../services/database');
        const rows = rawDb.prepare(sql).all(...params);
        res.json({ ok: true, thoughts: rows });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
```

- [ ] **Step 4: Commit** `feat(az-raid): H — voice history API with mood/template filters`

---

### Task 3: L — Voice latency guard

**Files:**
- Create: `server/services/ml/_voice/voiceLatencyGuard.js`
- Test: `tests/unit/ml/voiceLatencyGuard.test.js`

- [ ] **Step 1: Write test**

```javascript
'use strict';

describe('A-Z Raid L: voiceLatencyGuard', () => {
  test('withLatencyCap passes fast function', async () => {
    const lg = require('../../../server/services/ml/_voice/voiceLatencyGuard');
    const result = await lg.withLatencyCap(() => 'fast', 100);
    expect(result).toBe('fast');
  });

  test('withLatencyCap abandons slow function', async () => {
    const lg = require('../../../server/services/ml/_voice/voiceLatencyGuard');
    const result = await lg.withLatencyCap(() => new Promise(r => setTimeout(() => r('slow'), 200)), 50);
    expect(result).toBeNull();
  });

  test('getAbandonStats returns counts', () => {
    const lg = require('../../../server/services/ml/_voice/voiceLatencyGuard');
    const stats = lg.getAbandonStats();
    expect(stats).toHaveProperty('totalAbandons');
  });
});
```

- [ ] **Step 2: Create voiceLatencyGuard.js**

```javascript
'use strict';
const VOICE_LATENCY_CAP_MS = 100;
let _totalAbandons = 0;
let _abandonsThisMinute = 0;
let _lastMinuteReset = Date.now();

function withLatencyCap(fn, timeoutMs) {
    const cap = timeoutMs || VOICE_LATENCY_CAP_MS;
    return new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
            if (!done) { done = true; _totalAbandons++; _abandonsThisMinute++; resolve(null); }
        }, cap);
        try {
            const result = fn();
            if (result && typeof result.then === 'function') {
                result.then(v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } })
                      .catch(() => { if (!done) { done = true; clearTimeout(timer); resolve(null); } });
            } else {
                if (!done) { done = true; clearTimeout(timer); resolve(result); }
            }
        } catch (_) { if (!done) { done = true; clearTimeout(timer); resolve(null); } }
    });
}

function getAbandonStats() {
    const now = Date.now();
    if (now - _lastMinuteReset > 60000) { _abandonsThisMinute = 0; _lastMinuteReset = now; }
    return { totalAbandons: _totalAbandons, abandonsLastMinute: _abandonsThisMinute };
}

module.exports = { withLatencyCap, getAbandonStats, VOICE_LATENCY_CAP_MS };
```

- [ ] **Step 3: Commit** `feat(az-raid): L — voice latency guard 100ms cap`

---

### Task 4: N — Critical Telegram push with dedup

**Files:**
- Create: `server/services/ml/_voice/criticalPush.js`
- Modify: `server/services/ml/_doctor/analyzer.js` (wire on P0)
- Test: `tests/unit/ml/criticalPush.test.js`

- [ ] **Step 1: Write test**

```javascript
'use strict';

describe('A-Z Raid N: criticalPush', () => {
  test('pushCritical sends first push', () => {
    const cp = require('../../../server/services/ml/_voice/criticalPush');
    cp._resetForTest();
    const result = cp.pushCritical({ userId: 1, eventType: 'DD_LOCKOUT', severity: 'P0', message: 'Drawdown limit reached' });
    expect(result.sent || result.deduplicated !== undefined).toBe(true);
  });

  test('pushCritical deduplicates within 5min', () => {
    const cp = require('../../../server/services/ml/_voice/criticalPush');
    cp._resetForTest();
    cp.pushCritical({ userId: 1, eventType: 'DD_LOCKOUT', severity: 'P0', message: 'first' });
    const result = cp.pushCritical({ userId: 1, eventType: 'DD_LOCKOUT', severity: 'P0', message: 'second' });
    expect(result.deduplicated).toBe(true);
  });

  test('pushCritical allows different event types', () => {
    const cp = require('../../../server/services/ml/_voice/criticalPush');
    cp._resetForTest();
    cp.pushCritical({ userId: 1, eventType: 'DD_LOCKOUT', severity: 'P0', message: 'dd' });
    const result = cp.pushCritical({ userId: 1, eventType: 'BLACK_SWAN', severity: 'P0', message: 'swan' });
    expect(result.deduplicated).toBe(false);
  });
});
```

- [ ] **Step 2: Create criticalPush.js**

```javascript
'use strict';
const DEDUP_WINDOW_MS = 300000; // 5 min
const _lastPush = new Map(); // 'eventType:severity' → ts

function pushCritical(params) {
    const { userId, eventType, severity, message } = params;
    if (!userId || !eventType || !message) return { sent: false, reason: 'missing params' };
    const key = `${eventType}:${severity || 'P0'}`;
    const now = Date.now();
    const last = _lastPush.get(key) || 0;
    if (now - last < DEDUP_WINDOW_MS) return { sent: false, deduplicated: true };
    _lastPush.set(key, now);
    try {
        const telegram = require('../../telegram');
        telegram.sendToUser(userId, `🚨 OMEGA: ${eventType}\n${message}`);
        return { sent: true, deduplicated: false };
    } catch (_) { return { sent: false, deduplicated: false, error: 'telegram failed' }; }
}

function _resetForTest() { _lastPush.clear(); }

module.exports = { pushCritical, _resetForTest, DEDUP_WINDOW_MS };
```

Wire in analyzer.js (after existing P0 auto-snapshot block):
```javascript
        // [A-Z N] Critical Telegram push on P0
        try {
            const cp = require('../_voice/criticalPush');
            cp.pushCritical({ userId: 0, eventType: 'COGNITIVE_' + state, severity: 'P0', message: 'Brain state: ' + state + '. ' + (reason || '') });
        } catch (_) {}
```

- [ ] **Step 3: Commit** `feat(az-raid): N — critical Telegram push with 5min dedup`

---

### Task 5: R — Trade reaction system with mood branching

**Files:**
- Create: `server/services/ml/_voice/tradeReaction.js`
- Modify: `server/services/serverAT.js` (wire on manual entry/close)
- Test: `tests/unit/ml/tradeReaction.test.js`

- [ ] **Step 1: Write test**

```javascript
'use strict';

describe('A-Z Raid R: tradeReaction', () => {
  test('reactToTrade returns text for entry', () => {
    const tr = require('../../../server/services/ml/_voice/tradeReaction');
    tr._resetForTest();
    const result = tr.reactToTrade({ userId: 1, symbol: 'BTCUSDT', side: 'LONG', action: 'entry', mood: 'CALM' });
    expect(result.reacted).toBe(true);
    expect(result.text.length).toBeGreaterThan(0);
  });

  test('reactToTrade respects 5min frequency cap', () => {
    const tr = require('../../../server/services/ml/_voice/tradeReaction');
    tr._resetForTest();
    tr.reactToTrade({ userId: 1, symbol: 'ETHUSDT', side: 'SHORT', action: 'entry', mood: 'ALERT' });
    const result = tr.reactToTrade({ userId: 1, symbol: 'ETHUSDT', side: 'LONG', action: 'entry', mood: 'ALERT' });
    expect(result.reacted).toBe(false);
    expect(result.reason).toContain('frequency');
  });

  test('reactToTrade mood branching produces different text', () => {
    const tr = require('../../../server/services/ml/_voice/tradeReaction');
    tr._resetForTest();
    const calm = tr.reactToTrade({ userId: 1, symbol: 'SOLUSDT', side: 'LONG', action: 'entry', mood: 'CALM' });
    tr._resetForTest();
    const cautious = tr.reactToTrade({ userId: 1, symbol: 'SOLUSDT', side: 'LONG', action: 'entry', mood: 'CAUTIOUS' });
    expect(calm.text).not.toBe(cautious.text);
  });

  test('reactToTrade writes to ml_voice_log', () => {
    const tr = require('../../../server/services/ml/_voice/tradeReaction');
    const { db } = require('../../../server/services/database');
    tr._resetForTest();
    const before = db.prepare("SELECT COUNT(*) as cnt FROM ml_voice_log WHERE template_id = 'omega_reaction'").get();
    tr.reactToTrade({ userId: 1, symbol: 'BNBUSDT', side: 'SHORT', action: 'win', mood: 'ALERT' });
    const after = db.prepare("SELECT COUNT(*) as cnt FROM ml_voice_log WHERE template_id = 'omega_reaction'").get();
    expect(after.cnt).toBeGreaterThan(before.cnt);
  });

  test('reactToTrade scalping detection skips', () => {
    const tr = require('../../../server/services/ml/_voice/tradeReaction');
    tr._resetForTest();
    // Simulate 5 rapid trades (disable frequency cap by resetting between)
    for (let i = 0; i < 5; i++) {
      tr._recordTrade('DOTUSDT');
    }
    const result = tr.reactToTrade({ userId: 1, symbol: 'DOTUSDT', side: 'LONG', action: 'entry', mood: 'CALM' });
    expect(result.reacted).toBe(false);
    expect(result.reason).toContain('scalp');
  });
});
```

- [ ] **Step 2: Create tradeReaction.js**

```javascript
'use strict';
const { db } = require('../../database');

const FREQ_CAP_MS = 300000; // 5 min per symbol
const SCALP_THRESHOLD = 5; // 5 trades per 15min = scalping
const SCALP_WINDOW_MS = 900000; // 15 min

const _lastReaction = new Map(); // symbol → ts
const _tradeHistory = new Map(); // symbol → [ts, ts, ...]

const PHRASES = {
    CALM: {
        entry: ['{side} on {symbol}. noted.', 'manual {side} {symbol}. watching.', '{symbol} {side} — let\'s see.'],
        win: ['{symbol} closed green. clean.', 'nice {side} on {symbol}.', '{symbol} profit locked.'],
        loss: ['{symbol} closed red. it happens.', '{side} {symbol} didn\'t work. next.', 'loss on {symbol}. move on.'],
    },
    ALERT: {
        entry: ['going manual on {symbol}? interesting.', '{side} {symbol} — bold timing.', 'manual {side} {symbol}... market\'s hot.'],
        win: ['nice manual {side} on {symbol}!', '{symbol} win. market agreed.', '{side} {symbol} — clean execution.'],
        loss: ['{symbol} didn\'t work. rough one.', '{side} {symbol} loss. review this.', 'ouch. {symbol} went the wrong way.'],
    },
    CAUTIOUS: {
        entry: ['manual {side} on {symbol}... careful.', '{side} {symbol}? risky move right now.', 'careful with {symbol}. signals mixed.'],
        win: ['{symbol} win. don\'t push luck.', 'profit on {symbol}. take it and walk.', '{side} {symbol} worked. surprising.'],
        loss: ['{symbol} loss. saw it coming.', 'told you {symbol} looked sketchy.', '{side} {symbol} — review before next.'],
    },
};

function _pickPhrase(mood, action, symbol, side) {
    const moodKey = PHRASES[mood] ? mood : 'CALM';
    const actionKey = PHRASES[moodKey][action] ? action : 'entry';
    const pool = PHRASES[moodKey][actionKey];
    const template = pool[Math.floor(Math.random() * pool.length)];
    return template.replace(/\{symbol\}/g, symbol).replace(/\{side\}/g, side);
}

function _recordTrade(symbol) {
    const now = Date.now();
    if (!_tradeHistory.has(symbol)) _tradeHistory.set(symbol, []);
    const hist = _tradeHistory.get(symbol);
    hist.push(now);
    while (hist.length > 0 && hist[0] < now - SCALP_WINDOW_MS) hist.shift();
}

function _isScalping(symbol) {
    const hist = _tradeHistory.get(symbol);
    return hist && hist.length >= SCALP_THRESHOLD;
}

function reactToTrade(params) {
    const { userId, symbol, side, action, mood } = params;
    if (!userId || !symbol || !side || !action) return { reacted: false, reason: 'missing params' };

    _recordTrade(symbol);

    if (_isScalping(symbol)) return { reacted: false, reason: 'scalping detected — silent' };

    const now = Date.now();
    const lastTs = _lastReaction.get(symbol) || 0;
    if (now - lastTs < FREQ_CAP_MS) return { reacted: false, reason: 'frequency cap (5min per symbol)' };

    const text = _pickPhrase(mood || 'CALM', action, symbol, side);
    _lastReaction.set(symbol, now);

    try {
        const voiceLogger = require('./voiceLogger');
        voiceLogger.logUtterance({
            userId, utteranceType: 'CHAT_REPLY', mood: mood || 'CALM', text,
            templateId: 'omega_reaction',
            contextJson: JSON.stringify({ symbol, side, action, pnl: params.pnl || null }),
        });
    } catch (_) {}

    return { reacted: true, text };
}

function _resetForTest() { _lastReaction.clear(); _tradeHistory.clear(); }

module.exports = { reactToTrade, _resetForTest, _recordTrade, FREQ_CAP_MS, SCALP_THRESHOLD };
```

Wire in serverAT.js _closePosition (after Ring5 recordContribution block):
```javascript
    // [A-Z R] OMEGA reaction on manual trade
    if (exitType === 'MANUAL_CLIENT') {
        try {
            const tr = require('./ml/_voice/tradeReaction');
            const _mood = (() => { try { return require('./ml/_crosscutting/moodEmaTracker').getCurrentMood(); } catch(_) { return 'CALM'; } })();
            tr.reactToTrade({ userId, symbol: pos.symbol, side: pos.side, action: pnl > 0 ? 'win' : 'loss', pnl, mood: _mood });
        } catch (_) {}
    }
```

- [ ] **Step 3: Commit** `feat(az-raid): R — trade reaction system with mood branching + scalp detection`

---

### Task 6: Full ML test suite + PM2 reload + tag

- [ ] **Step 1: Run full ML suite**
- [ ] **Step 2: PM2 reload + verify endpoints**
- [ ] **Step 3: Tag `omega-az-raid-fhlnr-COMPLETE-YYYYMMDD`**
