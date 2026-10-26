import { useEffect, useRef, useState, useCallback } from 'react'
import { fetchPanel, normalizeLive, pushTape, EMPTY, type PanelData, type LiqEvent } from '../../liqmap/feed'
import { fmtUsd, fmtPct, intensity, cellColor, barColor, buildLadder, fmtSpan, LIQ } from '../../liqmap/scale'

// ══════════════════════════════════════════════════════════════════
// LIQUIDATION MAP — trei vederi, toate din date măsurate
// ══════════════════════════════════════════════════════════════════
//
// [LIQ-PANEL 2026-10-25] Cerut de operator: „o pictogramă total nouă lângă
// omega, liquidation map cu date reale, construită exact ca la Coinglass dar
// mult mai pro… vreau ceva real, nu fake".
//
// Diferenţa faţă de Coinglass, spusă o dată şi scrisă în panou: harta LOR
// colorată PREZICE unde ar fi lichidările, presupunând că lumea intră la
// 10x/25x/50x/100x. Nicio bursă nu publică poziţiile reale. Aici nu se prezice
// nimic — fiecare bară şi fiecare celulă e suma dolarilor lichidaţi chiar
// acolo, chiar atunci.
//
// De aceea panoul îşi arată ACOPERIREA sus. Fără ea, o scară goală arată
// identic cu una stricată — confuzia care a pornit toată discuţia şi care a
// costat o regresie în aceeaşi zi.

const VIEWS = [
    { id: 'map', label: 'MAP' },
    { id: 'heat', label: 'HEATMAP' },
    { id: 'live', label: 'LIVE' },
] as const
type ViewId = typeof VIEWS[number]['id']

const REFRESH_MS = 60_000
const HEAT_COLS = 90

const w = window as any

function currentSymbol(): string {
    try { return String(w.S?.symbol || 'BTCUSDT').toUpperCase() } catch { return 'BTCUSDT' }
}
function currentPrice(): number {
    try { const p = Number(w.S?.price); return Number.isFinite(p) && p > 0 ? p : 0 } catch { return 0 }
}

export function LiqMapPanel() {
    const [view, setView] = useState<ViewId>('map')
    const [data, setData] = useState<PanelData>(EMPTY)
    const [tape, setTape] = useState<LiqEvent[]>([])
    const [days, setDays] = useState(90)
    // Simbolul afisat. Implicit il urmeaza pe cel din chart, dar operatorul il
    // poate fixa pe oricare are date — altfel o scara goala pare defectiune.
    const [symbol, setSymbol] = useState(currentSymbol)
    const [price, setPrice] = useState(currentPrice)
    const [loading, setLoading] = useState(true)
    const alive = useRef(true)

    const load = useCallback(async () => {
        const p = currentPrice()
        if (p > 0) setPrice(p)
        const d = await fetchPanel(symbol, p, days, HEAT_COLS)
        if (alive.current) { setData(d); setLoading(false) }
    }, [days, symbol])

    useEffect(() => {
        alive.current = true
        load()
        const iv = setInterval(load, REFRESH_MS)
        // Preţul se mişcă între aduceri; scara trebuie ancorată pe preţul de
        // ACUM, altfel procentele mint încet.
        const pv = setInterval(() => { const p = currentPrice(); if (p > 0) setPrice(p) }, 3000)
        // Live: folosim evenimentul care există deja în Zeus şi prin care trec
        // toate bursele, inclusiv Gate. Nu deschidem o a doua cale.
        const onLiq = (e: Event) => {
            const ev = normalizeLive((e as CustomEvent).detail)
            if (ev) setTape((t) => pushTape(t, ev))
        }
        window.addEventListener('zeus:liq', onLiq as EventListener)
        return () => {
            alive.current = false
            clearInterval(iv); clearInterval(pv)
            window.removeEventListener('zeus:liq', onLiq as EventListener)
        }
    }, [load])

    const stats = data.stats
    const map = data.map
    const heat = data.heat

    return (
        <div className="zlq">
            <div className="zlq-head">
                <span className="zlq-title">LIQUIDATION MAP</span>
                <span className="zlq-sym">{symbol}</span>
                <span className="zlq-real" title="every bar is a liquidation that actually happened — nothing is modelled">
                    MEASURED · NOT MODELLED
                </span>
            </div>

            <Honesty stats={stats} map={map} days={days} setDays={setDays} loading={loading} />

            <SymbolStrip top={data.top} symbol={symbol} setSymbol={setSymbol} />

            <div className="zlq-tabs" role="tablist">
                {VIEWS.map((v) => (
                    <button key={v.id} role="tab" aria-selected={view === v.id}
                        className={'zlq-tab' + (view === v.id ? ' act' : '')}
                        onClick={() => setView(v.id)}>{v.label}</button>
                ))}
            </div>

            <div className="zlq-body">
                {view === 'map' && <MapView map={map} price={price} />}
                {view === 'heat' && <HeatView heat={heat} price={price} />}
                {view === 'live' && <LiveView tape={tape} mine={symbol} />}
            </div>
        </div>
    )
}

// ── Banda de onestitate ───────────────────────────────────────────
// Spune ce ştim, de când, şi de la cine. Binance lipseşte din listă fiindcă
// Binance chiar nu livrează nimic către serverul ăsta — şi e mai bine să se
// vadă decât să fie ghicit.
function Honesty({ stats, map, days, setDays, loading }: any) {
    const since = stats?.since ? new Date(stats.since) : null
    const cov = map?.coverage
    return (
        <div className="zlq-hon">
            <div className="zlq-hon-main">
                <span className="zlq-k">HISTORY</span>
                <b>{loading ? '…' : (stats?.events ?? 0).toLocaleString('ro-RO')}</b>
                <span className="zlq-dim">liquidations</span>
                <b className="zlq-usd">{fmtUsd(stats?.totalUsd ?? 0)}</b>
            </div>
            <div className="zlq-hon-sub">
                {since && <span>since {since.toLocaleDateString('en-GB')} {since.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
                {cov && <span>coverage <b style={{ color: LIQ.short }}>{fmtPct(cov.upPct)}</b> / <b style={{ color: LIQ.long }}>{fmtPct(cov.downPct)}</b></span>}
                <span className="zlq-ex">
                    {(stats?.exchanges || []).map((e: any) => (
                        <i key={e.exchange} title={`${e.n} events · ${fmtUsd(e.usd)}`}>{e.exchange}</i>
                    ))}
                    {!stats?.exchanges?.length && <i className="zlq-off">no source yet</i>}
                </span>
                <span className="zlq-win">
                    {[7, 30, 90].map((d) => (
                        <button key={d} className={days === d ? 'act' : ''} onClick={() => setDays(d)}>{d}D</button>
                    ))}
                </span>
            </div>
        </div>
    )
}

// ── Banda de simboluri: unde CHIAR sunt date ──────────────────────
// Panoul urmează simbolul din chart, dar dacă pe ăla nu s-a lichidat nimeni,
// scara e goală — corect, şi complet inutil. Banda arată unde s-a întâmplat
// ceva, ca saltul acolo să coste o atingere.
function SymbolStrip({ top, symbol, setSymbol }: any) {
    if (!top || !top.length) return null
    const has = top.some((t: any) => t.symbol === symbol)
    return (
        <div className="zlq-syms">
            {!has && <button className="zlq-sym-b act" onClick={() => setSymbol(symbol)}>{symbol}</button>}
            {top.map((t: any) => (
                <button key={t.symbol}
                    className={'zlq-sym-b' + (t.symbol === symbol ? ' act' : '')}
                    onClick={() => setSymbol(t.symbol)}
                    title={`${t.n} liquidations · ${fmtUsd(t.usd)}`}>
                    {t.symbol.replace(/USDT$/, '')}
                    <i>{t.n}</i>
                </button>
            ))}
        </div>
    )
}

// ── Vederea MAP: scara pe niveluri de preţ ────────────────────────
function MapView({ map, price }: { map: any; price: number }) {
    if (!map || !map.buckets?.length) return <Empty what="The ladder" />
    // Scara CONTINUĂ, nu doar nivelurile care au date: altfel se citeşte ca o
    // listă de câteva rânduri şi se pierde exact ce face dintr-o scară o hartă
    // — cât de departe stă fiecare grămadă, şi cât gol e între ele.
    const rungs = buildLadder(map.buckets, price)
    if (!rungs.length) return <Empty what="The ladder" />
    const max = rungs.reduce((m, r) => Math.max(m, r.longUsd + r.shortUsd), 0) || 1
    return (
        <div className="zlq-map">
            {rungs.map((r) => {
                if (r.isPrice) return <div key="now" className="zlq-now">PRICE {Math.round(price)}</div>
                const tot = r.longUsd + r.shortUsd
                const isLong = r.longUsd >= r.shortUsd
                const wpc = tot > 0 ? Math.max(2, (tot / max) * 100) : 0
                return (
                    <div key={r.pct}
                        className={'zlq-row' + (r.pct >= 0 ? ' up' : ' dn') + (r.empty ? ' void' : '')}>
                        <span className="zlq-px">{Math.round(r.price)}</span>
                        <span className="zlq-pc">{fmtPct(r.pct)}</span>
                        <span className="zlq-bar">
                            {tot > 0 && <i style={{ width: wpc + '%', background: barColor(isLong) }} />}
                        </span>
                        <span className="zlq-v">{tot > 0 ? fmtUsd(tot) : ''}</span>
                    </div>
                )
            })}
        </div>
    )
}

// ── Vederea HEATMAP: timp × preţ ──────────────────────────────────
// Canvas, nu DOM: 90 de coloane × zeci de niveluri ar însemna mii de noduri,
// iar pe telefon asta se simte imediat.
function HeatView({ heat, price }: { heat: any; price: number }) {
    const ref = useRef<HTMLCanvasElement | null>(null)
    useEffect(() => {
        const cv = ref.current
        if (!cv) return
        const box = cv.parentElement
        const W = Math.max(240, box?.clientWidth || 320)
        const H = Math.max(220, Math.min(460, Math.round(W * 1.15)))
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        cv.width = W * dpr; cv.height = H * dpr
        cv.style.width = W + 'px'; cv.style.height = H + 'px'
        const g = cv.getContext('2d')
        if (!g) return
        g.setTransform(dpr, 0, 0, dpr, 0, 0)
        g.clearRect(0, 0, W, H)
        g.fillStyle = '#070a0e'; g.fillRect(0, 0, W, H)
        if (!heat || !heat.cells?.length) return

        const pcts = heat.cells.map((c: any) => c.pct)
        const lo = Math.min(...pcts), hi = Math.max(...pcts)
        const span = Math.max(0.25, hi - lo)
        const cols = heat.cols || HEAT_COLS
        const cw = W / cols
        const rows = Math.max(1, Math.round(span * 4) + 1)
        const rh = H / rows

        for (const c of heat.cells) {
            const tot = c.longUsd + c.shortUsd
            const isLong = c.longUsd >= c.shortUsd
            const i = intensity(tot, heat.maxUsd)
            g.fillStyle = cellColor(isLong, i)
            const x = c.t * cw
            const y = H - ((c.pct - lo) / span) * (H - rh) - rh
            g.fillRect(x, y, Math.max(1.5, cw - 0.5), Math.max(1.5, rh - 0.5))
        }
        // Linia preţului curent, dacă e în interval.
        const nowPct = 0
        if (nowPct >= lo && nowPct <= hi) {
            const y = H - ((nowPct - lo) / span) * (H - rh) - rh / 2
            g.strokeStyle = 'rgba(255,214,102,.55)'; g.lineWidth = 1
            g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke()
        }
    }, [heat, price])

    if (!heat || !heat.cells?.length) return <Empty what="The grid" />
    return (
        <div className="zlq-heat">
            <canvas ref={ref} />
            <div className="zlq-heat-legend">
                <span><i style={{ background: LIQ.long }} /> longs liquidated</span>
                <span><i style={{ background: LIQ.short }} /> shorts liquidated</span>
                <span className="zlq-dim">
                    {fmtSpan(heat.tMin, heat.tMax) || 'older → newer'} · peak {fmtUsd(heat.maxUsd)}
                </span>
            </div>
        </div>
    )
}

// ── Vederea LIVE: fiecare lichidare, pe măsură ce se întâmplă ─────
function LiveView({ tape, mine }: { tape: LiqEvent[]; mine: string }) {
    if (!tape.length) {
        // Şi starea goală spune CE aşteaptă. Prima variantă tăcea, deci
        // „ALL MARKETS" apărea abia după primul eveniment — adică exact când nu
        // mai era nevoie de el.
        return (
            <div className="zlq-empty">
                <b>waiting for a liquidation · ALL MARKETS</b>
                <span>every row here will be a position force-closed, the moment it happens</span>
            </div>
        )
    }
    // Antetul panoului spune un simbol, dar tape-ul e TOTĂ piaţa — şi aşa e
    // bine: pe BTC singur ar fi un rând pe minut, adică mort. Dar atunci
    // trebuie SPUS, altfel cine se uită crede că tot panoul e un simbol.
    // Şi rândurile simbolului urmărit se scot în evidenţă, ca să se vadă în flux.
    const n = tape.filter((e) => e.symbol === mine).length
    return (
        <div className="zlq-tape">
            <div className="zlq-tape-hd">
                <span>ALL MARKETS</span>
                <span className="zlq-dim">{n > 0 ? `${n} on ${mine}` : `none on ${mine} yet`}</span>
            </div>
            {tape.map((e, i) => (
                <div key={e.time + '-' + i}
                    className={'zlq-tp' + (i === 0 ? ' fresh' : '') + (e.symbol === mine ? ' mine' : '')}>
                    <span className="zlq-tp-dot" style={{ background: barColor(!!e.isLong) }} />
                    <span className="zlq-tp-side" style={{ color: barColor(!!e.isLong) }}>
                        {e.isLong ? 'LONG' : 'SHORT'}
                    </span>
                    <span className="zlq-tp-sym">{e.symbol || ''}</span>
                    <span className="zlq-tp-px">{e.p >= 1 ? Math.round(e.p) : e.p}</span>
                    <span className="zlq-tp-v">{fmtUsd(e.vol)}</span>
                    <span className="zlq-tp-ex">{e.exchange}</span>
                </div>
            ))}
        </div>
    )
}

function Empty({ what }: { what: string }) {
    return (
        <div className="zlq-empty">
            <b>{what} is empty — and that is an answer</b>
            <span>
                only liquidations that actually happened show up here. where nothing is
                written, nobody was liquidated — price was never there
            </span>
        </div>
    )
}
