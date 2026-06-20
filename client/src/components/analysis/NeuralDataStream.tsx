// Neural Data Stream / Quantum Analytics — relocated from the AutoTrade panel's collapsed
// toggle to sit always-visible under the Fear & Greed Index. Pure markup; updated in place by
// the startApp() brainExt interval + render.ts (by element id). Single instance only.
export function NeuralDataStream() {
  return (
    <div className="bext show" id="brainExt">
      <div className="bext-bg"></div>
      <div className="bext-top">
        <div className="bext-title">⬡ NEURAL DATA STREAM ⬡ QUANTUM ANALYTICS</div>
        {/* Quantum Clock SVG */}
        <div className="qclock">
          <svg className="qclock-svg" viewBox="0 0 56 56" id="qclockSvg">
            <circle cx="28" cy="28" r="26" fill="none" stroke="#1a0a30" strokeWidth="1.5" />
            <circle cx="28" cy="28" r="22" fill="none" stroke="#2a0a4a" strokeWidth="1" strokeDasharray="4 4" />
            {/* Second arc - fills up each minute */}
            <circle cx="28" cy="28" r="19" fill="none" stroke="#aa44ff" strokeWidth="3" strokeDasharray="0 120"
              strokeLinecap="round" id="qSecArc" transform="rotate(-90 28 28)"
              style={{ transition: 'stroke-dasharray 1s linear' }} />
            {/* Hour markers */}
            <line x1="28" y1="4" x2="28" y2="8" stroke="#3a1060" strokeWidth="1.5" />
            <line x1="52" y1="28" x2="48" y2="28" stroke="#3a1060" strokeWidth="1.5" />
            <line x1="28" y1="52" x2="28" y2="48" stroke="#3a1060" strokeWidth="1.5" />
            <line x1="4" y1="28" x2="8" y2="28" stroke="#3a1060" strokeWidth="1.5" />
            {/* Center dot */}
            <circle cx="28" cy="28" r="2" fill="#aa44ff" id="qClockCenter" />
            {/* Hour hand */}
            <line id="qHourHand" x1="28" y1="28" x2="28" y2="14" stroke="#aa44ff" strokeWidth="2"
              strokeLinecap="round" style={{ transformOrigin: '28px 28px' }} />
            {/* Min hand */}
            <line id="qMinHand" x1="28" y1="28" x2="28" y2="10" stroke="#cc88ff" strokeWidth="1.5"
              strokeLinecap="round" style={{ transformOrigin: '28px 28px' }} />
            {/* Sec hand */}
            <line id="qSecHand" x1="28" y1="32" x2="28" y2="6" stroke="#00ff88" strokeWidth="1"
              strokeLinecap="round" style={{ transformOrigin: '28px 28px' }} />
            {/* UTC label */}
            <text x="28" y="38" textAnchor="middle" fill="#3a1060" fontSize="4" fontFamily="monospace">RO</text>
            <text x="28" y="44" textAnchor="middle" fill="#aa44ff" fontSize="5" fontFamily="monospace"
              id="qClockTime">00:00</text>
          </svg>
        </div>
        <div className="market-phase dead" id="brainMarketPhase">LOADING</div>
      </div>
      {/* Session Backtest Box */}
      <div className="sess-bt" id="sessBacktestBox" style={{ padding: '2px 8px 4px' }}></div>

      {/* Price Action */}
      <div style={{ fontSize: '6px', letterSpacing: '2px', color: '#1a0830', padding: '4px 10px 2px' }}>PRICE ACTION — 7 SIMBOLURI LIVE</div>
      <div id="symPulseRows"></div>

      {/* Momentum Heatmap */}
      <div style={{ fontSize: '6px', letterSpacing: '2px', color: '#1a0830', padding: '4px 10px 0' }}>MOMENTUM HEATMAP</div>
      <div className="nheat" id="brainHeatmap"></div>

      {/* Risk Gauges */}
      <div style={{ fontSize: '6px', letterSpacing: '2px', color: '#1a0830', padding: '4px 10px 0' }}>RISK MATRIX</div>
      {[
        { label: 'VOLATILITY', id: 'vol' },
        { label: 'POSITION RISK', id: 'pos' },
        { label: 'SENTIMENT', id: 'sent' },
        { label: 'CONFLUENCE', id: 'conf' },
      ].map((g, i) => (
        <div className="risk-gauge" key={g.id} style={i === 3 ? { borderTop: 'none', paddingBottom: '6px' } : undefined}>
          <div className="risk-label">{g.label}</div>
          <div className="risk-gauge-track"><div className="risk-gauge-fill" id={`rg-${g.id}`} style={{ width: '0%' }}></div></div>
          <div className="risk-val" id={`rgv-${g.id}`} style={{ color: '#555' }}>—</div>
        </div>
      ))}

      {/* Data stream ticker */}
      <div className="dstream"><div className="dstream-inner" id="dstreamInner"></div></div>
    </div>
  )
}
