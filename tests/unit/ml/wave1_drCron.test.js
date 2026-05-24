'use strict';
const { db } = require('../../../server/services/database');

beforeEach(() => {
  db.prepare("DELETE FROM ml_dr_state WHERE node_id = 'zeus-test'").run();
});

afterAll(() => {
  db.prepare("DELETE FROM ml_dr_state WHERE node_id = 'zeus-test'").run();
});

describe('Wave 1: DR orchestrator cron', () => {
  test('recordHeartbeat stores HEARTBEAT record in ml_dr_state', () => {
    const dr = require('../../../server/services/ml/R0_substrate/disasterRecoveryOrchestrator');
    dr.recordHeartbeat({ nodeId: 'zeus-test', role: 'PRIMARY' });
    const row = db.prepare("SELECT * FROM ml_dr_state WHERE node_id = 'zeus-test' AND record_type = 'HEARTBEAT' ORDER BY id DESC LIMIT 1").get();
    expect(row).not.toBeNull();
    expect(row.role).toBe('PRIMARY');
  });

  test('getHeartbeatStatus returns LIVE when recent heartbeat', () => {
    const dr = require('../../../server/services/ml/R0_substrate/disasterRecoveryOrchestrator');
    dr.recordHeartbeat({ nodeId: 'zeus-test', role: 'PRIMARY' });
    const status = dr.getHeartbeatStatus({ nodeId: 'zeus-test' });
    expect(status.state).toBe('LIVE');
  });

  test('cron module exports schedule and stop', () => {
    const cron = require('../../../server/cron/r0SubstrateCron');
    expect(typeof cron.schedule).toBe('function');
    expect(typeof cron.stop).toBe('function');
    expect(typeof cron._tick).toBe('function');
  });

  test('cron _tick calls DR recordHeartbeat', () => {
    const cron = require('../../../server/cron/r0SubstrateCron');
    db.prepare("DELETE FROM ml_dr_state WHERE node_id = ?").run(cron.NODE_ID);
    cron._tick();
    const row = db.prepare("SELECT * FROM ml_dr_state WHERE node_id = ? AND record_type = 'HEARTBEAT' ORDER BY id DESC LIMIT 1").get(cron.NODE_ID);
    expect(row).not.toBeNull();
    expect(row.role).toBe('PRIMARY');
    // cleanup
    db.prepare("DELETE FROM ml_dr_state WHERE node_id = ?").run(cron.NODE_ID);
  });
});
