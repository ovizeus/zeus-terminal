// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.6.24',
    build: 1,
    date: '2026-04-18',
    changelog: 'QM cluster (BUG5.3/5.4/5.5): (1) QuantMonitor shipped in the main bundle instead of a code-split chunk — eliminates the dynamic chunk 404 class caused by stale Service Workers. (2) Paint isolation on #qm-screen (contain:layout paint style + translateZ + willChange:contents + removed redundant parent textShadow + vignette alpha 0.03→0.015) kills the whole-screen green "flashlight flash" during the 500ms innerHTML swap. (3) Liquidation map switched from synthetic bracket-MMR model (OI × weight × price) to real 24h-rolling aggregation from Binance+Bybit (w.S.llvBuckets via forceOrder@arr) + OKX (QM.liqAgg.okx via liquidation-orders WS). Display extended from 60 to 102 levels across 3 resolution zones — 0.25% near price, 0.5% mid, 1% far — with variable-window bucket summing. Sub-1% distance column shows 2 decimals.'
};
