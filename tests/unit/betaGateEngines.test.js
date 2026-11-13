'use strict';
// [BETA-GATE 2026-11-13] Blocarea rutelor nu ajunge: motoarele ruleaza pe
// server pentru fiecare cont. Aici se verifica EFECTUL — un viewer nu intra in
// bucla brain-ului si nu primeste nicio intrare — nu doar functia pura.
// (Lectia din 9–12 nov: garda testata doar ca functie pura a oprit tot.)
const db = require('../../server/services/database');
const accessLevel = require('../../server/services/accessLevel');

function mkUser(email, { approved = 1, level } = {}) {
    const id = db.createUser(email, 'x'.repeat(60), 'user', approved ? 1 : 0);
    if (level) db.setAccessLevel(id, level);
    accessLevel.invalidate();
    return id;
}

describe('nivelul de acces in baza', () => {
    test('un cont NOU porneste viewer, chiar si dupa aprobare', () => {
        const id = mkUser(`new-${Date.now()}@t.io`, { approved: 0 });
        expect(db.findUserById(id).access_level).toBe('viewer');
        db.approveUser(db.findUserById(id).email);
        accessLevel.invalidate();
        expect(accessLevel.levelOf(id)).toBe('viewer');
    });

    test('adminul il ridica la full si il poate cobori inapoi', () => {
        const id = mkUser(`lift-${Date.now()}@t.io`);
        db.setAccessLevel(id, 'full');
        expect(accessLevel.levelOf(id)).toBe('full');      // fara asteptarea cache-ului
        db.setAccessLevel(id, 'viewer');
        expect(accessLevel.levelOf(id)).toBe('viewer');
    });

    test('⛔ doar cele doua valori sunt primite', () => {
        const id = mkUser(`bad-${Date.now()}@t.io`);
        expect(() => db.setAccessLevel(id, 'admin')).toThrow();
        expect(() => db.setAccessLevel(id, '')).toThrow();
        expect(db.findUserById(id).access_level).toBe('viewer');
    });

    test('listUsers poarta nivelul (pentru Admin)', () => {
        const id = mkUser(`list-${Date.now()}@t.io`, { level: 'full' });
        const row = db.listUsers().find((u) => u.id === id);
        expect(row.access_level).toBe('full');
    });

    test('cont inexistent = viewer', () => {
        expect(accessLevel.levelOf(987654321)).toBe('viewer');
        expect(accessLevel.levelOf(0)).toBe('viewer');
        expect(accessLevel.levelOf(null)).toBe('viewer');
    });

    test('maneta de urgenta: VIEWER_GATE_ENABLED=false ii face pe toti full', () => {
        const id = mkUser(`sw-${Date.now()}@t.io`);
        const old = process.env.VIEWER_GATE_ENABLED;
        process.env.VIEWER_GATE_ENABLED = 'false';
        try { expect(accessLevel.levelOf(id)).toBe('full'); }
        finally { if (old === undefined) delete process.env.VIEWER_GATE_ENABLED; else process.env.VIEWER_GATE_ENABLED = old; }
        expect(accessLevel.levelOf(id)).toBe('viewer');
    });
});

describe('⛔ motoarele nu pornesc pentru viewer', () => {
    const brain = require('../../server/services/serverBrain');
    const serverAT = require('../../server/services/serverAT');
    const stcOf = (uid) => brain.getConfig ? brain.getConfig(uid) : null;

    test('updateConfig nu baga un viewer in bucla brain-ului, dar baga un cont full', () => {
        const viewer = mkUser(`v-${Date.now()}@t.io`);
        const full = mkUser(`f-${Date.now()}@t.io`, { level: 'full' });
        brain.updateConfig(viewer, { confMin: 65, size: 100 });
        brain.updateConfig(full, { confMin: 65, size: 100 });
        const ids = brain.__sp1.stcUserIds();
        expect(ids).not.toContain(viewer);
        expect(ids).toContain(full);
    });

    test('un cont coborat la viewer iese din bucla la urmatoarea configurare', () => {
        const id = mkUser(`d-${Date.now()}@t.io`, { level: 'full' });
        brain.updateConfig(id, { confMin: 65 });
        expect(brain.__sp1.stcUserIds()).toContain(id);
        db.setAccessLevel(id, 'viewer');
        brain.updateConfig(id, { confMin: 70 });
        expect(brain.__sp1.stcUserIds()).not.toContain(id);
    });

    test('processBrainDecision refuza intrarea pentru viewer, la poarta, si nu pentru un cont full', () => {
        // Proba prin mutatie a aratat ca „intoarce null" nu dovedeste nimic:
        // decizia de test e respinsa si de alte porti. Deci se verifica poarta
        // INSASI — randul ei de jurnal apare pentru viewer si nu pentru full.
        const logger = require('../../server/services/logger');
        const viewer = mkUser(`pv-${Date.now()}@t.io`);
        const full = mkUser(`pf-${Date.now()}@t.io`, { level: 'full' });
        const decision = { symbol: 'BTCUSDT', price: 70000, fusion: { dir: 'LONG', decision: 'LARGE', confidence: 90, score: 90 }, ts: Date.now() };
        const stc = { size: 100, lev: 5, slPct: 1.5, rr: 2, maxPos: 4 };
        const spy = jest.spyOn(logger, 'warn');
        try {
            expect(serverAT.processBrainDecision(decision, stc, viewer)).toBeNull();
            try { serverAT.processBrainDecision(decision, stc, full); } catch (_) { /* alte porti; nu conteaza aici */ }
            const gate = spy.mock.calls.filter((c) => String(c[1]).includes('[BETA-GATE] entry refused'));
            expect(gate.length).toBe(1);
            expect(String(gate[0][1])).toContain(`uid=${viewer}`);
            // a doua incercare nu mai scrie un rand (unul pe cont, nu unul pe ciclu)
            serverAT.processBrainDecision(decision, stc, viewer);
            expect(spy.mock.calls.filter((c) => String(c[1]).includes('[BETA-GATE] entry refused')).length).toBe(1);
        } finally { spy.mockRestore(); }
        expect(serverAT.getOpenPositions(viewer)).toEqual([]);
    });
});
