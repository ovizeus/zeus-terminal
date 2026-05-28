/**
 * Zeus — WS Health Indicator
 * Shows server WS proxy status in header: LIVE / DEGRADED / OFFLINE
 * Listens to market.health + market.degraded + market.recovered from /ws/sync
 */

import { useState, useEffect } from 'react'

type WsStatus = 'LIVE' | 'DEGRADED' | 'STUCK' | 'OFFLINE' | 'OFF'

const COLORS: Record<WsStatus, string> = {
  LIVE: '#00d97a',
  DEGRADED: '#ffaa00',
  STUCK: '#ffaa00',
  OFFLINE: '#ff3355',
  OFF: 'var(--dim)',
}

const LABELS: Record<WsStatus, string> = {
  LIVE: 'WS',
  DEGRADED: 'WS DEGRADED',
  STUCK: 'WS STUCK',
  OFFLINE: 'WS OFFLINE',
  OFF: 'WS OFF',
}

export function WsHealthIndicator() {
  const [status, setStatus] = useState<WsStatus>('OFF')
  const w = window as any

  useEffect(() => {
    if (!(w.__MF && w.__MF.WS_PROXY_ENABLED)) {
      setStatus('OFF')
      return
    }

    setStatus('LIVE')

    function onWsFrame(e: Event) {
      const msg = (e as CustomEvent).detail
      if (!msg || !msg.type) return

      if (msg.type === 'market.health') {
        const s = msg.status as string
        if (s === 'LIVE' || s === 'DEGRADED' || s === 'STUCK' || s === 'OFFLINE') setStatus(s as WsStatus)
      } else if (msg.type === 'market.degraded') {
        setStatus('DEGRADED')
      } else if (msg.type === 'market.recovered') {
        setStatus('LIVE')
      }
    }

    window.addEventListener('zeus:wsFrame', onWsFrame)
    return () => window.removeEventListener('zeus:wsFrame', onWsFrame)
  }, [])

  if (status === 'OFF') return null

  const color = COLORS[status]
  const label = LABELS[status]

  return (
    <span style={{
      fontSize: '8px',
      fontFamily: 'var(--ff)',
      letterSpacing: '1.5px',
      color,
      padding: '1px 5px',
      border: `1px solid ${color}44`,
      borderRadius: '3px',
      marginLeft: '6px',
      userSelect: 'none',
    }}>
      <span style={{
        display: 'inline-block',
        width: '5px',
        height: '5px',
        borderRadius: '50%',
        backgroundColor: color,
        marginRight: '3px',
        verticalAlign: 'middle',
        boxShadow: status === 'LIVE' ? `0 0 4px ${color}` : 'none',
      }} />
      {label}
    </span>
  )
}
