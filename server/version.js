// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.7.8',
    build: 34,
    date: '2026-04-18',
    changelog: 'Post-v2 batch3-R-hotfix b34 v1.7.8 APK RELEASE KEYSTORE — fixes Samsung S25 Ultra install blocked by OneUI 8.0 / Android 16 Auto Blocker. Root cause: prior APK variants (debug + release signed with android SDK debug keystore) were rejected as "pachetul este nevalid" on Samsung flagships running OneUI 8.0, even with Auto Blocker OFF. Samsung Knox now flags debug-signed packages more aggressively than on OneUI 7. Fix: generated a proper release keystore (android/app/zeus-release.keystore, CN=Zeus Terminal, RSA 2048, 10000-day validity, SHA1 5635987450e4e128aa37967c6fc1b3c054586f00), built app-release via gradlew assembleRelease, zipaligned, and signed with apksigner v2-only (v1/v3/v4 disabled — same scheme as the known-good v1.7.2 deployment). Resulting APK (7.07 MB, versionCode 34, versionName 1.7.8) installs cleanly on Samsung OneUI 8. BREAKING INSTALL PATH: signer certificate changed (debug → release DN), so every device must uninstall any prior Zeus build before updating; signature mismatch blocks update-in-place. No app-layer code changed from batch3-R b33: biometric unlock, SecurityNudgeModal, PIN sessionStorage fix all carry forward unchanged. Previous: batch3-R b33 v1.7.7 (biometric + nudge), batch3-Q b32 v1.7.6 (PIN gate rebuild).'
};
