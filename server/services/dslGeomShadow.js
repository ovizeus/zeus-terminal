'use strict';

// [GEOM SHADOW 2026-10-21] Colectează contrafactualul pe GEOMETRIA DSL.
//
// De ce există: auditul din 2026-10-21 a arătat că DSL taie numai câştigătorii —
// 0% activ pe cele 103 ieşiri HIT_SL, 100% pe cele 440 DSL — deci câştigul se
// închide la 3,4% din ţintă iar pierderea curge întreagă. E cel mai mare lucru
// rămas, şi singurul care schimbă semnul rezultatului. Dar nu se poate decide
// fără să ştii ce ar fi dat o altă geometrie, iar asta nu se poate calcula
// retroactiv: urmele de preţ stau în memorie (`priceTrace`) şi se şterg la
// închiderea poziţiei. Singura cale e să înceapă să se colecteze.
//
// Ironia: cohortul `shadow` există din b140 şi simulează... ACELAŞI preset cu
// care a rulat poziţia. `dslArm` nu e atribuit nicăieri în cod, doar citit, deci
// `arm` cade mereu pe `dslModeAtOpen`. Cohortul nu producea nicio informaţie
// despre geometrie — măsura doar cât de optimist e simulatorul faţă de realitate
// (ceea ce s-a dovedit util pe alt drum, dar nu e întrebarea).
//
// De ce design-ul ăsta e valid deşi simulatorul e optimist: optimismul măsurat
// (+0,0333 pp, după ce se exclud ieşirile care n-au fost decizia DSL-ului) e
// COMUN tuturor rândurilor, fiindcă toate pornesc din aceeaşi urmă şi aceeaşi
// bază. Deci se anulează la comparaţia arm-vs-arm. Valoarea absolută a unui rând
// are nevoie de corecţie; DIFERENŢA dintre două geometrii nu.

/**
 * Simulează fiecare preset pe aceeaşi urmă de preţ şi întoarce un rând pe
 * geometrie. Baza e PnL-ul REALIZAT, identică pentru toate rândurile.
 *
 * Nu aruncă niciodată: un preset care crapă e sărit, restul se păstrează —
 * altfel o singură eroare ar şterge toată măsurătoarea pe acea poziţie.
 */
function buildGeomRows({ presets, meta, prices, realizedPnlPct, simulate } = {}) {
    if (!presets || typeof presets !== 'object') return [];
    if (typeof simulate !== 'function') return [];
    // O urmă de un singur preţ nu descrie nicio traiectorie — n-are rost să
    // inventăm un contrafactual din ea.
    if (!Array.isArray(prices) || prices.length < 2) return [];
    const base = Number(realizedPnlPct);
    if (!Number.isFinite(base)) return [];

    const rows = [];
    for (const arm of Object.keys(presets)) {
        let sim;
        try {
            sim = simulate(presets[arm], meta, prices);
        } catch (_) { continue; }
        const p = sim && Number(sim.pnlPct);
        if (!Number.isFinite(p)) continue;
        rows.push({ arm, simPnlPct: p, baselinePnlPct: base, advantage: p - base });
    }
    return rows;
}

/**
 * Agregă rândurile colectate, pe geometrie, pentru citire.
 *
 * Colectarea fără citire e exact cum a stat cohortul `shadow` patru luni: date
 * pe care nimeni nu se uită, cu semantică greşită, şi nimeni n-a observat. Deci
 * citirea se livrează odată cu colectarea, nu „mai târziu".
 *
 * Dă şi mediană, nu doar medie, pentru că la `SMART_CUT` media a fost înşelătoare
 * exact aşa: +0,052 pe medie, dar mediană 0 — adică nicio diferenţă în tranzacţia
 * tipică, totul venit dintr-o minoritate de cazuri. Aceeaşi capcană se aplică
 * geometriei, deci cifra care o arată stă lângă cea care o ascunde.
 */
function summarizeGeomRows(rows) {
    if (!Array.isArray(rows)) return [];
    const by = new Map();
    for (const r of rows) {
        if (!r || typeof r !== 'object') continue;
        const arm = r.arm;
        if (typeof arm !== 'string' || !arm) continue;
        const adv = Number(r.advantage);
        if (!Number.isFinite(adv)) continue;
        if (!by.has(arm)) by.set(arm, []);
        by.get(arm).push(adv);
    }
    const out = [];
    for (const [arm, vals] of by) {
        const n = vals.length;
        const sorted = vals.slice().sort((a, b) => a - b);
        const mid = Math.floor(n / 2);
        const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        out.push({
            arm, n,
            avgAdvantage: vals.reduce((a, b) => a + b, 0) / n,
            medianAdvantage: median,
            better: vals.filter(v => v > 0).length,
            worse: vals.filter(v => v < 0).length,
            neutral: vals.filter(v => v === 0).length,
        });
    }
    // Descrescător: prima linie e geometria cu cel mai mare avantaj mediu.
    out.sort((a, b) => b.avgAdvantage - a.avgAdvantage);
    return out;
}

module.exports = { buildGeomRows, summarizeGeomRows };
