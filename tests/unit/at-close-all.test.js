'use strict';
// [2026-11-15] Operatorul: „dau Close all si sare din prima kill switch-ul; e
// manual, nu trebuie sa sara chiar daca le-a deschis AT". Butonul chema
// /api/at/kill (oprirea de urgenta). Acum: /api/at/close-all inchide pozitiile AT
// din modul curent si nu atinge kill switch-ul — nici direct, nici prin pierdere.
const serverAT = require('../../server/services/serverAT');
const H = serverAT._reconTestHooks;

const UID = 990777;
const OTHER = 990778;
const pos = (seq, over = {}) => ({
    seq, userId: UID, symbol: 'BTCUSDT', side: 'LONG', price: 100, size: 2000, lev: 5,
    mode: 'demo', autoTrade: true, sl: 90, tp: 120, ts: Date.now() - 60_000, _lastPrice: 100, ...over,
});

function freshUser(uid) {
    const us = serverAT._uStateForTest(uid);
    us.engineMode = 'demo'; us.demoStartBalance = 10000; us.killPct = 5;   // limita = 500 $
    us.killActive = false; us.pnlAtReset = 0; us.dailyPnL = 0;
    return us;
}

afterEach(() => H.reset());

test('inchide pozitiile AT din modul curent — nu pe cele manuale, nu pe cele din alt mod, nu ale altui cont', () => {
    freshUser(UID); freshUser(OTHER);
    H.seedPositions([
        pos(9001), pos(9002, { side: 'SHORT' }),
        pos(9003, { autoTrade: false }),                 // manuala: ramane
        pos(9004, { mode: 'live' }),                     // alt mod: ramane
        pos(9005, { userId: OTHER }),                    // alt cont: ramane
    ]);
    const r = serverAT.closeAllForUser(UID);
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('demo');
    expect(r.closed).toBe(2);
    expect(r.failed).toEqual([]);
    expect(H.getPositions().map((p) => p.seq).sort()).toEqual([9003, 9004, 9005]);
});

test('⛔ o inchidere manuala in pierdere peste prag NU porneste kill switch-ul', () => {
    const us = freshUser(UID);
    // LONG de la 100 la 70, 2000 $ × 5x → −3000 $, de sase ori limita de 500 $
    H.seedPositions([pos(9101, { _lastPrice: 70 })]);
    const r = serverAT.closeAllForUser(UID);
    expect(r.closed).toBe(1);
    expect(r.pnl).toBeLessThan(-500);
    expect(us.dailyPnL).toBeLessThan(-500);          // pierderea ramane socotita…
    expect(serverAT._uStateForTest(UID).killActive).toBe(false);   // …dar nu blocheaza
    expect(r.killActive).toBe(false);
});

test('⛔ nici o singura inchidere manuala (butonul de pe pozitie) nu porneste kill switch-ul', () => {
    freshUser(UID);
    H.seedPositions([pos(9151, { _lastPrice: 60 })])
    expect(serverAT.closeBySeq(UID, 9151).ok).toBe(true);
    expect(serverAT._uStateForTest(UID).killActive).toBe(false);
});

test('o pierdere de motor peste prag tot porneste kill switch-ul (protectia ramane)', () => {
    const us = freshUser(UID);
    us.dailyPnL = -600;
    serverAT._checkKillSwitchForTest(UID);
    expect(serverAT._uStateForTest(UID).killActive).toBe(true);
});

test('fara pozitii: ok, zero inchise, kill neatins', () => {
    freshUser(UID);
    const r = serverAT.closeAllForUser(UID);
    expect(r).toMatchObject({ ok: true, closed: 0, killActive: false });
});

test('in modul live inchide doar pozitiile live', () => {
    const us = freshUser(UID);
    us.engineMode = 'live';
    H.seedPositions([pos(9201), pos(9202, { mode: 'live', live: null })]);
    const r = serverAT.closeAllForUser(UID);
    expect(r.mode).toBe('live');
    expect(r.closed).toBe(1);
    expect(H.getPositions().map((p) => p.seq)).toEqual([9201]);
});

test('ruta /api/at/close-all exista si nu cheama oprirea de urgenta', () => {
    const fs = require('fs'); const path = require('path');
    const srv = fs.readFileSync(path.resolve(__dirname, '../../server.js'), 'utf8');
    const i = srv.indexOf("app.post('/api/at/close-all'");
    expect(i).toBeGreaterThan(0);
    const body = srv.slice(i, srv.indexOf('\n});', i));
    expect(body).toContain('closeAllForUser');
    expect(body).not.toContain('activateKillSwitch');
});
