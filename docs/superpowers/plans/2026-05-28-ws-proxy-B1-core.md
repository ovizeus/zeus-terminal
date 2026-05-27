# WS Proxy Phase B.1 — Core Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-side WS proxy that connects to Binance fstream, receives market data, and broadcasts to all subscribed browser clients via existing `/ws/sync`.

**Architecture:** New `wsMarketProxy.js` module manages 1 Binance WS connection per active symbol (combined stream). Clients subscribe via `market.subscribe` message on `/ws/sync`. Ref-counting controls Binance WS lifecycle. Last-value cache ensures no $0 on subscribe.

**Tech Stack:** Node.js `ws` library (already in deps), existing `/ws/sync` WebSocket server, Binance combined stream API.

**Spec:** `docs/superpowers/specs/2026-05-28-ws-proxy-phase-b-design.md`

---

### Task 1: wsMarketProxy module — subscription registry + ref-counting

**Files:**
- Create: `server/services/wsMarketProxy.js`
- Create: `tests/unit/wsMarketProxy.test.js`

- [ ] **Step 1: Write failing tests for subscription registry**

```js
// tests/unit/wsMarketProxy.test.js
'use strict';

const proxy = require('../../server/services/wsMarketProxy');

afterEach(() => proxy._resetForTest());

describe('wsMarketProxy subscription registry', () => {
    test('subscribe adds client to symbol set', () => {
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');
        expect(proxy.getSubscribers('BTCUSDT').size).toBe(1);
    });

    test('subscribe same client twice is idempotent', () => {
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');
        proxy.subscribe(ws, 'BTCUSDT');
        expect(proxy.getSubscribers('BTCUSDT').size).toBe(1);
    });

    test('unsubscribe removes client from symbol set', () => {
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');
        proxy.unsubscribe(ws, 'BTCUSDT');
        expect(proxy.getSubscribers('BTCUSDT').size).toBe(0);
    });

    test('unsubscribeAll removes client from all symbols', () => {
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');
        proxy.subscribe(ws, 'ETHUSDT');
        proxy.unsubscribeAll(ws);
        expect(proxy.getSubscribers('BTCUSDT').size).toBe(0);
        expect(proxy.getSubscribers('ETHUSDT').size).toBe(0);
    });

    test('getActiveSymbols returns symbols with >0 subscribers', () => {
        const ws1 = { readyState: 1, send: jest.fn() };
        const ws2 = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws1, 'BTCUSDT');
        proxy.subscribe(ws2, 'ETHUSDT');
        expect(proxy.getActiveSymbols().sort()).toEqual(['BTCUSDT', 'ETHUSDT']);
    });

    test('symbol removed from active when last subscriber leaves', () => {
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');
        proxy.unsubscribe(ws, 'BTCUSDT');
        expect(proxy.getActiveSymbols()).toEqual([]);
    });

    test('multiple clients on same symbol — one leaves, other stays', () => {
        const ws1 = { readyState: 1, send: jest.fn() };
        const ws2 = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws1, 'BTCUSDT');
        proxy.subscribe(ws2, 'BTCUSDT');
        proxy.unsubscribe(ws1, 'BTCUSDT');
        expect(proxy.getSubscribers('BTCUSDT').size).toBe(1);
        expect(proxy.getActiveSymbols()).toEqual(['BTCUSDT']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/wsMarketProxy.test.js --no-coverage --forceExit`
Expected: FAIL — module does not exist

- [ ] **Step 3: Write subscription registry implementation**

```js
// server/services/wsMarketProxy.js
'use strict';

// ═══════════════════════════════════════════════════════════════
// WS Market Proxy — server-side Binance WS → client broadcast.
// Spec: docs/superpowers/specs/2026-05-28-ws-proxy-phase-b-design.md
// ═══════════════════════════════════════════════════════════════

const _subs = new Map();       // symbol → Set<ws>
const _clientSyms = new Map(); // ws → Set<symbol>

function subscribe(ws, symbol) {
    if (!ws || !symbol) return;
    const sym = symbol.toUpperCase();
    if (!_subs.has(sym)) _subs.set(sym, new Set());
    const wasEmpty = _subs.get(sym).size === 0;
    _subs.get(sym).add(ws);
    if (!_clientSyms.has(ws)) _clientSyms.set(ws, new Set());
    _clientSyms.get(ws).add(sym);
    return { isNewSymbol: wasEmpty };
}

function unsubscribe(ws, symbol) {
    if (!ws || !symbol) return;
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
    subscribe, unsubscribe, unsubscribeAll,
    getSubscribers, getActiveSymbols,
    _resetForTest,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/wsMarketProxy.test.js --no-coverage --forceExit`
Expected: 7/7 PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/wsMarketProxy.js tests/unit/wsMarketProxy.test.js
git commit -m "feat(ws-proxy): B.1 Task 1 — subscription registry with ref-counting (7 tests)"
```

---

### Task 2: Binance WS connection manager

**Files:**
- Modify: `server/services/wsMarketProxy.js`
- Modify: `tests/unit/wsMarketProxy.test.js`

- [ ] **Step 1: Write failing tests for Binance connection lifecycle**

```js
describe('wsMarketProxy Binance connection', () => {
    test('connectSymbol opens WS to fstream.binance.com combined stream', () => {
        // Mock WebSocket
        const events = {};
        const mockWs = { on: (e, fn) => { events[e] = fn }, send: jest.fn(), close: jest.fn(), readyState: 1 };
        jest.spyOn(proxy, '_createBinanceWs').mockReturnValue(mockWs);

        proxy._connectSymbol('BTCUSDT', ['5m']);
        expect(proxy._createBinanceWs).toHaveBeenCalledWith(
            expect.stringContaining('fstream.binance.com')
        );
        expect(proxy.getConnectionState('BTCUSDT')).toBe('CONNECTING');
    });

    test('disconnectSymbol closes WS and cleans state', () => {
        const mockWs = { on: jest.fn(), send: jest.fn(), close: jest.fn(), readyState: 1 };
        jest.spyOn(proxy, '_createBinanceWs').mockReturnValue(mockWs);

        proxy._connectSymbol('BTCUSDT', ['5m']);
        proxy._disconnectSymbol('BTCUSDT');
        expect(mockWs.close).toHaveBeenCalled();
        expect(proxy.getConnectionState('BTCUSDT')).toBe('CLOSED');
    });

    test('buildStreamUrl creates correct combined stream URL', () => {
        const url = proxy._buildStreamUrl('BTCUSDT', ['5m', '1h']);
        expect(url).toBe('wss://fstream.binance.com/stream?streams=btcusdt@markPrice@1s/btcusdt@depth20@500ms/btcusdt@kline_5m/btcusdt@kline_1h/btcusdt@aggTrade/!forceOrder@arr');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/wsMarketProxy.test.js --no-coverage --forceExit`
Expected: FAIL — _connectSymbol, _buildStreamUrl not defined

- [ ] **Step 3: Implement Binance connection manager**

Add to `server/services/wsMarketProxy.js`:

```js
const WebSocket = require('ws');

const BINANCE_STREAM_BASE = 'wss://fstream.binance.com';
const PING_INTERVAL_MS = 180_000; // 3min (Binance timeout 5min)
const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 60000;

const _connections = new Map();  // symbol → { ws, state, reconnects, pingTimer, timeframes }
const _lastValues = new Map();   // 'symbol:streamType' → lastEvent (cache)

function _buildStreamUrl(symbol, timeframes) {
    const sym = symbol.toLowerCase();
    const streams = [
        `${sym}@markPrice@1s`,
        `${sym}@depth20@500ms`,
        ...timeframes.map(tf => `${sym}@kline_${tf}`),
        `${sym}@aggTrade`,
        '!forceOrder@arr',
    ];
    return `${BINANCE_STREAM_BASE}/stream?streams=${streams.join('/')}`;
}

function _createBinanceWs(url) {
    return new WebSocket(url);
}

function _connectSymbol(symbol, timeframes) {
    const sym = symbol.toUpperCase();
    if (_connections.has(sym)) return;

    const url = _buildStreamUrl(sym, timeframes || ['5m', '1h', '4h']);
    const ws = _createBinanceWs(url);
    const conn = { ws, state: 'CONNECTING', reconnects: 0, pingTimer: null, timeframes: timeframes || ['5m', '1h', '4h'] };
    _connections.set(sym, conn);

    ws.on('open', () => {
        conn.state = 'OPEN';
        conn.reconnects = 0;
        conn.pingTimer = setInterval(() => {
            try { if (ws.readyState === WebSocket.OPEN) ws.ping(); } catch (_) {}
        }, PING_INTERVAL_MS);
    });

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            _handleBinanceMessage(sym, msg);
        } catch (_) {}
    });

    ws.on('close', () => {
        conn.state = 'CLOSED';
        if (conn.pingTimer) { clearInterval(conn.pingTimer); conn.pingTimer = null; }
        // Auto-reconnect if still has subscribers
        if (_subs.has(sym) && _subs.get(sym).size > 0) {
            const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, conn.reconnects));
            conn.reconnects++;
            setTimeout(() => {
                _connections.delete(sym);
                _connectSymbol(sym, conn.timeframes);
            }, delay + Math.random() * 1000);
        } else {
            _connections.delete(sym);
        }
    });

    ws.on('error', () => {}); // handled by close
}

function _disconnectSymbol(symbol) {
    const sym = symbol.toUpperCase();
    const conn = _connections.get(sym);
    if (!conn) return;
    if (conn.pingTimer) { clearInterval(conn.pingTimer); conn.pingTimer = null; }
    conn.state = 'CLOSED';
    try { conn.ws.close(); } catch (_) {}
    _connections.delete(sym);
}

function getConnectionState(symbol) {
    const conn = _connections.get(symbol.toUpperCase());
    return conn ? conn.state : 'CLOSED';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/wsMarketProxy.test.js --no-coverage --forceExit`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/wsMarketProxy.js tests/unit/wsMarketProxy.test.js
git commit -m "feat(ws-proxy): B.1 Task 2 — Binance WS connection manager + reconnect"
```

---

### Task 3: Message routing — Binance → broadcast to subscribers

**Files:**
- Modify: `server/services/wsMarketProxy.js`
- Modify: `tests/unit/wsMarketProxy.test.js`

- [ ] **Step 1: Write failing tests for message broadcast**

```js
describe('wsMarketProxy broadcast', () => {
    test('broadcast sends JSON to all subscribers of a symbol', () => {
        const ws1 = { readyState: 1, send: jest.fn() };
        const ws2 = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws1, 'BTCUSDT');
        proxy.subscribe(ws2, 'BTCUSDT');

        proxy._broadcast('BTCUSDT', { type: 'market.price', symbol: 'BTCUSDT', price: 75000 });

        expect(ws1.send).toHaveBeenCalledWith(expect.stringContaining('"market.price"'));
        expect(ws2.send).toHaveBeenCalledWith(expect.stringContaining('"75000"'));
    });

    test('broadcast skips closed clients', () => {
        const wsOpen = { readyState: 1, send: jest.fn() };
        const wsClosed = { readyState: 3, send: jest.fn() };
        proxy.subscribe(wsOpen, 'BTCUSDT');
        proxy.subscribe(wsClosed, 'BTCUSDT');

        proxy._broadcast('BTCUSDT', { type: 'market.price', symbol: 'BTCUSDT', price: 75000 });

        expect(wsOpen.send).toHaveBeenCalled();
        expect(wsClosed.send).not.toHaveBeenCalled();
    });

    test('broadcast does not send to subscribers of different symbol', () => {
        const wsBtc = { readyState: 1, send: jest.fn() };
        const wsEth = { readyState: 1, send: jest.fn() };
        proxy.subscribe(wsBtc, 'BTCUSDT');
        proxy.subscribe(wsEth, 'ETHUSDT');

        proxy._broadcast('BTCUSDT', { type: 'market.price', symbol: 'BTCUSDT', price: 75000 });

        expect(wsBtc.send).toHaveBeenCalled();
        expect(wsEth.send).not.toHaveBeenCalled();
    });

    test('last value cache updated on broadcast', () => {
        const ws = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws, 'BTCUSDT');

        proxy._broadcast('BTCUSDT', { type: 'market.price', symbol: 'BTCUSDT', price: 75000 });

        expect(proxy.getLastValue('BTCUSDT', 'market.price').price).toBe(75000);
    });

    test('new subscriber receives last cached value immediately', () => {
        const ws1 = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws1, 'BTCUSDT');
        proxy._broadcast('BTCUSDT', { type: 'market.price', symbol: 'BTCUSDT', price: 75000 });
        ws1.send.mockClear();

        const ws2 = { readyState: 1, send: jest.fn() };
        proxy.subscribe(ws2, 'BTCUSDT');

        // ws2 should get cached price immediately
        expect(ws2.send).toHaveBeenCalledWith(expect.stringContaining('"75000"'));
        // ws1 should NOT get it again
        expect(ws1.send).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/wsMarketProxy.test.js --no-coverage --forceExit`
Expected: FAIL — _broadcast, getLastValue not defined

- [ ] **Step 3: Implement broadcast + last value cache + Binance message handler**

Add to `server/services/wsMarketProxy.js`:

```js
function _broadcast(symbol, payload) {
    const sym = symbol.toUpperCase();
    const json = JSON.stringify(payload);
    // Update last value cache
    _lastValues.set(`${sym}:${payload.type}`, payload);

    const subs = _subs.get(sym);
    if (!subs) return;
    for (const ws of subs) {
        try { if (ws.readyState === 1) ws.send(json); } catch (_) {}
    }
}

function _broadcastAll(payload) {
    const json = JSON.stringify(payload);
    const type = payload.type;
    if (payload.symbol) _lastValues.set(`${payload.symbol}:${type}`, payload);
    for (const [sym, subs] of _subs) {
        for (const ws of subs) {
            try { if (ws.readyState === 1) ws.send(json); } catch (_) {}
        }
    }
}

function getLastValue(symbol, type) {
    return _lastValues.get(`${symbol.toUpperCase()}:${type}`) || null;
}

function _sendCachedValues(ws, symbol) {
    const sym = symbol.toUpperCase();
    const types = ['market.price', 'market.depth', 'market.wl'];
    for (const type of types) {
        const cached = _lastValues.get(`${sym}:${type}`);
        if (cached) {
            try { if (ws.readyState === 1) ws.send(JSON.stringify(cached)); } catch (_) {}
        }
    }
}

// Override subscribe to send cached values
const _origSubscribe = subscribe;
// (Inline in actual module — wrap subscribe to call _sendCachedValues after add)

function _handleBinanceMessage(symbol, msg) {
    if (!msg.stream || !msg.data) return;
    const d = msg.data;
    const stream = msg.stream;

    if (stream.includes('markPrice')) {
        _broadcast(symbol, {
            type: 'market.price', symbol,
            price: +d.p, fr: +d.r, frCd: +d.T, ts: Date.now(),
        });
    } else if (stream.includes('depth20')) {
        _broadcast(symbol, {
            type: 'market.depth', symbol,
            bids: (d.b || []).map(([p, q]) => ({ p: +p, q: +q })),
            asks: (d.a || []).map(([p, q]) => ({ p: +p, q: +q })),
            ts: Date.now(),
        });
    } else if (stream.includes('kline_')) {
        const k = d.k;
        if (!k) return;
        _broadcast(symbol, {
            type: 'market.kline', symbol,
            tf: k.i, bar: { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v },
            closed: k.x, ts: Date.now(),
        });
    } else if (stream.includes('aggTrade') || stream.includes('@trade')) {
        _broadcast(symbol, {
            type: 'market.aggTrade', symbol,
            p: +d.p, q: +d.q, m: !!d.m, T: d.T, ts: Date.now(),
        });
    } else if (stream.includes('forceOrder')) {
        const o = d.o || d;
        _broadcastAll({
            type: 'market.liq', symbol: o.s || symbol,
            side: o.S, qty: +o.q, price: +o.p, exchange: 'binance', ts: Date.now(),
        });
    } else if (stream.includes('miniTicker') || stream.includes('bookTicker')) {
        const price = stream.includes('bookTicker') ? (+d.b + +d.a) / 2 : +d.c;
        const chg = stream.includes('bookTicker') ? 0 : ((+d.c - +d.o) / +d.o * 100);
        _broadcast(d.s || symbol, {
            type: 'market.wl', symbol: d.s || symbol,
            price, chg, ts: Date.now(),
        });
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/wsMarketProxy.test.js --no-coverage --forceExit`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/wsMarketProxy.js tests/unit/wsMarketProxy.test.js
git commit -m "feat(ws-proxy): B.1 Task 3 — broadcast engine + last value cache + Binance message handler"
```

---

### Task 4: Wire into /ws/sync — handle subscribe/unsubscribe messages

**Files:**
- Modify: `server.js` (WS message handler section ~line 1644)
- Modify: `tests/unit/wsMarketProxy.test.js`

- [ ] **Step 1: Write test for message handling on /ws/sync**

```js
describe('wsMarketProxy /ws/sync integration', () => {
    test('handleClientMessage processes market.subscribe', () => {
        const ws = { readyState: 1, send: jest.fn(), _uid: 1 };
        jest.spyOn(proxy, '_connectSymbol').mockImplementation(() => {});

        proxy.handleClientMessage(ws, { type: 'market.subscribe', symbol: 'BTCUSDT' });

        expect(proxy.getSubscribers('BTCUSDT').size).toBe(1);
    });

    test('handleClientMessage processes market.unsubscribe', () => {
        const ws = { readyState: 1, send: jest.fn(), _uid: 1 };
        jest.spyOn(proxy, '_connectSymbol').mockImplementation(() => {});

        proxy.handleClientMessage(ws, { type: 'market.subscribe', symbol: 'BTCUSDT' });
        proxy.handleClientMessage(ws, { type: 'market.unsubscribe', symbol: 'BTCUSDT' });

        expect(proxy.getSubscribers('BTCUSDT').size).toBe(0);
    });

    test('handleClientMessage ignores unknown types', () => {
        const ws = { readyState: 1, send: jest.fn() };
        expect(() => {
            proxy.handleClientMessage(ws, { type: 'random.thing' });
        }).not.toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/wsMarketProxy.test.js --no-coverage --forceExit`
Expected: FAIL — handleClientMessage not defined

- [ ] **Step 3: Implement handleClientMessage + wire into server.js**

Add to `wsMarketProxy.js`:

```js
const DEFAULT_TIMEFRAMES = ['5m', '1h', '4h'];

function handleClientMessage(ws, msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'market.subscribe') {
        if (!msg.symbol) return;
        const result = subscribe(ws, msg.symbol);
        _sendCachedValues(ws, msg.symbol);
        if (result.isNewSymbol) {
            _connectSymbol(msg.symbol, msg.timeframes || DEFAULT_TIMEFRAMES);
        }
    } else if (msg.type === 'market.unsubscribe') {
        if (!msg.symbol) return;
        const result = unsubscribe(ws, msg.symbol);
        if (result.isLastSubscriber) {
            _disconnectSymbol(msg.symbol);
        }
    } else if (msg.type === 'market.subscribe.wl') {
        // Watchlist — subscribe to miniTicker for multiple symbols
        const symbols = msg.symbols || [];
        for (const sym of symbols) subscribe(ws, sym);
    }
}

function handleClientDisconnect(ws) {
    const removedSymbols = unsubscribeAll(ws);
    for (const sym of removedSymbols) {
        _disconnectSymbol(sym);
    }
}
```

Add to `server.js` inside `wss.on('connection')` message handler (after existing `sync` handling):

```js
// server.js — inside ws.on('message') handler
const wsMarketProxy = require('./server/services/wsMarketProxy');

// ... existing message handling ...

// WS Market Proxy — route market.* messages
if (parsed.type && parsed.type.startsWith('market.')) {
    wsMarketProxy.handleClientMessage(ws, parsed);
    return;
}

// ... and on ws close:
ws.on('close', () => {
    // ... existing cleanup ...
    wsMarketProxy.handleClientDisconnect(ws);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/wsMarketProxy.test.js --no-coverage --forceExit`
Expected: ALL PASS

- [ ] **Step 5: Commit with tag**

```bash
git tag pre-ws-proxy-B1-$(date +%Y%m%d)
git add server/services/wsMarketProxy.js tests/unit/wsMarketProxy.test.js server.js
git commit -m "feat(ws-proxy): B.1 Task 4 — wire into /ws/sync + handleClientMessage + disconnect cleanup"
```

---

### Task 5: Watchlist always-on stream

**Files:**
- Modify: `server/services/wsMarketProxy.js`
- Modify: `tests/unit/wsMarketProxy.test.js`

- [ ] **Step 1: Write test for watchlist stream**

```js
describe('wsMarketProxy watchlist', () => {
    test('startWatchlist opens WS for 8 fixed symbols', () => {
        jest.spyOn(proxy, '_createBinanceWs').mockReturnValue({
            on: jest.fn(), send: jest.fn(), close: jest.fn(), readyState: 1
        });

        proxy.startWatchlist();

        expect(proxy._createBinanceWs).toHaveBeenCalledWith(
            expect.stringContaining('miniTicker')
        );
    });

    test('watchlist symbols are configurable', () => {
        const url = proxy._buildWatchlistUrl(['BTCUSDT', 'ETHUSDT']);
        expect(url).toContain('btcusdt@miniTicker');
        expect(url).toContain('ethusdt@miniTicker');
    });
});
```

- [ ] **Step 2: Run test → FAIL**
- [ ] **Step 3: Implement watchlist**

```js
const WATCHLIST_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'ZECUSDT'];
let _wlWs = null;
let _wlPingTimer = null;

function _buildWatchlistUrl(symbols) {
    const streams = (symbols || WATCHLIST_SYMBOLS).map(s => s.toLowerCase() + '@miniTicker').join('/');
    return `${BINANCE_STREAM_BASE}/stream?streams=${streams}`;
}

function startWatchlist(symbols) {
    if (_wlWs) return;
    const url = _buildWatchlistUrl(symbols);
    _wlWs = _createBinanceWs(url);
    _wlWs.on('open', () => {
        _wlPingTimer = setInterval(() => { try { _wlWs.ping(); } catch (_) {} }, PING_INTERVAL_MS);
    });
    _wlWs.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            if (msg.data) {
                const d = msg.data;
                const sym = d.s;
                const price = +d.c;
                const chg = ((+d.c - +d.o) / +d.o * 100);
                _broadcastAll({ type: 'market.wl', symbol: sym, price, chg, ts: Date.now() });
            }
        } catch (_) {}
    });
    _wlWs.on('close', () => {
        if (_wlPingTimer) { clearInterval(_wlPingTimer); _wlPingTimer = null; }
        _wlWs = null;
        setTimeout(() => startWatchlist(symbols), 5000);
    });
    _wlWs.on('error', () => {});
}
```

- [ ] **Step 4: Run test → PASS**
- [ ] **Step 5: Commit**

```bash
git add server/services/wsMarketProxy.js tests/unit/wsMarketProxy.test.js
git commit -m "feat(ws-proxy): B.1 Task 5 — watchlist always-on miniTicker stream"
```

---

### Task 6: Integration verification + full regression

- [ ] **Step 1: Run full test suite**

```bash
npx jest tests/unit/wsMarketProxy.test.js tests/unit/binanceRateState.test.js tests/unit/binanceTelemetry.test.js tests/unit/binanceScheduler.test.js --no-coverage --forceExit
```

Expected: ALL PASS, zero regressions

- [ ] **Step 2: Verify module loads in production server**

```bash
node -e "const p = require('./server/services/wsMarketProxy'); console.log('Exports:', Object.keys(p).join(', '));"
```

Expected: subscribe, unsubscribe, unsubscribeAll, getSubscribers, getActiveSymbols, handleClientMessage, handleClientDisconnect, startWatchlist, getConnectionState, getLastValue, ...

- [ ] **Step 3: Final commit with B.1 tag**

```bash
git tag ws-proxy-B1-complete-$(date +%Y%m%d-%H%M%S)
git push origin main --tags
```

---

## Verification checklist (GO/NO-GO)

- [ ] All new tests pass (expect ~17 tests in wsMarketProxy.test.js)
- [ ] All existing tests pass (131 rate-limit + others)
- [ ] Module loads without errors
- [ ] server.js compiles and starts (PM2 reload clean)
- [ ] No new ERROR in PM2 logs
- [ ] Rate state clean (0/0/0)
- [ ] Doctor HEALTHY

**After B.1:** Report to operator, await approval for B.2 (resilience layer).
