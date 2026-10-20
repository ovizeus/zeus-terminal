'use strict';
// [2026-10-20 b289] Decide CE se sterge offsite INAINTE de urcare, ca sa incapa.
//
// De ce exista fisierul asta: retentia veche tagea dupa NUMAR (KEEP_N) si rula
// DUPA urcare (pasul 4, adica dupa `exit 1` al pasului 3). Pe Drive erau exact
// 14 obiecte = exact KEEP_N, deci `head -n -14` nu intorcea nimic, iar ca sa
// devina 15 trebuia o urcare reusita. Urcarea nu reusea fiindca nu era spatiu.
// Impas inchis: fara spatiu -> fara urcare -> fara retentie -> fara spatiu.
// Offsite-ul a stat mort 7 zile (14-20 oct) si nimeni nu a fost anuntat.
//
// Regula noua: retentia se judeca pe SPATIU, nu pe numar, si INAINTE de urcare.
// Fail-closed: daca nici stergand tot ce se poate nu incape, NU stergem nimic
// si raportam. Mai bine un offsite vechi intact decat zero copii offsite.

const DEFAULT_MIN_KEEP = 3;

/**
 * @param {object} o
 * @param {Array<{name:string,size:number,mtime?:number}>} o.files existente offsite
 * @param {number} o.freeBytes spatiu liber raportat de remote
 * @param {number} o.needBytes dimensiunea fisierului de urcat
 * @param {number} [o.keepN] retentie pe numar (se aplica si ea)
 * @param {number} [o.minKeep] cate copii NU se sterg niciodata
 * @param {number} [o.headroom] marja peste needBytes
 * @returns {{ok:boolean, toDelete:string[], reason:string, freedBytes:number}}
 */
function planOffsitePrune(o) {
    const files = Array.isArray(o && o.files) ? o.files.slice() : [];
    const freeBytes = Number(o && o.freeBytes);
    const needBytes = Number(o && o.needBytes);
    const keepN = Number.isFinite(o && o.keepN) ? o.keepN : 14;
    const minKeep = Number.isFinite(o && o.minKeep) ? o.minKeep : DEFAULT_MIN_KEEP;
    const headroom = Number.isFinite(o && o.headroom) ? o.headroom : 0;

    if (!Number.isFinite(needBytes) || needBytes <= 0) {
        return { ok: false, toDelete: [], reason: 'needBytes invalid', freedBytes: 0 };
    }
    if (!Number.isFinite(freeBytes)) {
        // Nu stim spatiul (remote fara quota raportata) -> nu stergem pe orbeste.
        return { ok: true, toDelete: [], reason: 'free space unknown — no pre-prune', freedBytes: 0 };
    }

    const target = needBytes + headroom;

    // Cele mai vechi intai. Sortare stabila pe mtime, cu numele ca tiebreak
    // (numele contine marca de timp, deci e ordonabil si fara mtime).
    files.sort((a, b) => {
        const am = Number(a.mtime), bm = Number(b.mtime);
        if (Number.isFinite(am) && Number.isFinite(bm) && am !== bm) return am - bm;
        return String(a.name).localeCompare(String(b.name));
    });

    // Cat se poate sterge: tot ce depaseste minKeep, plus ce cere retentia pe numar.
    // Dupa urcare vor fi files.length + 1 copii, deci retentia pe numar permite
    // stergerea a (files.length + 1 - keepN) dintre cele mai vechi.
    const deletableByMin = Math.max(0, files.length - minKeep);
    const byCount = Math.max(0, files.length + 1 - keepN);

    const toDelete = [];
    let freed = 0;

    // 1. Retentia pe numar: se aplica oricum, indiferent de spatiu.
    for (let i = 0; i < Math.min(byCount, deletableByMin); i++) {
        toDelete.push(files[i].name);
        freed += Number(files[i].size) || 0;
    }

    // 2. Pe spatiu: mai stergem din cele vechi pana incape.
    for (let i = toDelete.length; i < deletableByMin && freeBytes + freed < target; i++) {
        toDelete.push(files[i].name);
        freed += Number(files[i].size) || 0;
    }

    if (freeBytes + freed < target) {
        return {
            ok: false,
            toDelete: [],
            reason: `nu incape: liber ${freeBytes} + eliberabil ${freed} < necesar ${target} (minKeep=${minKeep} protejeaza ${Math.min(minKeep, files.length)} copii)`,
            freedBytes: 0,
        };
    }

    return {
        ok: true,
        toDelete,
        reason: toDelete.length ? `prune ${toDelete.length} vechi (elibereaza ${freed}B)` : 'spatiu suficient',
        freedBytes: freed,
    };
}

module.exports = { planOffsitePrune, DEFAULT_MIN_KEEP };
