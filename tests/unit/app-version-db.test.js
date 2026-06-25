'use strict';
// [2026-06-26] App version reporting — DB layer. Native APK reports its installed
// versionCode/Name on boot; we store it per user so the admin can see who is behind.
const path = require('path');
process.env.ZEUS_DB_PATH = path.join('/tmp', 'zeus-appver-' + Date.now() + '.db');
const db = require('../../server/services/database');

test('setAppVersion stores + getAppVersion reads it back', () => {
  const u = db.createUser('av1_' + Date.now() + '@t.io', 'h', 'user', 1);
  db.setAppVersion(u, 42, '1.7.16', 'android');
  const v = db.getAppVersion(u);
  expect(v.app_version_code).toBe(42);
  expect(v.app_version_name).toBe('1.7.16');
  expect(v.app_platform).toBe('android');
  expect(v.app_version_at).toBeTruthy();
});

test('setAppVersion overwrites with the newer report + listUsers exposes it', () => {
  const u = db.createUser('av2_' + Date.now() + '@t.io', 'h', 'user', 1);
  db.setAppVersion(u, 41, '1.7.15', 'android');
  db.setAppVersion(u, 42, '1.7.16', 'android');
  const v = db.getAppVersion(u);
  expect(v.app_version_code).toBe(42);
  const row = db.listUsers().find(r => r.id === u);
  expect(row.app_version_code).toBe(42);
  expect(row.app_version_name).toBe('1.7.16');
});
