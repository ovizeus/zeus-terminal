'use strict';

// [Multi-exchange switch P3] Pure helpers for the /switch route.
//
// summarizeOpenPositions(rows): given non-demo open-position rows each carrying an
// `exchange`, return [{ exchange, count }] sorted by count desc then exchange asc.
// Used so the switch response can tell the client "BINANCE has N open positions —
// they stay managed on Binance". A null/missing exchange falls back to 'binance'
// (legacy rows persisted before per-position exchange stamping).
function summarizeOpenPositions(rows) {
    if (!Array.isArray(rows)) return [];
    const counts = new Map();
    for (const r of rows) {
        const ex = (r && r.exchange) ? r.exchange : 'binance';
        counts.set(ex, (counts.get(ex) || 0) + 1);
    }
    return [...counts.entries()]
        .map(([exchange, count]) => ({ exchange, count }))
        .sort((a, b) => (b.count - a.count) || a.exchange.localeCompare(b.exchange));
}

module.exports = { summarizeOpenPositions };
