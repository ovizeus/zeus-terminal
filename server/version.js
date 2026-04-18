// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.3',
    build: 29,
    date: '2026-04-18',
    changelog: 'Post-v2 batch3-N b29 v1.7.3 DOCK LINK DOTS — UI-only sibling-icon refresh for AutoTrade/Manual in Zeus dock + visual bond hint toward DSL. (1) AutoTrade glyph: replaced stacked-cards metaphor (read as layers, not automation) with a lightning bolt inside a thin ring — reads as instant/auto engine. (2) Manual Trade glyph: replaced house-with-roof (looked like letter A) with a raised index finger (pointing hand) — clean "you press" metaphor. (3) New .zd-link-dot element rendered absolute on .zd-icon: when AT has open positions, a synchronized pulsing green dot appears on both AutoTrade AND DSL icons; when Manual has open positions, an amber pulsing dot appears on both Manual AND DSL. Both dots pulse on the same CSS keyframe (zdLinkPulse 1.6s) so the heartbeat is synchronous → viewer instantly reads "these two are bonded via live positions". If both AT and Manual have positions, DSL shows two dots (green top-right, amber bottom-right). Detection reads TP.livePositions/demoPositions filtered by pos.autoTrade on the zeus:positionsChanged + zeus:atStateChanged events — zero polling, zero impact on trading engine. prefers-reduced-motion disables the pulse. No AT/brain/DSL/server logic touched. Previous: batch3-M b28 widget visual redesign.'
};
