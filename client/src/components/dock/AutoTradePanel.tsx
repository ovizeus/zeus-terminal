import { useState, useEffect, useMemo, useRef } from 'react'
import { useATStore, useSettingsStore, useUiStore } from '../../stores'
import { api } from '../../services/api'
import { MSCAN_SYMS } from '../../core/config'
import { toast } from '../../data/marketDataHelpers'
// [Phase 8D1] mscan state is server-owned — initial value comes from the
// already-loaded settingsStore. The settingsStore._syncToWindow writes the
// LS mirror that legacy engines (data/klines.ts::_mscanGetActive) read, so
// the panel no longer writes LS directly. Remove the LS-as-source-of-truth
// pathway to eliminate the double-write race against the server/WS push.
import { resetKillSwitch } from '../../trading/autotrade'
import { ATStatusIcon } from '../ATStatusIcon'
import { AtWhyBlockedPill } from './AtWhyBlockedPill'
import { ZiPanel, ZiSection, ZiMetric } from '../zi'
import type { ZiTone } from '../zi'
import { AutoTradeConfigDrawer } from './AutoTradeConfigDrawer'

/** Parse a string input to number for save; empty/invalid → fallback. */
function toNum(s: string, fallback: number): number {
  if (s == null || s === '') return fallback
  const n = Number(s)
  return Number.isFinite(n) ? n : fallback
}

/** 1:1 port of .at-sep + #atPanel from public/index.html lines 1684-2033 */
export function AutoTradePanel() {
  const killTriggered = useATStore((s) => s.killTriggered)
  const ui = useATStore((s) => s.ui)
  // [Task 3] read-only selectors for the state line and the P&L tones.
  const armed = useATStore((s) => s.enabled)
  const totalPnL = useATStore((s) => s.totalPnL)
  const dailyPnL = useATStore((s) => s.dailyPnL)
  // Phase 2C: read canonical executionEnv. null = LOCKED.
  const executionEnv = useUiStore((s) => s.executionEnv)
  const executionBlockedReason = useUiStore((s) => s.executionBlockedReason)
  // [Phase 12.A — Batch D1] Canonical exchange identity for dynamic labels.
  const activeExchange = useUiStore((s) => s.activeExchange)
  const _exchLabel = activeExchange === 'binance' ? 'Binance' : activeExchange === 'bybit' ? 'Bybit' : 'your active exchange'

  // Numeric fields are held as STRINGS so the user can fully clear the input
  // (value === "") without React forcing a leading "0" back in. We parse to
  // number only on save / when the engines need it via _syncToWindow.
  const [confMin, setConfMin] = useState('65')
  const [sigMin, setSigMin] = useState('3')
  const [atSize, setAtSize] = useState('200')
  const [atRiskPct, setAtRiskPct] = useState('1')
  const [atMaxDay, setAtMaxDay] = useState('5')
  const [atMaxPos, setAtMaxPos] = useState('3')
  const [atSL, setAtSL] = useState('1.5')
  const [atRR, setAtRR] = useState('2')
  const [atKillPct, setAtKillPct] = useState('5')
  const [atLossStreak, setAtLossStreak] = useState('3')
  const [atMaxAddon, setAtMaxAddon] = useState('2')
  const [atLev, setAtLev] = useState('5')
  const [adaptEnabled, setAdaptEnabled] = useState(false)
  const [adaptLive, setAdaptLive] = useState(false)
  const [smartExit, setSmartExit] = useState(false)
  const [symPickerOpen, setSymPickerOpen] = useState(false)

  // Multi-symbol scan state — reactive label + picker.
  // [Phase 8D1] Initial value comes from settingsStore (server-backed single
  // source of truth). Falls back to the full MSCAN_SYMS list only if the
  // store has not loaded yet — storeSettings useEffect below rehydrates on
  // loadFromServer completion. No direct LS read here anymore.
  const [mscanEnabled, setMscanEnabled] = useState<boolean>(() => {
    const s = useSettingsStore.getState().settings
    return s.mscanEnabled != null ? !!s.mscanEnabled : true
  })
  const [mscanSyms, setMscanSyms] = useState<string[]>(() => {
    const s = useSettingsStore.getState().settings
    if (Array.isArray(s.mscanSyms) && s.mscanSyms.length > 0) return s.mscanSyms
    return MSCAN_SYMS.slice()
  })

  // Re-hydrate whenever the server settings load/change. The store is
  // populated asynchronously by useServerSync — without this subscription
  // the fields stay at their defaults after F5.
  const storeSettings = useSettingsStore((s) => s.settings)
  const storeLoaded = useSettingsStore((s) => s.loaded)
  // [SETTINGS-PERSIST FIX 2026-06-08] Hydrate each panel input from the settings
  // store ONLY when the SERVER value genuinely CHANGED since the last hydration —
  // NOT on every storeSettings reference change. Pre-fix this ran on every store
  // update (routine WS/settings sync produces a fresh object even when values are
  // unchanged) and unconditionally clobbered the operator's in-progress edits:
  // change leverage → a sync re-ran this effect → setAtLev reverted to the saved
  // value → "I change it and it reverts, doesn't persist". The lastHyd ref makes
  // a no-op sync leave edits intact, while a real server change still reflects.
  const _lastHyd = useRef<Record<string, unknown>>({})
  useEffect(() => {
    if (!storeLoaded) return
    const s = storeSettings as Record<string, unknown>
    const p = _lastHyd.current
    const H = (val: unknown, key: string, setter: (v: string) => void) => {
      if (val == null || val === p[key]) return
      p[key] = val
      setter(String(val))
    }
    const HB = (val: unknown, key: string, setter: (v: boolean) => void) => {
      if (val == null || val === p[key]) return
      p[key] = val
      setter(!!val)
    }
    H(s.confMin, 'confMin', setConfMin)
    H(s.sigMin, 'sigMin', setSigMin)
    H(s.size, 'size', setAtSize)
    H(s.riskPct, 'riskPct', setAtRiskPct)
    H(s.maxDay, 'maxDay', setAtMaxDay)
    H(s.maxPos, 'maxPos', setAtMaxPos)
    H(s.sl, 'sl', setAtSL)
    H(s.rr, 'rr', setAtRR)
    H(s.killPct, 'killPct', setAtKillPct)
    H(s.lossStreak, 'lossStreak', setAtLossStreak)
    H(s.maxAddon, 'maxAddon', setAtMaxAddon)
    H(s.lev, 'lev', setAtLev)
    HB(s.adaptEnabled, 'adaptEnabled', setAdaptEnabled)
    HB(s.adaptLive, 'adaptLive', setAdaptLive)
    HB(s.smartExitEnabled, 'smartExitEnabled', setSmartExit)
    HB(s.mscanEnabled, 'mscanEnabled', setMscanEnabled)
    if (Array.isArray(s.mscanSyms) && s.mscanSyms.length > 0) {
      const j = JSON.stringify(s.mscanSyms)
      if (j !== p.mscanSyms) { p.mscanSyms = j; setMscanSyms(s.mscanSyms as string[]) }
    }
  }, [storeLoaded, storeSettings])

  // [Phase 8D1] No direct LS write here. mscan selection is committed via
  // handleSaveAT → settingsStore.patch → _syncToWindow (writes LS mirror) +
  // saveToServer. Matches the behavior of every other AT field on this panel
  // (size, SL, RR, etc.) — all persist only on explicit SAVE, not per keystroke.

  // Phase 3 C4: push the 6 AT config fields (lev/size/slPct/rr/maxPos/sigMin)
  // into atStore.config on every edit, so atStore (and by extension the
  // TC Proxy installed in core/state.ts) reflects the panel value without
  // waiting for Save. NaN (from empty/invalid input) is guarded-out by
  // patchConfig, leaving the previous store value intact. adxMin + cooldownMs
  // are not panel inputs and stay on their hydrated/default values.
  useEffect(() => {
    const _n = (s: string) => {
      if (s == null || s === '') return NaN
      const v = Number(s)
      return Number.isFinite(v) ? v : NaN
    }
    useATStore.getState().patchConfig({
      lev: _n(atLev),
      size: _n(atSize),
      slPct: _n(atSL),
      rr: _n(atRR),
      maxPos: _n(atMaxPos),
      sigMin: _n(sigMin),
    })
  }, [atLev, atSize, atSL, atRR, atMaxPos, sigMin])

  // [SETTINGS-PERSIST FIX 2026-06-08] Commit a leverage change so it actually
  // STICKS. The bare setAtLev only updated React state → atStore.config (TC
  // Proxy) via the patch effect; but settingsStore was untouched, so the next
  // loadFromServer/_projectAll re-projected the SAVED lev onto atStore.config
  // and the button "reverted". And the brain's stc only updated on the 60s TC
  // push — too late, already reverted. Now a click: (1) updates atStore.config
  // (brain source), (2) patches settingsStore (display source — stops the
  // _projectAll revert), (3) pushes to the brain stc NOW via the direct
  // /api/tc/sync path (reliable — no optimistic-concurrency), (4) schedules the
  // userSettings save so it persists across reload. Same shape used for the
  // other AT controls' Save, but leverage commits live (it's a toggle, like
  // kill-%). Operator: "at nu ma lasa sa schimb leverage, il schimb si revine".
  function commitLev(v: string) {
    setAtLev(v)
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) return
    const w = window as unknown as { pushTCtoServer?: () => void; _usScheduleSave?: () => void }
    try { useATStore.getState().patchConfig({ lev: n }) } catch (_) { /* defensive */ }
    try { useSettingsStore.getState().patch({ lev: n }) } catch (_) { /* defensive */ }
    try { if (typeof w.pushTCtoServer === 'function') w.pushTCtoServer() } catch (_) { /* defensive */ }
    try { if (typeof w._usScheduleSave === 'function') w._usScheduleSave() } catch (_) { /* defensive */ }
  }

  // Close the sym picker on outside click (React owns state now — legacy
  // document-level listener in klines.ts only mutates DOM style and would
  // desync with React state).
  useEffect(() => {
    if (!symPickerOpen) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('#atSymPickerDrop')) return
      if (target.closest('#atSymPickerCard')) return
      setSymPickerOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [symPickerOpen])

  const mscanLabel = useMemo(() => {
    if (!mscanEnabled) return 'DISABLED'
    return 'ACTIVE — ' + mscanSyms.length + ' symbols'
  }, [mscanEnabled, mscanSyms])

  function toggleSym(sym: string) {
    setMscanSyms((prev) => prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym])
  }
  function pickAll(all: boolean) {
    setMscanSyms(all ? MSCAN_SYMS.slice() : [])
  }

  async function handleSaveAT() {
    const w = window as any
    try {
      const store = useSettingsStore.getState()
      store.patch({
        sl: toNum(atSL, 1.5), rr: toNum(atRR, 2),
        size: toNum(atSize, 200), riskPct: toNum(atRiskPct, 1),
        maxDay: toNum(atMaxDay, 5), maxPos: toNum(atMaxPos, 3),
        killPct: toNum(atKillPct, 5), lossStreak: toNum(atLossStreak, 3),
        maxAddon: toNum(atMaxAddon, 2), lev: toNum(atLev, 5),
        confMin: toNum(confMin, 65), sigMin: toNum(sigMin, 3),
        adaptEnabled, adaptLive, smartExitEnabled: smartExit,
        mscanEnabled, mscanSyms,
      })
      await store.saveToServer()
      if (typeof w.saveUserSettings === 'function') w.saveUserSettings()
      // [Phase 10.8] Fixed: w.toast (window.toast) was never assigned anywhere,
      // so SAVE SETTINGS visibly did nothing even though the save succeeded.
      // Use the imported toast() from marketDataHelpers directly.
      toast('AT settings saved \u2713')
    } catch (err: any) {
      console.error('[AT] Save failed:', err)
      toast('Save failed: ' + (err?.message || 'unknown'))
    }
  }

  async function handleKill() {
    await api.post('/api/at/kill', { reason: 'manual' })
  }

  const [toggling, setToggling] = useState(false)
  function handleToggle() {
    if (toggling) return // guard against rapid double-click
    setToggling(true)
    const w = window as any
    if (typeof w.toggleAutoTrade === 'function') w.toggleAutoTrade()
    setTimeout(() => setToggling(false), 1000) // unlock after 1s
  }

  // [2026-10-10 institutional redesign, Task 3 — DESIGN ONLY] The panel shows
  // live state only. Every setting lives in AutoTradeConfigDrawer, which gets the
  // same state/handlers (state stays owned here). Positions: #atActivePosPanel is
  // filled imperatively by trading/autotrade.ts::renderATPositions(), which carries
  // the one-panel-per-position ownership logic — it is deliberately NOT rebuilt.
  const [cfgOpen, setCfgOpen] = useState(false)
  const killed = killTriggered || ui.killBtnTriggered
  const pnlTone = (n: number): ZiTone => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'neutral')
  const ACTION_BTN: React.CSSProperties = {
    flexGrow: 1, height: 36, background: 'var(--zi-raise)', border: '1px solid var(--zi-edge)', borderRadius: 3,
    color: 'var(--zi-val)', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 600, cursor: 'pointer',
  }

  // [2026-10-20 b293] Intrarea in jurnal era un `zi-lbl` de 9px, subliniat,
  // lipit in dreapta — adica o ţinta de apasat cat o scama. Operatorul a cerut
  // explicit „gen buton apas si intru". Acum e buton pe toata latimea, din
  // aceeasi familie cu ACTION_BTN (aceleasi culori si bordura), cu scris de
  // 12px si inaltime 40 ca sa fie o ţinta reala la degetul mare pe telefon.
  const JOURNAL_BTN: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    width: '100%', height: 40, background: 'var(--zi-raise)',
    border: '1px solid var(--zi-edge)', borderRadius: 3,
    color: 'var(--zi-val)', fontSize: 12, letterSpacing: '0.14em',
    textTransform: 'uppercase', fontWeight: 700, cursor: 'pointer',
    textDecoration: 'none',
  }

  return (
    <>
    <div id="atPanel" style={{ height: '100%' }}>
    <ZiPanel
      title="Auto Trade"
      rail={killed ? 'neg' : armed ? 'pos' : 'neutral'}
      action={
        <button
          type="button"
          aria-label="Open configuration"
          onClick={() => setCfgOpen(true)}
          style={{ background: 'none', border: '1px solid var(--zi-line)', borderRadius: 3, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer' }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="var(--zi-lbl)" strokeWidth="1.2" aria-hidden="true">
            <circle cx="8" cy="8" r="2.2" />
            <path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3" />
          </svg>
        </button>
      }
    >
      {/* THE ONE TRUTH LINE: armed/idle · demo/live · cycle (the engine's own status text) */}
      <div style={{ padding: '14px 16px 6px', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span className="zi-num" style={{ fontSize: 15, fontWeight: 600, letterSpacing: '0.04em', color: armed ? 'var(--zi-pos)' : 'var(--zi-mut)' }}>
          {armed ? 'ARMED' : 'IDLE'}
        </span>
        <span style={{ color: 'var(--zi-faint)', fontSize: 12 }}>/</span>
        <span className="zi-num" style={{ fontSize: 15, fontWeight: 500, letterSpacing: '0.04em' }}>
          <ATStatusIcon kind={ui.modeLabel.icon} />
          {ui.modeLabel.icon ? ' ' : ''}{ui.modeLabel.text}
        </span>
        <span style={{ flexGrow: 1 }} />
        <span className="zi-lbl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ATStatusIcon kind={ui.status.icon} />
          {ui.status.text}
        </span>
        {ui.status.action === 'resetKill' && (
          <button data-action="resetKillSwitch" type="button" onClick={() => resetKillSwitch()}
            style={{ color: 'var(--zi-pos)', background: 'none', border: '1px solid var(--zi-edge)', borderRadius: 2, padding: '4px 10px', minHeight: 28, fontSize: 10, letterSpacing: '0.1em', cursor: 'pointer', fontFamily: 'inherit' }}>
            RESET KILL SWITCH
          </button>
        )}
      </div>
      <div style={{ padding: '0 16px 10px' }}>
        <AtWhyBlockedPill />{/* [R30] store-driven subscriber; source: brainStore.safetyPill */}
        {ui.sentinel.visible && (
          <div className="zi-lbl" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <ATStatusIcon kind={ui.sentinel.icon} />
            {ui.sentinel.icon ? ' ' : ''}{ui.sentinel.text}
          </div>
        )}
      </div>

      {ui.liveWarnVisible && (
        <div role="alert" style={{ margin: '0 16px 12px', padding: '8px 10px', border: '1px solid var(--zi-edge)', borderLeft: '2px solid var(--zi-warn)', borderRadius: 2, fontSize: 11, lineHeight: 1.5, color: 'var(--zi-val)' }}>
          {executionEnv === 'TESTNET'
            ? <><strong>TESTNET MODE ACTIVE:</strong> Auto trades will execute with TEST funds on {_exchLabel} Testnet.</>
            : (executionEnv === 'REAL'
              ? <><strong>LIVE MODE ACTIVE:</strong> Auto trades will execute with REAL funds on {_exchLabel}.</>
              : <><strong>LIVE MODE LOCKED:</strong> {executionBlockedReason === 'INVALID_ACTIVE_API_CONFIGURATION' ? 'Invalid active API configuration' : 'No valid API credentials configured'}</>)}
        </div>
      )}

      {/* METRICS — every value is one the engine already computes into ui.* */}
      <div style={{ padding: '4px 16px 18px', display: 'flex', flexDirection: 'column', gap: 11 }}>
        <ZiMetric label="Balance" value={ui.balanceText} />
        <ZiMetric label="Auto trades" value={ui.totalTradesText} secondary={ui.winRateText} />
        <ZiMetric label="Auto P&L" value={ui.totalPnLText} tone={pnlTone(totalPnL)} />
        <ZiMetric label={ui.dailyLabel} value={ui.dailyLossText} tone={pnlTone(dailyPnL)} />
      </div>

      <ZiSection title="Positions" aside={ui.posCountText}>
        <div id="atActivePosPanel" style={{ minHeight: '32px' }}>
          <div style={{ textAlign: 'center', fontSize: '8px', color: 'var(--dim)', padding: '8px' }}>No active auto positions</div>
        </div>
      </ZiSection>

      <div style={{ flexGrow: 1 }} />
      <div className="zi-rule" />
      <div style={{ padding: '10px 16px 0' }}>
        <a href="/journal.html" style={JOURNAL_BTN} aria-label="Open the full trade journal">
          Full journal
          <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1, opacity: 0.7 }}>&rsaquo;</span>
        </a>
      </div>
      <div style={{ padding: '10px 16px 18px', display: 'flex', gap: 8 }}>
        <button type="button" onClick={handleToggle} disabled={toggling} style={ACTION_BTN}>
          {armed ? 'Disarm' : 'Arm'}
        </button>
        {/* EMERGENCY STOP — always in the panel, never behind the drawer */}
        <button
          type="button"
          onClick={handleKill}
          className={`zi-kill${killed ? ' triggered' : ''}`}
          style={{ ...ACTION_BTN, background: 'none', border: `1px solid ${killed ? 'var(--zi-neg)' : '#4a2630'}`, color: 'var(--zi-neg)', width: 'auto', margin: 0 }}
        >
          Close all
        </button>
      </div>
    </ZiPanel>
    </div>
    <AutoTradeConfigDrawer
      visible={cfgOpen}
      onClose={() => setCfgOpen(false)}
      onSave={handleSaveAT}
      form={{
        confMin, setConfMin, sigMin, setSigMin, atSize, setAtSize, atRiskPct, setAtRiskPct,
        atMaxDay, setAtMaxDay, atMaxPos, setAtMaxPos, atSL, setAtSL, atRR, setAtRR,
        atKillPct, setAtKillPct, atLossStreak, setAtLossStreak, atMaxAddon, setAtMaxAddon,
        atLev, setAtLev, commitLev, adaptEnabled, setAdaptEnabled, adaptLive, setAdaptLive,
        smartExit, setSmartExit, mscanEnabled, setMscanEnabled, mscanSyms, toggleSym, pickAll,
        symPickerOpen, setSymPickerOpen, mscanLabel, ui,
      }}
    />
    </>
  )
}
