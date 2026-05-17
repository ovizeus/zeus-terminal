'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-reg-'));
process.env.ZEUS_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ZEUS_TEST_DISABLE_AUTH = '1';

const { db } = require('../../../server/services/database');
const registry = require('../../../server/services/ml/_doctor/moduleRegistry');

const _now = () => Date.now();

describe('D-1.2 moduleRegistry', () => {
    beforeEach(() => {
        db.prepare("DELETE FROM ml_module_registry").run();
    });

    describe('ROLE_TAGS / CRITICALITY / RUNTIME_MODES constants', () => {
        test('exposes the 7 frozen role tags', () => {
            expect(registry.ROLE_TAGS).toEqual([
                'hot_path_critical', 'hot_path_assist', 'shadow_assist',
                'governance', 'forensic', 'introspection_meta', 'philosophical'
            ]);
            expect(Object.isFrozen(registry.ROLE_TAGS)).toBe(true);
        });

        test('exposes the 4 frozen criticality levels', () => {
            expect(registry.CRITICALITY).toEqual(['low', 'medium', 'high', 'critical']);
            expect(Object.isFrozen(registry.CRITICALITY)).toBe(true);
        });

        test('exposes the 3 frozen runtime modes', () => {
            expect(registry.RUNTIME_MODES).toEqual(['live', 'shadow', 'offline']);
            expect(Object.isFrozen(registry.RUNTIME_MODES)).toBe(true);
        });

        test('exposes the 7 required contract fields', () => {
            expect(registry.REQUIRED_CONTRACT_FIELDS).toEqual([
                'acceptedInputs', 'emittedOutputs', 'authorityScope',
                'maxRuntimeMs', 'allowedDeps', 'forbiddenDeps', 'failurePolicy'
            ]);
        });
    });

    describe('registerModule', () => {
        test('inserts row with full contract', () => {
            const r = registry.registerModule({
                moduleId: 'omega_test_alpha',
                roleTag: 'hot_path_critical',
                criticality: 'critical',
                runtimeMode: 'live',
                contract: {
                    acceptedInputs: ['tick', 'position_state'],
                    emittedOutputs: ['decision'],
                    authorityScope: 'execution',
                    maxRuntimeMs: 5,
                    allowedDeps: ['serverDSL'],
                    forbiddenDeps: ['userIO'],
                    failurePolicy: 'halt'
                },
                ts: _now()
            });
            expect(r.registered).toBe(true);
            expect(r.moduleId).toBe('omega_test_alpha');
        });

        test('rejects invalid roleTag', () => {
            expect(() => registry.registerModule({
                moduleId: 'omega_test_bad',
                roleTag: 'not_a_real_tag',
                criticality: 'low',
                runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [],
                    authorityScope: '', maxRuntimeMs: 1,
                    allowedDeps: [], forbiddenDeps: [], failurePolicy: 'skip' },
                ts: _now()
            })).toThrow(/invalid roleTag/);
        });

        test('rejects invalid criticality', () => {
            expect(() => registry.registerModule({
                moduleId: 'omega_test_bad_crit',
                roleTag: 'hot_path_critical',
                criticality: 'XXX',
                runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [],
                    authorityScope: '', maxRuntimeMs: 1,
                    allowedDeps: [], forbiddenDeps: [], failurePolicy: 'skip' },
                ts: _now()
            })).toThrow(/invalid criticality/);
        });

        test('rejects invalid runtimeMode', () => {
            expect(() => registry.registerModule({
                moduleId: 'omega_test_bad_rm',
                roleTag: 'hot_path_critical',
                criticality: 'high',
                runtimeMode: 'YYY',
                contract: { acceptedInputs: [], emittedOutputs: [],
                    authorityScope: '', maxRuntimeMs: 1,
                    allowedDeps: [], forbiddenDeps: [], failurePolicy: 'skip' },
                ts: _now()
            })).toThrow(/invalid runtimeMode/);
        });

        test('rejects missing contract field', () => {
            expect(() => registry.registerModule({
                moduleId: 'omega_test_missing',
                roleTag: 'hot_path_critical',
                criticality: 'critical',
                runtimeMode: 'live',
                contract: { acceptedInputs: [] },
                ts: _now()
            })).toThrow(/contract missing required field/);
        });

        test('rejects contract with non-array deps', () => {
            expect(() => registry.registerModule({
                moduleId: 'omega_bad_deps',
                roleTag: 'hot_path_critical',
                criticality: 'critical',
                runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [],
                    authorityScope: '', maxRuntimeMs: 1,
                    allowedDeps: 'not_array', forbiddenDeps: [], failurePolicy: 'halt' },
                ts: _now()
            })).toThrow(/allowedDeps must be array/);
        });

        test('rejects contract with non-positive maxRuntimeMs', () => {
            expect(() => registry.registerModule({
                moduleId: 'omega_bad_ms',
                roleTag: 'hot_path_critical',
                criticality: 'critical',
                runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [],
                    authorityScope: '', maxRuntimeMs: 0,
                    allowedDeps: [], forbiddenDeps: [], failurePolicy: 'halt' },
                ts: _now()
            })).toThrow(/maxRuntimeMs must be positive/);
        });

        test('rejects duplicate moduleId', () => {
            const params = {
                moduleId: 'omega_dup',
                roleTag: 'hot_path_critical', criticality: 'high',
                runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [],
                    authorityScope: 'x', maxRuntimeMs: 1,
                    allowedDeps: [], forbiddenDeps: [], failurePolicy: 'skip' },
                ts: _now()
            };
            registry.registerModule(params);
            expect(() => registry.registerModule(params)).toThrow(/duplicate moduleId/);
        });
    });

    describe('getModule', () => {
        test('returns hydrated module with parsed contract', () => {
            registry.registerModule({
                moduleId: 'omega_get_test',
                roleTag: 'governance', criticality: 'high',
                runtimeMode: 'live',
                contract: { acceptedInputs: ['proposal'], emittedOutputs: ['verdict'],
                    authorityScope: 'governance', maxRuntimeMs: 50,
                    allowedDeps: [], forbiddenDeps: [], failurePolicy: 'log' },
                ts: _now()
            });
            const m = registry.getModule({ moduleId: 'omega_get_test' });
            expect(m.moduleId).toBe('omega_get_test');
            expect(m.contract.maxRuntimeMs).toBe(50);
            expect(m.contract.acceptedInputs).toEqual(['proposal']);
            expect(m.roleTag).toBe('governance');
        });

        test('returns null for unknown module', () => {
            expect(registry.getModule({ moduleId: 'never_existed' })).toBeNull();
        });
    });

    describe('getModulesByTag', () => {
        test('returns only modules with matching tag', () => {
            registry.registerModule({
                moduleId: 'omega_a',
                roleTag: 'hot_path_critical', criticality: 'critical', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: [], forbiddenDeps: [], failurePolicy: 'halt' },
                ts: _now()
            });
            registry.registerModule({
                moduleId: 'omega_b',
                roleTag: 'philosophical', criticality: 'low', runtimeMode: 'offline',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: [], forbiddenDeps: [], failurePolicy: 'skip' },
                ts: _now()
            });
            const hot = registry.getModulesByTag({ roleTag: 'hot_path_critical' });
            expect(hot.length).toBe(1);
            expect(hot[0].moduleId).toBe('omega_a');
        });

        test('rejects invalid roleTag query', () => {
            expect(() => registry.getModulesByTag({ roleTag: 'invalid' })).toThrow(/invalid roleTag/);
        });

        test('returns empty array when no modules match', () => {
            expect(registry.getModulesByTag({ roleTag: 'governance' })).toEqual([]);
        });
    });

    describe('listAll', () => {
        test('returns hydrated rows sorted by moduleId', () => {
            registry.registerModule({
                moduleId: 'zzz',
                roleTag: 'philosophical', criticality: 'low', runtimeMode: 'offline',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: [], forbiddenDeps: [], failurePolicy: 'skip' },
                ts: _now()
            });
            registry.registerModule({
                moduleId: 'aaa',
                roleTag: 'philosophical', criticality: 'low', runtimeMode: 'offline',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: [], forbiddenDeps: [], failurePolicy: 'skip' },
                ts: _now()
            });
            const all = registry.listAll();
            expect(all.map(m => m.moduleId)).toEqual(['aaa', 'zzz']);
        });
    });

    describe('validateDAG', () => {
        test('reports no cycles when none exist', () => {
            registry.registerModule({
                moduleId: 'a',
                roleTag: 'hot_path_critical', criticality: 'high', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: ['b'], forbiddenDeps: [], failurePolicy: 'halt' },
                ts: _now()
            });
            registry.registerModule({
                moduleId: 'b',
                roleTag: 'hot_path_assist', criticality: 'medium', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: [], forbiddenDeps: [], failurePolicy: 'log' },
                ts: _now()
            });
            const r = registry.validateDAG();
            expect(r.cycles).toEqual([]);
            expect(r.hardFail).toBe(false);
            expect(r.forbiddenViolations).toEqual([]);
        });

        test('detects 2-node cycle', () => {
            registry.registerModule({
                moduleId: 'x',
                roleTag: 'hot_path_assist', criticality: 'medium', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: ['y'], forbiddenDeps: [], failurePolicy: 'log' },
                ts: _now()
            });
            registry.registerModule({
                moduleId: 'y',
                roleTag: 'hot_path_assist', criticality: 'medium', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: ['x'], forbiddenDeps: [], failurePolicy: 'log' },
                ts: _now()
            });
            const r = registry.validateDAG();
            expect(r.cycles.length).toBe(1);
            expect(r.cycles[0]).toEqual(expect.arrayContaining(['x', 'y']));
        });

        test('detects 3-node cycle', () => {
            registry.registerModule({
                moduleId: 'p',
                roleTag: 'shadow_assist', criticality: 'low', runtimeMode: 'shadow',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 10, allowedDeps: ['q'], forbiddenDeps: [], failurePolicy: 'log' },
                ts: _now()
            });
            registry.registerModule({
                moduleId: 'q',
                roleTag: 'shadow_assist', criticality: 'low', runtimeMode: 'shadow',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 10, allowedDeps: ['r'], forbiddenDeps: [], failurePolicy: 'log' },
                ts: _now()
            });
            registry.registerModule({
                moduleId: 'r',
                roleTag: 'shadow_assist', criticality: 'low', runtimeMode: 'shadow',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 10, allowedDeps: ['p'], forbiddenDeps: [], failurePolicy: 'log' },
                ts: _now()
            });
            const r = registry.validateDAG();
            expect(r.cycles.length).toBe(1);
            expect(r.cycles[0].sort()).toEqual(expect.arrayContaining(['p', 'q', 'r']));
        });

        test('hard-fails when cycle includes hot_path_critical', () => {
            registry.registerModule({
                moduleId: 'cr1',
                roleTag: 'hot_path_critical', criticality: 'critical', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: ['cr2'], forbiddenDeps: [], failurePolicy: 'halt' },
                ts: _now()
            });
            registry.registerModule({
                moduleId: 'cr2',
                roleTag: 'hot_path_critical', criticality: 'critical', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: ['cr1'], forbiddenDeps: [], failurePolicy: 'halt' },
                ts: _now()
            });
            const r = registry.validateDAG();
            expect(r.hardFail).toBe(true);
        });

        test('does NOT hard-fail when non-critical cycle exists', () => {
            registry.registerModule({
                moduleId: 'np1',
                roleTag: 'philosophical', criticality: 'low', runtimeMode: 'offline',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: ['np2'], forbiddenDeps: [], failurePolicy: 'skip' },
                ts: _now()
            });
            registry.registerModule({
                moduleId: 'np2',
                roleTag: 'philosophical', criticality: 'low', runtimeMode: 'offline',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: ['np1'], forbiddenDeps: [], failurePolicy: 'skip' },
                ts: _now()
            });
            const r = registry.validateDAG();
            expect(r.cycles.length).toBe(1);
            expect(r.hardFail).toBe(false);
        });

        test('detects transitive forbidden dependency violation', () => {
            registry.registerModule({
                moduleId: 'fa',
                roleTag: 'hot_path_critical', criticality: 'critical', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: ['fb'], forbiddenDeps: ['fc'], failurePolicy: 'halt' },
                ts: _now()
            });
            registry.registerModule({
                moduleId: 'fb',
                roleTag: 'hot_path_assist', criticality: 'high', runtimeMode: 'live',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: ['fc'], forbiddenDeps: [], failurePolicy: 'log' },
                ts: _now()
            });
            registry.registerModule({
                moduleId: 'fc',
                roleTag: 'philosophical', criticality: 'low', runtimeMode: 'offline',
                contract: { acceptedInputs: [], emittedOutputs: [], authorityScope: '',
                    maxRuntimeMs: 1, allowedDeps: [], forbiddenDeps: [], failurePolicy: 'skip' },
                ts: _now()
            });
            const r = registry.validateDAG();
            expect(r.forbiddenViolations.length).toBeGreaterThan(0);
            // fa forbids fc; fa -> fb -> fc transitively reaches forbidden
            expect(r.forbiddenViolations[0].from).toBe('fa');
            expect(r.forbiddenViolations[0].transitivelyReached).toBe('fc');
        });

        test('handles empty registry', () => {
            const r = registry.validateDAG();
            expect(r.cycles).toEqual([]);
            expect(r.hardFail).toBe(false);
            expect(r.forbiddenViolations).toEqual([]);
        });
    });
});
