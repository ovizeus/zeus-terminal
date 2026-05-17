'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-analyzer-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const eventBus = require('../../../server/services/ml/_doctor/eventBus');
const trustScorer = require('../../../server/services/ml/_doctor/trustScorer');
const analyzer = require('../../../server/services/ml/_doctor/analyzer');

const _now = () => Date.now();

function clean() {
    db.prepare("DELETE FROM ml_diagnostic_events").run();
    db.prepare("DELETE FROM ml_module_heartbeats").run();
    eventBus.resetForTest();
    trustScorer.resetForTest();
    analyzer.resetForTest();
}

function seedP0(eventId, ts) {
    db.prepare(`
        INSERT INTO ml_diagnostic_events
        (event_id, severity, module_id, event_type, payload_json, ts)
        VALUES (?, 'P0', 'm', 'alert', '{}', ?)
    `).run(eventId, ts);
}

function seedP1(eventId, moduleId, ts) {
    db.prepare(`
        INSERT INTO ml_diagnostic_events
        (event_id, severity, module_id, event_type, payload_json, ts)
        VALUES (?, 'P1', ?, 'alert', '{}', ?)
    `).run(eventId, moduleId, ts);
}

describe('D-3.5 analyzer (orchestrator + state transition)', () => {
    beforeEach(clean);
    afterAll(() => { clean(); analyzer.stop(); });

    describe('Constants', () => {
        test('COGNITIVE_STATES match FAILURE_ONTOLOGY 5', () => {
            expect(analyzer.COGNITIVE_STATES).toEqual([
                'HEALTHY', 'DEGRADED', 'COMPROMISED', 'SAFE_MODE', 'DEAD'
            ]);
        });
        test('ANALYZER_INTERVAL_MS = 5000 per plan', () => {
            expect(analyzer.ANALYZER_INTERVAL_MS).toBe(5000);
        });
    });

    describe('computeCognitiveState (pure)', () => {
        test('all clean → HEALTHY', () => {
            const state = analyzer.computeCognitiveState({
                activeP0: 0, activeP1: 0,
                hotPathCriticalQuarantined: 0,
                hotPathAssistQuarantined: 0,
                doctorHeartbeatStale: false,
                moneyFrozen: false,
                dbIntegrityFail: false,
                nowTs: _now()
            });
            expect(state.state).toBe('HEALTHY');
        });

        test('1 active P1 → DEGRADED', () => {
            const state = analyzer.computeCognitiveState({
                activeP0: 0, activeP1: 1,
                hotPathCriticalQuarantined: 0,
                hotPathAssistQuarantined: 0,
                doctorHeartbeatStale: false,
                moneyFrozen: false,
                dbIntegrityFail: false,
                nowTs: _now()
            });
            expect(state.state).toBe('DEGRADED');
        });

        test('active P0 → COMPROMISED', () => {
            const state = analyzer.computeCognitiveState({
                activeP0: 1, activeP1: 0,
                hotPathCriticalQuarantined: 0,
                hotPathAssistQuarantined: 0,
                doctorHeartbeatStale: false,
                moneyFrozen: false,
                dbIntegrityFail: false,
                nowTs: _now()
            });
            expect(state.state).toBe('COMPROMISED');
        });

        test('hot_path_critical quarantined → COMPROMISED', () => {
            const state = analyzer.computeCognitiveState({
                activeP0: 0, activeP1: 0,
                hotPathCriticalQuarantined: 1,
                hotPathAssistQuarantined: 0,
                doctorHeartbeatStale: false,
                moneyFrozen: false,
                dbIntegrityFail: false,
                nowTs: _now()
            });
            expect(state.state).toBe('COMPROMISED');
        });

        test('2+ hot_path_assist quarantined → COMPROMISED', () => {
            const state = analyzer.computeCognitiveState({
                activeP0: 0, activeP1: 0,
                hotPathCriticalQuarantined: 0,
                hotPathAssistQuarantined: 2,
                doctorHeartbeatStale: false,
                moneyFrozen: false,
                dbIntegrityFail: false,
                nowTs: _now()
            });
            expect(state.state).toBe('COMPROMISED');
        });

        test('Doctor self-stale → COMPROMISED', () => {
            const state = analyzer.computeCognitiveState({
                activeP0: 0, activeP1: 0,
                hotPathCriticalQuarantined: 0,
                hotPathAssistQuarantined: 0,
                doctorHeartbeatStale: true,
                moneyFrozen: false,
                dbIntegrityFail: false,
                nowTs: _now()
            });
            expect(state.state).toBe('COMPROMISED');
        });

        test('3+ hot_path_critical quarantined → SAFE_MODE', () => {
            const state = analyzer.computeCognitiveState({
                activeP0: 0, activeP1: 0,
                hotPathCriticalQuarantined: 3,
                hotPathAssistQuarantined: 0,
                doctorHeartbeatStale: false,
                moneyFrozen: false,
                dbIntegrityFail: false,
                nowTs: _now()
            });
            expect(state.state).toBe('SAFE_MODE');
        });

        test('money frozen → SAFE_MODE', () => {
            const state = analyzer.computeCognitiveState({
                activeP0: 1, activeP1: 0,
                hotPathCriticalQuarantined: 0,
                hotPathAssistQuarantined: 0,
                doctorHeartbeatStale: false,
                moneyFrozen: true,
                dbIntegrityFail: false,
                nowTs: _now()
            });
            expect(state.state).toBe('SAFE_MODE');
        });

        test('DB integrity fail → DEAD', () => {
            const state = analyzer.computeCognitiveState({
                activeP0: 0, activeP1: 0,
                hotPathCriticalQuarantined: 0,
                hotPathAssistQuarantined: 0,
                doctorHeartbeatStale: false,
                moneyFrozen: false,
                dbIntegrityFail: true,
                nowTs: _now()
            });
            expect(state.state).toBe('DEAD');
        });

        test('reason string explains state', () => {
            const state = analyzer.computeCognitiveState({
                activeP0: 1, activeP1: 0,
                hotPathCriticalQuarantined: 0,
                hotPathAssistQuarantined: 0,
                doctorHeartbeatStale: false,
                moneyFrozen: false,
                dbIntegrityFail: false,
                nowTs: _now()
            });
            expect(state.reason).toMatch(/P0/);
        });
    });

    describe('analyze (orchestrator one-shot)', () => {
        test('returns state + quotaStatus + lowTrustModules + downweightedModules', () => {
            const result = analyzer.analyze({ nowTs: _now() });
            expect(result.state).toBe('HEALTHY');
            expect(result.quotaStatus).toBeDefined();
            expect(result.quotaStatus.p0_24h).toBe(0);
            expect(result.lowTrustModules).toEqual([]);
            expect(result.downweightedModules).toEqual([]);
        });

        test('detects P0 via persistent log', () => {
            seedP0('p0_alert', _now());
            const result = analyzer.analyze({ nowTs: _now() });
            expect(result.state).toBe('COMPROMISED');
            expect(result.activeP0).toBe(1);
        });

        test('emits state_change event when state transitions', () => {
            const received = [];
            eventBus.subscribe('state_change', e => received.push(e));
            // First run: HEALTHY
            analyzer.analyze({ nowTs: _now() });
            // Inject a P0
            seedP0('p0_trans', _now());
            // Second run: should emit state_change HEALTHY → COMPROMISED
            analyzer.analyze({ nowTs: _now() });
            const stateChange = received.find(e =>
                e.payload && e.payload.from === 'HEALTHY' && e.payload.to === 'COMPROMISED'
            );
            expect(stateChange).toBeTruthy();
        });

        test('does NOT emit state_change when state stable', () => {
            const received = [];
            eventBus.subscribe('state_change', e => received.push(e));
            // First call to bootstrap
            analyzer.analyze({ nowTs: _now() });
            received.length = 0;  // clear bootstrap event
            // Second call same state
            analyzer.analyze({ nowTs: _now() });
            expect(received.length).toBe(0);
        });
    });

    describe('getCurrentState', () => {
        test('returns last computed state', () => {
            analyzer.analyze({ nowTs: _now() });
            expect(analyzer.getCurrentState()).toBe('HEALTHY');
        });

        test('null before first analyze', () => {
            analyzer.resetForTest();
            expect(analyzer.getCurrentState()).toBeNull();
        });
    });

    describe('Lifecycle', () => {
        test('start() is idempotent', () => {
            analyzer.start();
            analyzer.start();
            analyzer.stop();
            expect(() => analyzer.start()).not.toThrow();
            analyzer.stop();
        });
    });

    describe('Validation', () => {
        test('analyze rejects missing nowTs', () => {
            expect(() => analyzer.analyze({})).toThrow(/nowTs/);
        });
        test('computeCognitiveState rejects missing fields', () => {
            expect(() => analyzer.computeCognitiveState({})).toThrow();
        });
    });
});
