// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.6.24',
    build: 9,
    date: '2026-04-18',
    changelog: 'Post-v2 security + correctness batch (build 9 extends build 8). [L1] engine/brain.ts BR.regime fallback escaped via escHtml before reaching BrainCockpit dangerouslySetInnerHTML. [L2] bootstrapError.ts DLog fallback (unknown categories + catch branch) now escapes keys/values/JSON.stringify output. Scope note: bootstrapError.ts lines 180-186 (known categories) use the same raw-concat pattern and are pending L2.1. Previous build 8: [C1] serverAT pos.tp guard, [H1] WS+HTTP JWT tokenVersion bypass via (?? 0) compare, [H1.1] same pattern across 8 admin routes, [H2] RECON_PHANTOM no longer uses _lastPrice fallback.'
};
