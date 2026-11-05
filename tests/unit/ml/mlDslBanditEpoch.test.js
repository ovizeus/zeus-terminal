'use strict';
// [2026-11-05] Recompensa si-a schimbat DEFINITIA la b378, deci posteriorul vechi
// nu mai e comparabil cu cel nou.
//
// Cele 1.826 de observatii din `ml_dsl_arm_posterior` s-au strans sub schema
// veche, care era poluata (doua fluxuri cu semn opus in aceeasi celula) si
// saturata (`win` binar fata de o baza comuna pe care toate presetele o bat).
// Amestecate cu date curate, ar trebui ~3 saptamani sa se spele.
//
// Varianta evidenta era sa golesc tabela. Dar cand se schimba definitia unei
// recompense, lucrul corect NU e sa stergi istoricul — e sa VERSIONEZI schema:
//   * nicio scriere distructiva pe baza vie;
//   * randurile vechi rămân, ca document al ce a produs schema veche;
//   * numaratoarea curata e exacta de la PRIMA inchidere, fara amestec.
//
// `ml_dsl_arm_posterior` (schema 1) devine inert. `ml_dsl_arm_posterior_r2`
// (schema 2 = relWin + TRAINING_COHORTS) e cel pe care bandit-ul il foloseste.
const Database = require('better-sqlite3');
const bandit = require('../../../server/services/mlDslBandit');

let db;
beforeEach(() => {
    db = new Database(':memory:');
    const shape = `(cell_key TEXT NOT NULL, arm TEXT NOT NULL, alpha REAL NOT NULL DEFAULT 1,
                    beta REAL NOT NULL DEFAULT 1, n INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL, PRIMARY KEY (cell_key, arm))`;
    db.exec(`CREATE TABLE ml_dsl_arm_posterior ${shape};`);
    db.exec(`CREATE TABLE ml_dsl_arm_posterior_r2 ${shape};`);
    bandit._setDb(db);
});
afterEach(() => { try { db.close(); } catch (_) {} });

const oldRows = () => db.prepare('SELECT * FROM ml_dsl_arm_posterior').all();
const newRows = () => db.prepare('SELECT * FROM ml_dsl_arm_posterior_r2').all();

describe('posteriorul versionat', () => {
    it('scrie in tabela schemei 2, nu in cea veche', () => {
        bandit.update('1:DEMO:BTCUSDT:TREND', 'fast', true);
        expect(newRows()).toHaveLength(1);
        expect(oldRows()).toHaveLength(0);
    });

    it('REGRESIE: datele vechi NU influenteaza posteriorul nou', () => {
        // Asta era tot scopul: 1.826 de observatii poluate nu au voie sa conteze.
        db.prepare(`INSERT INTO ml_dsl_arm_posterior (cell_key,arm,alpha,beta,n,updated_at)
                    VALUES (?,?,?,?,?,?)`).run('1:DEMO:BTCUSDT:TREND', 'fast', 165, 514, 679, 1);
        const post = bandit._post('1:DEMO:BTCUSDT:TREND', 'fast');
        expect(post).toEqual({ alpha: 1, beta: 1 });   // prior uniform, nu 165/514
    });

    it('nu ATINGE tabela veche — e document, nu gunoi', () => {
        db.prepare(`INSERT INTO ml_dsl_arm_posterior (cell_key,arm,alpha,beta,n,updated_at)
                    VALUES (?,?,?,?,?,?)`).run('1:DEMO:BTCUSDT:TREND', 'fast', 165, 514, 679, 1);
        for (let i = 0; i < 5; i++) bandit.update('1:DEMO:BTCUSDT:TREND', 'fast', i % 2 === 0);
        const old = oldRows();
        expect(old).toHaveLength(1);
        expect(old[0].alpha).toBe(165);   // neatins
        expect(old[0].beta).toBe(514);
        expect(old[0].n).toBe(679);
    });

    it('acumuleaza corect in schema 2', () => {
        bandit.update('c', 'a', true);
        bandit.update('c', 'a', true);
        bandit.update('c', 'a', false);
        const p = bandit._post('c', 'a');
        expect(p.alpha).toBe(3);   // 1 + 2 castiguri
        expect(p.beta).toBe(2);    // 1 + 1 pierdere
        expect(newRows()[0].n).toBe(3);
    });

    it('o celula necunoscuta da priorul uniform, nu zero', () => {
        // alpha/beta = 0 ar face Beta() sa explodeze.
        expect(bandit._post('nimic', 'nimic')).toEqual({ alpha: 1, beta: 1 });
    });

    it('sampleArm citeste schema 2 si alege dintre bratele date', () => {
        bandit.update('c', 'bun', true); bandit.update('c', 'bun', true); bandit.update('c', 'bun', true);
        bandit.update('c', 'rau', false); bandit.update('c', 'rau', false); bandit.update('c', 'rau', false);
        const picks = {};
        for (let i = 0; i < 200; i++) {
            const a = bandit.sampleArm('c', ['bun', 'rau']);
            picks[a] = (picks[a] || 0) + 1;
        }
        expect(Object.keys(picks).sort()).toEqual(['bun', 'rau']);
        expect(picks.bun).toBeGreaterThan(picks.rau);   // invata, nu da cu zarul
    });

    it('cand baza ARUNCA, tot da priorul uniform — nu zero', () => {
        // Prins de o mutatie: calea de EROARE nu era probata, doar cea normala.
        // alpha/beta = 0 ar face Beta() sa explodeze la prima tragere.
        const broken = { prepare() { throw new Error('no such table'); } };
        bandit._setDb(broken);
        expect(bandit._post('c', 'a')).toEqual({ alpha: 1, beta: 1 });
        expect(() => bandit.sampleArm('c', ['a', 'b'])).not.toThrow();
        const pick = bandit.sampleArm('c', ['a', 'b']);
        expect(['a', 'b']).toContain(pick);
    });

    it('numele tabelei schemei 2 e expus, ca sa fie probabil', () => {
        expect(bandit.POSTERIOR_TABLE).toBe('ml_dsl_arm_posterior_r2');
    });
});
