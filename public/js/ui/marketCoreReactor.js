// ═══════════════════════════════════════════════════════════════
// MARKET CORE REACTOR + SIGNAL RADAR — Canvas Visualization
// Replaces Living Neural Core V6 SVG Organism
// REAL DATA ONLY — no placeholders, no random values
// ═══════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ── State ──────────────────────────────────────────────
    var _inited = false;
    var _rafId = null;
    var _lastFrame = 0;

    // Canvas refs
    var _reactorCanvas, _reactorCtx;
    var _radarCanvas, _radarCtx;

    // Target values (set by update()) — 0→1 normalized
    var _target = { trend: 0, flow: 0, volume: 0, volatility: 0, momentum: 0, structure: 0 };
    // Display values (lerped each frame toward target)
    var _display = { trend: 0, flow: 0, volume: 0, volatility: 0, momentum: 0, structure: 0 };

    // Auxiliary display state
    var _gatesOpen = 0;
    var _gatesTotal = 7;
    var _direction = 'NEUTRAL'; // 'LONG' | 'SHORT' | 'NEUTRAL'
    var _confidence = 0;        // 0-100
    var _displayConf = 0;       // smoothed for glow
    var _entryScore = 0;        // 0-100
    var _displayEntry = 0;      // smoothed for pulse

    // Radar sweep state
    var _sweepAngle = 0;

    // Axis definitions (clockwise from top)
    var AXES = ['trend', 'flow', 'volume', 'volatility', 'momentum', 'structure'];
    var AXIS_LABELS = ['TREND', 'FLOW', 'VOL', 'VOLAT', 'MOM', 'STRUCT'];
    var AXIS_ANGLES = []; // computed on init (6 axes, 60° apart, starting from top)
    for (var i = 0; i < 6; i++) {
        AXIS_ANGLES.push(-Math.PI / 2 + (Math.PI * 2 / 6) * i);
    }

    // Colors
    var COL_BG = '#060e1a';
    var COL_GRID = 'rgba(80,180,255,0.08)';
    var COL_GRID_LINE = 'rgba(80,180,255,0.12)';
    var COL_AXIS = 'rgba(100,200,255,0.25)';
    var COL_LABEL = 'rgba(160,210,240,0.70)';
    var COL_LONG = { fill: 'rgba(57,255,20,0.18)', stroke: '#39ff14', glow: 'rgba(57,255,20,0.5)', core: '#39ff14' };
    var COL_SHORT = { fill: 'rgba(255,51,85,0.18)', stroke: '#ff3355', glow: 'rgba(255,51,85,0.5)', core: '#ff3355' };
    var COL_NEUTRAL = { fill: 'rgba(240,192,64,0.14)', stroke: '#f0c040', glow: 'rgba(240,192,64,0.4)', core: '#f0c040' };

    // ── Helpers ────────────────────────────────────────────
    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

    function getColors() {
        if (_direction === 'LONG') return COL_LONG;
        if (_direction === 'SHORT') return COL_SHORT;
        return COL_NEUTRAL;
    }

    // ── Initialization ─────────────────────────────────────
    function init() {
        _reactorCanvas = document.getElementById('mcrReactorCanvas');
        _radarCanvas = document.getElementById('mcrRadarCanvas');
        if (!_reactorCanvas || !_radarCanvas) return;

        _reactorCtx = _reactorCanvas.getContext('2d');
        _radarCtx = _radarCanvas.getContext('2d');

        _handleResize();
        window.addEventListener('resize', _debounceResize);

        if (!_inited) {
            _inited = true;
            _lastFrame = performance.now();
            _rafId = requestAnimationFrame(_tick);
        }
    }

    var _resizeTimer = 0;
    function _debounceResize() {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(_handleResize, 150);
    }

    function _handleResize() {
        if (!_reactorCanvas || !_radarCanvas) return;
        var rP = _reactorCanvas.parentElement;
        var rdP = _radarCanvas.parentElement;
        if (!rP || !rdP) return;

        var dpr = window.devicePixelRatio || 1;

        // Reactor
        var rW = rP.clientWidth;
        var rH = rP.clientHeight;
        _reactorCanvas.width = rW * dpr;
        _reactorCanvas.height = rH * dpr;
        _reactorCanvas.style.width = rW + 'px';
        _reactorCanvas.style.height = rH + 'px';
        _reactorCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Radar
        var rdW = rdP.clientWidth;
        var rdH = rdP.clientHeight;
        _radarCanvas.width = rdW * dpr;
        _radarCanvas.height = rdH * dpr;
        _radarCanvas.style.width = rdW + 'px';
        _radarCanvas.style.height = rdH + 'px';
        _radarCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // ── Data Update (called from brain.js every 5s) ───────
    function update(data) {
        if (!data) return;
        // Axes (0→1)
        for (var i = 0; i < AXES.length; i++) {
            var k = AXES[i];
            if (data[k] != null) _target[k] = clamp(+data[k], 0, 1);
        }
        // Gates
        if (data.gatesOpen != null) _gatesOpen = data.gatesOpen | 0;
        if (data.gatesTotal != null) _gatesTotal = data.gatesTotal | 0;
        // Direction
        if (data.direction) _direction = data.direction;
        // Confidence (raw — smoothed in render)
        if (data.confidence != null) _confidence = clamp(+data.confidence, 0, 100);
        // Entry score
        if (data.entryScore != null) _entryScore = clamp(+data.entryScore, 0, 100);
    }

    // ── RAF Tick ───────────────────────────────────────────
    function _tick(ts) {
        if (document.hidden) { _rafId = requestAnimationFrame(_tick); return; }
        var dt = ts - _lastFrame;
        _lastFrame = ts;

        // Lerp display values toward targets (smooth 60fps animation)
        var alpha = clamp(dt / 180, 0.02, 0.18); // ~0.08 at 60fps
        for (var i = 0; i < AXES.length; i++) {
            var k = AXES[i];
            _display[k] = lerp(_display[k], _target[k], alpha);
        }
        // Smooth confidence & entry for glow/pulse
        _displayConf = lerp(_displayConf, _confidence, alpha * 0.6);
        _displayEntry = lerp(_displayEntry, _entryScore, alpha * 0.6);

        // Sweep angle (speed tied to confidence)
        var sweepSpeed = 0.04 + (_displayConf / 100) * 0.10; // deg/ms
        _sweepAngle = (_sweepAngle + dt * sweepSpeed) % 360;

        // Draw
        _drawReactor(dt);
        _drawRadar(dt);

        _rafId = requestAnimationFrame(_tick);
    }

    // ══════════════════════════════════════════════════════
    // REACTOR DRAW
    // ══════════════════════════════════════════════════════
    function _drawReactor(dt) {
        var ctx = _reactorCtx;
        if (!ctx) return;
        var W = _reactorCanvas.clientWidth;
        var H = _reactorCanvas.clientHeight;
        if (!W || !H) return;

        ctx.clearRect(0, 0, W, H);

        var cx = W / 2;
        var cy = H / 2;
        var maxR = Math.min(W, H) * 0.38;
        var cols = getColors();

        // ── Background grid rings ──
        ctx.strokeStyle = COL_GRID;
        ctx.lineWidth = 0.5;
        for (var ring = 1; ring <= 5; ring++) {
            var r = maxR * ring / 5;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
        }

        // ── Axis lines ──
        ctx.strokeStyle = COL_AXIS;
        ctx.lineWidth = 0.8;
        for (var i = 0; i < 6; i++) {
            var angle = AXIS_ANGLES[i];
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
            ctx.stroke();
        }

        // ── Data polygon ──
        ctx.beginPath();
        for (var i = 0; i < 6; i++) {
            var k = AXES[i];
            var val = _display[k];
            var angle = AXIS_ANGLES[i];
            var rV = maxR * Math.max(val, 0.04); // min 4% so shape is always visible
            var px = cx + Math.cos(angle) * rV;
            var py = cy + Math.sin(angle) * rV;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();

        // Fill with glow
        ctx.fillStyle = cols.fill;
        ctx.fill();
        ctx.strokeStyle = cols.stroke;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = cols.glow;
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // ── Axis vertex dots ──
        for (var i = 0; i < 6; i++) {
            var k = AXES[i];
            var val = _display[k];
            var angle = AXIS_ANGLES[i];
            var rV = maxR * Math.max(val, 0.04);
            var px = cx + Math.cos(angle) * rV;
            var py = cy + Math.sin(angle) * rV;

            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fillStyle = cols.stroke;
            ctx.shadowColor = cols.glow;
            ctx.shadowBlur = 8;
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // ── Axis labels ──
        ctx.font = '600 9px "Orbitron","Share Tech Mono",monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (var i = 0; i < 6; i++) {
            var angle = AXIS_ANGLES[i];
            var lR = maxR + 18;
            var lx = cx + Math.cos(angle) * lR;
            var ly = cy + Math.sin(angle) * lR;

            // Value percentage next to label
            var pct = Math.round(_display[AXES[i]] * 100);
            ctx.fillStyle = COL_LABEL;
            ctx.fillText(AXIS_LABELS[i], lx, ly - 6);
            ctx.fillStyle = cols.stroke;
            ctx.font = '700 10px "Orbitron","Share Tech Mono",monospace';
            ctx.fillText(pct + '%', lx, ly + 7);
            ctx.font = '600 9px "Orbitron","Share Tech Mono",monospace';
        }

        // ── Core center glow ──
        var coreIntensity = _displayConf / 100; // 0→1
        var pulsePhase = (Math.sin(performance.now() / (800 - _displayEntry * 4)) + 1) / 2; // 0→1 pulsing
        var coreAlpha = 0.15 + coreIntensity * 0.55 + pulsePhase * 0.12;
        var coreR = 14 + coreIntensity * 18 + pulsePhase * 4;

        // Outer halo
        var haloGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.2);
        haloGrad.addColorStop(0, cols.core.replace(')', ',' + (coreAlpha * 0.3) + ')').replace('rgb', 'rgba'));
        haloGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath();
        ctx.arc(cx, cy, coreR * 2.2, 0, Math.PI * 2);
        ctx.fillStyle = haloGrad;
        ctx.fill();

        // Inner core
        var innerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
        innerGrad.addColorStop(0, 'rgba(255,250,230,' + (coreAlpha * 0.9) + ')');
        innerGrad.addColorStop(0.4, cols.glow.replace(/[\d.]+\)$/, (coreAlpha * 0.7) + ')'));
        innerGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath();
        ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
        ctx.fillStyle = innerGrad;
        ctx.fill();

        // Core ring
        ctx.beginPath();
        ctx.arc(cx, cy, coreR * 0.6, 0, Math.PI * 2);
        ctx.strokeStyle = cols.stroke;
        ctx.globalAlpha = 0.3 + coreAlpha * 0.5;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // ── GATES badge (top-left) ──
        ctx.font = '700 11px "Orbitron","Share Tech Mono",monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = _gatesOpen >= _gatesTotal ? '#39ff14' : _gatesOpen >= _gatesTotal - 2 ? '#f0c040' : '#ff3355';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 6;
        ctx.fillText('GATES ' + _gatesOpen + '/' + _gatesTotal, cx - maxR, cy - maxR - 28);
        ctx.shadowBlur = 0;

        // ── Direction MODE badge (bottom-left) ──
        var modeLabel = _direction === 'LONG' ? 'LONG MODE' : _direction === 'SHORT' ? 'SHORT MODE' : 'SCANNING';
        var modeColor = _direction === 'LONG' ? '#39ff14' : _direction === 'SHORT' ? '#ff3355' : '#f0c040';
        ctx.font = '700 12px "Orbitron","Share Tech Mono",monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = modeColor;
        ctx.shadowColor = modeColor;
        ctx.shadowBlur = 8;
        ctx.fillText(modeLabel, cx - maxR, cy + maxR + 30);
        ctx.shadowBlur = 0;

        // Sub-label: confluence score (bottom-right, same line as mode)
        ctx.font = '600 9px "Orbitron","Share Tech Mono",monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(180,220,240,0.78)';
        ctx.fillText('CONFLUENCE ' + Math.round(_displayConf), cx + maxR, cy + maxR + 30);
    }

    // ══════════════════════════════════════════════════════
    // SIGNAL RADAR DRAW
    // ══════════════════════════════════════════════════════
    function _drawRadar(dt) {
        var ctx = _radarCtx;
        if (!ctx) return;
        var W = _radarCanvas.clientWidth;
        var H = _radarCanvas.clientHeight;
        if (!W || !H) return;

        ctx.clearRect(0, 0, W, H);

        var cx = W / 2;
        var cy = H / 2;
        var maxR = Math.min(W, H) * 0.40;
        var cols = getColors();

        // ── Grid rings ──
        ctx.strokeStyle = COL_GRID;
        ctx.lineWidth = 0.5;
        for (var ring = 1; ring <= 4; ring++) {
            ctx.beginPath();
            ctx.arc(cx, cy, maxR * ring / 4, 0, Math.PI * 2);
            ctx.stroke();
        }

        // ── Cross lines ──
        ctx.strokeStyle = COL_GRID_LINE;
        ctx.lineWidth = 0.5;
        for (var a = 0; a < 4; a++) {
            var angle = (Math.PI / 4) * a;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
            ctx.lineTo(cx - Math.cos(angle) * maxR, cy - Math.sin(angle) * maxR);
            ctx.stroke();
        }

        // ── Sweep beam ──
        var sweepRad = _sweepAngle * Math.PI / 180;
        var confNorm = _displayConf / 100;
        var beamAlpha = 0.15 + confNorm * 0.50;
        var beamSpread = 0.35; // radians

        var sweepGrad = ctx.createConicGradient(sweepRad - beamSpread, cx, cy);
        sweepGrad.addColorStop(0, 'rgba(0,0,0,0)');
        sweepGrad.addColorStop(0.7, cols.glow.replace(/[\d.]+\)$/, (beamAlpha * 0.4) + ')'));
        sweepGrad.addColorStop(1, cols.glow.replace(/[\d.]+\)$/, beamAlpha + ')'));

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, maxR, sweepRad - beamSpread, sweepRad);
        ctx.closePath();
        ctx.fillStyle = sweepGrad;
        ctx.fill();

        // Sweep leading edge line
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(sweepRad) * maxR, cy + Math.sin(sweepRad) * maxR);
        ctx.strokeStyle = cols.stroke;
        ctx.globalAlpha = beamAlpha;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // ── Center dot ──
        var centerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 8 + confNorm * 6);
        centerGrad.addColorStop(0, cols.stroke);
        centerGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath();
        ctx.arc(cx, cy, 8 + confNorm * 6, 0, Math.PI * 2);
        ctx.fillStyle = centerGrad;
        ctx.fill();

        // ── Edge ring glow ──
        ctx.beginPath();
        ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
        ctx.strokeStyle = cols.stroke;
        ctx.globalAlpha = 0.2 + confNorm * 0.3;
        ctx.lineWidth = 1;
        ctx.shadowColor = cols.glow;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;

        // ── Direction label (top) ──
        var dirLabel = _direction === 'LONG' ? 'LONG' : _direction === 'SHORT' ? 'SHORT' : 'SCAN';
        var dirColor = _direction === 'LONG' ? '#39ff14' : _direction === 'SHORT' ? '#ff3355' : '#f0c040';
        ctx.font = '700 13px "Orbitron","Share Tech Mono",monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = dirColor;
        ctx.shadowColor = dirColor;
        ctx.shadowBlur = 6;
        ctx.fillText(dirLabel, cx, cy - maxR - 14);
        ctx.shadowBlur = 0;

        // ── Confidence bar (bottom) ──
        var barW = maxR * 1.4;
        var barH = 6;
        var barX = cx - barW / 2;
        var barY = cy + maxR + 4;

        // Separator line above bar
        ctx.strokeStyle = 'rgba(80,160,255,0.30)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(barX, barY - 2);
        ctx.lineTo(barX + barW, barY - 2);
        ctx.stroke();

        // Background
        ctx.fillStyle = 'rgba(60,100,140,0.55)';
        _roundRect(ctx, barX, barY, barW, barH, 3);
        ctx.fill();

        // Fill
        var fillW = barW * (confNorm);
        ctx.fillStyle = dirColor;
        ctx.shadowColor = dirColor;
        ctx.shadowBlur = 6;
        _roundRect(ctx, barX, barY, fillW, barH, 3);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Confidence text
        ctx.font = '700 11px "Orbitron","Share Tech Mono",monospace';
        ctx.fillStyle = 'rgba(200,230,250,0.85)';
        ctx.fillText(Math.round(_displayConf) + '%  CONFIDENCE', cx, barY + barH + 14);

        // ── "SIGNAL RADAR" title ──
        ctx.font = '600 8px "Orbitron","Share Tech Mono",monospace';
        ctx.fillStyle = 'rgba(140,190,220,0.50)';
        ctx.fillText('SIGNAL RADAR', cx, barY + barH + 28);
    }

    // Rounded rect helper
    function _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    // ── Destroy ────────────────────────────────────────────
    function destroy() {
        if (_rafId) cancelAnimationFrame(_rafId);
        _rafId = null;
        _inited = false;
        window.removeEventListener('resize', _debounceResize);
    }

    // ── Public API ─────────────────────────────────────────
    window.MarketCoreReactor = {
        init: init,
        update: update,
        destroy: destroy
    };

})();
