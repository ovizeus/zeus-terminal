'use strict';

// [P2 2026-06-06] Admin user drawer "Live stats binding" — was a Placeholder
// since the panel shipped. New on-demand endpoint (fetched when the drawer
// opens, NO polling): engine mode, balances (demo always; exchange balance
// fail-soft — a Binance hiccup must not 500 the drawer), open positions with
// PnL, open count, daily PnL, kill-switch state.

const request = require('supertest');
const express = require('express');

function buildApp({ balanceThrows } = {}) {
    jest.resetModules();
    jest.doMock('../../server/services/serverAT', () => ({
        getMode: (uid) => (uid === 7 ? 'live' : 'demo'),
        getDemoBalance: () => ({ balance: 9500, startBalance: 10000, pnl: -500 }),
        getStats: () => ({ openCount: 2, dailyPnLLive: 12.5, dailyPnLDemo: 0, killActive: false, killPct: 5 }),
        getOpenPositions: (uid) => (uid === 7 ? [
            { seq: 1, symbol: 'BNBUSDT', side: 'SHORT', mode: 'live', size: 1000, lev: 5, price: 572.77, sl: 581.7, tp: 555.4, ts: 1780750000000, live: { status: 'LIVE' } },
            { seq: 2, symbol: 'ETHUSDT', side: 'SHORT', mode: 'live', size: 1008, lev: 5, price: 1553.43, sl: 1569.45, tp: 1484, ts: 1780760000000, live: { status: 'LIVE' } },
        ] : []),
    }));
    jest.doMock('../../server/services/exchangeOps', () => ({
        getBalance: async () => {
            if (balanceThrows) throw new Error('Binance IP rate-limit');
            return { balance: 2743.63, availableBalance: 1737.11 };
        },
    }));
    jest.doMock('../../server/services/credentialStore', () => ({
        getExchangeCreds: (uid) => (uid === 7 ? { exchange: 'binance', mode: 'testnet', apiKey: 'k', apiSecret: 's' } : null),
        getExchangeCredsFor: () => null,
    }));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 1, role: req.headers['x-test-role'] || 'admin' }; next(); });
    app.use('/api/admin', require('../../server/routes/admin.js'));
    return app;
}

describe('P2 — GET /api/admin/user-stats/:id', () => {
    test('THE FEATURE: returns mode, balances, positions, counts for a live user', async () => {
        const app = buildApp();
        const res = await request(app).get('/api/admin/user-stats/7');
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        const s = res.body.stats;
        expect(s.mode).toBe('live');
        expect(s.openCount).toBe(2);
        expect(s.demo.balance).toBe(9500);
        expect(s.exchange.connected).toBe(true);
        expect(s.exchange.mode).toBe('testnet');
        expect(s.exchange.balance).toBe(2743.63);
        expect(s.exchange.availableBalance).toBe(1737.11);
        expect(s.positions.length).toBe(2);
        expect(s.positions[0]).toMatchObject({ symbol: 'BNBUSDT', side: 'SHORT', mode: 'live' });
    });

    test('FAIL-SOFT: exchange balance error → 200 with exchange.balance null (drawer still renders)', async () => {
        const app = buildApp({ balanceThrows: true });
        const res = await request(app).get('/api/admin/user-stats/7');
        expect(res.status).toBe(200);
        expect(res.body.stats.exchange.connected).toBe(true);
        expect(res.body.stats.exchange.balance).toBeNull();
        expect(res.body.stats.exchange.balanceError).toMatch(/rate-limit/);
    });

    test('demo-only user (no creds) → exchange.connected false, no balance call', async () => {
        const app = buildApp();
        const res = await request(app).get('/api/admin/user-stats/3');
        expect(res.status).toBe(200);
        expect(res.body.stats.mode).toBe('demo');
        expect(res.body.stats.exchange.connected).toBe(false);
        expect(res.body.stats.positions).toEqual([]);
    });

    test('non-admin → 403; bad id → 400', async () => {
        const app = buildApp();
        const r1 = await request(app).get('/api/admin/user-stats/7').set('x-test-role', 'user');
        expect(r1.status).toBe(403);
        const r2 = await request(app).get('/api/admin/user-stats/abc');
        expect(r2.status).toBe(400);
    });
});
