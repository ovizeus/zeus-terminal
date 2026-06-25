'use strict';
// [2026-06-26] App version reporting — input validation. The POST body comes from the
// client (untrusted): coerce/clamp into a clean {versionCode, versionName, platform} or null.
const { normalizeAppVersion } = require('../../server/routes/appVersion');

test('accepts a valid native version report', () => {
  expect(normalizeAppVersion({ versionCode: 42, versionName: '1.7.16', platform: 'android' }))
    .toEqual({ versionCode: 42, versionName: '1.7.16', platform: 'android' });
});

test('coerces a numeric-string versionCode', () => {
  const v = normalizeAppVersion({ versionCode: '42', versionName: '1.7.16' });
  expect(v.versionCode).toBe(42);
  expect(v.platform).toBe('android'); // default when missing
});

test('rejects a missing / non-numeric / non-positive versionCode', () => {
  expect(normalizeAppVersion({ versionName: '1.0' })).toBeNull();
  expect(normalizeAppVersion({ versionCode: 'abc' })).toBeNull();
  expect(normalizeAppVersion({ versionCode: 0 })).toBeNull();
  expect(normalizeAppVersion({ versionCode: -5 })).toBeNull();
  expect(normalizeAppVersion(null)).toBeNull();
});

test('sanitises + truncates a hostile versionName and platform', () => {
  const v = normalizeAppVersion({ versionCode: 7, versionName: '1.2.3<script>'.padEnd(80, 'x'), platform: 'And/roid!!' });
  expect(v.versionName).toBe('1.2.3script' + 'x'.repeat(21)); // angle brackets stripped, capped at 32
  expect(v.versionName.length).toBeLessThanOrEqual(32);
  expect(v.platform).toBe('android'); // lowercased, non-alnum stripped
});
