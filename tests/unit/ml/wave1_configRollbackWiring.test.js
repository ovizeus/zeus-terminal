'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave1-cr-wiring-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');

beforeEach(() => {
  db.prepare("DELETE FROM ml_config_snapshots WHERE config_key = 'TEST_WAVE1_FLAG'").run();
});

afterAll(() => {
  db.prepare("DELETE FROM ml_config_snapshots WHERE config_key = 'TEST_WAVE1_FLAG'").run();
});

describe('Wave 1: configRollback wiring on flag change', () => {
  test('snapshotConfig records flag value with version', () => {
    const cr = require('../../../server/services/ml/R0_substrate/configRollback');
    cr.snapshotConfig({
      userId: 0, resolvedEnv: 'SYSTEM',
      configKey: 'TEST_WAVE1_FLAG', value: true, version: 1,
      actor: 'operator', reason: 'manual_flip',
    });
    const row = db.prepare("SELECT * FROM ml_config_snapshots WHERE config_key = 'TEST_WAVE1_FLAG' AND is_active = 1").get();
    expect(row).not.toBeNull();
    expect(JSON.parse(row.value_json)).toBe(true);
    expect(row.version).toBe(1);
  });

  test('getCurrentConfig returns latest active snapshot', () => {
    const cr = require('../../../server/services/ml/R0_substrate/configRollback');
    cr.snapshotConfig({ userId: 0, resolvedEnv: 'SYSTEM', configKey: 'TEST_WAVE1_FLAG', value: false, version: 1, actor: 'test' });
    cr.snapshotConfig({ userId: 0, resolvedEnv: 'SYSTEM', configKey: 'TEST_WAVE1_FLAG', value: true, version: 2, actor: 'test' });
    const current = cr.getCurrentConfig({ userId: 0, resolvedEnv: 'SYSTEM', configKey: 'TEST_WAVE1_FLAG' });
    expect(current).not.toBeNull();
    expect(current.version).toBe(2);
    expect(current.value).toBe(true);
  });

  test('rollbackConfig restores previous version', () => {
    const cr = require('../../../server/services/ml/R0_substrate/configRollback');
    cr.snapshotConfig({ userId: 0, resolvedEnv: 'SYSTEM', configKey: 'TEST_WAVE1_FLAG', value: 'old', version: 1, actor: 'test' });
    cr.snapshotConfig({ userId: 0, resolvedEnv: 'SYSTEM', configKey: 'TEST_WAVE1_FLAG', value: 'new', version: 2, actor: 'test' });
    const result = cr.rollbackConfig({ userId: 0, resolvedEnv: 'SYSTEM', configKey: 'TEST_WAVE1_FLAG', reason: 'bad_deploy', actor: 'operator' });
    expect(result).not.toBeNull();
    const current = cr.getCurrentConfig({ userId: 0, resolvedEnv: 'SYSTEM', configKey: 'TEST_WAVE1_FLAG' });
    expect(current.version).toBe(1);
  });
});
