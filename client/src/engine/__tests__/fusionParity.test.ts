import { describe, it, expect } from 'vitest'
import { confNDirectional, classifyEntryTier } from '../fusionMath'

// ─────────────────────────────────────────────────────────────────────────────
// Brain fusion PARITY harness (flip-gate, 2026-06-17).
// Goal: prove WHERE the server SP1 mirror `_fuseDecision` and the client fusion
// agree/diverge, across the whole input domain. Runtime capture is impossible
// (post-cutover the client no longer runs computeFusionDecision), so we compare
// the two FORMULAS directly on a dense grid.
//
//  • CLIENT side uses the REAL helpers (confNDirectional, classifyEntryTier)
//    imported from fusionMath.ts; the assembly is transcribed verbatim from
//    client/src/trading/autotrade.ts:599-643.
//  • SERVER side is transcribed verbatim from server/services/serverBrain.js
//    _fuseDecision (lines 1893-1923).
// Both kept tiny + line-referenced so the transcription is auditable.
// ─────────────────────────────────────────────────────────────────────────────

type Inp = { conf: number; ofi: number; probN: number; regimeN: number; liqDangerN: number; sigDirBonus: number }
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const def = (v: number, d: number) => (Number.isFinite(v) ? v : d)

// SERVER: verbatim from serverBrain.js _fuseDecision (1893-1923)
function fuseServer(inp: Inp) {
  const conf = def(inp.conf, 50)
  const confN = clamp((conf - 50) / 50, 0, 1)               // ← direction-AGNOSTIC
  const ofi = def(inp.ofi, 0)
  const ofiN = (ofi + 1) / 2
  const probN = def(inp.probN, 0.5)
  const regimeN = def(inp.regimeN, 0.5)
  const liqDangerN = def(inp.liqDangerN, 0.2)
  const sigDirBonus = def(inp.sigDirBonus, 0)
  let dirScore = 0
  dirScore += ofi * 0.55
  dirScore += ((conf - 50) / 50) * 0.30
  dirScore += sigDirBonus
  dirScore = clamp(dirScore, -1, 1)
  const dir = dirScore > 0.15 ? 'long' : dirScore < -0.15 ? 'short' : 'neutral'
  const alignN = dir === 'neutral' ? 0 : (dir === 'long' ? ofiN : (1 - ofiN))
  let confF = (confN * 0.35) + (probN * 0.25) + (regimeN * 0.20) + (alignN * 0.20)
  confF *= (1 - (liqDangerN * 0.55))
  confF = clamp(confF, 0, 1)
  const confidence = Math.round(confF * 100)
  let decision: string
  if (dir === 'neutral') decision = 'NO_TRADE'
  else if (confidence >= 82 && conf >= 75 && regimeN >= 0.55) decision = 'LARGE'  // ← raw conf bar
  else if (confidence >= 72 && conf >= 68) decision = 'MEDIUM'
  else if (confidence >= 62 && conf >= 60) decision = 'SMALL'
  else decision = 'NO_TRADE'
  return { dir, decision, confidence, score: Math.round(dirScore * confidence) }
}

// CLIENT: verbatim from autotrade.ts:599-643, using the REAL fusionMath helpers
function fuseClient(inp: Inp) {
  const conf = def(inp.conf, 50)
  const ofi = def(inp.ofi, 0)
  const ofiN = (ofi + 1) / 2
  const probN = def(inp.probN, 0.5)
  const regimeN = def(inp.regimeN, 0.5)
  const liqDangerN = def(inp.liqDangerN, 0.2)
  const sigDirBonus = def(inp.sigDirBonus, 0)
  let dirScore = 0
  dirScore += ofi * 0.55
  dirScore += ((conf - 50) / 50) * 0.30
  dirScore += sigDirBonus
  dirScore = clamp(dirScore, -1, 1)
  const dir = dirScore > 0.15 ? 'long' : dirScore < -0.15 ? 'short' : 'neutral'
  const alignN = dir === 'neutral' ? 0 : (dir === 'long' ? ofiN : (1 - ofiN))
  let confF = (confNDirectional(conf, dir) * 0.35) + (probN * 0.25) + (regimeN * 0.20) + (alignN * 0.20)  // ← direction-AWARE
  confF *= (1 - (liqDangerN * 0.55))
  confF = clamp(confF, 0, 1)
  const confidence = Math.round(confF * 100)
  const decision = classifyEntryTier(dir, confidence, conf, regimeN)   // ← direction-AWARE tier
  return { dir, decision, confidence, score: Math.round(dirScore * confidence) }
}

function grid(): Inp[] {
  const out: Inp[] = []
  for (let conf = 0; conf <= 100; conf += 5)
    for (let ofi = -1; ofi <= 1.0001; ofi += 0.2)
      for (const regimeN of [0.35, 0.5, 0.55, 0.75])
        for (const liqDangerN of [0, 0.2, 0.5])
          for (const probN of [0.3, 0.5, 0.7])
            for (const sigDirBonus of [-0.25, 0, 0.25])
              out.push({ conf, ofi: Math.round(ofi * 100) / 100, probN, regimeN, liqDangerN, sigDirBonus })
  return out
}

describe('brain fusion parity: server _fuseDecision vs client fusion', () => {
  const G = grid()

  it('DIRECTION is byte-identical across the whole grid (dirScore formula is shared)', () => {
    const dirMiss = G.filter((v) => fuseServer(v).dir !== fuseClient(v).dir)
    expect(dirMiss.length).toBe(0)
  })

  it('LONG decisions are byte-identical (the short-fix does not touch longs)', () => {
    const longs = G.filter((v) => fuseClient(v).dir === 'long')
    const miss = longs.filter((v) => {
      const s = fuseServer(v), c = fuseClient(v)
      return s.decision !== c.decision || s.confidence !== c.confidence || s.score !== c.score
    })
    expect(longs.length).toBeGreaterThan(0)
    expect(miss.length).toBe(0)
  })

  it('QUANTIFIES the SHORT divergence (server SP1 mirror lacks Lever-C + dir-aware tier)', () => {
    const shorts = G.filter((v) => fuseClient(v).dir === 'short')
    let decDiff = 0, serverNoTrade_clientTrade = 0
    for (const v of shorts) {
      const s = fuseServer(v), c = fuseClient(v)
      if (s.decision !== c.decision) decDiff++
      if (s.decision === 'NO_TRADE' && c.decision !== 'NO_TRADE') serverNoTrade_clientTrade++
    }
    const total = G.length
    const dirMatch = 100 * G.filter((v) => fuseServer(v).dir === fuseClient(v).dir).length / total
    const decMatch = 100 * G.filter((v) => fuseServer(v).decision === fuseClient(v).decision).length / total
    // eslint-disable-next-line no-console
    console.log(`\n[FUSION PARITY] grid=${total} | dir match=${dirMatch.toFixed(1)}% | decision match=${decMatch.toFixed(1)}%`)
    console.log(`[FUSION PARITY] shorts=${shorts.length} | decision diff on shorts=${decDiff} (${(100 * decDiff / shorts.length).toFixed(1)}%) | of which server=NO_TRADE but client=TRADE: ${serverNoTrade_clientTrade}`)
    // the divergence is real and concentrated on shorts (this is the gap to resolve before flip)
    expect(shorts.length).toBeGreaterThan(0)
    expect(decDiff).toBeGreaterThan(0)
  })
})
