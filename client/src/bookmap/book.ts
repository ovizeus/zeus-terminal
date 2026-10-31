// ══════════════════════════════════════════════════════════════════
// BOOKMAP — citirea cărţii de ordine: unde stau banii ACUM
// ══════════════════════════════════════════════════════════════════
//
// [BOOKMAP 2026-10-26] Operatorul: „lângă predict poţi să faci bookmap… date
// reale ce se poate lua din piaţă… să se citească uşor, să arate chartul,
// preţul, să avem zoom, totul funcţional".
//
// ⚠️ TREI MĂSURĂTORI care au decis forma panoului, făcute înainte de cod:
//
// 1. CARTEA CARE EXISTĂ E LATĂ DE 253 DE DOLARI (BTC la 80 322: −0,155% …
//    +0,160%, 92 M$, Binance REST limit=1000). NU există pereţi la 1% distanţă.
//    Deci nicio presetare de zoom nu trece de ±0,2% — una de ±1% ar desena o
//    hartă 84% goală, care arată stricată fiind corectă.
//
// 2. RAPORTUL max/median PE NIVEL E 427× (median 3 459 $, max 1 478 544 $).
//    Intensitatea TREBUIE logaritmică: liniar, un nivel la 1/400 din maxim ar
//    fi 0,25% opac, adică negru, adică harta ar minţi că nu e nimic acolo.
//
// 3. ZOOM înseamnă mai ADÂNC şi mai mult pe TIMP, nu mai departe de preţ —
//    fiindcă departe de preţ nu e nimic de arătat.
//
// ⚠️ TOT TEXTUL VIZIBIL E ÎN ENGLEZĂ (R-P-10). Comentariile — în română.

export const BOOK = {
    // Aceeaşi semantică ca în LIQ MAP, dinadins: acolo cyan era short lichidat
    // (cumpărare forţată) şi chihlimbar long lichidat (vânzare forţată). Deci
    // în tot panoul: cyan = forţă de cumpărare, chihlimbar = forţă de vânzare.
    // NU roşu/verde — ochiul le citeşte ca „sus/jos", nu ca „cerere/ofertă".
    bid: '53, 224, 208',      // #35e0d0
    ask: '255, 140, 66',      // #ff8c42
    line: '216, 178, 94',     // linia preţului
}

export type Wall = {
    side: 'BID' | 'ASK'
    price: number
    pct: number
    usd: number
    peakUsd: number
    firmness: number
    distUsd: number
}

/**
 * Intensitate LOGARITMICĂ, între o referinţă de JOS şi maxim.
 *
 * ⚠️ DE CE NU DOAR „faţă de maxim", şi cum am aflat: măsurasem raportul
 * max/median **PE NIVEL** — 745× — şi potrivisem scara pentru el. Dar o celulă
 * de grilă adună ~19 niveluri, deci pe CELULĂ raportul real e **3,0×** (26 de
 * rânduri) sau 6,2× (48). Cu scara pentru 745×, toate celulele ieşeau între
 * 0,79 şi 1,00: hartă uniform aprinsă, care nu arată nimic.
 *
 * Am văzut-o RANDÂND harta în ASCII cu date reale. Nicio aritmetică n-ar fi
 * prins-o, fiindcă cifra pe care o calculasem era corectă — doar despre alt
 * obiect. Serverul trimite acum `loUsd` (percentila 5 a celulelor nenule), iar
 * intensitatea se normalizează între ea şi maxim.
 *
 * Fără `lo` se păstrează comportamentul vechi, ca un răspuns mai vechi de la
 * server să nu lase harta neagră.
 */
export function bookIntensity(usd: number, maxUsd: number, loUsd?: number): number {
    const u = Number(usd)
    const m = Number(maxUsd)
    if (!Number.isFinite(u) || u <= 0) return 0
    if (!Number.isFinite(m) || m <= 0) return 0
    const lo = Number(loUsd)
    if (Number.isFinite(lo) && lo > 0 && m > lo) {
        if (u <= lo) return 0
        const v = Math.log(u / lo) / Math.log(m / lo)
        return Math.max(0, Math.min(1, v))
    }
    const r = Math.min(1, u / m)
    // Scara ALEASĂ PE DATE, nu din gust. Nivelul MEDIAN e la ~1/427 din maxim
    // (427× măsurat pe cartea reală), deci el decide dacă harta se vede:
    //
    //   fracţie        liniar     1e3     1e4     1e5
    //   1/1 (max)      1.000      1.000   1.000   1.000
    //   1/427 (MEDIAN) 0.0023     0.175   0.347   0.474
    //   1/5000         0.0002     0.026   0.119   0.264
    //   1/50000        0.00002    0.003   0.020   0.095
    //
    // 1e3 lasă medianul la 17% — majoritatea hărţii stinsă. 1e5 ridică zgomotul
    // de la 1/5000 la 26%, deci harta pare uniform aglomerată şi pereţii nu mai
    // ies în evidenţă. 1e4: median clar vizibil, zgomotul rămâne în fundal.
    const v = Math.log1p(r * 1e4) / Math.log1p(1e4)
    return Math.max(0, Math.min(1, v))
}

/** Opacitate variabilă, nuanţă FIXĂ — altfel ochiul citeşte două lucruri. */
export function bookColor(side: 'bid' | 'ask', intensity: number): string {
    const rgb = side === 'bid' ? BOOK.bid : BOOK.ask
    const i = Number(intensity)
    const a = !Number.isFinite(i) ? 0 : Math.max(0, Math.min(1, i))
    return `rgba(${rgb}, ${a === 0 ? '0' : a.toFixed(3)})`
}

export const BANDS: { label: string; value: number | 'auto' }[] = [
    { label: '0.01%', value: 0.01 },
    { label: '0.05%', value: 0.05 },
    { label: '0.1%', value: 0.1 },
    { label: '0.2%', value: 0.2 },
    { label: 'AUTO', value: 'auto' },
]

export const WINDOWS: { label: string; value: number }[] = [
    { label: '2m', value: 120 },
    { label: '5m', value: 300 },
    { label: '10m', value: 600 },
    { label: '20m', value: 1200 },
]

export function bandLabel(v: number | 'auto'): string {
    if (v === 'auto') return 'AUTO band'
    const n = Number(v)
    return Number.isFinite(n) ? `±${n}%` : 'AUTO band'
}

export function windowLabel(sec: number): string {
    const s = Number(sec)
    if (!Number.isFinite(s) || s <= 0) return '—'
    return s >= 60 ? `${Math.round(s / 60)}m` : `${Math.round(s)}s`
}

// Geometrie: rândul 0 e JOS (preţuri mici jos), coloana 0 e la stânga.
export function rowToY(row: number, rows: number, height: number): number {
    const R = Math.max(1, Number(rows) || 1)
    const h = Number(height) || 0
    return h - ((Number(row) || 0) + 1) * (h / R)
}

export function colToX(col: number, cols: number, width: number): number {
    const C = Math.max(1, Number(cols) || 1)
    const w = Number(width) || 0
    return (Number(col) || 0) * (w / C)
}

const nf = (n: number, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

function fmtUsdShort(u: number): string {
    const v = Math.abs(Number(u)) || 0
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B'
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
    return String(Math.round(v))
}

/**
 * Spread-ul, în dolari ŞI în puncte de bază — dolarii spun cât costă să intri,
 * punctele de bază fac comparabile BTC şi ETH.
 */
export function fmtSpread(spread: number | null | undefined, mid: number | null | undefined): string {
    if (spread === null || spread === undefined) return '—'
    const s = Number(spread)
    if (!Number.isFinite(s)) return '—'
    const m = Number(mid)
    const bp = Number.isFinite(m) && m > 0 ? (s / m) * 10000 : null
    return bp === null ? s.toFixed(2) : `${s.toFixed(2)}  ${bp.toFixed(2)}bp`
}

/**
 * Un perete. `firmness` apare dinadins: a treia capcană notată în carte era
 * „un perete care dispare când preţul se apropie nu e perete".
 */
export function fmtWall(w: Wall): string {
    if (!w) return '—'
    const d = Number(w.distUsd)
    const dist = Number.isFinite(d) ? `${d >= 0 ? '+' : ''}${nf(Math.round(d))}` : ''
    const firm = Number.isFinite(Number(w.firmness)) ? `${Math.round(w.firmness * 100)}%` : ''
    return `${w.side}  ${nf(Math.round(Number(w.price)))}  ${dist}  ${fmtUsdShort(w.usd)}  ${firm}`
}

/** Cât de adânc vedem. O hartă îngustă arată identic cu una stricată fără asta. */
export function sourceLabel(src: { deepLevels: number | null; deepFrames: number; topFrames: number } | null): string {
    if (!src) return 'waiting for data'
    const lv = Number(src.deepLevels)
    const fr = Number(src.deepFrames) || 0
    if (!fr) return 'waiting for data — first snapshot in a few seconds'
    const lvTxt = Number.isFinite(lv) && lv > 0 ? `${nf(lv)} levels` : 'levels unknown'
    return `${lvTxt} · ${nf(fr)} snapshots`
}

export async function fetchBook(
    symbol: string,
    opts: { band: number | 'auto'; windowSec: number; cols: number; rows: number },
    signal?: AbortSignal,
): Promise<any | null> {
    try {
        const q = new URLSearchParams({
            symbol,
            band: String(opts.band),
            window: String(opts.windowSec),
            cols: String(opts.cols),
            rows: String(opts.rows),
        })
        const r = await fetch('/api/market/bookmap?' + q.toString(), {
            credentials: 'same-origin', signal,
        })
        if (!r.ok) return null
        return await r.json()
    } catch {
        return null
    }
}

// ══════════════════════════════════════════════════════════════════
// BULE, LICHIDĂRI, COB — ce a cerut operatorul cu capturile din Bookmap
// ══════════════════════════════════════════════════════════════════
//
// [BOOKMAP-BULE 2026-10-30] „vreau şi eu indicatorul ăla cu date reale… exact
// aşa, cu bule, culori, tot, lichidări, nu sări nimic". Culorile le-a lăsat pe
// ale noastre, deci rămâne paleta Zeus: cyan = cumpărare, chihlimbar = vânzare.

export type Trade = { id: number; ts: number; price: number; qty: number; usd: number; sell: boolean }
export type Liq = { ts: number; price: number; usd: number; sell: boolean }

/**
 * Raza bulei. LOGARITMICĂ, şi nu din gust: măsurat pe 1000 de tranzacţii reale,
 * mărimile merg de la 0,001 la 7,25 BTC — raport de peste 7000×. Liniar, toate
 * tranzacţiile normale ar fi puncte invizibile lângă una singură uriaşă.
 */
export function bubbleRadius(usd: number, maxUsd: number, maxR = 14, minR = 1.5): number {
    const u = Number(usd)
    const m = Number(maxUsd)
    if (!Number.isFinite(u) || u <= 0) return 0
    if (!Number.isFinite(m) || m <= 0) return 0
    const r = Math.min(1, u / m)
    const v = Math.log1p(r * 999) / Math.log1p(999)
    return minR + Math.max(0, Math.min(1, v)) * (maxR - minR)
}

/** Culoarea bulei: cine a LOVIT. Cyan = a cumpărat, chihlimbar = a vândut. */
export function bubbleColor(sell: boolean, alpha = 0.8): string {
    const rgb = sell ? BOOK.ask : BOOK.bid
    const a = Math.max(0, Math.min(1, Number(alpha)))
    return `rgba(${rgb}, ${a.toFixed(2)})`
}

/**
 * Pragul de la care o bulă merită desenată.
 *
 * Fără el, 1000 de tranzacţii de 230$ (medianul măsurat) ar acoperi harta cu
 * praf şi n-ai mai vedea lichiditatea de dedesubt. Se taie la o fracţiune din
 * cea mai mare din fereastră, deci se adaptează singur la piaţă.
 */
export function bubbleCutoff(maxUsd: number, frac = 0.02): number {
    const m = Number(maxUsd)
    if (!Number.isFinite(m) || m <= 0) return Infinity
    return m * Math.max(0, Math.min(1, frac))
}

/**
 * Lichidările se desenează ALTFEL decât tranzacţiile, dinadins: un inel, nu un
 * disc. O lichidare nu e o tranzacţie ca oricare — e cineva scos cu forţa — şi
 * dacă ar arăta la fel, s-ar pierde exact evenimentul care contează.
 *
 * ⚠️ ŞI SUNT DIN ALTĂ PIAŢĂ: carnetul e Binance, iar lichidările le colectăm de
 * pe Bybit + OKX + Gate (Binance nu livrează fluxul către acest server). Preţul
 * e al aceleiaşi monede, deci cade corect pe axă — dar panoul trebuie s-o spună.
 */
export function liqRing(sell: boolean): { stroke: string; width: number } {
    return { stroke: `rgba(${sell ? BOOK.ask : BOOK.bid}, .95)`, width: 2 }
}

/** Eticheta de onestitate pentru lichidări — de unde vin, scris pe ecran. */
export function liqSourceNote(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return 'no liquidations in this window'
    return `${n} liquidation${n === 1 ? '' : 's'} — Bybit + OKX + Gate (Binance does not deliver)`
}

/**
 * COB — carnetul de ACUM, ca histogramă pe lângă hartă.
 *
 * Întoarce rânduri {row, bidUsd, askUsd} pe aceeaşi grilă ca harta, ca cele
 * două să se citească pe acelaşi rând de preţ. Fără asta ar fi două desene
 * alăturate care arată acelaşi lucru la înălţimi diferite.
 */
export function cobRows(cells: any[], cols: number): { row: number; bidUsd: number; askUsd: number }[] {
    if (!Array.isArray(cells) || !cells.length) return []
    const last = Math.max(0, (Number(cols) || 1) - 1)
    const byRow = new Map<number, { row: number; bidUsd: number; askUsd: number }>()
    for (const c of cells) {
        if (c.col !== last) continue
        const r = byRow.get(c.row) || { row: c.row, bidUsd: 0, askUsd: 0 }
        r.bidUsd += Number(c.bidUsd) || 0
        r.askUsd += Number(c.askUsd) || 0
        byRow.set(c.row, r)
    }
    return [...byRow.values()].sort((a, b) => a.row - b.row)
}
