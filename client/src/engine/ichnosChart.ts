// ═══════════════════════════════════════════════════════════════════════════
// ICHNOS — desenul footprint-ului peste lumanarile chartului principal
// ═══════════════════════════════════════════════════════════════════════════
// Strat propriu legat de seria de lumanari (`attachPrimitive`, lightweight-charts
// 4.1): se redeseneaza odata cu chartul la pan/zoom. Cand lumanarile sunt late
// (zoom), fiecare arata nivelurile „vandut x cumparat"; cand sunt inguste, doar
// culoarea nivelurilor si POC-ul — ca in orice footprint.
// Culorile: aceeasi asezare ca in capturi, adaptata pe fundalul intunecat (cerut).
import { deriveCandle, bigLevels, kfmt, sumFmt, type FpCandle } from './indicatorCalcIchnos'

const w = window as any
const SUPPORTED_TF = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h'])
const POLL_MS = 3000
const BG = 'rgba(10,15,22,0.94)'
const GREEN = [57, 255, 106], RED = [255, 77, 109]
const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

type State = {
    symbol: string; tf: string; bin: number | null; candles: FpCandle[]
    status: 'idle' | 'loading' | 'ok' | 'unsupported' | 'error'
    msg: string; timer: any; series: any; prim: any; inflight: boolean; lastFull: number
}
const st: State = { symbol: '', tf: '', bin: null, candles: [], status: 'idle', msg: '', timer: null, series: null, prim: null, inflight: false, lastFull: 0 }

function cfg() {
    const c = (w.IND_SETTINGS && w.IND_SETTINGS.ichnos) || {}
    return {
        ratio: c.ratio > 1 ? +c.ratio : 3,
        stackMin: Math.round(c.stackMin) >= 2 ? Math.round(c.stackMin) : 3,
        bigMult: c.bigMult > 1 ? +c.bigMult : 4,
    }
}

class IchnosPrimitive {
    private chart: any = null
    private series: any = null
    private req: (() => void) | null = null
    attached(p: any) { this.chart = p.chart; this.series = p.series; this.req = p.requestUpdate }
    detached() { this.chart = null; this.series = null; this.req = null }
    redraw() { try { this.req && this.req() } catch (_) { /* chart in reconstructie */ } }
    updateAllViews() { /* datele se citesc la desen */ }
    paneViews() {
        const self = this
        return [{ zOrder: () => 'top', renderer: () => ({ draw: (target: any) => self.draw(target) }) }]
    }
    private draw(target: any) {
        const chart = this.chart, series = this.series
        if (!chart || !series) return
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }: any) => {
            const W = mediaSize.width, H = mediaSize.height
            ctx.save()
            ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace'
            ctx.textBaseline = 'middle'
            // Eticheta sursei / starii, jos-stanga, deasupra axei de timp
            const label = st.status === 'ok'
                ? `ICHNOS · footprint · Bybit trades · $k · ${st.tf}`
                : st.status === 'loading' ? 'ICHNOS · waiting for trades…' : (st.msg || '')
            if (label) { ctx.fillStyle = 'rgba(160,180,205,0.75)'; ctx.textAlign = 'left'; ctx.fillText(label, 8, H - 10) }
            if (st.status !== 'ok' || !st.candles.length || !st.bin) { ctx.restore(); return }

            const ts = chart.timeScale()
            const spacing = Number(ts.options().barSpacing) || 6
            const colW = Math.max(2, spacing * 0.92)
            const bin = st.bin
            const vis = ts.getVisibleRange && ts.getVisibleRange()
            const from = vis ? Number(vis.from) : -Infinity, to = vis ? Number(vis.to) : Infinity
            const shown = st.candles.filter((c) => c.t / 1000 >= from - 1 && c.t / 1000 <= to + 1)
            const c0 = cfg()
            const full = colW >= 46          // destul loc pentru „179x104"
            const zones: Array<{ x: number; side: string; y1: number; y2: number }> = []

            for (const c of shown) {
                const x = ts.timeToCoordinate(c.t / 1000)
                if (x == null) continue
                const d = deriveCandle(c, bin, { ratio: c0.ratio, stackMin: c0.stackMin })
                const left = x - colW / 2, strip = Math.min(4, Math.max(2, colW * 0.06))
                const cellX = left + strip + 1, cellW = colW - strip - 2
                let topY = Infinity, botY = -Infinity
                for (const [p, bid, ask] of c.lv) {
                    const yTop = series.priceToCoordinate(p + bin), yBot = series.priceToCoordinate(p)
                    if (yTop == null || yBot == null) continue
                    const y1 = Math.min(yTop, yBot), h = Math.max(1, Math.abs(yBot - yTop))
                    topY = Math.min(topY, y1); botY = Math.max(botY, y1 + h)
                    const vol = bid + ask
                    const a = 0.10 + 0.55 * (d.maxCell > 0 ? vol / d.maxCell : 0)
                    ctx.fillStyle = BG; ctx.fillRect(cellX, y1, cellW, h)
                    ctx.fillStyle = rgba(ask >= bid ? GREEN : RED, Math.min(0.65, a)); ctx.fillRect(cellX, y1 + 0.5, cellW, h - 1)
                    if (d.poc === p) { ctx.strokeStyle = '#e9eef4'; ctx.lineWidth = 1.5; ctx.strokeRect(cellX + 0.75, y1 + 0.75, cellW - 1.5, h - 1.5) }
                    if (full && h >= 9) {
                        const fs = Math.min(12, Math.max(8, Math.floor(h - 2)))
                        const bTxt = kfmt(bid), aTxt = kfmt(ask)
                        const midY = y1 + h / 2, midX = cellX + cellW / 2
                        ctx.font = `500 ${fs}px "IBM Plex Mono", ui-monospace, monospace`
                        const xw = ctx.measureText('x').width, bw = ctx.measureText(bTxt).width
                        const total = bw + xw + ctx.measureText(aTxt).width
                        let cx = midX - total / 2
                        ctx.textAlign = 'left'
                        ctx.font = `${d.sellImb.has(p) ? 700 : 500} ${fs}px "IBM Plex Mono", ui-monospace, monospace`
                        ctx.fillStyle = d.sellImb.has(p) ? '#ff5c78' : '#d8e4f0'; ctx.fillText(bTxt, cx, midY); cx += bw
                        ctx.font = `500 ${fs}px "IBM Plex Mono", ui-monospace, monospace`
                        ctx.fillStyle = '#7c8ea3'; ctx.fillText('x', cx, midY); cx += xw
                        ctx.font = `${d.buyImb.has(p) ? 700 : 500} ${fs}px "IBM Plex Mono", ui-monospace, monospace`
                        ctx.fillStyle = d.buyImb.has(p) ? '#5aa9ff' : '#d8e4f0'; ctx.fillText(aTxt, cx, midY)
                    }
                }
                if (!Number.isFinite(topY)) continue
                // Lumanarea proprie, subtire, in stanga celulelor
                const yo = series.priceToCoordinate(c.o), yc = series.priceToCoordinate(c.c)
                const yh = series.priceToCoordinate(c.h), yl = series.priceToCoordinate(c.l)
                if (yo != null && yc != null && yh != null && yl != null) {
                    const col = c.c >= c.o ? GREEN : RED
                    ctx.fillStyle = rgba(col, 0.9)
                    ctx.fillRect(left + strip / 2 - 0.5, Math.min(yh, yl), 1, Math.abs(yl - yh))
                    ctx.fillRect(left, Math.min(yo, yc), strip, Math.max(1, Math.abs(yc - yo)))
                }
                // Σ si Δ deasupra si dedesubt
                if (full) {
                    ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'center'
                    const dCol = d.delta >= 0 ? '#39ff6a' : '#ff5c78'
                    const dTxt = 'Δ ' + (d.delta >= 0 ? '' : '-') + sumFmt(Math.abs(d.delta))
                    const sTxt = 'Σ ' + sumFmt(d.total)
                    ctx.fillStyle = dCol; ctx.fillText(dTxt, x, topY - 20)
                    ctx.fillStyle = '#c4cfda'; ctx.fillText(sTxt, x, topY - 8)
                    ctx.fillStyle = '#c4cfda'; ctx.fillText(sTxt, x, botY + 8)
                    ctx.fillStyle = dCol; ctx.fillText(dTxt, x, botY + 20)
                }
                for (const z of d.stacked) {
                    const y1 = series.priceToCoordinate(z.high), y2 = series.priceToCoordinate(z.low)
                    if (y1 != null && y2 != null) zones.push({ x: x + colW / 2, side: z.side, y1: Math.min(y1, y2), y2: Math.max(y1, y2) })
                }
            }
            // Dezechilibre stivuite: zona prelungita spre dreapta (cele mai noi 6)
            for (const z of zones.slice(-6)) {
                ctx.fillStyle = z.side === 'buy' ? 'rgba(90,169,255,0.10)' : 'rgba(255,200,90,0.12)'
                ctx.fillRect(z.x, z.y1, W - z.x, z.y2 - z.y1)
                ctx.strokeStyle = z.side === 'buy' ? 'rgba(90,169,255,0.55)' : 'rgba(255,200,90,0.6)'; ctx.lineWidth = 1
                ctx.beginPath(); ctx.moveTo(z.x, z.y1 + 0.5); ctx.lineTo(W, z.y1 + 0.5); ctx.moveTo(z.x, z.y2 - 0.5); ctx.lineTo(W, z.y2 - 0.5); ctx.stroke()
            }
            // Ordine mari: linie albastra din marginea dreapta a lumanarii spre dreapta,
            // eticheta langa axa de pret; doua etichete prea apropiate → doar prima.
            const usedY: number[] = []
            for (const b of bigLevels(shown, c0.bigMult, 3)) {
                const x = ts.timeToCoordinate(b.t / 1000), y = series.priceToCoordinate(b.price + bin / 2)
                if (x == null || y == null) continue
                const x0 = x + colW / 2 + 1
                if (x0 >= W - 4) continue
                ctx.strokeStyle = 'rgba(70,150,255,0.85)'; ctx.lineWidth = 2
                ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(W, y); ctx.stroke()
                if (usedY.every((u) => Math.abs(u - y) > 13) && W - x0 > 60) {
                    usedY.push(y)
                    ctx.fillStyle = 'rgba(110,175,255,0.95)'; ctx.font = '600 10px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'right'
                    ctx.fillText('BIG ' + sumFmt(b.vol) + 'k', W - 4, y - 7)
                }
            }
            ctx.restore()
        })
    }
}

function chartTf(): string { return String(w.S?.chartTf || '5m') }
function chartSym(): string { return String(w.S?.symbol || 'BTCUSDT').toUpperCase() }

async function fetchFp(full: boolean): Promise<void> {
    if (st.inflight) return
    const sym = chartSym(), tf = chartTf()
    if (!SUPPORTED_TF.has(tf)) { st.status = 'unsupported'; st.msg = `ICHNOS · ${tf} not supported (1m–4h)`; st.candles = []; st.prim?.redraw(); return }
    st.inflight = true
    try {
        const r = await fetch(`/api/market/footprint?symbol=${encodeURIComponent(sym)}&tf=${encodeURIComponent(tf)}&limit=${full ? 300 : 3}`, { credentials: 'same-origin' })
        const j = r.ok ? await r.json() : null
        if (sym !== chartSym() || tf !== chartTf()) return        // s-a schimbat intre timp
        if (!j || !j.ok) {
            st.status = 'unsupported'
            st.msg = j && j.error === 'unsupported' ? `ICHNOS · no trade data for ${sym.replace(/USDT$/, '')} (BTC, ETH, SOL, BNB)` : 'ICHNOS · footprint unavailable'
            st.candles = []
        } else {
            st.bin = j.bin
            const incoming: FpCandle[] = Array.isArray(j.candles) ? j.candles : []
            if (full || st.symbol !== sym || st.tf !== tf) st.candles = incoming
            else {
                const map = new Map(st.candles.map((c) => [c.t, c]))
                for (const c of incoming) map.set(c.t, c)
                st.candles = [...map.values()].sort((a, b) => a.t - b.t).slice(-400)
            }
            st.symbol = sym; st.tf = tf
            st.status = st.candles.length ? 'ok' : 'loading'
            st.msg = ''
        }
    } catch (_) {
        st.status = 'error'; st.msg = 'ICHNOS · connection lost, retrying'
    } finally {
        st.inflight = false
        st.prim?.redraw()
    }
}

function attach(): void {
    const s = w.cSeries
    if (!s || typeof s.attachPrimitive !== 'function') return
    if (st.series === s && st.prim) return
    try { if (st.series && st.prim) st.series.detachPrimitive(st.prim) } catch (_) { /* seria veche nu mai exista */ }
    st.prim = st.prim || new IchnosPrimitive()
    try { s.attachPrimitive(st.prim); st.series = s } catch (_) { st.series = null }
}

export function initIchnos(): void {
    attach()
    if (st.status === 'idle') st.status = 'loading'
    if (!st.timer) {
        st.timer = setInterval(() => {
            if (document.hidden) return
            const full = st.symbol !== chartSym() || st.tf !== chartTf() || Date.now() - st.lastFull > 300000
            if (full) st.lastFull = Date.now()
            void fetchFp(full)
        }, POLL_MS)
    }
    st.lastFull = Date.now()
    void fetchFp(true)
}

/** Chemat din bucla de indicatori: reataseaza dupa o reconstructie a seriei, reincarca la schimbari. */
export function updateIchnos(): void {
    attach()
    if (st.symbol && (st.symbol !== chartSym() || st.tf !== chartTf())) { st.lastFull = Date.now(); void fetchFp(true) }
    else st.prim?.redraw()
}

export function clearIchnos(): void {
    if (st.timer) { clearInterval(st.timer); st.timer = null }
    try { if (st.series && st.prim) st.series.detachPrimitive(st.prim) } catch (_) { /* deja */ }
    st.series = null; st.candles = []; st.status = 'idle'; st.symbol = ''; st.tf = ''
}

export const _ichnosStateForTest = st
