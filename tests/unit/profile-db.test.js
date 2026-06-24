const path = require('path');
process.env.ZEUS_DB_PATH = path.join('/tmp', 'zeus-profile-test-' + Date.now() + '.db');
const db = require('../../server/services/database');

test('setUserProfile + getUserProfileById round-trip (columns exist)', () => {
  const uid = db.createUser('p1_' + Date.now() + '@test.io', 'hash', 'user', 1);
  db.setUserProfile(uid, { display_name: 'Ovi', username: 'zeus_ovi', avatar: 'data:image/png;base64,AAA', accent_color: '#f0c040', tagline: 'hi' });
  const p = db.getUserProfileById(uid);
  expect(p).toBeTruthy();
  expect(p.username).toBe('zeus_ovi');
  expect(p.display_name).toBe('Ovi');
  expect(p.accent_color).toBe('#f0c040');
});

test('findUserByUsername is case-insensitive + null for missing', () => {
  const uid = db.createUser('p2_' + Date.now() + '@test.io', 'hash', 'user', 1);
  db.setUserProfile(uid, { display_name: 'X', username: 'CaseUser', avatar: null, accent_color: null, tagline: null });
  expect(db.findUserByUsername('caseuser')).toBeTruthy();
  expect(db.findUserByUsername('nobody_zzz')).toBeFalsy();
});
