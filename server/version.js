// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.6.24',
    build: 10,
    date: '2026-04-18',
    changelog: 'Post-v2 security batch build 10 — finalizes XSS hardening. [L2.1] bootstrapError.ts lines 181-187 (known categories at_block/at_entry/at_gate/confluence/regime/fusion/kill_switch) now escape all d.* fields (sym/side/reasons/reason/score/regime/tier/conf/size/confidence/trendBias/decision/dir/action) via escHtml before innerHTML concat. Previous builds 8-9: [C1] pos.tp guard, [H1]+[H1.1] JWT tokenVersion bypass via (?? 0), [H2] RECON_PHANTOM no _lastPrice, [L1]+[L2] escHtml on BR.regime fallback and DLog unknown/catch branches.'
};
