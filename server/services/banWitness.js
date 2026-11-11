'use strict';
/**
 * Martorul banului: cine cerea in clipa in care Binance a zis 418.
 *
 * Telemetria pe surse traieste doar in memorie. Dupa un ban stiam CAND, dar
 * niciodata CINE — iar pe 11 nov 2026 au fost opt banuri intr-o zi fara ca
 * cineva sa poata numi sursa. Functia e pura si nu arunca: sta pe drumul
 * banului, unde o exceptie ar costa mai mult decat lipsa martorului.
 */
function _num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }

function banWitness(snapshot, topN) {
    const empty = { top: [], sources: 0, calls1m: null, calls5m: null, pressure: null, worst4xx: null };
    try {
        if (!snapshot || typeof snapshot !== 'object') return empty;
        const by = snapshot.bySource && typeof snapshot.bySource === 'object' ? snapshot.bySource : {};
        const rows = Object.keys(by).map((src) => {
            const s = by[src] || {};
            return { src, calls: _num(s.calls), weight: _num(s.weightSum),
                e4xx: _num(s.errors4xx), rejected: _num(s.rejectedByScheduler) };
        });
        const n = Math.max(1, Math.min(12, Number(topN) || 6));
        const top = rows.slice().sort((a, b) => b.weight - a.weight || b.calls - a.calls).slice(0, n);
        // Un 418 vine si din a insista dupa 429, nu doar din greutate — deci
        // sursa cu cele mai multe 4xx se pastreaza separat, oricat de usoara.
        const w = rows.slice().sort((a, b) => b.e4xx - a.e4xx)[0];
        return {
            top,
            sources: rows.length,
            calls1m: snapshot.callsPer1min == null ? null : _num(snapshot.callsPer1min),
            calls5m: snapshot.callsPer5min == null ? null : _num(snapshot.callsPer5min),
            pressure: snapshot.quotaPressure == null ? null : snapshot.quotaPressure,
            worst4xx: w && w.e4xx > 0 ? { src: w.src, e4xx: w.e4xx, calls: w.calls } : null,
        };
    } catch (_) { return empty; }
}

module.exports = { banWitness };
