/**
 * Zeus Terminal — Market Core Reactor + Signal Radar (ported from public/js/ui/marketCoreReactor.js)
 * Canvas Visualization — replaces Living Neural Core V6 SVG Organism
 * REAL DATA ONLY — no placeholders, no random values
 */

const w = window as any

;(function () {

  // ── State ──────────────────────────────────────────────
  let _inited = false
  let _rafId: any = null
  let _lastFrame = 0

  // Canvas refs
  let _reactorCanvas: any, _reactorCtx: any
  let _radarCanvas: any, _radarCtx: any

  // Target values (set by update()) — 0→1 normalized
  // [BRAIN_RADAR_12X_UI_ONLY PAS 2] Extended with 6 new keys for the
  // optional 12-axis layout. Defaults 0; only used when the feature
  // flag is ON. The 6 existing keys behave identically to before.
  const _target: Record<string, number> = {
    trend: 0, flow: 0, volume: 0, volatility: 0, momentum: 0, structure: 0,
    delta: 0, oi: 0, fund: 0, imb: 0, sent: 0, liq: 0,
  }
  // Display values (lerped each frame toward target)
  const _display: Record<string, number> = {
    trend: 0, flow: 0, volume: 0, volatility: 0, momentum: 0, structure: 0,
    delta: 0, oi: 0, fund: 0, imb: 0, sent: 0, liq: 0,
  }

  // Auxiliary display state
  let _gatesOpen = 0
  let _gatesTotal = 7
  let _direction = 'NEUTRAL'
  let _confidence = 0
  let _displayConf = 0
  let _entryScore = 0
  let _displayEntry = 0

  // Radar sweep state
  let _sweepAngle = 0

  // Axis definitions (clockwise from top)
  const AXES = ['trend', 'flow', 'volume', 'volatility', 'momentum', 'structure']
  const AXIS_LABELS = ['TREND', 'FLOW', 'VOL', 'VOLAT', 'MOM', 'STRUCT']
  const AXIS_ANGLES: number[] = []
  for (let i = 0; i < 6; i++) {
    AXIS_ANGLES.push(-Math.PI / 2 + (Math.PI * 2 / 6) * i)
  }

  // ── [BRAIN_RADAR_12X_UI_ONLY] 12-axis layout (PAS 1 + PAS 2) ──────
  // Optional 12-axis layout, default OFF via window.BRAIN_RADAR_12X_UI_ONLY.
  // Order required by operator:
  //   TREND → DELTA → FLOW → OI → VOL → FUND → VOLAT → IMB → MOM → SENT → STRUCT → LIQ
  // Existing 6 axes (TREND/FLOW/VOL/VOLAT/MOM/STRUCT) sit at positions
  // 0, 2, 4, 6, 8, 10 — values reused from the existing `_display`
  // map (no new compute). The 6 new axes (DELTA/OI/FUND/IMB/SENT/LIQ)
  // sit at positions 1, 3, 5, 7, 9, 11.
  //
  // PAS 2 wires REAL read-only sources for the 6 new axes. Each new
  // axis uses a `_hasReal[k]` flag — when the brain feed contains a
  // finite normalized value the flag flips to true and the axis
  // renders as a normal data point at its 0..1 radius. When the
  // source is undefined / NaN / Infinity / not yet ready, the flag
  // stays false and the axis renders dimmed with `—` (skeleton).
  // No fake data, no invented values, no decision impact.
  const AXES_12 = ['trend', 'delta', 'flow', 'oi', 'volume', 'fund', 'volatility', 'imb', 'momentum', 'sent', 'structure', 'liq']
  const AXIS_LABELS_12 = ['TREND', 'DELTA', 'FLOW', 'OI', 'VOL', 'FUND', 'VOLAT', 'IMB', 'MOM', 'SENT', 'STRUCT', 'LIQ']
  const AXIS_ANGLES_12: number[] = []
  for (let i = 0; i < 12; i++) {
    AXIS_ANGLES_12.push(-Math.PI / 2 + (Math.PI * 2 / 12) * i)
  }
  const NEW_AXIS_KEYS = new Set(['delta', 'oi', 'fund', 'imb', 'sent', 'liq'])
  const ALL_AXIS_KEYS = ['trend', 'delta', 'flow', 'oi', 'volume', 'fund', 'volatility', 'imb', 'momentum', 'sent', 'structure', 'liq']

  // Per-axis "real data is bound" flag. The 6 existing axes always
  // have data, the 6 new axes start as skeleton (false) and flip to
  // true only when the brain feed delivers a finite normalized value.
  const _hasReal: Record<string, boolean> = {
    trend: true, flow: true, volume: true, volatility: true, momentum: true, structure: true,
    delta: false, oi: false, fund: false, imb: false, sent: false, liq: false,
  }

  // ── [L2] RADAR LENS ─────────────────────────────────────────────
  // Lens filter dims axes that are not primary in the current lens.
  //   HYBRID    — all 12 active (default)
  //   REAL-TIME — DELTA/FLOW/IMB/MOM/VOL/VOLAT primary
  //   SLOW      — OI/FUND/SENT/LIQ/STRUCT/VOLAT primary
  //   TIMEFRAME — MOM only (uses S.rsi[lensTf] honestly; no fake TF data)
  // NONE of these change brain decisions / scoring / confluence /
  // gates / dispatch / parity. Pure visualization read-model.
  type LensKey = 'hybrid' | 'realtime' | 'timeframe' | 'slow'
  type LensTf  = '5m' | '15m' | '1h' | '4h'
  let _lens: LensKey = 'hybrid'
  let _lensTf: LensTf = '5m'
  const LENS_PRIMARY: Record<LensKey, Set<string>> = {
    hybrid:    new Set(ALL_AXIS_KEYS),
    realtime:  new Set(['delta', 'flow', 'imb', 'momentum', 'volume', 'volatility']),
    slow:      new Set(['oi', 'fund', 'sent', 'liq', 'structure', 'volatility']),
    timeframe: new Set(['momentum']), // honest mode — only MOM has per-TF data via S.rsi[tf]
  }
  const _lensActive: Record<string, boolean> = {}
  function _recomputeLensActive() {
    const primary = LENS_PRIMARY[_lens]
    for (let i = 0; i < ALL_AXIS_KEYS.length; i++) {
      _lensActive[ALL_AXIS_KEYS[i]] = primary.has(ALL_AXIS_KEYS[i])
    }
  }
  _recomputeLensActive()

  function _isDimmedAxis(k: string) {
    // 1. New axis without real data → dim (PAS 2 skeleton behavior)
    if (NEW_AXIS_KEYS.has(k) && !_hasReal[k]) return true
    // 2. [L2] Axis not in current lens primary set → dim
    if (!_lensActive[k]) return true
    return false
  }

  // [L2 TIMEFRAME] Read-only override: when lens is TIMEFRAME, MOM
  // uses |S.rsi[lensTf] - 50| / 50 instead of _display.momentum
  // (which is computed from RSI 5m). All other axes keep their
  // existing _display value. Pure read; no write to any store.
  function _displayValueFor(k: string) {
    if (_lens === 'timeframe' && k === 'momentum') {
      try {
        const tfRsi = w.S && w.S.rsi && w.S.rsi[_lensTf]
        if (Number.isFinite(tfRsi)) return clamp(Math.abs(+tfRsi - 50) / 50, 0, 1)
      } catch (_) { /* fall through */ }
    }
    return _display[k]
  }

  // Initialize feature flag — default OFF, NO localStorage persistence.
  // Operator can toggle in DevTools console: `window.BRAIN_RADAR_12X_UI_ONLY = true`.
  if (typeof w.BRAIN_RADAR_12X_UI_ONLY === 'undefined') {
    w.BRAIN_RADAR_12X_UI_ONLY = false
  }

  // Colors
  const COL_BG = '#060e1a'
  const COL_GRID = 'rgba(80,180,255,0.08)'
  const COL_GRID_LINE = 'rgba(80,180,255,0.12)'
  const COL_AXIS = 'rgba(100,200,255,0.25)'
  const COL_LABEL = 'rgba(160,210,240,0.70)'
  const COL_LONG = { fill: 'rgba(57,255,20,0.18)', stroke: '#39ff14', glow: 'rgba(57,255,20,0.5)', core: '#39ff14' }
  const COL_SHORT = { fill: 'rgba(255,51,85,0.18)', stroke: '#ff3355', glow: 'rgba(255,51,85,0.5)', core: '#ff3355' }
  const COL_NEUTRAL = { fill: 'rgba(240,192,64,0.14)', stroke: '#f0c040', glow: 'rgba(240,192,64,0.4)', core: '#f0c040' }

  // [BRAIN_RADAR_12X_UI_ONLY] Dimmed palette for placeholder axes — clearly
  // distinct from active axes so operator can see at a glance which axes
  // have data and which are skeleton-only.
  const COL_DIM_AXIS  = 'rgba(100,140,170,0.18)'
  const COL_DIM_LABEL = 'rgba(120,150,180,0.45)'
  const COL_DIM_DOT   = 'rgba(140,170,200,0.55)'

  // suppress unused warnings for colors used only in draw functions
  void COL_BG; void COL_GRID_LINE

  // ── Helpers ────────────────────────────────────────────
  function lerp(a: number, b: number, t: number) { return a + (b - a) * t }
  function clamp(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v }

  function getColors() {
    if (_direction === 'LONG') return COL_LONG
    if (_direction === 'SHORT') return COL_SHORT
    return COL_NEUTRAL
  }

  // ── Initialization ─────────────────────────────────────
  function init() {
    _reactorCanvas = document.getElementById('mcrReactorCanvas')
    _radarCanvas = document.getElementById('mcrRadarCanvas')
    if (!_reactorCanvas || !_radarCanvas) return

    _reactorCtx = _reactorCanvas.getContext('2d')
    _radarCtx = _radarCanvas.getContext('2d')

    _handleResize()
    w.addEventListener('resize', _debounceResize)

    if (!_inited) {
      _inited = true
      _lastFrame = performance.now()
      _rafId = requestAnimationFrame(_tick)
    }
  }

  let _resizeTimer: any = 0
  function _debounceResize() {
    clearTimeout(_resizeTimer)
    _resizeTimer = setTimeout(_handleResize, 150)
  }

  function _handleResize() {
    if (!_reactorCanvas || !_radarCanvas) return
    const rP = _reactorCanvas.parentElement
    const rdP = _radarCanvas.parentElement
    if (!rP || !rdP) return

    const dpr = w.devicePixelRatio || 1

    // Reactor
    const rW = rP.clientWidth
    const rH = rP.clientHeight
    _reactorCanvas.width = rW * dpr
    _reactorCanvas.height = rH * dpr
    _reactorCanvas.style.width = rW + 'px'
    _reactorCanvas.style.height = rH + 'px'
    _reactorCtx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Radar
    const rdW = rdP.clientWidth
    const rdH = rdP.clientHeight
    _radarCanvas.width = rdW * dpr
    _radarCanvas.height = rdH * dpr
    _radarCanvas.style.width = rdW + 'px'
    _radarCanvas.style.height = rdH + 'px'
    _radarCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  // ── Data Update (called from brain.js every 5s) ───────
  function update(data: any) {
    if (!data) return
    for (let i = 0; i < AXES.length; i++) {
      const k = AXES[i]
      if (data[k] != null) _target[k] = clamp(+data[k], 0, 1)
    }
    if (data.gatesOpen != null) _gatesOpen = data.gatesOpen | 0
    if (data.gatesTotal != null) _gatesTotal = data.gatesTotal | 0
    if (data.direction) _direction = data.direction
    if (data.confidence != null) _confidence = clamp(+data.confidence, 0, 100)
    if (data.entryScore != null) _entryScore = clamp(+data.entryScore, 0, 100)

    // [BRAIN_RADAR_12X_UI_ONLY PAS 2] Optional new axes — read-only
    // visualization. Each axis is accepted only when the brain feed
    // provides a finite number; otherwise its `_hasReal` flag stays
    // false and the renderer dims it. NEVER falls back to fake data.
    // Map: payload key → internal _target key.
    //   delta     → 'delta'    (buy/sell aggression)
    //   oi        → 'oi'       (open-interest pressure)
    //   funding   → 'fund'     (funding bias / crowd pressure)
    //   imbalance → 'imb'      (top-N orderbook imbalance)
    //   sentiment → 'sent'     (long/short ratio deviation)
    //   liquidity → 'liq'      (magnet / liquidity proximity)
    const _readOptional = (raw: any, internalKey: string) => {
      if (raw == null) {
        _hasReal[internalKey] = false
        return
      }
      const v = +raw
      if (!Number.isFinite(v)) {
        _hasReal[internalKey] = false
        return
      }
      _target[internalKey] = clamp(v, 0, 1)
      _hasReal[internalKey] = true
    }
    if ('delta'     in data) _readOptional(data.delta,     'delta')
    if ('oi'        in data) _readOptional(data.oi,        'oi')
    if ('funding'   in data) _readOptional(data.funding,   'fund')
    if ('imbalance' in data) _readOptional(data.imbalance, 'imb')
    if ('sentiment' in data) _readOptional(data.sentiment, 'sent')
    if ('liquidity' in data) _readOptional(data.liquidity, 'liq')
  }

  // ── RAF Tick ───────────────────────────────────────────
  function _tick(ts: number) {
    if (document.hidden) { _rafId = requestAnimationFrame(_tick); return }
    const dt = ts - _lastFrame
    _lastFrame = ts

    const alpha = clamp(dt / 180, 0.02, 0.18)
    for (let i = 0; i < AXES.length; i++) {
      const k = AXES[i]
      _display[k] = lerp(_display[k], _target[k], alpha)
    }
    // [BRAIN_RADAR_12X_UI_ONLY PAS 2] Lerp the 6 new axes only when
    // they have real data attached. Skeleton axes stay at 0 so they
    // do not flicker when first toggled ON. Pure visual smoothing —
    // no decision impact.
    if (w.BRAIN_RADAR_12X_UI_ONLY) {
      const NEW_KEYS = ['delta', 'oi', 'fund', 'imb', 'sent', 'liq']
      for (let i = 0; i < NEW_KEYS.length; i++) {
        const k = NEW_KEYS[i]
        if (_hasReal[k]) _display[k] = lerp(_display[k], _target[k], alpha)
      }
    }
    _displayConf = lerp(_displayConf, _confidence, alpha * 0.6)
    _displayEntry = lerp(_displayEntry, _entryScore, alpha * 0.6)

    const sweepSpeed = 0.04 + (_displayConf / 100) * 0.10
    _sweepAngle = (_sweepAngle + dt * sweepSpeed) % 360

    // [BRAIN_RADAR_12X_UI_ONLY] PAS 1 — when flag ON, render 12-axis
    // skeleton. Otherwise render the existing 6-axis reactor exactly
    // as before (bit-identical code path). The signal-radar (sweep)
    // rendering does not depend on axis count and is shared.
    if (w.BRAIN_RADAR_12X_UI_ONLY) {
      _drawReactor12(dt)
    } else {
      _drawReactor(dt)
    }
    _drawRadar(dt)

    _rafId = requestAnimationFrame(_tick)
  }

  // ══════════════════════════════════════════════════════
  // REACTOR DRAW
  // ══════════════════════════════════════════════════════
  function _drawReactor(_dt: number) {
    const ctx = _reactorCtx
    if (!ctx) return
    const W = _reactorCanvas.clientWidth
    const H = _reactorCanvas.clientHeight
    if (!W || !H) return

    ctx.clearRect(0, 0, W, H)

    const cx = W / 2
    const cy = H / 2
    const maxR = Math.min(W, H) * 0.38
    const cols = getColors()

    // ── Background grid rings ──
    ctx.strokeStyle = COL_GRID
    ctx.lineWidth = 0.5
    for (let ring = 1; ring <= 5; ring++) {
      const r = maxR * ring / 5
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()
    }

    // ── Axis lines ──
    ctx.strokeStyle = COL_AXIS
    ctx.lineWidth = 0.8
    for (let i = 0; i < 6; i++) {
      const angle = AXIS_ANGLES[i]
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR)
      ctx.stroke()
    }

    // ── Data polygon ──
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const k = AXES[i]
      const val = _display[k]
      const angle = AXIS_ANGLES[i]
      const rV = maxR * Math.max(val, 0.04)
      const px = cx + Math.cos(angle) * rV
      const py = cy + Math.sin(angle) * rV
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()

    ctx.fillStyle = cols.fill
    ctx.fill()
    ctx.strokeStyle = cols.stroke
    ctx.lineWidth = 1.5
    ctx.shadowColor = cols.glow
    ctx.shadowBlur = 12
    ctx.stroke()
    ctx.shadowBlur = 0

    // ── Axis vertex dots ──
    for (let i = 0; i < 6; i++) {
      const k = AXES[i]
      const val = _display[k]
      const angle = AXIS_ANGLES[i]
      const rV = maxR * Math.max(val, 0.04)
      const px = cx + Math.cos(angle) * rV
      const py = cy + Math.sin(angle) * rV

      ctx.beginPath()
      ctx.arc(px, py, 3, 0, Math.PI * 2)
      ctx.fillStyle = cols.stroke
      ctx.shadowColor = cols.glow
      ctx.shadowBlur = 8
      ctx.fill()
      ctx.shadowBlur = 0
    }

    // ── Axis labels ──
    ctx.font = '600 9px "Orbitron","Share Tech Mono",monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let i = 0; i < 6; i++) {
      const angle = AXIS_ANGLES[i]
      const lR = maxR + 18
      const lx = cx + Math.cos(angle) * lR
      const ly = cy + Math.sin(angle) * lR

      const pct = Math.round(_display[AXES[i]] * 100)
      ctx.fillStyle = COL_LABEL
      ctx.fillText(AXIS_LABELS[i], lx, ly - 6)
      ctx.fillStyle = cols.stroke
      ctx.font = '700 10px "Orbitron","Share Tech Mono",monospace'
      ctx.fillText(pct + '%', lx, ly + 7)
      ctx.font = '600 9px "Orbitron","Share Tech Mono",monospace'
    }

    // ── Core center glow ──
    const coreIntensity = _displayConf / 100
    const pulsePhase = (Math.sin(performance.now() / (800 - _displayEntry * 4)) + 1) / 2
    const coreAlpha = 0.15 + coreIntensity * 0.55 + pulsePhase * 0.12
    const coreR = 14 + coreIntensity * 18 + pulsePhase * 4

    // Outer halo
    const haloGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.2)
    haloGrad.addColorStop(0, cols.core.replace(')', ',' + (coreAlpha * 0.3) + ')').replace('rgb', 'rgba'))
    haloGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.beginPath()
    ctx.arc(cx, cy, coreR * 2.2, 0, Math.PI * 2)
    ctx.fillStyle = haloGrad
    ctx.fill()

    // Inner core
    const innerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
    innerGrad.addColorStop(0, 'rgba(255,250,230,' + (coreAlpha * 0.9) + ')')
    innerGrad.addColorStop(0.4, cols.glow.replace(/[\d.]+\)$/, (coreAlpha * 0.7) + ')'))
    innerGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.beginPath()
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
    ctx.fillStyle = innerGrad
    ctx.fill()

    // Core ring
    ctx.beginPath()
    ctx.arc(cx, cy, coreR * 0.6, 0, Math.PI * 2)
    ctx.strokeStyle = cols.stroke
    ctx.globalAlpha = 0.3 + coreAlpha * 0.5
    ctx.lineWidth = 1.2
    ctx.stroke()
    ctx.globalAlpha = 1

    // ── GATES badge (top-left) ──
    ctx.font = '700 11px "Orbitron","Share Tech Mono",monospace'
    ctx.textAlign = 'left'
    ctx.fillStyle = _gatesOpen >= _gatesTotal ? '#39ff14' : _gatesOpen >= _gatesTotal - 2 ? '#f0c040' : '#ff3355'
    ctx.shadowColor = ctx.fillStyle
    ctx.shadowBlur = 6
    ctx.fillText('GATES ' + _gatesOpen + '/' + _gatesTotal, cx - maxR, cy - maxR - 28)
    ctx.shadowBlur = 0

    // ── Direction MODE badge (bottom-left) ──
    const modeLabel = _direction === 'LONG' ? 'LONG MODE' : _direction === 'SHORT' ? 'SHORT MODE' : 'SCANNING'
    const modeColor = _direction === 'LONG' ? '#39ff14' : _direction === 'SHORT' ? '#ff3355' : '#f0c040'
    ctx.font = '700 12px "Orbitron","Share Tech Mono",monospace'
    ctx.textAlign = 'left'
    ctx.fillStyle = modeColor
    ctx.shadowColor = modeColor
    ctx.shadowBlur = 8
    ctx.fillText(modeLabel, cx - maxR, cy + maxR + 30)
    ctx.shadowBlur = 0

    // Sub-label: confluence score
    ctx.font = '600 9px "Orbitron","Share Tech Mono",monospace'
    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(180,220,240,0.78)'
    ctx.fillText('CONFLUENCE ' + Math.round(_displayConf), cx + maxR, cy + maxR + 30)
  }

  // ══════════════════════════════════════════════════════
  // [BRAIN_RADAR_12X_UI_ONLY] PAS 1 — 12-AXIS REACTOR DRAW (SKELETON)
  // ══════════════════════════════════════════════════════
  // Mirrors _drawReactor structure (grid rings → axis lines → polygon
  // → vertex dots → labels → core glow → GATES + MODE labels) with
  // these differences:
  //   • iterates 12 axis slots instead of 6;
  //   • polygon, fill, glow, vertex dots are drawn ONLY over the 6
  //     real axes (positions 0,2,4,6,8,10 — TREND/FLOW/VOL/VOLAT/
  //     MOM/STRUCT) so the actual brain shape stays honest;
  //   • the 6 new axes (DELTA/OI/FUND/IMB/SENT/LIQ at positions
  //     1,3,5,7,9,11) render as dimmed lines + dimmed labels +
  //     '—' placeholder percentage. NO fake values, NO data binding.
  // Any change to the visual style of _drawReactor that should also
  // apply here must be applied in BOTH functions.
  function _drawReactor12(_dt: number) {
    const ctx = _reactorCtx
    if (!ctx) return
    const W = _reactorCanvas.clientWidth
    const H = _reactorCanvas.clientHeight
    if (!W || !H) return

    ctx.clearRect(0, 0, W, H)

    const cx = W / 2
    const cy = H / 2
    const maxR = Math.min(W, H) * 0.38
    const cols = getColors()

    // ── Background grid rings ──
    ctx.strokeStyle = COL_GRID
    ctx.lineWidth = 0.5
    for (let ring = 1; ring <= 5; ring++) {
      const r = maxR * ring / 5
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()
    }

    // ── Axis lines (12 — dimmed for new 6) ──
    ctx.lineWidth = 0.8
    for (let i = 0; i < 12; i++) {
      const angle = AXIS_ANGLES_12[i]
      const k = AXES_12[i]
      ctx.strokeStyle = _isDimmedAxis(k) ? COL_DIM_AXIS : COL_AXIS
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR)
      ctx.stroke()
    }

    // ── Data polygon — covers all 12 vertices, but DIMMED axes
    // collapse to a tiny 4% radius so they pull the polygon inward
    // without spiking it. The shape matches the available data:
    // skeleton axes / lens-deselected axes show ~zero; primary
    // axes show their real value. No fake values. ──
    ctx.beginPath()
    for (let i = 0; i < 12; i++) {
      const k = AXES_12[i]
      const dim = _isDimmedAxis(k)
      const val = dim ? 0 : _displayValueFor(k)
      const angle = AXIS_ANGLES_12[i]
      const rV = maxR * Math.max(val, 0.04)
      const px = cx + Math.cos(angle) * rV
      const py = cy + Math.sin(angle) * rV
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()

    ctx.fillStyle = cols.fill
    ctx.fill()
    ctx.strokeStyle = cols.stroke
    ctx.lineWidth = 1.5
    ctx.shadowColor = cols.glow
    ctx.shadowBlur = 12
    ctx.stroke()
    ctx.shadowBlur = 0

    // ── Vertex dots — bright on primary axes, small dim dot on
    // dim ones (placed at the same low radius as the polygon
    // collapse so it sits on the polygon perimeter, not floating). ──
    for (let i = 0; i < 12; i++) {
      const k = AXES_12[i]
      const dim = _isDimmedAxis(k)
      const val = dim ? 0 : _displayValueFor(k)
      const angle = AXIS_ANGLES_12[i]
      const rV = maxR * Math.max(val, 0.04)
      const px = cx + Math.cos(angle) * rV
      const py = cy + Math.sin(angle) * rV
      ctx.beginPath()
      ctx.arc(px, py, dim ? 2.5 : 3, 0, Math.PI * 2)
      if (dim) {
        ctx.fillStyle = COL_DIM_DOT
        ctx.fill()
      } else {
        ctx.fillStyle = cols.stroke
        ctx.shadowColor = cols.glow
        ctx.shadowBlur = 8
        ctx.fill()
        ctx.shadowBlur = 0
      }
    }

    // ── Axis labels (12 — '—' for new ones, % for real ones) ──
    ctx.font = '600 8px "Orbitron","Share Tech Mono",monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let i = 0; i < 12; i++) {
      const angle = AXIS_ANGLES_12[i]
      const lR = maxR + 18
      const lx = cx + Math.cos(angle) * lR
      const ly = cy + Math.sin(angle) * lR
      const k = AXES_12[i]

      if (_isDimmedAxis(k)) {
        ctx.fillStyle = COL_DIM_LABEL
        ctx.font = '600 8px "Orbitron","Share Tech Mono",monospace'
        ctx.fillText(AXIS_LABELS_12[i], lx, ly - 5)
        ctx.font = '700 9px "Orbitron","Share Tech Mono",monospace'
        ctx.fillText('—', lx, ly + 6)
      } else {
        // [L2] _displayValueFor honors lens overrides (TIMEFRAME→MOM uses S.rsi[lensTf]).
        const pct = Math.round(_displayValueFor(k) * 100)
        ctx.fillStyle = COL_LABEL
        ctx.font = '600 8px "Orbitron","Share Tech Mono",monospace'
        ctx.fillText(AXIS_LABELS_12[i], lx, ly - 5)
        ctx.fillStyle = cols.stroke
        ctx.font = '700 9px "Orbitron","Share Tech Mono",monospace'
        ctx.fillText(pct + '%', lx, ly + 6)
      }
    }

    // ── Core center glow (mirrors _drawReactor lines 256-287) ──
    const coreIntensity = _displayConf / 100
    const pulsePhase = (Math.sin(performance.now() / (800 - _displayEntry * 4)) + 1) / 2
    const coreAlpha = 0.15 + coreIntensity * 0.55 + pulsePhase * 0.12
    const coreR = 14 + coreIntensity * 18 + pulsePhase * 4

    const haloGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.2)
    haloGrad.addColorStop(0, cols.core.replace(')', ',' + (coreAlpha * 0.3) + ')').replace('rgb', 'rgba'))
    haloGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.beginPath()
    ctx.arc(cx, cy, coreR * 2.2, 0, Math.PI * 2)
    ctx.fillStyle = haloGrad
    ctx.fill()

    const innerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
    innerGrad.addColorStop(0, 'rgba(255,250,230,' + (coreAlpha * 0.9) + ')')
    innerGrad.addColorStop(0.4, cols.glow.replace(/[\d.]+\)$/, (coreAlpha * 0.7) + ')'))
    innerGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.beginPath()
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
    ctx.fillStyle = innerGrad
    ctx.fill()

    ctx.beginPath()
    ctx.arc(cx, cy, coreR * 0.6, 0, Math.PI * 2)
    ctx.strokeStyle = cols.stroke
    ctx.globalAlpha = 0.3 + coreAlpha * 0.5
    ctx.lineWidth = 1.2
    ctx.stroke()
    ctx.globalAlpha = 1

    // ── GATES badge (top-left) — same as _drawReactor ──
    ctx.font = '700 11px "Orbitron","Share Tech Mono",monospace'
    ctx.textAlign = 'left'
    ctx.fillStyle = _gatesOpen >= _gatesTotal ? '#39ff14' : _gatesOpen >= _gatesTotal - 2 ? '#f0c040' : '#ff3355'
    ctx.shadowColor = ctx.fillStyle
    ctx.shadowBlur = 6
    ctx.fillText('GATES ' + _gatesOpen + '/' + _gatesTotal, cx - maxR, cy - maxR - 28)
    ctx.shadowBlur = 0

    // ── MODE badge (bottom-left) — same as _drawReactor ──
    const modeLabel = _direction === 'LONG' ? 'LONG MODE' : _direction === 'SHORT' ? 'SHORT MODE' : 'SCANNING'
    const modeColor = _direction === 'LONG' ? '#39ff14' : _direction === 'SHORT' ? '#ff3355' : '#f0c040'
    ctx.font = '700 12px "Orbitron","Share Tech Mono",monospace'
    ctx.textAlign = 'left'
    ctx.fillStyle = modeColor
    ctx.shadowColor = modeColor
    ctx.shadowBlur = 8
    ctx.fillText(modeLabel, cx - maxR, cy + maxR + 30)
    ctx.shadowBlur = 0

    ctx.font = '600 9px "Orbitron","Share Tech Mono",monospace'
    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(180,220,240,0.78)'
    ctx.fillText('CONFLUENCE ' + Math.round(_displayConf), cx + maxR, cy + maxR + 30)
  }

  // ══════════════════════════════════════════════════════
  // SIGNAL RADAR DRAW
  // ══════════════════════════════════════════════════════
  function _drawRadar(_dt: number) {
    const ctx = _radarCtx
    if (!ctx) return
    const W = _radarCanvas.clientWidth
    const H = _radarCanvas.clientHeight
    if (!W || !H) return

    ctx.clearRect(0, 0, W, H)

    const cx = W / 2
    const cy = H / 2
    const maxR = Math.min(W, H) * 0.40
    const cols = getColors()

    // ── Grid rings ──
    ctx.strokeStyle = COL_GRID
    ctx.lineWidth = 0.5
    for (let ring = 1; ring <= 4; ring++) {
      ctx.beginPath()
      ctx.arc(cx, cy, maxR * ring / 4, 0, Math.PI * 2)
      ctx.stroke()
    }

    // ── Cross lines ──
    ctx.strokeStyle = COL_GRID_LINE
    ctx.lineWidth = 0.5
    for (let a = 0; a < 4; a++) {
      const angle = (Math.PI / 4) * a
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR)
      ctx.lineTo(cx - Math.cos(angle) * maxR, cy - Math.sin(angle) * maxR)
      ctx.stroke()
    }

    // ── Sweep beam ──
    const sweepRad = _sweepAngle * Math.PI / 180
    const confNorm = _displayConf / 100
    const beamAlpha = 0.15 + confNorm * 0.50
    const beamSpread = 0.35

    const sweepGrad = ctx.createConicGradient(sweepRad - beamSpread, cx, cy)
    sweepGrad.addColorStop(0, 'rgba(0,0,0,0)')
    sweepGrad.addColorStop(0.7, cols.glow.replace(/[\d.]+\)$/, (beamAlpha * 0.4) + ')'))
    sweepGrad.addColorStop(1, cols.glow.replace(/[\d.]+\)$/, beamAlpha + ')'))

    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, maxR, sweepRad - beamSpread, sweepRad)
    ctx.closePath()
    ctx.fillStyle = sweepGrad
    ctx.fill()

    // Sweep leading edge line
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(sweepRad) * maxR, cy + Math.sin(sweepRad) * maxR)
    ctx.strokeStyle = cols.stroke
    ctx.globalAlpha = beamAlpha
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.globalAlpha = 1

    // ── Center dot ──
    const centerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 8 + confNorm * 6)
    centerGrad.addColorStop(0, cols.stroke)
    centerGrad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.beginPath()
    ctx.arc(cx, cy, 8 + confNorm * 6, 0, Math.PI * 2)
    ctx.fillStyle = centerGrad
    ctx.fill()

    // ── Edge ring glow ──
    ctx.beginPath()
    ctx.arc(cx, cy, maxR, 0, Math.PI * 2)
    ctx.strokeStyle = cols.stroke
    ctx.globalAlpha = 0.2 + confNorm * 0.3
    ctx.lineWidth = 1
    ctx.shadowColor = cols.glow
    ctx.shadowBlur = 10
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.globalAlpha = 1

    // ── Direction label (top) ──
    const dirLabel = _direction === 'LONG' ? 'LONG' : _direction === 'SHORT' ? 'SHORT' : 'SCAN'
    const dirColor = _direction === 'LONG' ? '#39ff14' : _direction === 'SHORT' ? '#ff3355' : '#f0c040'
    ctx.font = '700 13px "Orbitron","Share Tech Mono",monospace'
    ctx.textAlign = 'center'
    ctx.fillStyle = dirColor
    ctx.shadowColor = dirColor
    ctx.shadowBlur = 6
    ctx.fillText(dirLabel, cx, cy - maxR - 14)
    ctx.shadowBlur = 0

    // ── Confidence bar (bottom) ──
    const barW = maxR * 1.4
    const barH = 6
    const barX = cx - barW / 2
    const barY = cy + maxR + 4

    ctx.strokeStyle = 'rgba(80,160,255,0.30)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(barX, barY - 2)
    ctx.lineTo(barX + barW, barY - 2)
    ctx.stroke()

    ctx.fillStyle = 'rgba(60,100,140,0.55)'
    _roundRect(ctx, barX, barY, barW, barH, 3)
    ctx.fill()

    const fillW = barW * (confNorm)
    ctx.fillStyle = dirColor
    ctx.shadowColor = dirColor
    ctx.shadowBlur = 6
    _roundRect(ctx, barX, barY, fillW, barH, 3)
    ctx.fill()
    ctx.shadowBlur = 0

    ctx.font = '700 11px "Orbitron","Share Tech Mono",monospace'
    ctx.fillStyle = 'rgba(200,230,250,0.85)'
    ctx.fillText(Math.round(_displayConf) + '%  CONFIDENCE', cx, barY + barH + 14)

    // ── "SIGNAL RADAR" title ──
    ctx.font = '600 8px "Orbitron","Share Tech Mono",monospace'
    ctx.fillStyle = 'rgba(140,190,220,0.50)'
    ctx.fillText('SIGNAL RADAR', cx, barY + barH + 28)
  }

  // Rounded rect helper
  function _roundRect(ctx: any, x: number, y: number, _w: number, h: number, r: number) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + _w - r, y)
    ctx.quadraticCurveTo(x + _w, y, x + _w, y + r)
    ctx.lineTo(x + _w, y + h - r)
    ctx.quadraticCurveTo(x + _w, y + h, x + _w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }

  // ── Destroy ────────────────────────────────────────────
  function destroy() {
    if (_rafId) cancelAnimationFrame(_rafId)
    _rafId = null
    _inited = false
    w.removeEventListener('resize', _debounceResize)
  }

  // ── [L2] Public lens API — called by BrainCockpit lens bar ────
  // Sets the active lens + (optional) timeframe. Selecting any lens
  // automatically activates the 12-axis renderer (sets the existing
  // window.BRAIN_RADAR_12X_UI_ONLY flag to true). To go back to the
  // legacy 6-axis renderer, set the flag explicitly to false in
  // DevTools console — that rollback path is preserved.
  function setLens(lens: any, tf?: any) {
    if (lens === 'hybrid' || lens === 'realtime' || lens === 'timeframe' || lens === 'slow') {
      _lens = lens
      // Selecting any lens means the operator wants the 12-axis view.
      w.BRAIN_RADAR_12X_UI_ONLY = true
    }
    if (tf === '5m' || tf === '15m' || tf === '1h' || tf === '4h') {
      _lensTf = tf
    }
    _recomputeLensActive()
  }
  function getLens() {
    return { lens: _lens, tf: _lensTf, active: { ..._lensActive } }
  }

  // ── Public API ─────────────────────────────────────────
  w.MarketCoreReactor = {
    init: init,
    update: update,
    destroy: destroy,
    // [L2] Lens controls — read-only, NO impact on trading decisions.
    setLens: setLens,
    getLens: getLens,
  }

})()

export {}
