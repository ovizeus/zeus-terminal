// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.2',
    build: 28,
    date: '2026-04-18',
    changelog: 'Post-v2 batch3-M b28 v1.7.2 WIDGET REDESIGN — Android APK rebuild. Visual/responsive overhaul per user feedback. Root causes: (a) RemoteViews has no CSS clamp/media queries — responsive scaling requires android:autoSizeTextType="uniform" with min/max bounds per TextView; (b) gold palette (#f0c040) replaced everywhere with neon green (#22e27a) + red (#ff4d6d) for bearish; (c) safe padding on root bumped (small 10dp, medium 12dp, large 14dp) so card breathes inside container. New elements: LIVE/DEMO pill (widget_pill_live/demo drawables) top-right on all 3 sizes — color-coded (green=LIVE, blue=DEMO) with border + semi-tint bg. Large layout: added dedicated OPEN count column + brain score reformatted "Brain X · N". Medium: positions now "N pos" + AT ON/OFF badge (green tint when on). Small: now shows LIVE pill + refresh even at 2x1. Every numeric TextView has autoSizeMin/MaxTextSize so prices/balance shrink gracefully when widget is resized down instead of clipping. widget_bg.xml switched to dark-green gradient (#0a1510 → #0d1d16) with 20dp corners + green stroke. widget_divider.xml now semi-transparent green. Stale indicator split from status, now red "· stale" only when >15min old. Priority order preserved (symbol > price > change > AT). Zero logic changes to AT/brain/DSL/server. Previous: batch3-L b27 widget+session bug fixes (letterSpacing crash, app-not-installed intent, JWT cookie flush).'
};
