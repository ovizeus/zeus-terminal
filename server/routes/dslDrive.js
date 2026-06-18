// server/routes/dslDrive.js — read-only ML-DSL shadow state for the OMEGA "DSL Drive" box.
// Auth: sessionAuth is applied globally at /api/* in server.js, so req.user.id is set here.
// Read-only: no mutation paths. Surfaces the per-user open positions joined with the
// latest shadow proposal recorded by the serverAT ML-DSL shadow hook.
'use strict';
const express = require('express');
const router = express.Router();
const mlDslShadow = require('../services/mlDslShadow');
const serverAT = require('../services/serverAT');
const { db } = require('../services/database');

router.get('/state', (req, res) => {
  try {
    const uid = req.user && req.user.id;
    const proposals = mlDslShadow.snapshot();
    const open = (uid && serverAT.getOpenPositions ? serverAT.getOpenPositions(uid) : []) || [];
    const rows = open.map((p) => ({
      seq: p.seq, symbol: p.symbol, side: p.side,
      exchange: p.exchange || null, mode: p.mode || null,
      entry: p.price, sl: p.sl,
      ml: proposals[String(p.seq)] || null,
      dsl: p.dsl ? {
        phase: p.dsl.phase, active: !!p.dsl.active,
        progress: Number(p.dsl.progress) || 0,
        activationPrice: p.dsl.activationPrice, currentSL: p.dsl.currentSL,
      } : null,
    }));
    res.json({ ok: true, mode: 'SHADOW', positions: rows, ts: Date.now() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/scoreboard', (req, res) => {
  try {
    const uid = req.user && req.user.id;
    const row = uid ? db.prepare(
      `SELECT COUNT(*) n, AVG(advantage) avgAdv, SUM(CASE WHEN win=1 THEN 1 ELSE 0 END) wins,
              AVG(ml_pnl_pct) avgMl, AVG(baseline_pnl_pct) avgBase
       FROM ml_dsl_outcome WHERE user_id=? AND ts > ?`).get(uid, Date.now() - 21 * 86400000) : null;
    res.json({
      ok: true,
      trades: row ? row.n : 0,
      avgAdvantage: row && row.avgAdv != null ? +row.avgAdv.toFixed(3) : 0,
      winRate: row && row.n ? +(100 * row.wins / row.n).toFixed(1) : 0,
      avgMlPnlPct: row && row.avgMl != null ? +row.avgMl.toFixed(3) : 0,
      avgBaselinePnlPct: row && row.avgBase != null ? +row.avgBase.toFixed(3) : 0,
      ts: Date.now(),
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
