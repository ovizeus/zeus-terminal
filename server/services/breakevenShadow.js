// server/services/breakevenShadow.js
// [2026-11-22] UMBRA: „daca stopul s-ar fi mutat la intrare (breakeven) dupa +X%".
//
// Masurat pe 14 zile, toate conturile: 399 de pozitii au fost pe plus cel putin 0,3%
// si au iesit pe minus (−9.044$). Cat ar fi salvat o mutare a stopului la intrare —
// si cat ar fi COSTAT (castigatorii care ar fi fost scosi pe zero) — nu se poate
// stii din MFE-ul final: trebuie ORDINEA preturilor. Aici o urmarim tick cu tick:
//   armat  = pretul a ajuns la +X% in favoarea pozitiei
//   lovit  = DUPA ce s-a armat, pretul s-a intors la pretul de intrare
// La inchidere: pnl in umbra = 0 daca a fost lovit, altfel pnl-ul real.
//
// NU muta stopul, NU inchide nimic: scrie doar `pos._beShadow`, care ajunge in
// at_closed odata cu pozitia. Se aplica la toate pozitiile, la toate conturile.
'use strict';

const THRESHOLDS = Object.freeze([0.3, 0.5, 0.8]);

function _favorablePct(side, entry, price) {
    if (!(entry > 0) || !Number.isFinite(price)) return null;
    return side === 'SHORT' ? (entry - price) / entry * 100 : (price - entry) / entry * 100;
}

/** Actualizeaza starea de umbra la un pret nou. Pur pe `pos._beShadow`. */
function track(pos, price, nowTs) {
    if (!pos) return;
    const fav = _favorablePct(pos.side, +pos.price, price);
    if (fav === null) return;
    const st = pos._beShadow || (pos._beShadow = {});
    for (const t of THRESHOLDS) {
        const k = String(t);
        const s = st[k] || (st[k] = { armedTs: null, hitTs: null });
        if (s.hitTs) continue;
        if (!s.armedTs) {
            if (fav >= t) s.armedTs = nowTs || Date.now();
        } else if (fav <= 0) {
            s.hitTs = nowTs || Date.now();
        }
    }
}

/** Rezultatul in umbra pentru o pozitie inchisa: { '0.3': {armed, hit, shadowPnl}, ... }. */
function outcome(pos, realPnl) {
    const out = {};
    const st = (pos && pos._beShadow) || {};
    for (const t of THRESHOLDS) {
        const s = st[String(t)] || {};
        const hit = !!s.hitTs;
        out[String(t)] = { armed: !!s.armedTs, hit, shadowPnl: hit ? 0 : realPnl };
    }
    return out;
}

module.exports = { THRESHOLDS, track, outcome };
