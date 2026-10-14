const fs = require('fs');
const path = require('path');

// [2026-10-14] Catches the class of bug that took the longest to see tonight:
// a module with passing tests that NOTHING in production calls.
//
// ml/_ring5/pooledEvidence.js implements Cornercase A partial pooling, has its
// own suite in tests/unit/ml/pooledEvidence.test.js, has a table and a
// migration — and has zero callers. That is why ml_pooled_evidence is empty,
// and why turning ML_HYBRID_POOLING_ENABLED on changed nothing. The flag was a
// red herring; the module is simply never loaded.
//
// Its tests pass. They prove the functions are correct, not that anyone calls
// them. That is vacuous coverage, and it is indistinguishable from working
// code on any dashboard.
//
// This test fails when a NEW orphan appears. The existing one is listed as
// known debt rather than left to break the suite, because wiring or deleting
// it is the operator's call, not something to force at 21:30.

const DIR = path.join(__dirname, '..', '..', '..', 'server', 'services', 'ml', '_ring5');
const SERVER = path.join(__dirname, '..', '..', '..', 'server');

// Known orphan, awaiting a decision: wire it into the Ring5 cycle beside
// banditEvidence, or delete it with its tests. Recorded in BOOK_OF_ALL
// 2026-10-14. Remove from this list once it is resolved — do NOT add to it
// without recording why.
const KNOWN_ORPHANS = ['pooledEvidence'];

function productionFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) productionFiles(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

describe('no orphaned Ring5 modules', () => {
  const modules = fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.replace(/\.js$/, ''));
  const files = productionFiles(SERVER);

  test('the directory is actually being scanned (guard against a vacuous pass)', () => {
    expect(modules.length).toBeGreaterThan(5);
    expect(files.length).toBeGreaterThan(50);
  });

  test.each(modules)('%s is required by production code', (mod) => {
    const needle = new RegExp(`(_ring5/${mod}|['"]\\./${mod}['"])`);
    const callers = files.filter((f) => {
      if (path.basename(f) === `${mod}.js`) return false;
      return needle.test(fs.readFileSync(f, 'utf8'));
    });
    if (KNOWN_ORPHANS.includes(mod)) {
      // Pinned as debt: if someone wires it, this flips and the list must be
      // updated — the test tells you, instead of the debt going quiet.
      expect(callers.length).toBe(0);
      return;
    }
    expect(callers.length).toBeGreaterThan(0);
  });

  test('the known-orphan list has not grown silently', () => {
    expect(KNOWN_ORPHANS).toEqual(['pooledEvidence']);
  });
});
