import { useUiStore, useMarketStore, useAuthStore, useATStore, usePositionsStore } from '../../stores'

export function Header() {
  const connected = useUiStore((s) => s.connected)
  const openModal = useUiStore((s) => s.openModal)
  const price = useMarketStore((s) => s.market.price)
  const prevPrice = useMarketStore((s) => s.market.prevPrice)
  const email = useAuthStore((s) => s.email)
  const role = useAuthStore((s) => s.role)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  // [Phase 12.A — Batch E1] Global exchange+env badge derived from server truth.
  //   DEMO                 → single pill "DEMO"
  //   TESTNET + binance    → "TESTNET · BINANCE"
  //   TESTNET + bybit      → "TESTNET · BYBIT"
  //   TESTNET + null       → "TESTNET · ACTIVE EXCHANGE" (honest fallback)
  //   REAL    + binance    → "REAL · BINANCE"
  //   REAL    + bybit      → "REAL · BYBIT"
  //   REAL    + null       → "REAL · ACTIVE EXCHANGE"
  //   executionEnv === null → "LOCKED" (no creds / blocked)
  //   Click opens Settings modal so the user can jump straight to Exchange API.
  const executionEnv = useUiStore((s) => s.executionEnv)
  const activeExchange = useUiStore((s) => s.activeExchange)
  const engineMode = useATStore((s) => s.mode) || 'demo'
  const _badge = (() => {
    if (engineMode === 'demo' || executionEnv === 'DEMO') {
      return { text: 'DEMO', cls: 'zhb-demo' }
    }
    if (executionEnv === null) {
      return { text: 'LOCKED', cls: 'zhb-locked' }
    }
    const exch = activeExchange === 'binance' ? 'BINANCE' : activeExchange === 'bybit' ? 'BYBIT' : 'ACTIVE EXCHANGE'
    if (executionEnv === 'TESTNET') return { text: `TESTNET \u00B7 ${exch}`, cls: 'zhb-testnet' }
    return { text: `REAL \u00B7 ${exch}`, cls: 'zhb-real' }
  })()

  function handleLogout() {
    if (!confirm('Are you sure you want to log out?')) return
    const wipeAndGo = () => {
      clearAuth()
      // [Phase 3B] Explicitly reset per-user client stores so any render cycle
      // between clearAuth and navigation cannot show stale data from the
      // previous user. Window mirrors cleared too — some legacy code reads
      // w._executionEnv / w._resolvedEnv directly.
      try { useUiStore.getState().reset() } catch {}
      try { useATStore.getState().reset() } catch {}
      try { usePositionsStore.getState().reset() } catch {}
      try {
        const w = window as any
        w._executionEnv = null
        w._executionBlockedReason = null
        w._resolvedEnv = null
        w._exchangeMode = null
        w._apiConfigured = false
        w._activeExchange = null
        // AT engine flags — reset to safe defaults so stale state doesn't render briefly.
        if (w.AT) {
          w.AT.mode = 'demo'
          w.AT._serverMode = ''
          w.AT.enabled = false
        }
        if (w.S) w.S.mode = 'assist'
        // [Phase 8A3] Reset legacy window.TP fields in-place. Imported references
        // (state.ts exports TP; many modules hold the same object) stay valid but
        // contents no longer show the previous user's balance/positions during
        // any render cycle that fires before the navigation to /login.html.
        if (w.TP) {
          w.TP.demoOpen = false
          w.TP.liveOpen = false
          w.TP.demoSide = 'LONG'
          w.TP.liveSide = 'LONG'
          w.TP.demoBalance = 10000
          w.TP.demoPnL = 0
          w.TP.demoWins = 0
          w.TP.demoLosses = 0
          w.TP.demoPositions = []
          w.TP.livePositions = []
          w.TP.pendingOrders = []
          w.TP.manualLivePending = []
          w.TP.liveConnected = false
          w.TP.liveExchange = null
          w.TP.liveBalance = 0
          w.TP.liveAvailableBalance = 0
          w.TP.liveUnrealizedPnL = 0
        }
      } catch {}
      // [ZT-AUD-C4] Wipe per-user client storage so the next user on this
      // browser cannot see cached settings, ARES state, positions, or skip
      // the PIN gate (sessionStorage survives window.location.href).
      try { localStorage.clear() } catch {}
      try { sessionStorage.clear() } catch {}
      window.location.href = '/login.html'
    }
    fetch('/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-Zeus-Request': '1' } })
      .then(wipeAndGo)
      .catch(wipeAndGo)
  }

  const chg = prevPrice > 0 ? (price - prevPrice) / prevPrice * 100 : 0
  const chgClass = chg >= 0 ? 'up' : 'dn'
  const chgArrow = chg >= 0 ? '\u25B2' : '\u25BC'

  return (
    <div className="zeus-fixed-top">
      {/* ═══ Header — exact copy of .hdr ═══ */}
      <div className="hdr">
        <div className="brand">
          <img
            src={import.meta.env.BASE_URL + 'zeus-logo.png'}
            className="zlogo" alt="ZT" />
          <div>
            <div className="t1">ZEU&apos;S</div>
            <div className="t2">AI TRADING ANALYTICS</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <div className="bprice" id="bprice">
                {price > 0
                  ? `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '$\u2014'}
              </div>
              <div className={`bchg ${chgClass}`} id="bchg">{chgArrow} {Math.abs(chg).toFixed(2)}%</div>
            </div>
            <button id="installBtn" style={{
              display: 'none', marginTop: '3px',
              background: 'linear-gradient(90deg,#f0c040,#aa7700)', color: '#000', border: 'none',
              padding: '2px 8px', borderRadius: '10px', fontSize: '8px', fontWeight: 700,
              cursor: 'pointer', fontFamily: 'var(--ff)', alignItems: 'center', gap: '3px'
            }}>
              <svg className="z-i" viewBox="0 0 16 16"><path d="M8 1v8m-3-3l3 3 3-3M3 12h10v3H3z" /></svg>
              {' '}INSTALL APP
            </button>
            <div className="lrow2">
              <div className={`ldot${connected ? ' on' : ''}`} id="ldot"></div>
              <span id="llbl">{connected ? 'CONNECTED' : 'CONNECTING'}</span>
            </div>
          </div>
        </div>
        <div className="hdr-r">
          <div className="hdr-btns">
            {/* [BUG6] Bell removed — Notifications reachable via Alerts modal and Alt+N.
                Search moved into the bell's old slot (right of Decision Log). */}
            <button className="sbtn" title="Decision Log" id="dlogBtn" onClick={() => openModal('decisionlog')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></button>
            <button className="sbtn" title="Search (Ctrl+K)" id="cmdPaletteBtn" onClick={() => openModal('cmdpalette')}><svg width="16" height="16"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg></button>
            <button className="sbtn" onClick={() => openModal('settings')} title="Settings Hub"><svg width="16"
              height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg></button>
            <button className="sbtn" id="adminBtn" title="Admin Panel"
              style={{ display: role === 'admin' ? undefined : 'none' }} onClick={() => openModal('adminPage')}><svg width="16" height="16"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg></button>
            <button className="sbtn" id="logoutBtn" title="Logout" onClick={handleLogout}><svg width="16" height="16"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg></button>
          </div>
          <div className="hdr-price">
            {/* [Phase 12.A — Batch E1] Exchange+env identity badge. Inline styles
                (no global CSS touch) keep this additive and isolated. */}
            <button
              type="button"
              id="hdrExchBadge"
              title="Exchange + execution env. Click to open Settings."
              onClick={() => openModal('settings')}
              style={{
                fontSize: '9px',
                fontWeight: 700,
                letterSpacing: '1.5px',
                padding: '3px 7px',
                marginBottom: '2px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontFamily: 'var(--ff)',
                border: '1px solid',
                background: 'transparent',
                color: _badge.cls === 'zhb-demo' ? '#aa44ff'
                  : _badge.cls === 'zhb-testnet' ? '#f0c040'
                  : _badge.cls === 'zhb-real' ? '#ff4466'
                  : /* locked */ '#ff8844',
                borderColor: _badge.cls === 'zhb-demo' ? '#aa44ff66'
                  : _badge.cls === 'zhb-testnet' ? '#f0c04066'
                  : _badge.cls === 'zhb-real' ? '#ff446666'
                  : '#ff884466',
                whiteSpace: 'nowrap',
              }}
            >{_badge.text}</button>
            <span id="userEmail" style={{ fontSize: '8px', color: '#556', letterSpacing: '0.5px', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
          </div>
        </div>
      </div>

    </div>
  )
}
