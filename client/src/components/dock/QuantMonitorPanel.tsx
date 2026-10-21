import { useEffect, useRef, useState } from 'react'
import { init as qmInit, destroy as qmDestroy } from '../../quantmonitor/index'
import { fitFontSize, FRAME_COLS } from '../../quantmonitor/render/fit'

const QM_FONT = "'JetBrains Mono','Courier New','Lucida Console',monospace"
const QM_FONT_FALLBACK = 11.5
// Spaţierea literelor in `em`, nu in px: altfel nu scaleaza cu fontul si
// potrivirea la laţime ar fi greşita cu ~30px pe 101 de coloane.
const QM_TRACKING = '0.026em'
const QM_PAD_X = 8

/** Quantitative Monitor — ASCII terminal with 30+ market intelligence engines
 *  Reads from Zeus w.S (reuses existing data) + adds new sources (basis, cross-FR, dominance, on-chain) */
export function QuantMonitorPanel() {
  const initRef = useRef(false)
  const screenRef = useRef<HTMLDivElement | null>(null)
  const [fontPx, setFontPx] = useState(QM_FONT_FALLBACK)

  // [2026-10-21 b296] Potriveste fontul la laţimea panoului. Cadrul e ASCII cu
  // laţime fixa (FRAME_COLS coloane), iar panoul avea 11,5px fix cu
  // `overflowX: hidden`: pe un panou ingust coloana din dreapta se TAIA in
  // liniste, iar pe unul lat textul rămanea mic degeaba. Fontul fiind
  // monospaţiat, scalarea pastreaza alinierea coloanelor exact.
  useEffect(() => {
    const el = screenRef.current
    if (!el) return
    // Sonda masoara laţimea reala a FRAME_COLS caractere in fontul chiar
    // incarcat — nu presupunem un raport de 0,6 em pe caracter.
    const probeFont = 20
    const probe = document.createElement('span')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;pointer-events:none;font-family:${QM_FONT};font-size:${probeFont}px;letter-spacing:${QM_TRACKING}`
    probe.textContent = '0'.repeat(FRAME_COLS)
    document.body.appendChild(probe)

    const apply = () => {
      const avail = el.clientWidth - QM_PAD_X * 2
      const probeWidth = probe.getBoundingClientRect().width
      setFontPx(fitFontSize(avail, probeWidth, probeFont, QM_FONT_FALLBACK))
    }
    apply()

    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(apply)
      ro.observe(el)
    }
    // Fontul web poate sosi dupa prima masuratoare; remasuram cand e gata.
    const fonts = (document as any).fonts
    if (fonts && typeof fonts.ready?.then === 'function') fonts.ready.then(apply).catch(() => { })

    return () => {
      if (ro) ro.disconnect()
      probe.remove()
    }
  }, [])

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    // [BUG5.3] Static import (no code-split) so the QM engine ships inside
    // the main bundle. Eliminates the dynamic-chunk 404 class entirely —
    // previous builds split this into quantmonitor-*.js and a stale SW or
    // CDN edge could return 404 for the chunk even when it existed on the
    // origin. Added bundle cost: ~25 KB gzipped, acceptable for reliability.
    // [2026-10-21 b294] Aici era `let destroyed = false` + `void destroyed`
    // DUPA `return` — cod inaccesibil, variabila necitita de nimic. Cineva a
    // vrut o garda pentru init-ul async si n-a ajuns niciodata cablata, iar
    // scurgerea a rămas: panoul inchis inainte ca init sa termine lasa 8
    // temporizatoare care lovesc /api/market/* la 5s si 10s, pe termen
    // nelimitat. Garda e acum in quantmonitor/index.ts, pe jeton de rulare,
    // acolo unde sunt si temporizatoarele — nu aici, unde n-avea ce apara.
    qmInit('qm-screen').catch((e: any) => console.warn('[QM] init error:', e))

    return () => {
      try { qmDestroy() } catch (_) { }
      initRef.current = false
    }
  }, [])

  return (
    <div className="qm-root" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#000' }}>
      <div id="qm-screen" ref={screenRef} role="region" tabIndex={0}
        aria-label="Quantitative Monitor readout" style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        padding: `6px ${QM_PAD_X}px`, whiteSpace: 'pre', overflowY: 'auto',
        // `auto`, nu `hidden`: sub pragul de font cadrul tot nu incape, si
        // atunci vrem sa poţi derula pana la coloana din dreapta, nu s-o pierzi.
        overflowX: 'auto',
        fontSize: `${fontPx}px`, letterSpacing: QM_TRACKING,
        fontFamily: QM_FONT,
        lineHeight: 1.35, color: '#ccc',
        contain: 'layout paint style',
        transform: 'translateZ(0)',
        willChange: 'contents',
        backfaceVisibility: 'hidden',
      }}>
        <span className="dg">Initializing ZeuS Quantitative Monitor...</span>
      </div>
      {/* [2026-06-26] Liquidation-direction particle overlay REMOVED — the green/red
          rising/falling "lights" were the source of the green-flood flicker; gone for good. */}
      {/* Scanline overlay effect */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        // [b296] era 0.15 pe un pas de 2px: pe text de 11,5px asta stingea ~7,5%
        // din fiecare glif si batea cu liniile literelor. Pasul creste cu fontul.
        background: 'repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.07) 3px,rgba(0,0,0,0.07) 6px)',
        pointerEvents: 'none', zIndex: 101,
      }} />
      {/* Vignette glow */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        boxShadow: 'inset 0 0 120px rgba(0,255,136,0.015)',
        pointerEvents: 'none', zIndex: 102,
      }} />
    </div>
  )
}
