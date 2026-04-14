// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.6.23',
    build: 55,
    date: '2026-04-14',
    changelog: 'Brain mode persistence + DSL IV% final fix: (1) Brain mode (ASSIST/AUTO) now survives page refresh — _applyModeSwitch pushes to server via _usScheduleSave and _usApply restores S.mode from USER_SETTINGS.bmMode on boot (including radio-button state). Previously the save path existed but the apply path was missing so mode always reset to assist after F5. (2) Removed the residual IV>PR cross-field clamp inside _dslSanitizeParams on the client — it was re-running every DSL tick and silently rewriting pos.dslParams.impulseVPct back above pivotRightPct, undoing any user IV edit. Server-side serverDSL already dropped this clamp (DSL-SEMANTIC-FIX comment); client is now aligned so user-entered IV% survives ticks, Let AI Control, and page refresh.'
};
