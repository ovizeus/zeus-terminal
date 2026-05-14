/**
 * Zeus Terminal — Unit Tests: _buildEntryFromOrderPlace (M1.1 Cat A)
 *
 * TDD failing-first per `_review/audit/TEST_SCAFFOLDING_M1_20260510.md` §3.
 *
 * Function being tested: `_buildEntryFromOrderPlace(reqBody, userId)`
 *   Pure transform from /api/order/place request body → canonical `entry` object
 *   consumed by `_executeLiveEntryCore` (extracted din _executeLiveEntry în M1.2).
 *
 * Status: ALL tests in this file initially FAIL — `_buildEntryFromOrderPlace`
 * doesn't exist yet în serverAT.js. Tests demonstrate target API + safety
 * assertions per ADR-001 Decision 3.1 hard safety gate.
 *
 * Coverage targets (per scaffolding doc §3):
 *   - Happy path: 3 tests (live valid, manual source, BUY→LONG / SELL→SHORT)
 *   - Validation: 4 tests (sl=null+live throws, sl=null+demo OK, missing fields, invalid qty)
 *   - Edge cases: 3 tests (leverage default, dslParams null, clientReqId preserve)
 *
 * Total: 10 tests (target band 8-10).
 *
 * Refs:
 * - ADR-001 §3.2 hard safety assertions
 * - TEST_SCAFFOLDING_M1 §3 Cat A spec
 * - MILESTONES_M1-M8 §M1 acceptance criteria M1.5
 */
'use strict';

// ── Mocks (sparse — only what we need pentru pure transform tests) ──
jest.mock('../../server/services/database', () => ({
    db: { prepare: jest.fn(() => ({ all: jest.fn(() => []), run: jest.fn() })) },
    atGetState: jest.fn(() => null),
    atSetState: jest.fn(),
    saveMissedTrade: jest.fn(),
    auditLog: jest.fn(),
    getOpenPositionsForUser: jest.fn(() => []),
    getOpenPositions: jest.fn(() => []),
    getRecentActions: jest.fn(() => []),
    getLastActiveAt: jest.fn(() => null),
    setLastActiveAt: jest.fn(),
    getMaxSeq: jest.fn(() => 0),
    getGhostCandidates: jest.fn(() => []),
    deleteAtPosition: jest.fn(),
    saveAtPosition: jest.fn(),
    moveToClosedAtomic: jest.fn(),
    getRecentClosedForUser: jest.fn(() => []),
    countOpenPositions: jest.fn(() => 0),
}));

jest.mock('../../server/services/binanceSigner', () => ({
    sendSignedRequest: jest.fn(),
}));

jest.mock('../../server/services/telegram', () => ({
    sendToUser: jest.fn(),
    alertOrderFilled: jest.fn(),
    notifyUser: jest.fn(),
}));

// ── Import target module ──
const serverAT = require('../../server/services/serverAT.js');

describe('_buildEntryFromOrderPlace (M1.1 Cat A)', () => {
    describe('happy path', () => {
        it('transforms valid live BUY order request to canonical entry', () => {
            const reqBody = {
                symbol: 'ETHUSDT',
                side: 'BUY',
                quantity: 0.5,
                leverage: 10,
                sl: 2300,
                tp: 2400,
                mode: 'live',
                source: 'auto',
                dslParams: { openDslPct: 0.6 },
                entryPrice: 2330,
            };
            const userId = 1;
            const entry = serverAT._buildEntryFromOrderPlace(reqBody, userId);
            expect(entry).toMatchObject({
                userId: 1,
                symbol: 'ETHUSDT',
                side: 'LONG',
                mode: 'live',
                sl: 2300,
                tp: 2400,
                lev: 10,
                qty: 0.5,
                autoTrade: true,
                dslParams: { openDslPct: 0.6 },
            });
            // seq + ts auto-generated
            expect(entry.seq).toBeDefined();
            expect(typeof entry.seq).toBe('number');
            expect(entry.ts).toBeDefined();
            expect(typeof entry.ts).toBe('number');
        });

        it('sets autoTrade=false when source=manual', () => {
            const reqBody = {
                symbol: 'ETHUSDT', side: 'BUY', quantity: 0.5, leverage: 10,
                sl: 2300, tp: 2400, mode: 'live', source: 'manual', entryPrice: 2330,
            };
            const entry = serverAT._buildEntryFromOrderPlace(reqBody, 1);
            expect(entry.autoTrade).toBe(false);
        });

        it('translates SELL → SHORT in side field', () => {
            const reqBody = {
                symbol: 'ETHUSDT', side: 'SELL', quantity: 0.5, leverage: 10,
                sl: 2400, tp: 2300, mode: 'live', source: 'auto', entryPrice: 2330,
            };
            const entry = serverAT._buildEntryFromOrderPlace(reqBody, 1);
            expect(entry.side).toBe('SHORT');
        });
    });

    describe('validation (ADR-001 §3.2 hard safety assertions)', () => {
        it('rejects sl=null with mode=live (SafetyAssertionError)', () => {
            const reqBody = {
                symbol: 'ETHUSDT', side: 'BUY', quantity: 0.5, leverage: 10,
                sl: null, tp: 2400, mode: 'live', source: 'auto', entryPrice: 2330,
            };
            expect(() => serverAT._buildEntryFromOrderPlace(reqBody, 1))
                .toThrow(/SafetyAssertionError.*sl/i);
        });

        it('allows sl=null when mode=demo (demo has no exchange safety burden)', () => {
            const reqBody = {
                symbol: 'ETHUSDT', side: 'BUY', quantity: 0.5, leverage: 10,
                sl: null, tp: null, mode: 'demo', source: 'auto', entryPrice: 2330,
            };
            const entry = serverAT._buildEntryFromOrderPlace(reqBody, 1);
            expect(entry.sl).toBeNull();
            expect(entry.mode).toBe('demo');
        });

        it('rejects when required fields missing (symbol)', () => {
            expect(() => serverAT._buildEntryFromOrderPlace({
                side: 'BUY', quantity: 0.5, leverage: 10, sl: 2300, mode: 'live', entryPrice: 2330,
            }, 1)).toThrow(/missing required fields/i);
        });

        it('rejects invalid quantity (zero or negative)', () => {
            expect(() => serverAT._buildEntryFromOrderPlace({
                symbol: 'ETHUSDT', side: 'BUY', quantity: 0, leverage: 10, sl: 2300, mode: 'live', entryPrice: 2330,
            }, 1)).toThrow(/quantity/i);
            expect(() => serverAT._buildEntryFromOrderPlace({
                symbol: 'ETHUSDT', side: 'BUY', quantity: -1, leverage: 10, sl: 2300, mode: 'live', entryPrice: 2330,
            }, 1)).toThrow(/quantity/i);
        });
    });

    describe('edge cases', () => {
        it('defaults leverage to 1 when undefined', () => {
            const reqBody = {
                symbol: 'ETHUSDT', side: 'BUY', quantity: 0.5,
                sl: 2300, tp: 2400, mode: 'live', source: 'auto', entryPrice: 2330,
                // leverage undefined
            };
            const entry = serverAT._buildEntryFromOrderPlace(reqBody, 1);
            expect(entry.lev).toBe(1);
        });

        it('handles dslParams=null (DSL OFF, native TP path)', () => {
            const reqBody = {
                symbol: 'ETHUSDT', side: 'BUY', quantity: 0.5, leverage: 10,
                sl: 2300, tp: 2400, mode: 'live', source: 'auto', entryPrice: 2330,
                dslParams: null,
            };
            const entry = serverAT._buildEntryFromOrderPlace(reqBody, 1);
            expect(entry.dslParams).toBeNull();
        });

        it('preserves clientReqId for idempotency (replays)', () => {
            const reqBody = {
                symbol: 'ETHUSDT', side: 'BUY', quantity: 0.5, leverage: 10,
                sl: 2300, tp: 2400, mode: 'live', source: 'auto', entryPrice: 2330,
                clientReqId: 'abc-123-xyz',
            };
            const entry = serverAT._buildEntryFromOrderPlace(reqBody, 1);
            expect(entry.clientReqId).toBe('abc-123-xyz');
        });
    });
});
