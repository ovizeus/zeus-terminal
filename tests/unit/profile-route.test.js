'use strict';
const path = require('path');
process.env.ZEUS_DB_PATH = path.join('/tmp', 'zeus-profile-route-' + Date.now() + '.db');
const express = require('express');
const supertest = require('supertest');
const db = require('../../server/services/database');

function makeApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => { const id = parseInt(req.headers['x-test-uid'], 10) || 0; if (id) req.user = { id, role: 'user' }; next(); });
  app.use('/api/profile', require('../../server/routes/profile'));
  return app;
}

describe('/api/profile', () => {
  const app = makeApp();
  let u1, u2;
  beforeAll(() => {
    u1 = db.createUser('r1_' + Date.now() + '@t.io', 'h', 'user', 1);
    u2 = db.createUser('r2_' + Date.now() + '@t.io', 'h', 'user', 1);
  });

  test('POST saves + GET returns own profile', async () => {
    const r = await supertest(app).post('/api/profile').set('x-test-uid', String(u1)).send({ profile: { username: 'zeus_ovi', display_name: 'Ovi' } });
    expect(r.status).toBe(200);
    const g = await supertest(app).get('/api/profile').set('x-test-uid', String(u1));
    expect(g.body.profile.username).toBe('zeus_ovi');
    expect(g.body.profile.display_name).toBe('Ovi');
  });

  test('duplicate username rejected 409', async () => {
    const r = await supertest(app).post('/api/profile').set('x-test-uid', String(u2)).send({ profile: { username: 'zeus_ovi' } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('username_taken');
  });

  test('public GET /:id never leaks email', async () => {
    const r = await supertest(app).get('/api/profile/' + u1).set('x-test-uid', String(u2));
    expect(r.status).toBe(200);
    expect(r.body.profile.email).toBeUndefined();
    expect(Object.keys(r.body.profile)).not.toContain('password_hash');
  });

  test('oversize avatar rejected 400', async () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(400000);
    const r = await supertest(app).post('/api/profile').set('x-test-uid', String(u1)).send({ profile: { avatar: big } });
    expect(r.status).toBe(400);
  });

  test('unauthenticated 401', async () => {
    const r = await supertest(app).get('/api/profile');
    expect(r.status).toBe(401);
  });
});
