import { useAUBStore } from '../../stores/aubStore'
import { aubToggle, aubToggleSFX, aubBBExport, aubBBClear, aubMacroClear, aubSimRun, aubSimApply } from '../../engine/aub'

export function AUBPanel() {
  const expanded = useAUBStore((s) => s.expanded)
  const sfxEnabled = useAUBStore((s) => s.sfxEnabled)
  const compatOk = useAUBStore((s) => s.compatOk)
  const compatRows = useAUBStore((s) => s.compatRows)
  const guardCount = useAUBStore((s) => s.guardCount)
  const guardLast = useAUBStore((s) => s.guardLast)
  const perfHeavy = useAUBStore((s) => s.perfHeavy)
  const rafFps = useAUBStore((s) => s.rafFps)
  const domSkips = useAUBStore((s) => s.domSkips)
  const dataLabel = useAUBStore((s) => s.dataLabel)
  const dataClass = useAUBStore((s) => s.dataClass)
  const bbCount = useAUBStore((s) => s.bbCount)
  const bbLast = useAUBStore((s) => s.bbLast)
  const mtf = useAUBStore((s) => s.mtf)
  const mtfPenalty = useAUBStore((s) => s.mtfPenalty)
  const corrEth = useAUBStore((s) => s.corrEth)
  const corrSol = useAUBStore((s) => s.corrSol)
  const corrPenalty = useAUBStore((s) => s.corrPenalty)
  const corrPenaltyText = useAUBStore((s) => s.corrPenaltyText)
  const macroHtml = useAUBStore((s) => s.macroHtml)
  const simStatus = useAUBStore((s) => s.simStatus)
  const simLast = useAUBStore((s) => s.simLast)
  const simResultHtml = useAUBStore((s) => s.simResultHtml)
  const simShowApply = useAUBStore((s) => s.simShowApply)

  const pct = (v: number) => Math.round(v * 100) + '%'

  return (
    <div id="aub" className={expanded ? 'expanded' : 'collapsed'}>
      <div id="aub-sweep"></div>

      <div id="aub-hdr" onClick={() => aubToggle()}>
        <div className="v6-accent">
          <div className="v6-ico">
            <svg viewBox="0 0 24 24">
              <ellipse cx="12" cy="18" rx="8" ry="2" />
              <path d="M8 18 C8 14 5 12 5 9 A7 7 0 0 1 19 9 C19 12 16 14 16 18" fill="none" />
              <circle cx="12" cy="8" r="1.5" />
              <line x1="12" y1="3" x2="12" y2="5" />
              <line x1="8" y1="4" x2="9" y2="6" />
              <line x1="16" y1="4" x2="15" y2="6" />
            </svg>
          </div>
          <span className="v6-lbl">AUB</span>
        </div>
        <div className="v6-content">
          <span id="aub-title">ALIEN UPGRADE BAY</span>
          <div id="aub-badges">
            <span className={`aub-badge ${compatOk ? 'ok' : 'warn'}`}>{compatOk ? 'COMPAT: OK' : 'COMPAT: LIMITED'}</span>
            <span className={`aub-badge ${perfHeavy ? 'warn' : 'ok'}`}>{perfHeavy ? 'PERF: HEAVY' : 'PERF: OK'}</span>
            <span className={`aub-badge ${dataClass}`}>{dataLabel}</span>
          </div>
          <button className={sfxEnabled ? 'on' : ''} onClick={(e) => { e.stopPropagation(); aubToggleSFX() }} title="Sound FX">
            <svg className="z-i" viewBox="0 0 16 16">
              {sfxEnabled
                ? <path d="M2 6h2l3-3v10l-3-3H2zM11 5a4 4 0 010 6M13 3a7 7 0 010 10" />
                : <path d="M2 6h2l3-3v10l-3-3H2zM11 6l4 4M11 10l4-4" />}
            </svg> SFX
          </button>
          <button onClick={(e) => { e.stopPropagation(); aubToggle() }}>
            <span className="aub-arrow">▼</span>
            <span>{expanded ? 'COLLAPSE' : 'EXPAND'}</span>
          </button>
        </div>
      </div>

      <div id="aub-body">
        {/* 1: COMPAT SHIELD */}
        <div className="aub-card cyan">
          <div className="aub-card-title">COMPATIBILITY SHIELD</div>
          <div dangerouslySetInnerHTML={{ __html: compatRows || '<div class="aub-row">Checking...</div>' }} />
        </div>

        {/* 2: INPUT GUARD */}
        <div className="aub-card violet">
          <div className="aub-card-title">INPUT GUARD</div>
          <div className="aub-row ok">● GUARD: ACTIVE</div>
          <div className="aub-row">Validated: {guardCount} calls</div>
          <div className="aub-row">Last reject: {guardLast}</div>
        </div>

        {/* 3: RENDER ORCHESTRATOR */}
        <div className="aub-card green">
          <div className="aub-card-title">RENDER ORCHESTRATOR</div>
          <div className="aub-row ok">● DATA: 2s | VISUAL: rAF</div>
          <div className="aub-row">rAF FPS: {rafFps}{perfHeavy ? ' (!)' : ''}</div>
          <div className="aub-row">DOM skips (no-change): {domSkips}</div>
        </div>

        {/* 4: DECISION BLACKBOX */}
        <div className="aub-card violet">
          <div className="aub-card-title">DECISION BLACKBOX</div>
          <div className="aub-row">Snapshots: {bbCount}</div>
          <div className="aub-row">{bbLast}</div>
          <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
            <button className="aub-btn violet" onClick={() => aubBBExport()}>
              <svg className="z-i" viewBox="0 0 16 16"><path d="M8 2v8m-3-3l3 3 3-3M3 14h10" /></svg> JSON
            </button>
            <button className="aub-btn violet" onClick={() => aubBBClear()}>
              <svg className="z-i" viewBox="0 0 16 16"><path d="M3 4h10M6 2h4v2M5 4v9h6V4m-4 2v5m2-5v5" /></svg> Clear
            </button>
          </div>
        </div>

        {/* 5: MTF HIERARCHY */}
        <div className="aub-card cyan">
          <div className="aub-card-title">MTF HIERARCHY</div>
          <div className="aub-mtf-bar-wrap">
            {(['4h', '1h', '15m', '5m'] as const).map((tf) => (
              <div className="aub-mtf-row" key={tf}>
                <span className="aub-mtf-lbl">{tf}</span>
                <div className="aub-mtf-track">
                  <div className="aub-mtf-fill" style={{ width: pct(mtf[tf]), background: tf === '4h' ? '#00d9ff' : tf === '1h' ? '#00d9ffaa' : tf === '15m' ? '#00d9ff66' : '#00d9ff33' }}></div>
                </div>
                <span className="aub-mtf-val">{mtf[tf] > 0 ? Math.round(mtf[tf] * 100) : '—'}</span>
              </div>
            ))}
          </div>
          <div className="aub-row" style={{ marginTop: '4px' }}>{mtfPenalty}</div>
        </div>

        {/* 6: CORRELATION FIELD */}
        <div className="aub-card green">
          <div className="aub-card-title">CORRELATION FIELD</div>
          <div>
            <div className="aub-row">Corr: BTC→ETH = <b>{corrEth}</b></div>
            <div className="aub-row">Corr: BTC→SOL = <b>{corrSol}</b></div>
            <div className={`aub-row ${corrPenalty ? 'warn' : ''}`}>{corrPenaltyText}</div>
          </div>
        </div>

        {/* 7: MACRO ANOMALY RADAR */}
        <div className="aub-card yellow">
          <div className="aub-card-title">MACRO ANOMALY RADAR</div>
          <div dangerouslySetInnerHTML={{ __html: macroHtml }} />
          <div style={{ display: 'flex', gap: '4px', marginTop: '5px' }}>
            <button className="aub-btn yellow" onClick={() => document.getElementById('aub-macro-file')?.click()}>
              <svg className="z-i" viewBox="0 0 16 16"><path d="M2 5h5l2 2h5v6H2V5z" /></svg> Import JSON
            </button>
            <button className="aub-btn yellow" onClick={() => aubMacroClear()}>
              <svg className="z-i" viewBox="0 0 16 16"><path d="M3 4h10M6 2h4v2M5 4v9h6V4m-4 2v5m2-5v5" /></svg> Clear
            </button>
          </div>
          <input type="file" id="aub-macro-file" accept=".json" style={{ display: 'none' }} onChange={(e) => (window as any).aubMacroFileLoad?.(e.target)} />
        </div>

        {/* 8: NIGHTLY SIM LAB */}
        <div className="aub-card violet">
          <div className="aub-card-title">NIGHTLY SIM LAB</div>
          <div className="aub-row">{simStatus}</div>
          <div className="aub-row">{simLast}</div>
          {simResultHtml && (
            <div className="aub-sim-result" dangerouslySetInnerHTML={{ __html: simResultHtml }} />
          )}
          <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
            <button className="aub-btn violet" onClick={() => aubSimRun()}>▶ Run Now</button>
            {simShowApply && (
              <button className="aub-btn violet" onClick={() => aubSimApply()}>✓ Apply</button>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
