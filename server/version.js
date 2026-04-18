// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.9',
    build: 35,
    date: '2026-04-18',
    changelog: 'Post-v2 batch3-S b35 v1.7.9 PIN CONFIRMATION GUARD — fixes app-lock UX hole where tapping DEACTIVATE instantly removed the PIN with no re-auth. Now mirrors banking-app pattern: (1) Server POST /auth/pin/remove requires { pin } in body, bcrypt-compares against stored hash, returns invalid_pin on mismatch — idempotent when no PIN is set. (2) Server POST /auth/pin/set, when a PIN already exists, requires { currentPin } in body before overwriting — prevents shoulder-surfed sessions from silently changing the PIN. (3) Client SettingsHubModal: new Current PIN input row that only renders when PIN is active, reused for both DEACTIVATE and CHANGE flows; label of the New PIN field flips from "PIN (4–8 cifre/litere)" to "New PIN (4–8 cifre/litere)" when PIN is already set. (4) _pinUpdateUI toggles Current PIN row visibility on Security-tab open + after every pinActivate / pinRemove round-trip. (5) Client pinRemove refuses to call the server without a typed current PIN (early-return with inline error + focus back to the input); pinActivate attaches currentPin only when _pinIsSet() is true. Verified Change Password and Change Email flows already use proper email-code confirmation — unchanged. No changes to AT engine, brain, DSL logic, trade execution, biometric unlock, SecurityNudgeModal. APK is the same b34 v1.7.8 release-keystore build; this is a web-only deploy. Previous: batch3-R-hotfix b34 v1.7.8 (APK release keystore for Samsung OneUI 8.0).'
};
