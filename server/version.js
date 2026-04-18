// Zeus Terminal — App Version
// Update this file on each deploy
'use strict';

module.exports = {
    version: '1.6.24',
    build: 7,
    date: '2026-04-18',
    changelog: 'Sound sync (BUG7.1): _updateAudioBadge now paints BOTH #soundBadge (Brain cockpit) AND #snd (AlertsModal) from the same _soundMuted + _audioReady snapshot, so flipping one keeps the other in sync. Previously BUG7 wired the toggle path (Alerts-side click updated both via _syncSndIcon) but the reverse path (Brain-side click) only updated #soundBadge, leaving the Alerts button stale.'
};
