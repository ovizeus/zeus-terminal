import { useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Per-panel "what is this?" info. A pink (i) button in the page-view header opens a card
 * explaining, for a brand-new user, exactly what the panel does. UI-only / read-only.
 * Content keyed by dock id (see DOCK_TITLES in PanelShell). Only panels with an entry here
 * render the (i) button — others simply omit it until their copy is written.
 */
export const PANEL_INFO: Record<string, { title: string; body: string }> = {
  autotrade: {
    title: 'AutoTrade',
    body: `AutoTrade is Zeus's fully autonomous trading engine. When it is ON, it decides and places trades by itself — no manual input needed.

How it decides: the "brain" fuses several market signals (RSI, SuperTrend, MACD, funding rate, open interest) into a market regime (trend / range / breakout) plus a direction and a confidence score. It only opens a trade when that confidence clears your threshold.

What you control here:
• Confidence floor — the minimum conviction required before it trades.
• Position size / Risk % — how big each trade is.
• Leverage — the multiplier applied to each position.
• Stop-Loss % — where the protective stop sits.
• Risk:Reward — how far the take-profit is, relative to the stop.
• Max positions — how many trades it can hold at once.
• Kill-Switch — an automatic halt if losses hit a set %.
• Multi-Symbol Scan (MSCAN) — lets the engine watch several coins at the same time and pick the best setups.

Brain Vision & Dashboard show you, live, what the brain is thinking — the chosen direction, its confidence, the current regime, and the signals behind each decision.

Every automatic position is opened with a protective Stop-Loss and Take-Profit, and is sized by tier (SMALL / MEDIUM / LARGE) according to how strong the signal is. The engine runs on the server, so it keeps trading even when the app or your phone is closed. Changes to the settings above take effect only after you press Save.`,
  },
}

export function PanelInfoButton({ infoKey }: { infoKey?: string | null }) {
  const [open, setOpen] = useState(false)
  const info = infoKey ? PANEL_INFO[infoKey] : null
  if (!info) return null

  return (
    <>
      <button
        type="button"
        aria-label={`About ${info.title}`}
        title="What is this panel?"
        onClick={() => setOpen(true)}
        style={{
          marginLeft: 'auto', marginRight: 4, width: 24, height: 24, borderRadius: '50%',
          border: '1.5px solid #ff2d95', background: 'rgba(255,45,149,0.12)', color: '#ff2d95',
          fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontWeight: 700,
          fontSize: 15, lineHeight: '21px', cursor: 'pointer', flex: '0 0 auto', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >i</button>

      {open && createPortal((
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 540, width: '100%', maxHeight: '80vh', overflowY: 'auto',
              background: '#0d1420', border: '1px solid rgba(255,45,149,0.45)', borderRadius: 12,
              boxShadow: '0 12px 48px rgba(0,0,0,0.6), 0 0 24px rgba(255,45,149,0.18)',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.08)', position: 'sticky', top: 0, background: '#0d1420',
            }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%', border: '1.5px solid #ff2d95',
                color: '#ff2d95', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flex: '0 0 auto',
              }}>i</span>
              <span style={{ fontWeight: 700, color: '#e8eef6', fontSize: 15 }}>{info.title}</span>
              <button
                type="button" aria-label="Close" onClick={() => setOpen(false)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#7a9ab8', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4 }}
              >✕</button>
            </div>
            <div style={{ padding: '14px 18px', color: '#c5d2e0', fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {info.body}
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  )
}
