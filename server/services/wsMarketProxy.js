'use strict';

// ═══════════════════════════════════════════════════════════════
// WS Market Proxy — server-side Binance WS → client broadcast.
// Spec: docs/superpowers/specs/2026-05-28-ws-proxy-phase-b-design.md
// Plan: docs/superpowers/plans/2026-05-28-ws-proxy-B1-core.md
// ═══════════════════════════════════════════════════════════════

const _subs = new Map();       // symbol → Set<ws>
const _clientSyms = new Map(); // ws → Set<symbol>

function subscribe(ws, symbol) {
    if (!ws || !symbol) return { isNewSymbol: false };
    const sym = symbol.toUpperCase();
    if (!_subs.has(sym)) _subs.set(sym, new Set());
    const wasEmpty = _subs.get(sym).size === 0;
    _subs.get(sym).add(ws);
    if (!_clientSyms.has(ws)) _clientSyms.set(ws, new Set());
    _clientSyms.get(ws).add(sym);
    return { isNewSymbol: wasEmpty };
}

function unsubscribe(ws, symbol) {
    if (!ws || !symbol) return { isLastSubscriber: false };
    const sym = symbol.toUpperCase();
    const set = _subs.get(sym);
    if (set) {
        set.delete(ws);
        if (set.size === 0) _subs.delete(sym);
    }
    const clientSet = _clientSyms.get(ws);
    if (clientSet) clientSet.delete(sym);
    return { isLastSubscriber: !_subs.has(sym) };
}

function unsubscribeAll(ws) {
    const syms = _clientSyms.get(ws);
    if (!syms) return [];
    const removed = [];
    for (const sym of syms) {
        const set = _subs.get(sym);
        if (set) {
            set.delete(ws);
            if (set.size === 0) { _subs.delete(sym); removed.push(sym); }
        }
    }
    _clientSyms.delete(ws);
    return removed;
}

function getSubscribers(symbol) {
    return _subs.get(symbol.toUpperCase()) || new Set();
}

function getActiveSymbols() {
    return Array.from(_subs.keys());
}

function _resetForTest() {
    _subs.clear();
    _clientSyms.clear();
}

module.exports = {
    subscribe,
    unsubscribe,
    unsubscribeAll,
    getSubscribers,
    getActiveSymbols,
    _resetForTest,
};
