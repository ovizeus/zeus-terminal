// Zeus Terminal — Unit Tests: ML_INGEST_ENABLED flag wiring in brainLogger
// Tests that brainLogger writes to ml_decision_snapshots + ml_decision_light
// only when the flag is enabled, and never crashes on ML table errors.
'use strict';

const BetterSqlite3 = require('better-sqlite3');

// ── Controllable flags (must be prefixed 'mock' to be usable in jest.mock factories) ──
let mockIngestFlag = false;

// ── Shared in-memory db reference (prefixed 'mock' so jest.mock can access it) ──
// We initialise lazily so tests can mutate it.
let mockDb = null;

jest.mock('../../server/migrationFlags', () => ({
    get ML_INGEST_ENABLED() { return mockIngestFlag; },
    get ML_PIPELINE_SHADOW() { return false; },
    get ML_DEMO_INFLUENCE_ENABLED() { return false; },
    get SERVER_BRAIN_DEMO() { return false; },
    get SERVER_AT_DEMO() { return false; },
    get PARITY_SHADOW_ENABLED() { return false; },
    get ALT_WS_FEEDS() { return false; },
    get SERVER_MARKET_DATA() { return false; },
    get SERVER_BRAIN() { return false; },
    get SERVER_AT() { return false; },
    get CLIENT_BRAIN() { return true; },
    get CLIENT_AT() { return true; },
    get POSITIONS_WS() { return false; },
    get BYBIT_TESTNET_ENABLED() { return false; },
    get BYBIT_LIVE_ENABLED() { return false; },
}));

jest.mock('../../server/services/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

jest.mock('../../server/services/database', () => ({
    get db() { return mockDb; },
    bdInsert(snapId, userId, symbol, ts, cycle, sourcePath, finalTier, finalConf, finalDir, finalAction, linkedSeq, data) {
        mockDb.prepare(
            'INSERT OR IGNORE INTO brain_decisions ' +
            '(snap_id, user_id, symbol, ts, cycle, source_path, final_tier, final_conf, final_dir, final_action, linked_seq, data) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(snapId, userId, symbol, ts, cycle, sourcePath, finalTier, finalConf, finalDir, finalAction, linkedSeq,
            typeof data === 'string' ? data : JSON.stringify(data));
    },
    bdLinkSeq: jest.fn(),
    bdUpdateData: jest.fn(),
    bdUpdateAction: jest.fn(),
    bdGetBySnap: jest.fn(() => null),
    bdGetBySeq: jest.fn(() => []),
    bdPrune: jest.fn(),
    bdCount: jest.fn(() => []),
}));

// ── Helpers ──
function createSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS brain_decisions (
            snap_id TEXT PRIMARY KEY,
            user_id INTEGER,
            symbol TEXT,
            ts INTEGER,
            cycle INTEGER,
            source_path TEXT,
            final_tier TEXT,
            final_conf REAL,
            final_dir TEXT,
            final_action TEXT,
            linked_seq TEXT,
            data TEXT
        );
        CREATE TABLE IF NOT EXISTS ml_decision_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol TEXT NOT NULL,
            snapshot_event_type TEXT NOT NULL CHECK(snapshot_event_type IN (
                'TRADE','ABSTAIN_CRITIC','NEAR_THRESHOLD','OPERATOR_OVERRIDE',
                'QUARANTINE_TRIGGER','PROMOTION_TRIGGER','ANOMALY_DRIFT'
            )),
            decision_digest TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            registry_digest TEXT NOT NULL,
            input_snapshot_ref TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ml_decision_light (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            resolved_env TEXT NOT NULL CHECK(resolved_env IN ('DEMO','TESTNET','REAL')),
            symbol TEXT NOT NULL,
            decision_digest TEXT NOT NULL,
            score REAL,
            top5_features_json TEXT,
            abstain_count INTEGER NOT NULL DEFAULT 0,
            reason_code TEXT,
            created_at INTEGER NOT NULL
        );
    `);
}

const countBd = () => mockDb.prepare('SELECT COUNT(*) as c FROM brain_decisions').get().c;
const countSnap = () => mockDb.prepare('SELECT COUNT(*) as c FROM ml_decision_snapshots').get().c;
const countLight = () => mockDb.prepare('SELECT COUNT(*) as c FROM ml_decision_light').get().c;

function makeFields(overrides = {}) {
    return {
        userId: 1,
        symbol: 'BTCUSDT',
        ts: Date.now(),
        cycle: 1,
        sourcePath: 'test',
        finalTier: 'TIER1',
        finalAction: 'enter_long',
        finalConfidence: 80,
        finalDir: 'long',
        ...overrides,
    };
}

// Load brainLogger after mocks are registered
const brainLogger = require('../../server/services/brainLogger');

beforeEach(() => {
    // Fresh in-memory db for each test
    mockDb = new BetterSqlite3(':memory:');
    createSchema(mockDb);
    mockIngestFlag = false;
});

afterEach(() => {
    if (mockDb) {
        mockDb.close();
        mockDb = null;
    }
});

// ══════════════════════════════════════════════════════════════════
// Test 1: ML_INGEST_ENABLED=false → only brain_decisions written
// ══════════════════════════════════════════════════════════════════
test('ML_INGEST_ENABLED=false → writes brain_decisions only, NOT ml_decision_snapshots', () => {
    mockIngestFlag = false;

    const snapId = brainLogger.logDecision(makeFields());

    expect(snapId).not.toBeNull();
    expect(countBd()).toBe(1);
    expect(countSnap()).toBe(0);
    expect(countLight()).toBe(0);
});

// ══════════════════════════════════════════════════════════════════
// Test 2: ML_INGEST_ENABLED=true → writes BOTH tables
// ══════════════════════════════════════════════════════════════════
test('ML_INGEST_ENABLED=true → writes brain_decisions AND ml_decision_snapshots AND ml_decision_light', () => {
    mockIngestFlag = true;

    const snapId = brainLogger.logDecision(makeFields());

    expect(snapId).not.toBeNull();
    expect(countBd()).toBe(1);
    expect(countSnap()).toBe(1);
    expect(countLight()).toBe(1);
});

// ══════════════════════════════════════════════════════════════════
// Test 3: ML snapshot table error → brain_decisions still written, no crash
// ══════════════════════════════════════════════════════════════════
test('ML_INGEST_ENABLED=true + snapshot table error → brain_decisions still written, no crash', () => {
    mockIngestFlag = true;

    // Drop the ML tables to force an error on ML write
    mockDb.exec('DROP TABLE ml_decision_snapshots; DROP TABLE ml_decision_light;');

    let snapId;
    expect(() => {
        snapId = brainLogger.logDecision(makeFields({ cycle: 2 }));
    }).not.toThrow();

    // brain_decisions must still be written despite ML error
    expect(countBd()).toBe(1);
    // snapId is returned (brain_decisions succeeded)
    expect(snapId).not.toBeNull();
});

// ══════════════════════════════════════════════════════════════════
// influenceEligibility flag-gate tests (Task 2)
// ══════════════════════════════════════════════════════════════════

// Isolated mock setup for influenceEligibility — separate describe block
// so it does not interfere with brainLogger mocks above.
describe('influenceEligibility flag gates', () => {
    let mockShadowFlag;
    let mockDemoInfluenceFlag;
    let mockTestnetInfluenceFlag;
    let mockLiveInfluenceFlag;

    jest.mock('../../server/services/ml/_ring5/banditPosteriors', () => ({
        getPosterior: jest.fn(() => null),
    }));

    jest.mock('../../server/services/ml/R5B_governance/versionRegistry', () => ({
        getActive: jest.fn(() => null),
    }));

    jest.mock('../../server/services/ml/R5B_governance/preRegistration', () => ({
        getRegistrationsForVersion: jest.fn(() => []),
    }));

    // Override the migrationFlags mock (already registered above) with getters
    // that reference our local let variables so each test can control them.
    // Note: jest.mock is hoisted; we use jest.doMock inside beforeAll is not
    // possible here — instead we mutate the existing mock module at runtime
    // via module registry manipulation. Simpler: require after setting module
    // property via jest.resetModules approach. Since brainLogger tests already
    // require migrationFlags via the top-level mock, we use a fresh registry
    // for this describe block.

    let checkEligibility;

    beforeAll(() => {
        jest.resetModules();
        mockShadowFlag = false;
        mockDemoInfluenceFlag = false;
        mockTestnetInfluenceFlag = false;
        mockLiveInfluenceFlag = false;

        jest.doMock('../../server/migrationFlags', () => ({
            get ML_PIPELINE_SHADOW() { return mockShadowFlag; },
            get ML_DEMO_INFLUENCE_ENABLED() { return mockDemoInfluenceFlag; },
            get ML_TESTNET_INFLUENCE_ENABLED() { return mockTestnetInfluenceFlag; },
            get ML_LIVE_INFLUENCE_ENABLED() { return mockLiveInfluenceFlag; },
            get ML_INGEST_ENABLED() { return false; },
            get SERVER_BRAIN_DEMO() { return false; },
            get SERVER_AT_DEMO() { return false; },
            get PARITY_SHADOW_ENABLED() { return false; },
            get ALT_WS_FEEDS() { return false; },
            get SERVER_MARKET_DATA() { return false; },
            get SERVER_BRAIN() { return false; },
            get SERVER_AT() { return false; },
            get CLIENT_BRAIN() { return true; },
            get CLIENT_AT() { return true; },
            get POSITIONS_WS() { return false; },
            get BYBIT_TESTNET_ENABLED() { return false; },
            get BYBIT_LIVE_ENABLED() { return false; },
        }));

        jest.doMock('../../server/services/ml/_ring5/banditPosteriors', () => ({
            getPosterior: jest.fn(() => null),
        }));

        jest.doMock('../../server/services/ml/R5B_governance/versionRegistry', () => ({
            getActive: jest.fn(() => null),
        }));

        jest.doMock('../../server/services/ml/R5B_governance/preRegistration', () => ({
            getRegistrationsForVersion: jest.fn(() => []),
        }));

        const mod = require('../../server/services/ml/_ring5/influenceEligibility');
        checkEligibility = mod.checkEligibility;
    });

    afterAll(() => {
        jest.resetModules();
    });

    const BASE_PARAMS = {
        userId: 1,
        env: 'DEMO',
        symbol: 'BTCUSDT',
        regime: 'trend',
        nowTs: Date.now(),
    };

    // ── Test 4: ML_PIPELINE_SHADOW=false → ml_pipeline_shadow_disabled ──
    test('ML_PIPELINE_SHADOW=false → returns ml_pipeline_shadow_disabled', () => {
        mockShadowFlag = false;
        mockDemoInfluenceFlag = true;

        const result = checkEligibility(BASE_PARAMS);

        expect(result.eligible).toBe(false);
        expect(result.reason).toBe('ml_pipeline_shadow_disabled');
        expect(result.observationCount).toBe(0);
    });

    // ── Test 5: shadow=true + DEMO + ML_DEMO_INFLUENCE_ENABLED=false → influence_disabled_for_env ──
    test('ML_PIPELINE_SHADOW=true + env DEMO + ML_DEMO_INFLUENCE_ENABLED=false → returns influence_disabled_for_env', () => {
        mockShadowFlag = true;
        mockDemoInfluenceFlag = false;

        const result = checkEligibility({ ...BASE_PARAMS, env: 'DEMO' });

        expect(result.eligible).toBe(false);
        expect(result.reason).toBe('influence_disabled_for_env');
        expect(result.env).toBe('DEMO');
        expect(result.observationCount).toBe(0);
    });

    // ── Test 6: shadow=true + DEMO + ML_DEMO_INFLUENCE_ENABLED=true → falls through to insufficient_observations ──
    test('ML_PIPELINE_SHADOW=true + env DEMO + ML_DEMO_INFLUENCE_ENABLED=true → falls through to insufficient_observations', () => {
        mockShadowFlag = true;
        mockDemoInfluenceFlag = true;

        const result = checkEligibility({ ...BASE_PARAMS, env: 'DEMO' });

        expect(result.eligible).toBe(false);
        expect(result.reason).toBe('insufficient_observations');
        expect(result.observationCount).toBe(0);
    });
});
