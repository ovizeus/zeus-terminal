// ZeuS Brain v7 — desenul pe canvas, port EXACT din [RENDER] (docs/design/zeus_brain_v7_reference.html).
// Geometria, culorile, transparentele si ritmurile sunt cele din referinta.
// Abateri, toate cerute de operator / spec:
//  • o poarta fara date reale (spread) se deseneaza NECUNOSCUTA: gri, punctata, necrapata;
//  • fara prag (confMin inca necitit) inelul de prag ramane gol;
//  • fara SL pozitia nu are aura (progress null).
import { S, C, R, SEG, AX, N, GN, SAT_SLOT, type Rgb } from './brainStrings'
import { clamp01, type St, type Num } from './brainDerived'

export interface RenderEnv {
  focus: boolean
  reduced: boolean
  best: { entryShape: number[] } | null
  sound: (k: string) => void
  info: (m: string) => void
}
export interface Hl { x: number; y: number; r: number; t: number }

const ang = (i: number) => -Math.PI / 2 + i * 2 * Math.PI / N
export const rgba = (c: Rgb | number[], a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`

export class BrainRenderer {
  drt: number[] = new Array(N).fill(0.1)
  dtf: number[] = new Array(N).fill(0.1)
  dsl: number[] = new Array(N).fill(0.1)
  datt: number[] = new Array(N).fill(0.5)
  dcol: number[] = [57, 255, 106]
  dml = 0.8
  aura = 0
  sec = 1
  dz = 0
  beatPh = 0
  skip = 0
  prevSig = false
  prevMood = ''
  prevZz = false
  lastI = -1
  last: St | null = null
  gvd: number[] = new Array(7).fill(1)
  flash: number[] = new Array(N).fill(0)
  waves: number[] = []
  parts: Array<{ i: number; d: number; s: number }> = []
  hl: Hl | null = null

  private ctx: CanvasRenderingContext2D
  constructor(ctx: CanvasRenderingContext2D) { this.ctx = ctx }

  private pts(v: Num[], sc: number, wob: number, t: number, ox = 0, oy = 0, cx = C, cy = C, RR = R): Array<[number, number]> {
    return v.map((x, i) => {
      const w = wob ? Math.sin(t * 7 + i * 2.1) * wob + Math.sin(t * 11.3 + i) * wob * 0.5 : 0
      const r = RR * Math.max(0.1, clamp01(x) + w) * sc
      return [cx + ox + Math.cos(ang(i)) * r, cy + oy + Math.sin(ang(i)) * r]
    })
  }

  private spline(p: Array<[number, number]>): void {
    const ctx = this.ctx, n = p.length
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n]
      if (i === 0) ctx.moveTo(p1[0], p1[1])
      ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1])
    }
    ctx.closePath()
  }

  render(st: St, t: number, dt: number, rp: { id: string; x?: number } | null, env: RenderEnv): void {
    const r = this, ctx = this.ctx
    r.last = st
    const k = rp ? 0.18 : 0.5
    for (let i = 0; i < N; i++) {
      r.drt[i] += (clamp01(st.rt[i]) - r.drt[i]) * k
      r.dtf[i] += (clamp01(st.tf[i]) - r.dtf[i]) * k
      r.dsl[i] += (clamp01(st.sl[i]) - r.dsl[i]) * k
      const at = st.att && st.att[i] != null ? (st.att[i] as number) : 0.5
      r.datt[i] += (at - r.datt[i]) * k
    }
    for (let c = 0; c < 3; c++) r.dcol[c] += (st.c[c] - r.dcol[c]) * 0.05
    r.dml += ((st.ml == null ? 0.7 : st.ml) - r.dml) * 0.05
    r.dz += ((st.zz ? 1 : 0) - r.dz) * 0.04
    const fs = new Set(st.fails), unk = new Set(st.unk || [])
    for (let g = 0; g < 7; g++) r.gvd[g] += ((fs.has(g) ? 0 : 1) - r.gvd[g]) * 0.08
    const auraT = st.pos && st.pos.pnl != null ? Math.max(-1, Math.min(1, st.pos.pnl)) : 0
    r.aura += (auraT - r.aura) * 0.1
    r.sec += (((st.hes || st.pos) ? 0.4 : 1) - r.sec) * 0.05
    const fresh = st.i === undefined || st.i !== r.lastI
    r.lastI = st.i === undefined ? -1 : st.i
    if (st.sig && !r.prevSig) { r.waves.push(t); env.sound('attack') }
    r.prevSig = st.sig
    if (fresh && st.evt) { if (st.evt === 'TP') { r.waves.push(t); env.sound('tp') } else env.sound(st.evt === 'SL' ? 'sl' : 'close') }
    if (st.mood[0] === 'HESITANT' && r.prevMood !== 'HESITANT') env.sound('hes')
    r.prevMood = st.mood[0]
    if (r.prevZz && !st.zz) { r.waves.push(t); env.sound('wake'); if (!rp) env.info('Woke up: the market started moving again.') }
    r.prevZz = st.zz
    const col = r.dcol, hes = st.hes, conf = st.conf == null ? 0 : st.conf, mlv = r.dml, sleepy = r.dz > 0.5, focus = env.focus, RED = env.reduced
    // [2026-11-16] Focus OFF e alegerea EXPLICITA a omului: unda si particulele se vad si
    // cu „animatii reduse" in telefon (masurat pe telefonul operatorului: reduced=true,
    // deci unda nu aparea niciodata). Setarea telefonului decide doar ca Focus porneste
    // ON si opreste tremurul, respiratia si rotirea cetii.
    const period = (5 - 3 * r.drt[6]) * (1 - r.dz) + 8 * r.dz, br = 1 + (0.02 + r.dz * 0.03) * Math.sin(t * 2 * Math.PI / period)
    ctx.clearRect(0, 0, S, S)
    ctx.globalAlpha = r.sec
    // satelitii + razele de consens
    const scs = st.sats.map((q) => (q.sc == null ? -Infinity : q.sc))
    const bst = scs.length ? Math.max(...scs) : -Infinity
    st.sats.forEach((y, kk) => {
      const [sx, sy] = SAT_SLOT[y.slot ?? kk] || SAT_SLOT[kk], c = y.c, b = y.sc != null && y.sc === bst
      if (y.cons) {
        ctx.beginPath(); ctx.moveTo(sx, sy)
        ctx.quadraticCurveTo((sx + C) / 2 + (sy - C) * 0.25, (sy + C) / 2 - (sx - C) * 0.25, C, C)
        ctx.setLineDash([2, 6]); ctx.lineDashOffset = -t * 25; ctx.strokeStyle = rgba(c, 0.45); ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([])
      }
      ctx.beginPath(); ctx.arc(sx, sy, 30, 0, 7); ctx.strokeStyle = rgba(c, b ? 0.55 : 0.18); ctx.lineWidth = b ? 1.5 : 1; ctx.setLineDash(b ? [] : [2, 4]); ctx.stroke(); ctx.setLineDash([])
      // principala: inel plin in culoarea modului, ca sa se vada care e (colturile nu se schimba)
      if (y.main) { ctx.beginPath(); ctx.arc(sx, sy, 34, 0, 7); ctx.strokeStyle = rgba(col, 0.9); ctx.lineWidth = 2; ctx.stroke() }
      if (y.v) {
        const sp = this.pts(y.v, 1 + 0.04 * Math.sin(t * 3 + kk), 0, t, 0, 0, sx, sy, 24)
        this.spline(sp); ctx.fillStyle = rgba(c, 0.18); ctx.fill()
        ctx.save(); if (b) { ctx.shadowColor = rgba(c, 1); ctx.shadowBlur = 10 }
        ctx.strokeStyle = rgba(c, 0.85); ctx.lineWidth = 1.2; this.spline(sp); ctx.stroke(); ctx.restore()
      } else {
        const rr = 8 + 16 * clamp01(y.sc == null ? 0 : y.sc / 100)
        ctx.beginPath(); ctx.arc(sx, sy, rr, 0, 7); ctx.fillStyle = rgba(c, 0.18); ctx.fill(); ctx.strokeStyle = rgba(c, 0.85); ctx.lineWidth = 1.2; ctx.stroke()
      }
      ctx.fillStyle = rgba(c, 0.95); ctx.font = '500 10px monospace'; ctx.textAlign = 'center'; ctx.fillText(y.s, sx, sy + 3)
      ctx.fillStyle = 'rgba(170,190,215,.7)'; ctx.font = '500 9px monospace'; ctx.fillText(y.sc == null ? '—' : String(y.sc), sx, sy + (sy < C ? 44 : -36))
      if (y.main) { ctx.fillStyle = rgba(col, 0.95); ctx.font = '700 7px monospace'; ctx.fillText('MAIN', sx, sy + 14) }
    })
    ctx.globalAlpha = 1
    ctx.fillStyle = rgba(col, 0.9); ctx.font = '500 14px monospace'; ctx.textAlign = 'left'; ctx.fillText(st.main, 14, S - 30)
    ctx.fillStyle = 'rgba(170,190,215,.6)'; ctx.font = '500 9px monospace'; ctx.fillText('main', 14, S - 17)
    if (rp) { ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.font = '500 11px monospace'; ctx.textAlign = 'center'; ctx.fillText('● REPLAY #' + rp.id + ' · x' + (rp.x || 4), C, 12) }
    // inelele grilei
    for (let q = 1; q <= 4; q++) { ctx.beginPath(); ctx.setLineDash([2, 7]); ctx.strokeStyle = 'rgba(120,160,210,.09)'; ctx.lineWidth = 1; ctx.arc(C, C, R * q / 4, 0, 7); ctx.stroke() }
    ctx.setLineDash([])
    // armura portilor
    const AR = R + 12
    for (let g = 0; g < 7; g++) {
      const a0 = -Math.PI / 2 + g * SEG + 0.06, a1 = a0 + SEG - 0.12, v = r.gvd[g]
      if (unk.has(g)) {
        // NECUNOSCUTA: gri, punctata, necrapata, nenumarata ca picata
        ctx.beginPath(); ctx.arc(C, C, AR, a0, a1); ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(130,145,165,.45)'; ctx.lineWidth = 3; ctx.stroke(); ctx.setLineDash([])
      } else if (v > 0.5) {
        ctx.beginPath(); ctx.arc(C, C, AR, a0, a1); ctx.strokeStyle = rgba(col, (0.25 + 0.35 * v) * (hes ? 0.5 : 1)); ctx.lineWidth = 4; ctx.stroke()
      } else {
        const fl = sleepy ? 0.4 : 0.35 + 0.65 * Math.random() * (Math.sin(t * 20 + g) > -0.3 ? 1 : 0.2)
        for (let s = 0; s < 5; s++) {
          const b0 = a0 + (a1 - a0) * s / 5 + 0.02, b1 = a0 + (a1 - a0) * (s + 1) / 5 - 0.03, off = Math.sin(g * 7 + s * 3) * 3
          ctx.beginPath(); ctx.arc(C, C, AR + off, b0, b1); ctx.strokeStyle = `rgba(255,60,80,${fl * 0.85})`; ctx.lineWidth = hes ? 4 : 3; ctx.stroke()
        }
      }
      const mid = (a0 + a1) / 2
      ctx.save(); ctx.translate(C + Math.cos(mid) * (AR - 8), C + Math.sin(mid) * (AR - 8)); ctx.rotate(mid + Math.PI / 2)
      ctx.fillStyle = unk.has(g) ? 'rgba(130,145,165,.7)' : v > 0.5 ? rgba(col, 0.45) : 'rgba(255,80,100,.95)'
      ctx.font = '500 7px monospace'; ctx.textAlign = 'center'; ctx.fillText(GN[g], 0, 3); ctx.restore()
    }
    // aura pozitiei intre inelul SL (interior) si TP (exterior)
    const SLr = R + 20, TPr = R + 34, ENr = (SLr + TPr) / 2
    const showAura = st.pos ? st.pos.pnl != null : Math.abs(r.aura) > 0.02
    if (showAura) {
      ctx.beginPath(); ctx.arc(C, C, SLr, 0, 7); ctx.strokeStyle = 'rgba(255,77,109,.35)'; ctx.lineWidth = 1; ctx.setLineDash([1, 4]); ctx.stroke()
      ctx.beginPath(); ctx.arc(C, C, TPr, 0, 7); ctx.strokeStyle = 'rgba(57,255,106,.35)'; ctx.stroke(); ctx.setLineDash([])
      const ar = ENr + r.aura * (TPr - ENr), acl: Rgb = r.aura >= 0 ? [57, 255, 106] : [255, 77, 109]
      ctx.save(); ctx.shadowColor = rgba(acl, 1); ctx.shadowBlur = 12 + Math.abs(r.aura) * 14
      ctx.beginPath(); ctx.arc(C, C, ar, 0, 7); ctx.strokeStyle = rgba(acl, 0.35 + 0.5 * Math.abs(r.aura)); ctx.lineWidth = 2 + Math.abs(r.aura) * 3; ctx.stroke(); ctx.restore()
    }
    // fascicul de baleiaj
    const sw = (t * 1.1) % (Math.PI * 2)
    ctx.globalAlpha = r.sec
    if (!focus && !sleepy) {
      // [2026-11-16] Unda de radar militar: dara de ~72° care se stinge in urma, pe tot
      // discul pana la armura, si o linie stralucitoare in fata. Desenata din FELII (nu
      // createConicGradient): WebView-ul Android al aplicatiei poate fi mai vechi decat
      // functia, iar codul vechi sarea atunci peste unda fara nicio eroare — pe telefon
      // nu se vedea, in Claude da.
      const TRAIL = 1.25, SLICES = 24, RS = R + 12, step = TRAIL / SLICES
      for (let k = 0; k < SLICES; k++) {
        const a0 = sw - TRAIL + k * step, a1 = a0 + step + 0.004
        const f = (k + 1) / SLICES
        ctx.fillStyle = rgba(col, 0.30 * Math.pow(f, 1.8))
        ctx.beginPath(); ctx.moveTo(C, C); ctx.arc(C, C, RS, a0, a1); ctx.closePath(); ctx.fill()
      }
      ctx.save(); ctx.shadowColor = rgba(col, 1); ctx.shadowBlur = 8
      ctx.strokeStyle = rgba(col, 0.85); ctx.lineWidth = 1.6
      ctx.beginPath(); ctx.moveTo(C, C); ctx.lineTo(C + Math.cos(sw) * RS, C + Math.sin(sw) * RS); ctx.stroke(); ctx.restore()
    }
    ctx.globalAlpha = 1
    // spitele (grosime = atentia ML) + etichete
    for (let i = 0; i < N; i++) {
      const a = ang(i), x = C + Math.cos(a) * R, y = C + Math.sin(a) * R
      if (!focus && !sleepy) {
        const d = Math.abs(((a + Math.PI * 2.5) % (Math.PI * 2)) - ((sw + Math.PI / 2) % (Math.PI * 2)))
        if (d < 0.08) r.flash[i] = 1
      }
      r.flash[i] *= 0.96
      const g = ctx.createLinearGradient(C, C, x, y); g.addColorStop(0, rgba(col, 0.12 + r.datt[i] * 0.45)); g.addColorStop(1, 'rgba(120,170,230,.02)')
      ctx.strokeStyle = g; ctx.lineWidth = 0.5 + r.datt[i] * 3.2; ctx.beginPath(); ctx.moveTo(C, C); ctx.lineTo(x, y); ctx.stroke()
      const lx = C + Math.cos(a) * (R + 50), ly = C + Math.sin(a) * (R + 50), f = r.flash[i]
      ctx.textAlign = 'center'; ctx.fillStyle = `rgba(${170 + 85 * f | 0},${190 + 65 * f | 0},${215 + 40 * f | 0},${0.6 + 0.4 * f})`; ctx.font = '500 9.5px sans-serif'; ctx.fillText(AX[i], lx, ly - 3)
      ctx.fillStyle = rgba(col, 0.7 + 0.3 * f); ctx.font = '500 9.5px monospace'; ctx.fillText(st.rt[i] == null ? '—' : Math.round(r.drt[i] * 100) + '%', lx, ly + 8)
    }
    const P = this.pts(r.drt, RED ? 1 : br, (sleepy || RED) ? 0 : st.div * 0.12, t)
    ctx.globalAlpha = r.sec
    // sinapse, membrana lenta, particule
    if (!focus && !sleepy) {
      for (let i = 0; i < N; i++) for (let j = i + 2; j < N; j++) {
        if (j - i === N - 1) continue
        const s = Math.min(r.drt[i], r.drt[j]); if (s < 0.6) continue
        ctx.beginPath(); ctx.moveTo(P[i][0], P[i][1])
        ctx.quadraticCurveTo(C + (P[i][0] + P[j][0] - 2 * C) * 0.15, C + (P[i][1] + P[j][1] - 2 * C) * 0.15, P[j][0], P[j][1])
        ctx.setLineDash([3, 9]); ctx.lineDashOffset = RED ? 0 : -t * 30; ctx.strokeStyle = rgba(col, (s - 0.6) * 1.4); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([])
      }
      this.spline(this.pts(r.dsl, 1, 0, t)); ctx.setLineDash([4, 5]); ctx.strokeStyle = rgba(col, 0.28); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([])
      if (Math.random() < 0.6 && r.parts.length < 36) { const i = Math.floor(Math.random() * N); if (Math.random() < r.drt[i]) r.parts.push({ i, d: 0.12, s: 0.004 + Math.random() * 0.007 }) }
    }
    for (let j = r.parts.length - 1; j >= 0; j--) {
      const p = r.parts[j]; p.d += p.s
      if (focus || sleepy || p.d > r.drt[p.i] * br) { r.parts.splice(j, 1); continue }
      const a = ang(p.i); ctx.fillStyle = rgba(col, 0.6 * (1 - p.d)); ctx.beginPath(); ctx.arc(C + Math.cos(a) * R * p.d, C + Math.sin(a) * R * p.d, 1.5, 0, 7); ctx.fill()
    }
    // fantoma celei mai bune tranzactii
    if (env.best) { this.spline(this.pts(env.best.entryShape, 1, 0, t)); ctx.setLineDash([6, 4]); ctx.strokeStyle = 'rgba(255,200,90,.38)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]) }
    ctx.globalAlpha = 1
    // membrana timeframe
    this.spline(this.pts(r.dtf, 1, 0, t)); ctx.fillStyle = rgba(col, 0.05); ctx.fill(); ctx.strokeStyle = rgba(col, 0.42); ctx.lineWidth = 1.2; ctx.stroke()
    // forma principala: umplere, ceata ML, contur stralucitor
    const blur = 1 - mlv, fg = ctx.createRadialGradient(C, C, 0, C, C, R)
    fg.addColorStop(0, rgba(col, 0.3)); fg.addColorStop(1, rgba(col, 0.06)); this.spline(P); ctx.fillStyle = fg; ctx.fill()
    if (!sleepy) for (let q = 0; q < 4; q++) {
      const o = blur * 7, a = q * 1.57 + (RED ? 0 : t * 0.8)
      this.spline(this.pts(r.drt, br, RED ? 0 : st.div * 0.12, t, Math.cos(a) * o, Math.sin(a) * o)); ctx.strokeStyle = rgba(col, 0.22 * blur); ctx.lineWidth = 2 + blur * 3; ctx.stroke()
    }
    ctx.save(); ctx.shadowColor = rgba(col, 0.9); ctx.shadowBlur = 6 + mlv * 14; this.spline(P); ctx.strokeStyle = rgba(col, 0.35 + 0.6 * mlv); ctx.lineWidth = 1 + mlv * 1.4; ctx.stroke(); ctx.restore()
    // conturul intentiei
    if (!sleepy) {
      const fc = r.drt.map((x, i) => clamp01(x + (x - r.dtf[i]) * 2.5))
      this.spline(this.pts(fc, 1, 0, t)); ctx.setLineDash([1, 5]); ctx.strokeStyle = `rgba(230,240,255,${0.2 + 0.4 * mlv})`; ctx.lineWidth = 1.3; ctx.stroke(); ctx.setLineDash([])
    }
    P.forEach((p, i) => { ctx.fillStyle = rgba(col, 0.4 + 0.6 * mlv); ctx.beginPath(); ctx.arc(p[0], p[1], (1.6 + mlv * 1.2) + r.flash[i] * 1.8, 0, 7); ctx.fill() })
    // undele de soc
    for (let q = r.waves.length - 1; q >= 0; q--) {
      const e = (t - r.waves[q]) / 1.4; if (e > 1) { r.waves.splice(q, 1); continue }
      ctx.beginPath(); ctx.arc(C, C, R * (0.2 + e * 1.3), 0, 7); ctx.strokeStyle = rgba(col, 0.8 * (1 - e)); ctx.lineWidth = 3 * (1 - e) + 0.5; ctx.stroke()
    }
    // inima (lub-dub) + inelul de prag
    let rate = (48 + conf * 0.7) / 60 * (1 - r.dz * 0.6)
    if (hes && !RED) { rate *= 0.7 + Math.random() * 1.2; if (r.skip <= 0 && Math.random() < 0.01) r.skip = 0.35 }
    if (r.skip > 0) r.skip -= dt; else r.beatPh = (r.beatPh + dt * rate) % 1
    const p = r.beatPh, bt = Math.exp(-(p * p) / 0.0015) + Math.exp(-((p - 1) ** 2) / 0.0015) + 0.55 * Math.exp(-((p - 0.17) ** 2) / 0.0015)
    const cr = 7 + bt * 6, ca = hes && !RED && Math.random() < 0.12 ? 0.25 : 0.95, cc: number[] = hes ? [255, 179, 71] : col
    const cg = ctx.createRadialGradient(C, C, 0, C, C, cr * 3); cg.addColorStop(0, rgba(cc, ca)); cg.addColorStop(0.3, rgba(cc, 0.3 * ca)); cg.addColorStop(1, rgba(cc, 0))
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(C, C, cr * 3, 0, 7); ctx.fill()
    const fr = st.thr != null && st.thr > 0 && st.conf != null ? Math.min(1, st.conf / st.thr) : 0
    ctx.beginPath(); ctx.arc(C, C, 25, 0, 7); ctx.strokeStyle = 'rgba(120,160,210,.18)'; ctx.lineWidth = 2; ctx.stroke()
    if (fr > 0) {
      ctx.beginPath(); ctx.arc(C, C, 25, -Math.PI / 2, -Math.PI / 2 + fr * Math.PI * 2); ctx.strokeStyle = hes ? 'rgba(255,179,71,.95)' : rgba(col, fr >= 1 ? 1 : 0.8)
      ctx.lineWidth = fr >= 1 ? 3.5 : 2.5; ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt'
    }
    // stratul de somn
    if (r.dz > 0.02) {
      ctx.fillStyle = `rgba(4,9,19,${r.dz * 0.55})`; ctx.fillRect(0, 0, S, S); ctx.fillStyle = `rgba(150,170,200,${r.dz * 0.8})`; ctx.textAlign = 'center'
      ;[0, 1, 2].forEach((q) => { const ph2 = (t * 0.35 + q / 3) % 1; ctx.font = `500 ${10 + q * 3}px monospace`; ctx.globalAlpha = r.dz * (1 - ph2); ctx.fillText('z', C + 18 + ph2 * 22 + q * 4, C - 16 - ph2 * 34) })
      ctx.globalAlpha = 1
    }
    // evidentierea atingerii
    if (r.hl) {
      const e = (performance.now() / 1000 - r.hl.t) / 1.6
      if (e > 1) r.hl = null
      else { ctx.beginPath(); ctx.arc(r.hl.x, r.hl.y, r.hl.r + e * 10, 0, 7); ctx.strokeStyle = `rgba(255,255,255,${0.85 * (1 - e)})`; ctx.lineWidth = 2; ctx.stroke() }
    }
  }
}
