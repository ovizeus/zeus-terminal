import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ModalOverlay, ModalHeader } from '../modals/ModalOverlay'
import { ATStatusIcon } from '../ATStatusIcon'
import { MSCAN_SYMS } from '../../core/config'
import type { ATUI } from '../../stores/atStore'

type Tab = 'symbols' | 'entry' | 'risk' | 'advanced'
const TABS: { id: Tab; label: string }[] = [
  { id: 'symbols', label: 'Symbols' },
  { id: 'entry', label: 'Entry' },
  { id: 'risk', label: 'Risk' },
  { id: 'advanced', label: 'Advanced' },
]

/**
 * Everything the controls are bound to. State, setters and handlers are OWNED
 * by AutoTradePanel (hydration from the settings store, the atStore.config
 * patch effect, commitLev, handleSaveAT all read this state) and passed in, so
 * nothing is duplicated and no store call changes.
 */
export interface ATConfigFormProps {
  confMin: string; setConfMin: (v: string) => void
  sigMin: string; setSigMin: (v: string) => void
  atSize: string; setAtSize: (v: string) => void
  atRiskPct: string; setAtRiskPct: (v: string) => void
  atMaxDay: string; setAtMaxDay: (v: string) => void
  atMaxPos: string; setAtMaxPos: (v: string) => void
  atSL: string; setAtSL: (v: string) => void
  atRR: string; setAtRR: (v: string) => void
  atKillPct: string; setAtKillPct: (v: string) => void
  atLossStreak: string; setAtLossStreak: (v: string) => void
  atMaxAddon: string; setAtMaxAddon: (v: string) => void
  atLev: string; setAtLev: (v: string) => void
  commitLev: (v: string) => void
  adaptEnabled: boolean; setAdaptEnabled: (v: boolean) => void
  adaptLive: boolean; setAdaptLive: (v: boolean) => void
  smartExit: boolean; setSmartExit: (v: boolean) => void
  mscanEnabled: boolean; setMscanEnabled: (v: boolean) => void
  mscanSyms: string[]
  toggleSym: (sym: string) => void
  pickAll: (all: boolean) => void
  symPickerOpen: boolean; setSymPickerOpen: (v: boolean) => void
  mscanLabel: string
  ui: Pick<ATUI, 'condConf' | 'condConfClass' | 'condSig' | 'condSigClass' | 'modeDisplay'>
}

// [2026-10-10 institutional redesign, Task 3 — DESIGN ONLY] Colours are the
// --zi-* tokens; ids, values, checked and onChange are exactly what the panel had.
const INPUT: CSSProperties = {
  background: 'var(--zi-field)', border: '1px solid var(--zi-line)', color: 'var(--zi-val)',
  borderRadius: 2, padding: '6px 8px', fontSize: 13, minHeight: 32, textAlign: 'right',
  fontFamily: 'var(--zi-mono)', fontVariantNumeric: 'tabular-nums', boxSizing: 'border-box',
}
const ROW: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '7px 0', minHeight: 40 }
const NOTE: CSSProperties = { margin: '2px 0 8px 24px', fontSize: 10, lineHeight: 1.5, color: 'var(--zi-mut)' }
const CHK: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', fontSize: 12, color: 'var(--zi-val)', cursor: 'pointer', minHeight: 32 }
const SMALL_BTN: CSSProperties = {
  background: 'transparent', border: '1px solid var(--zi-edge)', color: 'var(--zi-val)', borderRadius: 2,
  cursor: 'pointer', fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '6px 10px', minHeight: 28,
}

function Title({ children }: { children: ReactNode }) {
  return <div className="zi-lbl" style={{ margin: '0 0 6px' }}>{children}</div>
}

/** One "label ... [number input] unit" row. Pure presentation: the caller passes the same attributes the input had. */
function NumRow({ id, label, unit, value, onChange, min, max, step, width = 72 }: {
  id: string; label: string; unit?: string; value: string; onChange: (v: string) => void
  min?: number; max?: number; step?: number; width?: number
}) {
  return (
    <div style={ROW}>
      <label htmlFor={id} style={{ fontSize: 12, color: 'var(--zi-val)' }}>{label}</label>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--zi-mut)', fontSize: 11 }}>
        <input type="number" id={id} value={value} onChange={(e) => onChange(e.target.value)} min={min} max={max} step={step} style={{ ...INPUT, width }} />
        {unit && <span style={{ minWidth: 40 }}>{unit}</span>}
      </span>
    </div>
  )
}

/**
 * [2026-10-10] Auto Trade's settings used to sit in the trade panel, which is
 * why that panel was 563 lines and carried three diagnostic surfaces as well.
 * The panel now shows live state only; everything you set lives here.
 *
 * Every control below is bound to the SAME state and the SAME change handler it
 * was bound to in the panel. The controls were moved, not reimplemented.
 * AutoTradePanel.handleSaveAT is invoked from this drawer's Save.
 *
 * STAYS MOUNTED WHEN CLOSED (hidden, like every ModalOverlay): legacy code reads
 * these inputs by DOM id (core/config.ts saveUserSettings via _iv('atSL', 1.5),
 * state.ts atMaxDay, the atSmartExit / atMultiSym checkboxes...). A missing
 * element makes those readers fall back to DEFAULTS and persist them over the
 * user's real settings. It is portaled to document.body so the panel's own body
 * still contains no settings control.
 */
export function AutoTradeConfigDrawer({
  visible,
  onClose,
  onSave,
  form: f,
}: {
  visible: boolean
  onClose: () => void
  onSave?: () => void
  form: ATConfigFormProps
}) {
  const [tab, setTab] = useState<Tab>('risk')
  const pane = (id: Tab, children: ReactNode) => (
    <div role="tabpanel" id={`atcfg-pane-${id}`} aria-labelledby={`atcfg-tab-${id}`} hidden={tab !== id} style={{ padding: 18 }}>
      {children}
    </div>
  )

  const overlay = (
    <ModalOverlay id="matcfg" visible={visible} onClose={onClose} zIndex={9500}>
      <div className="zi">
        <ModalHeader title="AUTO TRADE · CONFIGURATION" onClose={onClose} />
        <div role="tablist" aria-label="Configuration sections" style={{ display: 'flex', gap: 22, padding: '14px 18px 0' }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`atcfg-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`atcfg-pane-${t.id}`}
              onClick={() => setTab(t.id)}
              style={{
                background: 'none', border: 0,
                borderBottom: `1px solid ${tab === t.id ? 'var(--zi-val)' : 'transparent'}`,
                color: tab === t.id ? 'var(--zi-val)' : 'var(--zi-mut)',
                fontFamily: 'inherit', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
                fontWeight: 600, padding: '0 2px 9px', cursor: 'pointer', minHeight: 32,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="zi-rule" />

        {/* SYMBOLS — #atSymbolSection is revealed and #atSymbolGrid is filled by core/bootstrapStartApp.ts */}
        {pane('symbols', (
          <div id="atSymbolSection" style={{ display: 'none' }}>
            <Title>Trading symbols</Title>
            <div id="atSymbolGrid" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '4px 0' }}></div>
            <div style={NOTE}>Select which symbols the AT engine trades for you</div>
          </div>
        ))}

        {/* ENTRY */}
        {pane('entry', (
          <div>
            <Title>Entry conditions (all must be OK)</Title>
            <div style={ROW}>
              <label htmlFor="atConfMin" style={{ fontSize: 12 }}>Confluence Score</label>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--zi-mut)', fontSize: 11 }}>
                ≥ <input type="number" id="atConfMin" value={f.confMin} onChange={(e) => f.setConfMin(e.target.value)} min={50} max={95} style={{ ...INPUT, width: 64 }} /> <span className={f.ui.condConfClass}>{f.ui.condConf}</span>
              </span>
            </div>
            <div style={ROW}>
              <label htmlFor="atSigMin" style={{ fontSize: 12 }}>Aligned signals</label>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--zi-mut)', fontSize: 11 }}>
                ≥ <input type="number" id="atSigMin" value={f.sigMin} onChange={(e) => f.setSigMin(e.target.value)} min={2} max={6} style={{ ...INPUT, width: 56 }} /> <span className={f.ui.condSigClass}>{f.ui.condSig}</span>
              </span>
            </div>
          </div>
        ))}

        {/* RISK */}
        {pane('risk', (
          <div>
            <Title>Risk management</Title>
            <NumRow id="atSize" label="Size per Trade" unit="USDT" value={f.atSize} onChange={f.setAtSize} min={10} step={10} />
            <NumRow id="atRiskPct" label="Risk % / Trade" unit="%" value={f.atRiskPct} onChange={f.setAtRiskPct} min={0.1} max={5} step={0.1} />
            <NumRow id="atMaxDay" label="Max Trades / Day" unit="/day" value={f.atMaxDay} onChange={f.setAtMaxDay} min={1} max={20} />
            <NumRow id="atMaxPos" label="Max Open Positions" unit="pos" value={f.atMaxPos} onChange={f.setAtMaxPos} min={1} max={10} />
            <NumRow id="atSL" label="Stop Loss" unit="%" value={f.atSL} onChange={f.setAtSL} min={0.3} max={10} step={0.1} />
            <NumRow id="atRR" label="Take Profit (R:R)" unit=":1" value={f.atRR} onChange={f.setAtRR} min={1} max={5} step={0.5} />
            <NumRow id="atKillPct" label="Drawdown % / Day" unit="%" value={f.atKillPct} onChange={f.setAtKillPct} min={1} max={20} step={0.5} />
            <NumRow id="atLossStreak" label="Loss Streak Limit" unit="losses" value={f.atLossStreak} onChange={f.setAtLossStreak} min={1} max={10} />
            <NumRow id="atMaxAddon" label="Max Add-ons" unit="add-ons" value={f.atMaxAddon} onChange={f.setAtMaxAddon} min={0} max={5} />
            {/* Multi-Symbol Scan row */}
            <div id="atMscanRow" style={{ ...ROW, flexWrap: 'wrap', position: 'relative' }}>
              <span style={{ fontSize: 12 }}>Multi-Symbol Scan</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" id="atMultiSym" aria-label="Multi-symbol scan" checked={f.mscanEnabled} onChange={(e) => f.setMscanEnabled(e.target.checked)} />
                <div id="atSymPickerCard" onClick={() => f.setSymPickerOpen(!f.symPickerOpen)}
                  style={{ cursor: 'pointer', background: 'var(--zi-raise)', border: '1px solid var(--zi-edge)', borderRadius: 2, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, minHeight: 28 }}>
                  <span style={{ color: 'var(--zi-val)', fontSize: 10, fontWeight: 600 }} id="atMultiSymLbl">{f.mscanLabel}</span>
                  <span style={{ color: 'var(--zi-mut)', fontSize: 8 }}>▼</span>
                </div>
              </div>
              {f.symPickerOpen && (
                <div id="atSymPickerDrop"
                  style={{ position: 'absolute', right: 0, top: '100%', zIndex: 999, background: 'var(--zi-card)', border: '1px solid var(--zi-edge)', borderRadius: 3, padding: 10, minWidth: 200, boxShadow: '0 8px 24px rgba(0,0,0,.6)', marginTop: 4 }}
                  onClick={(e) => e.stopPropagation()}>
                  <div className="zi-lbl" style={{ marginBottom: 8 }}>
                    Select symbols ({f.mscanSyms.length}/{MSCAN_SYMS.length})
                  </div>
                  <div id="atSymPickerList" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {MSCAN_SYMS.map((sym) => {
                      const short = sym.replace('USDT', '')
                      const checked = f.mscanSyms.includes(sym)
                      return (
                        <label key={sym} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '5px 4px', borderRadius: 2, fontSize: 11, color: 'var(--zi-val)' }}>
                          <input type="checkbox" checked={checked} onChange={() => f.toggleSym(sym)} />
                          <span style={{ fontWeight: 600, minWidth: 40 }}>{short}</span>
                          <span style={{ color: 'var(--zi-faint)', fontSize: 9 }}>{sym}</span>
                        </label>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, borderTop: '1px solid var(--zi-line)', paddingTop: 8 }}>
                    <button type="button" onClick={() => f.pickAll(true)} style={{ ...SMALL_BTN, flex: 1 }}>Select all</button>
                    <button type="button" onClick={() => f.pickAll(false)} style={{ ...SMALL_BTN, flex: 1 }}>Clear</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* ADVANCED — GLOBAL MODE + LEVERAGE AUTO + ADVANCED CONTROLS */}
        {pane('advanced', (
          <div>
            <Title>Global mode</Title>
            <div style={{ background: 'var(--zi-field)', border: '1px solid var(--zi-line)', padding: '8px 10px', borderRadius: 2, fontSize: 11, color: 'var(--zi-val)', letterSpacing: '0.08em', textAlign: 'center', cursor: 'default', marginBottom: 14 }}>
              <ATStatusIcon kind={f.ui.modeDisplay.icon} />
              {f.ui.modeDisplay.icon ? ' ' : ''}{f.ui.modeDisplay.text}
              {f.ui.modeDisplay.lockSuffix && (
                <>
                  {' · '}
                  <ATStatusIcon kind="w" />
                  {' EXEC LOCKED'}
                </>
              )}
            </div>

            <Title>Leverage auto</Title>
            {/* [Phase 10.8] Preset pills + free-form input. User explicitly
                requested no upper cap ("sa nu fiu limitat"); server / Binance
                will reject invalid values at order placement time. */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 16 }}>
              {['2', '5', '10', '20'].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => f.commitLev(v)}
                  aria-pressed={f.atLev === v}
                  style={{
                    padding: '6px 10px', minHeight: 32,
                    background: f.atLev === v ? 'var(--zi-raise)' : 'transparent',
                    border: '1px solid ' + (f.atLev === v ? 'var(--zi-val)' : 'var(--zi-edge)'),
                    color: f.atLev === v ? 'var(--zi-val)' : 'var(--zi-mut)',
                    borderRadius: 2, fontSize: 11, cursor: 'pointer', fontFamily: 'var(--zi-mono)', fontWeight: 600,
                  }}
                >
                  {v}x
                </button>
              ))}
              <input
                id="atLev"
                aria-label="Custom leverage"
                type="number"
                min={1}
                step={1}
                value={f.atLev}
                onChange={(e) => f.setAtLev(e.target.value)}
                placeholder="custom"
                style={{ ...INPUT, flex: 1, minWidth: 56 }}
              />
            </div>

            <Title>Advanced controls</Title>
            <label className="zi-chk" style={CHK}>
              <input type="checkbox" id="atAdaptEnabled" checked={f.adaptEnabled} onChange={(e) => f.setAdaptEnabled(e.target.checked)} />
              Enable Adaptive Mode (master)
            </label>
            <label className="zi-chk" style={CHK}>
              <input type="checkbox" id="atAdaptLive" checked={f.adaptLive} onChange={(e) => f.setAdaptLive(e.target.checked)} />
              Allow live position adjustment
            </label>
            <div style={NOTE}>When OFF: all macro multipliers = ×1.00, no entry/sizing changes.</div>
            <label className="zi-chk" style={CHK}>
              <input type="checkbox" id="atSmartExit" checked={f.smartExit} onChange={(e) => f.setSmartExit(e.target.checked)} />
              Enable Smart Exit (auto-exec)
            </label>
            <div style={NOTE}>When OFF: advisory only. When ON: emergency exits may execute if signals double-confirmed + cooldown.</div>
          </div>
        ))}

        <div className="zi-rule" />
        <div style={{ padding: '14px 18px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flexGrow: 1 }} />
          <button
            type="button"
            onClick={() => { onSave?.(); onClose() }}
            style={{ height: 34, padding: '0 22px', background: 'var(--zi-raise)', border: '1px solid var(--zi-edge)', borderRadius: 3, color: 'var(--zi-val)', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 600, cursor: 'pointer' }}
          >
            Save
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
  return createPortal(overlay, document.body)
}
