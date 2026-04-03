import { useBrainStore } from '../../stores'

export function DeepDivePanel() {
  const structure = useBrainStore((s) => s.brain.structure)
  const adaptive = useBrainStore((s) => s.brain.adaptive)
  const positionSizing = useBrainStore((s) => s.brain.positionSizing)
  const conviction = useBrainStore((s) => s.brain.conviction)
  const convictionMult = useBrainStore((s) => s.brain.convictionMult)
  const lossStreak = useBrainStore((s) => s.brain.lossStreak)
  const dailyTrades = useBrainStore((s) => s.brain.dailyTrades)
  const dailyPnL = useBrainStore((s) => s.brain.dailyPnL)
  const protectMode = useBrainStore((s) => s.brain.protectMode)
  const protectReason = useBrainStore((s) => s.brain.protectReason)
  const performance = useBrainStore((s) => s.brain.performance)

  return (
    <div className="zr-deepdive">
      {/* Protection Status */}
      {protectMode && (
        <div className="zr-deepdive__protect">
          PROTECT MODE — {protectReason}
        </div>
      )}

      {/* Structure */}
      <div className="zr-brain__section">
        <div className="zr-brain__section-title">STRUCTURE</div>
        <div className="zr-kv">
          <span className="zr-kv__label">Regime</span>
          <span className="zr-kv__value">{structure.regime}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">ADX</span>
          <span className="zr-kv__value">{structure.adx}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">ATR %</span>
          <span className="zr-kv__value">{structure.atrPct}%</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Squeeze</span>
          <span className={`zr-kv__value ${structure.squeeze ? 'zr-kv__value--ylw' : ''}`}>
            {structure.squeeze ? 'YES' : 'NO'}
          </span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Vol Mode</span>
          <span className="zr-kv__value">{structure.volMode}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Score</span>
          <span className="zr-kv__value">{structure.score}</span>
        </div>
      </div>

      {/* Position Sizing */}
      <div className="zr-brain__section">
        <div className="zr-brain__section-title">POSITION SIZING</div>
        <div className="zr-kv">
          <span className="zr-kv__label">Base Risk</span>
          <span className="zr-kv__value">{positionSizing.baseRiskPct}%</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Regime Mult</span>
          <span className="zr-kv__value">{positionSizing.regimeMult}x</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Perf Mult</span>
          <span className="zr-kv__value">{positionSizing.perfMult}x</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Final Mult</span>
          <span className="zr-kv__value">{positionSizing.finalMult}x</span>
        </div>
      </div>

      {/* Adaptive Control */}
      <div className="zr-brain__section">
        <div className="zr-brain__section-title">ADAPTIVE</div>
        <div className="zr-kv">
          <span className="zr-kv__label">Enabled</span>
          <span className={`zr-kv__value ${adaptive.enabled ? 'zr-kv__value--grn' : ''}`}>
            {adaptive.enabled ? 'ON' : 'OFF'}
          </span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Entry Mult</span>
          <span className="zr-kv__value">{adaptive.entryMult}x</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Size Mult</span>
          <span className="zr-kv__value">{adaptive.sizeMult}x</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Exit Mult</span>
          <span className="zr-kv__value">{adaptive.exitMult}x</span>
        </div>
      </div>

      {/* Daily Stats */}
      <div className="zr-brain__section">
        <div className="zr-brain__section-title">SESSION</div>
        <div className="zr-kv">
          <span className="zr-kv__label">Daily Trades</span>
          <span className="zr-kv__value">{dailyTrades}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Daily PnL</span>
          <span className={`zr-kv__value ${dailyPnL >= 0 ? 'zr-kv__value--grn' : 'zr-kv__value--red'}`}>
            ${dailyPnL.toFixed(2)}
          </span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Loss Streak</span>
          <span className={`zr-kv__value ${lossStreak >= 3 ? 'zr-kv__value--red' : ''}`}>
            {lossStreak}
          </span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Conviction</span>
          <span className="zr-kv__value">{conviction} ({convictionMult}x)</span>
        </div>
      </div>

      {/* Regime Performance */}
      {performance?.byRegime && Object.keys(performance.byRegime).length > 0 && (
        <div className="zr-brain__section">
          <div className="zr-brain__section-title">REGIME PERFORMANCE</div>
          {Object.entries(performance.byRegime).map(([regime, perf]) => (
            <div className="zr-kv" key={regime}>
              <span className="zr-kv__label">{regime}</span>
              <span className="zr-kv__value">
                {perf.trades}T {perf.wins}W {perf.avgR.toFixed(1)}R {perf.mult}x
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
