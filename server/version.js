// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.6.24',
    build: 6,
    date: '2026-04-18',
    changelog: 'Alerts sound (BUG7): the "Sound Notifications" button in AlertsModal flipped a dead w.S.soundOn flag — no audio path respected it, so tones played (or stayed muted) independent of the button. Now delegates to _soundBadgeClick, the same handler the Brain #soundBadge uses (init-on-first-click + toggle + chime + localStorage zt:sound_muted persist). New _syncSndIcon() paints the icon from isSoundMuted() and AlertsModal force-syncs on open via useEffect, so the button no longer lies when the master was flipped elsewhere.'
};
