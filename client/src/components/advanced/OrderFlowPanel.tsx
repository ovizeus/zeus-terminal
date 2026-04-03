import { useOrderFlowStore } from '../../stores'

function FlowFlag({ label, active, detail }: { label: string; active: boolean; detail?: string }) {
  return (
    <div className={`zr-flow-flag ${active ? 'zr-flow-flag--active' : ''}`}>
      <span className="zr-flow-flag__label">{label}</span>
      <span className={`zr-flow-flag__dot ${active ? 'zr-flow-flag__dot--on' : ''}`} />
      {active && detail && <span className="zr-flow-flag__detail">{detail}</span>}
    </div>
  )
}

export function OrderFlowPanel() {
  const flow = useOrderFlowStore((s) => s.flow)

  const healthCls = flow.health === 'OK' ? 'zr-flow-health--ok'
    : flow.health === 'THIN' ? 'zr-flow-health--thin'
    : 'zr-flow-health--dead'

  const deltaCls = flow.deltaPct > 0 ? 'zr-kv__value--grn'
    : flow.deltaPct < 0 ? 'zr-kv__value--red' : ''

  return (
    <div className="zr-flow">
      <div className="zr-flow__header">
        <span className={`zr-flow-health ${healthCls}`}>FLOW:{flow.health}</span>
        {flow.flags.instAct && <span className="zr-flow-inst">INST</span>}
      </div>

      {/* Core Metrics */}
      <div className="zr-flow__metrics">
        <div className="zr-kv">
          <span className="zr-kv__label">Delta</span>
          <span className={`zr-kv__value ${deltaCls}`}>{flow.deltaPct.toFixed(1)}%</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Velocity</span>
          <span className="zr-kv__value">{flow.deltaVel.toFixed(2)}</span>
        </div>
        <div className="zr-kv">
          <span className="zr-kv__label">Z-Score</span>
          <span className={`zr-kv__value ${Math.abs(flow.z) > 2 ? 'zr-kv__value--ylw' : ''}`}>
            {flow.z.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Flow Flags */}
      <div className="zr-flow__flags">
        <FlowFlag label="ABS" active={flow.abs.active} detail={`${flow.abs.side} ${flow.abs.peakDeltaPct.toFixed(1)}%`} />
        <FlowFlag label="TRAP" active={flow.trap.active} detail={flow.trap.dir} />
        <FlowFlag label="VAC" active={flow.vacuum.active} detail={`${flow.vacuum.dir} ${flow.vacuum.movePct.toFixed(1)}%`} />
        <FlowFlag label="FLIP" active={flow.dFlip.active} detail={flow.dFlip.dir} />
        <FlowFlag label="ICE" active={flow.ice.active} detail={flow.ice.side} />
      </div>

      {/* Exhaustion */}
      {flow.exhaust.side && (
        <div className="zr-flow__exhaust">
          <span className="zr-kv__label">Exhaust</span>
          <span className={`zr-kv__value ${flow.exhaust.side === 'BUY' ? 'zr-kv__value--grn' : 'zr-kv__value--red'}`}>
            {flow.exhaust.side} str:{flow.exhaust.strength.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  )
}
