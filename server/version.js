// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.0',
    build: 26,
    date: '2026-04-18',
    changelog: 'Post-v2 batch3-K b26 v1.7.0 WIDGET — Android home-screen widget V3 Combo. Resizable widget with 3 auto-switched layouts: small (2x1 BTC-only), medium (2x2 BTC+portfolio), large (4x2 BTC+ETH+portfolio+brain). onAppWidgetOptionsChanged reads minWidth/minHeight to pick layout. Native Java: ZeusWidgetProvider (BTC/ETH from Binance public API, portfolio from SharedPreferences, click root opens zeus-terminal.com, click refresh icon triggers re-render), ZeusWidgetPlugin @CapacitorPlugin exposing updateSnapshot() to webview. Client: new widgetSync.ts module gates on Capacitor.isNativePlatform, builds snapshot from AT/TP/BM globals, pushes to plugin every 30s + on zeus:atStateChanged + on visibility change. Zeus palette styling (gold header, dark gradient bg, green/red PnL). Registered in MainActivity.onCreate + AndroidManifest receiver + zeus_widget_info.xml (resizeMode horizontal|vertical, updatePeriodMillis 30min). APK built on VPS (JDK21 + Android SDK 36) and published at /download/zeus-terminal.apk (8.4MB debug). server.js: .apk Content-Type + Content-Disposition attachment. Zero logic changes to AT/brain/DSL — widget is additive observation-only surface. Previous: batch3-J b25 welcome snooze pill active-state pulse. batch3-I b24 welcome snooze manual gate. batch3-H b23 AT/brain/DSL 11-fix audit. batch3-G b22 cache-proof z-index settings modals.'
};
