import { useBrainStore } from '../../stores'

/** Neuron status dot for the neural grid */
function Neuron({ label, state }: { label: string; state: string }) {
  const cls = state === 'ok' ? 'zr-neuron--ok'
    : state === 'wait' ? 'zr-neuron--wait'
    : state === 'fail' ? 'zr-neuron--fail'
    : 'zr-neuron--off'
  return (
    <div className={`zr-neuron ${cls}`} title={`${label}: ${state}`}>
      <span className="zr-neuron__label">{label}</span>
    </div>
  )
}

export function BrainCockpit() {
  const brain = useBrainStore((s) => s.brain)
  const {
    mode, confluenceScore, danger, entryScore, entryReady,
    regimeEngine, phaseFilter, atmosphere, volRegime, probScore,
  } = brain

  const neurons = (brain.core as Record<string, unknown>)?.neurons as Record<string, string> ?? {}

  const dangerCls = danger > 60 ? 'zr-kv__value--red'
    : danger > 30 ? 'zr-kv__value--ylw' : 'zr-kv__value--grn'

  const confCls = confluenceScore >= 70 ? 'zr-kv__value--grn'
    : confluenceScore >= 40 ? 'zr-kv__value--ylw' : 'zr-kv__value--red'

  return (
    <div className="zr-brain">
      {/* Neural Grid */}
      <div className="zr-brain__grid">
        {['RSI', 'MACD', 'ST', 'VOL', 'FR', 'MAG', 'REG', 'OFI'].map((n) => (
          <Neuron key={n} label={n} state={neurons[n.toLowerCase()] ?? 'off'} />
        ))}
      </div>

      {/* Confluence Arc */}
      <div className="zr-brain__arc">
        <span className={`zr-brain__score ${confCls}`}>{confluenceScore}</span>
        <span className="zr-brain__score-label">CONFLUENCE</span>
      </div>

      {/* Core Stats */}
      <div className="zr-brain__stats">
        <div className="zr-kv">
          <span className="zr-kv__label">Mode</span>
          <span className="zr-kv__value">{mode}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Entry Score</span>
          <span className={`zr-kv__value ${entryReady ? 'zr-kv__value--grn' : ''}`}>
            {entryScore} {entryReady ? '✓' : ''}
          </span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Danger</span>
          <span className={`zr-kv__value ${dangerCls}`}>{danger}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Prob Score</span>
          <span className="zr-kv__value">{probScore}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Vol Regime</span>
          <span className="zr-kv__value">{volRegime}</span>
        </div>
      </div>

      {/* Regime Engine */}
      <div className="zr-brain__section">
        <div className="zr-brain__section-title">REGIME</div>
        <div className="zr-kv">
          <span className="zr-kv__label">Regime</span>
          <span className="zr-kv__value">{regimeEngine.regime}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Confidence</span>
          <span className="zr-kv__value">{regimeEngine.confidence}%</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Trend Bias</span>
          <span className="zr-kv__value">{regimeEngine.trendBias}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Volatility</span>
          <span className="zr-kv__value">{regimeEngine.volatilityState}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Trap Risk</span>
          <span className={`zr-kv__value ${regimeEngine.trapRisk > 50 ? 'zr-kv__value--red' : ''}`}>
            {regimeEngine.trapRisk}%
          </span>
        </div>
      </div>

      {/* Phase Filter */}
      <div className="zr-brain__section">
        <div className="zr-brain__section-title">PHASE FILTER</div>
        <div className="zr-kv">
          <span className="zr-kv__label">Phase</span>
          <span className="zr-kv__value">{phaseFilter.phase}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Allow Entry</span>
          <span className={`zr-kv__value ${phaseFilter.allow ? 'zr-kv__value--grn' : 'zr-kv__value--red'}`}>
            {phaseFilter.allow ? 'YES' : 'NO'}
          </span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Risk Mode</span>
          <span className="zr-kv__value">{phaseFilter.riskMode}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Size Mult</span>
          <span className="zr-kv__value">{phaseFilter.sizeMultiplier}x</span>
        </div>
      </div>

      {/* Atmosphere */}
      <div className="zr-brain__section">
        <div className="zr-brain__section-title">ATMOSPHERE</div>
        <div className="zr-kv">
          <span className="zr-kv__label">Category</span>
          <span className="zr-kv__value">{atmosphere.category}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Allow Entry</span>
          <span className={`zr-kv__value ${atmosphere.allowEntry ? 'zr-kv__value--grn' : 'zr-kv__value--red'}`}>
            {atmosphere.allowEntry ? 'YES' : 'NO'}
          </span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Caution</span>
          <span className="zr-kv__value">{atmosphere.cautionLevel}</span>
        </div>
      </div>
    </div>
  )
}
