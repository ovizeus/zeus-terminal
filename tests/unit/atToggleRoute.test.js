'use strict';

/**
 * [2026-11-08] The app's own arming route.
 *
 * uid=5 was armed by a direct database write, because `/api/at/toggle` acts on
 * the LOGGED-IN user and there is no admin path to another account — and I do
 * not fabricate sessions. That left the normal route unverified, so it is
 * pinned here.
 *
 * The property that matters is not "it works" but WHOSE account it touches:
 * the handler must take the user id from the authenticated session and never
 * from the request body. A route that accepted a userId in the body would let
 * anyone arm anyone — on a system that trades money.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const handler = (() => {
    const i = src.indexOf("app.post('/api/at/toggle'");
    expect(i).toBeGreaterThan(-1);
    return src.slice(i, i + 1200);
})();

describe('POST /api/at/toggle', () => {
    it('refuses anyone without a session', () => {
        expect(handler).toMatch(/if \(!_req\.user\)[\s\S]{0,80}401/);
    });

    it('arms the AUTHENTICATED user — never a id taken from the body', () => {
        expect(handler).toMatch(/serverAT\.toggleActive\(\s*_req\.user\.id/);
        // the body must not be able to name a victim
        expect(handler).not.toMatch(/toggleActive\([^)]*_req\.body\.(userId|uid)/);
    });

    it('insists on a real boolean instead of coercing whatever arrives', () => {
        // "active": "false" is a truthy string; coercion here would arm an
        // account that asked to be disarmed
        expect(handler).toMatch(/typeof active !== 'boolean'/);
    });

    it('accepts only the two modes that exist', () => {
        expect(handler).toMatch(/_req\.body\.mode === 'live'[\s\S]{0,60}'demo'/);
    });

    it('hands the engine decision back to the caller rather than assuming success', () => {
        expect(handler).toMatch(/if \(!result\.ok\) return res\.json\(result\)/);
    });
});
