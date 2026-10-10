import { useBrainStore } from '../../../stores/brainStore'
import { useATStore } from '../../../stores/atStore'
import { ZiMetric, toneColor, type ZiTone } from '../../zi'

const DASH = '—'
// Real data only: undefined/null/'' is "not available" and renders as an em dash.
// (0 is a real value and is shown as 0.)
const val = (v: unknown) => (v === undefined || v === null || v === '' ? DASH : String(v))
const dirTone = (d: unknown): ZiTone =>
  d === 'bull' || d === 'up' || d === 'LONG' ? 'pos' : d === 'bear' || d === 'down' || d === 'SHORT' ? 'neg' : 'neutral'
const gateTone = (g: unknown): ZiTone => (g === 'ok' ? 'pos' : g === 'fail' ? 'neg' : 'warn')
const GATES = ['mtf', 'flow', 'trigger', 'session', 'adx', 'risk', 'news']
const TFS = ['4h', '1h', '15m']

/**
 * [2026-10-10] Was `#brainVisionBody`, an empty div filled with innerHTML by the
 * first polling IIFE in core/bootstrapBrainDash.ts (5 s). Same stores, same
 * fields, same values — only the rendering changed. THEIA re-renders on its own
 * 12 s tick and the stores are subscribed, so no new timer is added.
 *
 * Field mapping (old renderer -> this card):
 *   useBrainStore: brain (BM), brainState, thoughts, adaptParams, blockReason
 *   useATStore:    enabled, killTriggered, totalTrades, wins
 *   window.S (the canonical bridge, as the old code and MarketLensCard use):
 *                  S.symbol, S.price, S.signalData.bullCount / bearCount
 *   Header   : S.symbol (sans USDT), S.price, BM.regimeEngine.regime || BM.structure.regime,
 *              BM.regimeEngine.confidence || BM.structure.score
 *   STATE    : brainState, BM.confluenceScore
 *   AT       : enabled, killTriggered, totalTrades, wins
 *   GATES    : BM.gates[mtf|flow|trigger|session|adx|risk|news] ('wait' when absent)
 *   SIGNALS  : S.signalData.bullCount / bearCount
 *   MTF      : BM.mtf['4h'|'1h'|'15m']
 *   REGIME   : BM.regimeEngine.regime / trendBias / trapRisk
 *   ATMOS    : BM.atmosphere.category / allowEntry / cautionLevel / reasons[0..1]
 *   FLOW     : BM.flow.cvd / delta / ofi (only when cvd or delta present, as before)
 *   DANGER   : BM.danger, BM.conviction, BM.convictionMult
 *   VOL      : BM.volRegime, BM.volPct
 *   PHASE    : BM.phaseFilter.phase / allow / riskMode / sizeMultiplier (only when phase)
 *   PROTECT  : BM.protectMode, BM.protectReason (only when active)
 *   BLOCK    : blockReason.code / text (only when a code exists)
 *   ADAPT    : adaptParams.sl / size / adjustCount (only when adjustCount > 0)
 *   THOUGHTS : last 5 of thoughts, newest first; time / type / msg
 */
export function BrainVisionCard() {
  const BM: any = useBrainStore((s: any) => s.brain)
  const brainState = useBrainStore((s: any) => s.brainState)
  const thoughts: any[] = useBrainStore((s: any) => s.thoughts) || []
  const adaptParams: any = useBrainStore((s: any) => s.adaptParams)
  const blockReason: any = useBrainStore((s: any) => s.blockReason)
  const atEnabled = useATStore((s: any) => s.enabled)
  const atKill = useATStore((s: any) => s.killTriggered)
  const atTrades = useATStore((s: any) => s.totalTrades)
  const atWins = useATStore((s: any) => s.wins)
  const S = (window as any).S || {}

  const b = BM || {}
  const re = b.regimeEngine || {}
  const sym = S.symbol ? String(S.symbol).replace('USDT', '') : DASH
  const price = S.price ? '$' + Number(S.price).toLocaleString(undefined, { maximumFractionDigits: 2 }) : DASH
  const regime = re.regime || b.structure?.regime
  const regimeConf = re.confidence || b.structure?.score
  const state = brainState || undefined
  const conf = b.confluenceScore
  const gates = b.gates || {}
  const sd = S.signalData
  const bulls = sd ? sd.bullCount || 0 : undefined
  const bears = sd ? sd.bearCount || 0 : undefined
  const mtf = b.mtf || {}
  const atm = b.atmosphere || {}
  const flow = b.flow || {}
  const pf = b.phaseFilter || {}
  const recent = thoughts.slice(-5).reverse()

  return (
    <div className="theia-card">
      <h4>Brain vision</h4>
      <div className="theia-rows">
        <ZiMetric label="Symbol" value={sym} secondary={`${price} · ${val(regime)} ${regimeConf !== undefined && regimeConf !== '' ? regimeConf + '%' : DASH}`} />
        <ZiMetric label="State" value={val(state)} secondary={`conf ${val(conf)}`} />
        <ZiMetric
          label="Auto trade"
          value={atEnabled === undefined ? DASH : atEnabled ? 'ON' : 'OFF'}
          tone={atEnabled === undefined ? 'neutral' : atEnabled ? 'pos' : 'neg'}
          secondary={`${atKill ? 'KILL · ' : ''}trades ${val(atTrades)} · W ${val(atWins)}`}
        />
        <ZiMetric
          label="Gates"
          value={GATES.map((g) => (
            <span key={g} style={{ color: toneColor(gateTone(gates[g] || 'wait')), marginLeft: 6 }}>
              {'● ' + g.toUpperCase()}
            </span>
          ))}
        />
        <ZiMetric label="Signals" value={bulls === undefined ? DASH : `▲${bulls} ▼${bears}`} secondary={bulls === undefined ? undefined : `= ${(bulls as number) + (bears as number)}`} />
        <ZiMetric
          label="MTF"
          value={TFS.map((tf) => {
            const d = mtf[tf] || 'neut'
            return <span key={tf} style={{ marginLeft: 6 }}>{tf}:{d === 'bull' ? '↑' : d === 'bear' ? '↓' : '↔'}</span>
          })}
        />
        <ZiMetric label="Regime" value={val(re.regime)} tone={dirTone(re.trendBias)} secondary={`bias ${val(re.trendBias)} · trap ${val(re.trapRisk)}%`} />
        {atm.category && (
          <ZiMetric label="Atmosphere" value={atm.category} tone={atm.allowEntry ? 'pos' : atm.cautionLevel === 'high' ? 'neg' : 'warn'} secondary={(atm.reasons || []).slice(0, 2).join(', ') || undefined} />
        )}
        {(flow.cvd || flow.delta) && (
          <ZiMetric label="Flow" value={`CVD ${val(flow.cvd)}`} tone={dirTone(flow.cvd)} secondary={`Δ ${val(flow.delta)} · OFI ${val(flow.ofi)}`} />
        )}
        <ZiMetric
          label="Danger"
          value={val(b.danger)}
          tone={typeof b.danger !== 'number' ? 'neutral' : b.danger > 60 ? 'neg' : b.danger > 30 ? 'warn' : 'pos'}
          secondary={`conv ${val(b.conviction)} × ${typeof b.convictionMult === 'number' ? b.convictionMult.toFixed(2) : DASH}`}
        />
        <ZiMetric
          label="Volatility"
          value={val(b.volRegime)}
          tone={b.volRegime === 'EXTREME' || b.volRegime === 'HIGH' ? 'neg' : b.volRegime === 'MED' ? 'warn' : 'neutral'}
          secondary={b.volPct === undefined || b.volPct === null ? DASH : `P${b.volPct}`}
        />
        {pf.phase && (
          <ZiMetric label="Phase" value={pf.phase} tone={pf.allow ? 'pos' : 'neg'} secondary={`${pf.riskMode || ''} size ×${pf.sizeMultiplier || 1}`} />
        )}
        {b.protectMode && <ZiMetric label="Protect" value="ACTIVE" tone="neg" secondary={b.protectReason || DASH} />}
        {blockReason && blockReason.code && <ZiMetric label="Block" value={blockReason.code} tone="neg" secondary={blockReason.text || undefined} />}
        {adaptParams && adaptParams.adjustCount > 0 && (
          <ZiMetric label="Adapt" value={`SL ${val(adaptParams.sl)}%`} tone="warn" secondary={`size $${val(adaptParams.size)} · ${adaptParams.adjustCount} adj`} />
        )}
      </div>
      <div style={{ borderTop: '1px solid var(--zi-hair)', marginTop: 8, paddingTop: 8 }}>
        <div className="zi-lbl" style={{ color: 'var(--zi-mut)', marginBottom: 6 }}>Thoughts</div>
        {recent.length === 0 && <div className="zi-num" style={{ fontSize: 11, color: 'var(--zi-lbl)' }}>{DASH}</div>}
        {recent.map((t, i) => {
          const isStr = typeof t === 'string'
          const msg = isStr ? t : t?.msg
          const col = isStr ? 'var(--zi-lbl)' : t.type === 'ok' ? 'var(--zi-pos)' : t.type === 'bad' ? 'var(--zi-neg)' : t.type === 'warn' ? 'var(--zi-warn)' : 'var(--zi-lbl)'
          const ago = !isStr && typeof t?.time === 'number' ? Math.round((Date.now() - t.time) / 60000) + 'm' : DASH
          return (
            <div key={i} className="zi-num" style={{ fontSize: 11, color: col, padding: '2px 0' }}>
              <span style={{ color: 'var(--zi-mut)' }}>{ago}</span> {String(msg ?? DASH).slice(0, 80)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
