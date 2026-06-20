const { shouldReconcileExchange } = require('../../../../server/services/reconcileFilter');

describe('shouldReconcileExchange', () => {
  it('reconciles binance regardless of bybit flags', () => {
    expect(shouldReconcileExchange('binance', { BYBIT_DRY_RUN_ONLY: true })).toBe(true);
  });
  it('skips bybit while the dry-run latch is on (nothing real to reconcile)', () => {
    expect(shouldReconcileExchange('bybit', { BYBIT_DRY_RUN_ONLY: true })).toBe(false);
  });
  it('reconciles bybit once it goes live (dry-run off)', () => {
    expect(shouldReconcileExchange('bybit', { BYBIT_DRY_RUN_ONLY: false })).toBe(true);
  });
  it('reconciles unknown exchanges by default (fail-open for real ones)', () => {
    expect(shouldReconcileExchange('binance', {})).toBe(true);
    expect(shouldReconcileExchange('bybit', {})).toBe(true);
  });
});
