'use strict';

// Task 2 — /api/support route. Mocks the database service so no real DB is
// touched, and asserts auth gating, validation, persistence calls, and WS push.

const supertest = require('supertest');
const realExpress = require('express');
const path = require('path');

const DB = path.resolve(__dirname, '../../server/services/database');

function buildApp(broadcastSpy) {
  jest.resetModules();
  jest.doMock(DB, () => ({
    insertSupportMessage: jest.fn((uid, sender, msg) => ({
      id: 1, user_id: uid, sender, message: msg,
      read_by_admin: sender === 'admin' ? 1 : 0,
      read_by_user: sender === 'user' ? 1 : 0,
      created_at: '2026-06-14 00:00:00',
    })),
    getSupportThread: jest.fn(() => [{ id: 1, user_id: 7, sender: 'user', message: 'hi' }]),
    getSupportUnreadForUser: jest.fn(() => 2),
    getSupportTotalUnreadForAdmin: jest.fn(() => 3),
    markSupportThreadReadByAdmin: jest.fn(),
    markSupportThreadReadByUser: jest.fn(),
    getSupportInbox: jest.fn(() => [{ user_id: 7, email: 'a@b.c', last_message: 'hi', last_at: 't', unread_count: 1 }]),
    getAdminUserIds: jest.fn(() => [1]),
  }));
  const dbmod = require(DB);
  const app = realExpress();
  app.use(realExpress.json());
  app.locals.wsBroadcastToUser = broadcastSpy;
  app.use((req, res, next) => {
    const role = req.headers['x-test-role'];
    const id = parseInt(req.headers['x-test-uid'], 10) || 0;
    if (id) req.user = { id, role: role || 'user' };
    next();
  });
  app.use('/api/support', require(path.resolve(__dirname, '../../server/routes/support')));
  return { app, dbmod };
}

describe('/api/support', () => {
  test('user sends message → persisted + pushed to admin', async () => {
    const broadcast = jest.fn();
    const { app, dbmod } = buildApp(broadcast);
    const res = await supertest(app)
      .post('/api/support/send').set('x-test-uid', '7').set('x-test-role', 'user')
      .send({ message: 'help me' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(dbmod.insertSupportMessage).toHaveBeenCalledWith(7, 'user', 'help me');
    expect(broadcast).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'support.message' }));
  });

  test('empty message → 400', async () => {
    const { app } = buildApp(jest.fn());
    const res = await supertest(app)
      .post('/api/support/send').set('x-test-uid', '7').set('x-test-role', 'user')
      .send({ message: '   ' });
    expect(res.status).toBe(400);
  });

  test('over-length message → 400', async () => {
    const { app } = buildApp(jest.fn());
    const res = await supertest(app)
      .post('/api/support/send').set('x-test-uid', '7').set('x-test-role', 'user')
      .send({ message: 'X'.repeat(2001) });
    expect(res.status).toBe(400);
  });

  test('unauthenticated send → 401', async () => {
    const { app } = buildApp(jest.fn());
    const res = await supertest(app).post('/api/support/send').send({ message: 'hi' });
    expect(res.status).toBe(401);
  });

  test('user GET thread marks read-by-user', async () => {
    const { app, dbmod } = buildApp(jest.fn());
    const res = await supertest(app)
      .get('/api/support/thread').set('x-test-uid', '7').set('x-test-role', 'user');
    expect(res.status).toBe(200);
    expect(dbmod.markSupportThreadReadByUser).toHaveBeenCalledWith(7);
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  test('non-admin GET inbox → 403', async () => {
    const { app } = buildApp(jest.fn());
    const res = await supertest(app)
      .get('/api/support/inbox').set('x-test-uid', '7').set('x-test-role', 'user');
    expect(res.status).toBe(403);
  });

  test('admin GET inbox → conversations + totalUnread', async () => {
    const { app } = buildApp(jest.fn());
    const res = await supertest(app)
      .get('/api/support/inbox').set('x-test-uid', '1').set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(res.body.totalUnread).toBe(3);
    expect(res.body.conversations.length).toBe(1);
  });

  test('admin reply → persisted as admin + pushed to that user', async () => {
    const broadcast = jest.fn();
    const { app, dbmod } = buildApp(broadcast);
    const res = await supertest(app)
      .post('/api/support/reply/7').set('x-test-uid', '1').set('x-test-role', 'admin')
      .send({ message: 'on it' });
    expect(res.status).toBe(200);
    expect(dbmod.insertSupportMessage).toHaveBeenCalledWith(7, 'admin', 'on it');
    expect(broadcast).toHaveBeenCalledWith(7, expect.objectContaining({ type: 'support.message' }));
  });

  test('admin GET thread/:id marks read-by-admin', async () => {
    const { app, dbmod } = buildApp(jest.fn());
    const res = await supertest(app)
      .get('/api/support/thread/7').set('x-test-uid', '1').set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(dbmod.markSupportThreadReadByAdmin).toHaveBeenCalledWith(7);
  });

  test('unauthenticated admin reply -> 401', async () => {
    const { app } = buildApp(jest.fn());
    const res = await supertest(app).post('/api/support/reply/7').send({ message: 'x' });
    expect(res.status).toBe(401);
  });

  test('negative userId on admin reply -> 400', async () => {
    const { app } = buildApp(jest.fn());
    const res = await supertest(app)
      .post('/api/support/reply/-5').set('x-test-uid', '1').set('x-test-role', 'admin')
      .send({ message: 'hi' });
    expect(res.status).toBe(400);
  });
});
