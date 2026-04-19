// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.12',
    build: 38,
    date: '2026-04-18',
    changelog: 'Post-v2 batch3-V b38 v1.7.12 DEMO→LIVE SWITCH BUG FIX — connecting a valid Binance testnet API did not let the user exit demo mode. Root cause: (1) serverAT.preLiveChecklist NO_OPEN_POSITIONS check counted ALL open positions including demo, so any open demo position blocked the switch, and (2) serverAT.setMode cross-mode gate rejected when positions existed in EITHER old or new mode, not just new. Both contradicted the confirm-dialog contract ("Existing demo positions will remain demo and continue independently"). Fix: preLiveChecklist now only blocks when positions in the NEW mode (live) exist; setMode cross-mode gate now only rejects when new-mode positions already exist. Per-position mode field remains authoritative — demo positions continue under demo logic and live positions under live logic regardless of engine-mode flips. No change to credential gating, kill-switch gate, balance/connectivity checks, or to per-position monitoring. Previous: batch3-U b37 v1.7.11 (Brain/DSL/AT mode propagation), batch3-T b36 v1.7.10 (nudge/welcome z-order).'
};
