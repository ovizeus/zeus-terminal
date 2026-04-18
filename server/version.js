// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.6',
    build: 32,
    date: '2026-04-18',
    changelog: 'Post-v2 batch3-Q b32 v1.7.6 PIN GATE REBUILD — critical fix: PIN prompt never appeared on app entry. Root cause: the legacy div#pinLockScreen markup was never ported to the React tree, so _pinCheckLock() called document.getElementById(\'pinLockScreen\') → always null → silent no-op. The batch3-P in-memory flag was logically correct but orthogonal to the real bug (no DOM = nothing to show). Fixes: (1) new <PinLockScreen /> React component (client/src/components/modals/PinLockScreen.tsx) rendered inside zeus-app, driven by usePinLockStore (Zustand). _pinCheckLock now flips the store flag; pinUnlock() imports are direct, no window.pinUnlock bridge needed. (2) Unlock storage switched from in-memory (batch3-P) back to sessionStorage key \'zeus_pin_unlocked\': survives refresh within the tab/WebView session (user requirement: "nu vreau ca la orice refresh sa imi ceara pin"), but dies on tab close / Android app kill because the WebView process is torn down — so full exit + relaunch still re-prompts. Legacy TTL-in-localStorage key (zeus_pin_unlocked_until) is wiped on module load. (3) PIN lock strings translated to English per UI-language policy. Biometric/fingerprint auth deferred to batch3-R (needs Capacitor plugin + APK rebuild). Zero changes to AT engine, brain, DSL logic, trade execution, server auth routes. Previous: batch3-P b31 PIN harden attempt (superseded).'
};
