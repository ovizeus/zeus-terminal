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

module.exports = { buildGeomRows };
