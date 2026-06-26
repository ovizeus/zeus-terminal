#!/usr/bin/env node
'use strict';
// [S9 2026-06-26] Reflection block-rate over the brain_decisions log. The soak
// metric for S9.2 — target 10-20% of trade-attempts blocked by reflection.
// Among decisions that WANTED to trade (final_action != 'no_trade'), how many did
// reflection block (blocked_reflection / blocked_reflection_penalty)?
const db = require('../server/services/database');
const days = parseInt(process.argv[2], 10) || 7;
const sinceMs = Date.now() - days * 86400000;

// ts is stored as ms epoch in brain_decisions
const rows = db.db.prepare('SELECT final_action, COUNT(*) n FROM brain_decisions WHERE ts >= ? GROUP BY final_action').all(sinceMs);
let attempts = 0, blocked = 0;
const dist = {};
for (const r of rows) {
    const a = r.final_action || '(null)';
    dist[a] = r.n;
    if (a !== 'no_trade' && a !== '(null)') attempts += r.n;          // reached the trade path
    if (a === 'blocked_reflection' || a === 'blocked_reflection_penalty') blocked += r.n;
}
const pct = attempts ? (blocked / attempts * 100) : 0;
console.log(`\nReflection block rate (last ${days}d):`);
console.log(`  blocked by reflection: ${blocked}`);
console.log(`  trade-attempts (non no_trade): ${attempts}`);
console.log(`  RATE: ${pct.toFixed(1)}%   (S9 target: 10-20%)`);
console.log('\n  final_action distribution:');
for (const [a, n] of Object.entries(dist).sort((x, y) => y[1] - x[1])) console.log(`    ${a}: ${n}`);
process.exit(0);
