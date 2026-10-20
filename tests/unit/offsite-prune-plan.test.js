'use strict';
const { planOffsitePrune } = require('../../scripts/lib/offsitePrunePlan');

const MB = 1024 * 1024;
const GB = 1024 * MB;

// Starea REALA de pe Drive, 2026-10-20: 7 fisiere din iunie necomprimate
// (1,3-2,07 GB) + 7 comprimate (~275 MB) = 14 obiecte = exact KEEP_N,
// 141 MiB liberi, si un fisier nou de 275 MB care nu incape.
function driveStateOct20() {
    const files = [];
    const june = [1335.9, 1371.0, 1645.2, 1707.4, 1879.0, 2000.2, 2074.8];
    june.forEach((mb, i) => files.push({ name: `zeus-offsite-202606${18 + i}-033001.db.enc`, size: mb * MB, mtime: 1000 + i }));
    const oct = [263.5, 264.9, 274.2, 274.5, 282.4, 265.2, 269.3];
    oct.forEach((mb, i) => files.push({ name: `zeus-offsite-202610${String(7 + i).padStart(2, '0')}-033001.db.enc`, size: mb * MB, mtime: 2000 + i }));
    return files;
}

describe('planOffsitePrune', () => {
    test('sparge impasul real de pe Drive: face loc stergand cele mai vechi', () => {
        const r = planOffsitePrune({
            files: driveStateOct20(),
            freeBytes: 141 * MB,
            needBytes: 275 * MB,
            keepN: 14,
            minKeep: 3,
        });
        expect(r.ok).toBe(true);
        expect(r.toDelete.length).toBeGreaterThan(0);
        // Cele mai vechi (iunie) pleaca primele, nu cele noi.
        expect(r.toDelete[0]).toBe('zeus-offsite-20260618-033001.db.enc');
        expect(r.toDelete.join()).not.toMatch(/202610/);
        // Dupa prune incape.
        expect(141 * MB + r.freedBytes).toBeGreaterThanOrEqual(275 * MB);
    });

    test('retentia pe NUMAR singura nu ar fi rezolvat nimic la 14 fisiere/keepN=14', () => {
        // Dovada regresiei vechi: cu exact keepN fisiere, byCount = 14+1-14 = 1,
        // deci stergea UN fisier — dar numai DUPA urcare, care nu reusea.
        // Aici planul ruleaza INAINTE si taie cat trebuie, nu doar unul.
        const r = planOffsitePrune({
            files: driveStateOct20(), freeBytes: 141 * MB, needBytes: 275 * MB, keepN: 14, minKeep: 3,
        });
        expect(r.toDelete.length).toBeGreaterThanOrEqual(1);
    });

    test('fail-closed: daca nici stergand tot permis nu incape, NU sterge nimic', () => {
        const r = planOffsitePrune({
            files: [{ name: 'a.enc', size: 10 * MB, mtime: 1 }, { name: 'b.enc', size: 10 * MB, mtime: 2 },
                    { name: 'c.enc', size: 10 * MB, mtime: 3 }, { name: 'd.enc', size: 10 * MB, mtime: 4 }],
            freeBytes: 0, needBytes: 5 * GB, keepN: 14, minKeep: 3,
        });
        expect(r.ok).toBe(false);
        expect(r.toDelete).toEqual([]);
        expect(r.reason).toMatch(/nu incape/);
    });

    test('minKeep nu se incalca niciodata', () => {
        const files = [1, 2, 3, 4, 5].map(i => ({ name: `f${i}.enc`, size: 1 * GB, mtime: i }));
        const r = planOffsitePrune({ files, freeBytes: 0, needBytes: 2 * GB, keepN: 14, minKeep: 3 });
        expect(r.ok).toBe(true);
        expect(r.toDelete.length).toBeLessThanOrEqual(files.length - 3);
    });

    test('nu sterge ultima copie cand e singura', () => {
        const r = planOffsitePrune({
            files: [{ name: 'only.enc', size: 1 * GB, mtime: 1 }],
            freeBytes: 0, needBytes: 1 * GB, keepN: 14, minKeep: 3,
        });
        expect(r.ok).toBe(false);
        expect(r.toDelete).toEqual([]);
    });

    test('spatiu necunoscut -> nu stergem pe orbeste', () => {
        const r = planOffsitePrune({ files: driveStateOct20(), freeBytes: NaN, needBytes: 275 * MB });
        expect(r.ok).toBe(true);
        expect(r.toDelete).toEqual([]);
        expect(r.reason).toMatch(/unknown/);
    });

    test('spatiu berechet -> zero stergeri', () => {
        const r = planOffsitePrune({
            files: [{ name: 'a.enc', size: 1 * MB, mtime: 1 }],
            freeBytes: 10 * GB, needBytes: 275 * MB, keepN: 14, minKeep: 3,
        });
        expect(r.ok).toBe(true);
        expect(r.toDelete).toEqual([]);
    });

    test('retentia pe numar se aplica si cand e spatiu berechet', () => {
        const files = Array.from({ length: 20 }, (_, i) => ({ name: `f${String(i).padStart(2, '0')}.enc`, size: 1 * MB, mtime: i }));
        const r = planOffsitePrune({ files, freeBytes: 100 * GB, needBytes: 1 * MB, keepN: 14, minKeep: 3 });
        expect(r.ok).toBe(true);
        expect(r.toDelete.length).toBe(20 + 1 - 14);
        expect(r.toDelete[0]).toBe('f00.enc');
    });

    test('needBytes invalid e respins', () => {
        expect(planOffsitePrune({ files: [], freeBytes: 0, needBytes: 0 }).ok).toBe(false);
        expect(planOffsitePrune({ files: [], freeBytes: 0, needBytes: NaN }).ok).toBe(false);
    });

    test('ordoneaza dupa nume cand mtime lipseste', () => {
        const files = [{ name: 'zeus-offsite-20261013.enc', size: 1 * GB }, { name: 'zeus-offsite-20260618.enc', size: 1 * GB },
                       { name: 'zeus-offsite-20260901.enc', size: 1 * GB }, { name: 'zeus-offsite-20261001.enc', size: 1 * GB }];
        const r = planOffsitePrune({ files, freeBytes: 0, needBytes: 1 * GB, keepN: 14, minKeep: 3 });
        expect(r.toDelete[0]).toBe('zeus-offsite-20260618.enc');
    });
});
