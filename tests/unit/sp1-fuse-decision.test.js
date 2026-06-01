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
});
