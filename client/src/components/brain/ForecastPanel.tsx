import { useBrainStore } from '../../stores'

export function ForecastPanel() {
  const qexit = useBrainStore((s) => s.brain.qexit)
  const probScore = useBrainStore((s) => s.brain.probScore)
  const probBreakdown = useBrainStore((s) => s.brain.probBreakdown)
  const macro = useBrainStore((s) => s.brain.macro)
  const liqCycle = useBrainStore((s) => s.brain.liqCycle)

  const riskCls = qexit.risk > 70 ? 'zr-kv__value--red'
    : qexit.risk > 40 ? 'zr-kv__value--ylw' : 'zr-kv__value--grn'

  return (
    <div className="zr-forecast">
      {/* Q-Exit Risk Strip */}
      <div className="zr-forecast__section">
        <div className="zr-brain__section-title">Q-EXIT</div>
        <div className="zr-forecast__risk-bar">
          <div className="zr-forecast__risk-fill" style={{ width: `${Math.min(qexit.risk, 100)}%` }} />
          <span className="zr-forecast__risk-label">{qexit.risk}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Action</span>
          <span className={`zr-kv__value ${riskCls}`}>{qexit.action}</span>
        </div>
        {qexit.signals.divergence.type && (
          <div className="zr-kv">
            <span className="zr-kv__label">Divergence</span>
            <span className="zr-kv__value">{qexit.signals.divergence.type} ({qexit.signals.divergence.conf}%)</span>
          </div>
        )}
        {qexit.signals.climax.dir && (
          <div className="zr-kv">
            <span className="zr-kv__label">Climax</span>
            <span className="zr-kv__value">{qexit.signals.climax.dir} ({qexit.signals.climax.mult.toFixed(1)}x)</span>
          </div>
        )}
        {qexit.signals.regimeFlip.to && (
          <div className="zr-kv">
            <span className="zr-kv__label">Regime Flip</span>
            <span className="zr-kv__value">{qexit.signals.regimeFlip.from} → {qexit.signals.regimeFlip.to}</span>
          </div>
        )}
        {qexit.lastReason && (
          <div className="zr-kv">
            <span className="zr-kv__label">Reason</span>
            <span className="zr-kv__value">{qexit.lastReason}</span>
          </div>
        )}
      </div>

      {/* Probability Score */}
      <div className="zr-forecast__section">
        <div className="zr-brain__section-title">PROBABILITY</div>
        <div className="zr-kv">
          <span className="zr-kv__label">Score</span>
          <span className="zr-kv__value">{probScore}</span>
        </div>
        {probBreakdown && typeof probBreakdown === 'object' && (
          Object.entries(probBreakdown).map(([key, val]) => (
            <div className="zr-kv" key={key}>
              <span className="zr-kv__label">{key}</span>
              <span className="zr-kv__value">{String(val)}</span>
            </div>
          ))
        )}
      </div>

      {/* Macro / Cycle Intelligence */}
      <div className="zr-forecast__section">
        <div className="zr-brain__section-title">MACRO CYCLE</div>
        <div className="zr-kv">
          <span className="zr-kv__label">Phase</span>
          <span className="zr-kv__value">{macro.phase}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Composite</span>
          <span className="zr-kv__value">{macro.composite}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Cycle Score</span>
          <span className="zr-kv__value">{macro.cycleScore}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Sentiment</span>
          <span className="zr-kv__value">{macro.sentimentScore}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Flow</span>
          <span className="zr-kv__value">{macro.flowScore}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Slope</span>
          <span className="zr-kv__value">{macro.slope}</span>
        </div>
      </div>

      {/* Liquidity Cycle */}
      <div className="zr-forecast__section">
        <div className="zr-brain__section-title">LIQUIDITY CYCLE</div>
        <div className="zr-kv">
          <span className="zr-kv__label">Sweep</span>
          <span className="zr-kv__value">{liqCycle.currentSweep ? 'ACTIVE' : 'NONE'}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Trap Rate</span>
          <span className={`zr-kv__value ${(liqCycle.trapRate ?? 0) > 50 ? 'zr-kv__value--red' : ''}`}>
            {liqCycle.trapRate ?? 0}%
          </span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Magnet Above</span>
          <span className="zr-kv__value">{liqCycle.magnetAboveDist}%</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Magnet Below</span>
          <span className="zr-kv__value">{liqCycle.magnetBelowDist}%</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Magnet Bias</span>
          <span className="zr-kv__value">{liqCycle.magnetBias}</span>
        </div>
      </div>
    </div>
  )
}
