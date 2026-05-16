'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p87-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const vc = require('../../../server/services/ml/R3A_safety/venueCounterpartyRisk');

const TEST_USER = 9087;
const TEST_ENV = 'DEMO';

function cleanRows() {
    db.prepare('DELETE FROM ml_venue_risk_scores WHERE user_id IN (?, ?)').run(TEST_USER, 9088);
    db.prepare('DELETE FROM ml_venue_incidents WHERE user_id IN (?, ?)').run(TEST_USER, 9088);
}

function fullScores(value = 0.85) {
    return {
        uptime: value,
        withdrawal_reliability: value,
        insurance_fund_quality: value,
        liquidation_engine_behavior: value,
        incident_history: value,
        legal_regulatory_exposure: value,
        custody_collateral_concentration: value
    };
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§87 Migrations 163 + 164', () => {
    test('venue UNIQUE per (user, env, venue_id)', () => {
        const ts = Date.now();
        db.prepare(
            `INSERT INTO ml_venue_risk_scores
             (user_id, resolved_env, venue_id, counterparty_risk_score,
              operational_trust_score, factor_scores_json,
              capital_limit_pct, status, last_evaluated)
             VALUES (?, ?, 'binance', 0.85, 0.85, '{}', 0.5, 'HEALTHY', ?)`
        ).run(TEST_USER, TEST_ENV, ts);
        expect(() => db.prepare(
            `INSERT INTO ml_venue_risk_scores
             (user_id, resolved_env, venue_id, counterparty_risk_score,
              operational_trust_score, factor_scores_json,
              capital_limit_pct, status, last_evaluated)
             VALUES (?, ?, 'binance', 0.70, 0.70, '{}', 0.25, 'DEGRADED', ?)`
        ).run(TEST_USER, TEST_ENV, ts + 1)).toThrow();
    });

    test('CHECK status restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_venue_risk_scores
             (user_id, resolved_env, venue_id, counterparty_risk_score,
              operational_trust_score, factor_scores_json,
              capital_limit_pct, status, last_evaluated)
             VALUES (?, ?, 'x', 0.85, 0.85, '{}', 0.5, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });

    test('CHECK incident_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_venue_incidents
             (user_id, resolved_env, venue_id, incident_type, severity, ts)
             VALUES (?, ?, 'x', 'BOGUS', 'low', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });
});

describe('§87 Constants', () => {
    test('INCIDENT_TYPES has 6 entries', () => {
        expect(vc.INCIDENT_TYPES).toHaveLength(6);
    });

    test('EVALUATION_FACTORS has 7 entries', () => {
        expect(vc.EVALUATION_FACTORS).toHaveLength(7);
    });

    test('VENUE_STATUSES has 4 entries ordered', () => {
        expect(vc.VENUE_STATUSES).toEqual([
            'HEALTHY', 'DEGRADED', 'RESTRICTED', 'MIGRATE'
        ]);
    });

    test('MAX_CONCENTRATION_PCT in (0,1)', () => {
        expect(vc.MAX_CONCENTRATION_PCT).toBeGreaterThan(0);
        expect(vc.MAX_CONCENTRATION_PCT).toBeLessThan(1);
    });
});

describe('§87 computeVenueRiskScore', () => {
    test('all-high factors → high score', () => {
        const r = vc.computeVenueRiskScore({ factorScores: fullScores(0.90) });
        expect(r).toBeCloseTo(0.90);
    });

    test('all-low factors → low score', () => {
        const r = vc.computeVenueRiskScore({ factorScores: fullScores(0.10) });
        expect(r).toBeCloseTo(0.10);
    });

    test('empty factors → 0', () => {
        const r = vc.computeVenueRiskScore({ factorScores: {} });
        expect(r).toBe(0);
    });
});

describe('§87 defineVenue', () => {
    test('healthy score → HEALTHY status', () => {
        const r = vc.defineVenue({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'binance',
            factorScores: fullScores(0.85)
        });
        expect(r.status).toBe('HEALTHY');
    });

    test('low score → MIGRATE status', () => {
        const r = vc.defineVenue({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'risky_venue',
            factorScores: fullScores(0.15)
        });
        expect(r.status).toBe('MIGRATE');
        expect(r.capLimit).toBe(0);
    });
});

describe('§87 recordVenueIncident', () => {
    test('logs incident + degrades score', () => {
        vc.defineVenue({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'binance', factorScores: fullScores(0.85)
        });
        const r = vc.recordVenueIncident({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'binance',
            incidentType: 'api_instability',
            severity: 'high'
        });
        expect(r.degraded).toBe(true);
        expect(r.newScore).toBeLessThan(0.85);
    });

    test('critical incident drops to RESTRICTED/MIGRATE', () => {
        vc.defineVenue({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'shaky',
            factorScores: fullScores(0.55)
        });
        const r = vc.recordVenueIncident({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'shaky',
            incidentType: 'withdrawal_freeze',
            severity: 'critical'
        });
        expect(['RESTRICTED', 'MIGRATE']).toContain(r.newStatus);
    });

    test('throws on invalid incident type', () => {
        expect(() => vc.recordVenueIncident({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'x', incidentType: 'BOGUS', severity: 'low'
        })).toThrow();
    });
});

describe('§87 evaluateVenueExposure', () => {
    test('approved within cap on HEALTHY venue', () => {
        vc.defineVenue({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'binance', factorScores: fullScores(0.90)
        });
        const r = vc.evaluateVenueExposure({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'binance', currentExposurePct: 0.30
        });
        expect(r.allowed).toBe(true);
        expect(r.recommendation).toBe('APPROVED');
    });

    test('concentration limit hit on HEALTHY', () => {
        vc.defineVenue({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'binance', factorScores: fullScores(0.90)
        });
        const r = vc.evaluateVenueExposure({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'binance', currentExposurePct: 0.80
        });
        expect(r.allowed).toBe(false);
    });

    test('MIGRATE venue rejected', () => {
        vc.defineVenue({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'dead', factorScores: fullScores(0.10)
        });
        const r = vc.evaluateVenueExposure({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'dead', currentExposurePct: 0.05
        });
        expect(r.allowed).toBe(false);
        expect(r.recommendation).toBe('MIGRATE_AWAY');
    });

    test('venue not registered', () => {
        const r = vc.evaluateVenueExposure({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'unknown', currentExposurePct: 0.10
        });
        expect(r.hasVenue).toBe(false);
    });
});

describe('§87 recommendDiversification', () => {
    test('flags over-concentration', () => {
        const r = vc.recommendDiversification({
            exposureByVenue: { binance: 0.70, bybit: 0.30 }
        });
        expect(r.diversified).toBe(false);
        expect(r.violations.length).toBe(1);
    });

    test('all venues within cap → diversified', () => {
        const r = vc.recommendDiversification({
            exposureByVenue: { binance: 0.30, bybit: 0.30, okx: 0.20 }
        });
        expect(r.diversified).toBe(true);
    });
});

describe('§87 getIncidentHistory', () => {
    test('filter by severity', () => {
        vc.defineVenue({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'x', factorScores: fullScores(0.85)
        });
        vc.recordVenueIncident({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'x', incidentType: 'api_instability', severity: 'low'
        });
        vc.recordVenueIncident({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'x', incidentType: 'withdrawal_freeze', severity: 'high'
        });
        const high = vc.getIncidentHistory({
            userId: TEST_USER, resolvedEnv: TEST_ENV, severity: 'high'
        });
        expect(high).toHaveLength(1);
    });
});

describe('§87 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9088;
        vc.defineVenue({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            venueId: 'iso', factorScores: fullScores(0.85)
        });
        const s1 = vc.getVenueStatus({
            userId: TEST_USER, resolvedEnv: TEST_ENV, venueId: 'iso'
        });
        const s2 = vc.getVenueStatus({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, venueId: 'iso'
        });
        expect(s1.exists).toBe(true);
        expect(s2.exists).toBe(false);
    });
});
