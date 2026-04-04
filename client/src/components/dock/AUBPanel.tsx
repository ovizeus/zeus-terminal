/** AUB (Alien Upgrade Bay) dock page view — 1:1 from index.html lines 976-1124
 *  Header + sweep FX + 8 diagnostic cards. */
import { useState } from 'react'

export function AUBPanel() {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <div id="aub" className={isOpen ? 'expanded' : 'collapsed'}>
      {/* Holo sweep FX layer */}
      <div id="aub-sweep"></div>

      {/* ── Header (always visible) — 1:1 from index.html line 983 ── */}
      <div id="aub-hdr" onClick={() => setIsOpen(o => !o)}>
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
            <span className="aub-badge ok" id="aub-badge-compat">COMPAT: OK</span>
            <span className="aub-badge ok" id="aub-badge-perf">PERF: OK</span>
            <span className="aub-badge info" id="aub-badge-data">DATA: WAIT</span>
          </div>
          <button id="aub-sfx-btn" onClick={(e) => e.stopPropagation()} title="Sound FX">
            <svg className="z-i" viewBox="0 0 16 16">
              <path d="M2 6h2l3-3v10l-3-3H2zM11 6l4 4M11 10l4-4" />
            </svg> SFX
          </button>
          <button id="aub-toggle-btn" onClick={(e) => { e.stopPropagation(); setIsOpen(o => !o) }}>
            <span className="aub-arrow">▼</span>
            <span id="aub-toggle-txt">{isOpen ? 'COLLAPSE' : 'EXPAND'}</span>
          </button>
        </div>
      </div>

      {/* ── Body — 8 diagnostic cards ── */}
      <div id="aub-body">

        {/* 1: COMPAT SHIELD */}
        <div className="aub-card cyan" id="aub-card-compat">
          <div className="aub-card-title">COMPATIBILITY SHIELD</div>
          <div id="aub-compat-list">
            <div className="aub-row">
              <svg className="z-i" viewBox="0 0 16 16">
                <path d="M4 2h8v3L9 8l3 3v3H4v-3l3-3-3-3V2" />
              </svg> Checking...
            </div>
          </div>
        </div>

        {/* 2: INPUT GUARD */}
        <div className="aub-card violet" id="aub-card-guard">
          <div className="aub-card-title">INPUT GUARD</div>
          <div className="aub-row ok">● GUARD: ACTIVE</div>
          <div className="aub-row" id="aub-guard-count">Validated: 0 calls</div>
          <div className="aub-row" id="aub-guard-last">Last reject: —</div>
        </div>

        {/* 3: RENDER ORCHESTRATOR */}
        <div className="aub-card green" id="aub-card-perf">
          <div className="aub-card-title">RENDER ORCHESTRATOR</div>
          <div className="aub-row ok" id="aub-perf-mode">● DATA: 2s | VISUAL: rAF</div>
          <div className="aub-row" id="aub-perf-fps">rAF FPS: —</div>
          <div className="aub-row" id="aub-perf-skips">DOM skips (no-change): 0</div>
        </div>

        {/* 4: DECISION BLACKBOX */}
        <div className="aub-card violet" id="aub-card-bb">
          <div className="aub-card-title">DECISION BLACKBOX</div>
          <div className="aub-row" id="aub-bb-count">Snapshots: 0</div>
          <div className="aub-row" id="aub-bb-last">Last: —</div>
          <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
            <button className="aub-btn violet">
              <svg className="z-i" viewBox="0 0 16 16">
                <path d="M8 2v8m-3-3l3 3 3-3M3 14h10" />
              </svg> JSON
            </button>
            <button className="aub-btn violet">
              <svg className="z-i" viewBox="0 0 16 16">
                <path d="M3 4h10M6 2h4v2M5 4v9h6V4m-4 2v5m2-5v5" />
              </svg> Clear
            </button>
          </div>
        </div>

        {/* 5: MTF HIERARCHY */}
        <div className="aub-card cyan" id="aub-card-mtf">
          <div className="aub-card-title">MTF HIERARCHY</div>
          <div className="aub-mtf-bar-wrap">
            <div className="aub-mtf-row">
              <span className="aub-mtf-lbl">4h</span>
              <div className="aub-mtf-track">
                <div className="aub-mtf-fill" id="aub-mtf-4h" style={{ width: '0%', background: '#00d9ff' }}></div>
              </div>
              <span className="aub-mtf-val" id="aub-mtf-4h-v">—</span>
            </div>
            <div className="aub-mtf-row">
              <span className="aub-mtf-lbl">1h</span>
              <div className="aub-mtf-track">
                <div className="aub-mtf-fill" id="aub-mtf-1h" style={{ width: '0%', background: '#00d9ffaa' }}></div>
              </div>
              <span className="aub-mtf-val" id="aub-mtf-1h-v">—</span>
            </div>
            <div className="aub-mtf-row">
              <span className="aub-mtf-lbl">15m</span>
              <div className="aub-mtf-track">
                <div className="aub-mtf-fill" id="aub-mtf-15m" style={{ width: '0%', background: '#00d9ff66' }}></div>
              </div>
              <span className="aub-mtf-val" id="aub-mtf-15m-v">—</span>
            </div>
            <div className="aub-mtf-row">
              <span className="aub-mtf-lbl">5m</span>
              <div className="aub-mtf-track">
                <div className="aub-mtf-fill" id="aub-mtf-5m" style={{ width: '0%', background: '#00d9ff33' }}></div>
              </div>
              <span className="aub-mtf-val" id="aub-mtf-5m-v">—</span>
            </div>
          </div>
          <div className="aub-row" id="aub-mtf-penalty" style={{ marginTop: '4px' }}>Penalty: none</div>
        </div>

        {/* 6: CORRELATION FIELD */}
        <div className="aub-card green" id="aub-card-corr">
          <div className="aub-card-title">CORRELATION FIELD</div>
          <div id="aub-corr-list">
            <div className="aub-row">Corr: BTC→ETH = <b id="aub-corr-eth">—</b></div>
            <div className="aub-row">Corr: BTC→SOL = <b id="aub-corr-sol">—</b></div>
            <div className="aub-row" id="aub-corr-penalty">Penalty: inactive</div>
          </div>
        </div>

        {/* 7: MACRO ANOMALY RADAR */}
        <div className="aub-card yellow" id="aub-card-macro">
          <div className="aub-card-title">MACRO ANOMALY RADAR</div>
          <div id="aub-macro-events">
            <div className="aub-row">No events loaded</div>
          </div>
          <div style={{ display: 'flex', gap: '4px', marginTop: '5px' }}>
            <button className="aub-btn yellow">
              <svg className="z-i" viewBox="0 0 16 16">
                <path d="M2 5h5l2 2h5v6H2V5z" />
              </svg> Import JSON
            </button>
            <button className="aub-btn yellow">
              <svg className="z-i" viewBox="0 0 16 16">
                <path d="M3 4h10M6 2h4v2M5 4v9h6V4m-4 2v5m2-5v5" />
              </svg> Clear
            </button>
          </div>
          <input type="file" id="aub-macro-file" accept=".json" style={{ display: 'none' }} />
        </div>

        {/* 8: NIGHTLY SIM LAB */}
        <div className="aub-card violet" id="aub-card-sim">
          <div className="aub-card-title">NIGHTLY SIM LAB</div>
          <div className="aub-row" id="aub-sim-status">Status: Idle</div>
          <div className="aub-row" id="aub-sim-last">Last run: never</div>
          <div className="aub-sim-result" id="aub-sim-result" style={{ display: 'none' }}></div>
          <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
            <button className="aub-btn violet">▶ Run Now</button>
            <button className="aub-btn violet" id="aub-sim-apply" style={{ display: 'none' }}>✓ Apply</button>
          </div>
        </div>

      </div>
    </div>
  )
}
