import { memo } from 'react'
import { useAresStore } from '../../../stores/aresStore'
import type { AresObjective } from '../../../types/ares'

function ObjectiveBar({ obj }: { obj: AresObjective }) {
  const done = obj.status === 'done'
  const notStarted = obj.status === 'notstarted'
  if (notStarted) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
        <div style={{ width: 60, height: 4, background: 'rgba(255,255,255,0.12)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: '0%', height: '100%', background: obj.color }} />
        </div>
        <span style={{ color: 'rgba(255,255,255,0.28)', fontSize: 11 }}>0%</span>
      </div>
    )
  }
  if (done) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
        <div style={{ width: 60, height: 4, background: 'rgba(255,255,255,0.12)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: '100%', height: '100%', background: obj.color, boxShadow: `0 0 10px ${obj.color}` }} />
        </div>
        <span style={{ color: obj.color, fontSize: 11, fontWeight: 700 }}>✓ DONE</span>
      </div>
    )
  }
  const pw = Math.round((obj.pct / 100) * 60)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
      <div style={{ width: 60, height: 4, background: 'rgba(255,255,255,0.12)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pw}px`, height: '100%', background: obj.color, boxShadow: `0 0 8px ${obj.color}`, transition: 'width 0.4s' }} />
      </div>
      <span style={{ color: obj.color, fontSize: 11, fontWeight: 700 }}>{obj.pct}%</span>
    </div>
  )
}

/** Objectives column (3 rows with progress bars). */
export const ObjectivesCol = memo(function ObjectivesCol() {
  const objs = useAresStore((s) => s.ui.objectives)
  const title = useAresStore((s) => s.ui.objectivesTitle)
  return (
    <div id="ares-obj-col">
      <div className="ares-meta-title" id="ares-obj-title" style={{ textAlign: 'right', color: title.color || undefined }}>
        {title.text}
      </div>
      {objs.length ? objs.map((o) => (
        <div key={o.id}>
          <div
            className={'ares-obj-item' + (o.status === 'done' ? ' done' : o.status === 'active' ? ' active' : '')}
            id={'aobj-' + o.id}
            style={{
              color: o.status === 'done' ? o.colorDim : o.status === 'active' ? o.color : 'rgba(255,255,255,0.28)',
            }}
          >
            {o.label}
          </div>
          <div className="ares-obj-bar" id={'aobj-' + o.id + 'b'} style={{ textAlign: 'right' }}>
            <ObjectiveBar obj={o} />
          </div>
        </div>
      )) : (
        <>
          <div className="ares-obj-item" id="aobj-0">100 → 1,000</div>
          <div className="ares-obj-bar" id="aobj-0b" style={{ textAlign: 'right' }} />
          <div className="ares-obj-item" id="aobj-1">1,000 → 10,000</div>
          <div className="ares-obj-bar" id="aobj-1b" style={{ textAlign: 'right' }} />
          <div className="ares-obj-item" id="aobj-2">10,000 → 1M</div>
          <div className="ares-obj-bar" id="aobj-2b" style={{ textAlign: 'right' }} />
        </>
      )}
    </div>
  )
})
