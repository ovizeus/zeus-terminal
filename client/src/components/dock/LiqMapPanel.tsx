import { useEffect, useRef, useState, useCallback } from 'react'
import { fetchPanel, normalizeLive, pushTape, EMPTY, type PanelData, type LiqEvent } from '../../liqmap/feed'
import { fmtUsd, fmtPct, intensity, cellColor, barColor, buildLadder, fmtSpan, LIQ } from '../../liqmap/scale'
import {
    fetchPredict, sideLabel, hitLabel, horizonLabel, strengthBar, targetLabel,
    historyLabel, crowdLabel, oiLabel, liftLabel, type PredictSymbol,
} from '../../liqmap/predict'
import {
    fetchBook, bookIntensity, bookColor, BANDS, WINDOWS, fmtSpread, fmtWall,
    rowToY, colToX, bandLabel, windowLabel, sourceLabel, BOOK, type Wall,
} from '../../bookmap/book'

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
    // [LIQ-PREDICT 2026-10-26] Cerut de operator: „lângă map heat map live sus
    // mai vreau o rubrică, prediction long short pe btc şi eth".
    { id: 'pred', label: 'PREDICT' },
    // [BOOKMAP 2026-10-26] „acum sus lângă predict poţi să faci bookmap… să
    // arate chartul, preţul, să avem zoom". Era etapa 2 în carte; condiţia de
    // pornire era să judece el harta de lichidări ca bună, şi a judecat-o.
    { id: 'book', label: 'BOOK' },
] as const
type ViewId = typeof VIEWS[number]['id']

const REFRESH_MS = 60_000
// Serverul recalculeaza la 2 minute; mai des de atat ar fi cereri pe degeaba.
const PREDICT_REFRESH_MS = 60_000
// Serverul ia un instantaneu adanc la 5 s; mai des n-ar aduce coloane noi.
const BOOK_REFRESH_MS = 5_000
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
    const [pred, setPred] = useState<PredictSymbol[]>([])
    const [book, setBook] = useState<any>(null)
    const [bookBand, setBookBand] = useState<number | 'auto'>('auto')
    const [bookWin, setBookWin] = useState(600)
    const alive = useRef(true)

    const load = useCallback(async () => {
        const p = currentPrice()
        if (p > 0) setPrice(p)
        const d = await fetchPanel(symbol, p, days, HEAT_COLS)
        if (alive.current) { setData(d); setLoading(false) }
    }, [days, symbol])

    // Cartea de ordine se aduce NUMAI cu rubrica deschisă: serverul o
    // reîmprospătează oricum la 5 s, iar o cerere pe secundă pentru un ecran
    // la care nu se uită nimeni e taxă curată.
    useEffect(() => {
        if (view !== 'book') return
        let on = true
        const ac = new AbortController()
        const go = async () => {
            const d = await fetchBook(symbol, {
                band: bookBand, windowSec: bookWin, cols: 110, rows: 56,
            }, ac.signal)
            if (on && d) setBook(d)
        }
        go()
        const iv = setInterval(go, BOOK_REFRESH_MS)
        return () => { on = false; ac.abort(); clearInterval(iv) }
    }, [view, symbol, bookBand, bookWin])

    useEffect(() => {
        if (view !== 'pred') return
        let on = true
        const ac = new AbortController()
        const go = async () => {
            const d = await fetchPredict(ac.signal)
            if (on) setPred(d)
        }
        go()
        const iv = setInterval(go, PREDICT_REFRESH_MS)
        return () => { on = false; ac.abort(); clearInterval(iv) }
    }, [view])

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
                {view === 'pred' && <PredictView rows={pred} />}
                {view === 'book' && (
                    <BookView data={book} band={bookBand} setBand={setBookBand}
                        win={bookWin} setWin={setBookWin} symbol={symbol} />
                )}
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

// ── PREDICT ───────────────────────────────────────────────────────
//
// [LIQ-PREDICT 2026-10-26] Operatorul: „prediction long short pe btc si eth…
// să socotească din lichidările reale unde e atracţia, magnetul… date reale,
// nu fake".
//
// Trei lucruri pe care rubrica le face şi care o deosebesc de o ghicitoare:
//
// 1. SPUNE CÂND NU ŞTIE. 'NO EDGE' e un rezultat afişat, nu un eşec ascuns.
//    Un panou care arată mereu o direcţie minte jumătate din timp.
// 2. NU AFIŞEAZĂ UN PROCENT NEMĂSURAT. Până sunt destule cazuri rezolvate pe
//    klines reale, scrie CALIBRATING n/30. Decizia operatorului, întrebat.
// 3. ÎŞI ARATĂ ISTORICUL. El a cerut „azi, ieri, acum 3 zile"; la 13 ore de
//    colectare „acum 3 zile" nu există, şi rubrica o spune în loc să lase
//    impresia unei ferestre pe care n-o are.
function PredictView({ rows }: { rows: PredictSymbol[] }) {
    if (!rows || !rows.length) {
        return <Empty what="Prediction" />
    }
    return (
        <div className="zlq-pr">
            {rows.map((r) => <PredictCard key={r.symbol} r={r} />)}
            <div className="zlq-pr-note">
                Direction is derived from measured liquidations: the magnet points at the side
                that has <b>not</b> burned yet. Hit rate is counted on real klines after the
                horizon elapses — never estimated.
            </div>
        </div>
    )
}

function PredictCard({ r }: { r: PredictSymbol }) {
    const s = r.signal
    const live = s.side === 'UP' || s.side === 'DOWN'
    const col = s.side === 'UP' ? LIQ.short : s.side === 'DOWN' ? LIQ.long : '#5d7183'
    return (
        <div className={'zlq-pr-card' + (live ? '' : ' flat')}>
            <div className="zlq-pr-hd">
                <span className="zlq-pr-sym">{r.symbol}</span>
                <span className="zlq-pr-px">{r.price ? Math.round(r.price).toLocaleString('en-US') : '—'}</span>
            </div>

            <div className="zlq-pr-side" style={{ color: col }}>
                <b>{sideLabel(s.side)}</b>
                {live && <><i className="zlq-pr-bar">{strengthBar(s.strength)}</i><em>{s.strength}</em></>}
            </div>

            {live ? (
                <div className="zlq-pr-rows">
                    <div><span>Target</span><b>{targetLabel(s.target, r.price)}</b></div>
                    <div><span>Burned</span><b>
                        <i style={{ color: LIQ.long }}>↓{fmtUsd(s.longBurnedUsd)}</i>
                        {'  '}
                        <i style={{ color: LIQ.short }}>↑{fmtUsd(s.shortBurnedUsd)}</i>
                    </b></div>
                    <div><span>Crowd</span><b>{crowdLabel(r.context.crowdLongPct)}</b></div>
                    <div><span>Leverage</span><b>{oiLabel(r.context.oiChangePct)}</b></div>
                    {r.baseline && <div><span>Normal</span><b>
                        {Math.round(100 * r.baseline.longUsd / (r.baseline.longUsd + r.baseline.shortUsd))}% of
                        burned $ are longs, for this market
                    </b></div>}
                </div>
            ) : (
                // Motivul tăcerii se SPUNE. „NO EDGE" fără motiv ar arăta ca o
                // defecţiune — exact confuzia care a pornit toată discuţia.
                <div className="zlq-pr-why">{s.reason}</div>
            )}

            <div className="zlq-pr-hor">
                {r.horizons.map((h) => (
                    <div key={h.horizonMs} className={'zlq-pr-h' + (h.calibrating ? ' cal' : '')}>
                        <span>{horizonLabel(h.horizonMs)}</span>
                        <b>{liftLabel(h)}</b>
                    </div>
                ))}
            </div>

            <div className="zlq-pr-ft">
                {historyLabel(r.oldestEventTs)} · {(r.eventsInWindow || 0).toLocaleString('en-US')} liquidations in 24h
            </div>
        </div>
    )
}

// ── BOOK ──────────────────────────────────────────────────────────
//
// [BOOKMAP 2026-10-26] „sa arate chartul pretul sa avem zoom tot ce trebuie".
//
// Harta de lichidări arată unde au EXPLODAT banii. Asta arată unde STAU.
//
// ⚠️ CE AM MĂSURAT ÎNAINTE, fiindcă îi schimbă aşteptarea şi i-am spus-o:
// cartea care EXISTĂ e lată de 253 de dolari pe BTC (−0,155% … +0,160%).
// Nu există pereţi la 1% distanţă. Deci „zoom" nu te depărtează — te duce mai
// adânc în bandă şi mai departe pe timp.
function BookView({ data, band, setBand, win, setWin, symbol }: any) {
    const cv = useRef<HTMLCanvasElement | null>(null)
    const heat = data?.heat
    const walls: Wall[] = data?.walls || []
    const top = data?.top

    useEffect(() => {
        const c = cv.current
        if (!c || !heat) return
        const ctx = c.getContext('2d')
        if (!ctx) return
        const dpr = Math.min(2, (window as any).devicePixelRatio || 1)
        const w = c.clientWidth || 320
        const h = 240
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, w, h)

        // Fundalul: aceeaşi tăcere ca în restul panoului.
        ctx.fillStyle = '#070a0e'
        ctx.fillRect(0, 0, w, h)

        const { cols, rows, cells, maxUsd, loUsd, mids } = heat
        const cw = w / cols
        const ch = h / rows

        for (const cell of cells) {
            const x = colToX(cell.col, cols, w)
            const y = rowToY(cell.row, rows, h)
            if (cell.bidUsd > 0) {
                ctx.fillStyle = bookColor('bid', bookIntensity(cell.bidUsd, maxUsd, loUsd))
                ctx.fillRect(x, y, Math.max(1, cw), Math.max(1, ch))
            }
            if (cell.askUsd > 0) {
                ctx.fillStyle = bookColor('ask', bookIntensity(cell.askUsd, maxUsd, loUsd))
                ctx.fillRect(x, y, Math.max(1, cw), Math.max(1, ch))
            }
        }

        // ⚠️ DE CE PREŢUL NU SE DESENEAZĂ ÎN HARTĂ, cu măsurătoarea care a
        // decis-o: rândurile sunt ancorate pe mijlocul FIECĂREI coloane, deci
        // preţul stă prin construcţie exact la mijloc şi linia ar ieşi dreaptă
        // — adică n-ar fi un chart, ar fi o decoraţie.
        //
        // Şi nu pot ancora pe preţ ABSOLUT: măsurat pe 1000 de bare de 1 minut,
        // într-o fereastră de 10 minute preţul depăşeşte chiar şi cea mai largă
        // bandă (±0,16%) în 21% din cazuri pe BTC şi 46% pe ETH; la ±0,05% în
        // 90–100%. Cu ancoră absolută, lichiditatea ar ieşi din cadru şi harta
        // s-ar goli exact când se mişcă ceva.
        //
        // Deci: harta rămâne RELATIVĂ (aşa lichiditatea e comparabilă în timp),
        // iar preţul are banda lui, cu scara lui — deasupra. Aici marchez doar
        // linia de zero, ca să se vadă unde e preţul în bandă.
        ctx.strokeStyle = 'rgba(216, 178, 94, .45)'
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(0, h / 2)
        ctx.lineTo(w, h / 2)
        ctx.stroke()
        ctx.setLineDash([])
        void mids
    }, [heat])

    // ── CHARTUL preţului: bandă proprie, scară proprie ──
    const pcv = useRef<HTMLCanvasElement | null>(null)
    useEffect(() => {
        const c = pcv.current
        if (!c || !heat) return
        const ctx = c.getContext('2d')
        if (!ctx) return
        const dpr = Math.min(2, (window as any).devicePixelRatio || 1)
        const w = c.clientWidth || 320
        const h = 54
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, w, h)
        ctx.fillStyle = '#070a0e'
        ctx.fillRect(0, 0, w, h)

        const ms: (number | null)[] = heat.mids || []
        const real = ms.filter((m): m is number => m !== null && m !== undefined)
        if (real.length < 2) return
        let lo = Math.min(...real), hi = Math.max(...real)
        if (hi - lo <= 0) { hi = lo * 1.0001; lo = lo * 0.9999 }
        const pad = (hi - lo) * 0.12
        lo -= pad; hi += pad
        const cwp = w / Math.max(1, ms.length)

        ctx.strokeStyle = `rgba(${BOOK.line}, .95)`
        ctx.lineWidth = 1.6
        ctx.beginPath()
        let open = false
        for (let i = 0; i < ms.length; i++) {
            const m = ms[i]
            // O coloană fără cadre se ÎNTRERUPE. Nu interpolez: ar inventa un
            // preţ care n-a existat.
            if (m === null || m === undefined) { open = false; continue }
            const y = h - ((m - lo) / (hi - lo)) * h
            const x = i * cwp + cwp / 2
            if (!open) { ctx.moveTo(x, y); open = true } else ctx.lineTo(x, y)
        }
        ctx.stroke()
    }, [heat])

    const realMids: number[] = (heat?.mids || []).filter((m: any) => m !== null && m !== undefined)
    const priceLo = realMids.length ? Math.min(...realMids) : null
    const priceHi = realMids.length ? Math.max(...realMids) : null

    if (!data) return <Empty what="The order book" />
    if (!heat || !heat.frames) {
        return (
            <div className="zlq-empty">
                <b>Waiting for the first snapshot</b>
                <span>{sourceLabel(data.source || null)}</span>
            </div>
        )
    }

    return (
        <div className="zbk">
            {/* Banda de sus vine din fluxul RAPID (WS), nu din medii — cele
                două surse nu se amestecă, altfel densitatea desenată ar depinde
                de proporţia cadrelor, nu de piaţă. */}
            <div className="zbk-top">
                <span className="zlq-k">SPREAD</span>
                <b>{fmtSpread(top?.spread ?? null, top?.mid ?? null)}</b>
                <span className="zbk-bb" style={{ color: `rgb(${BOOK.bid})` }}>
                    {top ? Math.round(top.bestBid).toLocaleString('en-US') : '—'}
                </span>
                <span className="zbk-ba" style={{ color: `rgb(${BOOK.ask})` }}>
                    {top ? Math.round(top.bestAsk).toLocaleString('en-US') : '—'}
                </span>
                <span className="zbk-real">RESTING LIQUIDITY · NOT A FORECAST</span>
            </div>

            <div className="zbk-zoom">
                <span className="zlq-k">BAND</span>
                {BANDS.map((b) => (
                    <button key={String(b.value)}
                        className={'zbk-z' + (String(b.value) === String(band) ? ' act' : '')}
                        onClick={() => setBand(b.value)}>{b.label}</button>
                ))}
                <span className="zlq-k zbk-sep">SPAN</span>
                {WINDOWS.map((wd) => (
                    <button key={wd.value}
                        className={'zbk-z' + (wd.value === win ? ' act' : '')}
                        onClick={() => setWin(wd.value)}>{wd.label}</button>
                ))}
            </div>

            {/* CHARTUL: preţul pe fereastra desenată, cu scara LUI. Separat de
                hartă fiindcă harta e relativă la mijloc — vezi nota din canvas. */}
            <div className="zbk-price">
                <canvas ref={pcv} />
                <div className="zbk-price-ax">
                    <span>{priceHi !== null ? Math.round(priceHi).toLocaleString('en-US') : ''}</span>
                    <span>{priceLo !== null ? Math.round(priceLo).toLocaleString('en-US') : ''}</span>
                </div>
                <span className="zbk-price-tag">PRICE</span>
            </div>

            <div className="zbk-canvas">
                <canvas ref={cv} />
                <div className="zbk-axis">
                    <span>+{heat.bandPct.toFixed(3)}%</span>
                    <span className="zbk-axis-mid">PRICE</span>
                    <span>-{heat.bandPct.toFixed(3)}%</span>
                </div>
            </div>

            <div className="zbk-legend">
                <span><i style={{ background: `rgb(${BOOK.bid})` }} />bids</span>
                <span><i style={{ background: `rgb(${BOOK.ask})` }} />asks</span>
                <span>{bandLabel(heat.bandPct === undefined ? band : Number(heat.bandPct.toFixed(3)))}</span>
                <span>{windowLabel(win)} span · {fmtSpan(Math.max(0, (heat.tMax || 0) - (heat.tMin || 0)))} drawn</span>
                {/* Grila e marginita la numarul de instantanee: altfel 20 de
                    cadre in 110 coloane ar desena un pieptene de dungi cu
                    gauri. Dar atunci trebuie SPUS, altfel o harta cu putine
                    coloane late arata ca una stricata. */}
                {heat.colsAsked && heat.cols < heat.colsAsked && (
                    <span className="zbk-fill">
                        {heat.cols}/{heat.colsAsked} columns · filling in
                    </span>
                )}
            </div>

            {/* PEREŢII, cu fermitatea alături: a treia capcană notată în carte
                era „un perete care dispare când preţul se apropie nu e perete". */}
            <div className="zbk-walls">
                <div className="zbk-walls-hd">
                    <span>THICKEST RESTING LEVELS</span>
                    <span className="zlq-dim">firmness = share of snapshots it was actually there</span>
                </div>
                {walls.length === 0 && (
                    <div className="zbk-wall-none">no level thick enough to call a wall yet</div>
                )}
                {walls.map((wl, i) => (
                    <div key={i} className={'zbk-wall ' + (wl.side === 'BID' ? 'b' : 'a')}>
                        <span>{wl.side}</span>
                        <b>{Math.round(wl.price).toLocaleString('en-US')}</b>
                        <i>{wl.distUsd >= 0 ? '+' : ''}{Math.round(wl.distUsd).toLocaleString('en-US')}</i>
                        <em>{fmtUsd(wl.usd)}</em>
                        <u>{Math.round(wl.firmness * 100)}%</u>
                    </div>
                ))}
            </div>

            <div className="zbk-src">
                {sourceLabel(data.source || null)}
                {data.source?.health?.usedWeight1m
                    ? ` · binance weight ${data.source.health.usedWeight1m}/2400`
                    : ''}
                {data.ladder?.excludedLevels
                    ? ` · ${data.ladder.excludedLevels.toLocaleString('en-US')} levels outside band`
                    : ''}
            </div>
            <div className="zbk-note">
                The visible book on {symbol} spans a few hundred dollars around price — there are no
                walls 1% away, they simply do not exist in the book. Zoom goes <b>deeper</b> and
                <b> further back in time</b>, not wider.
            </div>
        </div>
    )
}
