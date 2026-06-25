'use strict';
const path = require('path');
process.env.ZEUS_DB_PATH = path.join('/tmp', 'zeus-referral-' + Date.now() + '.db');
const db = require('../../server/services/database');

test('getOrCreateReferralCode is stable + unique per user', () => {
  const u1 = db.createUser('r1_' + Date.now() + '@t.io', 'h', 'user', 1);
  const u2 = db.createUser('r2_' + Date.now() + '@t.io', 'h', 'user', 1);
  const c1a = db.getOrCreateReferralCode(u1);
  const c1b = db.getOrCreateReferralCode(u1);
  const c2 = db.getOrCreateReferralCode(u2);
  expect(c1a).toMatch(/^ZEUS-[A-Z0-9]{6}$/);
  expect(c1b).toBe(c1a);          // stable
  expect(c2).not.toBe(c1a);        // unique
});

test('findUserByReferralCode resolves (case-insensitive) + setReferredBy/countReferrals', () => {
  const inviter = db.createUser('inv_' + Date.now() + '@t.io', 'h', 'user', 1);
  const code = db.getOrCreateReferralCode(inviter);
  const found = db.findUserByReferralCode(code.toLowerCase());
  expect(found && found.id).toBe(inviter);
  const joiner = db.createUser('joi_' + Date.now() + '@t.io', 'h', 'user', 1);
  db.setReferredBy(joiner, inviter);
  expect(db.countReferrals(inviter)).toBe(1);
  // cannot self-refer + cannot overwrite
  db.setReferredBy(joiner, joiner);
  expect(db.countReferrals(inviter)).toBe(1);
});
