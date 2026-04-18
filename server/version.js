// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.6.24',
    build: 4,
    date: '2026-04-18',
    changelog: 'QM liq map (BUG5.5.3): 24h rolling buffer now persists in localStorage (zt:qmLiq:v1). QM.liqAgg.{binance,bybit,okx}.btc and w.S.llvBuckets are snapshotted at init, every 10s thereafter, and force-flushed on beforeunload/pagehide/destroy — so refreshing the tab or closing the panel no longer wipes accumulated liquidation history. On hydrate, events older than 24h are filtered; llvBuckets merges with any events WS pushed during script parse so nothing is lost on fast reconnect. User-initiated localStorage.clear() (Header / Settings reset) still wipes as expected.'
};
