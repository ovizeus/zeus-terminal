const brain = require('../../server/services/serverBrain');
const fuse = brain.__sp1.fuseDecision;

describe('SP1 _fuseDecision (pure fusion math)', () => {
  test('neutral when dirScore within ±0.15 → NO_TRADE', () => {
    const r = fuse({ conf: 50, ofi: 0, probN: 0.5, regimeN: 0.5, liqDangerN: 0.2, sigDirBonus: 0 });
    expect(r.dir).toBe('neutral');
    expect(r.decision).toBe('NO_TRADE');
  });

  test('strong long inputs → long + a non-NO_TRADE tier', () => {
    const r = fuse({ conf: 90, ofi: 0.9, probN: 0.8, regimeN: 0.75, liqDangerN: 0, sigDirBonus: 0 });
    expect(r.dir).toBe('long');
    expect(['SMALL', 'MEDIUM', 'LARGE']).toContain(r.decision);
  });

  test('sigDirBonus shifts direction (client parity input)', () => {
    const base = fuse({ conf: 55, ofi: 0.1, probN: 0.5, regimeN: 0.55, liqDangerN: 0.2, sigDirBonus: 0 });
    const boosted = fuse({ conf: 55, ofi: 0.1, probN: 0.5, regimeN: 0.55, liqDangerN: 0.2, sigDirBonus: 0.25 });
    expect(base.dir).toBe('neutral');
    expect(boosted.dir).toBe('long');
  });

  // ───────────────────────────────────────────────────────────────────────
  // [DIRSCORE-CALIBRATION 2026-06-12] The server computes an indicator
  // direction consensus (RSI+SuperTrend+MACD+funding+OI → bullDirs/bearDirs)
  // but _fuseDecision discarded it (sigDirBonus hardcoded 0) and instead
  // misused the direction-AGNOSTIC confluence magnitude as a pseudo-direction.
  // Result: a strong bullish indicator consensus was suffocated by a mild
  // opposing OFI (the 65% direction-parity gap vs the client momentum brain).
  // Calibration: feed the real `dirConsensus` ∈ [-1,1], make OFI a confirm/veto
  // (not the sole driver), and stop treating confluence strength as direction.
  // ───────────────────────────────────────────────────────────────────────
  test('strong bullish indicator consensus is NOT suffocated by a mild opposing OFI', () => {
    // The canonical divergence: client says long (MACD↑ ST↑ ADX), server saw
    // OFI:-5% and went neutral. With the consensus fed in, server agrees → long.
    const r = fuse({ conf: 70, ofi: -0.05, dirConsensus: 0.6, probN: 0.5, regimeN: 0.75, liqDangerN: 0.2, sigDirBonus: 0 });
    expect(r.dir).toBe('long');
  });

  test('a STRONG opposing OFI still vetoes a bullish consensus (order-flow risk-awareness preserved)', () => {
    // The server's edge: heavy sell-flow against the consensus → stand aside.
    const r = fuse({ conf: 70, ofi: -0.6, dirConsensus: 0.6, probN: 0.5, regimeN: 0.75, liqDangerN: 0.2, sigDirBonus: 0 });
    expect(r.dir).toBe('neutral');
  });

  test('high confluence STRENGTH alone (no consensus, no flow) does NOT imply direction', () => {
    // confluence.score is direction-agnostic strength; it must not push long by
    // itself (latent bug: a strong BEARISH setup scored as long).
    const r = fuse({ conf: 90, ofi: 0, dirConsensus: 0, probN: 0.5, regimeN: 0.75, liqDangerN: 0.2, sigDirBonus: 0 });
    expect(r.dir).toBe('neutral');
  });
});
