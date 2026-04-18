// Zeus — engine/aresUI.ts
// Ported 1:1 from public/js/brain/deepdive.js lines 2003-3732 (Phase 5B3)
// ARES UI: CSS injections, _aresRender, initAriaBrain, initARES, _demoTick, ARES_BRAIN_COLOR_OVERRIDE
//
// [R7 CONTRACT] This module is the SOLE writer of the `#ares-*` element
// subtree at runtime. `components/dock/ARESPanel.tsx` renders the static
// scaffold once and MUST NOT re-render — that invariant is enforced by
// moving the strip open/close toggle to a ref + classList.toggle in the
// component, so aresUI.ts writes are never wiped by React reconciliation.
// If a future change makes ARESPanel re-render, the R7 contract breaks
// and every imperative write below silently regresses to its JSX
// placeholder value ("CONF —%", "⚠ —", etc.).
//
// [R28 TRUST BOUNDARY] Remaining `.innerHTML =` writes below fall into
// two categories:
//   (a) SVG-shape/coord writes (neural brain, mission arc, progress bars,
//       history dots) — author-authored templates interpolating numeric
//       coords/colors from engine state. No user-influenced strings flow
//       into these.
//   (b) Thought-stream lines (line ~786) — each line is run through
//       escHtml() before interpolation; textContent-equivalent safety.
// All user-adjacent text (positions reason, decision reasons, badge
// label, wound/failure text) is now written via textContent or the
// _setIconText helper — cannot inject HTML.
// Full Option A (store+UI conversion, ~40 surfaces, multi-day scope) is
// tracked separately as R28.2 and deferred from the post-v2 lot series.

import { escHtml } from '../utils/dom'
import { fP } from '../utils/format'
import { _ZI } from '../constants/icons'
import { checkPendingOrders , renderDemoPositions, checkDemoPositionsSLTP } from '../data/marketDataPositions'
import { ARES_DECISION } from './aresDecision'
import { ARES_MIND } from './aresMind'
import { syncAresUIToStore } from './aresStoreSync'

const w = window as any

// [R28] Set element content as: <trusted-icon-svg> + textNode(trailingText).
// The icon SVG is author-controlled (_ZI.* constants). The trailingText is
// forced through textContent semantics — cannot inject HTML even if the
// upstream engine state contains angle brackets.
function _setIconText(el: HTMLElement, iconSvg: string, trailingText: string): void {
  while (el.firstChild) el.removeChild(el.firstChild)
  const tmpl = document.createElement('template')
  tmpl.innerHTML = iconSvg
  el.appendChild(tmpl.content)
  el.appendChild(document.createTextNode(trailingText))
}

;(function _aresCSS() {
  const s = document.createElement('style')
  s.textContent = `
  /* ══ ARES Strip Banner ══ */
  #ares-strip { background:transparent; border-bottom:none; margin:3px 6px; position:relative; }
  #ares-strip-bar { display:flex;align-items:center;justify-content:space-between;padding:0;min-height:44px;cursor:pointer;user-select:none;gap:0;transition:border-color .25s,box-shadow .25s;background:none;border:none;border-radius:10px;opacity:1;position:relative;overflow:hidden; }
  #ares-strip-bar:hover { }
  #ares-strip-title { font-size:13px;font-weight:700;letter-spacing:2px;color:#00d9ff;display:flex;align-items:center;gap:6px;font-family:monospace; }
  #ares-strip-badge { font-size:11px;padding:2px 6px;border-radius:999px;letter-spacing:1px;font-weight:700;border:1px solid currentColor;font-family:monospace;box-shadow:0 0 8px currentColor; }
  /* UI-2 closed: hide conf+imm+emotion */
  #ares-strip-conf,#ares-imm-span,#ares-emotion-span { display:none; }
  #ares-strip.open #ares-strip-conf,#ares-strip.open #ares-imm-span,#ares-strip.open #ares-emotion-span { display:inline; }
  #ares-strip-chev { font-size:8px;color:#00d9ff44;transition:transform .25s;flex-shrink:0;opacity:.35; }
  #ares-strip-panel { max-height:0;overflow:hidden;transition:max-height .5s cubic-bezier(.4,0,.2,1); }
  #ares-strip.open #ares-strip-panel { max-height:900px; }
  #ares-strip.open #ares-strip-chev { transform:rotate(180deg); }
  #ares-strip.open #ares-strip-bar { opacity:1; }

  /* ══ ARES Main Panel ══ */
  #ares-panel { background:linear-gradient(180deg,#00050f 0%,#000818 60%,#000d20 100%);padding:0;font-family:monospace;position:relative;overflow:hidden; }
  #ares-panel::before { content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 20%,#0080ff0a 0%,#00d9ff04 40%,transparent 75%);pointer-events:none;z-index:0; }

  /* ══ Neural Network Background Canvas ══ */
  #ares-neural-bg { position:absolute;inset:0;pointer-events:none;z-index:0;opacity:.35; }

  /* ══ Mission Arc ══ */
  #ares-arc-wrap { padding:12px 12px 0;position:relative;z-index:2; }
  #ares-arc-svg { width:100%;height:64px;display:block; }

  /* ══ Neural Brain Core ══ */
  #ares-core-wrap { display:flex;justify-content:center;align-items:center;padding:4px 0 0;position:relative;z-index:2; }
  #ares-core-svg { width:100%;max-width:480px;height:auto;display:block;overflow:visible; }

  /* ══ Cognitive Bar (sotto il brain) ══ */
  #ares-cog-bar { display:flex;align-items:center;gap:8px;margin:4px 12px 6px;z-index:2;position:relative; }
  #ares-cog-label { font-size:10px;color:#0080ff77;letter-spacing:2px;flex-shrink:0; }
  #ares-cog-track { flex:1;height:3px;background:#0080ff11;border-radius:2px;overflow:hidden; }
  #ares-cog-fill  { height:3px;background:linear-gradient(90deg,#0080ff,#00d9ff,#ffffff);border-radius:2px;transition:width .8s ease;box-shadow:0 0 6px #00d9ffaa; }
  #ares-cog-pct   { font-size:10px;color:#00d9ffaa;letter-spacing:1px;min-width:28px;text-align:right; }

  /* ══ Animations ══ */
  @keyframes aresHexPulse {
    0%,100% { opacity:.8;transform:scale(1); }
    50% { opacity:1;transform:scale(1.03); }
  }
  @keyframes aresNodePulse {
    0%,100% { opacity:.45; }
    50% { opacity:1; }
  }
  @keyframes aresRingRotate {
    from { transform:rotate(0deg); }
    to   { transform:rotate(360deg); }
  }
  @keyframes aresRingRotateRev {
    from { transform:rotate(0deg); }
    to   { transform:rotate(-360deg); }
  }
  @keyframes aresCoreDot {
    0%,100% { opacity:.5; }
    50%     { opacity:1; }
  }
  @keyframes aresLineFlow {
    0%   { stroke-dashoffset:40; opacity:.2; }
    50%  { opacity:.9; }
    100% { stroke-dashoffset:0; opacity:.2; }
  }
  @keyframes aresThoughtScroll {
    0%   { transform:translateY(0); }
    100% { transform:translateY(-50%); }
  }
  @keyframes aresGlitch {
    0%,94%,100% { transform:translateX(0); opacity:1; }
    95% { transform:translateX(-2px); opacity:.7; }
    97% { transform:translateX(3px); opacity:.8; }
    99% { transform:translateX(0); opacity:1; }
  }
  @keyframes aresBlink {
    0%,49%,100% { opacity:1; } 50%,99% { opacity:0; }
  }
  @keyframes aresParticleFloat {
    0%   { opacity:0; transform:translate(0,0) scale(.5); }
    30%  { opacity:.9; }
    100% { opacity:0; transform:translate(var(--px),var(--py)) scale(1.4); }
  }
  @keyframes aresBrainPulse {
    0%,100% { filter:drop-shadow(0 0 8px #00d9ff66) drop-shadow(0 0 20px #0080ff33); }
    50%     { filter:drop-shadow(0 0 16px #00d9ffcc) drop-shadow(0 0 40px #0080ff66) drop-shadow(0 0 60px #ffffff22); }
  }
  @keyframes aresCircuitFlow {
    0%   { stroke-dashoffset:200; opacity:.15; }
    50%  { opacity:.7; }
    100% { stroke-dashoffset:0; opacity:.15; }
  }
  @keyframes aresNodeAppear {
    0%   { r:1; opacity:0; }
    40%  { opacity:1; }
    80%  { r:4; opacity:.9; }
    100% { r:3; opacity:.6; }
  }

  /* ══ Thought Stream ══ */
  #ares-thought-wrap { height:68px;overflow:hidden;position:relative;margin:4px 12px;border:1px solid #0080ff18;border-radius:3px;background:#000510;z-index:2; }
  #ares-thought-wrap::before { content:'';position:absolute;top:0;left:0;right:0;height:18px;background:linear-gradient(180deg,#000510,transparent);z-index:3;pointer-events:none; }
  #ares-thought-wrap::after  { content:'';position:absolute;bottom:0;left:0;right:0;height:18px;background:linear-gradient(0deg,#000510,transparent);z-index:3;pointer-events:none; }
  #ares-thought-inner { position:absolute;width:100%; }
  .ares-thought-line { padding:2px 8px;font-size:11px;color:#0080ff55;letter-spacing:.5px;line-height:1.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
  .ares-thought-line.new { color:#00d9ffcc;text-shadow:0 0 8px #00d9ff66; }
  .ares-thought-line.alert { color:#ff6644cc; }

  /* ══ Stats row ══ */
  #ares-stats-row { display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin:6px 12px;border:1px solid #0080ff12;border-radius:3px;overflow:hidden;z-index:2;position:relative; }
  .ares-stat-cell { background:#000510;padding:5px 4px;text-align:center; }
  .ares-stat-label { font-size:10px;color:#0080ff44;letter-spacing:1.2px;margin-bottom:2px; }
  .ares-stat-val   { font-size:13px;font-weight:900;letter-spacing:1px; }
  .ares-stat-sub   { font-size:10px;color:#0080ff33;margin-top:1px; }

  /* ══ Last Lesson ══ */
  #ares-lesson-wrap { margin:6px 12px 10px;padding:7px 10px;background:#000510;border:1px solid #f0c04018;border-radius:3px;position:relative;z-index:2; }
  #ares-lesson-label { font-size:10px;color:#f0c04055;letter-spacing:2px;margin-bottom:4px; }
  #ares-lesson-text { font-size:11px;color:#f0c040aa;line-height:1.7;letter-spacing:.3px; }
  #ares-history-bar { display:flex;gap:2px;margin-top:6px; }
  .ares-hist-dot { width:14px;height:8px;border-radius:1px;flex-shrink:0; }

  /* ══ Scanlines overlay ══ */
  #ares-panel::after { content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,.08) 3px,rgba(0,0,0,.08) 4px);pointer-events:none;z-index:10; }
  `
  document.head.appendChild(s)
})()

// ── ARES Render — Supreme Neural Brain v109 ──────────────────────────────
export function _aresRender() {
  try { // [v119-p10 FIX] wrap complet — orice eroare internă NU mai aruncă uncaught → nu mai aprinde ENGINE ERROR banner
    // [R28.2-B] Dual-writer: mirror the derived UI state into the Zustand store
    // before imperative #ares-* writes. Store subscribers (components) can read
    // the same data without engine coupling. This call is side-effect-free on
    // the DOM — it only calls useAresStore.getState().patchUi(...).
    syncAresUIToStore()

    const panel = document.getElementById('ares-core-svg')
    if (!panel) return
    const st = w.ARES.getState()
    const col = st.current.color

    // Cognitive clarity from ARES_MIND
    const clarity = ARES_MIND.getClarity()
    const pulseSpeed = ARES_MIND.getPulseSpeed()
    const predAcc = ARES_MIND.getPredictionAccuracy()

    // [R28.2-C] Strip badge + conf + IMM + emotion are now React-owned
    // (components/dock/ares/{StripBadge,StripConf,ImmSpan,EmotionSpan}.tsx)
    // driven by useAresStore((s) => s.ui.core / .confidence / .immPct /
    // .cognitive.clarity / .emotion). The sync adapter at the top of
    // _aresRender populates those slices. No imperative write needed here.

    // 3) Mortal Wound (DEFENSIVE sau REVENGE_GUARD cu 3+ consecutive losses)
    try {
      const woundEl = document.getElementById('ares-wound-line')
      if (woundEl) {
        const isWounded = (st.current.id === 'DEFENSIVE' || st.current.id === 'REVENGE_GUARD') && st.consecutiveLoss >= 3
        if (isWounded) {
          woundEl.style.display = 'block'
          _setIconText(woundEl, _ZI.w, ' MORTAL WOUND — ' + st.consecutiveLoss + ' consecutive losses · Risk Reduced')
        } else {
          woundEl.style.display = 'none'
        }
      }
    } catch (_) { }

    // P0.7) Mission Failed — wallet depleted below minimum tradeable amount
    try {
      const bal = (typeof w.ARES !== 'undefined' && w.ARES.wallet) ? w.ARES.wallet.balance : 0
      const woundEl = document.getElementById('ares-wound-line')
      if (woundEl && bal < 5 && bal >= 0) {
        woundEl.style.display = 'block'
        woundEl.style.color = '#ff0044'
        _setIconText(woundEl, _ZI.skull, ' MISSION FAILED — Wallet depleted ($' + bal.toFixed(2) + '). REFILL to resume trading.')
      }
    } catch (_) { }

    // P0.7) Decision Engine status — show last decision summary
    try {
      if (typeof ARES_DECISION !== 'undefined') {
        const lastDec = ARES_DECISION.getLastDecision()
        const decEl = document.getElementById('ares-decision-line')
        if (decEl && lastDec) {
          if (lastDec.shouldTrade) {
            decEl.style.display = 'block'
            decEl.style.color = '#00ff88'
            _setIconText(decEl, _ZI.ok, ' DECISION: ' + String(lastDec.side) + ' — ' + lastDec.reasons.slice(0, 3).map((r: any) => String(r)).join(' · '))
          } else {
            decEl.style.display = 'block'
            decEl.style.color = '#ff8800'
            _setIconText(decEl, _ZI.pause, ' BLOCKED: ' + lastDec.reasons.slice(0, 2).map((r: any) => String(r)).join(' · '))
          }
        }
      }
    } catch (_) { }

    // [R28.2-D] Stage Progress, Objectives, Wallet block are React-owned
    // via <StageCol /> <ObjectivesCol /> <WalletCol /> subscribing to
    // ui.stage, ui.objectives, ui.objectivesTitle, ui.wallet.
    // [R28.2-E] Positions list + close-all + close-btn are React-owned via
    // <PositionsList />. Live vs demo close path discrimination preserved
    // inside the component.
    // [R28.2-F] Lob dots (frontal / temporal / occipital / cerebel / trunchi)
    // + consciousness dots (c0/c1/c2 + parietal seed/ascent/sovereign labels)
    // + mission-arc SVG are React-owned via <BrainDots /> and <MissionArc />
    // subscribing to ui.lobDots, ui.consciousnessActiveIdx, ui.missionArc.
    // No imperative SVG setAttribute from _aresRender anymore.

    // [R28.2-C] Cognitive bar React-owned via <CognitiveBar /> subscribing to
    // useAresStore((s) => s.ui.cognitive.clarity). No imperative write.

    // ── BRAIN SVG — Low-poly exact ca în imagine: creier lateral, fețe colorate, noduri albe ──
    const cx = 168, cy = 135

    // ══════════════════════════════════════════════════════════════════
    // 28 VERTECȘI — silueta exactă a creierului din imagine
    // Lateral stânga: frontal rotunjit stânga, parietal sus,
    // occipital ascuțit dreapta-jos, cerebel jos-dreapta, trunchi jos
    // ══════════════════════════════════════════════════════════════════
    const V = [
      // Contur exterior (0-15)
      { x: cx - 12, y: cy + 58 },  // 0  trunchi jos
      { x: cx - 35, y: cy + 45 },  // 1  temporal bas
      { x: cx - 68, y: cy + 22 },  // 2  frontal lateral jos
      { x: cx - 80, y: cy - 10 },  // 3  frontal lateral
      { x: cx - 74, y: cy - 44 },  // 4  frontal sus
      { x: cx - 50, y: cy - 70 },  // 5  frontal-parietal
      { x: cx - 15, y: cy - 84 },  // 6  coroana stânga
      { x: cx + 22, y: cy - 80 },  // 7  coroana dreapta
      { x: cx + 55, y: cy - 65 },  // 8  parietal sus
      { x: cx + 82, y: cy - 38 },  // 9  parietal lateral
      { x: cx + 88, y: cy - 5 },   // 10 parietal-occipital
      { x: cx + 78, y: cy + 28 },  // 11 occipital sus
      { x: cx + 62, y: cy + 52 },  // 12 occipital (ascuțit)
      { x: cx + 38, y: cy + 65 },  // 13 cerebel sus
      { x: cx + 14, y: cy + 70 },  // 14 cerebel centru
      { x: cx - 10, y: cy + 62 },  // 15 cerebel-trunchi
      // Noduri interioare (16-27)
      { x: cx - 52, y: cy - 28 },  // 16 frontal interior
      { x: cx - 28, y: cy - 56 },  // 17 frontal-parietal int
      { x: cx + 10, y: cy - 58 },  // 18 parietal interior sus
      { x: cx + 46, y: cy - 40 },  // 19 parietal interior
      { x: cx + 66, y: cy + 10 },  // 20 occipital interior
      { x: cx + 46, y: cy + 42 },  // 21 cerebel interior
      { x: cx + 14, y: cy + 48 },  // 22 cerebel-trunchi int
      { x: cx - 14, y: cy + 32 },  // 23 temporal interior
      { x: cx - 46, y: cy + 8 },   // 24 frontal-temporal int
      { x: cx - 10, y: cy - 18 },  // 25 centru
      { x: cx + 28, y: cy - 8 },   // 26 centru-dreapta
      { x: cx + 10, y: cy + 22 },  // 27 centru-jos
    ]

    // ══════════════════════════════════════════════════════════════════
    // TRIUNGHIURI — 36 fețe, organizate pe 6 zone cu culori diferite
    // z=0 frontal(roz/mov), z=1 parietal(alb), z=2 occipital(albastru deschis)
    // z=3 cerebel(albastru), z=4 trunchi(gri), z=5 interior(dark)
    // ══════════════════════════════════════════════════════════════════
    const TRIS = [
      // Frontal roz/mov
      { t: [0, 1, 24], z: 0 }, { t: [1, 2, 24], z: 0 }, { t: [2, 3, 16], z: 0 },
      { t: [2, 16, 24], z: 0 }, { t: [3, 4, 16], z: 0 }, { t: [4, 5, 17], z: 0 },
      { t: [4, 16, 17], z: 0 }, { t: [5, 6, 17], z: 0 },
      // Parietal alb-albastru
      { t: [6, 7, 17], z: 1 }, { t: [7, 8, 18], z: 1 }, { t: [6, 17, 18], z: 1 },
      { t: [7, 18, 19], z: 1 }, { t: [8, 9, 19], z: 1 }, { t: [9, 10, 19], z: 1 },
      // Occipital albastru deschis
      { t: [10, 11, 20], z: 2 }, { t: [9, 19, 20], z: 2 }, { t: [10, 20, 19], z: 2 },
      { t: [11, 12, 20], z: 2 },
      // Cerebel albastru mediu
      { t: [12, 13, 21], z: 3 }, { t: [13, 14, 22], z: 3 }, { t: [12, 21, 22], z: 3 },
      { t: [14, 15, 22], z: 3 },
      // Trunchi gri
      { t: [0, 15, 23], z: 4 }, { t: [15, 22, 23], z: 4 }, { t: [0, 23, 24], z: 4 },
      // Interior dark (centru creier)
      { t: [16, 17, 25], z: 5 }, { t: [17, 18, 25], z: 5 }, { t: [18, 19, 26], z: 5 },
      { t: [17, 25, 26], z: 5 }, { t: [19, 20, 26], z: 5 }, { t: [20, 21, 26], z: 5 },
      { t: [21, 22, 27], z: 5 }, { t: [22, 23, 27], z: 5 }, { t: [23, 24, 25], z: 5 },
      { t: [24, 16, 25], z: 5 }, { t: [25, 26, 27], z: 5 }, { t: [26, 20, 27], z: 5 },
    ]

    // Culori zone (A=luminos, B=întunecat) — puls alternant = efect 3D
    const ZC: any = [
      ['#e855a8', '#88226655'],  // 0 frontal roz/mov
      ['#d8e8ff', '#5577bb44'],  // 1 parietal alb-bleu
      ['#88ccff', '#1144aa33'],  // 2 occipital bleu deschis
      ['#5599ee', '#0a2a6633'],  // 3 cerebel bleu
      ['#3366aa', '#0a1a4422'],  // 4 trunchi gri-bleu
      ['#0d1a30', '#060e1ecc'],  // 5 interior dark
    ]

    // Noduri hot — se aprind mai tare (vârfurile mari din imagine)
    const HOT = new Set([0, 5, 6, 9, 12, 14, 17, 18, 20, 25, 26])

    // Edges deduplicate
    const _eSet = new Set(); const EDGES: any[] = []
    TRIS.forEach(({ t: [a, b, c] }: any) => {
      ;[[a, b], [b, c], [a, c]].forEach(([p, q]: any) => {
        const k = Math.min(p, q) + '-' + Math.max(p, q)
        if (!_eSet.has(k)) { _eSet.add(k); EDGES.push([p, q]) }
      })
    })

    // Zone anatomice (etichete MICI pe creier, nu lateral)
    const ZONES = [
      { name: 'FRONTAL', f1: 'Decizie\u00b7Risc', col: '#2962FF', lx: cx - 52, ly: cy - 8 },
      { name: 'PARIETAL', f1: 'Mi\u0219care\u00b7Sim\u021b', col: '#00E5FF', lx: cx + 18, ly: cy - 60 },
      { name: 'OCCIPITAL', f1: 'Vizual\u00b7Chart', col: '#00E5FF', lx: cx + 72, ly: cy + 14 },
      { name: 'CEREBEL', f1: 'Echilibru\u00b7SL', col: '#FFB000', lx: cx + 32, ly: cy + 58 },
      { name: 'TRUNCHI', f1: 'AutoTrade\u00b7Kill', col: '#C1121F', lx: cx - 12, ly: cy + 52 },
      { name: 'TEMPORAL', f1: 'Memorie\u00b7Timp', col: '#2962FF', lx: cx - 65, ly: cy + 18 },
    ]

    // ════════════════════════════ SVG BUILD ═══════════════════════════
    let svg = `
  <defs>
    <radialGradient id="bgG" cx="50%" cy="50%" r="55%">
      <stop offset="0%"   stop-color="#33006622"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
    <radialGradient id="pinkG" cx="30%" cy="58%" r="42%">
      <stop offset="0%"   stop-color="#cc224477"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
    <filter id="fN" x="-120%" y="-120%" width="340%" height="340%">
      <feGaussianBlur stdDeviation="3.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <ellipse cx="${cx - 25}" cy="${cy + 12}" rx="72" ry="68"
    fill="url(#pinkG)" style="animation:aresBrainPulse ${(pulseSpeed * 0.7).toFixed(1)}s ease-in-out infinite"/>
  <ellipse cx="${cx}" cy="${cy}" rx="105" ry="95" fill="url(#bgG)"/>
  `

    // Fețe triunghiuri — puls per față
    TRIS.forEach(({ t: [a, b, c], z }: any, i: any) => {
      const [ca, cb] = ZC[z]
      const pts = `${V[a].x},${V[a].y} ${V[b].x},${V[b].y} ${V[c].x},${V[c].y}`
      const light = (a + b + c) % 2 === 0
      const fill = light ? ca + '2a' : cb
      const dur = (2.8 + (i % 9) * 0.4).toFixed(1)
      const del = (i * 0.16 % 3.5).toFixed(2)
      svg += `<polygon points="${pts}" fill="${fill}"
      style="animation:aresNodePulse ${dur}s ease-in-out infinite ${del}s"/>`
    })

    // Muchii albe
    EDGES.forEach(([a, b]: any, i: any) => {
      const hot = HOT.has(a) || HOT.has(b)
      const op = hot ? '0.88' : '0.32'
      const lw = hot ? 1.3 : 0.65
      const dur = (2.0 + (i % 7) * 0.45).toFixed(1)
      svg += `<line x1="${V[a].x}" y1="${V[a].y}" x2="${V[b].x}" y2="${V[b].y}"
      stroke="white" stroke-width="${lw}" stroke-opacity="${op}"
      ${hot ? `style="animation:aresLineFlow ${dur}s linear infinite ${(i * 0.06).toFixed(2)}s"` : ''}/>`
    })

    // Noduri albe
    V.forEach((n: any, i: any) => {
      const hot = HOT.has(i)
      const r = hot ? 4.8 : 2.6
      const dur = (1.4 + (i % 8) * 0.28).toFixed(1)
      const del = (i * 0.12).toFixed(2)
      svg += `
    <circle cx="${n.x}" cy="${n.y}" r="${r + 6}" fill="white" opacity="0.05" filter="url(#fN)"/>
    <circle cx="${n.x}" cy="${n.y}" r="${r}" fill="white"
      style="filter:drop-shadow(0 0 ${hot ? 8 : 4}px white) drop-shadow(0 0 ${hot ? 16 : 6}px #88aaff);
             animation:aresNodePulse ${dur}s ease-in-out infinite ${del}s"/>`
    })

    // Particule curg pe muchii
    EDGES.filter((_: any, i: any) => i % 2 === 0).forEach(([a, b]: any, i: any) => {
      const dur = (1.5 + i * 0.2).toFixed(1)
      svg += `<circle r="2" fill="white" opacity="0.85"
      style="filter:drop-shadow(0 0 5px white)">
      <animateMotion dur="${dur}s" repeatCount="indefinite" begin="${(i * 0.22).toFixed(1)}s"
        path="M${V[a].x},${V[a].y} L${V[b].x},${V[b].y}"/>
    </circle>`
    })

    // Etichete mici pe creier
    ZONES.forEach((z: any, zi: any) => {
      const active = st.confidence > 30 + zi * 8
      const op = active ? '0.9' : '0.42'
      svg += `
    <circle cx="${z.lx}" cy="${z.ly}" r="3" fill="${z.col}" opacity="${op}"
      style="filter:drop-shadow(0 0 5px ${z.col})"/>
    <text x="${z.lx}" y="${z.ly - 7}" text-anchor="middle"
      font-family="monospace" font-size="6" font-weight="900"
      fill="${z.col}" opacity="${op}">${z.name}</text>
    <text x="${z.lx}" y="${z.ly + 5}" text-anchor="middle"
      font-family="monospace" font-size="4.5" fill="${z.col}" opacity="${Number(op) * 0.65}">${z.f1}</text>`
    })

    // Brain SVG randat O SINGURĂ DATĂ la init prin initAriaBrain()
    // _aresRender updatează doar badge/stats — nu mai rescrie SVG-ul
    if (!(panel as any).dataset.abInit) { initAriaBrain(); (panel as any).dataset.abInit = '1' }

    // ── THOUGHT STREAM cu date reale + cognitive insights ────────────────
    const thoughtInner = document.getElementById('ares-thought-inner') as any
    if (thoughtInner) {
      const mindInsight = ARES_MIND.getPatternInsight()
      const price = (typeof w.S !== 'undefined' && w.S.price > 0) ? fP(w.S.price) : '\u2014'
      const regime = (typeof w.BM !== 'undefined' ? w.BM.regime : null) || '\u2014'
      const cogLines = [
        `COGNITIV: ${mindInsight}`,
        `PREDIC\u021aIE: ${predAcc != null ? predAcc + '% acurate\u021be pe ultimele semnale' : '\u00een colectare date...'}`,
        `CLARITATE MENTAL\u0102: ${clarity}% \u2014 ${clarity > 75 ? 'OPTIMAL' : clarity > 50 ? 'ACCEPTABIL' : 'RECALIBREZ'}`,
        `PRE\u021a CURENT: ${price} \u2014 REGIM: ${regime}`,
      ]
      const combined = [...cogLines, ...st.thoughtLines, ...cogLines, ...st.thoughtLines]
      thoughtInner.style.animation = `aresThoughtScroll ${Math.max(14, combined.length * 1.2)}s linear infinite`
      thoughtInner.innerHTML = combined.map((l: any, i: any) => {
        const isCog = i < cogLines.length || (i >= st.thoughtLines.length + cogLines.length && i < combined.length - st.thoughtLines.length)
        const isAlert = l.toLowerCase().includes('alert\u0103') || l.toLowerCase().includes('recalib')
        return `<div class="ares-thought-line${i === 0 ? ' new' : isAlert ? ' alert' : isCog ? ' new' : ''}">
        <span style="color:${col}66">\u203a</span> ${escHtml(l)}
      </div>`
      }).join('')
    }

    // [R28.2-C] Stats row React-owned via <StatsRow /> subscribing to
    // useAresStore((s) => s.ui.stats). No imperative write.
    const st2 = w.ARES.getState(); void st2

    // [R28.2-F] Mission arc is React-owned via <MissionArc /> subscribing to
    // useAresStore((s) => s.ui.missionArc). No imperative SVG write.

    // Update lesson + cognitive insight
    const lessonEl = document.getElementById('ares-lesson-text')
    if (lessonEl) lessonEl.textContent = st2.lastLesson + '  |  ' + ARES_MIND.getPatternInsight()

    // Update history dots
    const histBar = document.getElementById('ares-history-bar')
    if (histBar && st2.tradeHistory.length) {
      histBar.innerHTML = st2.tradeHistory.map((ww: any) =>
        `<div class="ares-hist-dot" style="background:${ww ? '#0080ff66' : '#ff446666'};border:1px solid ${ww ? '#00d9ff' : '#ff4466'};box-shadow:0 0 4px ${ww ? '#00d9ff44' : '#ff446644'}"></div>`
      ).join('')
    }
  } catch (e: any) { console.warn('[_aresRender]', e && e.message ? e.message : e) } // [v119-p10 FIX]
}


// ══════════════════════════════════════════════════════════════════════
// ARIA BRAIN — Overlay exact cu 136 noduri detectate din imagine
// Chirurgical: doar SVG overlay + CSS scoped, zero impact pe restul app
// ══════════════════════════════════════════════════════════════════════
;(function _ariaBrainCSS() {
  const s = document.createElement('style')
  s.textContent = `
  /* ARIA BRAIN — scoped */
  #aria-brain-wrap { position:relative; width:100%; overflow:visible; }
  #aria-brain-svg  { width:100%; max-width:336px; height:auto; display:block; margin:0 auto; }

  @keyframes ariaPulse {
    0%,100% { opacity:.25; r:2.2; }
    50%      { opacity:.92;  r:3.6; }
  }
  @keyframes ariaHot {
    0%,100% { opacity:.40; r:3.5; }
    50%      { opacity:.95;  r:5.5; }
  }
  @keyframes ariaZone {
    0%,100% { opacity:.12; }
    50%      { opacity:.32; }
  }
  @keyframes ariaEdge {
    0%   { stroke-dashoffset:60; opacity:.08; }
    50%  { opacity:.45; }
    100% { stroke-dashoffset:0; opacity:.08; }
  }
  @keyframes ariaParticle {
    0%   { opacity:0; }
    20%  { opacity:.9; }
    80%  { opacity:.7; }
    100% { opacity:0; }
  }
  `
  document.head.appendChild(s)
})()

/* v114 micro CSS injected via style tag */
;(function _v114CSS() {
  const s = document.createElement('style')
  s.textContent = `
/* ═══════════════════════════════════════════════════════════════
   ARES v114 — micro additions: lob dots, stage progress, IMM, emotions
   SCOPED — zero impact pe restul app
   ═══════════════════════════════════════════════════════════════ */

/* ── Header bar extras ─────────────────────────────────────────── */
#ares-imm-span {
  font-size:11px; color:#f0c04088; letter-spacing:1px;
  font-family:monospace; white-space:nowrap;
}
#ares-wound-line {
  font-size:13px; color:#ff335588; letter-spacing:1px;
  font-family:monospace; padding:1px 10px 0;
  display:none;
}
#ares-decision-line {
  font-size:12px; letter-spacing:0.5px;
  font-family:monospace; padding:1px 10px 0;
  display:none;
}

/* ── Stage + Objectives row ────────────────────────────────────── */
#ares-meta-row {
  display:flex; justify-content:space-between; align-items:flex-start;
  padding:6px 12px 2px; gap:8px; position:relative; z-index:2;
}
#ares-stage-col {
  flex:0 0 auto; min-width:110px;
}
#ares-obj-col {
  flex:0 0 auto; text-align:right; min-width:130px;
}
.ares-meta-title {
  font-size:11px; letter-spacing:2px; color:#0080ff66;
  font-family:monospace; margin-bottom:2px; text-transform:uppercase;
}
.ares-stage-name {
  font-size:10px; color:#00ff88e8; font-family:monospace;
  letter-spacing:1px; font-weight:700;
}
.ares-prog-bar {
  font-size:13px; color:#00ff88bb; font-family:monospace;
  letter-spacing:0; margin-top:1px;
}
.ares-prog-next {
  font-size:12px; color:#0080ff99; font-family:monospace; margin-top:1px;
}
.ares-obj-item {
  font-size:13px; font-family:monospace; margin-bottom:3px;
  opacity:0.82; color:#8899aa;
}
.ares-obj-item.active { color:#00ff88cc; opacity:0.92; }
.ares-obj-item.done   { color:#00d9ff88; opacity:0.75; }
.ares-obj-bar {
  font-size:12px; font-family:monospace; color:#00ff8877; margin-top:0px;
}

/* ── Lob status dots (SVG text overlay — stilizare via fill/opacity pe SVG) */
/* Nimic extra CSS — se gestionează din JS setAttribute pe SVG text */

/* ── Emotion suffix pe badge ───────────────────────────────────── */
#ares-emotion-span {
  font-size:11px; color:#ffffff66; letter-spacing:1px;
  font-family:monospace; margin-left:2px;
}
`
  document.head.appendChild(s)
})()

/* v116 OBJECTIVES + POSITIONS CSS */
;(function _v116CSS() {
  const s = document.createElement('style')
  s.textContent = `
:root {
  --obj1: rgba(0,255,140,0.95);
  --obj2: rgba(70,200,255,0.95);
  --obj3: rgba(255,200,60,0.95);
}
/* Objectives v116 — bright, real progress */
.ares-obj-item {
  font-size:12px; font-family:monospace; margin-bottom:1px;
  letter-spacing:0.3px; opacity:1;
}
.ares-obj-item.active { font-weight:700; }
.ares-obj-item.done   { opacity:0.65; }
.ares-obj-bar {
  font-size:11px; font-family:monospace; margin-bottom:4px;
}

/* POSITIONS block */
#ares-positions-wrap {
  border-top: 1px solid rgba(0,150,255,0.12);
}
#ares-positions-list::-webkit-scrollbar { width:3px; }
#ares-positions-list::-webkit-scrollbar-thumb { background:rgba(0,200,255,0.25); border-radius:2px; }
#ares-close-all-btn:hover {
  background: rgba(255,50,50,0.3) !important;
  border-color: rgba(255,80,80,0.7) !important;
}
`
  document.head.appendChild(s)
})()

/* ── ARES META ROW — ALIGNMENT FIX (v118-2 patch) — v2 MOBILE SAFE ──
   Replace the previous (function _aresMetaLayoutFix(){...})(); block with this.
*/
;(function _aresMetaLayoutFix_v2() {
  const s = document.createElement('style')
  s.textContent = `
/* Base: stable 3-column grid, no overflow */
#ares-meta-row{
  display:grid !important;
  grid-template-columns: minmax(120px, 1fr) minmax(108px, .92fr) minmax(120px, 1fr) !important;
  align-items:start !important;
  gap: 8px !important;
  padding: 6px 10px 2px !important;
  box-sizing:border-box !important;
  width:100% !important;
}
#ares-stage-col, #ares-wallet-col, #ares-obj-col{
  min-width:0 !important;
  overflow:hidden !important;
  box-sizing:border-box !important;
}
#ares-stage-col{ padding-left: 14px !important; }
#ares-wallet-col{ padding: 0 4px !important; }
#ares-obj-col{ padding-right: 6px !important; }

/* Objectives: prevent bleed */
#ares-obj-col .ares-obj-item,
#ares-obj-col .ares-obj-bar{
  white-space:nowrap !important;
  overflow:hidden !important;
  text-overflow:ellipsis !important;
}

/* POSITIONS block: keep it off the hard-left edge */
#ares-positions-wrap{
  padding-left: 14px !important;
  padding-right: 12px !important;
  box-sizing:border-box !important;
}
/* Open positions cards are injected with inline padding;
   we shift them safely using margin-left (not overridden inline). */
#ares-positions-list > div{
  margin-left: 10px !important;
}
/* The "\u2014 none \u2014" placeholder is also a div; keep it aligned */
#ares-positions-list > div[style*="\u2014 none \u2014"]{
  margin-left: 10px !important;
}

/* ── MOBILE portrait tightening: pulls everything inward so Objectives never exits ── */
@media (max-width: 420px){
  #ares-meta-row{
    grid-template-columns: minmax(108px, 1fr) minmax(96px, .88fr) minmax(108px, 1fr) !important;
    gap: 6px !important;
    padding: 6px 6px 2px !important;
  }
  #ares-stage-col{ padding-left: 16px !important; }
  #ares-wallet-col{ padding: 0 2px !important; }
  #ares-obj-col{ padding-right: 4px !important; }

  /* Slightly tighter typography to avoid overflow */
  #ares-obj-col .ares-obj-item{ font-size: 11px !important; letter-spacing: .2px !important; }
  #ares-obj-col .ares-obj-bar{  font-size: 11px !important; }

  /* Positions: still not glued to the edge */
  #ares-positions-wrap{ padding-left: 12px !important; padding-right: 10px !important; }
  #ares-positions-list > div{ margin-left: 8px !important; }
}

/* ── Ultra-narrow devices (tiny phones): last resort safe clamp ── */
@media (max-width: 360px){
  #ares-meta-row{
    grid-template-columns: minmax(100px, 1fr) minmax(88px, .82fr) minmax(100px, 1fr) !important;
    gap: 5px !important;
    padding: 6px 5px 2px !important;
  }
  #ares-obj-col .ares-obj-item{ font-size: 12px !important; }
  #ares-obj-col .ares-obj-bar{  font-size: 11px !important; }
}
`
  document.head.appendChild(s)
})()

// ===============================
// ARES Desktop Readability Enhancement (CSS only, no logic)
// Makes all ARES panel text larger and more readable on desktop
// Mobile stays untouched via min-width media query
// ===============================
;(function _aresDesktopCSS() {
  const s = document.createElement('style')
  s.id = 'ares-desktop-readability'
  s.textContent = `
@media (min-width: 768px) {

  /* ── Strip Header Bar ── */
  #ares-strip-bar { height:44px !important; padding:0 14px !important; }
  #ares-strip-title { font-size:13px !important; letter-spacing:5px !important; gap:8px !important; }
  #ares-strip-title > span:first-child { font-size:15px !important; }
  #ares-strip-title > span:last-child { font-size:13px !important; letter-spacing:1.5px !important; }
  #ares-strip-badge { font-size:10px !important; padding:3px 10px !important; letter-spacing:1.2px !important; }
  #ares-strip-conf { font-size:10.5px !important; letter-spacing:1.2px !important; }
  #ares-strip-chev { font-size:11px !important; }
  #ares-imm-span { font-size:10px !important; letter-spacing:1.2px !important; }
  #ares-emotion-span { font-size:10px !important; }

  /* ── Wound / Decision Lines ── */
  #ares-wound-line { font-size:11px !important; padding:2px 14px 0 !important; }
  #ares-decision-line { font-size:11px !important; padding:3px 14px 0 !important; }

  /* ── Expand main panel max-height for larger content ── */
  #ares-strip.open #ares-strip-panel { max-height:1200px !important; }

  /* ── Meta Titles (STAGE PROGRESS, WALLET, OBJECTIVES, POSITIONS) ── */
  .ares-meta-title { font-size:13px !important; letter-spacing:2.5px !important; margin-bottom:3px !important; }

  /* ── Stage Progress ── */
  .ares-stage-name { font-size:14px !important; letter-spacing:1.5px !important; }
  .ares-prog-bar { font-size:12px !important; margin-top:2px !important; }
  .ares-prog-next { font-size:10.5px !important; margin-top:2px !important; }

  /* ── Wallet Column ── */
  #ares-wallet-col { min-width:140px !important; padding:0 10px !important; }
  #ares-wallet-balance { font-size:16px !important; letter-spacing:1.5px !important; }
  #ares-wallet-avail { font-size:13px !important; margin-top:2px !important; }
  #ares-wallet-add-btn { font-size:13px !important; padding:3px 10px !important; }
  #ares-wallet-withdraw-btn { font-size:13px !important; padding:3px 10px !important; }
  #ares-wallet-withdraw-tip { font-size:12px !important; }
  #ares-wallet-fail { font-size:13px !important; padding:2px 7px !important; }

  /* ── Objectives ── */
  .ares-obj-item { font-size:10.5px !important; margin-bottom:4px !important; letter-spacing:.4px !important; }
  .ares-obj-bar { font-size:13px !important; margin-bottom:5px !important; }

  /* ── Meta Row Grid — widen for larger text ── */
  #ares-meta-row {
    gap:12px !important;
    padding:8px 14px 4px !important;
  }

  /* ── Positions Block ── */
  #ares-positions-wrap { margin:6px 14px 0 !important; padding:6px 0 4px !important; }
  #ares-close-all-btn { font-size:13px !important; padding:3px 9px !important; }
  #ares-positions-list { max-height:280px !important; }
  /* Position cards — override deeply nested inline font-sizes */
  #ares-positions-list > div { margin-bottom:6px !important; padding:5px 8px !important; }
  #ares-positions-list > div span { font-size:10.5px !important; }
  #ares-positions-list > div button { font-size:13px !important; padding:3px 8px !important; }
  #ares-positions-list > div > div:nth-child(2) { font-size:13px !important; }
  #ares-positions-list > div > div:nth-child(3) { font-size:10.5px !important; }
  #ares-positions-list > div > div:nth-child(4) { font-size:13px !important; }

  /* ── Cognitive Clarity Bar ── */
  #ares-cog-bar { margin:6px 14px 8px !important; gap:10px !important; }
  #ares-cog-label { font-size:12px !important; letter-spacing:2.5px !important; }
  #ares-cog-track { height:5px !important; }
  #ares-cog-fill { height:5px !important; }
  #ares-cog-pct { font-size:13px !important; min-width:36px !important; }

  /* ── Stats Row (4-column) ── */
  #ares-stats-row { margin:8px 14px !important; gap:2px !important; }
  .ares-stat-cell { padding:7px 6px !important; }
  .ares-stat-label { font-size:11px !important; letter-spacing:1.5px !important; margin-bottom:3px !important; }
  .ares-stat-val { font-size:13px !important; letter-spacing:1.2px !important; }
  .ares-stat-sub { font-size:11px !important; margin-top:2px !important; }

  /* ── Thought Stream ── */
  #ares-thought-wrap { height:100px !important; margin:6px 14px !important; }
  .ares-thought-line { font-size:13px !important; padding:3px 10px !important; line-height:1.9 !important; letter-spacing:.6px !important; }

  /* ── Last Lesson ── */
  #ares-lesson-wrap { margin:8px 14px 12px !important; padding:9px 12px !important; }
  #ares-lesson-label { font-size:13px !important; letter-spacing:2.5px !important; margin-bottom:5px !important; }
  #ares-lesson-text { font-size:10px !important; line-height:1.8 !important; letter-spacing:.4px !important; }
  #ares-history-bar { gap:3px !important; margin-top:8px !important; }
  .ares-hist-dot { width:18px !important; height:10px !important; }

  /* ── Mission Arc SVG ── */
  #ares-arc-wrap { padding:14px 14px 0 !important; }
  #ares-arc-svg { height:72px !important; }

}
`
  document.head.appendChild(s)
})()

// ===============================
// ARES Brain Color Override (no-logic, CSS only)
// Re-map pink/purple/magenta -> science/power palette
// ===============================
export function ARES_BRAIN_COLOR_OVERRIDE() {
  try {
    if (document.getElementById('ares-brain-color-override')) return

    const css = `
/* --- TEXT (lob labels etc.) inline style colors --- */
#ares-strip [style*="#bb44ff"],
#ares-strip [style*="rgb(187, 68, 255)"] { color:#2962FF !important; } /* cobalt */

#ares-strip [style*="#ff66"],
#ares-strip [style*="#ff3355"],
#ares-strip [style*="rgb(255, 51, 85)"],
#ares-strip [style*="rgb(255, 102, 170)"] { color:#C1121F !important; } /* crimson */

#ares-strip [style*="#ff77ff"],
#ares-strip [style*="#ff55cc"],
#ares-strip [style*="rgb(255, 85, 204)"] { color:#2962FF !important; } /* cobalt */

/* --- SVG nodes: override exact old fills/strokes --- */
#ares-strip svg [fill="#bb44ff"],
#ares-strip svg [fill="rgb(187,68,255)"] { fill:#2962FF !important; }

#ares-strip svg [stroke="#bb44ff"],
#ares-strip svg [stroke="rgb(187,68,255)"] { stroke:#2962FF !important; }

#ares-strip svg [fill="#ff3355"],
#ares-strip svg [fill="rgb(255,51,85)"] { fill:#C1121F !important; }

#ares-strip svg [stroke="#ff3355"],
#ares-strip svg [stroke="rgb(255,51,85)"] { stroke:#C1121F !important; }

#ares-strip svg [fill="#39ff14"],
#ares-strip svg [stroke="#39ff14"] { fill:#00E5FF !important; stroke:#00E5FF !important; } /* cyan */

/* brainViz nodes */
#brainViz svg [fill="#bb44ff"],
#brainViz svg [stroke="#bb44ff"] { fill:#2962FF !important; stroke:#2962FF !important; }
#brainViz svg [fill="#ff3355"],
#brainViz svg [stroke="#ff3355"] { fill:#C1121F !important; stroke:#C1121F !important; }
#brainViz svg [fill="#39ff14"],
#brainViz svg [stroke="#39ff14"] { fill:#00E5FF !important; stroke:#00E5FF !important; }

/* --- neutral / inactive nodes (make colder, less cute) --- */
#ares-strip .b-node,
#ares-strip .brain-node,
#brainViz .b-node { stroke:#4B5D73 !important; }
`

    const st = document.createElement('style')
    st.id = 'ares-brain-color-override'
    st.textContent = css
    document.head.appendChild(st)
  } catch (e) { }
}
// self-invoke on import like the original IIFE
ARES_BRAIN_COLOR_OVERRIDE()

export function initAriaBrain() {
  try { // [v119-p12 FIX] outer try/catch — protejează setTimeout(initAriaBrain,200) de la boot (linia ~20526)
    // [v119-p9 FIX] Guard anti-double-init:
    // initAriaBrain() este apelata atât din setTimeout(200ms) cât și din _aresRender().
    // A doua apelare distruge DOM-ul primului RAF loop → TypeError necontrolat → ENGINE ERROR.
    // Soluție: flag global setat DOAR după ce panel-ul a fost găsit și inițializat cu succes.
    if (w.__ARIA_BRAIN_INIT__) return

    const panel = document.getElementById('ares-core-svg')
    if (!panel) return // nu setăm flag-ul — va putea reîncerca când ARES se deschide

    w.__ARIA_BRAIN_INIT__ = true // [v119-p9] setat DUPĂ confirmare panel valid

    // ── 136 noduri detectate programatic din imaginea de referință ──────
    console.log('[ARIA BRAIN] nodeCount =', 136)
    const BRAIN_NODES: any[] = [[175.8, 93.6], [105.6, 172.3], [106.7, 127.4], [91.9, 115.7], [84.0, 149.6], [167.4, 87.2], [224.9, 146.7], [192.7, 169.4], [217.0, 139.1], [177.9, 104.1], [122.5, 82.5], [131.5, 177.6], [136.7, 204.4], [112.5, 91.8], [84.0, 123.3], [92.4, 105.3], [184.3, 164.2], [164.7, 125.7], [59.7, 82.5], [154.2, 161.2], [148.4, 92.4], [141.0, 192.1], [204.3, 95.3], [247.1, 122.7], [93.5, 175.2], [114.6, 250.5], [38.0, 104.1], [53.3, 161.8], [170.0, 230.1], [249.2, 132.7], [238.1, 202.6], [152.6, 141.4], [289.8, 233.6], [113.0, 79.6], [278.2, 107.6], [75.0, 11.9], [213.3, 200.3], [136.2, 142.6], [94.0, 132.1], [100.9, 179.9], [100.9, 95.9], [101.4, 199.7], [74.5, 151.9], [40.1, 178.7], [164.7, 149.0], [183.7, 87.8], [197.5, 100.6], [173.7, 133.2], [139.9, 78.4], [119.3, 179.3], [60.2, 199.7], [123.0, 63.3], [118.3, 128.0], [166.8, 175.2], [128.3, 122.7], [226.5, 88.9], [162.6, 114.0], [149.4, 179.3], [80.3, 199.1], [71.8, 130.3], [74.5, 77.8], [230.2, 156.0], [70.2, 169.4], [180.0, 68.5], [261.9, 141.4], [80.3, 90.7], [105.1, 140.8], [111.9, 155.4], [245.0, 178.7], [77.6, 182.2], [153.6, 100.0], [156.3, 64.4], [220.2, 74.3], [201.2, 152.5], [124.1, 111.7], [122.5, 51.0], [104.5, 83.1], [201.7, 185.7], [72.3, 103.5], [107.2, 209.6], [73.9, 116.9], [80.8, 158.3], [252.9, 110.5], [217.0, 179.3], [184.8, 137.3], [170.0, 213.1], [146.8, 125.1], [180.6, 153.1], [94.5, 160.1], [132.5, 156.6], [160.0, 30.6], [231.2, 36.4], [203.3, 77.3], [183.2, 116.9], [96.6, 218.4], [114.6, 233.6], [76.6, 46.3], [103.0, 228.9], [128.8, 268.0], [75.0, 62.7], [34.3, 82.5], [306.2, 107.6], [203.8, 173.5], [307.8, 191.0], [120.9, 195.1], [191.1, 209.6], [236.0, 191.6], [158.4, 207.3], [243.9, 72.6], [145.7, 114.0], [126.7, 101.8], [294.1, 107.6], [227.5, 121.0], [198.5, 124.5], [279.3, 188.1], [186.4, 195.1], [240.7, 233.6], [44.9, 200.3], [212.2, 229.5], [166.8, 261.6], [121.4, 37.0], [289.8, 195.6], [238.1, 266.2], [44.4, 82.5], [224.9, 105.8], [205.9, 111.7], [223.9, 163.0], [60.7, 135.6], [95.0, 206.1], [262.9, 153.1], [90.3, 184.6], [165.8, 201.5], [123.6, 208.5], [161.0, 183.4], [36.4, 229.5], [28.0, 182.8]]
    const N = BRAIN_NODES.length

    // ── Noduri "hot" — cele mai luminoase (detecție prin intensitate) ───
    // Indecșii corespund nodurilor cu clustering-size mare (>80px)
    const HOT_IDX = new Set([0, 5, 9, 22, 23, 29, 31, 34, 55, 63, 72, 82, 91, 92, 101, 108, 111, 112, 124, 125])

    // ── Conexiuni: fiecare nod se conectează la cei mai apropiați 2-3 vecini
    function buildEdges(nodes: any[], maxDist = 52, maxPer = 3) {
      const edges: any[] = []
      const used = new Set()
      for (let i = 0; i < nodes.length; i++) {
        const [ax, ay] = nodes[i]
        // distanțe la toți ceilalți
        const dists = nodes.map(([bx, by]: any, j: any) => ({ j, d: Math.hypot(bx - ax, by - ay) }))
          .filter(({ j, d }: any) => j !== i && d < maxDist)
          .sort((a: any, b: any) => a.d - b.d)
          .slice(0, maxPer)
        for (const { j } of dists) {
          const key = Math.min(i, j) + '-' + Math.max(i, j)
          if (!used.has(key)) { used.add(key); edges.push([i, j]) }
        }
      }
      return edges
    }
    const EDGES = buildEdges(BRAIN_NODES, 50, 3)

    // ── Cele 6 zone anatomice (coordonate centroid în spațiul SVG) ──────
    // Poziționate corect pe creierul lateral din imagine
    const ZONES = [
      { name: 'Lobul frontal', sub: 'Decizie \u00b7 Planificare', cx: 85, cy: 110, r: 52, col: '#2962FF', pinX: 87, pinY: 80 },
      { name: 'Lobul parietal', sub: 'Mi\u0219care \u00b7 Senza\u021bii', cx: 190, cy: 95, r: 55, col: '#00E5FF', pinX: 155, pinY: 30 },
      { name: 'Lobul temporal', sub: 'Memorie \u00b7 Auz', cx: 100, cy: 175, r: 45, col: '#2962FF', pinX: 87, pinY: 178 },
      { name: 'Lobul occipital', sub: 'Vizual \u00b7 Chart', cx: 240, cy: 145, r: 48, col: '#00E5FF', pinX: 253, pinY: 125 },
      { name: 'Cerebelul', sub: 'Echilibru \u00b7 SL/TP', cx: 195, cy: 215, r: 42, col: '#FFB000', pinX: 218, pinY: 248 },
      { name: 'Trunchi cerebral', sub: 'AutoTrade \u00b7 Kill-switch', cx: 140, cy: 215, r: 35, col: '#C1121F', pinX: 127, pinY: 232 },
    ]

    // ── BUILD SVG ────────────────────────────────────────────────────────
    let svg = `
  <defs>
    <filter id="abFN" x="-150%" y="-150%" width="400%" height="400%">
      <feGaussianBlur stdDeviation="4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="abHot" x="-150%" y="-150%" width="400%" height="400%">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <radialGradient id="abPink" cx="32%" cy="58%" r="40%">
      <stop offset="0%" stop-color="#cc224488"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
    <radialGradient id="abBlue" cx="70%" cy="40%" r="45%">
      <stop offset="0%" stop-color="#0044aa44"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
  </defs>
    <ellipse cx="90" cy="155" rx="80" ry="70" fill="url(#abPink)"
    style="animation:ariaZone 3.5s ease-in-out infinite"/>
  <ellipse cx="230" cy="120" rx="85" ry="75" fill="url(#abBlue)"
    style="animation:ariaZone 4.2s ease-in-out infinite 0.8s"/>
  `

    // Zone highlights (contur discret + puls)
    ZONES.forEach((z: any, zi: any) => {
      const dur = (2.8 + zi * 0.45).toFixed(1)
      const del = (zi * 0.6).toFixed(1)
      svg += `
    <ellipse cx="${z.cx}" cy="${z.cy}" rx="${z.r}" ry="${z.r * 0.72}"
    fill="none" stroke="${z.col}" stroke-width="1" stroke-opacity="0.35"
    stroke-dasharray="5 4"
    style="animation:ariaZone ${dur}s ease-in-out infinite ${del}s"/>`
    })

    // Edges (linii subțiri albe)
    EDGES.forEach(([a, b]: any, i: any) => {
      const [ax, ay] = BRAIN_NODES[a], [bx, by] = BRAIN_NODES[b]
      const hot = HOT_IDX.has(a) || HOT_IDX.has(b)
      const op = hot ? '0.55' : '0.22'
      const lw = hot ? 1.0 : 0.55
      const dur = (2.5 + (i % 8) * 0.4).toFixed(1)
      svg += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"
    stroke="white" stroke-width="${lw}" stroke-opacity="${op}"
    ${hot ? `stroke-dasharray="6 3" style="animation:ariaEdge ${dur}s linear infinite ${(i * 0.05 % 2).toFixed(2)}s"` : ''}/>`
    })

    // Noduri (136 bucăți exacte) — neuron-star shape, RAF-driven wave
    // PRNG seeded pentru colorGroup stabil
    let _cSeed = 0x7F3A9C21
    function _cPrng() { _cSeed ^= _cSeed << 13; _cSeed ^= _cSeed >> 17; _cSeed ^= _cSeed << 5; return ((_cSeed >>> 0) / 0xFFFFFFFF) }

    // 25% noduri colored, 75% alb
    const ACCENT_COLS = [
      '#00E5FF', // electric cyan (science/online)
      '#2962FF', // cobalt (authority)
      '#FFB000', // amber (action/exec)
      '#C1121F', // deep crimson (risk/fail)
      '#B0BEC5'  // steel/silver (neutral hardware)
    ]
    const NODE_ACCENT: any[] = BRAIN_NODES.map((_: any, i: any) => {
      const hot = HOT_IDX.has(i)
      if (hot) return ACCENT_COLS[Math.floor(_cPrng() * ACCENT_COLS.length)] // hot=colored
      return _cPrng() < 0.22 ? ACCENT_COLS[Math.floor(_cPrng() * ACCENT_COLS.length)] : null // 22% colored
    })

    // Generare path neuron-star: nucleu + 4 spikes asimetrice
    function _starPath(cx: any, cy: any, rCore: any, nSpikes: any, spikeLen: any) {
      let d = ''
      for (let s = 0; s < nSpikes; s++) {
        const ang = (s / nSpikes) * Math.PI * 2
        const angB = ang + Math.PI / nSpikes
        const ox1 = cx + Math.cos(ang) * rCore
        const oy1 = cy + Math.sin(ang) * rCore
        const ox2 = cx + Math.cos(ang) * (rCore + spikeLen)
        const oy2 = cy + Math.sin(ang) * (rCore + spikeLen)
        const mx = cx + Math.cos(angB) * rCore * 0.45
        const my = cy + Math.sin(angB) * rCore * 0.45
        d += `M${ox1.toFixed(2)},${oy1.toFixed(2)} L${ox2.toFixed(2)},${oy2.toFixed(2)} L${mx.toFixed(2)},${my.toFixed(2)} `
      }
      return d.trim()
    }

    BRAIN_NODES.forEach(([x, y]: any, i: any) => {
      const hot = HOT_IDX.has(i)
      const rCore = hot ? 2.8 : 1.6
      const nSpikes = hot ? 6 : 4
      const spikeL = hot ? 3.5 : 2.2
      const baseOp = hot ? 0.70 : 0.28
      const accentCol = NODE_ACCENT[i]
      const fillCol = accentCol || 'white'
      const glowCol = accentCol || '#aaccff'
      const starD = _starPath(x, y, rCore, nSpikes, spikeL)
      svg += `
  <circle id="abn-g${i}" cx="${x}" cy="${y}" r="${rCore + 5}" fill="${fillCol}" opacity="0.03" filter="url(#abFN)"/>
  <circle id="abn-c${i}" cx="${x}" cy="${y}" r="${rCore}" fill="${fillCol}" opacity="${baseOp}"
    style="filter:drop-shadow(0 0 ${hot ? 9 : 3}px ${glowCol}) drop-shadow(0 0 ${hot ? 16 : 6}px ${glowCol})"/>
  <path  id="abn-${i}"  d="${starD}" fill="${fillCol}" opacity="${(baseOp * 0.7).toFixed(2)}"
    stroke="${fillCol}" stroke-width="0.3" stroke-opacity="0.5"/>`
    })

    // Particule pe edges hot
    EDGES.filter((_: any, i: any) => HOT_IDX.has(EDGES[i]?.[0]) || HOT_IDX.has(EDGES[i]?.[1])).slice(0, 20).forEach(([a, b]: any, i: any) => {
      const [ax, ay] = BRAIN_NODES[a], [bx, by] = BRAIN_NODES[b]
      const dur = (1.4 + i * 0.18).toFixed(1)
      svg += `<circle r="2" fill="white" opacity="0.85"
    style="filter:drop-shadow(0 0 5px white)">
    <animateMotion dur="${dur}s" repeatCount="indefinite" begin="${(i * 0.3).toFixed(1)}s"
      path="M${ax},${ay} L${bx},${by}"/>
  </circle>`
    })

    // Etichete zone cu pin + linie
    ZONES.forEach((z: any, zi: any) => {
      const dur = (3.0 + zi * 0.5).toFixed(1)
      const del = (zi * 0.55).toFixed(1)
      const isLeft = z.pinX < 130
      const isBottom = z.pinY > 250
      const ta = isLeft ? 'end' : isBottom ? 'middle' : 'start'
      const lx2 = isLeft ? z.pinX + 32 : isBottom ? z.pinX : z.pinX - 32
      const ly2 = isBottom ? z.pinY - 12 : z.pinY
      svg += `
  ${zi === 1 ? `
  ` : ''}
  <circle cx="${z.cx}" cy="${z.cy}" r="3.5" fill="${z.col}"
    style="filter:drop-shadow(0 0 6px ${z.col});animation:ariaHot ${dur}s ease-in-out infinite ${del}s"/>
  <line x1="${z.cx}" y1="${z.cy}" x2="${lx2}" y2="${ly2}"
    stroke="${z.col}" stroke-width="0.8" stroke-opacity="0.7" stroke-dasharray="4 3"/>
  <text x="${z.pinX}" y="${isBottom ? z.pinY + 12 : z.pinY - 8}" text-anchor="${ta}"
    font-family="monospace" font-size="7" font-weight="900"
    fill="${z.col}" style="filter:drop-shadow(0 0 5px ${z.col})88;opacity:0.88">${z.name}</text>
  <text x="${z.pinX}" y="${isBottom ? z.pinY + 21 : z.pinY + 2}" text-anchor="${ta}"
    font-family="monospace" font-size="5" fill="${z.col}" opacity="0.62">${z.sub}</text>`
    })


    // ── LOB STATUS DOTS — adăugate ca SVG <g> DUPĂ etichete ─────────────────
    // SEED / ASCENT / SOVEREIGN — în Lobul parietal (zi=1, pinX=155, pinY=30)
    // Dot-uri micro sub fiecare label de lob
    // Format: ● STATUS_TEXT (verde/rosu/galben)
    const LOB_DOTS: any[] = [
      // [ zi, offsetY, dotId, defaultText, defaultLevel ]
      [0, 14, 'ldot-frontal', 'POLICY: BALANCED', 'ok'],  // Lobul frontal, sub sub-text
      [1, 14, 'ldot-parietal', '', 'ok'],  // Lobul parietal — consciousness
      [2, 14, 'ldot-temporal', 'MEMORY: OK', 'ok'],  // Lobul temporal
      [3, 14, 'ldot-occipital', 'VISION: CLEAR', 'ok'],  // Lobul occipital
      [4, 14, 'ldot-cerebel', 'EXEC: \u2014', 'warn'],  // Cerebelul
      [5, 14, 'ldot-trunchi', 'SURVIVAL: STABLE', 'ok'],  // Trunchi cerebral
    ]
    const DOT_COLORS: any = { ok: '#00ff88', bad: '#ff3355', warn: '#f0c040' }

    LOB_DOTS.forEach(([zi, offY, dotId, txt, lvl]: any) => {
      const z = ZONES[zi]
      const isB = z.pinY > 250
      const isL = z.pinX < 130
      const ta = isL ? 'end' : isB ? 'middle' : 'start'
      const baseY = isB ? z.pinY + 21 : z.pinY + 2  // exact unde e sub-textul
      const dotY = baseY + offY
      const col = DOT_COLORS[lvl] || DOT_COLORS.warn

      if (zi === 1) {
        // Parietal: CONSCIOUSNESS cu 3 dots
        svg += `
  <circle id="ldot-c0" cx="${z.pinX + (isL ? -6 : 6)}" cy="${dotY - 1}" r="2.2" fill="#00ff88" opacity="0.85"
    style="filter:drop-shadow(0 0 3px #00ff88)"/>
  <text id="ldot-parietal-seed" x="${z.pinX + (isL ? -11 : 11)}" y="${dotY + 1}" text-anchor="${ta}"
    font-family="monospace" font-size="5" fill="#00ff88" opacity="0.82">SEED</text>
  <circle id="ldot-c1" cx="${z.pinX + (isL ? -6 : 6)}" cy="${dotY + 8}" r="2.2" fill="#555577" opacity="0.6"/>
  <text id="ldot-parietal-ascent" x="${z.pinX + (isL ? -11 : 11)}" y="${dotY + 10}" text-anchor="${ta}"
    font-family="monospace" font-size="5" fill="#7788aa" opacity="0.55">ASCENT</text>
  <circle id="ldot-c2" cx="${z.pinX + (isL ? -6 : 6)}" cy="${dotY + 16}" r="2.2" fill="#555577" opacity="0.6"/>
  <text id="ldot-parietal-sovereign" x="${z.pinX + (isL ? -11 : 11)}" y="${dotY + 18}" text-anchor="${ta}"
    font-family="monospace" font-size="5" fill="#7788aa" opacity="0.55">SOVEREIGN</text>`
      } else {
        svg += `
  <circle id="${dotId}-c" cx="${z.pinX + (isL ? -6 : 6)}" cy="${dotY - 1}" r="2.2" fill="${col}" opacity="0.85"
    style="filter:drop-shadow(0 0 3px ${col})"/>
  <text id="${dotId}" x="${z.pinX + (isL ? -11 : 11)}" y="${dotY + 1}" text-anchor="${ta}"
    font-family="monospace" font-size="5" fill="${col}" opacity="0.75">${txt}</text>`
      }
    })

    panel.innerHTML = svg
    console.log('[ARIA BRAIN] nodeCount =', N)

    // ══ NEURON STARFIELD — RAF WAVE ENGINE v113 ══════════════════════════
    // prefers-reduced-motion guard
    const _reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Referințe DOM — preluate O SINGURĂ DATĂ (nu re-creăm nimic)
    const _elCore = BRAIN_NODES.map((_: any, i: any) => document.getElementById('abn-c' + i)) // nucleu
    const _elStar = BRAIN_NODES.map((_: any, i: any) => document.getElementById('abn-' + i))  // spikes path
    const _elGlow = BRAIN_NODES.map((_: any, i: any) => document.getElementById('abn-g' + i)); void _elGlow // halo glow

    // Per-nod: baseOp, faza individuala, coordonate normalizate, distanta centru
    const CX = 160, CY = 145
    const _BOP = BRAIN_NODES.map((_: any, i: any) => HOT_IDX.has(i) ? 0.62 : 0.26)
    const _PHASE = BRAIN_NODES.map((_: any, i: any) => (i * 2.39996) % (Math.PI * 2)) // golden angle
    const _NX = BRAIN_NODES.map(([x]: any) => x / 336)
    const _NY = BRAIN_NODES.map(([, y]: any) => y / 280)
    const _NDIST = BRAIN_NODES.map(([x, y]: any) => Math.hypot(x - CX, y - CY) / 180) // norm 0..1

    // Wave modes: LR=0, TB=1, DIAG=2, RADIAL=3
    let _waveMode = 0
    let _waveModeTimer = Date.now()
    const WAVE_CYCLE = 8000 // ms per mode

    // Parametri wave
    const WAVE_SPEED = 0.42
    const WAVE_SCALE = 2.8
    const WAVE_AMP = 0.52
    const _WAVE_BASE = 0.26; void _WAVE_BASE // NU e folosit direct; folsoim _BOP per nod
    const WAVE_MIN = 0.18 // hard floor
    const WAVE_MAX = 0.95 // hard ceil

    // ARES color overlay (subtil, lerp spre alb)
    let _waveColor: any = null; void _waveColor // null = white
    let _waveColorAlpha = 0; void _waveColorAlpha

    if (_reducedMotion) {
      // Fara animatie: setam base opacity si gata
      BRAIN_NODES.forEach((_: any, i: any) => {
        if (_elCore[i]) _elCore[i]!.setAttribute('opacity', _BOP[i].toFixed(3))
        if (_elStar[i]) _elStar[i]!.setAttribute('opacity', (_BOP[i] * 0.65).toFixed(3))
      })
      console.log('[ARIA BRAIN] reduced-motion: static base opacity set')
    } else {
      // RAF loop principal
      let _rafId: any = null; void _rafId
      function _waveFrame() {
        try { // [v119-p12 FIX] RAF body wrapped — uncaught din setAttribute/DOM nu mai aprinde banner
          const t = performance.now() * 0.001

          // Rotate wave mode la fiecare WAVE_CYCLE ms
          if (Date.now() - _waveModeTimer > WAVE_CYCLE) {
            _waveMode = (_waveMode + 1) % 4
            _waveModeTimer = Date.now()
          }

          for (let i = 0; i < N; i++) {
            // w = directional coordinate [0..1] in functie de mode
            let ww: any
            switch (_waveMode) {
              case 0: ww = _NX[i]; break // LR
              case 1: ww = _NY[i]; break // TB
              case 2: ww = (_NX[i] + _NY[i]) * 0.5; break // DIAG
              case 3: ww = _NDIST[i]; break // RADIAL
            }

            // Sinusoida de val: fara random per-frame
            const pulse = 0.5 + 0.5 * Math.sin(
              WAVE_SCALE * ww * Math.PI * 2 - t * WAVE_SPEED * Math.PI * 2 + _PHASE[i]
            )

            // Alpha clamped
            const alpha = Math.min(WAVE_MAX, Math.max(WAVE_MIN,
              _BOP[i] + WAVE_AMP * pulse
            ))
            // Star spikes: mai subtile (alpha*0.62)
            const alphaS = Math.min(0.85, alpha * 0.62)

            // Culoare: accent daca pulse > 0.72, altfel white
            const accCol = NODE_ACCENT[i]
            let _fillCol = 'white'
            if (accCol && pulse > 0.68) {
              // Lerp spre accent color: culoarea apare doar la varf
              const _blend = (pulse - 0.68) / 0.32; void _blend // 0..1
              // Aplicam fill = accent cu alpha*blend, altfel white
              _fillCol = accCol // SVG fill e solid, lucram cu opacity
            }
            void _fillCol

            const el = _elCore[i]
            const es = _elStar[i]
            if (el) {
              el.setAttribute('opacity', alpha.toFixed(3))
              if (accCol && pulse > 0.68) el.setAttribute('fill', accCol)
              else el.setAttribute('fill', 'white')
            }
            if (es) es.setAttribute('opacity', alphaS.toFixed(3))
          }

          _rafId = requestAnimationFrame(_waveFrame)
        } catch (e: any) { console.warn('[ARIA BRAIN RAF]', e && e.message ? e.message : e) /* nu re-schedule pe eroare */ }
      }
      _rafId = requestAnimationFrame(_waveFrame)
      console.log('[ARIA BRAIN] neuron-starfield RAF wave active, mode=LR')

      // Expune API extern pentru schimbare culoare din ARES state
      const STATE_COLORS: any = {
        'FOCUSED': '#f0c040',
        'STRATEGIC': '#00d9ff',
        'DEFENSIVE': '#ff4455',
        'RESILIENT': '#00ff88',
        'DETERMINED': '#aaccff',
      }

      function _readAresState() {
        const badge = document.getElementById('ares-strip-badge')
        if (!badge) return null
        const txt = badge.textContent!.trim().toUpperCase()
        for (const k of Object.keys(STATE_COLORS)) {
          if (txt.includes(k)) return k
        }
        return null
      }

      // Override accent colors pe noduri colored in functie de starea ARES
      w._ariaBrainWave = function (stateName: any) {
        const col = STATE_COLORS[stateName]
        if (!col) return
        // Propagare din centru: delay per dist
        BRAIN_NODES.forEach((_: any, i: any) => {
          if (!NODE_ACCENT[i]) return
          const delayMs = _NDIST[i] * 1800
          setTimeout(() => {
            try { // [v119-p12 FIX] async setTimeout — scapă din outer try/catch
              NODE_ACCENT[i] = col
              setTimeout(() => {
                try { NODE_ACCENT[i] = ACCENT_COLS[Math.floor(Math.abs(Math.sin(i * 7.3)) * ACCENT_COLS.length)] } catch (_) { }
              }, 4000)
            } catch (_) { }
          }, delayMs)
        })
      }

      // Auto-init wave la open panel
      setTimeout(() => {
        const st = _readAresState()
        if (st) w._ariaBrainWave(st)
      }, 1000)

      // Observer badge schimbare
      const _badgeEl = document.getElementById('ares-strip-badge')
      if (_badgeEl && window.MutationObserver) {
        new MutationObserver(() => {
          try { // [v119-p12 FIX]
            const st = _readAresState()
            if (st) w._ariaBrainWave(st)
          } catch (_) { }
        }).observe(_badgeEl, { childList: true, subtree: true, characterData: true })
      }
    }

    console.log('[ARIA BRAIN] neuron-starfield v113 init complete, nodes=', N)
  } catch (e: any) { w.__ARIA_BRAIN_INIT__ = false; console.warn('[ARIA BRAIN] initAriaBrain error:', e && e.message ? e.message : e) } // [v119-p12 FIX] rollback flag → permite re-încercare la următorul _aresRender
}

// ── initARES — inserează panoul în UI ─────────────────────────────────────
export function initARES() {
  if (document.getElementById('ares-strip')) return
  const pmStrip = document.getElementById('pm-strip')
  const srStrip = document.getElementById('sr-strip')
  const anchor = pmStrip || srStrip
  if (!anchor) return

  const wrap = document.createElement('div')
  wrap.id = 'ares-strip'
  wrap.innerHTML = `
    <div id="ares-strip-bar" onclick="this.closest('#ares-strip').classList.toggle('open');_aresRender()">
      <div class="v6-accent"><div class="v6-ico"><svg viewBox="0 0 24 24"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="8"/><line x1="22" y1="8.5" x2="16" y2="12"/><line x1="12" y1="22" x2="12" y2="16"/><line x1="2" y1="8.5" x2="8" y2="12"/></svg></div><span class="v6-lbl">ARES</span></div>
      <div class="v6-content">
        <div id="ares-strip-title">
          <span>ARES</span>
          <span style="font-size:11px;color:#00d9ff44;letter-spacing:1px">NEURAL COMMAND</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span id="ares-strip-badge" style="color:#00d9ff;border-color:#00d9ff88">${_ZI.bolt} DETERMINED</span>
          <span id="ares-strip-conf" style="font-size:11px;color:#00d9ff66">CONF \u2014%</span><span id="ares-imm-span"> \u00b7 IMM \u2014%</span><span id="ares-emotion-span"></span>
          <span id="ares-strip-chev">\u25bc</span>
        </div>
      </div>
    </div>
    <div id="ares-wound-line">${_ZI.w} \u2014</div>
    <div id="ares-decision-line" style="display:none;font-size:12px;padding:2px 8px;font-family:monospace;"></div>
    <div id="ares-strip-panel">
      <div id="ares-panel">

                <div id="ares-meta-row">
          <div id="ares-stage-col">
            <div class="ares-meta-title">STAGE PROGRESS</div>
            <div class="ares-stage-name" id="ares-stage-name">SEED</div>
            <div class="ares-prog-bar" id="ares-prog-bar">\u2588\u2588\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591 0%</div>
            <div class="ares-prog-next" id="ares-prog-next">Next: 1,000</div>
          </div>

                    <div id="ares-wallet-col" style="flex:0 0 auto;min-width:110px;text-align:center;border-left:1px solid rgba(0,150,255,0.12);border-right:1px solid rgba(0,150,255,0.12);padding:0 8px">
            <div class="ares-meta-title" style="text-align:center">WALLET</div>
            <div id="ares-wallet-balance" style="font-family:monospace;font-size:11px;font-weight:700;color:#00ff88;letter-spacing:1px">$0.00</div>
            <div id="ares-wallet-avail" style="font-family:monospace;font-size:11px;color:#6a9a7a;margin-top:1px">Avail: <span id="ares-wallet-avail-val">$0</span> \u00b7 Rest To Trade: <span id="ares-wallet-lock-val">$0</span></div>
            <div style="margin-top:4px;display:flex;align-items:center;justify-content:center;gap:4px;flex-wrap:wrap">
              <button id="ares-wallet-add-btn" onclick="(function(){
                var v=prompt('Fund ARES Wallet (USDT amount):','100');
                if(v===null) return;
                var n=parseFloat(v);
                if(!Number.isFinite(n)||n<=0){alert('Invalid amount');return;}
                if(typeof ARES!=='undefined'&&ARES.wallet&&ARES.wallet.fund(n)){
                  try{_aresRender();}catch(_){}
                }
              })()" style="background:rgba(0,255,136,0.1);border:1px solid rgba(0,255,136,0.35);color:#00ff88;font-family:monospace;font-size:11px;padding:2px 8px;cursor:pointer;border-radius:2px;letter-spacing:1px">[+] ADD</button>
              <button id="ares-wallet-withdraw-btn" onclick="(function(){
                if(typeof ARES==='undefined'||!ARES.wallet) return;
                var wlt=ARES.wallet;
                var openCnt=ARES.positions?ARES.positions.getOpen().length:0;
                if(wlt.locked>0||openCnt>0){alert('Withdraw disabled while positions are active.');return;}
                var v=prompt('Withdraw from ARES Wallet (USDT amount):','');
                if(v===null) return;
                var n=parseFloat(v);
                if(!Number.isFinite(n)||n<=0){alert('Invalid amount');return;}
                if(wlt.withdraw(n,openCnt)){try{_aresRender();}catch(_){}}
                else{alert('Withdraw failed \u2014 check positions.');}
              })()" style="background:rgba(255,80,80,0.08);border:1px solid rgba(255,80,80,0.3);color:rgba(255,110,110,0.8);font-family:monospace;font-size:11px;padding:2px 8px;cursor:pointer;border-radius:2px;letter-spacing:1px">[-] WITHDRAW</button>
            </div>
            <div id="ares-wallet-withdraw-tip" style="display:none;font-family:monospace;font-size:10px;color:#ff555566;margin-top:2px">withdraw disabled while positions active</div>
            <span id="ares-wallet-fail" style="display:none;background:rgba(255,40,40,0.18);border:1px solid rgba(255,50,50,0.45);color:#ff5555;font-family:monospace;font-size:11px;padding:1px 5px;border-radius:2px;letter-spacing:1px;margin-top:3px;display:block">NO FUNDS</span>
          </div>

          <div id="ares-obj-col">
            <div class="ares-meta-title" id="ares-obj-title" style="text-align:right">OBJECTIVES</div>
            <div class="ares-obj-item" id="aobj-0">100 \u2192 1,000</div>
            <div class="ares-obj-bar"  id="aobj-0b" style="text-align:right"></div>
            <div class="ares-obj-item" id="aobj-1">1,000 \u2192 10,000</div>
            <div class="ares-obj-bar"  id="aobj-1b" style="text-align:right"></div>
            <div class="ares-obj-item" id="aobj-2">10,000 \u2192 1M</div>
            <div class="ares-obj-bar"  id="aobj-2b" style="text-align:right"></div>
          </div>
        </div>

                <div id="ares-positions-wrap" style="margin:4px 12px 0;padding:4px 0 2px;border-top:1px solid rgba(0,150,255,0.12)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <div class="ares-meta-title" style="margin:0">POSITIONS</div>
            <button id="ares-close-all-btn" onclick="(function(){if(typeof ARES!=='undefined'&&ARES.positions){ARES.positions.closeAll();setTimeout(_aresRender,100);}})()" style="display:none;background:rgba(255,50,50,0.15);border:1px solid rgba(255,50,50,0.4);color:rgba(255,100,100,0.85);font-family:monospace;font-size:11px;padding:2px 7px;cursor:pointer;border-radius:2px;letter-spacing:1px">CLOSE ALL</button>
          </div>
          <div id="ares-positions-list" style="max-height:220px;overflow-y:auto">
            <div style="color:rgba(255,255,255,0.25);font-size:12px;font-family:monospace;padding:2px 0">\u2014 none \u2014</div>
          </div>
        </div>

                <div id="ares-arc-wrap">
          <svg id="ares-arc-svg" viewBox="0 0 260 56" preserveAspectRatio="xMidYMid meet"></svg>
        </div>

                <div id="ares-core-wrap">
          <svg id="ares-core-svg" viewBox="0 0 336 280" preserveAspectRatio="xMidYMid meet">
            <text x="160" y="155" text-anchor="middle" font-family="monospace" font-size="8" fill="#0080ff44">INITIALIZING NEURAL BRAIN...</text>
          </svg>
        </div>

                <div id="ares-cog-bar">
          <span id="ares-cog-label">CLARITATE COGNITIV\u0102</span>
          <div id="ares-cog-track"><div id="ares-cog-fill" style="width:0%"></div></div>
          <span id="ares-cog-pct">\u2014</span>
        </div>

                <div id="ares-stats-row">
          <div class="ares-stat-cell">
            <div class="ares-stat-label">TRAJECTORY \u0394</div>
            <div class="ares-stat-val" id="ares-stat-delta" style="color:#00d9ff">\u2014</div>
            <div class="ares-stat-sub">vs curve</div>
          </div>
          <div class="ares-stat-cell">
            <div class="ares-stat-label">MISSION DAY</div>
            <div class="ares-stat-val" id="ares-stat-day" style="color:#00d9ff">\u2014 / 365</div>
            <div class="ares-stat-sub">elapsed</div>
          </div>
          <div class="ares-stat-cell">
            <div class="ares-stat-label">WIN RATE</div>
            <div class="ares-stat-val" id="ares-stat-wr" style="color:#00d9ff">\u2014%</div>
            <div class="ares-stat-sub">last 10</div>
          </div>
          <div class="ares-stat-cell">
            <div class="ares-stat-label">PRED ACC</div>
            <div class="ares-stat-val" id="ares-stat-pred" style="color:#0080ff">\u2014</div>
            <div class="ares-stat-sub">5min pred</div>
          </div>
        </div>

                <div id="ares-thought-wrap">
          <div id="ares-thought-inner">
            <div class="ares-thought-line new">\u203a ARES 1.0 \u2014 Neural Command Center online</div>
            <div class="ares-thought-line">\u203a AUTONOMOUS mode \u2014 managing positions independently</div>
            <div class="ares-thought-line">\u203a Awaiting market data...</div>
          </div>
        </div>

                <div id="ares-lesson-wrap">
          <div id="ares-lesson-label">\u25c8 LAST LESSON FROM MEMORY</div>
          <div id="ares-lesson-text">Awaiting first trade analysis...</div>
          <div id="ares-history-bar"></div>
        </div>

      </div>
    </div>`

  anchor.insertAdjacentElement('afterend', wrap)

  // Prim tick la 1s după init
  setTimeout(function () { if (typeof w.ARES !== 'undefined') w.ARES.tick() }, 1000)
}

export function _demoTick() {
  const active = w.TP.demoPositions.filter((p: any) => !p.closed)
  if (active.length) {
    checkDemoPositionsSLTP()
    renderDemoPositions()
  }
  // Check demo pending limit orders for fill
  if (typeof checkPendingOrders === 'function') checkPendingOrders()
  // Render pending orders (live distance update)
  if (typeof w.renderPendingOrders === 'function') w.renderPendingOrders()
}
// [V1.5] Legacy API_KEY/API_SECRET removed — credentials are server-side only (credentialStore)
