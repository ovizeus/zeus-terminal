import { useEffect, useRef, useState, useCallback } from 'react'
import { fetchPanel, normalizeLive, pushTape, EMPTY, type PanelData, type LiqEvent } from '../../liqmap/feed'
import { fmtUsd, fmtPct, intensity, cellColor, barColor, buildLadder, fmtSpan, LIQ } from '../../liqmap/scale'
import { RANGES, rangeLabel } from '../../liqmap/ranges'
import {
    fetchPredict, sideLabel, hitLabel, horizonLabel, strengthBar, targetLabel,
    historyLabel, crowdLabel, oiLabel, liftLabel, type PredictSymbol,
} from '../../liqmap/predict'
import {
    fetchBook, bookIntensity, bookColor, BANDS, WINDOWS, fmtSpread, fmtWall,
    rowToY, colToX, bandLabel, windowLabel, sourceLabel, BOOK, type Wall,
    yToPrice, zoomStep, zoomLabel,
    bubbleRadius, bubbleColor, bubbleCutoff, liqRing, liqSourceNote, cobRows,
    type Trade, type Liq,
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
    // ZOOM pe carte: tap pe harta cere o fereastra de pret. Sta AICI, nu in
    // BookView, fiindca aducerea se face aici si trebuie sa reporneasca.
    const [bookZoom, setBookZoom] = useState<{ price: number; pct: number } | null>(null)
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
    // Un pret de pe BTC nu are ce cauta pe grila ETH — la schimbarea simbolului
    // zoom-ul cade. Clasa b336: cartea unui simbol cu eticheta altuia.
    useEffect(() => { setBookZoom(null) }, [symbol])

    useEffect(() => {
        if (view !== 'book') return
        let on = true
        const ac = new AbortController()
        const go = async () => {
            const d = await fetchBook(symbol, {
                band: bookBand, windowSec: bookWin, cols: 110, rows: 56,
                focusPrice: bookZoom?.price ?? null, focusPct: bookZoom?.pct ?? null,
            }, ac.signal)
            if (on && d) setBook(d)
        }
        go()
        const iv = setInterval(go, BOOK_REFRESH_MS)
        return () => { on = false; ac.abort(); clearInterval(iv) }
    }, [view, symbol, bookBand, bookWin, bookZoom])

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
                        win={bookWin} setWin={setBookWin} symbol={symbol}
                        zoom={bookZoom} setZoom={setBookZoom} />
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
                {/* [RANGE 2026-10-31] Cifra sare de la ~1.500 la ~157.000 cand
                    schimbi fereastra. Fara fereastra scrisa langa ea, acelasi
                    panou arata doua adevaruri diferite si pare ca s-a stricat.
                    Fereastra vine din `stats.days`, adica de la SERVER: el o
                    margineste (365 de zile), deci butonul apasat poate sa nu
                    fie fereastra pe care s-au numarat randurile. Aceeasi regula
                    ca la eticheta de zoom si la „9 of 1000 trades drawn". */}
                <span className="zlq-dim">liquidations · last {rangeLabel(stats?.days ?? days)}</span>
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
                    {/* [RANGE 2026-10-31] 4H si 24H cerute („ca la coinglass").
                        Intervalul pleaca spre server ca ZILE zecimale; eticheta
                        NU poate fi `${days}D`, fiindca 4 ore ar scrie
                        „0.16666666666666666D". */}
                    {RANGES.map((r) => (
                        <button key={r.label} className={days === r.days ? 'act' : ''}
                            onClick={() => setDays(r.days)}>{r.label}</button>
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
function BookView({ data, band, setBand, win, setWin, symbol, zoom, setZoom }: any) {
    const cv = useRef<HTMLCanvasElement | null>(null)
    // „e bine dar nu stiu sa-l citesc" — un panou care are nevoie de mine
    // alaturi nu si-a facut treaba. Explicatia sta DESCHISA pana cand o inchide
    // el; alegerea se tine minte pe telefonul lui.
    // Cate bule au ajuns CHIAR pe harta. Eticheta spunea lungimea listei, dar
    // desenul arunca si tranzactiile prea mici (pragul) si pe cele din afara
    // ferestrei — deci anunta o cifra pe care n-o desena. Se numara la desen,
    // nu se recalculeaza aici: altfel cele doua reguli pleaca una de la alta.
    const [drawnBubbles, setDrawnBubbles] = useState(0)
    const [help, setHelp] = useState<boolean>(() => {
        try { return localStorage.getItem('zbk.help') !== '0' } catch { return true }
    })
    // TAP PE HARTA = intri mai adanc in zona atinsa. Pretul se ia din GRILA
    // TRIMISA de server (priceLo/priceHi), nu din pretul curent: altfel ai
    // zoom pe altceva decat ai atins.
    const onMapTap = useCallback((ev: React.MouseEvent<HTMLCanvasElement>) => {
        const el = ev.currentTarget
        const r = el.getBoundingClientRect()
        const h = data?.heat
        const p = yToPrice(ev.clientY - r.top, r.height, h?.priceLo, h?.priceHi)
        if (p === null) return            // in afara panzei: nu mutam nimic
        setZoom({ price: p, pct: zoomStep(zoom?.pct ?? h?.bandPct) })
    }, [data, zoom, setZoom])

    const toggleHelp = useCallback(() => {
        setHelp((v) => {
            const n = !v
            try { localStorage.setItem('zbk.help', n ? '1' : '0') } catch { /* mod privat */ }
            return n
        })
    }, [])
    const heat = data?.heat
    const walls: Wall[] = data?.walls || []
    const top = data?.top
    // ⚠️ SIMBOLUL AFIŞAT E CEL PE CARE SERVERUL L-A DAT, nu cel din chart.
    //
    // Cartea de ordine există doar pe BTCUSDT şi ETHUSDT. Dacă în chart e
    // SOLUSDT, ruta cade în linişte pe BTCUSDT — iar prima variantă a panoului
    // scria „the visible book on SOLUSDT" peste date BTC, cu preţuri perfect
    // plauzibile. Aceeaşi clasă cu tape-ul de la b328, dar mai rea: acolo se
    // vedeau simboluri străine, aici doar numere care păreau în regulă.
    const bookSym: string = data?.symbol || symbol
    const mismatch = !!(data?.symbol && String(symbol) !== String(data.symbol))

    useEffect(() => {
        const c = cv.current
        if (!c || !heat) return
        const ctx = c.getContext('2d')
        if (!ctx) return
        const dpr = Math.min(2, (window as any).devicePixelRatio || 1)
        const w = c.clientWidth || 320
        const h = 300
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, w, h)
        ctx.fillStyle = '#070a0e'
        ctx.fillRect(0, 0, w, h)

        const { cols, rows, cells, maxUsd, loUsd, mids } = heat
        // Coloana COB stă în dreapta, ca la Bookmap. Harta se opreşte înainte.
        const cobW = Math.max(26, Math.min(64, Math.round(w * 0.13)))
        const mapW = Math.max(40, w - cobW - 2)
        const cw = mapW / cols
        const ch = h / rows

        // ── 1. harta de lichiditate ──
        for (const cell of cells) {
            const x = colToX(cell.col, cols, mapW)
            const y = rowToY(cell.row, rows, h)
            const k = cell.held ? 0.72 : 1
            if (cell.bidUsd > 0) {
                ctx.fillStyle = bookColor('bid', bookIntensity(cell.bidUsd, maxUsd, loUsd) * k)
                ctx.fillRect(x, y, Math.max(1, cw), Math.max(1, ch))
            }
            if (cell.askUsd > 0) {
                ctx.fillStyle = bookColor('ask', bookIntensity(cell.askUsd, maxUsd, loUsd) * k)
                ctx.fillRect(x, y, Math.max(1, cw), Math.max(1, ch))
            }
        }

        // ── 2. linia preţului, ACUM pe axă adevărată ──
        // Pe grila relativă de dinainte ieşea dreaptă la mijloc; aici urmează
        // preţul, exact ca în capturile lui, şi bulele călăresc pe ea.
        const yOf = (price: number) => {
            if (!heat.rowUsd || heat.priceLo === null) return null
            const r = (price - heat.priceLo) / heat.rowUsd
            if (r < 0 || r >= rows) return null
            return h - (r / rows) * h
        }
        ctx.strokeStyle = `rgba(${BOOK.line}, .9)`
        ctx.lineWidth = 1.4
        ctx.beginPath()
        let open = false
        for (let i = 0; i < cols; i++) {
            const m = mids[i]
            if (m === null || m === undefined) { open = false; continue }
            const y = yOf(m)
            if (y === null) { open = false; continue }
            const x = colToX(i, cols, mapW) + cw / 2
            if (!open) { ctx.moveTo(x, y); open = true } else ctx.lineTo(x, y)
        }
        ctx.stroke()

        // ── 3. BULELE: tranzacţii executate ──
        const tList: Trade[] = data?.trades || []
        const tMax = tList.reduce((m, t) => Math.max(m, t.usd), 0)
        const cut = bubbleCutoff(tMax)
        // In afara ferestrei: ARUNCA, nu agata de margine. Prinderea la margine
        // stivuia tot ce era mai vechi decat harta pe coloana zero — un bloc de
        // bule la cel mai vechi moment, unde nu fusese nimic. Acelasi contract
        // ca `yOf` pe axa de pret: null inseamna „nu se deseneaza".
        const xOf = (ts: number): number | null => {
            const span = Math.max(1, (heat.tMax || 0) - (heat.tMin || 0))
            const f = (ts - (heat.tMin || 0)) / span
            if (!Number.isFinite(f) || f < 0 || f > 1) return null
            return f * mapW
        }
        let nDrawn = 0
        for (const t of tList) {
            if (t.usd < cut) continue
            const y = yOf(t.price)
            if (y === null) continue
            const r = bubbleRadius(t.usd, tMax)
            if (r <= 0) continue
            const x = xOf(t.ts)
            if (x === null) continue
            ctx.fillStyle = bubbleColor(t.sell, 0.55)
            ctx.beginPath()
            ctx.arc(x, y, r, 0, Math.PI * 2)
            ctx.fill()
            nDrawn++
        }
        setDrawnBubbles((v) => (v === nDrawn ? v : nDrawn))

        // ── 4. LICHIDĂRILE: inel, nu disc ──
        const lList: Liq[] = data?.liqs || []
        const lMax = lList.reduce((m, l) => Math.max(m, l.usd), 0)
        for (const l of lList) {
            const y = yOf(l.price)
            if (y === null) continue
            const x = xOf(l.ts)
            if (x === null) continue
            const r = Math.max(3, bubbleRadius(l.usd, lMax, 12, 3))
            const ring = liqRing(l.sell)
            ctx.strokeStyle = ring.stroke
            ctx.lineWidth = ring.width
            ctx.beginPath()
            ctx.arc(x, y, r, 0, Math.PI * 2)
            ctx.stroke()
        }

        // ── 5. COB: carnetul de ACUM, lângă hartă ──
        const cob = cobRows(cells, cols)
        const cobMax = cob.reduce((m, r) => Math.max(m, r.bidUsd, r.askUsd), 0) || 1
        const cx = mapW + 2
        for (const r of cob) {
            const y = rowToY(r.row, rows, h)
            const bw = (r.bidUsd / cobMax) * cobW
            const aw = (r.askUsd / cobMax) * cobW
            if (bw > 0) {
                ctx.fillStyle = bookColor('bid', 0.85)
                ctx.fillRect(cx, y, Math.max(1, bw), Math.max(1, ch))
            }
            if (aw > 0) {
                ctx.fillStyle = bookColor('ask', 0.85)
                ctx.fillRect(cx, y, Math.max(1, aw), Math.max(1, ch))
            }
        }
    }, [heat, data])

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
                <span className="zbk-sym">{bookSym}</span>
                <span className="zbk-real"><b>NEREUS</b> · RESTING LIQUIDITY, NOT A FORECAST</span>
            </div>

            {mismatch && (
                <div className="zbk-mismatch">
                    Order book is available for BTCUSDT and ETHUSDT only — showing <b>{bookSym}</b>,
                    not the charted {symbol}.
                </div>
            )}

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

            <div className="zbk-canvas">
                <canvas ref={cv} onClick={onMapTap} className="zbk-tap" />
                <button className={'zbk-fit' + (zoom ? ' act' : '')}
                    title="Fit the whole book"
                    onClick={() => setZoom(null)}>
                    {/* Eticheta vine din ce s-a DESENAT (`heat.focused` +
                        banda masurata), nu din ce s-a cerut la tap: serverul
                        margineste adancimea, deci starea clientului poate
                        spune altceva decat harta de pe ecran. Aceeasi regula
                        ca la „9 of 1000 trades drawn". */}
                    {zoomLabel(heat.focused ? heat.bandPct : null)}
                </button>
                <div className="zbk-axis">
                    <span>{heat.priceHi ? Math.round(heat.priceHi).toLocaleString('en-US') : ''}</span>
                    <span className="zbk-axis-mid">COB →</span>
                    <span>{heat.priceLo ? Math.round(heat.priceLo).toLocaleString('en-US') : ''}</span>
                </div>
            </div>

            <div className="zbk-legend">
                <span><i style={{ background: `rgb(${BOOK.bid})` }} />bids / buys</span>
                <span><i style={{ background: `rgb(${BOOK.ask})` }} />asks / sells</span>
                <span><i className="zbk-dot" />trades</span>
                <span><i className="zbk-ring" />liquidations</span>
                <span>{bandLabel(Number.isFinite(heat.bandPct as number) ? Number(Number(heat.bandPct).toFixed(3)) : band)}</span>
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
                {/* Coloanele ţinute: cartea a persistat, dar n-am privit-o.
                    Spus, nu ascuns — şi desenat mai stins. */}
                {heat.heldCols > 0 && (
                    <span className="zbk-held">
                        {heat.heldCols} held between snapshots
                    </span>
                )}
            </div>

            <div className="zbk-help">
                <button className="zbk-help-t" onClick={toggleHelp}>
                    {help ? '− HOW TO READ' : '? HOW TO READ'}
                </button>
                {help && (
                    <div className="zbk-help-b">
                        <div><i className="c" />Cyan below the price: <b>buy orders waiting</b>. Someone
                            is ready to buy there, so the price tends to slow down over it.</div>
                        <div><i className="a" />Amber above the price: <b>sell orders waiting</b>. The
                            price has to eat through them to go up.</div>
                        <div><i className="b" />Brighter = <b>more money</b> resting at that price. Left
                            to right is time; the dashed line is where the price is now.</div>
                        <div><i className="f" />In the list below, <b>firmness</b> is what matters: 100%
                            means the level stayed there the whole time; 30% means it flashed and vanished.</div>
                        <div><i className="z" /><b>BAND</b> is how far from the price you look,
                            <b> SPAN</b> is how far back in time. The whole book is only a few hundred
                            dollars wide — there is nothing to see further out.</div>
                    </div>
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
                {liqSourceNote((data?.liqs || []).length)}{' · '}
                {drawnBubbles.toLocaleString('en-US')} of{' '}
                {(data?.trades || []).length.toLocaleString('en-US')} trades drawn{' · '}
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
                The visible book on {bookSym} spans a few hundred dollars around price — there are no
                walls 1% away, they simply do not exist in the book. Zoom goes <b>deeper</b> and
                <b> further back in time</b>, not wider.
            </div>
        </div>
    )
}
