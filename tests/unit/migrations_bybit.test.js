'use strict';

describe('Bybit migrations 393 — applied to live schema', () => {
    let db;

    beforeAll(() => {
        // require database.js to apply all pending migrations at module load.
        db = require('../../server/services/database').db;
    });

    describe('Migration 393 — exchange columns', () => {
        it('at_positions has exchange column with DEFAULT binance', () => {
            const cols = db.prepare("PRAGMA table_info(at_positions)").all();
            const col = cols.find(c => c.name === 'exchange');
            expect(col).toBeDefined();
            expect(col.dflt_value).toBe("'binance'");
        });

        it('at_closed has exchange column', () => {
            const cols = db.prepare("PRAGMA table_info(at_closed)").all();
            expect(cols.find(c => c.name === 'exchange')).toBeDefined();
        });

        it('brain_decisions has exchange column', () => {
            const cols = db.prepare("PRAGMA table_info(brain_decisions)").all();
            expect(cols.find(c => c.name === 'exchange')).toBeDefined();
        });

        it('brain_parity_log has exchange column', () => {
            const cols = db.prepare("PRAGMA table_info(brain_parity_log)").all();
            expect(cols.find(c => c.name === 'exchange')).toBeDefined();
        });

        it('dsl_parity_log has exchange column', () => {
            const cols = db.prepare("PRAGMA table_info(dsl_parity_log)").all();
            expect(cols.find(c => c.name === 'exchange')).toBeDefined();
        });

        it('idx_at_positions_user_exchange_status created', () => {
            const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_at_positions_user_exchange_status'").get();
            expect(idx).toBeDefined();
        });

        it('idx_at_closed_user_exchange_ts created', () => {
            const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_at_closed_user_exchange_ts'").get();
            expect(idx).toBeDefined();
        });

        it('idx_brain_decisions_user_exchange_ts created', () => {
            const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_brain_decisions_user_exchange_ts'").get();
            expect(idx).toBeDefined();
        });

        it('existing at_positions rows have exchange=binance (backfill)', () => {
            const r = db.prepare("SELECT COUNT(*) AS n FROM at_positions WHERE exchange IS NULL OR exchange=''").get();
            expect(r.n).toBe(0);
        });

        it('existing at_closed rows have exchange=binance (backfill)', () => {
            const r = db.prepare("SELECT COUNT(*) AS n FROM at_closed WHERE exchange IS NULL OR exchange=''").get();
            expect(r.n).toBe(0);
        });

        it('migration recorded in _migrations table', () => {
            const r = db.prepare("SELECT name FROM _migrations WHERE name='393_bybit_exchange_columns'").get();
            expect(r).toBeDefined();
        });

        it('row counts not lost (>= baseline at migration time)', () => {
            // Baseline captured at migration 393 application (2026-05-21 23:33 UTC):
            // at_positions=3, at_closed=2417, brain_decisions=89922.
            // Use >= because Zeus continues to produce new rows after migration.
            // Migration is additive only — never loses data. If counts ever drop
            // below baseline, data loss occurred (catastrophic, must investigate).
            const ap = db.prepare("SELECT COUNT(*) AS n FROM at_positions").get();
            const ac = db.prepare("SELECT COUNT(*) AS n FROM at_closed").get();
            const bd = db.prepare("SELECT COUNT(*) AS n FROM brain_decisions").get();
            expect(ap.n).toBeGreaterThanOrEqual(3);
            expect(ac.n).toBeGreaterThanOrEqual(2417);
            expect(bd.n).toBeGreaterThanOrEqual(89922);
        });
    });

    describe('Migration 394 — position_events table', () => {
        it('position_events table exists', () => {
            const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='position_events'").get();
            expect(row).toBeDefined();
        });

        it('position_events has required columns', () => {
            const cols = db.prepare("PRAGMA table_info(position_events)").all();
            const names = cols.map(c => c.name);
            expect(names).toEqual(expect.arrayContaining([
                'id', 'position_seq', 'user_id', 'exchange', 'event_type',
                'from_state', 'to_state', 'payload', 'cycle_no', 'ts'
            ]));
        });

        it('position_events.id is INTEGER PRIMARY KEY', () => {
            const cols = db.prepare("PRAGMA table_info(position_events)").all();
            const id = cols.find(c => c.name === 'id');
            expect(id.pk).toBe(1);
            expect(id.type.toUpperCase()).toBe('INTEGER');
        });

        it('position_events.position_seq is NOT NULL', () => {
            const cols = db.prepare("PRAGMA table_info(position_events)").all();
            const col = cols.find(c => c.name === 'position_seq');
            expect(col.notnull).toBe(1);
        });

        it('position_events.payload defaults to empty JSON', () => {
            const cols = db.prepare("PRAGMA table_info(position_events)").all();
            const col = cols.find(c => c.name === 'payload');
            expect(col.dflt_value).toBe("'{}'");
        });

        it('idx_position_events_position created on (position_seq, ts)', () => {
            const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_position_events_position'").get();
            expect(idx).toBeDefined();
        });

        it('idx_position_events_user_ts created on (user_id, ts)', () => {
            const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_position_events_user_ts'").get();
            expect(idx).toBeDefined();
        });

        it('migration recorded in _migrations table', () => {
            const r = db.prepare("SELECT name FROM _migrations WHERE name='394_position_events_table'").get();
            expect(r).toBeDefined();
        });

        it('can insert + query a position_event row (append-only smoke)', () => {
            const insertResult = db.prepare(`
                INSERT INTO position_events
                    (position_seq, user_id, exchange, event_type, from_state, to_state, payload, cycle_no, ts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(99999, 1, 'binance', 'TEST_SMOKE', null, 'PENDING', '{"test":true}', 1, Date.now());
            expect(insertResult.lastInsertRowid).toBeGreaterThan(0);

            const row = db.prepare(`SELECT * FROM position_events WHERE position_seq = 99999`).get();
            expect(row.user_id).toBe(1);
            expect(row.exchange).toBe('binance');
            expect(row.event_type).toBe('TEST_SMOKE');
            expect(row.payload).toBe('{"test":true}');

            // Cleanup test row (allowed only in test smoke — production should never DELETE from this table)
            db.prepare(`DELETE FROM position_events WHERE position_seq = 99999`).run();
        });
    });

    describe('Migration 395 — bybit support tables', () => {
        describe('at_positions_orphaned', () => {
            it('table exists', () => {
                const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='at_positions_orphaned'").get();
                expect(row).toBeDefined();
            });

            it('has required columns', () => {
                const cols = db.prepare("PRAGMA table_info(at_positions_orphaned)").all();
                const names = cols.map(c => c.name);
                expect(names).toEqual(expect.arrayContaining([
                    'seq', 'original_at_positions_seq', 'user_id', 'exchange',
                    'data', 'disconnected_at', 'resolved_at', 'resolved_by'
                ]));
            });

            it('idx_orphaned_user_exchange created', () => {
                const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_orphaned_user_exchange'").get();
                expect(idx).toBeDefined();
            });
        });

        describe('emergency_close_queue', () => {
            it('table exists', () => {
                const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='emergency_close_queue'").get();
                expect(row).toBeDefined();
            });

            it('has required columns', () => {
                const cols = db.prepare("PRAGMA table_info(emergency_close_queue)").all();
                const names = cols.map(c => c.name);
                expect(names).toEqual(expect.arrayContaining([
                    'id', 'user_id', 'symbol', 'exchange', 'qty',
                    'decision_key', 'created_at', 'resolved_at', 'resolved_by'
                ]));
            });

            it('idx_emergency_close_unresolved created', () => {
                const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_emergency_close_unresolved'").get();
                expect(idx).toBeDefined();
            });

            it('can insert + query a task row (smoke)', () => {
                const decisionKey = `test_smoke_${Date.now()}`;
                const insert = db.prepare(`INSERT INTO emergency_close_queue (user_id, symbol, exchange, qty, decision_key, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(1, 'BTCUSDT', 'binance', '0.001', decisionKey, Date.now());
                expect(insert.lastInsertRowid).toBeGreaterThan(0);
                const row = db.prepare(`SELECT * FROM emergency_close_queue WHERE decision_key = ?`).get(decisionKey);
                expect(row.symbol).toBe('BTCUSDT');
                expect(row.exchange).toBe('binance');
                // Cleanup smoke row
                db.prepare(`DELETE FROM emergency_close_queue WHERE decision_key = ?`).run(decisionKey);
            });
        });

        describe('bybit_rate_state', () => {
            it('table exists', () => {
                const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bybit_rate_state'").get();
                expect(row).toBeDefined();
            });

            it('has required columns', () => {
                const cols = db.prepare("PRAGMA table_info(bybit_rate_state)").all();
                const names = cols.map(c => c.name);
                expect(names).toEqual(expect.arrayContaining([
                    'id', 'user_id', 'used_weight', 'reset_at', 'banned_until',
                    'ban_reason', 'last_request_at'
                ]));
            });

            it('idx_bybit_rate_state_user is UNIQUE', () => {
                const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND name='idx_bybit_rate_state_user'").get();
                expect(idx).toBeDefined();
                expect(idx.sql.toUpperCase()).toContain('UNIQUE');
            });

            it('used_weight DEFAULT 0', () => {
                const cols = db.prepare("PRAGMA table_info(bybit_rate_state)").all();
                const col = cols.find(c => c.name === 'used_weight');
                expect(String(col.dflt_value)).toBe('0');
            });

            it('banned_until DEFAULT 0', () => {
                const cols = db.prepare("PRAGMA table_info(bybit_rate_state)").all();
                const col = cols.find(c => c.name === 'banned_until');
                expect(String(col.dflt_value)).toBe('0');
            });
        });

        it('migration 395 recorded in _migrations table', () => {
            const r = db.prepare("SELECT name FROM _migrations WHERE name='395_bybit_support_tables'").get();
            expect(r).toBeDefined();
        });
    });

    describe('Migration 396 — emergency_close_queue decision_key UNIQUE INDEX', () => {
        it('idx_emergency_close_decision_key created as UNIQUE', () => {
            const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND name='idx_emergency_close_decision_key'").get();
            expect(idx).toBeDefined();
            expect(idx.sql.toUpperCase()).toContain('UNIQUE');
        });

        it('duplicate decision_key insert throws', () => {
            const dk = `test_dup_${Date.now()}`;
            db.prepare(`INSERT INTO emergency_close_queue (user_id, symbol, exchange, qty, decision_key, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(1, 'BTCUSDT', 'binance', '0.001', dk, Date.now());
            expect(() => {
                db.prepare(`INSERT INTO emergency_close_queue (user_id, symbol, exchange, qty, decision_key, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(2, 'ETHUSDT', 'bybit', '0.002', dk, Date.now());
            }).toThrow(/UNIQUE/);
            // Cleanup
            db.prepare(`DELETE FROM emergency_close_queue WHERE decision_key = ?`).run(dk);
        });

        it('migration 396 recorded in _migrations', () => {
            const r = db.prepare("SELECT name FROM _migrations WHERE name='396_emergency_close_decision_key_unique'").get();
            expect(r).toBeDefined();
        });
    });
});
