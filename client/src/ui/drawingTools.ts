/* ───────────────────────────────────────────────────────────────
   Zeus Terminal — Drawing Tools v4.0 | 2026-03-27
   Ported from drawingTools.js — IIFE runs on import.
   ─────────────────────────────────────────────────────────────── */
import { getKlines } from '../services/stateAccessors'
const w = window as any; // kept for w._zMainChart, w._zCSeries, w._dtToastTimer, w.__ZEUS_DRAW__, fn calls

export function drawToolActivate(tool: any): void { w.drawToolActivate(tool); }
export function drawToolClearAll(): void { w.drawToolClearAll(); }
export function drawToolToggleVis(): void { w.drawToolToggleVis(); }

// IIFE: runs on import
(function () {
  if (w.__ZEUS_DRAW__) return;
  w.__ZEUS_DRAW__ = true;

  var LS_KEY = 'zeus_drawings_v1';
  var VIS_KEY = 'zeus_drawings_vis'; // [Pack E] '0' = hidden, anything else = visible (default)
  var _lines: any[] = [];
  var _activeTool: any = null;
  var _nextId = 1;
  // [Pack E] Restore visibility from localStorage so the eye toggle
  // survives refresh. Default visible if missing or malformed.
  var _visible = (function () {
    try { return localStorage.getItem(VIS_KEY) !== '0'; } catch (_) { return true; }
  })();
  var _dragging: any = null;
  var _tlineStep = 0, _tlinePendingP1: any = null;
  var _selectedId: any = null;
  // [Pack F / M12 phase 2 — preview line]
  // After first click, a dashed preview LineSeries is drawn between
  // _tlinePendingP1 and the current mouse position so the operator
  // sees exactly where the trendline will land before the second click
  // (TradingView-style). Cleared on second click, on _deactivate, on
  // Escape key, or when the tool changes.
  var _previewSeries: any = null;
  var _previewMoveHandler: any = null;
  var _handleContainer: any = null;

  var COLORS = ['#f0c040','#00d97a','#ff3355','#00b8d4','#aa44ff','#ff8822','#ffffff'];
  var _colorIdx = 0;
  function _nextColor() { var c = COLORS[_colorIdx % COLORS.length]; _colorIdx++; return c; }

  // [Pack G] Per-tool defaults — color/width/style of the NEXT new line.
  // Persisted to localStorage so the operator's last choice survives
  // refresh. Updated whenever settings popover is used on a selected
  // line — existing lines keep their own state (per-line in _save()).
  var DEFAULTS_KEY = 'zeus_drawing_defaults';
  var _defaultColor: string = COLORS[0];
  var _defaultWidth: number = 2;     // px
  var _defaultStyle: number = 0;     // lightweight-charts: 0=solid 1=dotted 2=dashed 3=large 4=sparse
  function _loadDrawingDefaults() {
    try {
      var raw = localStorage.getItem(DEFAULTS_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d && typeof d.color === 'string') _defaultColor = d.color;
      if (d && Number.isFinite(d.width)) _defaultWidth = Math.max(1, Math.min(6, d.width));
      if (d && Number.isFinite(d.style)) _defaultStyle = Math.max(0, Math.min(4, d.style));
    } catch (_) { /* */ }
  }
  function _saveDrawingDefaults() {
    try { localStorage.setItem(DEFAULTS_KEY, JSON.stringify({ color: _defaultColor, width: _defaultWidth, style: _defaultStyle })); } catch (_) { /* */ }
  }
  _loadDrawingDefaults();
  function _chart() { return w._zMainChart || null; }
  function _series() { return w._zCSeries || null; }
  function _mc() { return document.getElementById('mc'); }

  function _toast(msg: any) {
    var t = document.getElementById('zeus-hk-toast') as any;
    if (!t) {
      t = document.createElement('div'); t.id = 'zeus-hk-toast';
      t.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:100001;background:#1a2530;border:1px solid #2a3540;border-radius:8px;padding:8px 16px;color:#f0c040;font-family:monospace;font-size:12px;opacity:0;transition:opacity .2s;pointer-events:none';
      document.body.appendChild(t);
    }
    t.textContent = msg; t.style.opacity = '1';
    clearTimeout(w._dtToastTimer);
    w._dtToastTimer = setTimeout(function () { t.style.opacity = '0'; }, 1200);
  }

  // ── Coordinate helpers ──
  function _priceAtY(clientY: any) {
    var mc = _mc(); if (!mc) return null;
    var y = clientY - mc.getBoundingClientRect().top;
    try { var p = _series().coordinateToPrice(y); return (p && Number.isFinite(p) && p > 0) ? p : null; } catch(_) { return null; }
  }
  function _timeAtX(clientX: any) {
    var mc = _mc(); if (!mc) return null;
    var x = clientX - mc.getBoundingClientRect().left;
    try {
      var log = _chart().timeScale().coordinateToLogical(x);
      var klines = getKlines();
      if (log != null && klines.length) {
        var idx = Math.round(log);
        if (idx >= 0 && idx < klines.length) return klines[idx].time;
      }
    } catch(_) {}
    return null;
  }
  function _priceToY(price: any) { try { return _series().priceToCoordinate(price); } catch(_) { return null; } }
  function _timeToX(time: any) { try { return _chart().timeScale().timeToCoordinate(time); } catch(_) { return null; } }

  // ── Persistence ──
  function _save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({
      lines: _lines.map(function(l: any) {
        // [Pack G] Persist per-line width + style alongside color so the
        // operator's individual customizations survive refresh.
        var o: any = { id:l.id, type:l.type, color:l.color, width:l.width||2, style:l.style||0 };
        if (l.type === 'hline') o.price = l.price;
        if (l.type === 'tline') { o.p1 = { time:l.p1.time, price:l.p1.price }; o.p2 = { time:l.p2.time, price:l.p2.price }; }
        return o;
      }),
      nextId: _nextId
    })); } catch(_) {}
  }

  // ── Handle container ──
  function _ensureHandleContainer() {
    if (_handleContainer) return;
    var mc = _mc(); if (!mc) return;
    var p = mc.parentElement; if (!p) return;
    if (getComputedStyle(p).position === 'static') p.style.position = 'relative';
    _handleContainer = document.createElement('div');
    _handleContainer.id = 'dt-handles';
    _handleContainer.style.cssText = 'position:absolute;inset:0;z-index:25;pointer-events:none;overflow:hidden;';
    p.appendChild(_handleContainer);
  }

  function _createHandle(lineId: any, idx: any, color: any) {
    var el = document.createElement('div');
    el.className = 'dt-handle';
    el.style.cssText = 'position:absolute;width:14px;height:14px;border-radius:50%;border:2px solid ' + color + ';background:' + color + '44;cursor:grab;pointer-events:auto;transform:translate(-50%,-50%);z-index:26;display:none;touch-action:none;';
    el.addEventListener('mousedown', function(e: any) { _startDrag(e, lineId, idx); e.preventDefault(); e.stopPropagation(); });
    el.addEventListener('touchstart', function(e: any) {
      var t = e.touches[0];
      _startDrag({ clientX:t.clientX, clientY:t.clientY, _touch:true }, lineId, idx);
      e.preventDefault(); e.stopPropagation();
    }, { passive: false });
    return el;
  }

  function _createDeleteBtn(lineId: any) {
    var el = document.createElement('div');
    el.className = 'dt-del';
    el.innerHTML = '\u2715';
    el.style.cssText = 'position:absolute;width:20px;height:20px;border-radius:50%;background:#ff3355;color:#fff;font-size:12px;font-weight:700;line-height:20px;text-align:center;cursor:pointer;pointer-events:auto;transform:translate(-50%,-50%);z-index:27;display:none;touch-action:none;';
    el.addEventListener('click', function(e: any) { _removeLine(lineId); e.stopPropagation(); });
    el.addEventListener('touchend', function(e: any) { _removeLine(lineId); e.preventDefault(); e.stopPropagation(); }, { passive: false });
    return el;
  }

  // [Pack G] Per-line settings button (\u2699 gear) sits next to the X.
  // Click opens a Zeus-themed popover with color / width / style.
  // Changes apply to this line + become defaults for future lines.
  function _createSettingsBtn(lineId: any) {
    var el = document.createElement('div');
    el.className = 'dt-cfg';
    el.innerHTML = '\u2699'; // \u2699 gear
    el.style.cssText = 'position:absolute;width:20px;height:20px;border-radius:50%;background:#1a2530;color:#f0c040;font-size:12px;font-weight:700;line-height:20px;text-align:center;cursor:pointer;pointer-events:auto;transform:translate(-50%,-50%);z-index:27;display:none;touch-action:none;border:1px solid #2a3a4a;';
    function _open(e: any) {
      e.stopPropagation(); e.preventDefault && e.preventDefault();
      var line = _lines.find(function (l: any) { return l.id === lineId; });
      if (line) _openSettingsPanel(line, el);
    }
    el.addEventListener('click', _open);
    el.addEventListener('touchend', _open as any, { passive: false } as any);
    return el;
  }

  // [Pack G] Settings popover — Zeus-themed, semi-rounded, opens next
  // to the ⚙ button. Singleton: only one panel exists at a time, closed
  // via _closeSettingsPanel on deselect / line delete / outside click.
  var _settingsPanel: any = null;
  var _settingsOutsideHandler: any = null;
  // [Pack G.1] When the outside-click handler closes the panel, the
  // SAME mouse gesture also produces a `click` event on the chart that
  // would re-run _handleChartAction → nearest-line check → re-select
  // the line (because clicks near the line price within 0.5% match the
  // threshold). User wants the X + ⚙ to disappear after they finish
  // editing — so we suppress the next chart action briefly after a
  // panel close to force the deselect to stick.
  var _suppressNextChartAction = false;

  function _closeSettingsPanel() {
    if (_settingsPanel && _settingsPanel.parentElement) {
      try { _settingsPanel.parentElement.removeChild(_settingsPanel); } catch (_) { /* */ }
    }
    _settingsPanel = null;
    if (_settingsOutsideHandler) {
      try { document.removeEventListener('mousedown', _settingsOutsideHandler, true); } catch (_) { /* */ }
      try { document.removeEventListener('touchstart', _settingsOutsideHandler, true); } catch (_) { /* */ }
      _settingsOutsideHandler = null;
    }
  }

  // [Pack G] Apply color/width/style to a specific line (live update on
  // its lwcRef or lwcSeries) AND set as defaults for future lines —
  // exactly the behavior the operator asked for: change the selected
  // line, future new lines inherit, existing other lines keep theirs.
  function _applyLineSettings(line: any, color: any, width: any, style: any) {
    if (!line) return;
    line.color = color;
    line.width = width;
    line.style = style;
    if (line.type === 'hline' && line.lwcRef) {
      try { line.lwcRef.applyOptions({ color: color, lineWidth: width, lineStyle: style }); } catch (_) { /* */ }
    }
    if (line.type === 'tline' && line.lwcSeries) {
      // Selected gets +1px emphasis (mirrors _selectLine logic).
      var lw = line.selected ? Math.min(6, width + 1) : width;
      try { line.lwcSeries.applyOptions({ color: color, lineWidth: lw, lineStyle: style }); } catch (_) { /* */ }
    }
    // Recolor handles to match new line color.
    if (line.handles) {
      line.handles.forEach(function (h: any) {
        try {
          h.style.borderColor = color;
          h.style.background = color + '44';
        } catch (_) { /* */ }
      });
    }
    // Defaults for future lines.
    _defaultColor = color;
    _defaultWidth = width;
    _defaultStyle = style;
    _saveDrawingDefaults();
    _save();
  }

  function _openSettingsPanel(line: any, anchor: any) {
    _closeSettingsPanel();
    var mc = _mc(); if (!mc) return;
    var host = mc.parentElement || document.body;

    var panel = document.createElement('div');
    panel.className = 'dt-cfg-panel';
    panel.style.cssText = [
      'position:absolute',
      'z-index:30',
      'background:#0d1620',
      'border:1px solid #2a3a4a',
      'border-radius:10px',
      'padding:10px 12px',
      'box-shadow:0 6px 20px rgba(0,0,0,.55)',
      'font-family:monospace',
      'font-size:11px',
      'color:#cfd8e3',
      'pointer-events:auto',
      'min-width:180px',
      'user-select:none',
    ].join(';') + ';';

    // Position panel just below + slightly left of the anchor (cfg btn).
    var anchorLeft = parseFloat(anchor.style.left) || 0;
    var anchorTop  = parseFloat(anchor.style.top)  || 0;
    var px = Math.max(8, anchorLeft - 90);
    var py = anchorTop + 18;
    var hostW = host.getBoundingClientRect().width;
    if (px + 200 > hostW) px = Math.max(8, hostW - 210);
    panel.style.left = px + 'px';
    panel.style.top = py + 'px';

    // Section helper.
    function row(label: string) {
      var r = document.createElement('div');
      r.style.cssText = 'display:flex;align-items:center;gap:6px;margin:4px 0;';
      var lbl = document.createElement('span');
      lbl.textContent = label;
      lbl.style.cssText = 'color:#7a8896;font-size:10px;letter-spacing:.5px;text-transform:uppercase;flex:0 0 50px;';
      r.appendChild(lbl);
      return r;
    }

    // ── Color row ──
    var rColor = row('Color');
    COLORS.forEach(function (c: any) {
      var sw = document.createElement('div');
      sw.style.cssText = 'width:18px;height:18px;border-radius:50%;background:' + c + ';cursor:pointer;border:2px solid ' + ((line.color === c) ? '#f0c040' : '#2a3a4a') + ';transition:border-color .1s;';
      sw.addEventListener('click', function (e: any) {
        e.stopPropagation();
        _applyLineSettings(line, c, line.width || _defaultWidth, line.style != null ? line.style : _defaultStyle);
        // Refresh swatch borders.
        Array.prototype.forEach.call(rColor.querySelectorAll('div'), function (d: any) {
          d.style.borderColor = (d.dataset.color === c) ? '#f0c040' : '#2a3a4a';
        });
      });
      sw.dataset.color = c;
      rColor.appendChild(sw);
    });
    panel.appendChild(rColor);

    // ── Width row ──
    var rWidth = row('Width');
    [1, 2, 3, 4].forEach(function (n: any) {
      var b = document.createElement('div');
      b.textContent = String(n);
      b.dataset.width = String(n);
      b.style.cssText = 'width:22px;height:22px;line-height:22px;text-align:center;border-radius:6px;background:#162230;border:1px solid ' + ((line.width || _defaultWidth) === n ? '#f0c040' : '#2a3a4a') + ';color:#cfd8e3;cursor:pointer;font-size:10px;';
      b.addEventListener('click', function (e: any) {
        e.stopPropagation();
        _applyLineSettings(line, line.color || _defaultColor, n, line.style != null ? line.style : _defaultStyle);
        Array.prototype.forEach.call(rWidth.querySelectorAll('div'), function (d: any) {
          if (d.dataset.width != null) d.style.borderColor = (Number(d.dataset.width) === n) ? '#f0c040' : '#2a3a4a';
        });
      });
      rWidth.appendChild(b);
    });
    panel.appendChild(rWidth);

    // ── Style row ── (lightweight-charts: 0=solid 1=dotted 2=dashed)
    var rStyle = row('Style');
    var styles: any[] = [
      { v: 0, label: '———' },  // solid
      { v: 2, label: '— —' },  // dashed
      { v: 1, label: '· · ·' } // dotted
    ];
    styles.forEach(function (s: any) {
      var b = document.createElement('div');
      b.textContent = s.label;
      b.dataset.style = String(s.v);
      var current = (line.style != null ? line.style : _defaultStyle);
      b.style.cssText = 'padding:0 8px;height:22px;line-height:22px;border-radius:6px;background:#162230;border:1px solid ' + (current === s.v ? '#f0c040' : '#2a3a4a') + ';color:#cfd8e3;cursor:pointer;font-size:11px;';
      b.addEventListener('click', function (e: any) {
        e.stopPropagation();
        _applyLineSettings(line, line.color || _defaultColor, line.width || _defaultWidth, s.v);
        Array.prototype.forEach.call(rStyle.querySelectorAll('div'), function (d: any) {
          if (d.dataset.style != null) d.style.borderColor = (Number(d.dataset.style) === s.v) ? '#f0c040' : '#2a3a4a';
        });
      });
      rStyle.appendChild(b);
    });
    panel.appendChild(rStyle);

    host.appendChild(panel);
    _settingsPanel = panel;

    // Click-outside-to-close (next tick so the opening click doesn't
    // immediately close it).
    setTimeout(function () {
      _settingsOutsideHandler = function (e: any) {
        if (!_settingsPanel) return;
        var t = e.target;
        if (_settingsPanel.contains(t)) return;
        if (anchor && anchor.contains && anchor.contains(t)) return;
        // Skip if the click landed on the line's own controls — let
        // their own handlers run (handle drag, X delete) without the
        // panel closing under them.
        if (t.closest && t.closest('.dt-handle,.dt-del')) {
          _closeSettingsPanel();
          return;
        }
        // [Pack G.1] Outside click closes panel AND deselects the
        // line — X + ⚙ disappear, only the line stays. The
        // _suppressNextChartAction flag prevents the upcoming chart
        // click from re-selecting via the nearest-line check.
        _suppressNextChartAction = true;
        setTimeout(function () { _suppressNextChartAction = false; }, 250);
        _deselectAll();
      };
      document.addEventListener('mousedown', _settingsOutsideHandler, true);
      document.addEventListener('touchstart', _settingsOutsideHandler, true);
    }, 0);
  }

  // ── Add H-Line (native LWC price line — follows chart automatically) ──
  function _addHLine(price: any, color?: any, existingId?: any, width?: any, style?: any) {
    var s = _series(); if (!s) return;
    // [Pack G] If color/width/style not specified by caller, use the
    // operator's saved defaults (last used in the settings popover).
    color = color || _defaultColor || _nextColor();
    var w0 = Number.isFinite(width) ? width : _defaultWidth;
    var st0 = Number.isFinite(style) ? style : _defaultStyle;
    var id = existingId || _nextId++;
    var ref = s.createPriceLine({ price:price, color:color, lineWidth:w0, lineStyle:st0, axisLabelVisible:true, title:price.toFixed(2) });
    _ensureHandleContainer();
    var h = _createHandle(id, 0, color);
    var del = _createDeleteBtn(id);
    var cfg = _createSettingsBtn(id);
    if (_handleContainer) { _handleContainer.appendChild(h); _handleContainer.appendChild(del); _handleContainer.appendChild(cfg); }
    _lines.push({ id:id, type:'hline', price:price, color:color, width:w0, style:st0, lwcRef:ref, handles:[h], delBtn:del, cfgBtn:cfg, selected:false });
    _selectLine(id);
    if (!existingId) _save();
  }

  // ── Add Trendline (native LWC LineSeries — follows chart automatically) ──
  function _addTLine(p1: any, p2: any, color?: any, existingId?: any, width?: any, style?: any) {
    var c = _chart(); if (!c) return;
    // [Pack G] Use operator's saved defaults when caller omits.
    color = color || _defaultColor || _nextColor();
    var w0 = Number.isFinite(width) ? width : _defaultWidth;
    var st0 = Number.isFinite(style) ? style : _defaultStyle;
    var id = existingId || _nextId++;

    // Create a LineSeries on the chart for this trendline
    var lineSeries = c.addLineSeries({
      color: color,
      lineWidth: w0,
      lineStyle: st0,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    });
    // Set the 2 data points
    var data = [
      { time: Math.min(p1.time, p2.time), value: (p1.time <= p2.time) ? p1.price : p2.price },
      { time: Math.max(p1.time, p2.time), value: (p1.time <= p2.time) ? p2.price : p1.price }
    ];
    lineSeries.setData(data);

    _ensureHandleContainer();
    var h1 = _createHandle(id, 0, color);
    var h2 = _createHandle(id, 1, color);
    var del = _createDeleteBtn(id);
    var cfg = _createSettingsBtn(id);
    if (_handleContainer) { _handleContainer.appendChild(h1); _handleContainer.appendChild(h2); _handleContainer.appendChild(del); _handleContainer.appendChild(cfg); }

    _lines.push({ id:id, type:'tline', p1:{time:p1.time, price:p1.price}, p2:{time:p2.time, price:p2.price}, color:color, width:w0, style:st0, lwcSeries:lineSeries, handles:[h1,h2], delBtn:del, cfgBtn:cfg, selected:false });
    _selectLine(id);
    if (!existingId) _save();
  }

  // ── Update trendline series data after drag ──
  function _updateTLineSeries(line: any) {
    if (!line.lwcSeries) return;
    var t1 = Math.min(line.p1.time, line.p2.time);
    var t2 = Math.max(line.p1.time, line.p2.time);
    var v1 = (line.p1.time <= line.p2.time) ? line.p1.price : line.p2.price;
    var v2 = (line.p1.time <= line.p2.time) ? line.p2.price : line.p1.price;
    if (t1 === t2) t2 = t1 + 1; // avoid zero-length
    try { line.lwcSeries.setData([{ time:t1, value:v1 }, { time:t2, value:v2 }]); } catch(_) {}
  }

  // ── Remove ──
  function _removeLine(id: any) {
    for (var i = 0; i < _lines.length; i++) {
      if (_lines[i].id === id) {
        var l = _lines[i];
        if (l.lwcRef) try { _series().removePriceLine(l.lwcRef); } catch(_) {}
        if (l.lwcSeries) try { _chart().removeSeries(l.lwcSeries); } catch(_) {}
        l.handles.forEach(function(h: any) { if (h.parentElement) h.parentElement.removeChild(h); });
        if (l.delBtn && l.delBtn.parentElement) l.delBtn.parentElement.removeChild(l.delBtn);
        // [Pack G] Tear down the settings ⚙ button along with the line.
        if (l.cfgBtn && l.cfgBtn.parentElement) l.cfgBtn.parentElement.removeChild(l.cfgBtn);
        if (_selectedId === id) _closeSettingsPanel();
        _lines.splice(i, 1);
        if (_selectedId === id) _selectedId = null;
        _save(); _toast('Deleted');
        return;
      }
    }
  }

  // ── Select / Deselect ──
  function _selectLine(id: any) {
    _selectedId = id;
    _lines.forEach(function(l: any) {
      l.selected = (l.id === id);
      l.handles.forEach(function(h: any) { h.style.display = l.selected ? 'block' : 'none'; });
      if (l.delBtn) l.delBtn.style.display = l.selected ? 'block' : 'none';
      // [Pack G] Settings ⚙ button mirrors selected state.
      if (l.cfgBtn) l.cfgBtn.style.display = l.selected ? 'block' : 'none';
      // Highlight selected trendline — preserve user's chosen width
      // when not selected; emphasize +1px on selection.
      if (l.lwcSeries) try { l.lwcSeries.applyOptions({ lineWidth: l.selected ? Math.min(6, (l.width || 2) + 1) : (l.width || 2) }); } catch(_) {}
    });
  }
  function _deselectAll() { _selectedId = null; _selectLine(-1); _closeSettingsPanel(); }

  // ── Update handle positions (runs every frame via RAF) ──
  function _updateHandles() {
    var mc = _mc(); if (!mc) return;
    var chartW = mc.getBoundingClientRect().width;
    var chartH = mc.getBoundingClientRect().height;
    // [Pack F.1] _handleContainer spans `mc.parentElement`, but
    // priceToCoordinate / timeToCoordinate return chart-canvas coords
    // (relative to mc, not parent). Without offsets, handles/X land
    // shifted by (mc.offsetLeft, mc.offsetTop) — typically a few px down
    // and right of the trendline endpoints (or much more on layouts
    // with chart toolbars / axis padding above the canvas). Add the
    // canvas's offset within its parent to align handles + X exactly
    // on the trendline endpoints / next to the line midpoint.
    var oxL = mc.offsetLeft || 0;
    var oyT = mc.offsetTop || 0;
    _lines.forEach(function(l: any) {
      if (!l.selected) return;
      if (l.type === 'hline') {
        var y = _priceToY(l.price);
        if (y != null) {
          // hline handle pinned to right edge of chart — apply same
          // offset so it lands inside chart bounds, not on the parent's
          // padding.
          l.handles[0].style.left = (oxL + chartW - 30) + 'px';
          l.handles[0].style.top = (oyT + y) + 'px';
          if (l.delBtn) { l.delBtn.style.left = (oxL + chartW - 55) + 'px'; l.delBtn.style.top = (oyT + y) + 'px'; }
          // [Pack G] Settings ⚙ button to the LEFT of the X for hline.
          if (l.cfgBtn) { l.cfgBtn.style.left = (oxL + chartW - 80) + 'px'; l.cfgBtn.style.top = (oyT + y) + 'px'; }
        }
      }
      if (l.type === 'tline') {
        var x1 = _timeToX(l.p1.time), y1 = _priceToY(l.p1.price);
        var x2 = _timeToX(l.p2.time), y2 = _priceToY(l.p2.price);
        if (x1 != null && y1 != null) { l.handles[0].style.left = (oxL + x1) + 'px'; l.handles[0].style.top = (oyT + y1) + 'px'; }
        if (x2 != null && y2 != null) { l.handles[1].style.left = (oxL + x2) + 'px'; l.handles[1].style.top = (oyT + y2) + 'px'; }
        if (l.delBtn && x1 != null && y1 != null && x2 != null && y2 != null) {
          // [Pack C M12 X-clamp + Pack F.1 offset fix] Clamp delete-X
          // position to chart bounds AND apply parent offset.
          var midX = Math.max(15, Math.min(chartW - 15, (x1 + x2) / 2));
          var topY = Math.max(15, Math.min(chartH - 15, Math.min(y1, y2) - 12));
          l.delBtn.style.left = (oxL + midX) + 'px';
          l.delBtn.style.top = (oyT + topY) + 'px';
          // [Pack G] Settings ⚙ button to the RIGHT of the X (+24px).
          // Clamped so it stays inside chart bounds when X is at the
          // right edge.
          if (l.cfgBtn) {
            var cfgX = Math.max(15, Math.min(chartW - 15, midX + 24));
            l.cfgBtn.style.left = (oxL + cfgX) + 'px';
            l.cfgBtn.style.top = (oyT + topY) + 'px';
          }
        }
      }
    });
  }

  // ── Drag ──
  function _startDrag(e: any, lineId: any, handleIdx: any) {
    _dragging = { lineId:lineId, idx:handleIdx, _touch:!!e._touch };
    _selectLine(lineId);
  }
  function _onDragMove(clientX: any, clientY: any) {
    if (!_dragging) return;
    var line = _lines.find(function(l: any) { return l.id === _dragging.lineId; });
    if (!line) { _dragging = null; return; }
    var price = _priceAtY(clientY);
    if (!price) return;

    if (line.type === 'hline') {
      line.price = price;
      try { line.lwcRef.applyOptions({ price:price, title:price.toFixed(2) }); } catch(_) {}
    }
    if (line.type === 'tline') {
      var time = _timeAtX(clientX);
      if (time) {
        if (_dragging.idx === 0) { line.p1.price = price; line.p1.time = time; }
        else { line.p2.price = price; line.p2.time = time; }
        _updateTLineSeries(line);
      }
    }
  }
  function _endDrag() { if (_dragging) { _save(); _dragging = null; } }

  document.addEventListener('mousemove', function(e: any) { if (_dragging && !_dragging._touch) _onDragMove(e.clientX, e.clientY); });
  document.addEventListener('mouseup', function() { if (_dragging && !_dragging._touch) _endDrag(); });
  document.addEventListener('touchmove', function(e: any) {
    if (_dragging && _dragging._touch && e.touches[0]) { _onDragMove(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }
  }, { passive: false });
  document.addEventListener('touchend', function() { if (_dragging && _dragging._touch) _endDrag(); });

  // ── Chart interaction ──
  function _isOnChart(e: any) {
    var mc = _mc(); if (!mc) return false;
    var r = mc.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  function _handleChartAction(clientX: any, clientY: any) {
    if (_dragging) return;
    var price = _priceAtY(clientY);

    if (!_activeTool) {
      if (!price) { _deselectAll(); return; }
      var nearest: any = null, nd = Infinity;
      _lines.forEach(function(l: any) {
        var d: any;
        if (l.type === 'hline') d = Math.abs(l.price - price);
        if (l.type === 'tline') d = Math.min(Math.abs(l.p1.price - price), Math.abs(l.p2.price - price));
        if (d < price * 0.005 && d < nd) { nd = d; nearest = l; }
      });
      if (nearest) _selectLine(nearest.id); else _deselectAll();
      return;
    }

    if (!price) { _toast('Move over chart'); return; }

    if (_activeTool === 'hline') {
      _addHLine(price); _deactivate(); _toast('H-Line @ ' + price.toFixed(2)); return;
    }
    if (_activeTool === 'tline') {
      var time = _timeAtX(clientX);
      if (!time) { _toast('Click on chart area'); return; }
      if (_tlineStep === 0) {
        _tlinePendingP1 = { time:time, price:price };
        _tlineStep = 1;
        // [Pack F] Start the dashed preview line that follows the cursor
        // until the second click confirms placement.
        _startPreview(_tlinePendingP1);
        _toast('Click second point (Esc to cancel)'); return;
      }
      if (_tlineStep === 1 && _tlinePendingP1) {
        _clearPreview();
        _addTLine(_tlinePendingP1, { time:time, price:price });
        _tlinePendingP1 = null; _tlineStep = 0; _deactivate(); _toast('Trendline placed'); return;
      }
    }
    if (_activeTool === 'eraser') {
      if (!price) return;
      var cl: any = null, cd = Infinity, pp = price * 0.005;
      _lines.forEach(function(l: any) {
        var d: any;
        if (l.type === 'hline') d = Math.abs(l.price - price);
        if (l.type === 'tline') d = Math.min(Math.abs(l.p1.price - price), Math.abs(l.p2.price - price));
        if (d < pp && d < cd) { cd = d; cl = l; }
      });
      if (cl) _removeLine(cl.id); else _toast('No line nearby');
      _deactivate();
    }
  }

  // Desktop click
  document.addEventListener('click', function(e: any) {
    // [Pack G.1] Suppress the chart action that would otherwise fire
    // immediately after the settings panel was closed via outside
    // click — the user wants the deselect to stick (X + ⚙ go away,
    // only the line remains).
    if (_suppressNextChartAction) { _suppressNextChartAction = false; return; }
    // [Pack G.1] Also bail on clicks inside the settings popover and
    // on the ⚙ button itself so picking a swatch / width / style
    // doesn't trigger nearest-line re-selection.
    if (e.target && (e.target.tagName === 'BUTTON' || (e.target.closest && e.target.closest('.dt-btn,.dt-del,.dt-handle,.dt-cfg,.dt-cfg-panel,.ovrb,.indb,.ctrls,.ztf-wrap')))) return;
    if (!_isOnChart(e)) return;
    _handleChartAction(e.clientX, e.clientY);
  }, true);

  // Mobile tap
  var _tapStart: any = null;
  // [Pack G.1 mobile] Tap-and-drag flow for trendline. On mobile there
  // is no cursor-following preview between two taps — the operator
  // can't see where the second point will land. So when the trendline
  // tool is active, the FIRST touchstart on the chart sets p1 and
  // starts the preview; the preview follows the finger via touchmove
  // (handled by _previewMoveHandler with the touch fix); touchend
  // commits p2 at the release point. Single gesture = one trendline,
  // exactly like TradingView mobile.
  var _tlineTouchActive = false;
  document.addEventListener('touchstart', function(e: any) {
    if (!e.touches || !e.touches.length) return;
    var t0 = e.touches[0];
    _tapStart = { x: t0.clientX, y: t0.clientY, t: Date.now() };
    if (t0.target && t0.target.closest && t0.target.closest('.dt-handle,.dt-del,.dt-cfg,.dt-cfg-panel')) return;

    if (_activeTool === 'tline' && _tlineStep === 0 && _isOnChart({ clientX: t0.clientX, clientY: t0.clientY })) {
      var price = _priceAtY(t0.clientY);
      var time = _timeAtX(t0.clientX);
      if (price && time) {
        _tlinePendingP1 = { time: time, price: price };
        _tlineStep = 1;
        _tlineTouchActive = true;
        _startPreview(_tlinePendingP1);
      }
    }
  }, { passive: true });
  document.addEventListener('touchend', function(e: any) {
    // [Pack G.1] Trendline drag-to-draw release: place p2 at the
    // release point if the finger moved >8px. If the user merely
    // tapped (no drag), keep p1 + preview and fall through to the
    // tap-to-place-p2 flow on the next tap (legacy 2-tap mode).
    if (_tlineTouchActive) {
      var touch = (e.changedTouches && e.changedTouches[0]);
      var moved = (touch && _tapStart) ? (Math.abs(touch.clientX - _tapStart.x) + Math.abs(touch.clientY - _tapStart.y)) : 0;
      if (touch && moved > 8 && _tlinePendingP1) {
        var price2 = _priceAtY(touch.clientY);
        var time2 = _timeAtX(touch.clientX);
        if (price2 && time2) {
          _clearPreview();
          _addTLine(_tlinePendingP1, { time: time2, price: price2 });
          _tlinePendingP1 = null; _tlineStep = 0; _tlineTouchActive = false;
          _deactivate();
          _toast('Trendline placed');
          _tapStart = null;
          return;
        }
      }
      // No drag (or coords invalid) — leave preview in place, switch
      // to 2-tap mode for this gesture: next tap places p2.
      _tlineTouchActive = false;
      _tapStart = null;
      _toast('Tap second point (Esc to cancel)');
      return;
    }

    if (!_tapStart) return;
    if (Date.now() - _tapStart.t > 300) { _tapStart = null; return; }
    var touch = (e.changedTouches && e.changedTouches[0]) || _tapStart;
    if (Math.abs(touch.clientX - _tapStart.x) > 10 || Math.abs(touch.clientY - _tapStart.y) > 10) { _tapStart = null; return; }
    if (touch.target && touch.target.closest && touch.target.closest('.dt-handle,.dt-del,.dt-cfg,.dt-cfg-panel')) { _tapStart = null; return; }
    if (!_isOnChart({ clientX:touch.clientX, clientY:touch.clientY })) { _tapStart = null; return; }
    _handleChartAction(touch.clientX, touch.clientY);
    _tapStart = null;
  }, { passive: true });

  // Keyboard
  document.addEventListener('keydown', function(e: any) {
    if (e.key === 'Escape') {
      if (_activeTool) { _deactivate(); e.stopPropagation(); }
      else if (_selectedId) _deselectAll();
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && _selectedId) {
      if (!e.target || !e.target.closest || !e.target.closest('input,textarea,select')) _removeLine(_selectedId);
    }
  }, true);

  // ── Activate / Deactivate ──
  function _activate(tool: any) {
    if (_activeTool === tool) { _deactivate(); return; }
    if (!_series()) { _toast('Chart not ready'); return; }
    _activeTool = tool; _tlineStep = 0; _tlinePendingP1 = null;
    _clearPreview();
    _deselectAll(); _updateBtnStates();
    var mc = _mc(); if (mc) mc.style.cursor = 'crosshair';
    if (tool === 'hline') _toast('Click to place line');
    else if (tool === 'tline') _toast('Click first point');
    else if (tool === 'eraser') _toast('Click near a line');
  }
  function _deactivate() {
    _activeTool = null; _tlineStep = 0; _tlinePendingP1 = null;
    _clearPreview();
    _updateBtnStates();
    var mc = _mc(); if (mc) mc.style.cursor = '';
  }

  // [Pack F] Create + maintain preview LineSeries during the trendline
  // drawing flow. On first click, _startPreview installs a mousemove
  // handler that updates a dashed semi-transparent line between p1 and
  // the current cursor position. _clearPreview tears it down on second
  // click, on cancel (Escape), on tool change, or on chart unmount.
  function _startPreview(p1: any) {
    var c = _chart(); if (!c) return;
    try {
      _previewSeries = c.addLineSeries({
        color: '#88ccffaa',     // semi-transparent cyan — visible but doesn't compete with real lines
        lineWidth: 2,
        lineStyle: 2,           // dashed (lightweight-charts: 0=solid 1=dotted 2=dashed 3=large 4=sparse)
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      _previewSeries.setData([
        { time: p1.time, value: p1.price },
        { time: p1.time, value: p1.price },
      ]);
    } catch (_) { _previewSeries = null; return; }
    _previewMoveHandler = function (e: any) {
      if (!_previewSeries || !_tlinePendingP1) return;
      // [Pack G.1] Normalize coords — touchmove events use
      // e.touches[0].clientX/Y (e.clientX is undefined). Without this
      // the preview never moved on mobile, so the operator couldn't
      // see where the line would land.
      var clientX = e.clientX, clientY = e.clientY;
      if (e.touches && e.touches[0]) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
      if (clientX == null || clientY == null) return;
      // Only update when finger / mouse is over the chart area
      var mc = _mc(); if (!mc) return;
      var r = mc.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return;
      var t = _timeAtX(clientX); var p = _priceAtY(clientY);
      if (t == null || p == null) return;
      try {
        var t1 = _tlinePendingP1.time, t2 = t;
        var v1 = _tlinePendingP1.price, v2 = p;
        // lightweight-charts requires data sorted by time ascending
        var data = (t1 <= t2)
          ? [{ time: t1, value: v1 }, { time: t2, value: v2 }]
          : [{ time: t2, value: v2 }, { time: t1, value: v1 }];
        _previewSeries.setData(data);
      } catch (_) { /* ignore transient series state */ }
    };
    document.addEventListener('mousemove', _previewMoveHandler, true);
    document.addEventListener('touchmove', _previewMoveHandler as any, { passive: true } as any);
  }

  function _clearPreview() {
    if (_previewMoveHandler) {
      try { document.removeEventListener('mousemove', _previewMoveHandler, true); } catch (_) { /* */ }
      try { document.removeEventListener('touchmove', _previewMoveHandler as any); } catch (_) { /* */ }
      _previewMoveHandler = null;
    }
    if (_previewSeries) {
      try { var c = _chart(); if (c) c.removeSeries(_previewSeries); } catch (_) { /* */ }
      _previewSeries = null;
    }
  }

  // [Pack F] Escape key cancels mid-trendline — TradingView parity.
  document.addEventListener('keydown', function (e: KeyboardEvent) {
    if (e.key === 'Escape' && _activeTool === 'tline' && _tlineStep === 1) {
      _tlineStep = 0; _tlinePendingP1 = null;
      _clearPreview();
      _deactivate();
      _toast('Trendline cancelled');
    }
  });
  function _updateBtnStates() {
    ['dt-hline','dt-tline','dt-eraser'].forEach(function(id: any) {
      var b = document.getElementById(id); if (b) b.classList.toggle('on', _activeTool === id.replace('dt-',''));
    });
  }
  function _clearAll() { _lines.slice().forEach(function(l: any) { _removeLine(l.id); }); _toast('All cleared'); }
  function _toggleVisibility() {
    _visible = !_visible;
    // [Pack E] Persist new visibility state to localStorage.
    try { localStorage.setItem(VIS_KEY, _visible ? '1' : '0'); } catch (_) { /* */ }
    _lines.forEach(function(l: any) {
      if (l.lwcRef) try { l.lwcRef.applyOptions({ lineVisible:_visible, axisLabelVisible:_visible }); } catch(_) {}
      if (l.lwcSeries) try { l.lwcSeries.applyOptions({ visible:_visible }); } catch(_) {}
      l.handles.forEach(function(h: any) { h.style.display = (_visible && l.selected) ? 'block' : 'none'; });
      if (l.delBtn) l.delBtn.style.display = (_visible && l.selected) ? 'block' : 'none';
      // [Pack G] Settings ⚙ also follows visibility state.
      if (l.cfgBtn) l.cfgBtn.style.display = (_visible && l.selected) ? 'block' : 'none';
    });
    if (!_visible) _closeSettingsPanel();
    var b = document.getElementById('dt-eye'); if (b) b.classList.toggle('on', _visible);
    _toast(_visible ? 'Visible' : 'Hidden');
  }

  w.drawToolActivate = _activate;
  w.drawToolClearAll = _clearAll;
  w.drawToolToggleVis = _toggleVisibility;

  // ── Init ──
  var _initCheck = setInterval(function() {
    if (!_chart() || !_series()) return;
    clearInterval(_initCheck);
    _ensureHandleContainer();

    // Load saved drawings
    try {
      var d = JSON.parse(localStorage.getItem(LS_KEY) as any);
      if (d && d.lines) {
        _nextId = d.nextId || 1;
        d.lines.forEach(function(l: any) {
          // [Pack G] Restore per-line width + style alongside color.
          if (l.type === 'hline') _addHLine(l.price, l.color, l.id, l.width, l.style);
          if (l.type === 'tline' && l.p1 && l.p2) _addTLine(l.p1, l.p2, l.color, l.id, l.width, l.style);
        });
        _deselectAll();
        // [Pack E] If _visible was restored as false from localStorage,
        // apply the hide state to all just-loaded lines (they were
        // created with visible=true defaults, so we must mirror the
        // hide state without flipping _visible itself).
        if (!_visible) {
          _lines.forEach(function(l: any) {
            if (l.lwcRef) try { l.lwcRef.applyOptions({ lineVisible:false, axisLabelVisible:false }); } catch(_) {}
            if (l.lwcSeries) try { l.lwcSeries.applyOptions({ visible:false }); } catch(_) {}
            l.handles.forEach(function(h: any) { h.style.display = 'none'; });
            if (l.delBtn) l.delBtn.style.display = 'none';
            if (l.cfgBtn) l.cfgBtn.style.display = 'none';
          });
          var b = document.getElementById('dt-eye'); if (b) b.classList.add('on');
        }
      }
    } catch(_) {}

    // Handle position sync — RAF loop for selected line handles
    function _syncLoop() {
      if (_selectedId) _updateHandles();
      requestAnimationFrame(_syncLoop);
    }
    requestAnimationFrame(_syncLoop);

    console.log('[draw] v4.0 READY — native LWC series, handles follow chart');
  }, 300);
  setTimeout(function() { clearInterval(_initCheck); }, 25000);
})();
