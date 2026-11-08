'use strict';

/**
 * [2026-11-08] Whose thought is it?
 *
 * The brain's per-user loop wrote every user's "scanning" thought under
 * userId: 1, with the code saying so itself — "uses uid=1 (admin) as default
 * carrier for now". Until today that loop held ONE user, so nobody noticed.
 * Fixing the restore put eight users in it, which made the admin's thought
 * stream the dumping ground for everyone else's scanning while those accounts
 * got none of their own.
 *
 * Decided by the operator with the volume trade-off in front of him: write
 * them on the real user. The 3-minute per-symbol throttle then stops
 * collapsing eight users into one, so the row count rises roughly eightfold
 * — bounded by the 90-day retention on ml_voice_log.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../server/services/serverBrain.js'), 'utf8');

describe('the scanning thought belongs to the user it was scanned for', () => {
    it('is not filed under a hardcoded account', () => {
        const block = src.slice(src.indexOf("kind: 'neutral_watch'") - 400, src.indexOf("kind: 'neutral_watch'") + 200);
        expect(block).not.toMatch(/userId:\s*1\b/);
    });

    it('carries the user id of the loop it runs in', () => {
        const i = src.indexOf("kind: 'neutral_watch'");
        expect(i).toBeGreaterThan(-1);
        const block = src.slice(i - 400, i + 200);
        expect(block).toMatch(/userId,|userId:\s*userId\b/);
    });

    it('no hardcoded userId: 1 is left anywhere in the brain cycle', () => {
        expect(src).not.toMatch(/userId:\s*1\s*,/);
    });

    it('the throttle still keys on the user, so one account cannot mute another', () => {
        expect(src).toMatch(/\$\{params\.userId\}:\$\{params\.symbol/);
    });
});
