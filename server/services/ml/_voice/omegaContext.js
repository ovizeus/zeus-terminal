'use strict';
//
// [2026-11-02] Ce stie Zeus si OMEGA nu vedea.
//
// Cererea operatorului: "sa te uiti la omega sa il faci destept sa stie mai
// multe... sa fie si el mai coerent ca e cam tranga langa".
//
// Masurat inainte de a scrie un rand:
//   • Blocul "Recent decisions" din promptul lui venea din `ml_influence_audit`,
//     care in ultimele 24h avea 20.160 de randuri, TOATE
//     `skipped / insufficient_observations`. Nu e zgomot pe langa semnal — e
//     numai zgomot, si ii iesea pe gura verbatim: "10 decisions ... conf 0,
//     status skipped" intr-un raspuns real catre operator.
//   • Deciziile ADEVARATE stau in `brain_decisions`: 696.652 de randuri cu
//     directie, incredere, tier si actiune. Nu le citea deloc.
//   • "De ce n-ai intrat" are raspuns exact in `missed_trades`
//     (MIXED_DIRECTION 180, OPPOSITE_SIDE 18, MAX_POSITIONS 2). Nu-l citea.
//   • Contul lui — balanta, PnL-ul zilei, rata de castig peste 3.546 de
//     tranzactii inchise — nu aparea NICAIERI in promptul de sistem.
//   • Propriile lui ganduri din THE VOICE ii erau invizibile, de unde raspunsul
//     "Nu am un mesaj anterior de la echipa" cand operatorul il intreba despre
//     un gand pe care tocmai il citise.
//
// Modulul asta strange cele patru si le da in forma scurta. Formatarea e pura
// si testata separat de interogari: interogarile se schimba cu schema, forma
// e ce ajunge in fata modelului si e ce trebuie aparat.

const MAX_DECISIONS = 6;
const MAX_THOUGHTS = 3;
const MAX_CLOSES = 3;

// ── Formatare pura ────────────────────────────────────────────────────

function _num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** "2m" / "45s" — varsta pe scurt. */
function fmtAge(ms) {
    const v = _num(ms);
    if (v === null || v < 0) return '?';
    if (v < 60000) return Math.round(v / 1000) + 's';
    if (v < 3600000) return Math.round(v / 60000) + 'm';
    return Math.round(v / 3600000) + 'h';
}

function _sym(s) {
    return String(s || '').replace(/USDT$/, '') || '?';
}

/** "+12.40" / "-9.80" — semnul e informatie, nu decor. */
function fmtMoney(n) {
    const v = _num(n);
    if (v === null) return 'n/a';
    return (v >= 0 ? '+' : '') + v.toFixed(2);
}

/**
 * Deciziile reale ale creierului, compact.
 * Fiecare rand spune ce a vrut si CE L-A OPRIT — asta e ce lipsea.
 */
function formatDecisions(rows, now) {
    if (!Array.isArray(rows) || rows.length === 0) return 'none in the last 5min.';
    const t = _num(now) === null ? Date.now() : now;
    return rows.slice(0, MAX_DECISIONS).map(d => {
        const conf = _num(d && d.conf);
        const bits = [
            _sym(d && d.symbol),
            String((d && d.dir) || '?'),
            conf === null ? '' : 'conf' + Math.round(conf),
            String((d && d.tier) || '').toLowerCase(),
            // `action` e cuvantul care conteaza: no_trade / blocked_gates /
            // blocked_reflection / entry_blocked / pending_expire.
            String((d && d.action) || '?'),
            '(' + fmtAge(t - (_num(d && d.ts) || t)) + ')',
        ].filter(Boolean);
        return bits.join(' ');
    }).join(' | ');
}

/** "mixed-direction ×180, opposite-side ×18, max-positions ×2" */
function formatBlocked(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return 'nothing blocked in the last 24h.';
    return rows.map(r => {
        const reason = String((r && r.reason) || '?').toLowerCase().replace(/_same_mode$/, '').replace(/_/g, '-');
        const n = _num(r && r.n);
        return `${reason}${n === null ? '' : ' ×' + n}`;
    }).join(', ');
}

/**
 * Contul, intr-un rand. Rata de castig se scrie DOAR cand exista tranzactii:
 * un 0% dintr-un numitor zero e o minciuna care suna ca o masuratoare.
 */
function formatAccount(a) {
    if (!a || typeof a !== 'object') return 'n/a.';
    const parts = [];
    const bal = _num(a.balance);
    if (bal !== null) parts.push(`${String(a.mode || 'demo')} balance $${bal.toFixed(2)}`);
    const today = _num(a.dailyPnl);
    if (today !== null) parts.push(`today ${fmtMoney(today)}`);
    // [2026-11-03] Rata de castig se calculeaza DOAR peste tranzactiile decise.
    //
    // Pana azi o calculam peste TOT ce era in at_closed, si i-am spus
    // operatorului ca are 18% castig. Masurat: din 3.216 randuri ale lui, 1.860
    // au PnL exact ZERO — si nu sunt tranzactii la zero, sunt INTRARI CARE AU
    // ESUAT: 1.199 pe margine insuficienta, plus erori de ordin, de levier si
    // reseturi. N-au fost niciodata pozitii. Numarandu-le la numitor, fiecare
    // esec de intrare arata ca o infrangere.
    //
    // Peste tranzactiile care chiar s-au decis, cifra lui e 44,6%. Diferenta
    // dintre 18 si 45 nu e o nuanta: e diferenta dintre un om care crede ca
    // sistemul lui nu merge si unul care stie ca merge pe jumatate.
    const decided = _num(a.decidedCount);
    const wins = _num(a.wins);
    const closed = _num(a.closedCount);
    if (decided !== null && decided > 0 && wins !== null) {
        parts.push(`${decided} trades, ${Math.round((wins / decided) * 100)}% win`);
    } else if (closed !== null) {
        parts.push(`${closed} closed`);
    }
    const failed = _num(a.failedEntries);
    if (failed !== null && failed > 0) {
        // Nu e o pierdere, dar nici un detaliu: 1.199 intrari refuzate pe
        // margine inseamna ca sistemul vrea sa tranzactioneze si nu poate.
        parts.push(`${failed} entries never filled`);
    }
    const ls = _num(a.lossStreak);
    const ws = _num(a.winStreak);
    if (ws !== null && ws > 0) parts.push(`win streak ${ws}`);
    else if (ls !== null && ls > 0) parts.push(`loss streak ${ls}`);
    return parts.length > 0 ? parts.join(' · ') + '.' : 'n/a.';
}

/**
 * Unde s-au ars banii in ultimele 24h. Zeus tine 30 de zile de lichidari si
 * are doua panouri pe ele (LIQ MAP, NEREUS), dar OMEGA nu le vedea deloc: la
 * "unde s-a rupt piata" nu avea ce raspunde.
 *
 * Sumele se scriu in milioane fiindca asa se citesc: 828.3M, nu 828300000.
 */
function formatLiquidations(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return 'no liquidation data.';
    return rows.slice(0, 5).map(r => {
        const usd = _num(r && r.usd);
        const n = _num(r && r.n);
        const m = usd === null ? 'n/a' : (usd >= 1e9 ? (usd / 1e9).toFixed(1) + 'B' : (usd / 1e6).toFixed(1) + 'M');
        return `${_sym(r && r.symbol)} $${m}${n === null ? '' : ' (' + n + ')'}`;
    }).join(', ');
}

/** "BTC LONG +12.40 (2h) | ETH SHORT -3.10 (5h)" */
function formatCloses(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return 'none yet.';
    return rows.slice(0, MAX_CLOSES).map(c => {
        const pnl = _num(c && c.pnl);
        return `${_sym(c && c.symbol)} ${String((c && c.side) || '?')} ${pnl === null ? 'n/a' : fmtMoney(pnl)}${c && c.reason ? ' ' + String(c.reason) : ''}`;
    }).join(' | ');
}

/**
 * Propriile lui ganduri din THE VOICE. Fara ele raspundea operatorului
 * "Nu am un mesaj anterior de la echipa" despre un gand pe care tocmai il
 * emisese el insusi.
 */
function formatThoughts(rows, now) {
    if (!Array.isArray(rows) || rows.length === 0) return 'nothing said recently.';
    const t = _num(now) === null ? Date.now() : now;
    return rows.slice(0, MAX_THOUGHTS).map(u => {
        const age = fmtAge(t - (_num(u && u.ts) || t));
        const text = String((u && u.text) || '').replace(/\s+/g, ' ').trim();
        return `${age} ago: ${text.length > 110 ? text.slice(0, 110) + '…' : text}`;
    }).join(' | ');
}

/**
 * [2026-11-02] Starea lui OMEGA, din ce se misca de fapt.
 *
 * Varianta veche o calcula din `ml_influence_audit`, testand `gate_status`
 * pentru `accepted`, `rejected` si `no_proposal`. Tabela aia n-a avut NICIODATA
 * altceva decat `skipped / insufficient_observations` — toate cele 522.400 de
 * randuri. Deci cele trei ramuri erau matematic de neatins si functia putea
 * intoarce doar CALM, sau BORED cand fereastra era goala. Masurat pe
 * conversatia reala a operatorului: 40 de CALM, iar cele cateva stari diferite
 * veneau din alte cai, cu starea scrisa de mana.
 *
 * Un asistent care spune CALM in timp ce cartea pierde a optsprezecea oara la
 * rand nu e calm, e orb — si exact asta se simte ca incoerenta.
 *
 * Ordinea conteaza si e deliberata: intai lipsa de activitate, apoi durerea,
 * apoi bucuria, apoi efortul. Un om care pierde nu e "concentrat", e ingrijorat,
 * chiar daca motorul lucreaza mult.
 */
function moodFrom(ctx) {
    const c = ctx && typeof ctx === 'object' ? ctx : {};
    const decisions = _num(c.decisions) || 0;
    if (decisions <= 0) return 'BORED';                 // creierul tace

    const loss = _num(c.lossStreak) || 0;
    const win = _num(c.winStreak) || 0;
    const pnl = _num(c.dailyPnl);

    if (loss >= 5) return 'SAD';                        // nu e o zi proasta, e o serie
    if (loss >= 2 || (pnl !== null && pnl < 0)) return 'NERVOUS';
    if (win >= 2 || (pnl !== null && pnl > 0)) return 'EXCITED';

    // Fara durere si fara castig: cat de mult munceste ca sa NU intre.
    const blocked = _num(c.blocked) || 0;
    if (blocked / decisions > 0.5) return 'FOCUSED';
    return 'CALM';
}

/**
 * [2026-11-03] Prefixul cheii de celula de bandit, construit intr-un singur loc.
 *
 * Separatorul e DOUA PUNCTE: `1:DEMO:BNBUSDT:BREAKOUT`. Scris de mana cu bara
 * verticala, interogarea intoarce zero randuri MEREU si raspunsul iese linistit
 * si fals. S-a intamplat de DOUA ori, in doua raspunsuri diferite: la
 * predictivitate (reparat b366) si la invataminte — unde inca spunea "bandit
 * cells: cold" desi exista celule cu 36, 29, 27 si 20 de observatii.
 *
 * Am reparat prima aparitie si am ratat clasa. Cartea are deja lectia asta
 * scrisa, de la escaparea pentru Telegram: cand gasesti un bug de forma, cauta
 * TOATE locurile care scriu forma aia, nu doar pe cel care te-a adus acolo.
 */
const CELL_KEY_SEP = ':';

/** Prefix pentru `LIKE`. Fara simbol: toate celulele utilizatorului. */
function cellKeyPrefix(userId, symbol) {
    const uid = (userId === null || userId === undefined) ? '' : String(userId);
    if (!symbol) return `${uid}${CELL_KEY_SEP}%`;
    return `${uid}${CELL_KEY_SEP}%${CELL_KEY_SEP}${String(symbol)}${CELL_KEY_SEP}%`;
}

/** Desparte o cheie in bucatile ei, cu acelasi separator. */
function parseCellKey(key) {
    const parts = String(key || '').split(CELL_KEY_SEP);
    return { userId: parts[0] || null, env: parts[1] || null, symbol: parts[2] || null, regime: parts[3] || null };
}

/**
 * [2026-11-03] CE ESTE o tranzactie. O singura definitie, pentru toata aplicatia.
 *
 * Zeus avea doua, si de aceea doua parti ale lui spuneau cifre diferite despre
 * acelasi om:
 *   • randul de cont (al meu, b360) numara TOT ce e in at_closed -> 18,5%;
 *   • raspunsul despre invataminte excludea doar `ENTRY_FAILED*`      -> 36,7%.
 * La b367 am reparat primul excluzand tot ce are PnL zero -> 44,6%. Si aia era
 * gresita, in cealalta directie: arunca 139 de tranzactii ADEVARATE incheiate
 * la zero (MANUAL_CLIENT, EMERGENCY_CLOSED, HIT_SL), care sunt inchideri reale,
 * nu esecuri.
 *
 * Regula corecta nu e despre PnL, e despre ISTORIE: a fost vreodata o pozitie?
 *   • `ENTRY_FAILED*` (1.572 la el) — ordinul n-a intrat niciodata;
 *   • `RESET` (91) — stergere de stare, nu tranzactie;
 *   • `RECON_PHANTOM*` (32) — randuri de reconciliere, nu tranzactie.
 * Tot restul e tranzactie, inclusiv cea care a iesit exact pe zero.
 *
 * Pe datele lui: 1.366 de tranzactii, 39,6% castig. Nu 18, nu 45.
 */
const NON_TRADE_PREFIXES = ['ENTRY_FAILED', 'RECON_PHANTOM'];
const NON_TRADE_EXACT = new Set(['RESET']);

/** Pur: a fost randul asta vreodata o pozitie? */
function isRealTrade(closeReason, closePnl) {
    if (closePnl === null || closePnl === undefined) return false;  // nu stim cum s-a terminat
    if (typeof closePnl !== 'number' || !Number.isFinite(closePnl)) return false;
    const r = typeof closeReason === 'string' ? closeReason : '';
    if (NON_TRADE_EXACT.has(r)) return false;
    return !NON_TRADE_PREFIXES.some((pfx) => r.startsWith(pfx));
}

/** Aceeasi regula, in SQL, ca interogarile sa nu poata spune altceva. */
const REAL_TRADE_SQL = [
    "json_extract(data, '$.closePnl') IS NOT NULL",
    "coalesce(json_extract(data, '$.closeReason'), '') NOT LIKE 'ENTRY_FAILED%'",
    "coalesce(json_extract(data, '$.closeReason'), '') NOT LIKE 'RECON_PHANTOM%'",
    "coalesce(json_extract(data, '$.closeReason'), '') <> 'RESET'",
].join(' AND ');

/**
 * De ce simte ce simte — in aceleasi cuvinte din care s-a calculat starea.
 *
 * Pana azi starea venea dintr-o tabela moarta SI explicatia venea din aceeasi
 * tabela ("N skipped of N = bandit cold"). Dupa ce starea s-a mutat pe
 * deciziile reale, o explicatie ramasa pe audit ar fi fost mai rau decat
 * inainte: ar fi spus SAD si ar fi motivat cu randuri de audit. Un raspuns
 * care isi contrazice propria stare e chiar definitia incoerentei.
 */
function moodReason(ctx) {
    const c = ctx && typeof ctx === 'object' ? ctx : {};
    const decisions = _num(c.decisions) || 0;
    if (decisions <= 0) return 'brain quiet — no decisions in the last 5min';
    const loss = _num(c.lossStreak) || 0;
    const win = _num(c.winStreak) || 0;
    const pnl = _num(c.dailyPnl);
    if (loss >= 5) return `${loss} losses in a row — that is a streak, not a bad day`;
    if (loss >= 2) return `${loss} losses back to back`;
    if (pnl !== null && pnl < 0) return `day is ${fmtMoney(pnl)}`;
    if (win >= 2) return `${win} wins in a row`;
    if (pnl !== null && pnl > 0) return `day is ${fmtMoney(pnl)}`;
    const blocked = _num(c.blocked) || 0;
    if (decisions > 0 && blocked / decisions > 0.5) {
        return `${blocked} of ${decisions} decisions blocked — working hard to stay out`;
    }
    return `${decisions} decisions, nothing forcing my hand`;
}

/**
 * [2026-11-03] Adevarul despre influenta ML, in loc de "ACTIVE".
 *
 * Raspunsul vechi la "cum e bandit-ul" spunea, negru pe alb:
 *   "influence: ACTIVE. seed + preReg live. eligibility passes for cells >= 30 obs."
 * Era fals pe toate cele trei bucati. Masurat: 522.400 de evaluari de
 * influenta, TOATE skipped — niciuna n-a schimbat vreodata o decizie. Si
 * conditia pe care o verifica raspunsul (exista o pre-inregistrare in stare
 * REGISTERED) nu e conditia pe care o verifica POARTA: poarta cere si ca
 * fereastra de evaluare sa nu fie expirata, iar a pre-inregistrarii 6554 s-a
 * inchis pe 9 iulie 2026. Se vede si in audit: cand o celula a atins 30 de
 * observatii, verdictul a devenit `eval_window_expired`.
 *
 * Un asistent care raporteaza ACTIVE despre ceva care n-a functionat niciodata
 * e mai rau decat unul care tace: operatorul ia decizii crezandu-l.
 *
 * Functia e pura: primeste numerele, scrie propozitia.
 */
function influenceStatus(st) {
    const c = st && typeof st === 'object' ? st : {};
    const evals = _num(c.evals) || 0;
    const applied = _num(c.applied) || 0;
    if (evals <= 0) return 'influence: no evaluations in the last 24h — pipeline idle.';
    if (applied > 0) {
        return `influence: APPLIED ${applied} of ${evals} evaluations in the last 24h.`;
    }
    const reasons = Array.isArray(c.reasons) ? c.reasons : [];
    const top = reasons
        .slice(0, 3)
        .map(r => `${String((r && r.reason) || '?').replace(/^not_eligible_/, '')} ×${_num(r && r.n) || 0}`)
        .join(', ');
    let line = `influence: NEVER APPLIED — ${evals} evaluation${evals === 1 ? '' : 's'} in the last 24h, all skipped`;
    if (top) line += ` (${top})`;
    line += '.';
    const expiredAt = _num(c.preRegExpiredAt);
    if (expiredAt !== null && expiredAt > 0) {
        const days = Math.floor((Date.now() - expiredAt) / 86400000);
        line += ` Pre-registration window closed ${days} day${days === 1 ? '' : 's'} ago — even a cell with 30+ observations is refused.`;
    }
    return line;
}

// ── Strangerea datelor ────────────────────────────────────────────────
//
// Fiecare bucata are try/catch-ul ei: un chat care cade fiindca o tabela s-a
// mutat e mai rau decat un chat care raspunde fara una dintre felii.

const DECISION_WINDOW_MS = 5 * 60 * 1000;
const BLOCKED_WINDOW_MS = 24 * 60 * 60 * 1000;

function gatherDecisions(db, userId, now) {
    try {
        return db.prepare(`
            SELECT symbol, final_dir AS dir, final_conf AS conf,
                   final_tier AS tier, final_action AS action, ts
            FROM brain_decisions
            WHERE user_id = ? AND ts >= ?
            ORDER BY ts DESC LIMIT ?
        `).all(userId, now - DECISION_WINDOW_MS, MAX_DECISIONS);
    } catch (_) { return []; }
}

function gatherBlocked(db, userId, now) {
    try {
        return db.prepare(`
            SELECT reason, COUNT(*) AS n
            FROM missed_trades
            WHERE user_id = ? AND created_at >= ?
            GROUP BY reason ORDER BY n DESC LIMIT 5
        `).all(userId, new Date(now - BLOCKED_WINDOW_MS).toISOString().slice(0, 19).replace('T', ' '));
    } catch (_) { return []; }
}

function gatherCloses(db, userId) {
    try {
        const rows = db.prepare(
            'SELECT data FROM at_closed WHERE user_id = ? ORDER BY closed_at DESC LIMIT ?'
        ).all(userId, MAX_CLOSES);
        return rows.map((r) => {
            try {
                const d = JSON.parse(r.data);
                return { symbol: d.symbol, side: d.side, pnl: d.closePnl, reason: d.closeReason };
            } catch (_) { return null; }
        }).filter(Boolean);
    } catch (_) { return []; }
}

function gatherThoughts(db, userId, now) {
    try {
        return db.prepare(`
            SELECT text, created_at AS ts
            FROM ml_voice_log
            WHERE user_id = ? AND utterance_type = 'THOUGHT'
            ORDER BY created_at DESC LIMIT ?
        `).all(userId, MAX_THOUGHTS);
    } catch (_) { return []; }
}

/**
 * Contul. Balanta si seriile vin din starea motorului; numaratoarea si
 * castigurile din istoricul inchis, fiindca acolo e adevarul peste tot
 * intervalul, nu doar peste sesiunea curenta.
 */
function gatherAccount(db, userId, uState, balance) {
    const out = { mode: null, balance: null, dailyPnl: null, closedCount: null, decidedCount: null, failedEntries: null, wins: null, winStreak: null, lossStreak: null };
    try {
        if (uState && typeof uState === 'object') {
            out.mode = uState.engineMode || uState.mode || null;
            out.dailyPnl = _num(uState.dailyPnL);
            out.winStreak = _num(uState.winStreak);
            out.lossStreak = _num(uState.lossStreak);
        }
    } catch (_) { /* best effort */ }
    out.balance = _num(balance);
    try {
        const r = db.prepare(`
            SELECT COUNT(*) AS n,
                   SUM(CASE WHEN ${REAL_TRADE_SQL} THEN 1 ELSE 0 END) AS trades,
                   SUM(CASE WHEN (${REAL_TRADE_SQL}) AND json_extract(data, '$.closePnl') > 0 THEN 1 ELSE 0 END) AS wins,
                   SUM(CASE WHEN coalesce(json_extract(data, '$.closeReason'), '') LIKE 'ENTRY_FAILED%' THEN 1 ELSE 0 END) AS failed
            FROM at_closed WHERE user_id = ?
        `).get(userId);
        if (r) {
            out.closedCount = _num(r.n);
            out.wins = _num(r.wins);
            // Numitorul e numarul de TRANZACTII, dupa singura definitie a
            // aplicatiei — nu "tot ce e in tabela" si nici "tot ce nu e zero".
            out.decidedCount = _num(r.trades);
            out.failedEntries = _num(r.failed);
        }
    } catch (_) { /* best effort */ }
    return out;
}

/**
 * `liqStore.symbols` sorteaza dupa NUMARUL de evenimente, nu dupa dolari — asa
 * il vrea panoul LIQ MAP, deci nu se atinge. Dar "cele mai mari lichidari"
 * inseamna bani, nu bucati: pe datele de azi, ETH avea 2305 evenimente de
 * 86,7M si BTC 1995 de 508,3M, deci sortarea dupa numar punea ETH primul si
 * promptul ar fi spus "biggest first" despre o lista care nu era. Cerem mai
 * multe si le reasezam aici, dupa dolari.
 */
function gatherLiquidations(liqStore) {
    try {
        if (!liqStore || typeof liqStore.symbols !== 'function') return [];
        const rows = liqStore.symbols({ days: 1, limit: 12 }) || [];
        return rows
            .slice()
            .sort((a, b) => (_num(b && b.usd) || 0) - (_num(a && a.usd) || 0))
            .slice(0, 5);
    } catch (_) { return []; }
}

// ── Constitutia R1 ────────────────────────────────────────────────────
// [2026-11-04] Pe 1 noiembrie el a intrebat de ce are LONG si SHORT deschise
// in acelasi timp. Regula care interzice exact asta exista si se masoara din
// 18 mai (`NO_OPPOSITE_ENTRY_ON_OPEN`, severitate `hard`), iar OMEGA nu avea
// nicio referinta la ea. Avea raspunsul in casa si a vorbit pe langa.
//
// Adevarul care conteaza nu e numarul de incalcari, e MODUL: `advisory`
// inseamna ca s-a scris in jurnal si intrarea a trecut oricum. Daca nu se
// spune asta explicit, "35.805 incalcari" sună ca 35.805 opriri -- exact
// greseala de la `influenceStatus`, unde "ACTIVE" insemna "n-a rulat".
const CONSTITUTION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Doar sirul exact 'blocking' blocheaza -- oglindeste enforcementEngine.shouldBlock. */
function normalizeEnforcementMode(mode) {
    return mode === 'blocking' ? 'blocking' : 'advisory';
}

function gatherConstitution(db, userId, now, enforcementMode) {
    const mode = normalizeEnforcementMode(enforcementMode);
    let rows = [];
    let totalEver = null;
    try {
        rows = db.prepare(`
            SELECT principle_id, principle_name, severity, COUNT(*) AS n
            FROM ml_r1_violations
            WHERE user_id = ? AND ts >= ?
            GROUP BY principle_id, principle_name, severity
            ORDER BY n DESC LIMIT 5
        `).all(userId, now - CONSTITUTION_WINDOW_MS) || [];
    } catch (_) { rows = []; }
    try {
        const r = db.prepare(
            'SELECT COUNT(*) AS n FROM ml_r1_violations WHERE user_id = ?'
        ).get(userId);
        const n = _num(r && r.n);
        totalEver = n;
    } catch (_) { totalEver = null; }
    return { rows, totalEver, mode };
}

/** `No opposite-side entry while same-symbol open` -> `opposite-side entry while same-symbol open` */
function _principleLabel(row) {
    const name = row && typeof row.principle_name === 'string' && row.principle_name.trim()
        ? row.principle_name.trim()
        : String((row && row.principle_id) || 'unnamed rule').toLowerCase().replace(/_/g, ' ');
    return name.replace(/^no\s+/i, '').toLowerCase();
}

function formatConstitution(c) {
    if (!c || typeof c !== 'object') return 'n/a.';
    const mode = normalizeEnforcementMode(c.mode);
    const rows = Array.isArray(c.rows) ? c.rows.filter(Boolean) : [];
    const ever = _num(c.totalEver);

    const parts = [];
    if (rows.length === 0) {
        parts.push('no breaches in the last 24h');
    } else {
        const list = rows.map((r) => {
            const n = _num(r.n);
            const sev = r.severity ? ` ${String(r.severity)}` : '';
            return `${_principleLabel(r)}${n === null ? '' : ' x' + n}${sev}`;
        }).join(', ');
        parts.push(`in the last 24h: ${list}`);
    }
    if (ever !== null) parts.push(`${ever} on record since the rule went in`);

    // The whole point of the line.
    parts.push(mode === 'blocking'
        ? 'mode is blocking — a hard breach stops the entry'
        : 'mode is advisory — every one of these was logged and the entry went through anyway; nothing was blocked');

    return parts.join(' · ') + '.';
}

// ── Trendul de dispozitie ─────────────────────────────────────────────
// [2026-11-04] "cum te simti" raspundea doar despre clipa asta. Starea lui
// este scrisa de sase luni in `ml_voice_log.mood` -- nu lipsea scriitorul, ci
// cititorul.
//
// Datele au o forma care pacaleste: in ACEEASI secunda apar mai multe stari,
// cate una per rostire, deci "sunt nervos de trei zile" nu se poate afirma din
// ele. Se poate afirma amestecul. Si comparatia se face pe COTE, nu pe numere
// brute, fiindca ziua in curs e partiala: pe brut, orice dimineata pare mai
// liniştita decat ziua de ieri intreaga, din simplul motiv ca are mai putine
// ore in ea.
const MOOD_DAY_MS = 24 * 60 * 60 * 1000;
/** Sub atat, amestecul e zgomot si nu se pronunta nicio schimbare. */
const MOOD_MIN_SAMPLE = 30;
/** Cat trebuie sa se mute o cota ca sa merite spusa (puncte procentuale). */
const MOOD_SHIFT_PP = 8;

function gatherMoodTrend(db, userId, now) {
    const q = `
        SELECT mood, COUNT(*) AS n
        FROM ml_voice_log
        WHERE user_id = ? AND created_at >= ? AND created_at < ?
          AND mood IS NOT NULL AND mood <> ''
        GROUP BY mood ORDER BY n DESC`;
    try {
        const today = db.prepare(q).all(userId, now - MOOD_DAY_MS, now) || [];
        const yesterday = db.prepare(q).all(userId, now - 2 * MOOD_DAY_MS, now - MOOD_DAY_MS) || [];
        return { today, yesterday };
    } catch (_) { return { today: [], yesterday: [] }; }
}

function _moodShares(rows) {
    const clean = (Array.isArray(rows) ? rows : []).filter(
        (r) => r && typeof r.mood === 'string' && r.mood && _num(r.n) !== null && _num(r.n) > 0
    );
    const total = clean.reduce((acc, r) => acc + _num(r.n), 0);
    if (total <= 0) return { total: 0, shares: new Map(), ordered: [] };
    const shares = new Map();
    for (const r of clean) shares.set(r.mood, _num(r.n) / total);
    const ordered = clean.slice().sort((a, b) => _num(b.n) - _num(a.n));
    return { total, shares, ordered };
}

function formatMoodTrend(t) {
    if (!t || typeof t !== 'object') return 'n/a.';
    const today = _moodShares(t.today);
    if (today.total === 0) return 'nothing said in the last 24h — quiet.';

    // A share that rounds to 0% is not a measurement, it is noise wearing the
    // clothes of one: 8 utterances out of 7583 rendered as "sad 0%" reads as a
    // statement about sadness. Dropped from the mix, still counted in the total.
    const mix = today.ordered
        .map((r) => ({ mood: r.mood, pct: Math.round(today.shares.get(r.mood) * 100) }))
        .filter((r) => r.pct >= 1)
        .map((r) => `${String(r.mood).toLowerCase()} ${r.pct}%`)
        .join(', ');

    const yday = _moodShares(t.yesterday);
    // No comparison without both sides, and not on a sample too small to mean
    // anything -- a verdict from three utterances is an invented mood.
    if (yday.total === 0 || today.total < MOOD_MIN_SAMPLE || yday.total < MOOD_MIN_SAMPLE) {
        return `last 24h: ${mix}.`;
    }

    // Biggest genuine move in share, in percentage points.
    let best = null;
    const moods = new Set([...today.shares.keys(), ...yday.shares.keys()]);
    for (const m of moods) {
        const d = ((today.shares.get(m) || 0) - (yday.shares.get(m) || 0)) * 100;
        if (Math.abs(d) >= MOOD_SHIFT_PP && (best === null || Math.abs(d) > Math.abs(best.d))) {
            best = { mood: m, d };
        }
    }
    if (!best) return `last 24h: ${mix} — same as the day before.`;

    const word = String(best.mood).toLowerCase();
    const dir = best.d > 0 ? 'more' : 'less';
    return `last 24h: ${mix} — ${dir} ${word} than the day before `
        + `(${Math.round(Math.abs(best.d))}pp).`;
}

// ── Avantajul ieşirii ML fata de linia de baza ────────────────────────
// [2026-11-04] „de ce nu iese pe castig" e intrebarea lui de luni de zile, si
// are o masuratoare in casa pe care OMEGA n-o vedea: `ml_dsl_outcome` compara,
// pe FIECARE poziţie inchisa, ce a scos ieşirea ML cu ce ar fi scos linia de
// baza. 2.299 randuri.
//
// ⚠️ Convenţia de semn a fost VERIFICATA pe date inainte de a scrie un cuvant:
// `advantage = ml_pnl_pct - baseline_pnl_pct`, 1387 din 1387 randuri unde
// difera se potrivesc, ZERO pe convenţia inversa. Un semn intors a fost retras
// odata, pe 23 octombrie, si nu se repeta.
//
// ⚠️ Disciplina de eşantion: `ml:EXIT` are n=8 si avantaj +0,45 -- de zece ori
// orice altceva. Randat ca „cel mai bun bra[", ar fi o minciuna din opt randuri.
const DSL_MIN_TOTAL = 30;      // sub atat, nicio concluzie
const DSL_MIN_ARM_N = 50;      // un brat sub atat nu se numeste

function gatherDslAdvantage(db, userId) {
    const empty = { total: 0, better: 0, same: 0, worse: 0, meanAdvantage: null, arms: [] };
    let head = null;
    try {
        head = db.prepare(`
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN advantage > 0 THEN 1 ELSE 0 END) AS better,
                   SUM(CASE WHEN advantage = 0 THEN 1 ELSE 0 END) AS same,
                   SUM(CASE WHEN advantage < 0 THEN 1 ELSE 0 END) AS worse,
                   AVG(advantage) AS meanAdvantage
            FROM ml_dsl_outcome WHERE user_id = ?
        `).get(userId);
    } catch (_) { return empty; }
    if (!head) return empty;
    let arms = [];
    try {
        arms = db.prepare(`
            SELECT arm, COUNT(*) AS n, AVG(advantage) AS advantage
            FROM ml_dsl_outcome
            WHERE user_id = ? AND arm IS NOT NULL AND arm <> ''
            GROUP BY arm
            HAVING COUNT(*) >= ${DSL_MIN_ARM_N}
            ORDER BY n DESC LIMIT 4
        `).all(userId) || [];
    } catch (_) { arms = []; }
    return {
        total: _num(head.total) || 0,
        better: _num(head.better) || 0,
        same: _num(head.same) || 0,
        worse: _num(head.worse) || 0,
        meanAdvantage: _num(head.meanAdvantage),
        arms,
    };
}

function formatDslAdvantage(d) {
    if (!d || typeof d !== 'object') return 'n/a.';
    const total = _num(d.total) || 0;
    if (total <= 0) return 'no comparison recorded yet.';
    if (total < DSL_MIN_TOTAL) return `too few comparisons to call it (${total}).`;

    const same = _num(d.same) || 0;
    const mean = _num(d.meanAdvantage);
    const parts = [`${total} closes compared against the plain baseline`];

    // Media singura ascunde doua lucruri diferite: „a incercat si n-a reuşit" si
    // „n-a schimbat nimic". Cat de des NU schimba nimic e informatie.
    parts.push(`${Math.round((same / total) * 100)}% came out exactly the same`);

    if (mean !== null) {
        const pp = mean.toFixed(2);
        if (Math.abs(mean) < 0.01) {
            parts.push(`average difference ${pp}pp — call it nothing`);
        } else {
            parts.push(`average ${mean > 0 ? 'ahead' : 'behind'} by ${Math.abs(mean).toFixed(2)}pp (${pp})`);
        }
    }

    const arms = (Array.isArray(d.arms) ? d.arms : []).filter(
        (a) => a && typeof a.arm === 'string' && a.arm && (_num(a.n) || 0) >= DSL_MIN_ARM_N
    );
    if (arms.length > 0) {
        const top = arms[0];
        const adv = _num(top.advantage);
        const word = adv === null ? '' : (adv < 0 ? ', and it is the weaker one' : '');
        parts.push(`most used exit is \`${top.arm}\` (${_num(top.n)} closes, `
            + `${adv === null ? 'n/a' : adv.toFixed(2) + 'pp'}${word})`);
    }
    return parts.join(' · ') + '.';
}

// ── Cat de des se schimba regimul ─────────────────────────────────────
// [2026-11-04] OMEGA citea `regime` din JSON-ul UNEI SINGURE decizii, deci
// putea spune „TREND" dar niciodata „a basculat de 88 de ori azi pe BNB" -- iar
// a doua propozitie e cea care conteaza: o decizie luata „pe regim" sta pe ceva
// ce se schimba la ~16 minute.
//
// ⚠️ `created_at` e TEXT datetime, NU `ts` INTEGER ms. O interogare pe `ts` nu
// arunca zgomotos, doar intoarce GOL -- si golul se citeste ca lipsa de date.
function gatherRegimeFlips(db, userId) {
    const empty = { total: 0, symbols: 0, byRegime: [], busiest: null };
    try {
        const head = db.prepare(`
            SELECT COUNT(*) AS total, COUNT(DISTINCT symbol) AS symbols
            FROM regime_history
            WHERE user_id = ? AND created_at >= datetime('now','-1 day')
        `).get(userId);
        const byRegime = db.prepare(`
            SELECT regime, COUNT(*) AS n FROM regime_history
            WHERE user_id = ? AND created_at >= datetime('now','-1 day')
            GROUP BY regime ORDER BY n DESC LIMIT 4
        `).all(userId) || [];
        const busiestRows = db.prepare(`
            SELECT symbol, COUNT(*) AS n FROM regime_history
            WHERE user_id = ? AND created_at >= datetime('now','-1 day')
            GROUP BY symbol ORDER BY n DESC LIMIT 1
        `).all(userId) || [];
        return {
            total: _num(head && head.total) || 0,
            symbols: _num(head && head.symbols) || 0,
            byRegime,
            busiest: busiestRows[0] || null,
        };
    } catch (_) { return empty; }
}

function formatRegimeFlips(r) {
    if (!r || typeof r !== 'object') return 'n/a.';
    const total = _num(r.total) || 0;
    if (total <= 0) return 'no regime changes in the last 24h.';
    const symbols = _num(r.symbols) || 0;
    const parts = [`${total} regime changes in 24h`];
    if (symbols > 0) parts[0] += ` across ${symbols} symbol${symbols === 1 ? '' : 's'}`;

    const by = (Array.isArray(r.byRegime) ? r.byRegime : [])
        .filter((x) => x && typeof x.regime === 'string' && _num(x.n) !== null)
        .map((x) => `${String(x.regime).toLowerCase()} ${_num(x.n)}`);
    if (by.length > 0) parts.push(`into: ${by.join(', ')}`);

    const b = r.busiest;
    const bn = _num(b && b.n);
    if (b && typeof b.symbol === 'string' && bn !== null && bn > 0) {
        // Un numar brut nu spune nimic; frecventa spune. Dar un singur flip nu
        // ESTE o frecventa.
        if (bn > 1) {
            const mins = Math.round((24 * 60) / bn);
            parts.push(`busiest is ${b.symbol} with ${bn} — one every ~${mins}min`);
        } else {
            parts.push(`busiest is ${b.symbol} with ${bn}`);
        }
    }
    return parts.join(' · ') + '.';
}

module.exports = {
    fmtAge, fmtMoney,
    formatDecisions, formatBlocked, formatAccount, formatCloses, formatThoughts, formatLiquidations,
    moodFrom, moodReason, influenceStatus,
    isRealTrade, REAL_TRADE_SQL,
    cellKeyPrefix, parseCellKey, CELL_KEY_SEP,
    gatherLiquidations, gatherConstitution, gatherMoodTrend, gatherDslAdvantage,
    formatDslAdvantage, DSL_MIN_TOTAL, DSL_MIN_ARM_N,
    gatherRegimeFlips, formatRegimeFlips,
    formatMoodTrend, MOOD_MIN_SAMPLE, MOOD_SHIFT_PP,
    formatConstitution, normalizeEnforcementMode, CONSTITUTION_WINDOW_MS,
    gatherDecisions, gatherBlocked, gatherCloses, gatherThoughts, gatherAccount,
    MAX_DECISIONS, MAX_THOUGHTS, MAX_CLOSES,
    DECISION_WINDOW_MS, BLOCKED_WINDOW_MS,
};
