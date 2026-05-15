/**
 * R5B Governance — versionRegistry tests (canonical §19)
 *
 * "Tot sistemul trebuie versionat."
 *
 * Foundation R5B point. Version registry for 5 component types with
 * atomic state transitions (PROPOSED → ACTIVE → ROLLED_BACK / RETIRED),
 * config hashing for rollback identity, parent-version chain for rollback,
 * KPI delta tracking, and full audit-trail changelog.
 *
 * Other R5B points (§252* tiered promotion, §254* auto-quarantine, §255*
 * auto-resume DD, §247* pre-registration, §33 A/B testing) consume this.
 */

const { db } = require('../../../server/services/database')
const {
    proposeVersion,
    activateVersion,
    rollbackVersion,
    getActive,
    getById,
    getHistory,
    compareVersions,
    setKpiDelta,
    getChangelog,
    COMPONENT_TYPES,
    VERSION_STATES
} = require('../../../server/services/ml/R5B_governance/versionRegistry')

describe('R5B — versionRegistry (canonical §19)', () => {
    const TEST_COMPONENT_PREFIX = `omega_w3_p19_test_${Date.now()}_`

    afterAll(() => {
        db.prepare(`DELETE FROM ml_governance_versions WHERE component_id LIKE ?`)
            .run(`${TEST_COMPONENT_PREFIX}%`)
    })

    // ── Migration 045 verification ─────────────────────────────────
    describe('Migration 045 — ml_governance_versions', () => {
        test('table exists', () => {
            const row = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_governance_versions'"
            ).get()
            expect(row).toBeDefined()
            expect(row.name).toBe('ml_governance_versions')
        })

        test('has all expected columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_governance_versions)").all()
            const names = cols.map(c => c.name)
            expect(names).toEqual(expect.arrayContaining([
                'id', 'component_type', 'component_id', 'version',
                'config_json', 'config_hash', 'parent_version_id',
                'motivation', 'actor', 'kpi_delta_json', 'state',
                'activated_at', 'rolled_back_at', 'created_at'
            ]))
        })

        test('component_type CHECK enforces 5 spec types', () => {
            const insertInvalid = () => {
                db.prepare(`INSERT INTO ml_governance_versions
                    (component_type, component_id, version, config_json, config_hash,
                     motivation, actor, state, created_at)
                    VALUES ('invalid_type', 'x', 'v1', '{}', 'abc', 'test', 'admin', 'PROPOSED', 0)
                `).run()
            }
            expect(insertInvalid).toThrow(/CHECK constraint/)
        })

        test('state CHECK enforces 4 lifecycle states', () => {
            const insertInvalid = () => {
                db.prepare(`INSERT INTO ml_governance_versions
                    (component_type, component_id, version, config_json, config_hash,
                     motivation, actor, state, created_at)
                    VALUES ('model', 'x', 'v1', '{}', 'abc', 'test', 'admin', 'BANANA', 0)
                `).run()
            }
            expect(insertInvalid).toThrow(/CHECK constraint/)
        })

        test('component+state index exists', () => {
            const idx = db.prepare("PRAGMA index_list(ml_governance_versions)").all()
            const names = idx.map(i => i.name)
            expect(names).toEqual(expect.arrayContaining([
                'idx_mlgv_component_state',
                'idx_mlgv_created_at'
            ]))
        })
    })

    // ── Exported enums ─────────────────────────────────────────────
    describe('Exported enums', () => {
        test('COMPONENT_TYPES has 5 spec types', () => {
            expect(COMPONENT_TYPES).toEqual([
                'model', 'detector', 'feature_schema', 'risk_config', 'execution_config'
            ])
        })
        test('VERSION_STATES has 4 lifecycle states', () => {
            expect(VERSION_STATES).toEqual([
                'PROPOSED', 'ACTIVE', 'ROLLED_BACK', 'RETIRED'
            ])
        })
    })

    // ── proposeVersion ─────────────────────────────────────────────
    describe('proposeVersion', () => {
        test('inserts PROPOSED row with config_hash', () => {
            const result = proposeVersion({
                componentType: 'model',
                componentId: `${TEST_COMPONENT_PREFIX}m1`,
                version: 'v1.0.0',
                config: { score_threshold: 0.7 },
                motivation: 'initial baseline',
                actor: 'omega_w3_test'
            })
            expect(typeof result.id).toBe('number')
            expect(typeof result.config_hash).toBe('string')
            expect(result.config_hash.length).toBe(64)  // SHA-256 hex
            const row = getById(result.id)
            expect(row.state).toBe('PROPOSED')
            expect(row.motivation).toBe('initial baseline')
        })

        test('different configs produce different hashes', () => {
            const a = proposeVersion({
                componentType: 'detector',
                componentId: `${TEST_COMPONENT_PREFIX}d1`,
                version: 'v1',
                config: { x: 1 },
                motivation: 'test a',
                actor: 'test'
            })
            const b = proposeVersion({
                componentType: 'detector',
                componentId: `${TEST_COMPONENT_PREFIX}d1`,
                version: 'v2',
                config: { x: 2 },
                motivation: 'test b',
                actor: 'test'
            })
            expect(a.config_hash).not.toBe(b.config_hash)
        })

        test('identical configs produce identical hashes', () => {
            const a = proposeVersion({
                componentType: 'risk_config',
                componentId: `${TEST_COMPONENT_PREFIX}r1`,
                version: 'v1',
                config: { max_risk: 2.0 },
                motivation: 'a',
                actor: 'test'
            })
            const b = proposeVersion({
                componentType: 'risk_config',
                componentId: `${TEST_COMPONENT_PREFIX}r1`,
                version: 'v2',
                config: { max_risk: 2.0 },
                motivation: 'b',
                actor: 'test'
            })
            expect(a.config_hash).toBe(b.config_hash)
        })

        test('throws on missing required fields', () => {
            expect(() => proposeVersion({})).toThrow()
            expect(() => proposeVersion({ componentType: 'model' })).toThrow()
        })

        test('throws on invalid componentType', () => {
            expect(() => proposeVersion({
                componentType: 'invalid',
                componentId: 'x',
                version: 'v1',
                config: {},
                motivation: 'm',
                actor: 'a'
            })).toThrow(/component_type|CHECK/i)
        })
    })

    // ── activateVersion ────────────────────────────────────────────
    describe('activateVersion', () => {
        test('transitions PROPOSED → ACTIVE', () => {
            const p = proposeVersion({
                componentType: 'feature_schema',
                componentId: `${TEST_COMPONENT_PREFIX}f1`,
                version: 'v1',
                config: { fields: ['a', 'b'] },
                motivation: 'feature schema v1',
                actor: 'test'
            })
            activateVersion({ id: p.id, motivation: 'go live', actor: 'operator' })
            const row = getById(p.id)
            expect(row.state).toBe('ACTIVE')
            expect(row.activated_at).toBeGreaterThan(0)
        })

        test('atomicity: previous ACTIVE → RETIRED when new activated', () => {
            const v1 = proposeVersion({
                componentType: 'execution_config',
                componentId: `${TEST_COMPONENT_PREFIX}e1`,
                version: 'v1',
                config: { mode: 'manual' },
                motivation: 'v1',
                actor: 'test'
            })
            activateVersion({ id: v1.id, motivation: 'first activate', actor: 'op' })

            const v2 = proposeVersion({
                componentType: 'execution_config',
                componentId: `${TEST_COMPONENT_PREFIX}e1`,
                version: 'v2',
                config: { mode: 'auto' },
                motivation: 'v2',
                actor: 'test',
                parentVersionId: v1.id
            })
            activateVersion({ id: v2.id, motivation: 'second activate', actor: 'op' })

            expect(getById(v1.id).state).toBe('RETIRED')
            expect(getById(v2.id).state).toBe('ACTIVE')
        })

        test('only ONE ACTIVE per component', () => {
            const active = getActive('execution_config', `${TEST_COMPONENT_PREFIX}e1`)
            expect(active).not.toBeNull()
            // Verify count is 1
            const cnt = db.prepare(
                `SELECT COUNT(*) as n FROM ml_governance_versions WHERE component_type='execution_config' AND component_id=? AND state='ACTIVE'`
            ).get(`${TEST_COMPONENT_PREFIX}e1`).n
            expect(cnt).toBe(1)
        })

        test('throws if id does not exist', () => {
            expect(() => activateVersion({ id: 999999990, motivation: 'x', actor: 'y' }))
                .toThrow(/not found|missing/i)
        })

        test('throws if not PROPOSED state', () => {
            const v1 = proposeVersion({
                componentType: 'detector',
                componentId: `${TEST_COMPONENT_PREFIX}dx`,
                version: 'v1',
                config: {},
                motivation: 'test',
                actor: 'test'
            })
            activateVersion({ id: v1.id, motivation: 'go', actor: 'op' })
            // Now try to activate again
            expect(() => activateVersion({ id: v1.id, motivation: 'again', actor: 'op' }))
                .toThrow(/state|PROPOSED/i)
        })
    })

    // ── rollbackVersion ────────────────────────────────────────────
    describe('rollbackVersion', () => {
        test('transitions ACTIVE → ROLLED_BACK and re-activates parent', () => {
            const v1 = proposeVersion({
                componentType: 'risk_config',
                componentId: `${TEST_COMPONENT_PREFIX}rb1`,
                version: 'v1',
                config: { x: 1 },
                motivation: 'baseline',
                actor: 'test'
            })
            activateVersion({ id: v1.id, motivation: 'go', actor: 'op' })

            const v2 = proposeVersion({
                componentType: 'risk_config',
                componentId: `${TEST_COMPONENT_PREFIX}rb1`,
                version: 'v2',
                config: { x: 2 },
                motivation: 'upgrade',
                actor: 'test',
                parentVersionId: v1.id
            })
            activateVersion({ id: v2.id, motivation: 'roll forward', actor: 'op' })

            rollbackVersion({ id: v2.id, motivation: 'kpi degraded', actor: 'op' })

            expect(getById(v2.id).state).toBe('ROLLED_BACK')
            expect(getById(v1.id).state).toBe('ACTIVE')   // parent re-activated
        })

        test('throws if no parent (cannot rollback initial version)', () => {
            const v1 = proposeVersion({
                componentType: 'model',
                componentId: `${TEST_COMPONENT_PREFIX}rb2`,
                version: 'v1',
                config: {},
                motivation: 'initial',
                actor: 'test'
            })
            activateVersion({ id: v1.id, motivation: 'go', actor: 'op' })
            expect(() => rollbackVersion({ id: v1.id, motivation: 'try', actor: 'op' }))
                .toThrow(/parent|initial/i)
        })

        test('throws if not ACTIVE state', () => {
            const v1 = proposeVersion({
                componentType: 'model',
                componentId: `${TEST_COMPONENT_PREFIX}rb3`,
                version: 'v1',
                config: {},
                motivation: 'never activated',
                actor: 'test'
            })
            expect(() => rollbackVersion({ id: v1.id, motivation: 'try', actor: 'op' }))
                .toThrow(/state|ACTIVE/i)
        })
    })

    // ── getActive / getHistory ─────────────────────────────────────
    describe('getActive', () => {
        test('returns current ACTIVE row', () => {
            const v1 = proposeVersion({
                componentType: 'detector',
                componentId: `${TEST_COMPONENT_PREFIX}ga1`,
                version: 'v1',
                config: { foo: 'bar' },
                motivation: 'test',
                actor: 'test'
            })
            activateVersion({ id: v1.id, motivation: 'go', actor: 'op' })
            const active = getActive('detector', `${TEST_COMPONENT_PREFIX}ga1`)
            expect(active.id).toBe(v1.id)
            expect(active.state).toBe('ACTIVE')
        })

        test('returns null when no ACTIVE version', () => {
            expect(getActive('detector', `${TEST_COMPONENT_PREFIX}nonexistent`)).toBeNull()
        })
    })

    describe('getHistory', () => {
        test('returns version chain sorted by created_at DESC', () => {
            // Build chain
            const compId = `${TEST_COMPONENT_PREFIX}hist1`
            const v1 = proposeVersion({
                componentType: 'feature_schema',
                componentId: compId,
                version: 'v1',
                config: { a: 1 },
                motivation: 'first',
                actor: 'test'
            })
            const v2 = proposeVersion({
                componentType: 'feature_schema',
                componentId: compId,
                version: 'v2',
                config: { a: 2 },
                motivation: 'second',
                actor: 'test'
            })
            const history = getHistory('feature_schema', compId, 10)
            expect(history.length).toBe(2)
            expect(history[0].version).toBe('v2')  // most recent first
            expect(history[1].version).toBe('v1')
        })

        test('respects limit', () => {
            const compId = `${TEST_COMPONENT_PREFIX}hist1`
            const lim1 = getHistory('feature_schema', compId, 1)
            expect(lim1.length).toBeLessThanOrEqual(1)
        })
    })

    // ── compareVersions ────────────────────────────────────────────
    describe('compareVersions', () => {
        test('returns diff of configs + kpi deltas', () => {
            const v1 = proposeVersion({
                componentType: 'model',
                componentId: `${TEST_COMPONENT_PREFIX}cmp1`,
                version: 'v1',
                config: { threshold: 0.7, slip: 0.1 },
                motivation: 'a',
                actor: 'test'
            })
            const v2 = proposeVersion({
                componentType: 'model',
                componentId: `${TEST_COMPONENT_PREFIX}cmp1`,
                version: 'v2',
                config: { threshold: 0.75, slip: 0.1, new_field: 'x' },
                motivation: 'b',
                actor: 'test'
            })
            const diff = compareVersions(v1.id, v2.id)
            expect(diff).toHaveProperty('changed')
            expect(diff).toHaveProperty('added')
            expect(diff).toHaveProperty('removed')
            expect(diff.changed).toContain('threshold')
            expect(diff.added).toContain('new_field')
        })

        test('throws if either id missing', () => {
            expect(() => compareVersions(999999991, 999999992)).toThrow()
        })
    })

    // ── setKpiDelta ────────────────────────────────────────────────
    describe('setKpiDelta', () => {
        test('updates kpi_delta_json', () => {
            const v1 = proposeVersion({
                componentType: 'model',
                componentId: `${TEST_COMPONENT_PREFIX}kpi1`,
                version: 'v1',
                config: {},
                motivation: 'test',
                actor: 'test'
            })
            setKpiDelta({
                id: v1.id,
                kpiDelta: { hit_rate_pct_change: +5.2, avg_rr_change: -0.1 },
                actor: 'eval_bot'
            })
            const row = getById(v1.id)
            const parsed = JSON.parse(row.kpi_delta_json)
            expect(parsed.hit_rate_pct_change).toBe(5.2)
            expect(parsed.avg_rr_change).toBe(-0.1)
        })
    })

    // ── getChangelog ───────────────────────────────────────────────
    describe('getChangelog', () => {
        test('returns audit log entries', () => {
            // Seed at least one entry
            proposeVersion({
                componentType: 'detector',
                componentId: `${TEST_COMPONENT_PREFIX}cl1`,
                version: 'v1',
                config: {},
                motivation: 'changelog seed',
                actor: 'changelog_actor'
            })
            const log = getChangelog({ limit: 100 })
            expect(Array.isArray(log)).toBe(true)
            expect(log.length).toBeGreaterThan(0)
            for (const entry of log) {
                expect(entry).toHaveProperty('when')
                expect(entry).toHaveProperty('who')
                expect(entry).toHaveProperty('type')
                expect(entry).toHaveProperty('component')
                expect(entry).toHaveProperty('motivation')
                expect(entry).toHaveProperty('state')
            }
        })

        test('filters by componentType', () => {
            const log = getChangelog({ componentType: 'detector', limit: 100 })
            for (const entry of log) {
                expect(entry.type).toBe('detector')
            }
        })
    })
})
