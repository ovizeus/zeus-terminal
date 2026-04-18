// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.1',
    build: 27,
    date: '2026-04-18',
    changelog: 'Post-v2 batch3-L b27 v1.7.1 WIDGET+SESSION FIX — Android APK rebuild. Two bugs fixed: (1) Widget showed "Can\'t load" gray placeholder — root cause: android:letterSpacing attribute not in RemoteViews whitelist → InflateException crash. Stripped letterSpacing from all 3 layouts (widget_small/medium/large), replaced deprecated singleLine with maxLines=1. (2) Moving widget showed "App isn\'t installed" — root cause: click root used Intent.ACTION_VIEW with https://zeus-terminal.com URL + CATEGORY_BROWSABLE; if no default browser, Android routes to Play Store. Changed to getLaunchIntentForPackage(packageName) with FLAG_ACTIVITY_NEW_TASK|CLEAR_TOP so tap opens Zeus app directly. Also fixed zeus_widget_info.xml: removed invalid combo widgetFeatures="reconfigurable" + empty configure="" (reconfigurable requires a config activity). (3) Bonus session persistence: MainActivity.onCreate now calls CookieManager.setAcceptCookie(true) + setAcceptThirdPartyCookies for webview, and onPause/onStop flush() the cookie store — fixes JWT being dropped on app exit (user had to re-login every relaunch). Zero logic changes to AT/brain/DSL/server — pure native Android fixes. Previous: batch3-K b26 initial widget V3 Combo.'
};
