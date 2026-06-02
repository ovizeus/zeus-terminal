'use strict';
const express = require('express');
const supertest = require('supertest');
const path = require('path');
jest.mock(path.resolve(__dirname, '../../server/services/heartbeatTracker'), () => ({ recordBeat: jest.fn() }));
const HB = require('../../server/services/heartbeatTracker');

describe('POST /api/brain/parity/heartbeat', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 7 }; next(); });
    app.use('/api/brain/parity', require('../../server/routes/brainParity'));
  });
  test('stamps server time and records beat for the user', async () => {
    const res = await supertest(app).post('/api/brain/parity/heartbeat').send({});
    expect(res.status).toBe(200);
    expect(HB.recordBeat).toHaveBeenCalledTimes(1);
    expect(HB.recordBeat.mock.calls[0][0]).toBe(7);
    expect(typeof HB.recordBeat.mock.calls[0][1]).toBe('number');
  });
  test('401 when unauthenticated', async () => {
    const app2 = express(); app2.use(express.json());
    app2.use('/api/brain/parity', require('../../server/routes/brainParity'));
    const res = await supertest(app2).post('/api/brain/parity/heartbeat').send({});
    expect(res.status).toBe(401);
  });
});
