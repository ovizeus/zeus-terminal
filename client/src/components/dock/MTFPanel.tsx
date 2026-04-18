// Zeus — components/dock/MTFPanel.tsx
// [ZT3-B] Store-driven panel (Option A). Subscribes to mtfStore (populated by
// engine/mtfSync.ts) and renders all rows without relying on getElementById
// writes by legacy renderMTFPanel(). The DOM-id values/classes remain on the
// rendered elements so the legacy strip-bar CSS selectors keep working during
// the transition; the engine writes that mutated them are stripped in ZT3-C.

import { useMTFStore, type MTFCell, type MTFDir, type MTFTone } from '../../stores/mtfStore'

const tfs: Array<'15m' | '1h' | '4h'> = ['15m', '1h', '4h']

function classFor(tone: MTFTone): string {
  return 'mtf-val' + (tone ? ' ' + tone : '')
}

function tfBadgeClass(dir: MTFDir): string {
  return 'mtf-tf-badge ' + dir
}

function Row({ label, id, cell, style }: { label: string; id: string; cell: MTFCell; style?: React.CSSProperties }) {
  return (
    <div className="mtf-row">
      <span className="mtf-lbl" style={style}>{label}</span>
      <span className={classFor(cell.tone)} id={id}>{cell.text}</span>
    </div>
  )
}

export function MTFPanel() {
  const s = useMTFStore((st) => st.snapshot)
  return (
    <div id="mtf-strip-panel">
      <Row label="REGIME" id="mtf-regime" cell={s.regime} />
      <Row label="STRUCTURE" id="mtf-structure" cell={s.structure} />
      <Row label="ATR%" id="mtf-atr" cell={s.atrPct} />
      <Row label="VOL MODE" id="mtf-vol" cell={s.volMode} />
      <Row label="SQUEEZE" id="mtf-squeeze" cell={s.squeeze} />
      <Row label="ADX" id="mtf-adx" cell={s.adx} />
      <Row label="VOL REGIME" id="mtf-vol-regime" cell={s.volRegime} />
      <Row label="VOL PERCENTILE" id="mtf-vol-pct" cell={s.volPct} />
      <div style={{ height: '1px', background: '#00d9ff0a', margin: '4px 0' }}></div>
      <Row label="SWEEP" id="mtf-sweep" cell={s.sweep} />
      <Row label="TRAP RATE" id="mtf-trap-rate" cell={s.trapRate} />
      <Row label="MAGNET ↑" id="mtf-mag-above" cell={s.magnetAbove} />
      <Row label="MAGNET ↓" id="mtf-mag-below" cell={s.magnetBelow} />
      <Row label="MAG BIAS" id="mtf-mag-bias" cell={s.magnetBias} />
      <div style={{ height: '1px', background: '#00d9ff0a', margin: '4px 0' }}></div>
      <div className="mtf-row"><span className="mtf-lbl">MTF ALIGN</span>
        <div className="mtf-tf-row" id="mtf-tf-badges">
          {tfs.map((tf) => (
            <span key={tf} className={tfBadgeClass(s.align[tf].dir)} id={`mtf-${tf}`}>{s.align[tf].text}</span>
          ))}
        </div>
      </div>
      <div className="mtf-row"><span className="mtf-lbl">ALIGN SCORE</span><span className="mtf-val" id="mtf-score-txt">{s.scoreText}</span></div>
      <div className="mtf-score-bar">
        <div className="mtf-score-fill" id="mtf-score-fill" style={{ width: s.score + '%' }}></div>
      </div>
      <div className="mtf-update-ts" id="mtf-ts">{s.updatedText}</div>
      <div style={{ height: '1px', background: '#f0c04022', margin: '4px 0' }}></div>
      <Row label="RE REGIME" id="re-regime" cell={s.re.regime} style={{ color: '#f0c040' }} />
      <Row label="RE TRAP" id="re-trap" cell={s.re.trapRisk} style={{ color: '#f0c040' }} />
      <Row label="RE CONF" id="re-conf" cell={s.re.confidence} style={{ color: '#f0c040' }} />
      <div style={{ height: '1px', background: '#88f04022', margin: '4px 0' }}></div>
      <Row label="PF PHASE" id="pf-phase" cell={s.pf.phase} style={{ color: '#88f040' }} />
      <Row label="PF RISK" id="pf-risk" cell={s.pf.riskMode} style={{ color: '#88f040' }} />
      <Row label="PF SIZE" id="pf-size" cell={s.pf.sizeMultiplier} style={{ color: '#88f040' }} />
    </div>
  );
}
