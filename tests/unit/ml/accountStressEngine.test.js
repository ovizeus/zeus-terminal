'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p88-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const ase = require('../../../server/services/ml/R3A_safety/accountStressEngine');

const TEST_USER = 9088;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_account_stress_simulations WHERE user_id IN (?, ?)').run(TEST_USER, 9089);
    db.prepare('DELETE FROM ml_liquidation_warnings WHERE user_id IN (?, ?)').run(TEST_USER, 9089);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§88 Migrations 165 + 166', () => {
    test('simulation_id UNIQUE', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_account_stress_simulations
             (user_id, resolved_env, simulation_id, portfolio_snapshot_json,
              path_type, trajectory_steps_json, distance_to_liquidation,
              peak_margin_used_pct, liquidation_triggered, ts)
             VALUES (?, ?, 'S-UNIQ', '{}', 'trend_adverse', '[]', 0.5, 0.5, 0, ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_account_stress_simulations
             (user_id, resolved_env, simulation_id, portfolio_snapshot_json,
              path_type, trajectory_steps_json, distance_to_liquidation,
              peak_margin_used_pct, liquidation_triggered, ts)
             VALUES (?, ?, 'S-UNIQ', '{}', 'whipsaw', '[]', 0.3, 0.7, 0, ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK path_type restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_account_stress_simulations
             (user_id, resolved_env, simulation_id, portfolio_snapshot_json,
              path_type, trajectory_steps_json, distance_to_liquidation,
              peak_margin_used_pct, liquidation_triggered, ts)
             VALUES (?, ?, 'S-BAD', '{}', 'BOGUS', '[]', 0.5, 0.5, 0, ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });

    test('CHECK recommended_action restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_liquidation_warnings
             (user_id, resolved_env, warning_id, portfolio_snapshot_json,
              closest_path, distance, recommended_action, severity, ts)
             VALUES (?, ?, 'W-BAD', '{}', 'trend_adverse', 0.3, 'BOGUS', 'warn', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§88 Constants', () => {
    test('PATH_TYPES has 6 entries', () => {
        expect(ase.PATH_TYPES).toHaveLength(6);
    });

    test('RECOMMENDED_ACTIONS has 5 entries', () => {
        expect(ase.RECOMMENDED_ACTIONS).toEqual([
            'CONTINUE', 'REDUCE_SIZE', 'DEFENSIVE',
            'CLOSE_PARTIAL', 'EMERGENCY_EXIT'
        ]);
    });

    test('danger thresholds ordered', () => {
        expect(ase.LIQUIDATION_DANGER_PCT).toBeGreaterThan(ase.WARNING_DANGER_PCT);
    });
});

describe('§88 simulatePath', () => {
    const portfolio = {
        equity: 10000,
        positionNotional: 50000,    // 5x leverage
        maintenanceMarginPct: 0.05
    };

    test('trend_adverse generates monotonic decline', () => {
        const r = ase.simulatePath({
            portfolio, pathType: 'trend_adverse', steps: 10
        });
        expect(r.trajectorySteps.length).toBeGreaterThan(0);
    });

    test('high severity trend triggers liquidation', () => {
        const r = ase.simulatePath({
            portfolio, pathType: 'trend_adverse',
            steps: 20, severity: 3.0
        });
        expect(r.liquidationTriggered).toBe(true);
    });

    test('throws on invalid pathType', () => {
        expect(() => ase.simulatePath({
            portfolio, pathType: 'BOGUS'
        })).toThrow();
    });

    test('zero equity returns empty trajectory', () => {
        const r = ase.simulatePath({
            portfolio: { equity: 0, positionNotional: 0 },
            pathType: 'trend_adverse'
        });
        expect(r.trajectorySteps).toEqual([]);
    });

    test('all 6 path types execute', () => {
        for (const pt of ase.PATH_TYPES) {
            const r = ase.simulatePath({
                portfolio, pathType: pt, severity: 0.5
            });
            expect(r.trajectorySteps.length).toBeGreaterThan(0);
        }
    });
});

describe('§88 computeLiquidationDistance', () => {
    test('healthy portfolio has high distance', () => {
        const r = ase.computeLiquidationDistance({
            portfolio: { positionNotional: 10000 },
            currentEquity: 5000
        });
        expect(r.distancePct).toBeGreaterThan(0);
    });

    test('zero position returns max distance', () => {
        const r = ase.computeLiquidationDistance({
            portfolio: { positionNotional: 0 },
            currentEquity: 1000
        });
        expect(r.distancePct).toBe(1.0);
    });
});

describe('§88 runStressSurface', () => {
    test('runs all paths + identifies worst', () => {
        const portfolio = {
            equity: 10000, positionNotional: 30000,
            maintenanceMarginPct: 0.05
        };
        const r = ase.runStressSurface({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            simulationId: 'SS-001', portfolio,
            severity: 1.0
        });
        expect(r.runs).toBe(6);
        expect(r.worstPath).toBeTruthy();
    });

    test('duplicate simulation_id throws', () => {
        const portfolio = {
            equity: 10000, positionNotional: 30000,
            maintenanceMarginPct: 0.05
        };
        ase.runStressSurface({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            simulationId: 'SS-DUP', portfolio
        });
        expect(() => ase.runStressSurface({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            simulationId: 'SS-DUP', portfolio
        })).toThrow();
    });
});

describe('§88 recordWarning', () => {
    test('persists', () => {
        ase.recordWarning({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            warningId: 'W-001',
            portfolio: { equity: 5000 },
            closestPath: 'trend_adverse', distance: 0.20,
            recommendedAction: 'REDUCE_SIZE',
            severity: 'warn'
        });
        const h = ase.getWarningHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        expect(h).toHaveLength(1);
    });

    test('throws on invalid action', () => {
        expect(() => ase.recordWarning({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            warningId: 'W-BAD',
            portfolio: {}, closestPath: 'whipsaw', distance: 0.3,
            recommendedAction: 'BOGUS', severity: 'warn'
        })).toThrow();
    });

    test('throws on invalid severity', () => {
        expect(() => ase.recordWarning({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            warningId: 'W-BAD2',
            portfolio: {}, closestPath: 'whipsaw', distance: 0.3,
            recommendedAction: 'REDUCE_SIZE', severity: 'BOGUS'
        })).toThrow();
    });
});

describe('§88 evaluateStressHealth', () => {
    test('healthy when margin low', () => {
        const r = ase.evaluateStressHealth({
            portfolio: { positionNotional: 1000, maintenanceMarginPct: 0.05 },
            currentEquity: 1000   // margin = 50/1000 = 5%
        });
        expect(r.healthy).toBe(true);
        expect(r.recommendedAction).toBe('CONTINUE');
    });

    test('critical when margin >= 80%', () => {
        const r = ase.evaluateStressHealth({
            portfolio: { positionNotional: 10000, maintenanceMarginPct: 0.05 },
            currentEquity: 600    // 500/600 ≈ 83%
        });
        expect(r.severity).toBe('critical');
        expect(r.recommendedAction).toBe('EMERGENCY_EXIT');
    });

    test('warn when margin 60-80%', () => {
        const r = ase.evaluateStressHealth({
            portfolio: { positionNotional: 10000, maintenanceMarginPct: 0.05 },
            currentEquity: 750    // 500/750 ≈ 67%
        });
        expect(r.severity).toBe('warn');
    });
});

describe('§88 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9089;
        ase.recordWarning({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            warningId: 'W-ISO',
            portfolio: {}, closestPath: 'whipsaw', distance: 0.3,
            recommendedAction: 'REDUCE_SIZE', severity: 'warn'
        });
        const h1 = ase.getWarningHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV
        });
        const h2 = ase.getWarningHistory({
            userId: OTHER_USER, resolvedEnv: TEST_ENV
        });
        expect(h1.length).toBe(1);
        expect(h2.length).toBe(0);
    });
});
