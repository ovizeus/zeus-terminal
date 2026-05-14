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
});
