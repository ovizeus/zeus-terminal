#!/usr/bin/env bash
# ML-DSL real-measurement (cohort='mlctl') morning snapshot.
# Read-only. Appends to data/logs/mlctl-check.log. Wrapper keeps the crontab %-free
# (an unescaped % in crontab is a newline → truncates the command; see soak-track-cron.sh).
set -o pipefail
cd /opt/zeus-terminal || exit 1
LOG=/opt/zeus-terminal/data/logs/mlctl-check.log
NODE=/usr/local/bin/node
{
  echo "===== MLCTL CHECK $(date '+%Y-%m-%d %H:%M') ====="
  "$NODE" -e '
    const db = require("better-sqlite3")("data/zeus.db", { readonly: true });
    const now = Date.now();
    // mlctl cohort: count + per-arm breakdown + aggregate R:R ml-vs-baseline
    const mc = db.prepare("SELECT arm, ml_pnl_pct, baseline_pnl_pct, advantage, ts FROM ml_dsl_outcome WHERE cohort=\x27mlctl\x27 ORDER BY ts").all();
    console.log("mlctl rows: " + mc.length + (mc.length ? (" | last " + Math.round((now - mc[mc.length-1].ts)/60000) + "min ago") : ""));
    const byArm = {};
    for (const r of mc) { const a = (r.arm||"ml:HOLD").replace(/^ml:/,""); const b = byArm[a]||(byArm[a]={n:0,adv:0,wins:0}); b.n++; b.adv+=(r.advantage||0); if((r.advantage||0)>0) b.wins++; }
    for (const a in byArm) { const b=byArm[a]; console.log("  " + a + ": n=" + b.n + " avgAdv=" + (b.adv/b.n).toFixed(3) + " WR=" + Math.round(100*b.wins/b.n) + "%"); }
    try {
      const rr = require("./server/services/dslRrSim");
      if (mc.length) {
        const s = rr._rrStats(mc.map(r=>r.ml_pnl_pct)), bs = rr._rrStats(mc.map(r=>r.baseline_pnl_pct));
        console.log("  AGG R:R ml=" + s.rr.toFixed(2) + " vs base=" + bs.rr.toFixed(2) + " | expDelta=" + (s.expectancy-bs.expectancy).toFixed(3) + " | avgLoss ml=" + s.avgLoss.toFixed(3) + " base=" + bs.avgLoss.toFixed(3));
      }
    } catch (e) { console.log("  rrStats err: " + e.message); }
    // turnover: positions CREATED in last 24h (real ts) — watchlist-widening effect
    const created = db.prepare("SELECT COUNT(DISTINCT position_seq) c FROM position_events WHERE event_type=\x27CREATED\x27 AND ts >= ?").get(now - 86400000).c;
    console.log("positions CREATED last 24h: " + created + " (was ~5 pre-widening)");
    db.close();
  '
  echo "rate-ban (418/429) last 24h in pm2-out.log:"
  grep -cE "418|429" data/logs/pm2-out.log 2>/dev/null | sed "s/^/  count=/"
} >> "$LOG" 2>&1
