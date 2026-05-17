'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-shed-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

require('../../../server/services/database');
const eventBus = require('../../../server/services/ml/_doctor/eventBus');
const shedManager = require('../../../server/services/ml/_doctor/shedManager');

const _now = () => Date.now();

function clean() {
    eventBus.resetForTest();
    shedManager.resetForTest();
}

describe('D-5.3 shedManager', () => {
    beforeEach(clean);

    describe('Constants per FAILURE_ONTOLOGY', () => {
        test('SHED_STATES 1-4', () => {
            expect(shedManager.SHED_STATES).toEqual([1, 2, 3, 4]);
        });
        test('default state = 1 (full cognition)', () => {
            expect(shedManager.getCurrentState()).toBe(1);
        });
        test('SHED_THRESHOLDS map present', () => {
            expect(shedManager.SHED_THRESHOLDS).toBeDefined();
            // pressure thresholds for auto-promotion
            expect(shedManager.SHED_THRESHOLDS[2]).toBe(0.50);
            expect(shedManager.SHED_THRESHOLDS[3]).toBe(0.75);
            expect(shedManager.SHED_THRESHOLDS[4]).toBe(0.90);
        });
    });

    describe('isModuleSheddedAtState (pure)', () => {
        test('state 1 sheds nothing', () => {
            expect(shedManager.isModuleSheddedAtState({
                roleTag: 'philosophical', state: 1
            })).toBe(false);
            expect(shedManager.isModuleSheddedAtState({
                roleTag: 'forensic', state: 1
            })).toBe(false);
        });

        test('state 2 sheds philosophical + introspection_meta', () => {
            expect(shedManager.isModuleSheddedAtState({
                roleTag: 'philosophical', state: 2
            })).toBe(true);
            expect(shedManager.isModuleSheddedAtState({
                roleTag: 'introspection_meta', state: 2
            })).toBe(true);
            expect(shedManager.isModuleSheddedAtState({
                roleTag: 'forensic', state: 2
            })).toBe(false);
            expect(shedManager.isModuleSheddedAtState({
                roleTag: 'hot_path_critical', state: 2
            })).toBe(false);
        });

        test('state 3 sheds forensic + everything below', () => {
            expect(shedManager.isModuleSheddedAtState({
                roleTag: 'forensic', state: 3
            })).toBe(true);
            expect(shedManager.isModuleSheddedAtState({
                roleTag: 'philosophical', state: 3
            })).toBe(true);
            expect(shedManager.isModuleSheddedAtState({
                roleTag: 'governance', state: 3
            })).toBe(false);
            expect(shedManager.isModuleSheddedAtState({
                roleTag: 'hot_path_critical', state: 3
            })).toBe(false);
        });

        test('state 4 sheds everything except hot_path_critical', () => {
            expect(shedManager.isModuleSheddedAtState({
                roleTag: 'governance', state: 4
            })).toBe(true);
            expect(shedManager.isModuleSheddedAtState({
                roleTag: 'hot_path_assist', state: 4
            })).toBe(true);
            expect(shedManager.isModuleSheddedAtState({
                roleTag: 'shadow_assist', state: 4
            })).toBe(true);
            expect(shedManager.isModuleSheddedAtState({
                roleTag: 'hot_path_critical', state: 4
            })).toBe(false);
        });
    });

    describe('isCurrentlyShed', () => {
        test('uses current state', () => {
            shedManager.setState({ state: 2, reason: 'pressure', ts: _now() });
            expect(shedManager.isCurrentlyShed({ roleTag: 'philosophical' })).toBe(true);
            expect(shedManager.isCurrentlyShed({ roleTag: 'governance' })).toBe(false);
        });
    });

    describe('setState (manual)', () => {
        test('updates current state', () => {
            shedManager.setState({ state: 3, reason: 'test', ts: _now() });
            expect(shedManager.getCurrentState()).toBe(3);
        });

        test('emits shed_state event on transition', () => {
            const received = [];
            eventBus.subscribe('shed_state', e => received.push(e));
            shedManager.setState({ state: 2, reason: 'manual', ts: _now() });
            expect(received.length).toBe(1);
            expect(received[0].payload.from).toBe(1);
            expect(received[0].payload.to).toBe(2);
        });

        test('does NOT emit when state unchanged', () => {
            shedManager.setState({ state: 2, reason: 'first', ts: _now() });
            const received = [];
            eventBus.subscribe('shed_state', e => received.push(e));
            shedManager.setState({ state: 2, reason: 'same', ts: _now() });
            expect(received.length).toBe(0);
        });

        test('rejects invalid state', () => {
            expect(() => shedManager.setState({
                state: 5, reason: 'r', ts: _now()
            })).toThrow(/SHED_STATES/);
            expect(() => shedManager.setState({
                state: 0, reason: 'r', ts: _now()
            })).toThrow(/SHED_STATES/);
        });
    });

    describe('autoEvaluate', () => {
        test('promotes from 1 → 2 when pressure >= 0.50', () => {
            const r = shedManager.autoEvaluate({ pressureScore: 0.55, ts: _now() });
            expect(r.newState).toBe(2);
            expect(shedManager.getCurrentState()).toBe(2);
        });

        test('promotes from 1 → 3 when pressure >= 0.75', () => {
            const r = shedManager.autoEvaluate({ pressureScore: 0.80, ts: _now() });
            expect(r.newState).toBe(3);
        });

        test('promotes from 1 → 4 when pressure >= 0.90', () => {
            const r = shedManager.autoEvaluate({ pressureScore: 0.95, ts: _now() });
            expect(r.newState).toBe(4);
        });

        test('stays at 1 when pressure < 0.50', () => {
            const r = shedManager.autoEvaluate({ pressureScore: 0.30, ts: _now() });
            expect(r.newState).toBe(1);
        });

        test('downgrades when pressure drops (auto recovery)', () => {
            shedManager.setState({ state: 3, reason: 'p', ts: _now() });
            const r = shedManager.autoEvaluate({ pressureScore: 0.20, ts: _now() });
            expect(r.newState).toBe(1);
        });

        test('rejects pressure outside [0,1]', () => {
            expect(() => shedManager.autoEvaluate({
                pressureScore: 1.5, ts: _now()
            })).toThrow(/pressureScore/);
            expect(() => shedManager.autoEvaluate({
                pressureScore: -0.1, ts: _now()
            })).toThrow(/pressureScore/);
        });
    });

    describe('Validation', () => {
        test('isModuleSheddedAtState rejects invalid state', () => {
            expect(() => shedManager.isModuleSheddedAtState({
                roleTag: 'forensic', state: 5
            })).toThrow();
        });
    });
});
