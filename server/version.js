// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.6.24',
    build: 3,
    date: '2026-04-18',
    changelog: 'QM liq map (BUG5.5.2): binance+bybit liq events now feed QM.liqAgg via a zeus:liq CustomEvent dispatched BEFORE the liqMinUsd threshold in procLiq. Previously only OKX populated the per-exchange QM buffers (the dispatcher side of zeus:liq was never wired), so on a fresh page the map showed mostly dashes until large liqs accumulated in w.S.llvBuckets. buildLiqEstimate now reads QM.liqAgg.{binance,bybit,okx}.btc as primary data with llvBuckets as fallback density. Footer reports "accumulating real liqs — N events so far" when empty, or "N active levels | M events" when populated, so the feed state is visible.'
};
