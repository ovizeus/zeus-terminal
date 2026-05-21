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

        it('row counts preserved (at_positions=3, at_closed=2417, brain_decisions=89922)', () => {
            const ap = db.prepare("SELECT COUNT(*) AS n FROM at_positions").get();
            const ac = db.prepare("SELECT COUNT(*) AS n FROM at_closed").get();
            const bd = db.prepare("SELECT COUNT(*) AS n FROM brain_decisions").get();
            expect(ap.n).toBe(3);
            expect(ac.n).toBe(2417);
            expect(bd.n).toBe(89922);
        });
    });
});
