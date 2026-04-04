import { useUiStore, useMarketStore, useAuthStore } from '../../stores'

export function Header() {
  const connected = useUiStore((s) => s.connected)
  const toggleSettings = useUiStore((s) => s.toggleSettings)
  const resolvedEnv = useUiStore((s) => s.resolvedEnv)
  const price = useMarketStore((s) => s.market.price)
  const prevPrice = useMarketStore((s) => s.market.prevPrice)
  const email = useAuthStore((s) => s.email)
  const role = useAuthStore((s) => s.role)

  const chg = prevPrice > 0 ? (price - prevPrice) / prevPrice * 100 : 0
  const chgClass = chg >= 0 ? 'up' : 'dn'
  const chgArrow = chg >= 0 ? '\u25B2' : '\u25BC'

  const modeClass = resolvedEnv === 'LIVE' ? 'zsb-live'
    : resolvedEnv === 'TESTNET' ? 'zsb-testnet'
    : 'zsb-demo'

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
              <div className="bprice">
                {price > 0
                  ? `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '$\u2014'}
              </div>
              <div className={`bchg ${chgClass}`}>{chgArrow} {Math.abs(chg).toFixed(2)}%</div>
            </div>
            <div className="lrow2">
              <div className={`ldot${connected ? ' on' : ''}`}></div>
              <span>{connected ? 'CONNECTED' : 'CONNECTING'}</span>
            </div>
          </div>
        </div>
        <div className="hdr-r">
          <div className="hdr-btns">
            <button className="sbtn" title="Search (Ctrl+K)"><svg width="16" height="16"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg></button>
            <button className="sbtn" title="Decision Log"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></button>
            <button className="sbtn" onClick={toggleSettings} title="Settings Hub"><svg width="16"
              height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <path
                d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
            </svg></button>
            {role === 'admin' && (
              <button className="sbtn" title="Admin Panel"><svg width="16" height="16"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg></button>
            )}
            <button className="sbtn sbtn--logout" title="Logout"><svg width="16" height="16"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg></button>
          </div>
          <div className="hdr-price">
            <span style={{ fontSize: '8px', color: '#556', letterSpacing: '0.5px', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
          </div>
        </div>
      </div>

      {/* ═══ Status Bar — below header ═══ */}
      <div className="zeus-status-bar">
        <div className={`zsb-item zsb-mode ${modeClass}`} title="Trading Mode">{resolvedEnv || 'DEMO'}</div>
        <div className="zsb-sep"></div>
        <div className="zsb-item" title="AutoTrade State"><span className="zsb-dot zsb-off"></span>AT OFF</div>
        <div className="zsb-sep"></div>
        <div className="zsb-item" title="WebSocket Connection"><span className={`zsb-dot ${connected ? 'zsb-on' : 'zsb-off'}`}></span>WS</div>
        <div className="zsb-sep"></div>
        <div className="zsb-item" title="Data Freshness"><span className={`zsb-dot ${connected ? 'zsb-on' : 'zsb-stale'}`}></span>DATA</div>
        <div className="zsb-sep"></div>
        <div className="zsb-item" title="Open Positions" style={{ cursor: 'pointer' }}>0 pos</div>
        <div className="zsb-sep"></div>
        <div className="zsb-item" title="Daily PnL">$0.00</div>
      </div>
    </div>
  )
}
