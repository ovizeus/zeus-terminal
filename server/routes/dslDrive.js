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
       FROM ml_dsl_outcome WHERE user_id=? AND ts > ? AND (cohort IS NULL OR cohort NOT IN ('lossside','mlctl'))`).get(uid, Date.now() - 21 * 86400000) : null;

    // [2026-06-19] Smart loss-side cut (SHADOW) R:R block + cumulative-advantage sparkline.
    let lossSide = { n: 0 };
    if (uid) {
      const dslRrSim = require('../services/dslRrSim');
      const ls = db.prepare(
        `SELECT ml_pnl_pct, baseline_pnl_pct, advantage FROM ml_dsl_outcome
         WHERE user_id=? AND cohort='lossside' ORDER BY ts ASC`).all(uid);
      if (ls.length) {
        const smart = dslRrSim._rrStats(ls.map(r => r.ml_pnl_pct));
        const base = dslRrSim._rrStats(ls.map(r => r.baseline_pnl_pct));
        let cum = 0; const series = ls.map(r => (cum += (r.advantage || 0)));
        const step = Math.max(1, Math.ceil(series.length / 60));
        lossSide = {
          n: ls.length,
          rr: +smart.rr.toFixed(2), rrBaseline: +base.rr.toFixed(2),
          expDelta: +(smart.expectancy - base.expectancy).toFixed(3),
          avgLossSmart: +smart.avgLoss.toFixed(3), avgLossBaseline: +base.avgLoss.toFixed(3),
          wrSmart: +(smart.wr * 100).toFixed(0), wrBaseline: +(base.wr * 100).toFixed(0),
          cumAdvantage: +cum.toFixed(3),
          spark: series.filter((_, i) => i % step === 0),
        };
      }
    }

    // [2026-06-23] ML-CONTROL (real measurement): the ML driving the DSL pivots in real-time
    // (simulateMlPath over the actual per-tick proposals) vs the static baseline preset. This is
    // the truthful "is the ML good at controlling DSL" scoreboard, with a per-action breakdown.
    let mlControl = { n: 0 };
    if (uid) {
      const dslRrSim = require('../services/dslRrSim');
      const mc = db.prepare(
        `SELECT arm, ml_pnl_pct, baseline_pnl_pct, advantage FROM ml_dsl_outcome
         WHERE user_id=? AND cohort='mlctl' ORDER BY ts ASC`).all(uid);
      if (mc.length) {
        const smart = dslRrSim._rrStats(mc.map(r => r.ml_pnl_pct));
        const base = dslRrSim._rrStats(mc.map(r => r.baseline_pnl_pct));
        let cum = 0; const series = mc.map(r => (cum += (r.advantage || 0)));
        const step = Math.max(1, Math.ceil(series.length / 60));
        // Per-action breakdown (which ML action profile actually wins).
        const byAction = {};
        for (const r of mc) {
          const a = (r.arm || 'ml:HOLD').replace(/^ml:/, '');
          const b = byAction[a] || (byAction[a] = { n: 0, sumAdv: 0, wins: 0 });
          b.n++; b.sumAdv += (r.advantage || 0); if ((r.advantage || 0) > 0) b.wins++;
        }
        for (const a in byAction) {
          const b = byAction[a];
          b.avgAdvantage = +(b.sumAdv / b.n).toFixed(3); b.winRate = +(100 * b.wins / b.n).toFixed(0);
          delete b.sumAdv; delete b.wins;
        }
        mlControl = {
          n: mc.length,
          rr: +smart.rr.toFixed(2), rrBaseline: +base.rr.toFixed(2),
          avgMlPnlPct: +smart.expectancy.toFixed(3), avgBaselinePnlPct: +base.expectancy.toFixed(3),
          expDelta: +(smart.expectancy - base.expectancy).toFixed(3),
          avgLossMl: +smart.avgLoss.toFixed(3), avgLossBaseline: +base.avgLoss.toFixed(3),
          wrMl: +(smart.wr * 100).toFixed(0), wrBaseline: +(base.wr * 100).toFixed(0),
          cumAdvantage: +cum.toFixed(3),
          spark: series.filter((_, i) => i % step === 0),
          byAction,
        };
      }
    }

    res.json({
      ok: true,
      trades: row ? row.n : 0,
      avgAdvantage: row && row.avgAdv != null ? +row.avgAdv.toFixed(3) : 0,
      winRate: row && row.n ? +(100 * row.wins / row.n).toFixed(1) : 0,
      avgMlPnlPct: row && row.avgMl != null ? +row.avgMl.toFixed(3) : 0,
      avgBaselinePnlPct: row && row.avgBase != null ? +row.avgBase.toFixed(3) : 0,
      lossSide,
      mlControl,
      ts: Date.now(),
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
