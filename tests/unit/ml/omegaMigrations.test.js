const { db } = require('../../../server/services/database');

describe('OMEGA Wave 1A — DB Migrations', () => {
    describe('Migration 033 — ml_runtime_features', () => {
        test('table exists', () => {
            const row = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='ml_runtime_features'"
            ).get();
            expect(row).toBeDefined();
            expect(row.name).toBe('ml_runtime_features');
        });

        test('has all expected columns', () => {
            const cols = db.prepare("PRAGMA table_info(ml_runtime_features)").all();
            const colNames = cols.map(c => c.name);
            expect(colNames).toEqual(expect.arrayContaining([
                'id', 'user_id', 'resolved_env', 'symbol', 'feature_id',
                'effective_weight', 'sample_count', 'success_count',
                'status', 'evidence_json',
                'last_updated_at', 'created_at'
            ]));
        });

        test('UNIQUE constraint on (user_id, resolved_env, symbol, feature_id)', () => {
            // The composite UNIQUE constraint creates an automatic index
            const indexes = db.prepare("PRAGMA index_list(ml_runtime_features)").all();
            const uniqueIdx = indexes.find(i => i.unique === 1 && i.origin === 'u');
            expect(uniqueIdx).toBeDefined();
            const uniqueCols = db.prepare(`PRAGMA index_info(${uniqueIdx.name})`).all();
            const uniqueColNames = uniqueCols.map(c => c.name);
            expect(uniqueColNames).toEqual(
                expect.arrayContaining(['user_id', 'resolved_env', 'symbol', 'feature_id'])
            );
        });

        test('resolved_env CHECK constraint enforces DEMO/TESTNET/REAL', () => {
            const insertInvalid = () => {
                db.prepare(`INSERT INTO ml_runtime_features
                    (user_id, resolved_env, symbol, feature_id, status, created_at, last_updated_at)
                    VALUES (1, 'INVALID', 'BTCUSDT', 'test_feat_check', 'ACTIVE', 0, 0)
                `).run();
            };
            expect(insertInvalid).toThrow(/CHECK constraint/);
        });
    });

    // Helper: shared expectations for tables created in Wave 1A
    function expectTableExists(name) {
        const row = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        ).get(name);
        expect(row).toBeDefined();
        expect(row.name).toBe(name);
    }
    function expectColumns(table, expectedCols) {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all();
        const names = cols.map(c => c.name);
        expect(names).toEqual(expect.arrayContaining(expectedCols));
    }

    describe('Migration 034 — ml_feature_audit_log', () => {
        test('table exists', () => expectTableExists('ml_feature_audit_log'));
        test('has expected columns', () => expectColumns('ml_feature_audit_log', [
            'id', 'user_id', 'resolved_env', 'symbol', 'feature_id',
            'event_type', 'old_value_json', 'new_value_json',
            'actor', 'reason', 'created_at'
        ]));
        test('event_type CHECK enforces enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_feature_audit_log
                (user_id, resolved_env, symbol, feature_id, event_type, actor, created_at)
                VALUES (1, 'DEMO', 'BTC', 'test', 'INVALID_EVENT', 'system', 0)
            `).run()).toThrow(/CHECK constraint/);
        });
    });

    describe('Migration 035 — ml_feature_proposals', () => {
        test('table exists', () => expectTableExists('ml_feature_proposals'));
        test('has expected columns', () => expectColumns('ml_feature_proposals', [
            'id', 'user_id', 'resolved_env', 'symbol', 'feature_id',
            'proposed_weight', 'current_weight', 'delta_class',
            'evidence_json', 'state', 'decided_at', 'decided_by', 'created_at'
        ]));
        test('delta_class CHECK enforces MINOR/MAJOR/CRITICAL', () => {
            expect(() => db.prepare(`INSERT INTO ml_feature_proposals
                (user_id, resolved_env, symbol, feature_id, proposed_weight, delta_class, state, created_at)
                VALUES (1, 'DEMO', 'BTC', 'test', 0.5, 'GIGANTIC', 'PENDING', 0)
            `).run()).toThrow(/CHECK constraint/);
        });
        test('state CHECK enforces PENDING/APPLIED/REJECTED/EXPIRED', () => {
            expect(() => db.prepare(`INSERT INTO ml_feature_proposals
                (user_id, resolved_env, symbol, feature_id, proposed_weight, delta_class, state, created_at)
                VALUES (1, 'DEMO', 'BTC', 'test', 0.5, 'MINOR', 'INVALID', 0)
            `).run()).toThrow(/CHECK constraint/);
        });
    });

    describe('Migration 036 — ml_feature_global_overrides', () => {
        test('table exists', () => expectTableExists('ml_feature_global_overrides'));
        test('scope CHECK enforces 5-layer hierarchy', () => {
            expect(() => db.prepare(`INSERT INTO ml_feature_global_overrides
                (scope, scope_key, feature_id, override_status, reason, created_by, created_at)
                VALUES ('INVALID_SCOPE', 'x', 'test', 'QUARANTINED', 'test', 'admin', 0)
            `).run()).toThrow(/CHECK constraint/);
        });
        test('insert with valid scope GLOBAL works', () => {
            const result = db.prepare(`INSERT OR REPLACE INTO ml_feature_global_overrides
                (scope, scope_key, feature_id, override_status, reason, created_by, created_at)
                VALUES ('GLOBAL', '*', 'test_global_feat_omega', 'QUARANTINED', 'omega test', 'system', 1)
            `).run();
            expect(result.changes).toBe(1);
            db.prepare(`DELETE FROM ml_feature_global_overrides WHERE feature_id = 'test_global_feat_omega'`).run();
        });
    });

    describe('Migration 037 — ml_decision_snapshots', () => {
        test('table exists', () => expectTableExists('ml_decision_snapshots'));
        test('snapshot_event_type CHECK enforces TIER 1 enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_decision_snapshots
                (user_id, resolved_env, symbol, snapshot_event_type, snapshot_json, decision_digest, registry_digest, created_at)
                VALUES (1, 'DEMO', 'BTC', 'INVALID', '{}', 'abc', 'def', 0)
            `).run()).toThrow(/CHECK constraint/);
        });
        test('decision_digest is required (replay determinism)', () => {
            const cols = db.prepare("PRAGMA table_info(ml_decision_snapshots)").all();
            const c = cols.find(x => x.name === 'decision_digest');
            expect(c).toBeDefined();
            expect(c.notnull).toBe(1);
        });
    });

    describe('Migration 038 — ml_decision_light', () => {
        test('table exists', () => expectTableExists('ml_decision_light'));
        test('has minimal column set for light summary', () => expectColumns('ml_decision_light', [
            'id', 'user_id', 'resolved_env', 'symbol',
            'decision_digest', 'score', 'top5_features_json',
            'abstain_count', 'reason_code', 'created_at'
        ]));
    });

    describe('Migration 039 — ml_attribution_events', () => {
        test('table exists', () => expectTableExists('ml_attribution_events'));
        test('has columns for attribution closure', () => expectColumns('ml_attribution_events', [
            'id', 'decision_digest', 'user_id', 'resolved_env', 'symbol',
            'pos_id', 'outcome_class', 'r_multiple', 'pnl_pct',
            'operator_feedback', 'attributed_at'
        ]));
        test('outcome_class CHECK enforces enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_attribution_events
                (decision_digest, user_id, resolved_env, symbol, outcome_class, attributed_at)
                VALUES ('abc', 1, 'DEMO', 'BTC', 'INVALID', 0)
            `).run()).toThrow(/CHECK constraint/);
        });
    });

    describe('Migration 040 — ml_voice_log', () => {
        test('table exists', () => expectTableExists('ml_voice_log'));
        test('has columns for Voice Layer audit', () => expectColumns('ml_voice_log', [
            'id', 'user_id', 'utterance_type', 'mood',
            'text', 'template_id', 'context_json', 'created_at'
        ]));
        test('mood CHECK enforces mood enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_voice_log
                (user_id, utterance_type, mood, text, created_at)
                VALUES (1, 'THOUGHT', 'INVALID_MOOD', 'hello', 0)
            `).run()).toThrow(/CHECK constraint/);
        });
        test('utterance_type CHECK enforces enum', () => {
            expect(() => db.prepare(`INSERT INTO ml_voice_log
                (user_id, utterance_type, mood, text, created_at)
                VALUES (1, 'INVALID_TYPE', 'CALM', 'hello', 0)
            `).run()).toThrow(/CHECK constraint/);
        });
    });

    describe('Migration 041 — ml_operator_approval', () => {
        test('table exists', () => expectTableExists('ml_operator_approval'));
        test('has approval workflow columns', () => expectColumns('ml_operator_approval', [
            'id', 'user_id', 'request_type', 'request_payload_json',
            'tier', 'queue_state', 'cooldown_until',
            'requested_at', 'decided_at', 'decided_by', 'decision'
        ]));
        test('tier CHECK enforces MINOR/MAJOR/CRITICAL', () => {
            expect(() => db.prepare(`INSERT INTO ml_operator_approval
                (user_id, request_type, request_payload_json, tier, queue_state, requested_at)
                VALUES (1, 'PROMOTION', '{}', 'INVALID', 'PENDING', 0)
            `).run()).toThrow(/CHECK constraint/);
        });
    });

    describe('Migration 042 — ml_ring_health', () => {
        test('table exists', () => expectTableExists('ml_ring_health'));
        test('has health monitoring columns', () => expectColumns('ml_ring_health', [
            'ring_id', 'state', 'last_heartbeat', 'error_count_1h',
            'last_error_text', 'last_error_at', 'updated_at'
        ]));
        test('ring_id PK CHECK enforces ring lifecycle list', () => {
            expect(() => db.prepare(`INSERT INTO ml_ring_health
                (ring_id, state, last_heartbeat, updated_at)
                VALUES ('R99_INVALID', 'OK', 0, 0)
            `).run()).toThrow(/CHECK constraint/);
        });
        test('state CHECK enforces ring lifecycle states', () => {
            expect(() => db.prepare(`INSERT INTO ml_ring_health
                (ring_id, state, last_heartbeat, updated_at)
                VALUES ('R0', 'INVALID', 0, 0)
            `).run()).toThrow(/CHECK constraint/);
        });
    });
});
