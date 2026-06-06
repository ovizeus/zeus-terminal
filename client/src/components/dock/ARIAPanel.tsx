/** ARIA dock page view — 1:1 from index.html lines 575-643 + arianova.js
 *  Advanced Recognition Intelligence Alerts v1.0
 *  Strip bar + expanded panel — forced open when in pageview. */
import { useEffect, useRef, useState } from 'react'
import { fetchSymbolKlines } from '../../data/klines'
import { computePatternLevels, patternSpan, renderPatternSVG, type Kline, type PatternLevels } from '../../engine/ariaPatternViz'

// ═══════════════════════════════════════════════════════════════════
// [ARIA PATTERN VISION 2026-06-06] Real-candle pattern drawing — operator
// brief calibrated on the classic cheat-sheet posters: REAL candles of the
// window where the pattern fired, zigzag structure overlay, and labeled
// ENTRY / TARGET / STOP level pills. Timeframe selectable (15m/30m/1h/4h or
// the chart's own TF). Detection REUSES the live arianova detectors
// (window._ariaDetectors — read-only) on really-fetched klines; pure display,
// the brain-feeding pipeline is untouched.
// ═══════════════════════════════════════════════════════════════════
const _PV_TFS = ['15m', '30m', '1h', '4h'] as const
type PvTf = typeof _PV_TFS[number] | 'chart'

interface PvState {
  svg: string
  name: string | null
  dir: string | null
  conf: number | null
  levels: PatternLevels | null
  tfShown: string
  updatedAt: string
  error: string
}

function _pvDetect(kl: Kline[]): { name: string; dir: string; svgType: string; score: number } | null {
  const d = (window as any)._ariaDetectors
  if (!d) return null
  const cands = [d.candle(kl), d.chart(kl), d.advanced(kl), d.momentum(kl)].filter(Boolean)
  if (!cands.length) return null
  return cands.reduce((a: any, b: any) => (b.score > a.score ? b : a))
}

function PatternVision() {
  const [tf, setTf] = useState<PvTf>('chart')
  const [st, setSt] = useState<PvState>({ svg: renderPatternSVG([], {}), name: null, dir: null, conf: null, levels: null, tfShown: '—', updatedAt: '—', error: '' })
  const _alive = useRef(true)

  async function refresh(selTf: PvTf) {
    const w = window as any
    try {
      const sym = (w.S && w.S.symbol) || 'BTCUSDT'
      let kl: Kline[] | null
      let tfShown: string
      if (selTf === 'chart') {
        kl = (w.S && w.S.klines) || null
        tfShown = (w.S && w.S.chartTf) || '5m'
      } else {
        kl = await fetchSymbolKlines(sym, selTf, 60)
        tfShown = selTf
      }
      if (!_alive.current) return
      if (!kl || kl.length < 10) {
        setSt(s => ({ ...s, error: 'No kline data for ' + tfShown, updatedAt: new Date().toLocaleTimeString('ro-RO') }))
        return
      }
      const win = kl.slice(-40)
      const pat = _pvDetect(kl)
      const isChartPattern = pat ? patternSpan(pat.svgType) >= 15 : false
      const levels = pat ? computePatternLevels(pat.dir as any, pat.svgType, kl) : null
      const svg = renderPatternSVG(win, {
        highlightBars: pat ? Math.min(patternSpan(pat.svgType), win.length) : 0,
        levels,
        zigzag: isChartPattern,
      })
      setSt({
        svg, name: pat ? pat.name : null, dir: pat ? pat.dir : null,
        conf: pat ? pat.score : null, levels,
        tfShown, updatedAt: new Date().toLocaleTimeString('ro-RO'), error: '',
      })
    } catch (e: any) {
      if (_alive.current) setSt(s => ({ ...s, error: e?.message || 'render error' }))
    }
  }

  useEffect(() => {
    _alive.current = true
    void refresh(tf)
    const id = setInterval(() => { void refresh(tf) }, 30000)
    return () => { _alive.current = false; clearInterval(id) }
  }, [tf])

  const dirColor = st.dir === 'bull' ? '#00d97a' : st.dir === 'bear' ? '#ff3355' : '#f0c040'
  return (
    <div className="sec" id="aria-pattern-vision">
      <div className="slbl" style={{ justifyContent: 'space-between' }}>
        <span>PATTERN VISION &mdash; REAL CANDLES</span>
        <span style={{ fontSize: '8px', color: 'var(--dim)' }}>{st.updatedAt}</span>
      </div>

      {/* TF selector */}
      <div style={{ display: 'flex', gap: '4px', padding: '6px 10px 2px', alignItems: 'center' }}>
        {(['chart', ..._PV_TFS] as PvTf[]).map(t => (
          <button key={t} onClick={() => setTf(t)} style={{
            fontSize: '8px', padding: '3px 9px', fontFamily: 'var(--ff)', letterSpacing: '1px',
            background: tf === t ? '#00d4ff22' : 'transparent',
            border: `1px solid ${tf === t ? '#00d4ff' : '#1a2a3a'}`,
            color: tf === t ? '#00d4ff' : '#6a8090', borderRadius: '3px', cursor: 'pointer',
          }}>{t === 'chart' ? 'CHART' : t.toUpperCase()}</button>
        ))}
        <button onClick={() => void refresh(tf)} title="Refresh now" style={{
          marginLeft: 'auto', fontSize: '9px', padding: '2px 7px', background: 'transparent',
          border: '1px solid #1a2a3a', color: '#6a8090', borderRadius: '3px', cursor: 'pointer', fontFamily: 'var(--ff)',
        }}>&#8634;</button>
      </div>

      {/* Pattern headline */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 10px', fontSize: '9px' }}>
        {st.name ? (
          <>
            <span style={{ color: dirColor, fontWeight: 700, letterSpacing: '1px' }}>
              {st.dir === 'bull' ? '▲' : st.dir === 'bear' ? '▼' : '◆'} {st.name}
            </span>
            <span style={{ color: 'var(--dim)' }}>@ {st.tfShown}{st.conf != null ? ` · score ${st.conf}` : ''}</span>
          </>
        ) : (
          <span style={{ color: 'var(--dim)' }}>{st.error || `No pattern detected @ ${st.tfShown} — showing market structure`}</span>
        )}
      </div>

      {/* The real-candle drawing */}
      <div style={{ padding: '2px 8px 6px' }} dangerouslySetInnerHTML={{ __html: st.svg }} />

      {/* Levels readout (poster pills, numeric) */}
      {st.levels && (
        <div style={{ display: 'flex', gap: '8px', padding: '0 10px 8px', fontSize: '8px', fontFamily: 'monospace' }}>
          <span style={{ color: '#00d97a', border: '1px solid #00d97a44', borderRadius: '2px', padding: '2px 6px' }}>TARGET {st.levels.tp.toFixed(2)}</span>
          <span style={{ color: '#00d4ff', border: '1px solid #00d4ff44', borderRadius: '2px', padding: '2px 6px' }}>ENTRY {st.levels.entry.toFixed(2)}</span>
          <span style={{ color: '#ff3355', border: '1px solid #ff335544', borderRadius: '2px', padding: '2px 6px' }}>STOP {st.levels.sl.toFixed(2)}</span>
          <span style={{ color: 'var(--dim)', padding: '2px 0' }}>R:R {st.levels.rr}</span>
        </div>
      )}
      <div style={{ padding: '0 10px 8px', fontSize: '7px', color: 'var(--dim)', lineHeight: 1.6 }}>
        Levels are pattern-derived guides (measured move / 2R), not orders. Same detectors as live ARIA, on real {st.tfShown} klines.
      </div>
    </div>
  )
}

export function ARIAPanel() {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <>
    <div id="aria-strip" data-panel="aria" className={isOpen ? 'aria-open' : ''}>
      {/* ── Bar (always visible) — 1:1 from index.html line 579 ── */}
      <div className="aria-bar" onClick={() => setIsOpen(o => !o)}>
        <div className="v6-accent">
          <div className="v6-ico">
            <svg viewBox="0 0 24 24">
              <ellipse cx="12" cy="12" rx="9" ry="5.5" />
              <circle cx="12" cy="12" r="2.5" fill="var(--v6-cyan)" stroke="none" opacity=".7" />
              <line x1="12" y1="6.5" x2="12" y2="4" />
              <line x1="12" y1="17.5" x2="12" y2="20" />
            </svg>
          </div>
          <span className="v6-lbl">ARIA</span>
        </div>
        <div className="v6-content">
          <span className="aria-title">ARIA</span>
          <span className="aria-sep">&mdash;</span>
          <span id="aria-bar-txt">scanning…</span>
          <span id="aria-dot" className="aria-dot aria-scan"></span>
          <span className="aria-chev">▼</span>
        </div>
      </div>

      {/* ── Expanded panel ── */}
      <div className="aria-panel" id="aria-panel">
        <div className="aria-cols">
          <div>{/* left col */}
            <div className="aria-col-hdr">PATTERN</div>
            <div className="aria-svg-wrap">
              <svg id="aria-psvg" className="aria-psvg" viewBox="0 0 80 48" preserveAspectRatio="none"></svg>
            </div>
            <div className="aria-pname" id="aria-pname">&mdash;</div>
            <div className="aria-meta">
              <span className="aria-lbl">TF</span><span id="aria-ptf">&mdash;</span>
              <span className="aria-lbl">CONF</span><span id="aria-pconf">&mdash;</span>
            </div>
          </div>
          <div className="aria-col-r">{/* right col */}
            <div className="aria-col-hdr">CANDLE</div>
            <div className="aria-cline"><span className="aria-lbl">Type:</span><span id="aria-ctype">&mdash;</span></div>
            <div className="aria-cline"><span className="aria-lbl">Vol:</span><span id="aria-cvol">&mdash;</span></div>
            <div className="aria-col-hdr" style={{ marginTop: 7 }}>MTF STACK</div>
            <div id="aria-mtf" className="aria-mtf"></div>
          </div>
        </div>
        <div className="aria-verdict-row">
          <span id="aria-verdict" className="aria-verdict">WATCH</span>
          <span id="aria-verdict-txt" className="aria-verdict-txt">Waiting for data&hellip;</span>
        </div>
        {/* Fix 5 v92: MTF context + vol regime hint -- read-only advisory */}
        <div
          id="aria-ctx-hint"
          style={{ fontSize: 8, color: '#00ffcc33', letterSpacing: 1, padding: '4px 0 2px', minHeight: 10 }}
        ></div>
        {/* Fix 5 v93: MTF score + VOL regime dedicated rows (GPT spec) */}
        <div style={{ display: 'flex', gap: 10, padding: '2px 0 4px', fontSize: 8, color: '#00ffcc44', letterSpacing: 1 }}>
          <span>MTF score: <span id="aria-mtfscore" style={{ color: '#00ffcc88' }}>&mdash;</span></span>
          <span>VOL: <span id="aria-volreg" style={{ color: '#00ffcc88' }}>&mdash;</span></span>
        </div>
        {/* v94: Trap rate + Magnet bias -- permanent display from BM.liqCycle */}
        <div style={{ display: 'flex', gap: 10, padding: '2px 0 4px', fontSize: 8, color: '#00ffcc44', letterSpacing: 1 }}>
          <span>Trap rate: <span id="aria-traprate" style={{ color: '#00ffcc88' }}>&mdash;</span></span>
          <span>Magnet: <span id="aria-magnet" style={{ color: '#00ffcc88' }}>&mdash;</span></span>
        </div>
        {/* Pattern history (last 5 detections) */}
        <div className="aria-col-hdr" style={{ marginTop: 4, fontSize: 7, opacity: 0.5 }}>RECENT PATTERNS</div>
        <div id="aria-history" style={{ fontSize: 8, color: '#00ffcc55', maxHeight: 52, overflow: 'hidden', padding: '1px 0' }}>
        </div>
      </div>
    </div>

    {/* [ARIA PATTERN VISION 2026-06-06] Real-candle pattern drawing with TF
        selector + ENTRY/TARGET/STOP — see component above. */}
    <PatternVision />

    {/* ===== LIQUIDITY MAGNET — RADAR =====
        [UI-COMPACT 2026-06-06] Moved 1:1 from AnalysisSections.tsx (home
        scroll zone) — sixth batch; thematic fit (ARIA already surfaces the
        magnet bias). Filled by legacy JS via getElementById (#magSummary,
        #magAboveList, #magBelowList etc.), position-agnostic. Paired change:
        bootstrapInit.ts no longer mv()'s #magSec. */}
    <div className="sec" id="magSec">
      <div className="slbl" style={{ justifyContent: 'space-between' }}>
        <span>LIQUIDITY MAGNET &mdash; RADAR</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span id="magUpdTime" style={{ fontSize: '7px', color: 'var(--dim)' }}>&mdash;</span>
          <button
            style={{
              fontSize: '7px', padding: '2px 7px', border: '1px solid #f0c04033',
              borderRadius: '2px', background: 'transparent', color: 'var(--gold)',
              cursor: 'pointer', fontFamily: 'var(--ff)'
            }}
          >&#8634;</button>
        </div>
      </div>

      {/* Magnet summary */}
      <div className="mag-summary" id="magSummary">
        <div className="mag-sum-item">
          <div className="mag-sum-lbl">MAGNET UP</div>
          <div className="mag-sum-val" id="magNearAbove" style={{ color: 'var(--red)' }}>&mdash;</div>
        </div>
        <div className="mag-sum-item">
          <div className="mag-sum-lbl">BIAS</div>
          <div className="mag-bias neut" id="magBias">NEUTRAL</div>
        </div>
        <div className="mag-sum-item">
          <div className="mag-sum-lbl">MAGNET DOWN</div>
          <div className="mag-sum-val" id="magNearBelow" style={{ color: 'var(--grn)' }}>&mdash;</div>
        </div>
      </div>

      <div className="mag-wrap">
        {/* Above price */}
        <div className="mag-title">
          <span><span className="z-dot z-dot--red"></span> RESISTANCE / UPPER MAGNETS</span>
          <span id="magAboveCnt" style={{ color: 'var(--red)' }}>&mdash;</span>
        </div>
        <div className="mag-arrow" id="magAboveList">
          <div style={{ padding: '10px', textAlign: 'center', fontSize: '8px', color: 'var(--dim)' }}>Loading...</div>
        </div>

        {/* Separator = current price */}
        <div className="mag-separator" style={{ margin: '6px 0' }}>
          <div className="mag-sep-line"></div>
          <span>&#9679; <span id="magCurrentPrice">&mdash;</span> &#9679;</span>
          <div className="mag-sep-line"></div>
        </div>

        {/* Below price */}
        <div className="mag-title">
          <span><span className="z-dot z-dot--grn"></span> SUPPORT / LOWER MAGNETS</span>
          <span id="magBelowCnt" style={{ color: 'var(--grn)' }}>&mdash;</span>
        </div>
        <div className="mag-arrow" id="magBelowList">
          <div style={{ padding: '10px', textAlign: 'center', fontSize: '8px', color: 'var(--dim)' }}>Loading...</div>
        </div>
      </div>
    </div>
    </>
  )
}
