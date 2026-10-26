'use strict';
// ══════════════════════════════════════════════════════════════════
// PREDICŢIA pe lichidări — unde e magnetul, şi cât de sigur NU suntem
// ══════════════════════════════════════════════════════════════════
//
// [LIQ-PREDICT 2026-10-26] Operatorul: „să socotească din lichidările reale
// unde e atracţia, magnetul… pe BTC şi ETH… dar date reale, nu fake".
//
// ⚠️ MECANICA, şi aici se poate greşi catastrofal semnul
//
// Long lichidat  = vânzare forţată = preţul COBOARĂ.
// Short lichidat = cumpărare forţată = preţul URCĂ.
//
// Verificat în datele reale ale operatorului (2026-10-26, BTCUSDT):
//   23:00 → 137 M$ LONG  lichidat, preţul 80 755 → 79 808  (a căzut)
//   04:00 →  40 M$ SHORT lichidat, preţul 79 273 → 80 095  (a urcat)
//
// Combustibilul ARS nu mai e acolo. Dacă s-au ars longurile de jos, ce rămâne
// sunt shorturile de sus ⇒ magnetul arată SUS. Şi invers. Magnetul arată
// întotdeauna spre partea care NU a ars.
//
// Operatorul formulase invers („s-a lichidat pe short ⇒ urcă"); mecanismul lui
// era corect, direcţia se răsturnase la jumătatea propoziţiei. I-am spus, şi
// primul test din suită apără semnul — fiindcă pe 23 octombrie am livrat un
// filtru cu semnul întors şi a trebuit retras tot (R-V-13).
//
// ⚠️ CE NU FACE MODULUL ASTA
//
// NU dă un procent de probabilitate din formulă. Un procent înseamnă „din 100
// de ori când semnalul a arătat aşa, în N a nimerit" — iar asta se NUMĂRĂ, nu
// se deduce. Până sunt destule cazuri rezolvate pe klines reale, panoul scrie
// CALIBRATING. Decizia operatorului, 2026-10-26, întrebat explicit.

const HALF_LIFE_MS = 4 * 3600000;   // efectul de combustibil ars e de ordinul
                                    // orelor, nu al zilelor
const MIN_DECAYED_USD = 1e6;        // sub asta nu e piaţă, e tremurat
const MIN_IMBALANCE = 0.25;         // sub asta nu există magnet, există zgomot
const MIN_STRENGTH = 25;            // sub asta tace
const MIN_SAMPLES = 30;             // cazuri rezolvate înainte de orice procent
const BAND_PCT = 0.003;             // palier de preţ: 0,3% (≈240$ pe BTC)
const MIN_TARGET_USD = 1e6;
// Linia de baza are nevoie de material ca sa insemne ceva. Sub astea nu se
// afirma nimic: masurarea fata de ZERO e dovedit greşita (vezi mai jos), iar
// masurarea fata de o linie de baza inventata ar fi mai rea.
const BASELINE_MIN_EVENTS = 100;
const BASELINE_MIN_HOURS = 6;

/**
 * Greutatea unui eveniment după vârstă. La un timp de înjumătăţire = 0,5.
 *
 * Vârsta negativă (marcaj din viitor — ceasuri nesincronizate între burse, se
 * întâmplă) iese pe ramura de mai jos cu greutate 1, deci un eveniment „din
 * viitor" nu cântăreşte mai mult decât unul de acum.
 *
 * [2026-10-26] Aveam aici şi un `Math.min(1, …)`. O mutaţie l-a scos şi toate
 * cele 16 teste au trecut: era COD MORT, fiindcă pentru vârstă pozitivă puterea
 * e deja sub 1, iar cazul negativ se întoarce mai sus. Comentariul meu atribuia
 * garda unui loc unde nu se întâmpla nimic — aceeaşi clasă cu fixul livrat în
 * cod mort de la b285. Scos.
 */
function weight(ageMs, halfLife = HALF_LIFE_MS) {
    const a = Number(ageMs);
    if (!Number.isFinite(a) || a <= 0) return 1;
    return Math.pow(2, -a / halfLife);
}

/** Dolari ponderaţi cu vârsta, pe cele două părţi. 'SELL' = LONG lichidat. */
function decayedUsd(events, now, halfLife = HALF_LIFE_MS) {
    let long = 0, short = 0;
    if (!Array.isArray(events)) return { long, short };
    for (const e of events) {
        const usd = Number(e && e.usd);
        if (!Number.isFinite(usd) || usd <= 0) continue;
        const w = weight(now - Number(e.ts), halfLife);
        if (e.side === 'SELL') long += usd * w;
        else if (e.side === 'BUY') short += usd * w;
    }
    return { long, short };
}

/**
 * Linia de baza a simbolului: ce dezechilibru e NORMAL pentru piata asta.
 *
 * ⚠️ DE CE EXISTA, cu masuratoarea care a impus-o (2026-10-26, 13h de date
 * reale): masurand dezechilibrul fata de ZERO, semnalul a dat 19 UP / 0 DOWN
 * pe BTC si 22 UP / 0 DOWN pe ETH. Un instrument care nu poate spune niciodata
 * una din cele doua direcţii nu masoara nimic.
 *
 * Cauza e structurala, nu un bug de cod: mulţimea e 69-77% long (raportul de
 * conturi Binance), deci pe BTC 71,4% din dolarii lichidaţi sunt LONGURI prin
 * natura pieţei. „Longurile ard mai mult" e starea de repaus, nu o informaţie.
 * Doar ABATEREA de la ea spune ceva. Pe aceleasi date, masurarea relativa da
 * 10 UP / 4 DOWN / 9 NO EDGE — adica discriminare.
 *
 * NU se pondereaza cu varsta, dinadins: linia de baza descrie NORMALUL, nu
 * acum. Daca ar descreste, ar urmari exact semnalul pe care trebuie sa-l
 * judece, si diferenţa ar tinde mereu spre zero.
 */
function buildBaseline(events, now, hours) {
    if (!Array.isArray(events) || !events.length) return null;
    let long = 0, short = 0, n = 0;
    for (const e of events) {
        const usd = Number(e && e.usd);
        if (!Number.isFinite(usd) || usd <= 0) continue;
        if (e.side === 'SELL') long += usd;
        else if (e.side === 'BUY') short += usd;
        else continue;
        n++;
    }
    const tot = long + short;
    if (tot <= 0) return null;
    return { imbalance: (long - short) / tot, n, hours: Number(hours) || 0, longUsd: long, shortUsd: short };
}

/**
 * Ţinta: palierul de preţ, în direcţia magnetului, unde moare partea opusă.
 *
 * NU o cifră rotundă şi NU o proiecţie. Preţul fiecărei lichidări e măsurat,
 * deci palierele spun unde s-a concentrat efectiv levierul. Dacă în direcţia
 * magnetului nu există niciun palier, întoarce NULL — panoul scrie că nu are
 * ţintă cartografiată, în loc să inventeze una.
 */
function target({ price, side, events }) {
    const p = Number(price);
    if (!p || p <= 0 || !Array.isArray(events) || !events.length) return null;
    if (side !== 'UP' && side !== 'DOWN') return null;

    // Magnet SUS ⇒ ne interesează unde mor SHORTURILE (BUY), deasupra preţului.
    const wantSide = side === 'UP' ? 'BUY' : 'SELL';
    const band = Math.max(1e-8, p * BAND_PCT);
    const bands = new Map();

    for (const e of events) {
        if (!e || e.side !== wantSide) continue;
        const ep = Number(e.price), usd = Number(e.usd);
        if (!Number.isFinite(ep) || ep <= 0 || !Number.isFinite(usd) || usd <= 0) continue;
        if (side === 'UP' ? ep <= p : ep >= p) continue;
        const key = Math.floor(ep / band);
        const b = bands.get(key) || { usd: 0, pxUsd: 0, n: 0 };
        b.usd += usd; b.pxUsd += ep * usd; b.n++;
        bands.set(key, b);
    }
    if (!bands.size) return null;

    let best = null;
    for (const b of bands.values()) if (!best || b.usd > best.usd) best = b;
    if (!best || best.usd < MIN_TARGET_USD) return null;

    // Preţul mediu ponderat în dolari din palier — mai cinstit decât marginea
    // palierului, care e un artefact al grilei mele.
    const tp = best.pxUsd / best.usd;
    return { price: tp, usd: best.usd, n: best.n, pct: ((tp - p) / p) * 100 };
}

/**
 * Semnalul. Întoarce side 'UP' | 'DOWN' | 'NONE'.
 *
 * 'NONE' e un rezultat de primă clasă, nu un eşec: cea mai importantă funcţie
 * a rubricii e să TACĂ atunci când nu ştie. Un panou care arată mereu o
 * direcţie e un panou care minte jumătate din timp.
 */
function score({ symbol, price, now, events, crowd, oi, halfLife, baseline }) {
    const out = {
        symbol: symbol || null, side: 'NONE', strength: 0, reason: 'no data',
        longBurnedUsd: 0, shortBurnedUsd: 0, imbalance: 0, events: 0,
        target: null, crowdLongPct: null, oiChangePct: null,
        baselineImbalance: null, relativeImbalance: null,
    };
    if (!Array.isArray(events) || !events.length) return out;
    out.events = events.length;

    const d = decayedUsd(events, now, halfLife);
    out.longBurnedUsd = d.long;
    out.shortBurnedUsd = d.short;
    const total = d.long + d.short;
    if (total < MIN_DECAYED_USD) { out.reason = 'not enough liquidation volume'; return out; }

    // Pozitiv = s-au ars LONGURILE ⇒ combustibilul rămas e SUS ⇒ magnet UP.
    const imb = (d.long - d.short) / total;
    out.imbalance = imb;

    // ⚠️ Masurat fata de LINIA DE BAZA a simbolului, nu fata de zero. Vezi
    // buildBaseline: fata de zero, semnalul n-a putut spune DOWN niciodata in
    // 13 ore de date reale, pe niciunul din cele doua simboluri.
    //
    // Fara o linie de baza SOLIDA nu se afirma nimic. Cedeaza INCHIS, ca garda
    // de la b297: a tacea e un rezultat, a ghici nu.
    const b = baseline && Number.isFinite(Number(baseline.imbalance)) ? baseline : null;
    if (!b || Number(b.n) < BASELINE_MIN_EVENTS || Number(b.hours) < BASELINE_MIN_HOURS) {
        out.reason = 'baseline not established yet — need '
            + BASELINE_MIN_EVENTS + ' events over ' + BASELINE_MIN_HOURS + 'h';
        return out;
    }
    out.baselineImbalance = Number(b.imbalance);
    const rel = imb - out.baselineImbalance;
    out.relativeImbalance = rel;

    if (Math.abs(rel) < MIN_IMBALANCE) {
        out.reason = 'burn split is normal for this market — no magnet';
        return out;
    }

    const side = rel > 0 ? 'UP' : 'DOWN';

    // Puterea: cât de dezechilibrat (jumătate) şi cât de mare e evenimentul
    // (jumătate). Volumul pe scară LOGARITMICĂ — liniar, 2 M$ lângă 200 M$ ar
    // ieşi zero, aceeaşi greşeală pe care am evitat-o la intensitatea heatmap.
    const volFactor = Math.max(0, Math.min(1, Math.log10(total / 1e6) / 2));
    let strength = 100 * (0.55 * Math.min(1, Math.abs(rel)) + 0.45 * volFactor);

    // Mulţimea: combustibilul RĂMAS, nu cel ars. 69% din conturi long = multă
    // carne de tun dedesubt ⇒ trage JOS. Dacă trage împotriva magnetului,
    // semnalul slăbeşte; dacă trage cu el, se întăreşte, dar mai puţin —
    // confirmarea valorează mai puţin decât contrazicerea.
    if (crowd && Number.isFinite(Number(crowd.longAccount))) {
        const la = Number(crowd.longAccount);
        out.crowdLongPct = la * 100;
        const pullDown = (la - 0.5) * 2;                  // >0 ⇒ trage jos
        const agree = (side === 'DOWN' ? pullDown : -pullDown);
        strength *= agree >= 0 ? (1 + 0.25 * agree) : (1 + 0.5 * agree);
    }

    // Open Interest: dacă urcă în timp ce se arde, levierul se REFACE pe partea
    // arsă ⇒ reversiunea e mai slabă. Dacă scade, piaţa se curăţă efectiv.
    if (oi && Number.isFinite(Number(oi.changePct))) {
        const c = Number(oi.changePct);
        out.oiChangePct = c;
        strength *= (1 - Math.max(-0.15, Math.min(0.15, c / 100)));
    }

    strength = Math.max(0, Math.min(100, strength));
    if (strength < MIN_STRENGTH) {
        out.reason = 'signal too weak to act on';
        out.strength = Math.round(strength);
        return out;
    }

    out.side = side;
    out.strength = Math.round(strength);
    // ⚠️ Formulat RELATIV, dinadins. Prima varianta scria „shorts burned" pe un
    // caz unde in absolut arsesera mai mult LONGURILE (52,7M vs 45,1M pe BTC) —
    // o afirmatie pe care operatorul o putea dezminti citind randul „Burned" de
    // dedesubt. Direcţia vine din abaterea fata de linia de baza, deci motivul
    // trebuie sa spuna exact asta.
    out.reason = side === 'UP'
        ? 'longs burning harder than normal for this market — unburned fuel sits above'
        : 'shorts burning harder than normal for this market — unburned fuel sits below';
    out.target = target({ price, side, events });
    return out;
}

/**
 * Rata de reuşită. NU o probabilitate din formulă — numărul de cazuri în care
 * semnalul a nimerit, măsurat pe klines reale după ce timpul a trecut.
 * Sub pragul de cazuri nu există procent, există starea de calibrare.
 */
function hitRate({ resolved, hits }) {
    const r = Number(resolved) || 0, h = Number(hits) || 0;
    if (r < MIN_SAMPLES) return { calibrating: true, pct: null, resolved: r, hits: h, need: MIN_SAMPLES };
    return { calibrating: false, pct: Math.round((h / r) * 100), resolved: r, hits: h, need: MIN_SAMPLES };
}

/**
 * A nimerit semnalul? Judecat pe bare REALE, luate după ce timpul a trecut.
 *
 * Două reguli, şi rândul spune pe care s-a decis:
 *   TARGET    — exista un palier cartografiat: HIT dacă preţul l-a ATINS
 *               (maximul barelor pentru UP, minimul pentru DOWN). Atingerea,
 *               nu închiderea: un magnet care trage preţul până acolo şi apoi
 *               îl lasă să revină tot a tras.
 *   DIRECTION — nu exista palier: se judecă doar direcţia, pe închidere.
 *
 * Fără bare întoarce NULL. Un rând nerezolvat e cinstit; un rând rezolvat din
 * presupuneri ar strica exact cifra pentru care există tot mecanismul.
 *
 * ⚠️ Granularitatea barelor (5m) înseamnă că extrema e cea a barei, nu a
 * fiecărui tick. Diferenţa e mică şi e aceeaşi în ambele direcţii, deci nu
 * înclină rata într-o parte.
 */
function evaluate({ side, priceAt, targetPrice, bars }) {
    const p = Number(priceAt);
    if (!p || p <= 0) return null;
    if (!Array.isArray(bars)) return null;
    if (side !== 'UP' && side !== 'DOWN') return null;

    // Amandoua extremele, fiindca oglinda are nevoie de cea opusa.
    let maxHigh = -Infinity, minLow = Infinity, lastClose = null;
    for (const b of bars) {
        const hi = Number(b && b.high), lo = Number(b && b.low), c = Number(b && b.close);
        if (Number.isFinite(hi)) maxHigh = Math.max(maxHigh, hi);
        if (Number.isFinite(lo)) minLow = Math.min(minLow, lo);
        if (Number.isFinite(c)) lastClose = c;
    }
    const extreme = side === 'UP' ? maxHigh : minLow;
    // Singura gardă de ieşire pentru „n-am ce măsura": aici ajung şi lista
    // goală, şi o listă de bare numai cu valori stricate. Aveam mai sus şi un
    // `!bars.length`; o mutaţie l-a scos şi nimic n-a căzut — era redundant,
    // fiindcă bucla pe zero bare lasă exact starea asta. Două gărzi pentru
    // acelaşi caz înseamnă că una minte despre ce apără.
    if (!Number.isFinite(extreme) || lastClose === null) return null;

    const tp = Number(targetPrice);
    const hasTarget = Number.isFinite(tp) && tp > 0;
    const outcome = hasTarget
        ? ((side === 'UP' ? extreme >= tp : extreme <= tp) ? 'HIT' : 'MISS')
        : ((side === 'UP' ? lastClose > p : lastClose < p) ? 'HIT' : 'MISS');

    // ⚠️ GRUPUL DE CONTROL — oglinda ţintei, la aceeasi distanţa in partea opusa.
    //
    // Fara el un procent induce in eroare in AMBELE direcţii. Masurat pe 125h
    // de bare reale: o ţinta la -0,58% pe BTC e atinsa NECONDITIONAT in 9% din
    // cazuri pe 1h, dar in 86% pe 24h. Deci „30% pe 1h" e de 3 ori rata de baza
    // (bun), iar „86% pe 24h" e exact rata de baza (zero informaţie) — si fara
    // control amandoua ar arata la fel de convingator, respectiv descurajant.
    //
    // Pe regula DIRECTION nu exista control: oglinda ar fi complementul exact
    // al rezultatului, deci n-ar adauga nicio informaţie. NULL, spus pe faţa.
    let controlOutcome = null;
    let targetPct = null;
    if (hasTarget) {
        const dist = (tp - p) / p;
        targetPct = dist * 100;
        const mirror = p * (1 - dist);
        controlOutcome = (side === 'UP' ? minLow <= mirror : maxHigh >= mirror) ? 'HIT' : 'MISS';
    }

    return {
        outcome,
        rule: hasTarget ? 'TARGET' : 'DIRECTION',
        retPct: ((lastClose - p) / p) * 100,
        extremePct: ((extreme - p) / p) * 100,
        controlOutcome,
        targetPct,
    };
}

/**
 * Avantajul, ca RAPORT intre rata semnalului si rata oglinzii.
 *
 * Un procent singur nu se poate citi: 86% poate fi strălucit sau nul, dupa cum
 * e rata de baza. Raportul spune cat adauga semnalul peste intamplare.
 */
function lift({ resolved, hits, controlResolved, controlHits }) {
    const r = Number(resolved) || 0, h = Number(hits) || 0;
    const cr = Number(controlResolved) || 0, ch = Number(controlHits) || 0;
    const pct = r > 0 ? (h / r) * 100 : null;
    const controlPct = cr > 0 ? (ch / cr) * 100 : null;
    if (controlPct === null || pct === null) return { pct, controlPct, ratio: null };
    // Control zero: raportul ar fi infinit, ceea ce pe ecran ar fi o minciuna
    // mai mare decat lipsa cifrei. Se spune „n/a".
    if (controlPct <= 0) return { pct, controlPct, ratio: null };
    return { pct: Math.round(pct), controlPct: Math.round(controlPct), ratio: pct / controlPct };
}

module.exports = {
    weight, decayedUsd, target, score, hitRate, evaluate, buildBaseline, lift,
    HALF_LIFE_MS, MIN_SAMPLES, MIN_IMBALANCE, MIN_STRENGTH, MIN_DECAYED_USD,
    BASELINE_MIN_EVENTS, BASELINE_MIN_HOURS,
};
