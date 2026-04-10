// Zeus v122 — data/symbols.js
// Watchlist, multi-symbol support, ZStore
'use strict';

// ZStore
window.ZStore = {
  // Unified getters
  price: sym => allPrices[sym] || (sym === S.symbol ? S.price : null),
  state: () => S,
  brain: () => BM,
  at: () => typeof AT !== 'undefined' ? AT : null,
  tp: () => TP,
  dsl: () => typeof DSL !== 'undefined' ? DSL : null,
  perf: () => typeof PERF !== 'undefined' ? PERF : null,
  dhf: () => typeof DHF !== 'undefined' ? DHF : null,
  // Dispatch (stub — ready for future reducers)
  _listeners: {},
  on(event, fn) { (this._listeners[event] = this._listeners[event] || []).push(fn); },
  emit(event, data) { (this._listeners[event] || []).forEach(fn => { try { fn(data); } catch (_) { } }); },
  dispatch(action, payload) {
    this.emit(action, payload);
    // Future: reducers would handle state mutations here
  }
};
function connectWatchlist() {
  const streams = WL_SYMS.map(s => s.toLowerCase() + '@miniTicker').join('/');
  const _wlGen = window.__wsGen; // capture generation at connect time
  console.log(`[connectWatchlist] attempt | gen=${_wlGen} | streams count=${WL_SYMS.length}`);
  WS.open('watchlist', `wss://fstream.binance.com/stream?streams=${streams}`, {
    onopen: () => {
      console.log(`[connectWatchlist] onopen | gen=${window.__wsGen} (my gen=${_wlGen})`);
      _resetBackoff('wl'); _exitDegradedMode('WL');
    },
    onmessage: e => {
      // Gen guard: discard stale messages after symbol change
      if (window.__wsGen !== _wlGen) return;
      const j = JSON.parse(e.data); if (!j.data) return;
      const d = j.data;
      const sym = d.s;
      const price = +d.c; const open = +d.o;
      const chg = ((price - open) / open * 100);
      wlPrices[sym] = { price, chg, ts: Date.now() }; // [v105 FIX Bug3] ts pentru stale-price detection
      allPrices[sym] = price; // BUG1: track all WL prices
      onNeuronScanUpdate(sym);  // pulse neuron LED in Brain cockpit
      // Update watchlist UI
      const pe = el('wlp-' + sym);
      const ce = el('wlc-' + sym);
      if (pe) {
        const p = price >= 1000 ? fP(price) : price >= 1 ? price.toFixed(3) : price.toPrecision(4);
        pe.textContent = '$' + p;
      }
      if (ce) {
        ce.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
        ce.className = 'wl-chg ' + (chg >= 0 ? 'up' : 'dn');
      }
    },
    onclose: () => {
      console.log(`[connectWatchlist] onclose`);
      _enterDegradedMode('WL'); Timeouts.set('wlReconnect', connectWatchlist, _nextBackoff('wl', 5000, 30000));
    }
  });
}

function switchWLSymbol(sym) {
  // Update active state
  document.querySelectorAll('.wl-item').forEach(i => i.classList.remove('act'));
  const item = el('wl-' + sym); if (item) item.classList.add('act');
  // Switch main symbol
  const sel = document.querySelector('#symSel');
  if (sel) { sel.value = sym; setSymbol(sym); }
  else { S.symbol = sym; resetData(); }
}


