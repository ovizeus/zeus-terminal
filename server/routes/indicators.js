// Indicator usage telemetry — never touches brain/trading/signals. Stores each user's currently
// active indicator set; serves an aggregate live-usage count per indicator for the picker.
'use strict';
const express = require('express');
const router = express.Router();
const db = require('../services/database').db;
const { INDICATOR_IDS } = require('../services/indicatorIds');

// Pure: count distinct users per known indicator id. Unknown ids are ignored. NO liveness
// window — each user's row IS their persisted config (replaced on every report), so the badge
// mirrors EVERY user who has a stored indicator config, regardless of how recently they were
// online. Returns { id: count } omitting zero-count ids. `now` kept for signature stability.
function _aggregateUsage(rows, now, knownIds) {
  const seen = {}; // id -> Set(user_id)
  for (const r of rows || []) {
    if (!knownIds.has(r.indicator_id)) continue;
    (seen[r.indicator_id] = seen[r.indicator_id] || new Set()).add(r.user_id);
  }
  const out = {};
  for (const id of Object.keys(seen)) out[id] = seen[id].size;
  return out;
}

let _cache = { ts: 0, data: null };

// Client reports its currently-active indicator ids; we replace this user's rows.
router.post('/active', (req, res) => {
  try {
    const uid = req.user && req.user.id;
    if (!uid) return res.status(401).json({ ok: false });
    const active = Array.isArray(req.body && req.body.active) ? req.body.active : [];
    const now = Date.now();
    const valid = active.filter((id) => typeof id === 'string' && INDICATOR_IDS.has(id));
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM indicator_usage WHERE user_id=?').run(uid);
      const ins = db.prepare('INSERT OR REPLACE INTO indicator_usage (user_id,indicator_id,updated_at) VALUES (?,?,?)');
      for (const id of valid) ins.run(uid, id, now);
    });
    tx();
    _cache = { ts: 0, data: null }; // invalidate
    res.json({ ok: true, n: valid.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Aggregate live usage counts (cached 60s).
router.get('/usage', (req, res) => {
  try {
    const now = Date.now();
    if (_cache.data && now - _cache.ts < 60000) return res.json({ ok: true, usage: _cache.data });
    const rows = db.prepare('SELECT user_id, indicator_id, updated_at FROM indicator_usage').all();
    const usage = _aggregateUsage(rows, now, INDICATOR_IDS);
    _cache = { ts: now, data: usage };
    res.json({ ok: true, usage });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
module.exports._aggregateUsage = _aggregateUsage;
