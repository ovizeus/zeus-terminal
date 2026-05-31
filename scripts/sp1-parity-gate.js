// [SP1] Usage: node scripts/sp1-parity-gate.js [windowDays]
// Reports the SP1 direction-parity gate status for uid=1 over the window.
// Exit 0 = gate pass, 1 = gate fail (or error).
const db = require('../server/services/database');
const { evaluateParityGate, SP1_THRESHOLDS } = require('../server/services/parityGate');

const days = Number(process.argv[2]) || SP1_THRESHOLDS.M;
const since = Date.now() - days * 24 * 3600 * 1000;
const report = db.queryParityReport({ userId: 1, since });
const gate = evaluateParityGate(report);

console.log(JSON.stringify({
    windowDays: days,
    sustainedTargetDays: SP1_THRESHOLDS.M,
    gate,
    totals: report.totals,
}, null, 2));
process.exit(gate.pass ? 0 : 1);
