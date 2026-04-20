// Zeus Terminal — Market Radar in-memory cache (Phase 11.7)
//
// Shared ring buffer for recently emitted radar events. Both marketRadar.js
// (polled categories) and liquidationFeed.js (WS-driven liq categories) push
// every event they broadcast into this cache. server.js reads snapshot() in
// the WS connection handler and sends it as a type:'market.radar.snapshot'
// frame so every new session (first connect, refresh, reconnect) warms up
// instantly instead of waiting for the next live event.
//
// Bounds: CAP entries per color, events older than TTL_MS get pruned on each
// push. Both are deliberately generous — memory footprint at worst case is
// ~100 small objects, negligible on a single node.
//
// Isolation: this module touches NOTHING else (no DB, no user scoping, no
// trading state). Crash-safe: on process restart the cache is empty and
// clients just wait for the next live event exactly like today.
'use strict';

const CAP = 50;
const TTL_MS = 10 * 60 * 1000;  // 10 minutes — anything older is too stale to replay

let _green = [];
let _red = [];
let _lastEventTs = 0;

function _prune(arr, now) {
    const cutoff = now - TTL_MS;
    while (arr.length && (typeof arr[0].ts !== 'number' || arr[0].ts < cutoff)) arr.shift();
    while (arr.length > CAP) arr.shift();
}

function push(event) {
    if (!event || typeof event !== 'object') return;
    if (event.color !== 'green' && event.color !== 'red') return;
    if (typeof event.ts !== 'number' || !isFinite(event.ts)) return;
    const arr = event.color === 'green' ? _green : _red;
    arr.push(event);
    _prune(arr, Date.now());
    if (event.ts > _lastEventTs) _lastEventTs = event.ts;
}

function snapshot() {
    const now = Date.now();
    _prune(_green, now);
    _prune(_red, now);
    return {
        green: _green.slice(),
        red: _red.slice(),
        lastEventTs: _lastEventTs,
    };
}

function stats() {
    return {
        green: _green.length,
        red: _red.length,
        lastEventTs: _lastEventTs,
        cap: CAP,
        ttlMs: TTL_MS,
    };
}

function clear() {
    _green = [];
    _red = [];
    _lastEventTs = 0;
}

module.exports = { push, snapshot, stats, clear };
