// QM Particle System — Liquidation direction particles — 1:1 from HTML
const w = window as any

interface Particle {
  x: number; y: number; size: number; vy: number; vx: number
  opacity: number; life: number; decay: number; trail: { x: number; y: number; op: number }[]
}

const PARTS: Particle[] = []
const LIQ_DIR = { dir: 0, str: 0 }
let _canvas: HTMLCanvasElement | null = null
let _ctx: CanvasRenderingContext2D | null = null
let _raf = 0
let _destroyed = false
// [PERF-1] Hold ref to resize handler so destroyParticles() can removeEventListener.
// Without this, every initParticles() call (each panel toggle) leaks one window
// resize listener — after ~10 toggles 10+ handlers fire on every resize event.
let _resizeHandler: (() => void) | null = null

function calcDir(): void {
  const c = w.S; if (!c || !c.price || !c._qmLiqBuckets) return
  let vUp = 0, vDn = 0
  Object.keys(c._qmLiqBuckets).forEach((pct: string) => {
    const b = c._qmLiqBuckets[+pct]; if (!b) return
    if (+pct > 0) vUp += b.shortVol; else if (+pct < 0) vDn += b.longVol
  })
  const tot = (c.obBV || 0) + (c.obAV || 0)
  const ob = tot > 0 ? ((c.obBV || 0) - (c.obAV || 0)) / tot : 0
  const cvd2 = (c._qmDeltaHist?.length && c._qmDeltaHist[c._qmDeltaHist.length - 1] > 0) ? 0.15 : ((c._qmDeltaHist?.length && c._qmDeltaHist[c._qmDeltaHist.length - 1] < 0) ? -0.15 : 0)
  const liq = vUp + vDn > 0 ? (vUp - vDn) / (vUp + vDn) : 0
  const comb = liq * 0.5 + ob * 0.3 + cvd2 * 0.2
  if (comb > 0.04) { LIQ_DIR.dir = 1; LIQ_DIR.str = Math.min(1, Math.abs(comb) * 2) }
  else if (comb < -0.04) { LIQ_DIR.dir = -1; LIQ_DIR.str = Math.min(1, Math.abs(comb) * 2) }
  else { LIQ_DIR.dir = 0; LIQ_DIR.str = 0 }
}

function spawnPart(cx: number, cy: number, cw: number): void {
  if (!LIQ_DIR.dir || PARTS.length >= 60) return
  PARTS.push({
    x: cx + Math.random() * cw,
    y: cy,
    size: 2 + Math.random() * 5,
    vy: (0.4 + Math.random() * 1.0) * LIQ_DIR.dir * -1,
    vx: (Math.random() - 0.5) * 0.4,
    opacity: 0.5 + Math.random() * 0.4,
    life: 1.0,
    decay: 0.003 + Math.random() * 0.005,
    trail: []
  })
}

function frame(): void {
  if (_destroyed || !_ctx || !_canvas) return

  // [2026-06-24] Re-measure the canvas from its rendered CSS box EVERY frame.
  // Root-cause of the "green flood / Christmas-lights" flicker: the buffer was
  // sized once at init from parent.clientWidth, but the panel often isn't laid
  // out yet then (clientWidth≈0/1), leaving a 1×1 buffer that CSS stretched to
  // full screen — so each particle became a full-screen green block. Lazy sync
  // here also handles viewport rotation/resize. If still unlaid-out, clear+skip.
  const cssW = _canvas.clientWidth, cssH = _canvas.clientHeight
  const ready = cssW > 1 && cssH > 1
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  if (ready) {
    const needW = Math.round(cssW * dpr), needH = Math.round(cssH * dpr)
    if (_canvas.width !== needW || _canvas.height !== needH) {
      _canvas.width = needW; _canvas.height = needH
    }
  }
  _ctx.setTransform(1, 0, 0, 1, 0, 0)
  _ctx.clearRect(0, 0, _canvas.width, _canvas.height)
  if (!ready) { _raf = requestAnimationFrame(frame); return }
  _ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // draw in CSS pixels

  calcDir()
  const dir = LIQ_DIR.dir, str = LIQ_DIR.str
  const areaX = cssW * 0.1
  const areaW = cssW * 0.8
  const markY = cssH / 2
  const areaH = 280

  if (dir !== 0) {
    const rate = Math.max(1, Math.floor(str * 2))
    for (let i = 0; i < rate; i++) spawnPart(areaX, markY, areaW)
  }

  const isUp = dir > 0
  const r = isUp ? 0 : 255, g = isUp ? 255 : 51, b = isUp ? 136 : 102

  for (let i = PARTS.length - 1; i >= 0; i--) {
    const p = PARTS[i]
    p.trail.push({ x: p.x, y: p.y, op: p.life * p.opacity * 0.25 })
    if (p.trail.length > 15) p.trail.shift()
    p.x += p.vx; p.y += p.vy; p.life -= p.decay
    const dist = Math.abs(p.y - markY)
    if (p.life <= 0 || dist > areaH || p.x < areaX - 10 || p.x > areaX + areaW + 10) {
      PARTS.splice(i, 1); continue
    }
    p.trail.forEach((t, ti) => {
      const a = t.op * (ti / p.trail.length) * 0.4
      if (a < 0.008) return
      _ctx!.fillStyle = `rgba(${r},${g},${b},${a})`
      const s = p.size * (0.3 + 0.7 * ti / p.trail.length)
      _ctx!.fillRect(t.x - s / 2, t.y - s / 2, s, s)
    })
    const a = p.life * p.opacity
    _ctx!.fillStyle = `rgba(${r},${g},${b},${a})`
    _ctx!.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
    if (p.size > 4) {
      _ctx!.fillStyle = `rgba(${r},${g},${b},${a * 0.1})`
      _ctx!.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2)
    }
  }

  _raf = requestAnimationFrame(frame)
}

export function initParticles(canvasId: string): void {
  _destroyed = false
  _canvas = document.getElementById(canvasId) as HTMLCanvasElement
  if (!_canvas) return
  _ctx = _canvas.getContext('2d')
  // [2026-06-24] Sizing is handled lazily inside frame() (rendered CSS box ×
  // devicePixelRatio), which is robust to the panel not being laid out yet at
  // init — the old parent.clientWidth read here left a 1×1 buffer. Keep a resize
  // handler only so rotation/viewport changes nudge a prompt re-measure; the
  // actual resize happens on the next animation frame.
  function resize() { /* no-op: frame() re-measures from the rendered CSS box */ }
  resize()
  // [PERF-1] Store ref so destroy can remove
  _resizeHandler = resize
  window.addEventListener('resize', _resizeHandler)
  _raf = requestAnimationFrame(frame)
}

export function destroyParticles(): void {
  _destroyed = true
  if (_raf) { cancelAnimationFrame(_raf); _raf = 0 }
  // [PERF-1] Remove resize listener to prevent leak across panel toggle cycles
  if (_resizeHandler) {
    window.removeEventListener('resize', _resizeHandler)
    _resizeHandler = null
  }
  PARTS.length = 0
  _canvas = null; _ctx = null
}
