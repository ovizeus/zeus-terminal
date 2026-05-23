'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'r5-state-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ring5State = require('../../../server/services/ml/_ring5/ring5State');

const _now = () => Date.now();

function clean() {
    db.prepare("DELETE FROM ml_module_state").run();
}

describe('ring5State (Phase 2)', () => {
    beforeEach(clean);

    describe('getModuleState', () => {
        test('returns null for unseen cell', () => {
            const r = ring5State.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'unseen_mod'
            });
            expect(r).toBeNull();
        });

        test('returns hydrated row when present', () => {
            db.prepare(`INSERT INTO ml_module_state
                (user_id, resolved_env, symbol, module_id, version, last_observed_ts, trust_score, bandit_params_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(1, 'DEMO', 'BTCUSDT', 'mod_x', 3, 12345, 0.7, '{"alpha":2,"beta":1}', _now());
            const r = ring5State.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_x'
            });
            expect(r).toBeTruthy();
            expect(r.version).toBe(3);
            expect(r.trustScore).toBe(0.7);
            expect(r.banditParams).toEqual({ alpha: 2, beta: 1 });
            expect(r.lastObservedTs).toBe(12345);
        });
    });

    describe('updateModuleState (atomic upsert)', () => {
        test('inserts new row when cell unseen', () => {
            ring5State.updateModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_new',
                trustScore: 0.6,
                banditParams: { alpha: 1, beta: 1 },
                lastObservedTs: _now(),
                ts: _now()
            });
            const r = ring5State.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_new'
            });
            expect(r.version).toBe(1);
            expect(r.trustScore).toBe(0.6);
        });

        test('increments version on existing row update', () => {
            const args = {
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_v',
                trustScore: 0.5,
                banditParams: { alpha: 1, beta: 1 },
                lastObservedTs: _now(),
                ts: _now()
            };
            ring5State.updateModuleState(args);
            ring5State.updateModuleState({ ...args, trustScore: 0.6 });
            ring5State.updateModuleState({ ...args, trustScore: 0.7 });
            const r = ring5State.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'mod_v'
            });
            expect(r.version).toBe(3);
            expect(r.trustScore).toBe(0.7);
        });

        test('rejects invalid resolvedEnv', () => {
            expect(() => ring5State.updateModuleState({
                userId: 1, resolvedEnv: 'BAD', symbol: 'BTCUSDT', moduleId: 'm',
                trustScore: 0.5, banditParams: {}, lastObservedTs: _now(), ts: _now()
            })).toThrow(/resolvedEnv/);
        });

        test('rejects trustScore outside [0,1]', () => {
            expect(() => ring5State.updateModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'm',
                trustScore: 1.5, banditParams: {}, lastObservedTs: _now(), ts: _now()
            })).toThrow(/trustScore/);
        });

        test('rejects missing required field', () => {
            expect(() => ring5State.updateModuleState({
                resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'm',
                trustScore: 0.5, banditParams: {}, lastObservedTs: _now(), ts: _now()
            })).toThrow(/userId/);
        });
    });

    describe('per-(user × env × symbol × module) isolation', () => {
        test('same moduleId different env writes independently', () => {
            const base = {
                userId: 1, symbol: 'BTCUSDT', moduleId: 'iso_mod',
                trustScore: 0.5, banditParams: { alpha: 1, beta: 1 },
                lastObservedTs: _now(), ts: _now()
            };
            ring5State.updateModuleState({ ...base, resolvedEnv: 'DEMO', trustScore: 0.4 });
            ring5State.updateModuleState({ ...base, resolvedEnv: 'TESTNET', trustScore: 0.8 });
            const demo = ring5State.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'iso_mod'
            });
            const testnet = ring5State.getModuleState({
                userId: 1, resolvedEnv: 'TESTNET', symbol: 'BTCUSDT', moduleId: 'iso_mod'
            });
            expect(demo.trustScore).toBe(0.4);
            expect(testnet.trustScore).toBe(0.8);
        });

        test('same moduleId different user writes independently', () => {
            const base = {
                resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'iso_user_mod',
                trustScore: 0.5, banditParams: { alpha: 1, beta: 1 },
                lastObservedTs: _now(), ts: _now()
            };
            ring5State.updateModuleState({ ...base, userId: 1, trustScore: 0.3 });
            ring5State.updateModuleState({ ...base, userId: 2, trustScore: 0.9 });
            const a = ring5State.getModuleState({
                userId: 1, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'iso_user_mod'
            });
            const b = ring5State.getModuleState({
                userId: 2, resolvedEnv: 'DEMO', symbol: 'BTCUSDT', moduleId: 'iso_user_mod'
            });
            expect(a.trustScore).toBe(0.3);
            expect(b.trustScore).toBe(0.9);
        });
    });
});
