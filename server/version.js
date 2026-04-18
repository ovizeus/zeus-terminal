// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.4',
    build: 30,
    date: '2026-04-18',
    changelog: 'Post-v2 batch3-O b30 v1.7.4 DSL CLOSE + MARGIN — UI-only additions to DSL position cards, reusing canonical close plumbing. (1) Close Position button added to every DSL card with two-step confirm UX (reuses attachConfirmClose from engine/events.ts — same pattern as PositionRows close button): first click shows "\u2715 CLOSE" in red, second click within 2.5s executes; timer expires → reset. Layout: on AT cards with Take Control visible, CLOSE sits left of TAKE CONTROL; on AT cards in user mode, CLOSE sits left of LET AI CONTROL; on Manual cards, CLOSE sits right of DSL PARAMS header. (2) Close execution: calls canonical closeLivePos(id, "MANUAL") for live/testnet positions (which already dispatches /api/at/close to the exchange) or closeDemoPos(id, "MANUAL") for demo — zero reimplementation of close logic, zero new endpoints. Exchange propagation, margin return, PnL tracking, DSL cleanup, kill-switch all handled by the existing pipeline. (3) Margin display added to Row 2 of every DSL card: "Margin: $X · Nx" (USD notional + leverage) alongside Entry/SL/TP/Loss@SL/Profit@TP/LIQ. Reads pos.margin + pos.lev directly from position object — no new fields on data layer. (4) Per-render reattachment of attachConfirmClose because DSL cards regenerate innerHTML every tick; events.ts _pendingClose map survives re-render and the helper auto-restores the pending style if the same posId re-binds mid-confirm. Zero changes to AT engine, brain, DSL logic, or server routes. Previous: batch3-N b29 dock icon refresh + link dots.'
};
