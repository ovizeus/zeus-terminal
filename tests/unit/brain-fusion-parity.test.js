// [BRAIN PARITY PROOF 2026-06-18] Deterministic, reproducible proof of the exact gap
// between the SERVER fusion (_fuseDecision) and the CLIENT fusion (computeFusionDecision).
//
// Memory said the "parity gap" is an artifact + the only real drifts are (a) confNDirectional
// on shorts and (b) the direction-aware entry tier (dirConf) on shorts. This test PROVES that
// deterministically: it ports the client's EXACT pure math (confNDirectional + classifyEntryTier
// from client/src/engine/fusionMath.ts, copied verbatim) and compares it to the server's live
// _fuseDecision across a grid of inputs. Result:
//   • LONG + NEUTRAL inputs  → server === client, bit-identical (parity already holds).
//   • SHORT inputs           → diverge ONLY in confidence + tier, ONLY via the 2 known diffs;
//                              dir + dirScore stay identical (the direction formula matches).
//   • clientFuse (the mirror) → defines exactly what the server must compute to be a true mirror.
const brain = require('../../server/services/serverBrain');
const serverFuse = brain.__sp1.fuseDecision;

// ── client pure math, copied verbatim from client/src/engine/fusionMath.ts ──
function confNDirectional(confluence, dir) {
  const signed = dir === 'long' ? (confluence - 50) / 50 : dir === 'short' ? (50 - confluence) / 50 : 0;
  return Math.max(0, Math.min(1, signed));
}
function classifyEntryTier(dir, confidence, confluence, regimeN) {
  if (dir !== 'long' && dir !== 'short') return 'NO_TRADE';
  const dirConf = dir === 'long' ? confluence : 100 - confluence;
  if (confidence >= 82 && dirConf >= 75 && regimeN >= 0.55) return 'LARGE';
  if (confidence >= 72 && dirConf >= 68) return 'MEDIUM';
  if (confidence >= 62 && dirConf >= 60) return 'SMALL';
  return 'NO_TRADE';
}
// ── client computeFusionDecision math (steps 7-9), as a pure fn over the same scalars ──
function clientFuse(inp) {
  const n = (v, d) => (Number.isFinite(v) ? v : d);
  const conf = n(inp.conf, 50), ofi = n(inp.ofi, 0), probN = n(inp.probN, 0.5),
    regimeN = n(inp.regimeN, 0.5), liqDangerN = n(inp.liqDangerN, 0.2), sigDirBonus = n(inp.sigDirBonus, 0);
  const ofiN = (ofi + 1) / 2;
  let dirScore = ofi * 0.55 + ((conf - 50) / 50) * 0.30 + sigDirBonus;
  dirScore = Math.max(-1, Math.min(1, dirScore));
  const dir = dirScore > 0.15 ? 'long' : dirScore < -0.15 ? 'short' : 'neutral';
  const alignN = dir === 'neutral' ? 0 : (dir === 'long' ? ofiN : (1 - ofiN));
  let confF = confNDirectional(conf, dir) * 0.35 + probN * 0.25 + regimeN * 0.20 + alignN * 0.20;
  confF *= (1 - liqDangerN * 0.55);
  confF = Math.max(0, Math.min(1, confF));
  const confidence = Math.round(confF * 100);
  const decision = classifyEntryTier(dir, confidence, conf, regimeN);
  return { dir, decision, confidence, score: Math.round(dirScore * confidence), dirScore };
}

// grid of inputs spanning long / short / neutral
function grid() {
  const out = [];
  const confs = [10, 20, 30, 40, 50, 60, 70, 80, 90];
  const ofis = [-0.9, -0.5, -0.2, 0, 0.2, 0.5, 0.9];
  const sigs = [-0.25, 0, 0.25];
  for (const conf of confs) for (const ofi of ofis) for (const sigDirBonus of sigs) {
    out.push({ conf, ofi, probN: 0.6, regimeN: 0.75, liqDangerN: 0.1, sigDirBonus });
  }
  return out;
}

describe('BRAIN fusion parity: server _fuseDecision vs client computeFusionDecision', () => {
  const vecs = grid();

  test('direction formula is identical for EVERY input (dir + dirScore bit-identical)', () => {
    const bad = [];
    for (const v of vecs) {
      const s = serverFuse(v), c = clientFuse(v);
      if (s.dir !== c.dir || Math.abs(s.dirScore - c.dirScore) > 1e-9) bad.push({ v, s, c });
    }
    expect(bad).toEqual([]); // dir is already a true mirror
  });

  test('LONG: server === client bit-identical (parity already holds for longs)', () => {
    const bad = [];
    for (const v of vecs) {
      const c = clientFuse(v);
      if (c.dir !== 'long') continue;
      const s = serverFuse(v);
      if (s.dir !== c.dir || s.decision !== c.decision || s.confidence !== c.confidence || s.score !== c.score) bad.push({ v, s, c });
    }
    expect(bad).toEqual([]); // confNDirectional('long')===confN and dirConf===conf for longs
  });

  test('NEUTRAL: dir + decision match (both NO_TRADE); confidence is irrelevant (no trade)', () => {
    const bad = [];
    for (const v of vecs) {
      const c = clientFuse(v);
      if (c.dir !== 'neutral') continue;
      const s = serverFuse(v);
      if (s.dir !== 'neutral' || s.decision !== 'NO_TRADE' || c.decision !== 'NO_TRADE') bad.push({ v, s, c });
    }
    expect(bad).toEqual([]);
  });

  test('SHORT: gap CLOSED — server === client bit-identical after the direction-aware fix', () => {
    // [2026-06-18] _fuseDecision now uses confNDirectional + dirConf, so shorts mirror the
    // client too. Pre-fix this diverged (68 shorts, up to 27 confidence pts, 23 tier flips);
    // post-fix it is bit-identical. This test now GUARDS the parity (regression tripwire).
    let shorts = 0;
    const bad = [];
    for (const v of vecs) {
      const c = clientFuse(v);
      if (c.dir !== 'short') continue;
      shorts++;
      const s = serverFuse(v);
      if (s.dir !== c.dir || s.decision !== c.decision || s.confidence !== c.confidence || s.score !== c.score) {
        bad.push({ conf: v.conf, ofi: v.ofi, srv: `${s.decision}/${s.confidence}`, cli: `${c.decision}/${c.confidence}` });
      }
    }
    if (bad.length) console.error('SHORT parity regressions:', JSON.stringify(bad.slice(0, 10), null, 1));
    expect(shorts).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  test('FULL PARITY: server _fuseDecision === client for ALL inputs (long+short+neutral decision)', () => {
    const bad = [];
    for (const v of vecs) {
      const c = clientFuse(v), s = serverFuse(v);
      // neutral → both NO_TRADE (confidence irrelevant on no-trade); else strict bit-identical.
      if (c.dir === 'neutral') { if (s.dir !== 'neutral' || s.decision !== 'NO_TRADE') bad.push({ v }); continue; }
      if (s.dir !== c.dir || s.decision !== c.decision || s.confidence !== c.confidence || s.score !== c.score) bad.push({ v, s, c });
    }
    expect(bad).toEqual([]); // server shadow is now a true direction-aware mirror of the client
  });
});
