const fs = require('fs');
const path = require('path');

// [2026-10-14] Pins a finding so it cannot quietly go missing.
//
// Three flags are ON in production and command nothing in either direction —
// switching them off would change no behaviour either:
//
//   ML_HYBRID_POOLING_ENABLED    the pooling code never reads it
//   ML_OVERRIDE_RESOLVER_ENABLED effectiveStatus.js never reads it
//   BYBIT_PARITY_ENABLED         bybitParityShadow.js mentions it in a COMMENT only
//
// That is worse than a dead flag. An operator switching
// ML_OVERRIDE_RESOLVER_ENABLED off believing he disabled the resolver has
// disabled nothing, and a safety switch that does not switch creates false
// confidence. It is the same class as the LIQ and S/R panels removed in
// b267/b268, which advertised controls that did nothing.
//
// This test asserts the CURRENT reality, not the desired one. The decision —
// gate the code, drop the switches, or keep them knowing they are decorative —
// is the operator's, recorded in BOOK_OF_ALL 2026-10-14.
//
// WHEN HE DECIDES: update this test, do not delete it. If he gates the code,
// these assertions flip and the test tells you to revisit the Book entry
// instead of letting the finding evaporate. A Book entry can be forgotten; a
// failing test cannot.

const SERVICES = path.join(__dirname, '..', '..', '..', 'server', 'services');

function readsFlag(file, flag) {
  const src = fs.readFileSync(file, 'utf8');
  // Strip line and block comments: a flag named in prose is not a flag read.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return code.includes(flag);
}

describe('three flags are currently decorative — pinned, not endorsed', () => {
  test('ML_OVERRIDE_RESOLVER_ENABLED is not read by effectiveStatus.js', () => {
    const f = path.join(SERVICES, 'ml', '_ring5', 'effectiveStatus.js');
    expect(fs.existsSync(f)).toBe(true);
    expect(readsFlag(f, 'ML_OVERRIDE_RESOLVER_ENABLED')).toBe(false);
  });

  test('ML_HYBRID_POOLING_ENABLED is not read by the pooling code', () => {
    for (const name of ['pooledEvidence.js', 'banditEvidence.js', 'thompsonSampler.js']) {
      const f = path.join(SERVICES, 'ml', '_ring5', name);
      if (!fs.existsSync(f)) continue;
      expect(readsFlag(f, 'ML_HYBRID_POOLING_ENABLED')).toBe(false);
    }
  });

  test('BYBIT_PARITY_ENABLED is named only in a comment, never read', () => {
    const f = path.join(SERVICES, 'bybitParityShadow.js');
    expect(fs.existsSync(f)).toBe(true);
    const raw = fs.readFileSync(f, 'utf8');
    expect(raw).toContain('BYBIT_PARITY_ENABLED');        // the prose is there
    expect(readsFlag(f, 'BYBIT_PARITY_ENABLED')).toBe(false); // the read is not
  });

  test('the comment-stripping is real, not a vacuous pass', () => {
    // If the stripper were broken, every assertion above would pass for the
    // wrong reason. Prove it keeps code and drops prose.
    const f = path.join(SERVICES, 'ml', '_ring5', 'effectiveStatus.js');
    const src = fs.readFileSync(f, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code.length).toBeGreaterThan(200);        // code survived
    expect(code.length).toBeLessThan(src.length);    // prose was removed
  });
});
