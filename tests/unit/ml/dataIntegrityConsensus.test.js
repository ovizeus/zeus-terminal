'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-w3-p60-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_DB_PATH = TEST_DB_PATH;
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const di = require('../../../server/services/ml/R3A_safety/dataIntegrityConsensus');

const TEST_USER = 9060;
const TEST_ENV = 'DEMO';
const SRC = 'binance_l2';

function cleanRows() {
    db.prepare('DELETE FROM ml_source_trust WHERE user_id IN (?, ?)').run(TEST_USER, 9061);
    db.prepare('DELETE FROM ml_anomaly_events WHERE user_id IN (?, ?)').run(TEST_USER, 9061);
}

beforeEach(() => cleanRows());
afterAll(() => {
    try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('§60 Migrations 106 + 107', () => {
    test('ml_source_trust exists with expected columns', () => {
        const cols = db.prepare(`PRAGMA table_info(ml_source_trust)`).all().map(c => c.name);
        expect(cols).toEqual(expect.arrayContaining([
            'user_id', 'resolved_env', 'source_id', 'trust_score',
            'total_observations', 'anomaly_count', 'status', 'updated_at'
        ]));
    });

    test('ml_anomaly_events CHECK anomaly_type restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_anomaly_events
             (user_id, resolved_env, source_id, anomaly_type, severity, ts)
             VALUES (?, ?, 'src', 'BOGUS', 'low', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('ml_anomaly_events CHECK severity restricts', () => {
        expect(() => db.prepare(
            `INSERT INTO ml_anomaly_events
             (user_id, resolved_env, source_id, anomaly_type, severity, ts)
             VALUES (?, ?, 'src', 'venue_anomaly', 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, Date.now())).toThrow();
    });

    test('ml_source_trust CHECK status restricts', () => {
        const ts = Date.now();
        expect(() => db.prepare(
            `INSERT INTO ml_source_trust
             (user_id, resolved_env, source_id, trust_score, status, updated_at)
             VALUES (?, ?, 'src', 1.0, 'BOGUS', ?)`
        ).run(TEST_USER, TEST_ENV, ts)).toThrow();
    });
});

describe('§60 Constants', () => {
    test('ANOMALY_TYPES has 6 entries', () => {
        expect(di.ANOMALY_TYPES).toEqual([
            'impossible_print', 'ts_spoof', 'packet_corrupt',
            'venue_anomaly', 'sentiment_burst', 'signal_burst'
        ]);
    });

    test('SOURCE_STATUSES has 3 entries', () => {
        expect(di.SOURCE_STATUSES).toEqual(['TRUSTED', 'DEGRADED', 'EXCLUDED']);
    });

    test('SEVERITY_LEVELS has 3 entries', () => {
        expect(di.SEVERITY_LEVELS).toEqual(['low', 'med', 'high']);
    });
});

describe('§60 detectImpossiblePrint', () => {
    test('normal price returns no anomaly', () => {
        const r = di.detectImpossiblePrint({ price: 100, prevPrice: 99.5 });
        expect(r.anomaly).toBe(false);
    });

    test('negative price flagged', () => {
        const r = di.detectImpossiblePrint({ price: -10 });
        expect(r.anomaly).toBe(true);
        expect(r.severity).toBe('high');
    });

    test('zero price flagged', () => {
        const r = di.detectImpossiblePrint({ price: 0 });
        expect(r.anomaly).toBe(true);
    });

    test('NaN price flagged', () => {
        const r = di.detectImpossiblePrint({ price: NaN });
        expect(r.anomaly).toBe(true);
    });

    test('huge jump (>50%) flagged', () => {
        const r = di.detectImpossiblePrint({ price: 200, prevPrice: 100 });
        expect(r.anomaly).toBe(true);
        expect(r.reason).toBe('huge_jump');
    });

    test('reverse spread flagged', () => {
        const r = di.detectImpossiblePrint({ price: 100, spread: -1 });
        expect(r.anomaly).toBe(true);
        expect(r.reason).toBe('reverse_spread');
    });
});

describe('§60 detectTimestampSpoofing', () => {
    test('current ts no anomaly', () => {
        const now = Date.now();
        const r = di.detectTimestampSpoofing({ ts: now, now });
        expect(r.anomaly).toBe(false);
    });

    test('future ts flagged high', () => {
        const now = Date.now();
        const r = di.detectTimestampSpoofing({ ts: now + 60000, now });
        expect(r.anomaly).toBe(true);
        expect(r.severity).toBe('high');
    });

    test('past ts (rewind) flagged med', () => {
        const now = Date.now();
        const r = di.detectTimestampSpoofing({
            ts: now - 60000, now, prevTs: now - 10000
        });
        expect(r.anomaly).toBe(true);
        expect(r.severity).toBe('med');
    });
});

describe('§60 detectVenueAnomaly', () => {
    test('aligned price = no anomaly', () => {
        const r = di.detectVenueAnomaly({
            sourcePrice: 100, consensusPrice: 100.1, threshold: 0.02
        });
        expect(r.anomaly).toBe(false);
    });

    test('diverged price flagged', () => {
        const r = di.detectVenueAnomaly({
            sourcePrice: 95, consensusPrice: 100, threshold: 0.02
        });
        expect(r.anomaly).toBe(true);
        expect(r.divergence).toBeCloseTo(0.05);
    });

    test('severity scales with divergence', () => {
        const low = di.detectVenueAnomaly({
            sourcePrice: 102.5, consensusPrice: 100, threshold: 0.02
        });
        const high = di.detectVenueAnomaly({
            sourcePrice: 120, consensusPrice: 100, threshold: 0.02
        });
        expect(low.severity).toBe('low');
        expect(high.severity).toBe('high');
    });
});

describe('§60 getConsensus', () => {
    test('returns median + IQR outliers', () => {
        const observations = [
            { source: 'a', value: 100 },
            { source: 'b', value: 101 },
            { source: 'c', value: 102 },
            { source: 'd', value: 99 },
            { source: 'e', value: 500 }   // outlier
        ];
        const r = di.getConsensus({ observations });
        expect(r.median).toBeCloseTo(101);
        expect(r.outliers.length).toBeGreaterThanOrEqual(1);
        expect(r.outliers.some(o => o.source === 'e')).toBe(true);
    });

    test('empty observations returns zero median', () => {
        const r = di.getConsensus({ observations: [] });
        expect(r.median).toBe(0);
        expect(r.outliers).toEqual([]);
    });
});

describe('§60 updateTrustScore', () => {
    test('initializes source on first call', () => {
        const r = di.updateTrustScore({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sourceId: SRC, delta: -0.1, isAnomaly: true
        });
        expect(r.newTrust).toBeCloseTo(0.9);
        expect(r.newStatus).toBe('TRUSTED');
    });

    test('TRUSTED → DEGRADED transition', () => {
        // Start at 1.0, subtract enough to land in [0.20, 0.50) band → DEGRADED
        for (let i = 0; i < 7; i++) {
            di.updateTrustScore({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                sourceId: SRC, delta: -0.08, isAnomaly: true
            });
        }
        const r = di.getSourceTrust({
            userId: TEST_USER, resolvedEnv: TEST_ENV, sourceId: SRC
        });
        expect(r.trustScore).toBeLessThan(di.TRUST_DEGRADED_THRESHOLD);
        expect(r.trustScore).toBeGreaterThan(di.TRUST_EXCLUDED_THRESHOLD);
        expect(r.status).toBe('DEGRADED');
    });

    test('DEGRADED → EXCLUDED transition', () => {
        for (let i = 0; i < 15; i++) {
            di.updateTrustScore({
                userId: TEST_USER, resolvedEnv: TEST_ENV,
                sourceId: SRC, delta: -0.10, isAnomaly: true
            });
        }
        const r = di.getSourceTrust({
            userId: TEST_USER, resolvedEnv: TEST_ENV, sourceId: SRC
        });
        expect(r.trustScore).toBeLessThan(di.TRUST_EXCLUDED_THRESHOLD);
        expect(r.status).toBe('EXCLUDED');
    });
});

describe('§60 recordAnomaly', () => {
    test('persists anomaly + decays trust', () => {
        const r = di.recordAnomaly({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sourceId: SRC, anomalyType: 'impossible_print',
            severity: 'high',
            details: { price: -1 }
        });
        expect(r.newTrust).toBeLessThan(1.0);

        const events = db.prepare(
            `SELECT * FROM ml_anomaly_events WHERE user_id = ?`
        ).all(TEST_USER);
        expect(events).toHaveLength(1);
        expect(events[0].anomaly_type).toBe('impossible_print');
    });

    test('throws on invalid anomalyType', () => {
        expect(() => di.recordAnomaly({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sourceId: SRC, anomalyType: 'BOGUS', severity: 'low'
        })).toThrow();
    });

    test('throws on invalid severity', () => {
        expect(() => di.recordAnomaly({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sourceId: SRC, anomalyType: 'venue_anomaly', severity: 'fatal'
        })).toThrow();
    });
});

describe('§60 getSourceTrust', () => {
    test('returns defaults when source not seen', () => {
        const r = di.getSourceTrust({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sourceId: 'unseen_source'
        });
        expect(r.exists).toBe(false);
        expect(r.trustScore).toBe(di.INITIAL_TRUST);
    });
});

describe('§60 isolation', () => {
    test('per (user × env) isolation', () => {
        const OTHER_USER = 9061;
        di.updateTrustScore({
            userId: TEST_USER, resolvedEnv: TEST_ENV,
            sourceId: SRC, delta: -0.5, isAnomaly: true
        });
        const r1 = di.getSourceTrust({
            userId: TEST_USER, resolvedEnv: TEST_ENV, sourceId: SRC
        });
        const r2 = di.getSourceTrust({
            userId: OTHER_USER, resolvedEnv: TEST_ENV, sourceId: SRC
        });
        expect(r1.exists).toBe(true);
        expect(r2.exists).toBe(false);
    });
});
