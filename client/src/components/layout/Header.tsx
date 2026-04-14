import { useUiStore, useMarketStore, useAuthStore } from '../../stores'

export function Header() {
  const connected = useUiStore((s) => s.connected)
  const resolvedEnv = useUiStore((s) => s.resolvedEnv)
  const openModal = useUiStore((s) => s.openModal)
  const price = useMarketStore((s) => s.market.price)
  const prevPrice = useMarketStore((s) => s.market.prevPrice)
  const email = useAuthStore((s) => s.email)
  const role = useAuthStore((s) => s.role)
  const clearAuth = useAuthStore((s) => s.clearAuth)

  function handleLogout() {
    if (!confirm('Sigur vrei să te deloghezi?')) return
    fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' })
      .then(() => { clearAuth(); window.location.href = '/login.html' })
      .catch(() => { clearAuth(); window.location.href = '/login.html' })
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
            <button className="sbtn" title="Search (Ctrl+K)" id="cmdPaletteBtn" onClick={() => openModal('cmdpalette')}><svg width="16" height="16"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg></button>
            <button className="sbtn" title="Decision Log" id="dlogBtn" onClick={() => openModal('decisionlog')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></button>
            {/* NC bell wrap — badge shown/hidden by _ncUpdateBadge() in old JS */}
            <button className="sbtn" id="nc-bell-wrap" title="Notifications" onClick={() => openModal('notifications')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <span id="nc-badge">0</span>
            </button>
            <button className="sbtn" onClick={() => openModal('settings')} title="Settings Hub"><svg width="16"
              height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <path
                d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
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
            <span id="userEmail" style={{ fontSize: '8px', color: '#556', letterSpacing: '0.5px', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
          </div>
        </div>
      </div>

    </div>
  )
}
