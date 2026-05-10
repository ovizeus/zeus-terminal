// [S7] Standalone probe — exercises DSL parity shadow flag.
// Tests that the DSL_PARITY_SHADOW_ENABLED flag defaults to false.
// Run: npm test -- --forceExit --silent --testPathPattern probe-s7
'use strict';

const MF = require('../server/migrationFlags');

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { console.log('  ✓ ' + name); pass++; }
    else { console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); fail++; }
}

console.log('=== S7 DSL Parity Shadow Flag Tests ===\n');

console.log('T1 — Flag defaults and property access');
check('DSL_PARITY_SHADOW_ENABLED property exists', typeof MF.DSL_PARITY_SHADOW_ENABLED === 'boolean');
check('DSL_PARITY_SHADOW_ENABLED defaults to false', MF.DSL_PARITY_SHADOW_ENABLED === false);
check('DSL_PARITY_SHADOW_ENABLED is boolean type', typeof MF.DSL_PARITY_SHADOW_ENABLED === 'boolean');

console.log('\n=== Summary ===');
console.log(`  PASS=${pass}  FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
