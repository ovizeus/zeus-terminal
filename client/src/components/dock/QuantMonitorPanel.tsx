import { useEffect, useRef } from 'react'
import { init as qmInit, destroy as qmDestroy } from '../../quantmonitor/index'

/** Quantitative Monitor — ASCII terminal with 30+ market intelligence engines
 *  Reads from Zeus w.S (reuses existing data) + adds new sources (basis, cross-FR, dominance, on-chain) */
export function QuantMonitorPanel() {
  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    // [BUG5.3] Static import (no code-split) so the QM engine ships inside
    // the main bundle. Eliminates the dynamic-chunk 404 class entirely —
    // previous builds split this into quantmonitor-*.js and a stale SW or
    // CDN edge could return 404 for the chunk even when it existed on the
    // origin. Added bundle cost: ~25 KB gzipped, acceptable for reliability.
    let destroyed = false
    qmInit('qm-screen', 'qm-particles').catch((e: any) => console.warn('[QM] init error:', e))

    return () => {
      destroyed = true
      try { qmDestroy() } catch (_) { }
      initRef.current = false
    }
    void destroyed
  }, [])

  return (
    <div className="qm-root" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#000' }}>
      <div id="qm-screen" style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        padding: '6px 8px', whiteSpace: 'pre', overflowY: 'auto', overflowX: 'hidden',
        fontSize: '11.5px', letterSpacing: '0.3px',
        fontFamily: "'JetBrains Mono','Courier New','Lucida Console',monospace",
        lineHeight: 1.25, color: '#ccc',
        textShadow: '0 0 1px rgba(0,255,136,0.15)',
      }}>
        <span className="dg">Initializing ZeuS Quantitative Monitor...</span>
      </div>
      <canvas id="qm-particles" style={{
        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 100,
      }} />
      {/* Scanline overlay effect */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        background: 'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.15) 2px,rgba(0,0,0,0.15) 4px)',
        pointerEvents: 'none', zIndex: 101,
      }} />
      {/* Vignette glow */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        boxShadow: 'inset 0 0 120px rgba(0,255,136,0.03)',
        pointerEvents: 'none', zIndex: 102,
      }} />
    </div>
  )
}
