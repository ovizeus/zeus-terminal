// server/services/ml/_ring5/shadowReport.js
// [2026-11-22] Raportul din UMBRA, in DOLARI, pe toate conturile si pe fiecare cont.
//
// 1) Ring5: pentru fiecare tranzactie inchisa a botului, cautam ULTIMA decizie Ring5
//    (shadow_accepted / accepted / rejected) pe acelasi cont + moneda + directie, din
//    MATCH_WINDOW_MS dinaintea intrarii. Decizia se repeta la fiecare ciclu cat timp
//    semnalul tine, deci o intrare luata in timpul ei are un rand la cateva secunde.
//      - taiere care cobora treapta la NO_TRADE → tranzactia ar fi fost BLOCATA
//      - taiere care doar cobora treapta → tranzactie mai mica (raportata separat)
//      - crestere → treapta nu urca niciodata (regula serverBrain); se numara doar
// 2) Breakeven: din `_beShadow` (breakevenShadow.js), pe fiecare prag.
'use strict';

const MATCH_WINDOW_MS = 90_000;
const TIER_RANK = { NO_TRADE: 0, SMALL: 1, MEDIUM: 2, LARGE: 3 };

function _r2(x) { return Math.round(x * 100) / 100; }

function _emptyR5() {
    return { trades: 0, matched: 0, wouldBlock: { n: 0, pnl: 0, winners: 0, losers: 0 }, wouldShrink: { n: 0, pnl: 0 }, boost: { n: 0, pnl: 0 } };
}
function _emptyBE(thresholds) {
    const o = { trades: 0, realPnl: 0 };
    for (const t of thresholds) o[t] = { armed: 0, hit: 0, hitWinners: 0, hitLosers: 0, shadowPnl: 0 };
    return o;
}

/**
 * @param {Array} trades  pozitii inchise (obiectele din at_closed.data, cu userId)
 * @param {Array} audits  randuri ml_influence_audit {user_id, symbol, phase2_dir, phase2_confidence,
 *                        proposed_confidence, gate_status, gate_reason, rationale_json, created_at}
 * @param {Array<number>} thresholds pragurile de breakeven
 */
function build(trades, audits, thresholds) {
    const byKey = new Map();
    for (const a of audits || []) {
        // decizia din umbra e scrisa gate_status='skipped', gate_reason='shadow_accepted'
        if (!a || !(a.gate_status === 'accepted' || a.gate_status === 'rejected' || a.gate_reason === 'shadow_accepted')) continue;
        const k = `${a.user_id}|${a.symbol}|${String(a.phase2_dir || '').toUpperCase()}`;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(a);
    }
    for (const arr of byKey.values()) arr.sort((x, y) => x.created_at - y.created_at);

    const total = { ring5: _emptyR5(), breakeven: _emptyBE(thresholds) };
    const perUser = {};
    const bucket = (uid) => perUser[uid] || (perUser[uid] = { ring5: _emptyR5(), breakeven: _emptyBE(thresholds) });

    for (const t of trades || []) {
        if (!t || !Number.isFinite(t.closePnl) || !t.autoTrade) continue;
        const pnl = t.closePnl;
        for (const b of [total, bucket(t.userId)]) { b.ring5.trades++; b.breakeven.trades++; b.breakeven.realPnl += pnl; }

        // ── Ring5
        const arr = byKey.get(`${t.userId}|${t.symbol}|${String(t.side || '').toUpperCase()}`) || [];
        let hit = null;
        for (let i = arr.length - 1; i >= 0; i--) {
            const at = arr[i].created_at;
            if (at > t.ts) continue;
            if (t.ts - at <= MATCH_WINDOW_MS) hit = arr[i];
            break;
        }
        if (hit) {
            let rat = {};
            try { rat = JSON.parse(hit.rationale_json || '{}') || {}; } catch (_) { rat = {}; }
            const cut = hit.gate_status !== 'rejected' && hit.proposed_confidence < hit.phase2_confidence;
            const boost = hit.gate_status !== 'rejected' && hit.proposed_confidence > hit.phase2_confidence;
            for (const b of [total, bucket(t.userId)]) {
                b.ring5.matched++;
                if (cut && rat.wouldTier === 'NO_TRADE') {
                    b.ring5.wouldBlock.n++; b.ring5.wouldBlock.pnl += pnl;
                    if (pnl > 0) b.ring5.wouldBlock.winners++; else b.ring5.wouldBlock.losers++;
                } else if (cut && rat.phase2Tier && rat.wouldTier && TIER_RANK[rat.wouldTier] < TIER_RANK[rat.phase2Tier]) {
                    b.ring5.wouldShrink.n++; b.ring5.wouldShrink.pnl += pnl;
                } else if (boost) {
                    b.ring5.boost.n++; b.ring5.boost.pnl += pnl;
                }
            }
        }

        // ── Breakeven
        const st = t._beShadow || {};
        for (const th of thresholds) {
            const s = st[String(th)] || {};
            const armed = !!s.armedTs, beHit = !!s.hitTs;
            for (const b of [total, bucket(t.userId)]) {
                const x = b.breakeven[th];
                if (armed) x.armed++;
                if (beHit) { x.hit++; if (pnl > 0) x.hitWinners++; else x.hitLosers++; }
                x.shadowPnl += beHit ? 0 : pnl;
            }
        }
    }

    const fin = (b) => {
        b.ring5.wouldBlock.pnl = _r2(b.ring5.wouldBlock.pnl);
        b.ring5.wouldShrink.pnl = _r2(b.ring5.wouldShrink.pnl);
        b.ring5.boost.pnl = _r2(b.ring5.boost.pnl);
        // efectul blocarii = banii tranzactiilor care NU s-ar fi deschis, cu semn schimbat
        b.ring5.blockEffect = _r2(-b.ring5.wouldBlock.pnl);
        b.breakeven.realPnl = _r2(b.breakeven.realPnl);
        for (const th of thresholds) {
            const x = b.breakeven[th];
            x.shadowPnl = _r2(x.shadowPnl);
            x.effect = _r2(x.shadowPnl - b.breakeven.realPnl);
        }
    };
    fin(total);
    for (const u of Object.keys(perUser)) fin(perUser[u]);
    return { total, perUser, matchWindowMs: MATCH_WINDOW_MS };
}

module.exports = { build, MATCH_WINDOW_MS };
