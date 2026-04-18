// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.6.24',
    build: 8,
    date: '2026-04-18',
    changelog: 'Post-v2 security + correctness batch. [C1] serverAT.onPriceUpdate now guards pos.tp before HIT_TP — manual entries without TP no longer auto-close on the first tick (JS coerced null>=price to price>=0). [H1] WS + HTTP session auth: legacy JWTs without tokenVersion claim could bypass password-change force-logout and status check; rewrote to (?? 0) compare on both sides. [H1.1] Same pattern fixed across 8 admin routes in auth.js. [H2] RECON_PHANTOM no longer fabricates exit price from pos._lastPrice; explicit priority realExitPrice>0 -> bpos.markPrice>0 -> pos.price with estimatedClose audit flag + telegram alert for manual reconciliation.'
};
