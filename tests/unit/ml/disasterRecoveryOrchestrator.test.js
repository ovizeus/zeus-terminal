/**
 * R0 Substrate — disasterRecoveryOrchestrator tests (§243 chat-precedent)
 *
 * §243 = chat-precedent addition to ML spec (2026-04). NOT canonical PDF
 * (which goes 0-241). NOT Claude-extras (those have * markers: 244*-248*,
 * 252*-255*). §243 + §242 are the 2 "chat precedent" additions.
 *
 * Source: project_ml_brain_pro_244.md "243 → R0 (disaster recovery: VPS =
 * single point of failure pentru live position state, requires
 * DISASTER_RECOVERY.md + off-site DB backup S3/Backblaze hourly +
 * standby host + heartbeat.ts + failover.ts)"
 *
 * Wave 3 scope (orchestration primitives only):
 *   - Heartbeat tracking (LIVE/STALE/DEAD per node)
 *   - Backup manifest (record + retention)
 *   - Failover state machine (PRIMARY → STANDBY_READY → FAILED_OVER)
 *   - DR drill (simulate without swap, record RTO)
 *   - Recovery readiness composite (RPO + RTO + heartbeat health)
 *
 * Out of scope (infrastructure):
 *   - Actual S3/Backblaze upload (needs operator credentials)
 *   - Standby VPS provisioning
 *   - DNS failover configuration
 *   - DISASTER_RECOVERY.md document
 */

const { db } = require('../../../server/services/database')
const {
    RECORD_TYPES,
    ROLES,
    HEARTBEAT_STATES,
    DEFAULT_STALE_THRESHOLD_MS,
    DEFAULT_DEAD_THRESHOLD_MS,
    recordHeartbeat,
    getHeartbeatStatus,
    recordBackupManifest,
    listRecentBackups,
    triggerFailover,
    runDrDrill,
    getRecoveryReadiness
} = require('../../../server/services/ml/R0_substrate/disasterRecoveryOrchestrator')

describe('R0 — disasterRecoveryOrchestrator (§243 chat-precedent)', () => {
    const TEST_NODE_PREFIX = `omega_w3_p243_node_${Date.now()}_`

    afterAll(() => {
        db.prepare(`DELETE FROM ml_dr_state WHERE node_id LIKE ? OR actor = 'omega_w3_p243_test'`)
            .run(`${TEST_NODE_PREFIX}%`)
    })

    // ── Migration 051 ──────────────────────────────────────────────
    describe('Migration 051 — ml_dr_state', () => {
        test('table exists', () => {
            const row = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_dr_state'"
            ).get()
            expect(row).toBeDefined()
        })

        test('has expected columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_dr_state)").all()
            const names = cols.map(c => c.name)
            expect(names).toEqual(expect.arrayContaining([
                'id', 'record_type', 'node_id', 'role', 'state',
                'payload_json', 'actor', 'created_at', 'expires_at'
            ]))
        })

        test('record_type CHECK constraint', () => {
            expect(() => db.prepare(`INSERT INTO ml_dr_state
                (record_type, payload_json, created_at)
                VALUES ('INVALID_TYPE', '{}', 0)
            `).run()).toThrow(/CHECK constraint/)
        })

        test('record_type+created_at index exists', () => {
            const idx = db.prepare("PRAGMA index_list(ml_dr_state)").all()
            const names = idx.map(i => i.name)
            expect(names).toEqual(expect.arrayContaining(['idx_mldr_type_ts']))
        })
    })

    // ── Exported constants ─────────────────────────────────────────
    describe('Exported constants', () => {
        test('RECORD_TYPES', () => {
            expect(RECORD_TYPES).toEqual(['HEARTBEAT', 'BACKUP', 'FAILOVER', 'DRILL'])
        })
        test('ROLES', () => {
            expect(ROLES).toEqual(['PRIMARY', 'STANDBY'])
        })
        test('HEARTBEAT_STATES', () => {
            expect(HEARTBEAT_STATES).toEqual(['LIVE', 'STALE', 'DEAD'])
        })
        test('DEFAULT_STALE_THRESHOLD_MS > 0', () => {
            expect(DEFAULT_STALE_THRESHOLD_MS).toBeGreaterThan(0)
        })
        test('DEFAULT_DEAD_THRESHOLD_MS > DEFAULT_STALE_THRESHOLD_MS', () => {
            expect(DEFAULT_DEAD_THRESHOLD_MS).toBeGreaterThan(DEFAULT_STALE_THRESHOLD_MS)
        })
    })

    // ── recordHeartbeat ────────────────────────────────────────────
    describe('recordHeartbeat', () => {
        test('inserts HEARTBEAT row', () => {
            const nodeId = `${TEST_NODE_PREFIX}hb1`
            const result = recordHeartbeat({
                nodeId,
                role: 'PRIMARY',
                actor: 'omega_w3_p243_test'
            })
            expect(typeof result.id).toBe('number')
            const row = db.prepare(`SELECT * FROM ml_dr_state WHERE id = ?`).get(result.id)
            expect(row.record_type).toBe('HEARTBEAT')
            expect(row.node_id).toBe(nodeId)
            expect(row.role).toBe('PRIMARY')
        })

        test('throws on invalid role', () => {
            expect(() => recordHeartbeat({
                nodeId: `${TEST_NODE_PREFIX}bad`,
                role: 'INVALID',
                actor: 'omega_w3_p243_test'
            })).toThrow(/role/i)
        })

        test('multiple heartbeats per node OK (history)', () => {
            const nodeId = `${TEST_NODE_PREFIX}hb_multi`
            recordHeartbeat({ nodeId, role: 'PRIMARY', actor: 'omega_w3_p243_test' })
            recordHeartbeat({ nodeId, role: 'PRIMARY', actor: 'omega_w3_p243_test' })
            const count = db.prepare(
                `SELECT COUNT(*) AS n FROM ml_dr_state WHERE record_type = 'HEARTBEAT' AND node_id = ?`
            ).get(nodeId).n
            expect(count).toBe(2)
        })
    })

    // ── getHeartbeatStatus ─────────────────────────────────────────
    describe('getHeartbeatStatus', () => {
        test('returns LIVE if heartbeat within stale threshold', () => {
            const nodeId = `${TEST_NODE_PREFIX}status_live`
            recordHeartbeat({ nodeId, role: 'PRIMARY', actor: 'omega_w3_p243_test' })
            const status = getHeartbeatStatus({ nodeId })
            expect(status.state).toBe('LIVE')
            expect(status.last_heartbeat_at).toBeGreaterThan(0)
            expect(typeof status.age_ms).toBe('number')
        })

        test('returns STALE when heartbeat between thresholds', () => {
            const nodeId = `${TEST_NODE_PREFIX}status_stale`
            const result = recordHeartbeat({
                nodeId, role: 'PRIMARY', actor: 'omega_w3_p243_test'
            })
            const stalishTs = Date.now() - (DEFAULT_STALE_THRESHOLD_MS + 1000)
            db.prepare(`UPDATE ml_dr_state SET created_at = ? WHERE id = ?`)
                .run(stalishTs, result.id)
            const status = getHeartbeatStatus({ nodeId })
            expect(status.state).toBe('STALE')
        })

        test('returns DEAD when heartbeat past dead threshold', () => {
            const nodeId = `${TEST_NODE_PREFIX}status_dead`
            const result = recordHeartbeat({
                nodeId, role: 'PRIMARY', actor: 'omega_w3_p243_test'
            })
            const deadTs = Date.now() - (DEFAULT_DEAD_THRESHOLD_MS + 1000)
            db.prepare(`UPDATE ml_dr_state SET created_at = ? WHERE id = ?`)
                .run(deadTs, result.id)
            const status = getHeartbeatStatus({ nodeId })
            expect(status.state).toBe('DEAD')
        })

        test('returns DEAD when no heartbeat exists', () => {
            const status = getHeartbeatStatus({ nodeId: `${TEST_NODE_PREFIX}never_seen` })
            expect(status.state).toBe('DEAD')
            expect(status.last_heartbeat_at).toBeNull()
        })

        test('respects custom thresholds', () => {
            const nodeId = `${TEST_NODE_PREFIX}custom_threshold`
            const result = recordHeartbeat({ nodeId, role: 'STANDBY', actor: 'omega_w3_p243_test' })
            // Backdate 100ms so custom 50ms stale threshold actually triggers
            db.prepare(`UPDATE ml_dr_state SET created_at = ? WHERE id = ?`)
                .run(Date.now() - 100, result.id)
            const status = getHeartbeatStatus({ nodeId, staleThresholdMs: 50, deadThresholdMs: 1000000 })
            expect(['STALE', 'DEAD']).toContain(status.state)
        })
    })

    // ── recordBackupManifest ───────────────────────────────────────
    describe('recordBackupManifest', () => {
        test('inserts BACKUP row with expires_at', () => {
            const expiresAt = Date.now() + 30 * 86400 * 1000
            const result = recordBackupManifest({
                label: `${TEST_NODE_PREFIX}bk1`,
                hash: 'abc123',
                sizeBytes: 1024,
                targetUrl: 's3://test-bucket/backup-1.tar.gz',
                expiresAt,
                actor: 'omega_w3_p243_test'
            })
            expect(typeof result.id).toBe('number')
            const row = db.prepare(`SELECT * FROM ml_dr_state WHERE id = ?`).get(result.id)
            expect(row.record_type).toBe('BACKUP')
            expect(row.expires_at).toBe(expiresAt)
            const payload = JSON.parse(row.payload_json)
            expect(payload.hash).toBe('abc123')
            expect(payload.target_url).toBe('s3://test-bucket/backup-1.tar.gz')
        })

        test('throws on missing required fields', () => {
            expect(() => recordBackupManifest({ label: 'x' })).toThrow()
        })
    })

    // ── listRecentBackups ──────────────────────────────────────────
    describe('listRecentBackups', () => {
        test('returns recent backups DESC by created_at', () => {
            recordBackupManifest({
                label: `${TEST_NODE_PREFIX}list1`,
                hash: 'h1', sizeBytes: 100,
                targetUrl: 's3://x/1', expiresAt: Date.now() + 86400000,
                actor: 'omega_w3_p243_test'
            })
            recordBackupManifest({
                label: `${TEST_NODE_PREFIX}list2`,
                hash: 'h2', sizeBytes: 200,
                targetUrl: 's3://x/2', expiresAt: Date.now() + 86400000,
                actor: 'omega_w3_p243_test'
            })
            const rows = listRecentBackups({ limit: 10 })
            expect(Array.isArray(rows)).toBe(true)
            expect(rows.length).toBeGreaterThanOrEqual(2)
        })
    })

    // ── triggerFailover ────────────────────────────────────────────
    describe('triggerFailover', () => {
        test('inserts FAILOVER row with EXECUTING state', () => {
            const primary = `${TEST_NODE_PREFIX}fo_primary1`
            const standby = `${TEST_NODE_PREFIX}fo_standby1`
            const result = triggerFailover({
                primaryNodeId: primary,
                standbyNodeId: standby,
                reason: 'primary unreachable for 5min',
                actor: 'omega_w3_p243_test'
            })
            expect(typeof result.id).toBe('number')
            const row = db.prepare(`SELECT * FROM ml_dr_state WHERE id = ?`).get(result.id)
            expect(row.record_type).toBe('FAILOVER')
            expect(row.state).toBe('EXECUTING')
            const payload = JSON.parse(row.payload_json)
            expect(payload.primary_node_id).toBe(primary)
            expect(payload.standby_node_id).toBe(standby)
        })

        test('throws on missing required args', () => {
            expect(() => triggerFailover({})).toThrow()
        })
    })

    // ── runDrDrill ─────────────────────────────────────────────────
    describe('runDrDrill', () => {
        test('inserts DRILL row with RTO measurement', () => {
            const result = runDrDrill({
                drillPlan: 'simulate primary loss + load latest backup + verify integrity',
                actor: 'omega_w3_p243_test'
            })
            expect(typeof result.id).toBe('number')
            expect(typeof result.rto_ms).toBe('number')
            expect(result.rto_ms).toBeGreaterThanOrEqual(0)
            const row = db.prepare(`SELECT * FROM ml_dr_state WHERE id = ?`).get(result.id)
            expect(row.record_type).toBe('DRILL')
            const payload = JSON.parse(row.payload_json)
            expect(payload.rto_ms).toBeDefined()
            expect(payload.drill_plan).toContain('primary loss')
        })

        test('throws on missing drillPlan', () => {
            expect(() => runDrDrill({ actor: 'omega_w3_p243_test' })).toThrow()
        })
    })

    // ── getRecoveryReadiness ───────────────────────────────────────
    describe('getRecoveryReadiness', () => {
        test('returns composite shape: RPO + RTO + heartbeat_health', () => {
            const result = getRecoveryReadiness({ primaryNodeId: `${TEST_NODE_PREFIX}readiness1` })
            expect(result).toHaveProperty('rpo')
            expect(result).toHaveProperty('rto')
            expect(result).toHaveProperty('heartbeat_health')
            expect(result.rpo).toHaveProperty('last_backup_at')
            expect(result.rpo).toHaveProperty('age_ms')
            expect(result.rto).toHaveProperty('last_drill_at')
            expect(result.rto).toHaveProperty('latest_rto_ms')
        })

        test('RPO age_ms grows when backup is old', () => {
            recordBackupManifest({
                label: `${TEST_NODE_PREFIX}readiness_old`,
                hash: 'h', sizeBytes: 1,
                targetUrl: 's3://x/old', expiresAt: Date.now() + 86400000,
                actor: 'omega_w3_p243_test'
            })
            // backdate
            db.prepare(`UPDATE ml_dr_state SET created_at = ? WHERE record_type = 'BACKUP' AND payload_json LIKE ?`)
                .run(Date.now() - 7200_000, `%readiness_old%`)
            const result = getRecoveryReadiness({ primaryNodeId: `${TEST_NODE_PREFIX}readiness_old_node` })
            expect(result.rpo.age_ms).toBeGreaterThan(0)
        })

        test('heartbeat_health reflects state of primary node', () => {
            const nodeId = `${TEST_NODE_PREFIX}readiness_hb_node`
            recordHeartbeat({ nodeId, role: 'PRIMARY', actor: 'omega_w3_p243_test' })
            const result = getRecoveryReadiness({ primaryNodeId: nodeId })
            expect(['LIVE', 'STALE', 'DEAD']).toContain(result.heartbeat_health.state)
        })
    })
})
