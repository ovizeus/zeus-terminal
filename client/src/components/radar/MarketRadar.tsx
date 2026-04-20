// Zeus Terminal — Market Radar panel (Phase 11.4.2)
//
// Consumes useMarketRadarStore (green / red FIFO queues) and renders two
// horizontally-scrolling marquee bands beneath the chart. Each band is a
// self-looping CSS keyframe track; we duplicate the pill list inline so the
// scroll appears seamless without JS animation work.
//
// Interaction:
//   - Click pill → switchWLSymbol(ev.symbol) → drives the chart/kline WS
//     exactly like the Watchlist bar (and mirrors patch({symbol}) into the
//     market store so the active-row highlight updates).
//   - Hover band → CSS pauses animation-play-state on the track.
//   - Footer badge "updated Xs ago" re-renders every 1s via a tick state.
//
// Labeling:
//   Title is explicit: "TOP 300 BINANCE USDT · 24h VOL" — the universe is a
//   liquidity ranking (Binance futures USDT perpetuals by 24h quoteVolume),
//   NOT a global market-cap snapshot. We keep that wording honest at all
//   times so users don't conflate radar hits with mcap moves.

import { useEffect, useState } from 'react'
import { useMarketRadarStore } from '../../stores/marketRadarStore'
import { useMarketStore } from '../../stores'
import { switchWLSymbol } from '../../services/symbols'
import type { RadarEvent, RadarCategory } from '../../types'
import './MarketRadar.css'

// ── Category presentation ──────────────────────────────────────────────
// icon + compact label for each category. Icons are unicode glyphs so no
// extra asset pipeline is needed.

const CATEGORY_META: Record<RadarCategory, { icon: string; label: string }> = {
    spike1h:        { icon: '▲', label: '1h spike' },
    dump1h:         { icon: '▼', label: '1h dump' },
    spike4h:        { icon: '▲', label: '4h spike' },
    dump4h:         { icon: '▼', label: '4h dump' },
    spike24h:       { icon: '▲', label: '24h spike' },
    dump24h:        { icon: '▼', label: '24h dump' },
    volSpike:       { icon: '⚡', label: 'vol spike' },
    rankUp:         { icon: '↑', label: 'rank up' },
    rankDown:       { icon: '↓', label: 'rank down' },
    newTop300:      { icon: '★', label: 'new TOP 300' },
    exitTop300:     { icon: '✖', label: 'exit TOP 300' },
    fundingExtreme: { icon: '₿', label: 'funding' },
    oiSurge:        { icon: '◉', label: 'OI surge' },
    liqLong:        { icon: '💥', label: 'long liq' },
    liqShort:       { icon: '💥', label: 'short liq' },
}

// ── Formatters ─────────────────────────────────────────────────────────
// Small, defensive, no dependencies. Every caller passes number|null|undef.

function fmtPct(n: number | null | undefined, digits = 2): string | null {
    if (n === null || n === undefined || !isFinite(n)) return null
    const s = (n >= 0 ? '+' : '') + n.toFixed(digits) + '%'
    return s
}

function fmtRatio(n: number | null | undefined): string | null {
    if (n === null || n === undefined || !isFinite(n)) return null
    return n.toFixed(2) + 'x'
}

function fmtNotional(n: number | null | undefined): string | null {
    if (n === null || n === undefined || !isFinite(n) || n <= 0) return null
    if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M'
    if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K'
    return '$' + n.toFixed(0)
}

function fmtFunding(n: number | null | undefined): string | null {
    // Binance fundingRate is a fraction per 8h (e.g. 0.0005 = 0.05%).
    if (n === null || n === undefined || !isFinite(n)) return null
    const pct = n * 100
    return (pct >= 0 ? '+' : '') + pct.toFixed(3) + '%'
}

function shortSym(sym: string): string {
    return sym.endsWith('USDT') ? sym.slice(0, -4) : sym
}

function secondsAgo(ts: number, now: number): number {
    return Math.max(0, Math.floor((now - ts) / 1000))
}

// ── Pill ───────────────────────────────────────────────────────────────

interface PillProps {
    ev: RadarEvent
    now: number
    onClick: (sym: string) => void
}

function Pill({ ev, now, onClick }: PillProps) {
    const meta = CATEGORY_META[ev.category]
    if (!meta) return null

    // Halo for freshly-minted TOP 300 entries (first 10s since emit).
    const isNewHalo = ev.category === 'newTop300' && (now - ev.ts) < 10_000

    const changePctStr = fmtPct(ev.changePct)
    const volRatioStr  = fmtRatio(ev.volRatio)
    const fundingStr   = ev.category === 'fundingExtreme' ? fmtFunding(ev.fundingRate) : null
    const oiStr        = ev.category === 'oiSurge' ? fmtPct(ev.oiChangePct, 1) : null
    const notionalStr  = (ev.category === 'liqLong' || ev.category === 'liqShort') ? fmtNotional(ev.notional) : null
    const btcDeltaStr  = fmtPct(ev.btcDelta, 1)
    const showBtcRel   = btcDeltaStr !== null && typeof ev.btcDelta === 'number' && Math.abs(ev.btcDelta) >= 0.5

    // Rank shift label: "+42 → #137" for rankUp, etc. Only render if we have
    // both prev and current ranks, otherwise suppress (noisy).
    let rankStr: string | null = null
    if (ev.category === 'rankUp' || ev.category === 'rankDown' || ev.category === 'newTop300' || ev.category === 'exitTop300') {
        if (typeof ev.rank === 'number' && ev.rank > 0) {
            rankStr = '#' + ev.rank
            if (typeof ev.rankPrev === 'number' && ev.rankPrev > 0) {
                rankStr = '#' + ev.rankPrev + '→#' + ev.rank
            }
        }
    }

    const streak = typeof ev.streakCount === 'number' && ev.streakCount >= 2 ? ev.streakCount : null

    return (
        <button
            type="button"
            className={`mr-pill${isNewHalo ? ' mr-halo' : ''}`}
            onClick={() => onClick(ev.symbol)}
            title={`${ev.symbol} • ${meta.label} • ${secondsAgo(ev.ts, now)}s ago`}
        >
            <span className="mr-pill-icon">{meta.icon}</span>
            <span className="mr-pill-sym">{shortSym(ev.symbol)}</span>
            <span className="mr-pill-cat">{meta.label}</span>
            {changePctStr && <span className="mr-pill-chg">{changePctStr}</span>}
            {volRatioStr && <span className="mr-pill-vol">vol {volRatioStr}</span>}
            {rankStr && <span className="mr-pill-rank">{rankStr}</span>}
            {fundingStr && <span className="mr-pill-funding">fr {fundingStr}</span>}
            {oiStr && <span className="mr-pill-oi">oi {oiStr}</span>}
            {notionalStr && <span className="mr-pill-liq">{notionalStr}</span>}
            {showBtcRel && <span className="mr-pill-btc">BTC {btcDeltaStr}</span>}
            {streak && <span className="mr-pill-streak">×{streak}</span>}
        </button>
    )
}

// ── Band ───────────────────────────────────────────────────────────────

interface BandProps {
    color: 'green' | 'red'
    events: RadarEvent[]
    now: number
    onPillClick: (sym: string) => void
}

function Band({ color, events, now, onPillClick }: BandProps) {
    // Idle state — show a quiet scanning message so the band never looks
    // broken when the server hasn't fired anything yet.
    if (events.length === 0) {
        return (
            <div className={`mr-band mr-band--${color} mr-band--idle`}>
                <span className="mr-idle">
                    {color === 'green' ? 'No bullish hits yet — scanning Binance liquidity universe…'
                                       : 'No bearish hits yet — scanning Binance liquidity universe…'}
                </span>
            </div>
        )
    }

    // Duplicate the list inline so the keyframe translate(-50%) lands exactly
    // at the start of the second copy, producing a seamless loop.
    const doubled = [...events, ...events]
    // Animation duration scales with pill count so density stays readable.
    const durationSec = Math.max(20, Math.min(90, events.length * 4))

    return (
        <div className={`mr-band mr-band--${color}`}>
            <div className="mr-track" style={{ animationDuration: `${durationSec}s` }}>
                {doubled.map((ev, i) => (
                    <Pill key={`${ev.ts}-${ev.symbol}-${ev.category}-${i}`} ev={ev} now={now} onClick={onPillClick} />
                ))}
            </div>
        </div>
    )
}

// ── Root component ─────────────────────────────────────────────────────

export function MarketRadar() {
    const green = useMarketRadarStore((s) => s.green)
    const red = useMarketRadarStore((s) => s.red)
    const lastEventTs = useMarketRadarStore((s) => s.lastEventTs)
    const patch = useMarketStore((s) => s.patch)

    // 1s tick drives the "updated Xs ago" badge and the 10s NEW halo decay.
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(id)
    }, [])

    function onPillClick(sym: string) {
        try { patch({ symbol: sym }) } catch { /* defensive */ }
        try { if (typeof switchWLSymbol === 'function') switchWLSymbol(sym) } catch { /* defensive */ }
    }

    const ageLabel = lastEventTs > 0
        ? `updated ${secondsAgo(lastEventTs, now)}s ago`
        : 'awaiting first event'

    return (
        <section id="market-radar" className="mr-root" aria-label="Market Radar">
            <header className="mr-head">
                <span className="mr-title">📡 TOP 300 BINANCE USDT · 24h VOL</span>
                <span className={`mr-age${lastEventTs === 0 ? ' mr-age--idle' : ''}`}>{ageLabel}</span>
            </header>
            <Band color="green" events={green} now={now} onPillClick={onPillClick} />
            <Band color="red" events={red} now={now} onPillClick={onPillClick} />
        </section>
    )
}
