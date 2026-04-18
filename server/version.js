// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.5',
    build: 31,
    date: '2026-04-18',
    changelog: 'Post-v2 batch3-P b31 v1.7.5 PIN HARDEN + DOT BOOT + ANDROID PULSE — 3 UI/security bug fixes from live feedback. (1) PIN now required on every relaunch and refresh. Prior behaviour (M12) stored pinUnlocked in localStorage with a 4h TTL so a crash/close within 4h silently skipped the PIN prompt — failed its security purpose, and on Capacitor WebView the key survived app kill. Replaced localStorage/sessionStorage backing with in-memory flag only: any full page reload, tab close, or Android app kill-and-reopen clears the unlock and re-prompts PIN. Module-load side-effect wipes legacy keys (zeus_pin_unlocked_until, zeus_pin_unlocked) to prevent silent-unlock carry-over from older client bundles. (2) Link dots (AT/Manual ↔ DSL) now detect positions immediately on boot. Prior hook only reacted to zeus:positionsChanged / zeus:atStateChanged events, which fire ~2-3s after mount (Phase 3 server sync @ ~1500ms + first event @ ~2-3s). Added a 12s boot catch-up poll (setInterval 250ms × 48 ticks) that recomputes until positions are detected, then self-cancels. Event listeners still the primary path — poll is a boot-only safety net. (3) Link dot pulse now works on Android APK. Prior @media (prefers-reduced-motion: reduce) rule froze dots solid on any Android device with system-wide "Remove animations" accessibility setting (or OEMs that force it for battery: Samsung, Xiaomi). Removed the media query for .zd-link-dot — these 7px indicators are vital trading-state signals, not decorative motion, and overriding the accessibility preference is acceptable for this specific use. Zero changes to AT engine, brain, DSL logic, trade execution, server routes. Previous: batch3-O b30 DSL close button + margin display.'
};
