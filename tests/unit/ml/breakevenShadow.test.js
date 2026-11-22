'use strict';
// [2026-11-22] Umbra breakeven: ordinea preturilor conteaza; nu atinge pozitia altfel.
const be = require('../../../server/services/breakevenShadow');
const report = require('../../../server/services/ml/_ring5/shadowReport');

describe('breakevenShadow.track', () => {
    test('LONG: urca +0,6%, se intoarce la intrare → lovit la 0,3 si 0,5, nu la 0,8', () => {
        const pos = { side: 'LONG', price: 100, sl: 98 };
        for (const p of [100.2, 100.6, 100.1, 99.9, 99]) be.track(pos, p, 1);
        const o = be.outcome(pos, -12);
        expect(o['0.3']).toEqual({ armed: true, hit: true, shadowPnl: 0 });
        expect(o['0.5']).toEqual({ armed: true, hit: true, shadowPnl: 0 });
        expect(o['0.8']).toEqual({ armed: false, hit: false, shadowPnl: -12 });
        expect(pos.sl).toBe(98); // stopul real neatins
    });
    test('SHORT: favorabil = pretul coboara', () => {
        const pos = { side: 'SHORT', price: 100 };
        for (const p of [99.4, 99.9, 100.05]) be.track(pos, p, 1);
        expect(be.outcome(pos, -5)['0.5'].hit).toBe(true);
    });
    test('scade sub intrare INAINTE sa se armeze → nu conteaza ca lovit', () => {
        const pos = { side: 'LONG', price: 100 };
        for (const p of [99.5, 100.4]) be.track(pos, p, 1);
        expect(be.outcome(pos, 7)['0.3']).toEqual({ armed: true, hit: false, shadowPnl: 7 });
    });
});

describe('shadowReport.build', () => {
    const TH = [0.3, 0.5];
    const T0 = 1_000_000;
    const trade = (o) => ({ userId: 1, symbol: 'BTCUSDT', side: 'LONG', ts: T0, closePnl: -20, autoTrade: true, ...o });
    const audit = (o) => ({ user_id: 1, symbol: 'BTCUSDT', phase2_dir: 'LONG', phase2_confidence: 70, proposed_confidence: 55, gate_status: 'skipped', gate_reason: 'shadow_accepted', rationale_json: JSON.stringify({ phase2Tier: 'SMALL', wouldTier: 'NO_TRADE' }), created_at: T0 - 5000, ...o });

    test('taiere la NO_TRADE chiar inainte de intrare → tranzactia ar fi fost blocata; efectul = −pnl', () => {
        const r = report.build([trade({}), trade({ closePnl: 30, ts: T0 + 10_000 })], [audit({}), audit({ created_at: T0 + 9000 })], TH);
        expect(r.total.ring5.wouldBlock).toEqual({ n: 2, pnl: 10, winners: 1, losers: 1 });
        expect(r.total.ring5.blockEffect).toBe(-10);
        expect(r.perUser[1].ring5.wouldBlock.n).toBe(2);
    });
    test('decizie prea veche (peste fereastra) sau alt cont / alta directie → nu se potriveste', () => {
        const r = report.build([trade({})], [audit({ created_at: T0 - report.MATCH_WINDOW_MS - 1 }), audit({ user_id: 2 }), audit({ phase2_dir: 'SHORT' })], TH);
        expect(r.total.ring5.matched).toBe(0);
    });
    test('taiere care doar micsoreaza treapta → separat; respins → fara efect', () => {
        const r = report.build([trade({})], [audit({ rationale_json: JSON.stringify({ phase2Tier: 'MEDIUM', wouldTier: 'SMALL' }) })], TH);
        expect(r.total.ring5.wouldShrink.n).toBe(1);
        const r2 = report.build([trade({})], [audit({ gate_status: 'rejected', gate_reason: 'reflection_blocked' })], TH);
        expect(r2.total.ring5.wouldBlock.n).toBe(0);
    });
    test('breakeven: lovit → 0 in umbra; efectul pe prag in dolari', () => {
        const t1 = trade({ closePnl: -20, _beShadow: { '0.3': { armedTs: 1, hitTs: 2 }, '0.5': { armedTs: 1, hitTs: null } } });
        const t2 = trade({ closePnl: 15, _beShadow: { '0.3': { armedTs: 1, hitTs: 2 } } });
        const r = report.build([t1, t2], [], TH);
        expect(r.total.breakeven.realPnl).toBe(-5);
        expect(r.total.breakeven['0.3']).toMatchObject({ armed: 2, hit: 2, hitWinners: 1, hitLosers: 1, shadowPnl: 0, effect: 5 });
        expect(r.total.breakeven['0.5']).toMatchObject({ armed: 1, hit: 0, shadowPnl: -5, effect: 0 });
    });
    test('doar tranzactiile botului (autoTrade)', () => {
        expect(report.build([trade({ autoTrade: false })], [audit({})], TH).total.ring5.trades).toBe(0);
    });
});
