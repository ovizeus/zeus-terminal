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
    const closed = _num(a.closedCount);
    const wins = _num(a.wins);
    if (closed !== null && closed > 0 && wins !== null) {
        parts.push(`${closed} closed, ${Math.round((wins / closed) * 100)}% win`);
    } else if (closed !== null) {
        parts.push(`${closed} closed`);
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
    const out = { mode: null, balance: null, dailyPnl: null, closedCount: null, wins: null, winStreak: null, lossStreak: null };
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
                   SUM(CASE WHEN json_extract(data, '$.closePnl') > 0 THEN 1 ELSE 0 END) AS wins
            FROM at_closed WHERE user_id = ?
        `).get(userId);
        if (r) { out.closedCount = _num(r.n); out.wins = _num(r.wins); }
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

module.exports = {
    fmtAge, fmtMoney,
    formatDecisions, formatBlocked, formatAccount, formatCloses, formatThoughts, formatLiquidations,
    gatherLiquidations,
    gatherDecisions, gatherBlocked, gatherCloses, gatherThoughts, gatherAccount,
    MAX_DECISIONS, MAX_THOUGHTS, MAX_CLOSES,
    DECISION_WINDOW_MS, BLOCKED_WINDOW_MS,
};
