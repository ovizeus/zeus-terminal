// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.10',
    build: 36,
    date: '2026-04-18',
    changelog: 'Post-v2 batch3-T b36 v1.7.10 NUDGE/WELCOME Z-ORDER FIX — first-launch stacking bug where the SecurityNudgeModal ("ACTIVATE PIN OR FINGERPRINT") overlapped the Welcome Commander modal because Welcome opens at boot+2.5s and the nudge opened at boot+4s unconditionally. Fix: SecurityNudgeModal now polls for #mwelcome visibility after its initial 4s delay and only calls setVisible(true) when the Welcome modal is closed. Safety cap of 30s absolute max wait so the nudge cannot be indefinitely starved if the user leaves Welcome open. Poll interval 500ms; all timers cleaned up in the cleanup callback (cancelled flag + clearTimeout). No logic change to the underlying conditions that decide whether to show the nudge (still native-only, still suppressed by localStorage snooze key + PIN-set + biometric-enabled). Zero changes to PIN confirmation guard (batch3-S), biometric plugin, AT engine, brain, DSL, trade execution, auth routes. Previous: batch3-S b35 v1.7.9 (PIN confirmation guard), batch3-R-hotfix b34 v1.7.8 (APK release keystore).'
};
