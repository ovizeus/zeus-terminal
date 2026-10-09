'use strict';
// [2026-10-09] Settings have been impossible to save all day. 51 POSTs to
// /api/user/settings today, every single one answered 400.
//
// There are TWO server-side lists and they had drifted:
//   middleware/validate.js  SETTINGS_SHAPE     — rejects the WHOLE payload if
//                                                it sees one key it does not know
//   routes/trading.js       SETTINGS_WHITELIST — decides which keys are stored
// `overlays` was added to the whitelist in b248 and never to the shape, so from
// the moment b253 unblocked the client's save path the server rejected every
// save outright. One unknown key discards the entire payload, so this is not a
// partial loss — nothing persisted at all.
//
// The lists cannot be merged (one carries types, the other is membership), so
// they are pinned together here instead.

const fs = require('fs');
const path = require('path');

function shapeKeys() {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'middleware', 'validate.js'), 'utf8');
    const block = src.slice(src.indexOf('SETTINGS_SHAPE'), src.indexOf('function validateSettingsBody'));
    return new Set([...block.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*'(?:string|number|boolean|object|array)'/g)].map((m) => m[1]));
}

describe('the settings validator knows every key the whitelist stores', () => {
    const { SETTINGS_WHITELIST } = require('../../server/routes/trading');

    test('no whitelisted key is unknown to the validator', () => {
        const shape = shapeKeys();
        const missing = [...SETTINGS_WHITELIST].filter((k) => !shape.has(k));
        expect(missing).toEqual([]);
    });

    test('overlays specifically — the key that broke saving all day', () => {
        expect(shapeKeys().has('overlays')).toBe(true);
    });
});

describe('validateSettingsBody accepts a realistic client payload', () => {
    const { validateSettingsBody } = require('../../server/middleware/validate');

    function run(settings) {
        const req = { body: { settings } };
        let status = null, payload = null;
        const res = { status(c) { status = c; return this; }, json(p) { payload = p; return this; } };
        let passed = false;
        validateSettingsBody(req, res, () => { passed = true; });
        return { passed, status, payload };
    }

    test('a save carrying overlays is accepted, not rejected with 400', () => {
        const r = run({ overlays: { liq: true, sr: false }, chartTf: '15m' });
        expect(r.status).not.toBe(400);
        expect(r.passed).toBe(true);
    });

    test('a genuinely unknown key is still refused', () => {
        const r = run({ totallyMadeUpKey: 1 });
        expect(r.status).toBe(400);
        expect(r.payload.unknownKeys).toContain('totallyMadeUpKey');
    });
});
