/* ───────────────────────────────────────────────────────────────
   Zeus Terminal — Time & Sales Tape (timeSales.ts)
   v1.0.0 | 2026-03-27
   Ported from timeSales.js — IIFE runs on import.
   ─────────────────────────────────────────────────────────────── */
const w = window as any;

export function toggleTimeSales(): void {
  // exposed below via IIFE
  w.toggleTimeSales();
}

// IIFE: runs on import
(function () {
  if (w.__ZEUS_TS__) return;
  w.__ZEUS_TS__ = true;

  // ── Config ──
  var MAX_ROWS = 40;          // visible rows in tape
  var REFRESH_MS = 200;       // render interval (5 FPS)
  var BIG_TRADE_MULT = 5;     // highlight trades > avg * this

  // ── State ──
  var _open = false;
  var _timer: any = null;
  var _lastLen = 0;           // track buf changes to avoid re-render
  var _container: any = null;
  var _tbody: any = null;
  var _statsEl: any = null;
  var _avgSize = 0;

  // ── Build DOM ──
  function _build() {
    if (_container) return;

    var wrap = document.getElementById('ts-wrap');
    if (!wrap) return;
    _container = wrap;

    // Stats bar
    _statsEl = document.createElement('div');
    _statsEl.className = 'ts-stats';
    _statsEl.innerHTML = '<span id="ts-tps">0 t/s</span>' +
      '<span id="ts-buyv" style="color:var(--grn,#00d97a)">B: 0</span>' +
      '<span id="ts-sellv" style="color:var(--red,#ff3355)">S: 0</span>' +
      '<span id="ts-delta">&#916; 0</span>' +
      '<span id="ts-big" style="color:var(--gold,#f0c040)">&#9733; 0</span>';
    wrap.appendChild(_statsEl);

    // Table
    var tbl = document.createElement('div');
    tbl.className = 'ts-table';
    tbl.innerHTML = '<div class="ts-hdr">' +
      '<span class="ts-c ts-time">TIME</span>' +
      '<span class="ts-c ts-price">PRICE</span>' +
      '<span class="ts-c ts-qty">QTY</span>' +
      '<span class="ts-c ts-val">VALUE</span>' +
      '</div>' +
      '<div class="ts-body" id="ts-body"></div>';
    wrap.appendChild(tbl);

    _tbody = document.getElementById('ts-body');
  }

  // ── Format helpers ──
  function _fmtTime(ts: any) {
    var d = new Date(ts);
    var h = d.getHours(), m = d.getMinutes(), s = d.getSeconds(), ms = d.getMilliseconds();
    return (h < 10 ? '0' : '') + h + ':' +
           (m < 10 ? '0' : '') + m + ':' +
           (s < 10 ? '0' : '') + s + '.' +
           (ms < 100 ? (ms < 10 ? '00' : '0') : '') + ms;
  }

  function _fmtNum(n: any, decimals?: any) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return decimals !== undefined ? n.toFixed(decimals) : n.toFixed(2);
  }

  function _fmtPrice(p: any) {
    if (p >= 1000) return p.toFixed(2);
    if (p >= 1) return p.toFixed(4);
    return p.toFixed(6);
  }

  // ── Render tape ──
  function _render() {
    if (!_open || !_tbody) return;

    var RF = w.RAW_FLOW;
    if (!RF || !RF.buf) return;

    var buf = RF.buf;
    var len = buf.length;

    // Skip if no change
    if (len === _lastLen) return;
    _lastLen = len;

    // Get last MAX_ROWS trades (newest first)
    var start = Math.max(0, len - MAX_ROWS);
    var slice = buf.slice(start);

    // Compute avg qty for big trade detection
    if (len > 10) {
      var sum = 0;
      var sampleStart = Math.max(0, len - 200);
      for (var k = sampleStart; k < len; k++) sum += buf[k].q;
      _avgSize = sum / (len - sampleStart);
    }

    // Stats: last 2s window
    var now = Date.now();
    var cut2 = now - 2000;
    var buyV = 0, sellV = 0, cnt = 0, bigCnt = 0;
    for (var j = len - 1; j >= 0 && buf[j].ts >= cut2; j--) {
      var t = buf[j];
      if (t.isBuyerMaker) sellV += t.q * t.p;
      else buyV += t.q * t.p;
      cnt++;
      if (_avgSize > 0 && t.q > _avgSize * BIG_TRADE_MULT) bigCnt++;
    }

    // Update stats
    var tpsEl = document.getElementById('ts-tps');
    var buyEl = document.getElementById('ts-buyv');
    var sellEl = document.getElementById('ts-sellv');
    var deltaEl = document.getElementById('ts-delta');
    var bigEl = document.getElementById('ts-big');

    if (tpsEl) tpsEl.textContent = Math.round(cnt / 2) + ' t/s';
    if (buyEl) buyEl.textContent = 'B: $' + _fmtNum(buyV);
    if (sellEl) sellEl.textContent = 'S: $' + _fmtNum(sellV);
    if (deltaEl) {
      var delta = buyV - sellV;
      deltaEl.textContent = '\u0394 ' + (delta >= 0 ? '+' : '') + '$' + _fmtNum(Math.abs(delta));
      deltaEl.style.color = delta >= 0 ? 'var(--grn,#00d97a)' : 'var(--red,#ff3355)';
    }
    if (bigEl) bigEl.textContent = '\u2605 ' + bigCnt;

    // Build rows (newest on top)
    var html = '';
    for (var i = slice.length - 1; i >= 0; i--) {
      var tr = slice[i];
      var isBuy = !tr.isBuyerMaker;
      var isBig = _avgSize > 0 && tr.q > _avgSize * BIG_TRADE_MULT;
      var cls = isBuy ? 'ts-buy' : 'ts-sell';
      if (isBig) cls += ' ts-big-row';
      var val = tr.p * tr.q;

      html += '<div class="ts-row ' + cls + '">' +
        '<span class="ts-c ts-time">' + _fmtTime(tr.ts) + '</span>' +
        '<span class="ts-c ts-price">' + _fmtPrice(tr.p) + '</span>' +
        '<span class="ts-c ts-qty">' + _fmtNum(tr.q, 3) + '</span>' +
        '<span class="ts-c ts-val">$' + _fmtNum(val) + '</span>' +
        '</div>';
    }
    _tbody.innerHTML = html;
  }

  // ── Toggle open/close ──
  function _toggle() {
    _open = !_open;
    var wrap = document.getElementById('ts-wrap');
    var btn = document.getElementById('ts-toggle-btn');

    if (_open) {
      _build();
      if (wrap) wrap.style.display = 'block';
      if (btn) btn.classList.add('on');
      _lastLen = 0; // force re-render
      _timer = setInterval(_render, REFRESH_MS);
      _render();
    } else {
      if (wrap) wrap.style.display = 'none';
      if (btn) btn.classList.remove('on');
      if (_timer) { clearInterval(_timer); _timer = null; }
    }
  }

  // ── Expose toggle globally ──
  w.toggleTimeSales = _toggle;

  // ── Restore state from localStorage ──
  try {
    if (localStorage.getItem('zeus_ts_open') === '1') {
      // Defer until DOM is ready
      var _restoreCheck = setInterval(function () {
        if (document.getElementById('ts-wrap')) {
          clearInterval(_restoreCheck);
          _toggle();
        }
      }, 200);
      // Safety: stop checking after 10s
      setTimeout(function () { clearInterval(_restoreCheck); }, 10000);
    }
  } catch (_) {}

  // ── Persist state ──
  var _origToggle = _toggle;
  w.toggleTimeSales = function () {
    _origToggle();
    try { localStorage.setItem('zeus_ts_open', _open ? '1' : '0'); } catch (_) {}
  };

  console.log('[T&S] Time & Sales tape loaded — toggle with T key or button');
})();
