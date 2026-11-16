// ═══════════════════════════════════════════════════════════════════════════
// ICHNOS — footprint pe panou propriu, ca in capturile „Orderflow Trader Lab"
// ═══════════════════════════════════════════════════════════════════════════
// [2026-11-16, a doua versiune] Prima versiune desena peste lumanarile chartului
// principal; pe 30m, cu zeci de lumanari pe ecran, fiecare avea cativa pixeli si
// operatorul „nu vedea nimic". Footprint-ul din capturi e un chart SEPARAT:
// coloane late (~96 px), un rand cu inaltime fixa pe fiecare nivel de pret,
// casute „vandut x cumparat", POC incadrat gros, celulele cu volum mare umplute
// si incadrate, dezechilibre aldine, Σ / Δ deasupra si dedesubt, lumanare subtire
// in stanga coloanei, banda aurie pentru dezechilibre stivuite, linie albastra
// pentru ordine mari. Aceeasi asezare, pe fundal intunecat (ales de el).
//
// Gesturi [2026-11-16, cerut]: sus-jos cu degetul deruleaza PAGINA (ca peste tot);
// stanga-dreapta = prin timp; pretul se muta cu butoanele ▲ ▼ de pe axa, LIVE /
// dublu-tap = inapoi la ultima lumanare. Fara bucla continua: se deseneaza la date
// noi si la gesturi.
import { deriveCandle, bigLevels, kfmt, sumFmt, type FpCandle } from './indicatorCalcIchnos'

const w = window as any
const SUPPORTED_TF = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h'])
const POLL_MS = 5000
const COL_W = 96, ROW_H = 22, AXIS_W = 66, HEAD_H = 22, TIME_H = 18, STRIP = 7
const BG = '#0a0f16', GRID = '#121b26'
const GREEN = [57, 255, 106], RED = [255, 77, 109]
const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`
const FONT = '"IBM Plex Mono", ui-monospace, Menlo, monospace'

type State = {
    symbol: string; tf: string; bin: number | null; candles: FpCandle[]
    status: 'idle' | 'loading' | 'ok' | 'unsupported' | 'error'
    msg: string; timer: any; inflight: boolean; lastFull: number; holdUntil: number
    el: HTMLElement | null; cv: HTMLCanvasElement | null; ro: ResizeObserver | null
    colOff: number; priceOff: number; follow: boolean
}
const st: State = {
    symbol: '', tf: '', bin: null, candles: [], status: 'idle', msg: '', timer: null, inflight: false, lastFull: 0, holdUntil: 0,
    el: null, cv: null, ro: null, colOff: 0, priceOff: 0, follow: true,
}

function cfg() {
    const c = (w.IND_SETTINGS && w.IND_SETTINGS.ichnos) || {}
    return {
        ratio: c.ratio > 1 ? +c.ratio : 3,
        stackMin: Math.round(c.stackMin) >= 2 ? Math.round(c.stackMin) : 3,
        bigMult: c.bigMult > 1 ? +c.bigMult : 4,
    }
}
const chartTf = (): string => String(w.S?.chartTf || '5m')
const chartSym = (): string => String(w.S?.symbol || 'BTCUSDT').toUpperCase()
const decOf = (b: number) => (String(b).includes('.') ? String(b).split('.')[1].length : 0)
const hhmm = (t: number) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }

// ── desenul ──
export function renderIchnos(): void {
    const cv = st.cv, el = st.el
    if (!cv || !el) return
    const W = el.clientWidth || 360, H = el.clientHeight || 460
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
        cv.style.width = W + 'px'; cv.style.height = H + 'px'
    }
    const ctx = cv.getContext('2d'); if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H)
    ctx.textBaseline = 'middle'

    // antetul
    ctx.font = `600 10px ${FONT}`; ctx.textAlign = 'left'; ctx.fillStyle = '#9fb3c8'
    const sym = chartSym().replace(/USDT$/, '')
    ctx.fillText(`ICHNOS · FOOTPRINT · ${sym} · ${chartTf()}`, 8, HEAD_H / 2)
    ctx.textAlign = 'right'; ctx.fillStyle = '#56657a'; ctx.font = `500 9px ${FONT}`
    ctx.fillText('sold x bought · $k · Bybit', W - 8, HEAD_H / 2)
    ctx.fillStyle = '#142235'; ctx.fillRect(0, HEAD_H - 1, W, 1)

    const msg = st.status === 'ok' ? '' : st.status === 'loading' ? (st.msg || 'Collecting trades… the footprint fills from the moment the server started.') : st.msg
    if (msg || !st.candles.length || !st.bin) {
        ctx.textAlign = 'center'; ctx.fillStyle = '#7c8ea3'; ctx.font = `500 11px ${FONT}`
        ctx.fillText(msg || 'Waiting for trades…', W / 2, H / 2)
        return
    }
    const bin = st.bin, dec = decOf(bin)
    const plotW = W - AXIS_W, top = HEAD_H + 34, bottom = H - TIME_H - 34
    const rows = Math.max(4, Math.floor((bottom - top) / ROW_H))
    // Zona de randuri se termina EXACT pe ultimul rand intreg: sub ea stau Σ / Δ.
    const rowsEnd = top + rows * ROW_H
    const cols = Math.max(1, Math.floor(plotW / COL_W))
    const n = st.candles.length
    const last = st.candles[n - 1]
    // coloana din dreapta = cea mai noua (minus derularea in timp)
    const endIdx = Math.max(0, Math.min(n - 1, n - 1 - st.colOff))
    const startIdx = Math.max(0, endIdx - cols + 1)
    const shown = st.candles.slice(startIdx, endIdx + 1)
    // pretul din mijloc: inchiderea ultimei lumanari vazute + derularea pe pret
    const centerC = shown[shown.length - 1]
    const center = Math.floor(centerC.c / bin) * bin + st.priceOff * bin
    const topPrice = +(center + Math.floor(rows / 2) * bin).toFixed(dec)
    const yOf = (p: number) => top + Math.round((topPrice - p) / bin) * ROW_H
    const c0 = cfg()

    // grila orizontala + axa de pret
    ctx.font = `500 10px ${FONT}`; ctx.textAlign = 'left'
    for (let r = 0; r <= rows; r++) {
        const y = top + r * ROW_H
        ctx.fillStyle = GRID; ctx.fillRect(0, y, plotW, 1)
        if (r < rows) {
            const p = +(topPrice - r * bin).toFixed(dec)
            ctx.fillStyle = '#56657a'; ctx.fillText(p.toFixed(dec), plotW + 6, y + ROW_H / 2)
        }
    }
    ctx.fillStyle = '#142235'; ctx.fillRect(plotW, HEAD_H, 1, H - HEAD_H)

    const zones: Array<{ x: number; y1: number; y2: number; side: string }> = []
    const xLeftOf = (k: number) => plotW - (shown.length - k) * COL_W
    // cele mai mari 3 celule din ce se vede = umplute si incadrate (ca in capturi)
    const allCells: Array<{ v: number; key: string }> = []
    for (const c of shown) for (const [p, b, a] of c.lv) allCells.push({ v: b + a, key: c.t + ':' + p })
    const heavy = new Set(allCells.sort((x, y) => y.v - x.v).slice(0, 3).map((x) => x.key))

    shown.forEach((c, k) => {
        const x = xLeftOf(k)
        const d = deriveCandle(c, bin, { ratio: c0.ratio, stackMin: c0.stackMin })
        const cellX = x + STRIP + 4, cellW = COL_W - STRIP - 8
        let yTop = Infinity, yBot = -Infinity
        for (const [p, bid, ask] of c.lv) {
            const y = yOf(p)
            if (y < top || y + ROW_H > rowsEnd) continue
            yTop = Math.min(yTop, y); yBot = Math.max(yBot, y + ROW_H)
            const vol = bid + ask
            const share = d.maxCell > 0 ? vol / d.maxCell : 0
            const isHeavy = heavy.has(c.t + ':' + p)
            const col = ask >= bid ? GREEN : RED
            ctx.fillStyle = rgba(col, isHeavy ? 0.55 : 0.08 + 0.32 * share)
            ctx.fillRect(cellX, y + 1, cellW, ROW_H - 2)
            if (isHeavy) { ctx.strokeStyle = rgba(col, 0.95); ctx.lineWidth = 1.5; ctx.strokeRect(cellX + 0.75, y + 1.75, cellW - 1.5, ROW_H - 3.5) }
            if (d.poc === p) { ctx.strokeStyle = '#e9eef4'; ctx.lineWidth = 2.5; ctx.strokeRect(cellX + 1.25, y + 2.25, cellW - 2.5, ROW_H - 4.5) }
            // „vandut x cumparat"
            const bT = kfmt(bid), aT = kfmt(ask)
            const bBold = d.sellImb.has(p), aBold = d.buyImb.has(p)
            ctx.font = `${bBold ? 700 : 500} 12px ${FONT}`; const bw = ctx.measureText(bT).width
            ctx.font = `500 10px ${FONT}`; const xw = ctx.measureText('x').width + 2
            ctx.font = `${aBold ? 700 : 500} 12px ${FONT}`; const aw = ctx.measureText(aT).width
            let tx = cellX + cellW / 2 - (bw + xw + aw) / 2, ty = y + ROW_H / 2 + 0.5
            ctx.textAlign = 'left'
            ctx.font = `${bBold ? 700 : 500} 12px ${FONT}`; ctx.fillStyle = bBold ? '#ff5c78' : '#e2e9f1'; ctx.fillText(bT, tx, ty); tx += bw + 1
            ctx.font = `500 10px ${FONT}`; ctx.fillStyle = '#7c8ea3'; ctx.fillText('x', tx, ty); tx += xw - 1
            ctx.font = `${aBold ? 700 : 500} 12px ${FONT}`; ctx.fillStyle = aBold ? '#5aa9ff' : '#e2e9f1'; ctx.fillText(aT, tx, ty)
        }
        if (Number.isFinite(yTop)) {
            // lumanarea subtire in stanga
            const yh = yOf(Math.floor(c.h / bin) * bin), yl = yOf(Math.floor(c.l / bin) * bin) + ROW_H
            const yo = yOf(Math.floor(c.o / bin) * bin) + ROW_H / 2, yc = yOf(Math.floor(c.c / bin) * bin) + ROW_H / 2
            const ccol = c.c >= c.o ? GREEN : RED
            const clampY = (v: number) => Math.max(top, Math.min(rowsEnd, v))
            ctx.fillStyle = rgba(ccol, 0.55); ctx.fillRect(x + 3 + STRIP / 2 - 0.5, clampY(yh), 1, clampY(yl) - clampY(yh))
            const bA = clampY(Math.min(yo, yc) - ROW_H / 2), bB = clampY(Math.max(yo, yc) + ROW_H / 2)
            if (bB > bA) { ctx.fillStyle = rgba(ccol, 0.95); ctx.fillRect(x + 3, bA, STRIP, Math.max(3, bB - bA)) }
            // Σ si Δ deasupra si dedesubt
            const dCol = d.delta >= 0 ? '#39ff6a' : '#ff5c78'
            const dT = 'Δ ' + (d.delta < 0 ? '-' : '') + sumFmt(Math.abs(d.delta))
            const sT = 'Σ ' + sumFmt(d.total)
            const mid = cellX + cellW / 2
            ctx.textAlign = 'center'; ctx.font = `600 11px ${FONT}`
            const above = Math.max(top - 2, yTop) - 6
            ctx.fillStyle = dCol; ctx.fillText(dT, mid, above - 14)
            ctx.fillStyle = '#d8e4f0'; ctx.fillText(sT, mid, above)
            const below = Math.min(rowsEnd, yBot) + 10
            ctx.fillStyle = '#d8e4f0'; ctx.fillText(sT, mid, below)
            ctx.fillStyle = dCol; ctx.fillText(dT, mid, below + 14)
        }
        for (const z of d.stacked) {
            const y1 = yOf(+(z.high - bin).toFixed(dec)), y2 = yOf(z.low) + ROW_H
            zones.push({ x: x + COL_W - 3, y1, y2, side: z.side })
        }
        // ora sub coloana
        ctx.textAlign = 'center'; ctx.font = `500 9px ${FONT}`; ctx.fillStyle = '#56657a'
        ctx.fillText(hhmm(c.t), x + COL_W / 2, H - TIME_H / 2)
        ctx.fillStyle = GRID; ctx.fillRect(x, HEAD_H, 1, H - HEAD_H - TIME_H)
    })

    // dezechilibre stivuite: banda aurie / albastra spre dreapta
    for (const z of zones.slice(-6)) {
        const yA = Math.max(top, z.y1), yB = Math.min(rowsEnd, z.y2)
        if (yB <= yA) continue
        ctx.fillStyle = z.side === 'sell' ? 'rgba(255,200,90,0.13)' : 'rgba(90,169,255,0.11)'
        ctx.fillRect(z.x, yA, plotW - z.x, yB - yA)
        ctx.strokeStyle = z.side === 'sell' ? 'rgba(255,200,90,0.75)' : 'rgba(90,169,255,0.7)'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(z.x, yA + 0.5); ctx.lineTo(plotW, yA + 0.5); ctx.moveTo(z.x, yB - 0.5); ctx.lineTo(plotW, yB - 0.5); ctx.stroke()
    }
    // ordine mari: linie albastra spre dreapta + eticheta
    const usedY: number[] = []
    for (const b of bigLevels(shown, c0.bigMult, 3)) {
        const k = shown.findIndex((c) => c.t === b.t)
        if (k < 0) continue
        const y = yOf(b.price) + ROW_H / 2
        if (y < top || y > rowsEnd) continue
        const x0 = xLeftOf(k) + COL_W - 3
        ctx.strokeStyle = 'rgba(70,150,255,0.9)'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(plotW, y); ctx.stroke()
        if (usedY.every((u) => Math.abs(u - y) > 14)) {
            usedY.push(y)
            ctx.fillStyle = 'rgba(70,150,255,0.95)'; ctx.fillRect(plotW + 1, y - 8, AXIS_W - 1, 16)
            ctx.fillStyle = '#ffffff'; ctx.font = `700 9px ${FONT}`; ctx.textAlign = 'center'
            ctx.fillText('BIG ' + sumFmt(b.vol) + 'k', plotW + AXIS_W / 2, y)
        }
    }
    // pretul curent: linie punctata + eticheta pe axa
    const ly = yOf(Math.floor(last.c / bin) * bin) + ROW_H / 2
    if (ly >= top && ly <= rowsEnd) {
        const col = last.c >= last.o ? GREEN : RED
        ctx.strokeStyle = rgba(col, 0.7); ctx.setLineDash([3, 3]); ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(plotW, ly); ctx.stroke(); ctx.setLineDash([])
        ctx.fillStyle = rgba(col, 1); ctx.fillRect(plotW + 1, ly - 8, AXIS_W - 1, 16)
        ctx.fillStyle = '#07101a'; ctx.font = `700 10px ${FONT}`; ctx.textAlign = 'center'
        ctx.fillText(last.c.toFixed(Math.max(dec, 1)), plotW + AXIS_W / 2, ly)
    }
    if (!st.follow || st.colOff > 0) {
        ctx.textAlign = 'left'; ctx.font = `600 9px ${FONT}`; ctx.fillStyle = '#ffc85a'
        ctx.fillText('LIVE or double-tap: back to the last candle', 8, H - TIME_H / 2)
    }
}

// ── gesturile ──
const live = () => { st.colOff = 0; st.priceOff = 0; st.follow = true; renderIchnos() }

function wireGestures(el: HTMLElement): void {
    // Doar ORIZONTAL: panoul are `touch-action: pan-y`, deci sus-jos il ia browserul
    // (derulare de pagina) si ne trimite pointercancel.
    let sx = 0, c0 = 0, down = false, lastTap = 0
    el.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement)?.closest?.('.ichnos-btn')) return
        down = true; sx = e.clientX; c0 = st.colOff
        const now = Date.now()
        if (now - lastTap < 300) live()
        lastTap = now
    })
    el.addEventListener('pointermove', (e) => {
        if (!down) return
        const dc = Math.round((e.clientX - sx) / COL_W)
        const nc = Math.max(0, Math.min(Math.max(0, st.candles.length - 1), c0 + dc))
        if (nc !== st.colOff) { st.colOff = nc; st.follow = nc === 0 && st.priceOff === 0; renderIchnos() }
    })
    const up = () => { down = false }
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
    // Butoanele de pe axa: pretul sus / jos (cate 4 randuri) si LIVE
    const bar = document.createElement('div')
    bar.style.cssText = 'position:absolute;right:4px;top:26px;display:flex;flex-direction:column;gap:4px;z-index:2'
    const mk = (txt: string, label: string, fn: () => void) => {
        const b = document.createElement('button')
        b.type = 'button'; b.className = 'ichnos-btn'; b.textContent = txt; b.setAttribute('aria-label', label)
        b.style.cssText = 'width:58px;height:26px;border-radius:6px;border:1px solid #2a3a4d;background:rgba(10,15,22,.92);color:#c4d5e8;font:600 11px "IBM Plex Mono",monospace;cursor:pointer'
        b.addEventListener('click', (ev) => { ev.stopPropagation(); fn() })
        bar.appendChild(b)
    }
    mk('▲', 'Price up', () => { st.priceOff += 4; st.follow = false; renderIchnos() })
    mk('▼', 'Price down', () => { st.priceOff -= 4; st.follow = false; renderIchnos() })
    mk('LIVE', 'Back to live', live)
    el.appendChild(bar)
}

// ── datele ──
async function fetchFp(full: boolean): Promise<void> {
    if (st.inflight || Date.now() < st.holdUntil) return
    const sym = chartSym(), tf = chartTf()
    if (!SUPPORTED_TF.has(tf)) { st.status = 'unsupported'; st.msg = `ICHNOS works on 1m–4h. Switch the chart timeframe.`; st.candles = []; renderIchnos(); return }
    st.inflight = true
    // [2026-11-16] Un refuz de moment (429 „prea multe cereri", 5xx, retea) NU mai sterge
    // panoul: datele raman, iar cererea urmatoare asteapta (Retry-After sau 15 s). Inainte,
    // un singur 429 la pornirea aplicatiei golea panoul si scria „Connection lost" pana la refresh.
    const transient = (why: string, waitS: number) => {
        st.holdUntil = Date.now() + waitS * 1000
        if (st.candles.length && st.symbol === sym && st.tf === tf) { st.status = 'ok'; st.msg = '' }
        else { st.status = 'loading'; st.msg = why }
    }
    try {
        const r = await fetch(`/api/market/footprint?symbol=${encodeURIComponent(sym)}&tf=${encodeURIComponent(tf)}&limit=${full || st.symbol !== sym || st.tf !== tf || !st.candles.length ? 150 : 3}`,
            { credentials: 'same-origin', signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined })
        if (sym !== chartSym() || tf !== chartTf()) return
        if (!r.ok) {
            const ra = Number(r.headers.get('Retry-After'))
            transient('Server busy — retrying shortly…', ra > 0 ? Math.min(60, ra) : 15)
            return
        }
        const j = await r.json()
        if (j && j.ok === false && j.error === 'unsupported') {
            st.status = 'unsupported'
            st.msg = `No trade data for ${sym.replace(/USDT$/, '')} — ICHNOS covers BTC, ETH, SOL and BNB.`
            st.candles = []
        } else if (!j || !j.ok) {
            transient('Footprint unavailable — retrying shortly…', 15)
        } else {
            st.bin = j.bin
            const incoming: FpCandle[] = Array.isArray(j.candles) ? j.candles : []
            if (st.symbol !== sym || st.tf !== tf) { st.candles = incoming; st.colOff = 0; st.priceOff = 0; st.follow = true }
            else if (full || incoming.length > 3) st.candles = incoming
            else {
                const map = new Map(st.candles.map((c) => [c.t, c]))
                for (const c of incoming) map.set(c.t, c)
                st.candles = [...map.values()].sort((a, b) => a.t - b.t).slice(-300)
            }
            st.symbol = sym; st.tf = tf
            st.status = st.candles.length ? 'ok' : 'loading'
            st.msg = ''
        }
    } catch (_) {
        transient('Connection lost — retrying shortly…', 10)
    } finally {
        st.inflight = false
        renderIchnos()
    }
}

export function initIchnos(): void {
    const el = document.getElementById('ichnosPanel')
    if (!el) return
    el.style.display = ''
    if (!st.cv || st.el !== el) {
        el.innerHTML = ''
        const cv = document.createElement('canvas')
        cv.style.display = 'block'
        el.appendChild(cv)
        st.el = el; st.cv = cv
        wireGestures(el)
        try { st.ro = new ResizeObserver(() => renderIchnos()); st.ro.observe(el) } catch { st.ro = null }
    }
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
    renderIchnos()
    void fetchFp(true)
}

/** Din bucla de indicatori: la schimbarea monedei sau a intervalului, reincarca. */
export function updateIchnos(): void {
    if (!st.el) return
    if (st.symbol && (st.symbol !== chartSym() || st.tf !== chartTf())) { st.lastFull = Date.now(); void fetchFp(true) }
}

export function clearIchnos(): void {
    if (st.timer) { clearInterval(st.timer); st.timer = null }
    const el = document.getElementById('ichnosPanel')
    if (el) el.style.display = 'none'
    st.candles = []; st.status = 'idle'; st.symbol = ''; st.tf = ''; st.colOff = 0; st.priceOff = 0; st.follow = true; st.holdUntil = 0
}

export const _ichnosStateForTest = st
