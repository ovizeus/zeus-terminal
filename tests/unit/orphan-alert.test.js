/**
 * Zeus Terminal — Unit Tests: orphanAlert helper (BUG-T4 2026-05-13)
 *
 * Defense-in-depth pentru orphan position risk în /api/order/place catch block:
 * dacă registerManualPosition() throws DUPĂ ce main order succeeded pe exchange,
 * position există fizic pe Binance dar Zeus zero tracking în at_positions.
 *
 * Helper alertOrphanRisk() fires 3 alerts best-effort:
 *   1. audit.record() — forensic audit_log entry ORDER_ORPHAN_RISK
 *   2. telegram.alertOrderFailed() — operator notified IMMEDIATELY
 *   3. Sentry.captureException() — remote error tracking
 *
 * Toate 3 wrap în try/catch — failure pe oricare NU blocks celelalte.
 */
'use strict';

// ── Mocks ──
jest.mock('../../server/services/audit', () => ({
    record: jest.fn(),
}));
jest.mock('../../server/services/telegram', () => ({
    alertOrderFailed: jest.fn(),
}));
jest.mock('@sentry/node', () => ({
    captureException: jest.fn(),
}));

const { alertOrphanRisk } = require('../../server/services/orphanAlert');
const audit = require('../../server/services/audit');
const telegram = require('../../server/services/telegram');
const Sentry = require('@sentry/node');

function makeCtx(overrides) {
    return Object.assign({
        req: { user: { id: 1 }, ip: '127.0.0.1' },
        symbol: 'BTCUSDT',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.001,
        data: { orderId: 'TEST_ORDER_123' },
        owner: 'MANUAL',
    }, overrides || {});
}

describe('BUG-T4: alertOrphanRisk fires 3 alerts on registration failure', () => {

    test('fires audit.record cu ORDER_ORPHAN_RISK', () => {
        const err = new Error('test reg failure');
        alertOrphanRisk(err, makeCtx());
        expect(audit.record).toHaveBeenCalledTimes(1);
        const [action, payload, owner, ip] = audit.record.mock.calls[0];
        expect(action).toBe('ORDER_ORPHAN_RISK');
        expect(payload.userId).toBe(1);
        expect(payload.symbol).toBe('BTCUSDT');
        expect(payload.side).toBe('BUY');
        expect(payload.orderId).toBe('TEST_ORDER_123');
        expect(payload.error).toBe('test reg failure');
        expect(owner).toBe('MANUAL');
        expect(ip).toBe('127.0.0.1');
    });

    test('fires telegram.alertOrderFailed cu orphan message', () => {
        const err = new Error('test reg failure');
        alertOrphanRisk(err, makeCtx());
        expect(telegram.alertOrderFailed).toHaveBeenCalledTimes(1);
        const [symbol, side, message, userId] = telegram.alertOrderFailed.mock.calls[0];
        expect(symbol).toBe('BTCUSDT');
        expect(side).toBe('BUY');
        expect(message).toMatch(/ORPHAN RISK/i);
        expect(message).toMatch(/TEST_ORDER_123/);
        expect(message).toMatch(/test reg failure/);
        expect(userId).toBe(1);
    });

    test('fires Sentry.captureException cu tags + extra', () => {
        const err = new Error('test reg failure');
        alertOrphanRisk(err, makeCtx());
        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
        const [capturedErr, opts] = Sentry.captureException.mock.calls[0];
        expect(capturedErr).toBe(err);
        expect(opts.tags.kind).toBe('orphan-position-risk');
        expect(opts.tags.orderId).toBe('TEST_ORDER_123');
        expect(opts.extra.userId).toBe(1);
        expect(opts.extra.symbol).toBe('BTCUSDT');
    });

    test('does NOT throw dacă audit.record fails', () => {
        audit.record.mockImplementationOnce(() => { throw new Error('audit DB unavailable'); });
        const err = new Error('test');
        expect(() => alertOrphanRisk(err, makeCtx())).not.toThrow();
        // Telegram and Sentry should still fire (best-effort isolation)
        expect(telegram.alertOrderFailed).toHaveBeenCalled();
        expect(Sentry.captureException).toHaveBeenCalled();
    });

    test('does NOT throw dacă telegram fails', () => {
        telegram.alertOrderFailed.mockImplementationOnce(() => { throw new Error('telegram down'); });
        const err = new Error('test');
        expect(() => alertOrphanRisk(err, makeCtx())).not.toThrow();
        expect(audit.record).toHaveBeenCalled();
        expect(Sentry.captureException).toHaveBeenCalled();
    });

    test('does NOT throw dacă Sentry fails', () => {
        Sentry.captureException.mockImplementationOnce(() => { throw new Error('sentry down'); });
        const err = new Error('test');
        expect(() => alertOrphanRisk(err, makeCtx())).not.toThrow();
        expect(audit.record).toHaveBeenCalled();
        expect(telegram.alertOrderFailed).toHaveBeenCalled();
    });

    test('handles missing data.orderId gracefully', () => {
        const ctx = makeCtx({ data: null });
        const err = new Error('test');
        expect(() => alertOrphanRisk(err, ctx)).not.toThrow();
        const [, payload] = audit.record.mock.calls[0];
        expect(payload.orderId).toBe(null);
    });

    test('handles missing req.user gracefully', () => {
        const ctx = makeCtx({ req: { ip: '127.0.0.1' } });
        const err = new Error('test');
        expect(() => alertOrphanRisk(err, ctx)).not.toThrow();
        const [, payload] = audit.record.mock.calls[0];
        expect(payload.userId).toBe(null);
    });
});
