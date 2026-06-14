'use strict';

// Task 1 — support_messages DB layer. Exercises the exported helpers against
// the real module and cleans up its own rows by a throwaway user id.

const path = require('path');
const dbmod = require(path.resolve(__dirname, '../../server/services/database'));

const U = 999000001; // test user id unlikely to collide

afterAll(() => {
  try { dbmod.db.prepare('DELETE FROM support_messages WHERE user_id = ?').run(U); } catch (_) {}
});

describe('support_messages DB helpers', () => {
  beforeEach(() => {
    dbmod.db.prepare('DELETE FROM support_messages WHERE user_id = ?').run(U);
  });

  test('insert user message: unread by admin, read by user', () => {
    const row = dbmod.insertSupportMessage(U, 'user', 'hello there');
    expect(row.id).toBeGreaterThan(0);
    expect(row.sender).toBe('user');
    expect(row.message).toBe('hello there');
    expect(row.read_by_admin).toBe(0);
    expect(row.read_by_user).toBe(1);
  });

  test('insert admin message: read by admin, unread by user', () => {
    const row = dbmod.insertSupportMessage(U, 'admin', 'hi back');
    expect(row.sender).toBe('admin');
    expect(row.read_by_admin).toBe(1);
    expect(row.read_by_user).toBe(0);
  });

  test('getSupportThread returns rows in id order', () => {
    dbmod.insertSupportMessage(U, 'user', 'first');
    dbmod.insertSupportMessage(U, 'admin', 'second');
    const t = dbmod.getSupportThread(U);
    expect(t.map(r => r.message)).toEqual(['first', 'second']);
  });

  test('unread counts and read-marking', () => {
    dbmod.insertSupportMessage(U, 'user', 'u1');
    dbmod.insertSupportMessage(U, 'user', 'u2');
    dbmod.insertSupportMessage(U, 'admin', 'a1');
    expect(dbmod.getSupportTotalUnreadForAdmin()).toBeGreaterThanOrEqual(2);
    expect(dbmod.getSupportUnreadForUser(U)).toBe(1);

    dbmod.markSupportThreadReadByAdmin(U);
    const inbox = dbmod.getSupportInbox().find(c => c.user_id === U);
    expect(inbox.unread_count).toBe(0);

    dbmod.markSupportThreadReadByUser(U);
    expect(dbmod.getSupportUnreadForUser(U)).toBe(0);
  });

  test('getSupportInbox returns last message + email join', () => {
    dbmod.insertSupportMessage(U, 'user', 'newest msg');
    const inbox = dbmod.getSupportInbox();
    const row = inbox.find(c => c.user_id === U);
    expect(row).toBeTruthy();
    expect(row.last_message).toBe('newest msg');
    expect(row).toHaveProperty('email');
  });

  test('getAdminUserIds returns an array', () => {
    expect(Array.isArray(dbmod.getAdminUserIds())).toBe(true);
  });
});
