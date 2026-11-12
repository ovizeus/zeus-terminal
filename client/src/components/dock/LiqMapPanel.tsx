import { useEffect, useRef, useState, useCallback } from 'react'
import { fetchPanel, normalizeLive, pushTape, EMPTY, type PanelData, type LiqEvent } from '../../liqmap/feed'
import { fmtUsd, fmtPct, intensity, cellColor, barColor, buildLadder, ladderSides, fmtSpan, LIQ, type LadderSide } from '../../liqmap/scale'
import { RANGES, rangeLabel } from '../../liqmap/ranges'
import { heatGrid, heatProfile, heatSides, priceTicks, timeTicks, scaleSteps } from '../../liqmap/heat'
import { spanStep, spanStepOut, spanLabel, SPAN_FACTOR } from '../../liqmap/scale'
import {
    fetchPredict, sideLabel, horizonLabel, strengthBar, targetLabel,
    historyLabel, crowdLabel, oiLabel, liftLabel, type PredictSymbol,
} from '../../liqmap/predict'
import {
    fetchBook, bookIntensity, bookColor, BANDS, WINDOWS, fmtSpread,
    rowToY, colToX, bandLabel, windowLabel, sourceLabel, BOOK, type Wall,
    yToPrice, zoomStep, zoomStepOut, zoomLabel,
    bubbleRadius, bubbleColor, bubbleCutoff, liqRing, liqSourceNote, cobRows, cobCumulative, cobPeak, rowToPrice, fmtBookPrice,
    cobLabelText, pickCobLabels, bookStallMessage,
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
    // `home` = banda de DINAINTE de primul tap, ca sa se poata ieşi un pas.
    // Nu poate fi banda raportata acum: cand harta e focalizata, banda
    // raportata ESTE fereastra curenta, deci primul pas inapoi ar sari la FIT.
    const [bookZoom, setBookZoom] = useState<{ price: number; pct: number; home: number } | null>(null)
    // ZOOM pe axa de PRET a hartii de lichidari. Simetric fata de pret: un tap
    // alege o ADANCIME, nu un centru (vezi nota din liqmap/scale.ts).
    // `home` = fereastra de DINAINTE de primul tap. Fara ea nu se poate iesi un
    // pas: acoperirea raportata e TAIATA la fereastra curenta, deci ar scadea
    // odata cu zoom-ul si n-ai mai ieşi niciodata.
    const [liqSpan, setLiqSpan] = useState<{ span: number; home: number } | null>(null)
    const alive = useRef(true)

    const load = useCallback(async () => {
        const p = currentPrice()
        if (p > 0) setPrice(p)
        const d = await fetchPanel(symbol, p, days, HEAT_COLS, liqSpan?.span ?? null)
        if (alive.current) { setData(d); setLoading(false) }
    }, [days, symbol, liqSpan])

    // Cartea de ordine se aduce NUMAI cu rubrica deschisă: serverul o
    // reîmprospătează oricum la 5 s, iar o cerere pe secundă pentru un ecran
    // la care nu se uită nimeni e taxă curată.
    // Un pret de pe BTC nu are ce cauta pe grila ETH — la schimbarea simbolului
    // zoom-ul cade. Clasa b336: cartea unui simbol cu eticheta altuia.
    useEffect(() => { setBookZoom(null); setLiqSpan(null) }, [symbol])

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

    // Un singur tap pentru AMBELE vederi: scara si harta de caldura sunt doua
    // vederi ale aceloraşi date, deci o fereastra pe una singura le-ar face sa
    // arate doua lucruri diferite in acelasi panou.
    const onLiqTap = useCallback(() => {
        setLiqSpan((cur) => {
            const cov = data?.map?.coverage
            const next = spanStep(cur?.span ?? null, cov)
            // Reperul se fixeaza O SINGURA DATA, la primul tap.
            const home = cur?.home ?? spanStep(null, cov) * SPAN_FACTOR
            return { span: next, home }
        })
    }, [data])

    const onLiqOut = useCallback(() => {
        setLiqSpan((cur) => {
            if (!cur) return null
            const next = spanStepOut(cur.span, cur.home)
            return next === null ? null : { span: next, home: cur.home }
        })
    }, [])

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

            <Honesty stats={stats} map={map} days={days} setDays={setDays}
                loading={loading} setSpan={setLiqSpan} onOut={onLiqOut} />

            <SymbolStrip top={data.top} symbol={symbol} setSymbol={setSymbol} />

            <div className="zlq-tabs" role="tablist">
                {VIEWS.map((v) => (
                    <button key={v.id} role="tab" aria-selected={view === v.id}
                        className={'zlq-tab' + (view === v.id ? ' act' : '')}
                        onClick={() => setView(v.id)}>{v.label}</button>
                ))}
            </div>

            <div className="zlq-body">
                {view === 'map' && <MapView map={map} price={price} onTap={onLiqTap} />}
                {view === 'heat' && <HeatView heat={heat} price={price} onTap={onLiqTap} />}
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
function Honesty({ stats, map, days, setDays, loading, setSpan, onOut }: any) {
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
                {/* Fereastra de PRET sta langa ferestrele de TIMP: amandoua
                    sunt axele aceleiaşi harti. Eticheta vine din `map.spanPct`,
                    adica de la SERVER — el o margineste la 35%, deci tap-ul
                    poate sa nu fie fereastra pe care s-au numarat randurile. */}
                {map?.spanPct ? (
                    <button className="zlq-out" title="Zoom out one step"
                        onClick={onOut}>&minus;</button>
                ) : null}
                <button className={'zlq-span' + (map?.spanPct ? ' act' : '')}
                    title="Fit the whole price range"
                    onClick={() => setSpan(null)}>{spanLabel(map?.spanPct ?? null)}</button>
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
function MapView({ map, price, onTap }: { map: any; price: number; onTap?: () => void }) {
    if (!map || !map.buckets?.length) return <Empty what="The ladder" />
    // Scara CONTINUĂ, nu doar nivelurile care au date: altfel se citeşte ca o
    // listă de câteva rânduri şi se pierde exact ce face dintr-o scară o hartă
    // — cât de departe stă fiecare grămadă, şi cât gol e între ele.
    // Treapta scarii vine din treapta SERVERULUI (`map.bucket` = diviziuni pe
    // procent). Cu 0,25% fix, un zoom care rafineaza la 0,005% trimitea 44 de
    // niveluri si se desenau 5. Gasit randand.
    const rungs = buildLadder(map.buckets, price, Number(map.bucket) > 0 ? 1 / Number(map.bucket) : 0.25)
    if (!rungs.length) return <Empty what="The ladder" />
    const max = rungs.reduce((m, r) => Math.max(m, r.longUsd + r.shortUsd), 0) || 1
    // [2026-11-12] Dunga care aduna de la pret in afara + totalul la capat:
    // raspunsul la „deasupra sau dedesubt sunt mai multe?" fara adunat din ochi.
    const sides = ladderSides(rungs)
    return (
        <div className="zlq-map">
            <SideTotal side={sides.above} where="above" heavier={sides.heavier === 'above'} />
            {rungs.map((r, i) => {
                // ⛔ Marcajul de pret INGHITEA galeata de la 0%. La fereastra
                // plina, aia era de 21,7 milioane cu 132 de lichidari in 24h —
                // adica exact gramada de langa pret, cea mai interesanta,
                // desenata ca o eticheta goala. Bug preexistent, gasit cand am
                // numarat randurile din DOM la zoom. Acum marcajul isi arata si
                // dolarii, cand are.
                if (r.isPrice) {
                    const tot0 = r.longUsd + r.shortUsd
                    return (
                        <div key="now" className="zlq-now" onClick={onTap}>
                            <span>PRICE {Math.round(price)}</span>
                            {tot0 > 0 && (
                                <span className="zlq-now-v">
                                    <i style={{ background: barColor(r.longUsd >= r.shortUsd) }} />
                                    {fmtUsd(tot0)}
                                </span>
                            )}
                        </div>
                    )
                }
                const tot = r.longUsd + r.shortUsd
                const isLong = r.longUsd >= r.shortUsd
                const wpc = tot > 0 ? Math.max(2, (tot / max) * 100) : 0
                const cum = sides.rows[i]
                const peak = i === sides.above.maxIdx || i === sides.below.maxIdx
                return (
                    <div key={r.pct} onClick={onTap}
                        className={'zlq-row' + (r.pct >= 0 ? ' up' : ' dn') + (r.empty ? ' void' : '') + (peak ? ' peak' : '')}>
                        <span className="zlq-px">{Math.round(r.price)}</span>
                        <span className="zlq-pc">{fmtPct(r.pct)}</span>
                        <span className="zlq-bar">
                            {tot > 0 && <i style={{ width: wpc + '%', background: barColor(isLong) }} />}
                            {cum && sides.scale > 0 && (
                                <svg className="zlq-cum" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
                                    <line x1={1 + cum.top * 98} y1="0" x2={1 + cum.bottom * 98} y2="10"
                                        vectorEffect="non-scaling-stroke" />
                                </svg>
                            )}
                        </span>
                        <span className="zlq-v">{tot > 0 ? fmtUsd(tot) : ''}</span>
                    </div>
                )
            })}
            <SideTotal side={sides.below} where="below" heavier={sides.heavier === 'below'} />
        </div>
    )
}

// Capatul dungii: cat s-a adunat pe partea asta, si cat inseamna din total.
function SideTotal({ side, where, heavier }: { side: LadderSide; where: 'above' | 'below'; heavier: boolean }) {
    const pct = Math.round(side.share * 100)
    return (
        <div className={'zlq-end ' + (where === 'above' ? 'up' : 'dn') + (heavier ? ' heavier' : '')}>
            <span className="zlq-end-l">{where === 'above' ? 'Above price' : 'Below price'}</span>
            <span className="zlq-end-n">{side.n > 0 ? side.n.toLocaleString('en-US') + ' liquidations' : 'none in this window'}</span>
            <span className="zlq-end-p">{side.usd > 0 ? pct + '%' : ''}</span>
            <span className="zlq-end-v">{side.usd > 0 ? fmtUsd(side.usd) : '$0'}</span>
        </div>
    )
}

// ── Vederea HEATMAP: timp × preţ ──────────────────────────────────
// Canvas, nu DOM: 90 de coloane × zeci de niveluri ar însemna mii de noduri,
// iar pe telefon asta se simte imediat.
function HeatView({ heat, price, onTap }: { heat: any; price: number; onTap?: () => void }) {
    const ref = useRef<HTMLCanvasElement | null>(null)
    useEffect(() => {
        const cv = ref.current
        if (!cv) return
        const box = cv.parentElement
        const W = Math.max(240, box?.clientWidth || 320)
        const H = Math.max(236, Math.min(476, Math.round(W * 1.15) + 16))
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        cv.width = W * dpr; cv.height = H * dpr
        cv.style.width = W + 'px'; cv.style.height = H + 'px'
        const g = cv.getContext('2d')
        if (!g) return
        g.setTransform(dpr, 0, 0, dpr, 0, 0)
        g.clearRect(0, 0, W, H)
        g.fillStyle = '#070a0e'; g.fillRect(0, 0, W, H)
        const grid = heatGrid(heat)
        if (!grid) return

        // [2026-11-12] Asezarea: harta | profil pe pret | axa de pret, iar jos
        // o fasie pentru ore. Inainte erau doar patrate — nu puteai citi nici
        // la ce pret, nici la ce ora.
        const axisW = 46
        const timeH = 16
        const profW = Math.max(34, Math.min(60, Math.round(W * 0.14)))
        const mapW = Math.max(60, W - profW - axisW - 4)
        const mapH = H - timeH
        const px0 = mapW + 2                 // unde incepe profilul
        const ax0 = px0 + profW + 2          // unde incepe axa de pret
        const cw = mapW / grid.cols
        const rh = mapH / grid.rows
        const yTop = (pct: number) => mapH - (grid.rowOf(pct) + 1) * rh
        const yMid = (pct: number) => yTop(pct) + rh / 2
        // pozitie continua pe axa (pentru repere care nu cad pe un rand)
        const yAt = (pct: number) => mapH - ((pct - grid.lo) / grid.step + 0.5) * rh

        // ── 1. celulele ──
        for (const c of heat.cells) {
            const tot = c.longUsd + c.shortUsd
            const isLong = c.longUsd >= c.shortUsd
            g.fillStyle = cellColor(isLong, intensity(tot, heat.maxUsd))
            g.fillRect(c.t * cw, yTop(c.pct), Math.max(1.5, cw - 0.5), Math.max(1.5, rh - 0.5))
        }

        try {
            g.textBaseline = 'middle'
            // ── 2. axa de pret: preturi rotunde + linii fine peste harta ──
            const yNow = (0 >= grid.lo - grid.step && 0 <= grid.hi + grid.step) ? yAt(0) : null
            g.font = '9px monospace'
            g.textAlign = 'left'
            for (const t of priceTicks(grid.lo, grid.hi, price, 6)) {
                const y = yAt(t.pct)
                if (y < 7 || y > mapH - 7) continue
                if (yNow !== null && Math.abs(y - yNow) < 11) continue   // loc pentru pretul curent
                g.strokeStyle = 'rgba(255,255,255,.055)'; g.lineWidth = 1
                g.beginPath(); g.moveTo(0, Math.round(y) + 0.5); g.lineTo(mapW, Math.round(y) + 0.5); g.stroke()
                g.fillStyle = '#7f93a6'
                g.fillText(t.label, ax0 + 3, y)
            }

            // ── 3. profilul pe pret: tot ce s-a lichidat la fiecare nivel ──
            const prof = heatProfile(heat)
            const pm = prof.maxRowUsd || 1
            prof.rows.forEach((r, i) => {
                const y = i * rh
                const lw = (r.longUsd / pm) * profW, sw = (r.shortUsd / pm) * profW
                if (lw > 0) { g.fillStyle = LIQ.long; g.fillRect(px0, y, Math.max(1, lw), Math.max(1, rh - 0.5)) }
                if (sw > 0) { g.fillStyle = LIQ.short; g.fillRect(px0 + lw, y, Math.max(1, sw), Math.max(1, rh - 0.5)) }
            })
            g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1
            g.beginPath(); g.moveTo(px0 - 0.5, 0); g.lineTo(px0 - 0.5, mapH); g.stroke()

            // dunga cumulata: de la pret in afara, aceeasi scara pe ambele parti
            const sides = heatSides(prof)
            if (sides.scale > 0) {
                const xOf = (f: number) => px0 + 1 + f * (profW - 2)
                const run = (from: number, to: number, stepDir: number, color: string) => {
                    const pts: Array<[number, number]> = []
                    for (let i = from; i !== to; i += stepDir) {
                        const c = sides.rows[i]
                        if (!c) continue
                        const near: [number, number] = stepDir < 0 ? [xOf(c.bottom), (i + 1) * rh] : [xOf(c.top), i * rh]
                        const far: [number, number] = stepDir < 0 ? [xOf(c.top), i * rh] : [xOf(c.bottom), (i + 1) * rh]
                        if (!pts.length) pts.push(near)
                        pts.push(far)
                    }
                    if (pts.length < 2) return
                    const trace = () => { g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))) }
                    g.lineJoin = 'round'
                    trace(); g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineWidth = 3.2; g.stroke()
                    trace(); g.strokeStyle = color; g.lineWidth = 1.4; g.stroke()
                }
                const priceIdx = prof.rows.findIndex((r) => Math.abs(r.pct) < prof.step / 2)
                const split = priceIdx >= 0 ? priceIdx : prof.rows.findIndex((r) => r.pct < 0)
                const upFrom = (split < 0 ? prof.rows.length : split) - 1
                run(upFrom, -1, -1, '#eafffb')                                   // in sus
                run(priceIdx >= 0 ? priceIdx + 1 : (split < 0 ? prof.rows.length : split), prof.rows.length, 1, '#ffe9d6')   // in jos
                // totalul la capatul dungii, scurt, in coloana profilului
                g.font = 'bold 9px monospace'
                g.textAlign = 'right'
                const tag = (txt: string, y: number) => {
                    if (!txt) return
                    const tw = g.measureText(txt).width
                    g.fillStyle = 'rgba(7,10,14,.9)'
                    g.fillRect(px0 + profW - tw - 5, y - 6, tw + 5, 12)
                    g.fillStyle = '#ffd77a'
                    g.fillText(txt, px0 + profW - 2, y)
                }
                tag(cobLabelText(sides.above.usd), 7)
                tag(cobLabelText(sides.below.usd), mapH - 7)
            }

            // ── 4. cele doua maxime: dunga punctata + eticheta la capat ──
            const taken: Array<{ y: number; x1: number }> = []
            const flag = (pk: { pct: number; usd: number } | null, word: string, color: string) => {
                if (!pk) return
                const y = Math.max(9, Math.min(mapH - 9, yMid(pk.pct)))
                const px = fmtBookPrice(price * (1 + pk.pct / 100))
                g.font = 'bold 10px monospace'
                g.textAlign = 'left'
                const clash = taken.find((t) => Math.abs(t.y - y) < 18)
                const x0 = clash ? clash.x1 + 6 : 4
                const room = mapW - x0 - 16
                const txt = [`${word} max ${fmtUsd(pk.usd)} @ ${px}`, `${word} ${fmtUsd(pk.usd)} @ ${px}`, `${fmtUsd(pk.usd)} @ ${px}`]
                    .find((t) => g.measureText(t).width + 12 <= room)
                const pw = txt ? g.measureText(txt).width + 12 : 0
                g.save()
                g.setLineDash([4, 3]); g.lineWidth = 1.2; g.strokeStyle = color
                g.beginPath(); g.moveTo(x0 + pw, y); g.lineTo(px0 + profW, y); g.stroke()
                g.restore()
                if (!txt) return
                g.fillStyle = color
                g.fillRect(x0, y - 8, pw, 16)
                g.fillStyle = '#06090c'
                g.fillText(txt, x0 + 6, y + 0.5)
                taken.push({ y, x1: x0 + pw })
            }
            flag(prof.long.peak, 'Longs', LIQ.long)
            flag(prof.short.peak, 'Shorts', LIQ.short)

            // ── linia pretului curent, cu pretul scris pe axa ──
            if (yNow !== null) {
                g.strokeStyle = 'rgba(255,214,102,.6)'; g.lineWidth = 1
                g.beginPath(); g.moveTo(0, yNow); g.lineTo(ax0, yNow); g.stroke()
                const lbl = fmtBookPrice(price)
                if (lbl) {
                    g.font = 'bold 9px monospace'
                    g.textAlign = 'left'
                    g.fillStyle = '#ffd77a'
                    g.fillRect(ax0, yNow - 7, axisW - 2, 14)
                    g.fillStyle = '#06090c'
                    g.fillText(lbl, ax0 + 3, yNow + 0.5)
                }
            }

            // ── axa de timp ──
            g.font = '9px monospace'
            g.fillStyle = '#7f93a6'
            const ticks = timeTicks(heat.tMin, heat.tMax, W < 300 ? 4 : 5, -new Date().getTimezoneOffset())
            ticks.forEach((t, k) => {
                g.textAlign = k === 0 ? 'left' : k === ticks.length - 1 ? 'right' : 'center'
                g.fillText(t.label, Math.max(0, Math.min(mapW, t.f * mapW)), mapH + timeH / 2 + 1)
            })
            g.textAlign = 'left'
        } catch { /* fara repere, dar cu harta intreaga */ }
    }, [heat, price])

    if (!heat || !heat.cells?.length) return <Empty what="The grid" />
    const prof = heatProfile(heat)
    const sides = heatSides(prof)
    const steps = scaleSteps(heat.maxUsd, 5)
    const pkTxt = (pk: { pct: number; usd: number } | null) =>
        pk ? `max ${fmtUsd(pk.usd)} @ ${fmtBookPrice(price * (1 + pk.pct / 100))}` : ''
    const box = (cls: string, label: string, sub: string, share: number, usd: number, heavy: boolean) => (
        <div className={'zbk-sum-row ' + cls + (heavy ? ' heavier' : '')}>
            <span>{label}<em className="zbk-sum-pk">{sub}</em></span>
            <span className="zbk-sum-p">{usd > 0 ? Math.round(share * 100) + '%' : ''}</span>
            <span className="zbk-sum-v">{usd > 0 ? fmtUsd(usd) : '$0'}</span>
        </div>
    )
    return (
        <div className="zlq-heat">
            <canvas ref={ref} onClick={onTap} className="zlq-tap" />
            {/* Totalurile numara doar ce e DESENAT: lichidarile din intervalul
                de pret al hartii, nu tot istoricul din antet. */}
            <div className="zbk-sum" title="Liquidations inside the drawn price range">
                {box('ask', 'Longs liquidated', pkTxt(prof.long.peak), prof.long.share, prof.long.usd, prof.heavier === 'long')}
                {box('bid', 'Shorts liquidated', pkTxt(prof.short.peak), prof.short.share, prof.short.usd, prof.heavier === 'short')}
                {box('up', 'Above price', sides.above.n > 0 ? sides.above.n.toLocaleString('en-US') + ' liquidations' : '', sides.above.share, sides.above.usd, sides.heavier === 'above')}
                {box('dn', 'Below price', sides.below.n > 0 ? sides.below.n.toLocaleString('en-US') + ' liquidations' : '', sides.below.share, sides.below.usd, sides.heavier === 'below')}
            </div>
            {steps.length > 0 && (
                <div className="zlq-scale" title="What one cell is worth, from faint to bright">
                    <span className="zlq-dim">one cell</span>
                    <span className="zlq-scale-v">{fmtUsd(steps[0].usd)}</span>
                    <span className="zlq-scale-bar">
                        {steps.map((st, k) => <i key={'l' + k} style={{ background: cellColor(true, st.i) }} />)}
                    </span>
                    <span className="zlq-scale-bar">
                        {steps.map((st, k) => <i key={'s' + k} style={{ background: cellColor(false, st.i) }} />)}
                    </span>
                    <span className="zlq-scale-v">{fmtUsd(steps[steps.length - 1].usd)}</span>
                </div>
            )}
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
        // Reperul se fixeaza O SINGURA DATA, la primul tap.
        const home = zoom?.home ?? (Number(h?.bandPct) > 0 ? Number(h.bandPct) : undefined)
        setZoom({ price: p, pct: zoomStep(zoom?.pct ?? h?.bandPct), home: home as number })
    }, [data, zoom, setZoom])

    const onZoomOut = useCallback(() => {
        if (!zoom) return
        const next = zoomStepOut(zoom.pct, zoom.home)
        setZoom(next === null ? null : { ...zoom, pct: next })
    }, [zoom, setZoom])

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
        // [2026-11-12] Jgheab separat pentru cifrele profilului. Scrise peste
        // bare (portocaliu pe portocaliu, plus curba peste ele) nu se citeau.
        const labW = 34
        const mapW = Math.max(40, w - cobW - labW - 2)
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

        // [2026-11-09] Cifra la capatul liniutei: lungimea barei spune CARE e
        // mai mare, cifra spune CAT.
        //
        // Intr-o trecere separata, dupa ce barele sunt desenate, fiindca
        // alegerea randurilor se face pe TOT profilul: panza are 300px si zeci
        // de randuri, adica ~5px pe rand, deci o cifra pe fiecare s-ar calca pe
        // vecina ei. Se scriu doar nivelurile groase, destul de departate ca
        // textul sa se citeasca.
        //
        // Harta nu se atinge — se adauga doar text, dupa bara. Si daca panza nu
        // stie sa masoare text, desenul ramane intreg fara cifre.
        try {
            ctx.font = 'bold 9px monospace'
            ctx.textAlign = 'left'
            ctx.textBaseline = 'middle'
            const byRow = new Map(cob.map((c) => [c.row, c]))
            for (const L of pickCobLabels(cob, cobMax, (row) => rowToY(row, rows, h))) {
                const txt = cobLabelText(L.usd)
                const src = byRow.get(L.row)
                if (!txt || !src) continue
                const usd = L.side === 'ask' ? src.askUsd : src.bidUsd
                if (!(usd > 0)) continue
                // Rosu = vanzari, verde = cumparari, cerut de operator: cifrele
                // trebuie sa se desparta de bare, nu sa le continue culoarea.
                ctx.fillStyle = L.side === 'ask' ? '#ff6b6b' : '#4be38f'
                ctx.fillText(txt, cx + cobW + 4, rowToY(L.row, rows, h) + ch / 2)
            }
        } catch { /* fara cifre, dar cu harta intreaga */ }

        // ── 6. dunga cumulata: de la spread in afara, cu totalul la capat ──
        // [2026-11-12] Ca pe MAP. Se deseneaza ULTIMA, peste bare, cu un contur
        // inchis dedesubt, altfel se pierde pe culoarea barelor.
        try {
            const cum = cobCumulative(cob)
            if (cum.scale > 0) {
                const xOf = (f: number) => cx + 1 + f * (cobW - 2)
                const trace = (steps: { row: number; from: number; to: number }[], up: boolean) => {
                    ctx.beginPath()
                    steps.forEach((s, i) => {
                        const yTop = rowToY(s.row, rows, h)
                        const yNear = up ? yTop + ch : yTop
                        const yFar = up ? yTop : yTop + ch
                        if (i === 0) ctx.moveTo(xOf(s.from), yNear); else ctx.lineTo(xOf(s.from), yNear)
                        ctx.lineTo(xOf(s.to), yFar)
                    })
                }
                const stroke = (steps: any[], up: boolean, color: string) => {
                    if (!steps.length) return
                    ctx.lineJoin = 'round'
                    trace(steps, up); ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.lineWidth = 3.2; ctx.stroke()
                    trace(steps, up); ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.stroke()
                }
                stroke(cum.ask.steps, true, '#ffe2c7')
                stroke(cum.bid.steps, false, '#d6fff6')
                // Totalul la capat, ca la Coinglass: o dunga PUNCTATA de la
                // capatul curbei spre stanga, peste harta, si o eticheta plina
                // la capatul ei. [2026-11-12] Prima varianta scria cifra in
                // coltul panzei, unde se calca pe pretul de pe axa — operatorul
                // a vazut „72,54M": pret si total lipite.
                const flag = (steps: { row: number }[], up: boolean, usd: number, label: string, rgb: string, side: 'ask' | 'bid') => {
                    if (!steps.length || !(usd > 0)) return
                    const far = steps[steps.length - 1]
                    const yEdge = rowToY(far.row, rows, h) + (up ? 0 : ch)
                    const y = Math.max(9, Math.min(h - 9, yEdge))
                    const txt = label + ' ' + fmtUsd(usd)
                    ctx.font = 'bold 10px monospace'
                    ctx.textAlign = 'left'
                    ctx.textBaseline = 'middle'
                    const tw = ctx.measureText(txt).width
                    // butonul FIT sta in coltul din stanga-sus
                    const x0 = y < 40 ? 62 : 4
                    const pw = tw + 12
                    ctx.save()
                    ctx.setLineDash([4, 3])
                    ctx.lineWidth = 1.2
                    ctx.strokeStyle = `rgba(${rgb}, .95)`
                    ctx.beginPath(); ctx.moveTo(x0 + pw, y); ctx.lineTo(cx + cobW, y); ctx.stroke()
                    ctx.restore()
                    ctx.fillStyle = `rgb(${rgb})`
                    ctx.fillRect(x0, y - 8, pw, 16)
                    ctx.fillStyle = '#06090c'
                    ctx.fillText(txt, x0 + 6, y + 0.5)

                    // Lipit de total: cel mai gros nivel de pe partea asta si
                    // PRETUL lui. Se scrie doar daca incape pana la bare, cu
                    // loc de dunga dupa el — altfel forma scurta, altfel nimic.
                    // O eticheta taiata sau calcata pe bare e mai rea decat una
                    // lipsa; pretul ramane oricum in casetele de sub harta.
                    const pk = cobPeak(cob, side)
                    const px = pk ? rowToPrice(pk.row, rows, Number(heat.priceLo), Number(heat.priceHi)) : null
                    const pxTxt = px ? fmtBookPrice(px) : ''
                    if (pk && pxTxt) {
                        const room = (cx + cobW) - (x0 + pw) - 14
                        const amt = cobLabelText(pk.usd)
                        const pick = [amt ? `max ${amt} @ ${pxTxt}` : '', `max @ ${pxTxt}`, `@ ${pxTxt}`]
                            .find((t) => t && ctx.measureText(t).width + 12 <= room)
                        if (pick) {
                            const cw2 = ctx.measureText(pick).width + 12
                            ctx.fillStyle = 'rgba(7,10,14,.94)'
                            ctx.fillRect(x0 + pw, y - 8, cw2, 16)
                            ctx.strokeStyle = `rgb(${rgb})`
                            ctx.lineWidth = 1
                            ctx.strokeRect(x0 + pw + 0.5, y - 7.5, cw2 - 1, 15)
                            ctx.fillStyle = `rgb(${rgb})`
                            ctx.fillText(pick, x0 + pw + 6, y + 0.5)
                        }
                        // sageata mica pe randul zidului, la marginea barelor
                        const yp = rowToY(pk.row, rows, h) + ch / 2
                        ctx.fillStyle = '#ffd77a'
                        ctx.beginPath()
                        ctx.moveTo(cx - 1, yp); ctx.lineTo(cx - 7, yp - 4); ctx.lineTo(cx - 7, yp + 4)
                        ctx.closePath(); ctx.fill()
                    }
                }
                flag(cum.ask.steps, true, cum.ask.usd, 'Asks', BOOK.ask, 'ask')
                flag(cum.bid.steps, false, cum.bid.usd, 'Bids', BOOK.bid, 'bid')
                ctx.textAlign = 'left'
            }
        } catch { /* fara dunga, dar cu harta intreaga */ }
    }, [heat, data])

    if (!data) return <Empty what="The order book" />
    if (!heat || !heat.frames) {
        // Mesajul urmeaza MOTIVUL dat de server. Textul fix „Waiting for the
        // first snapshot" a tinut panoul o ora intr-o minciuna: bursa ne
        // refuza, deci nu era nimic de asteptat.
        const stall = bookStallMessage(data.stall || null)
        return (
            <div className="zlq-empty">
                <b>{stall.title}</b>
                <span>{stall.detail || sourceLabel(data.source || null)}</span>
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
                {heat.focused ? (
                    <button className="zbk-out" title="Zoom out one step"
                        onClick={onZoomOut}>&minus;</button>
                ) : null}
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
                    <span />
                    <span>{heat.priceLo ? Math.round(heat.priceLo).toLocaleString('en-US') : ''}</span>
                </div>
            </div>

            {/* [2026-11-12] Totalul dungii, in cifre intregi: pe panza incape
                doar forma scurta. Sunt ordine in asteptare din fereastra
                desenata, nu lichidari. */}
            {(() => {
                const cum = cobCumulative(cobRows(heat.cells, heat.cols))
                if (!(cum.scale > 0)) return null
                const peakOf = (k: 'ask' | 'bid') => {
                    const pk = cobPeak(cobRows(heat.cells, heat.cols), k)
                    const px = pk ? rowToPrice(pk.row, heat.rows, Number(heat.priceLo), Number(heat.priceHi)) : null
                    return pk && px ? `max ${fmtUsd(pk.usd)} @ ${fmtBookPrice(px)}` : ''
                }
                const row = (k: 'ask' | 'bid', label: string) => (
                    <div className={'zbk-sum-row ' + k + (cum.heavier === k ? ' heavier' : '')}>
                        <span>{label}<em className="zbk-sum-pk">{peakOf(k)}</em></span>
                        <span className="zbk-sum-p">{Math.round(cum[k].share * 100)}%</span>
                        <span className="zbk-sum-v">{fmtUsd(cum[k].usd)}</span>
                    </div>
                )
                return (
                    <div className="zbk-sum" title="Resting orders in the drawn band, summed outward from the spread">
                        {row('ask', 'Asks resting above')}
                        {row('bid', 'Bids resting below')}
                    </div>
                )
            })()}

            <div className="zbk-legend">
                <span><i style={{ background: `rgb(${BOOK.bid})` }} />bids / buys</span>
                <span><i style={{ background: `rgb(${BOOK.ask})` }} />asks / sells</span>
                <span><i className="zbk-dot" />trades</span>
                <span><i className="zbk-ring" />liquidations</span>
                <span>{bandLabel(Number.isFinite(heat.bandPct as number) ? Number(Number(heat.bandPct).toFixed(3)) : band)}</span>
                <span>{windowLabel(win)} span · {fmtSpan(heat.tMin || 0, heat.tMax || 0)} drawn</span>
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
