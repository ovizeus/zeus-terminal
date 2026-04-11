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
  var _lines: any[] = [];
  var _activeTool: any = null;
  var _nextId = 1;
  var _visible = true;
  var _dragging: any = null;
  var _tlineStep = 0, _tlinePendingP1: any = null;
  var _selectedId: any = null;
  var _handleContainer: any = null;

  var COLORS = ['#f0c040','#00d97a','#ff3355','#00b8d4','#aa44ff','#ff8822','#ffffff'];
  var _colorIdx = 0;
  function _nextColor() { var c = COLORS[_colorIdx % COLORS.length]; _colorIdx++; return c; }
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
        var o: any = { id:l.id, type:l.type, color:l.color };
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

  // ── Add H-Line (native LWC price line — follows chart automatically) ──
  function _addHLine(price: any, color?: any, existingId?: any) {
    var s = _series(); if (!s) return;
    color = color || _nextColor();
    var id = existingId || _nextId++;
    var ref = s.createPriceLine({ price:price, color:color, lineWidth:1, lineStyle:0, axisLabelVisible:true, title:price.toFixed(2) });
    _ensureHandleContainer();
    var h = _createHandle(id, 0, color);
    var del = _createDeleteBtn(id);
    if (_handleContainer) { _handleContainer.appendChild(h); _handleContainer.appendChild(del); }
    _lines.push({ id:id, type:'hline', price:price, color:color, lwcRef:ref, handles:[h], delBtn:del, selected:false });
    _selectLine(id);
    if (!existingId) _save();
  }

  // ── Add Trendline (native LWC LineSeries — follows chart automatically) ──
  function _addTLine(p1: any, p2: any, color?: any, existingId?: any) {
    var c = _chart(); if (!c) return;
    color = color || _nextColor();
    var id = existingId || _nextId++;

    // Create a LineSeries on the chart for this trendline
    var lineSeries = c.addLineSeries({
      color: color,
      lineWidth: 2,
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
    if (_handleContainer) { _handleContainer.appendChild(h1); _handleContainer.appendChild(h2); _handleContainer.appendChild(del); }

    _lines.push({ id:id, type:'tline', p1:{time:p1.time, price:p1.price}, p2:{time:p2.time, price:p2.price}, color:color, lwcSeries:lineSeries, handles:[h1,h2], delBtn:del, selected:false });
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
      // Highlight selected trendline
      if (l.lwcSeries) try { l.lwcSeries.applyOptions({ lineWidth: l.selected ? 3 : 2 }); } catch(_) {}
    });
  }
  function _deselectAll() { _selectedId = null; _selectLine(-1); }

  // ── Update handle positions (runs every frame via RAF) ──
  function _updateHandles() {
    var mc = _mc(); if (!mc) return;
    var chartW = mc.getBoundingClientRect().width;
    _lines.forEach(function(l: any) {
      if (!l.selected) return;
      if (l.type === 'hline') {
        var y = _priceToY(l.price);
        if (y != null) {
          l.handles[0].style.left = (chartW - 30) + 'px';
          l.handles[0].style.top = y + 'px';
          if (l.delBtn) { l.delBtn.style.left = (chartW - 55) + 'px'; l.delBtn.style.top = y + 'px'; }
        }
      }
      if (l.type === 'tline') {
        var x1 = _timeToX(l.p1.time), y1 = _priceToY(l.p1.price);
        var x2 = _timeToX(l.p2.time), y2 = _priceToY(l.p2.price);
        if (x1 != null && y1 != null) { l.handles[0].style.left = x1+'px'; l.handles[0].style.top = y1+'px'; }
        if (x2 != null && y2 != null) { l.handles[1].style.left = x2+'px'; l.handles[1].style.top = y2+'px'; }
        if (l.delBtn && x1 != null && y1 != null && x2 != null && y2 != null) {
          l.delBtn.style.left = ((x1+x2)/2) + 'px'; l.delBtn.style.top = Math.min(y1,y2) - 15 + 'px';
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
        _tlineStep = 1; _toast('Click second point'); return;
      }
      if (_tlineStep === 1 && _tlinePendingP1) {
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
    if (e.target && (e.target.tagName === 'BUTTON' || (e.target.closest && e.target.closest('.dt-btn,.dt-del,.dt-handle,.ovrb,.indb,.ctrls,.ztf-wrap')))) return;
    if (!_isOnChart(e)) return;
    _handleChartAction(e.clientX, e.clientY);
  }, true);

  // Mobile tap
  var _tapStart: any = null;
  document.addEventListener('touchstart', function(e: any) {
    if (!e.touches || !e.touches.length) return;
    _tapStart = { x:e.touches[0].clientX, y:e.touches[0].clientY, t:Date.now() };
  }, { passive: true });
  document.addEventListener('touchend', function(e: any) {
    if (!_tapStart) return;
    if (Date.now() - _tapStart.t > 300) { _tapStart = null; return; }
    var touch = (e.changedTouches && e.changedTouches[0]) || _tapStart;
    if (Math.abs(touch.clientX - _tapStart.x) > 10 || Math.abs(touch.clientY - _tapStart.y) > 10) { _tapStart = null; return; }
    if (touch.target && touch.target.closest && touch.target.closest('.dt-handle,.dt-del')) { _tapStart = null; return; }
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
    _deselectAll(); _updateBtnStates();
    var mc = _mc(); if (mc) mc.style.cursor = 'crosshair';
    if (tool === 'hline') _toast('Click to place line');
    else if (tool === 'tline') _toast('Click first point');
    else if (tool === 'eraser') _toast('Click near a line');
  }
  function _deactivate() {
    _activeTool = null; _tlineStep = 0; _tlinePendingP1 = null; _updateBtnStates();
    var mc = _mc(); if (mc) mc.style.cursor = '';
  }
  function _updateBtnStates() {
    ['dt-hline','dt-tline','dt-eraser'].forEach(function(id: any) {
      var b = document.getElementById(id); if (b) b.classList.toggle('on', _activeTool === id.replace('dt-',''));
    });
  }
  function _clearAll() { _lines.slice().forEach(function(l: any) { _removeLine(l.id); }); _toast('All cleared'); }
  function _toggleVisibility() {
    _visible = !_visible;
    _lines.forEach(function(l: any) {
      if (l.lwcRef) try { l.lwcRef.applyOptions({ lineVisible:_visible, axisLabelVisible:_visible }); } catch(_) {}
      if (l.lwcSeries) try { l.lwcSeries.applyOptions({ visible:_visible }); } catch(_) {}
      l.handles.forEach(function(h: any) { h.style.display = (_visible && l.selected) ? 'block' : 'none'; });
      if (l.delBtn) l.delBtn.style.display = (_visible && l.selected) ? 'block' : 'none';
    });
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
          if (l.type === 'hline') _addHLine(l.price, l.color, l.id);
          if (l.type === 'tline' && l.p1 && l.p2) _addTLine(l.p1, l.p2, l.color, l.id);
        });
        _deselectAll();
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
