'use strict';
// tests/unit/mlLiveOptin.test.js
// [REAL-GATE P0-3 2026-06-09] Per-user explicit opt-in for REAL ML influence.
// Fail-closed: absence of a row === NOT opted in.

const fs = require('fs');
const os = require('os');
const path = require('path');

let optin;

beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-optin-'));
    process.env.ZEUS_DB_PATH = path.join(tmp, 'test.db');
    optin = require('../../server/services/ml/mlLiveOptin');
});

describe('mlLiveOptin store', () => {
    test('user with no row is NOT opted in (fail-closed default)', () => {
        expect(optin.isOptedIn(42)).toBe(false);
    });

    test('setOptin(true) then isOptedIn === true', () => {
        optin.setOptin(42, true, 'test');
        expect(optin.isOptedIn(42)).toBe(true);
    });

    test('setOptin(false) revokes (upsert, not insert-only)', () => {
        optin.setOptin(42, true, 'test');
        optin.setOptin(42, false, 'test');
        expect(optin.isOptedIn(42)).toBe(false);
    });

    test('opt-in is per-user — user 43 unaffected by user 42', () => {
        optin.setOptin(42, true, 'test');
        expect(optin.isOptedIn(43)).toBe(false);
    });

    test('setOptin writes an audit_log row ML_LIVE_OPTIN_SET', () => {
        const { db } = require('../../server/services/database');
        optin.setOptin(42, true, 'test-audit');
        const row = db.prepare(
            "SELECT details FROM audit_log WHERE action='ML_LIVE_OPTIN_SET' AND user_id=42 ORDER BY id DESC LIMIT 1"
        ).get();
        expect(row).toBeTruthy();
        expect(JSON.parse(row.details).source).toBe('test-audit');
    });

    test('isOptedIn never throws on garbage input', () => {
        expect(optin.isOptedIn(null)).toBe(false);
        expect(optin.isOptedIn(undefined)).toBe(false);
    });
});
