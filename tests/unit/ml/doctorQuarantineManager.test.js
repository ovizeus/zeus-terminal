'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-qm-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const eventBus = require('../../../server/services/ml/_doctor/eventBus');
const qm = require('../../../server/services/ml/_doctor/quarantineManager');

const _now = () => Date.now();

function clean() {
    db.prepare("DELETE FROM ml_module_quarantines").run();
    eventBus.resetForTest();
    qm.resetForTest();
}

describe('D-5.2 quarantineManager', () => {
    beforeEach(clean);

    describe('Constants', () => {
        test('ACTIONS frozen 3', () => {
            expect(qm.ACTIONS).toEqual(['clamp_influence', 'shadow_only', 'disable']);
        });
        test('COOLDOWN_MS = 3600000 (1h)', () => {
            expect(qm.COOLDOWN_MS).toBe(3600000);
        });
        test('MAX_PER_DAY = 3', () => {
            expect(qm.MAX_PER_DAY).toBe(3);
        });
    });

    describe('quarantine', () => {
        test('inserts active quarantine row', () => {
            const r = qm.quarantine({
                moduleId: 'modX', action: 'clamp_influence',
                reason: 'low trust', ts: _now()
            });
            expect(r.quarantined).toBe(true);
            const row = db.prepare(`
                SELECT * FROM ml_module_quarantines
                WHERE module_id = ? AND lifted_at IS NULL
            `).get('modX');
            expect(row).toBeTruthy();
            expect(row.quarantine_action).toBe('clamp_influence');
        });

        test('emits quarantine event', () => {
            const received = [];
            eventBus.subscribe('quarantine', e => received.push(e));
            qm.quarantine({
                moduleId: 'modEv', action: 'shadow_only',
                reason: 'fp rate high', ts: _now()
            });
            expect(received.length).toBe(1);
            expect(received[0].moduleId).toBe('modEv');
        });

        test('rejects invalid action', () => {
            expect(() => qm.quarantine({
                moduleId: 'm', action: 'bad', reason: 'r', ts: _now()
            })).toThrow(/action/);
        });

        test('rejects re-quarantining already-active module', () => {
            qm.quarantine({
                moduleId: 'modDup', action: 'clamp_influence',
                reason: 'r1', ts: _now()
            });
            expect(() => qm.quarantine({
                moduleId: 'modDup', action: 'shadow_only',
                reason: 'r2', ts: _now()
            })).toThrow(/already.*active/);
        });

        test('records operator_id when provided', () => {
            qm.quarantine({
                moduleId: 'modOp', action: 'disable',
                reason: 'manual', operatorId: 1, ts: _now()
            });
            const row = db.prepare(`SELECT operator_id FROM ml_module_quarantines WHERE module_id = ?`).get('modOp');
            expect(row.operator_id).toBe(1);
        });
    });

    describe('lift (unquarantine)', () => {
        test('marks lifted_at + lift_reason', () => {
            const t0 = _now();
            qm.quarantine({
                moduleId: 'modLift', action: 'clamp_influence',
                reason: 'r', ts: t0
            });
            qm.lift({
                moduleId: 'modLift', liftReason: 'manual recovery', ts: t0 + 1000
            });
            const row = db.prepare(`
                SELECT lifted_at, lift_reason FROM ml_module_quarantines
                WHERE module_id = ? ORDER BY id DESC LIMIT 1
            `).get('modLift');
            expect(row.lifted_at).toBe(t0 + 1000);
            expect(row.lift_reason).toBe('manual recovery');
        });

        test('emits lift quarantine event', () => {
            const t0 = _now();
            qm.quarantine({
                moduleId: 'modLEv', action: 'clamp_influence',
                reason: 'r', ts: t0
            });
            const received = [];
            eventBus.subscribe('quarantine', e => received.push(e));
            qm.lift({ moduleId: 'modLEv', liftReason: 'auto recovery', ts: t0 + 100 });
            const liftEvent = received.find(e => e.payload && e.payload.action === 'lift');
            expect(liftEvent).toBeTruthy();
        });

        test('throws when no active quarantine exists', () => {
            expect(() => qm.lift({
                moduleId: 'never_q', liftReason: 'r', ts: _now()
            })).toThrow(/no active quarantine/);
        });
    });

    describe('isQuarantined', () => {
        test('returns true for active quarantine', () => {
            qm.quarantine({
                moduleId: 'modActive', action: 'clamp_influence',
                reason: 'r', ts: _now()
            });
            const r = qm.isQuarantined({ moduleId: 'modActive' });
            expect(r.quarantined).toBe(true);
            expect(r.action).toBe('clamp_influence');
        });

        test('returns false after lift', () => {
            const t0 = _now();
            qm.quarantine({
                moduleId: 'modL', action: 'clamp_influence',
                reason: 'r', ts: t0
            });
            qm.lift({ moduleId: 'modL', liftReason: 'ok', ts: t0 + 100 });
            const r = qm.isQuarantined({ moduleId: 'modL' });
            expect(r.quarantined).toBe(false);
        });

        test('returns false for never-quarantined module', () => {
            const r = qm.isQuarantined({ moduleId: 'fresh' });
            expect(r.quarantined).toBe(false);
        });
    });

    describe('getActiveQuarantines', () => {
        test('returns all currently active', () => {
            qm.quarantine({ moduleId: 'qa1', action: 'clamp_influence', reason: 'r', ts: _now() });
            qm.quarantine({ moduleId: 'qa2', action: 'shadow_only', reason: 'r', ts: _now() });
            const t0 = _now();
            qm.quarantine({ moduleId: 'qa3', action: 'disable', reason: 'r', ts: t0 });
            qm.lift({ moduleId: 'qa3', liftReason: 'ok', ts: t0 + 100 });
            const list = qm.getActiveQuarantines();
            const ids = list.map(q => q.moduleId).sort();
            expect(ids).toEqual(['qa1', 'qa2']);
        });
    });

    describe('Quarantine flapping protection', () => {
        test('rejects 4th quarantine in 24h (max 3/day cooldown)', () => {
            const now = _now();
            // 3 prior quarantine cycles (quarantine + lift)
            for (let i = 0; i < 3; i++) {
                qm.quarantine({
                    moduleId: 'modFlap', action: 'clamp_influence',
                    reason: `cycle ${i}`, ts: now - 1000 * i
                });
                qm.lift({
                    moduleId: 'modFlap', liftReason: 'auto',
                    ts: now - 500 - 1000 * i
                });
            }
            // 4th attempt should fail
            expect(() => qm.quarantine({
                moduleId: 'modFlap', action: 'clamp_influence',
                reason: 'cycle 4', ts: now
            })).toThrow(/max.*quarantines.*24h/i);
        });
    });

    describe('getActiveCountsByRole', () => {
        test('returns role-tag breakdown (zero when no role data)', () => {
            // Without seed, role lookup may return 0 — that's OK for D-5.5 wiring
            const counts = qm.getActiveCountsByRole();
            expect(counts).toBeDefined();
            expect(typeof counts.hot_path_critical).toBe('number');
            expect(typeof counts.hot_path_assist).toBe('number');
        });
    });
});
