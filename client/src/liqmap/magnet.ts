// [MAGNET 2026-11-12] Magnetul afisat pe HEATMAP si BOOK.
//
// E cifra lui PREDICT (`/api/market/liq-predict`), nu un al doilea calcul:
// doua taburi care socotesc separat ajung sa spuna doua lucruri diferite.
//
// Cerut de operator: „real, nu fake; cand n-are date sa scrie ca aduna date,
// iar cand strange sa le afiseze". Deci:
//   - fiecare stare fara cifra are textul ei (aduna date / nemasurat pe piata
//     asta / niciun magnet acum / directie fara pret);
//   - dovada (rata masurata fata de rata de baza) vine din `liftLabel`, care
//     scrie CALIBRATING pana cand serverul are destule cazuri;
//   - nicio cale de aici nu produce o tinta sau un procent pe care serverul
//     nu le-a trimis.
//
// Text vizibil in ENGLEZA (R-P-10).
import { fmtUsd } from './scale'
import { horizonLabel, liftLabel, type PredictSymbol } from './predict'

export type MagnetState = {
    kind: 'collecting' | 'untracked' | 'none' | 'direction' | 'live'
    side: 'UP' | 'DOWN' | null
    title: string
    detail: string
    proof: string
    /** cel putin un orizont masurat, cu avantaj peste intamplare */
    proven: boolean
    /** proven = masurat cu avantaj; no-edge = masurat, fara avantaj; calibrating = inca nemasurat */
    verdict: 'proven' | 'no-edge' | 'calibrating'
    target: { price: number; pct: number; usd: number; n: number } | null
}

const blank = (kind: MagnetState['kind'], title: string, detail = ''): MagnetState =>
    ({ kind, side: null, title, detail, proof: '', proven: false, verdict: 'calibrating', target: null })

const short = (sym: string): string => String(sym || '').replace(/USDT$|USDC$|USD$/, '')

function fmtPx(v: number): string {
    if (v >= 1000) return Math.round(v).toLocaleString('en-US')
    if (v >= 100) return v.toFixed(1)
    if (v >= 1) return v.toFixed(2)
    return v.toFixed(4)
}

export function magnetState(rows: PredictSymbol[], symbol: string, price: number): MagnetState {
    const list = Array.isArray(rows) ? rows.filter((r) => r && r.signal) : []
    if (!list.length) return blank('collecting', 'Collecting data for magnet')
    const row = list.find((r) => r.symbol === symbol)
    if (!row) {
        const names = list.map((r) => short(r.symbol)).filter(Boolean)
        return blank('untracked', `Magnet is measured for ${names.join(' and ')} only`)
    }

    const hs = Array.isArray(row.horizons) ? row.horizons : []
    const proof = hs.map((h) => `${horizonLabel(h.horizonMs)} ${liftLabel(h)}`).join(' · ')
    const proven = hs.some((h) => !h.calibrating && Number(h.lift) >= 1.15)
    const measured = hs.some((h) => !h.calibrating)
    const verdict: MagnetState['verdict'] = proven ? 'proven' : measured ? 'no-edge' : 'calibrating'

    const s = row.signal
    if (s.side !== 'UP' && s.side !== 'DOWN') {
        return { ...blank('none', 'No magnet right now', String(s.reason || '')), proof, proven, verdict }
    }
    const arrow = s.side === 'UP' ? '↑' : '↓'
    const tp = Number(s.target && s.target.price)
    if (!s.target || !Number.isFinite(tp) || tp <= 0) {
        return {
            kind: 'direction', side: s.side, title: `Magnet ${arrow} ${s.side === 'UP' ? 'up' : 'down'}`,
            detail: 'no price cluster mapped yet — collecting data', proof, proven, verdict, target: null,
        }
    }

    // Distanta fata de pretul de ACUM. Cifra serverului e fata de pretul de la
    // ultimul lui calcul (ruleaza la cateva minute), deci ar ramane in urma.
    const p = Number(price) > 0 ? Number(price) : Number(row.price)
    const pct = p > 0 ? (tp / p - 1) * 100 : Number(s.target.pct) || 0
    const abs = p > 0 ? tp - p : null
    const parts = [`${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`]
    // zecimalele distantei urmeaza marimea PRETULUI, nu a distantei
    const dec = p >= 1000 ? 0 : p >= 100 ? 1 : p >= 1 ? 2 : 4
    if (abs !== null) {
        const d = Math.abs(abs)
        parts.push(`${abs >= 0 ? '+' : '−'}${dec === 0 ? Math.round(d).toLocaleString('en-US') : d.toFixed(dec)}`)
    }
    const usd = Number(s.target.usd) || 0, n = Number(s.target.n) || 0
    if (usd > 0) parts.push(`${fmtUsd(usd)} in ${n.toLocaleString('en-US')} liquidations`)
    parts.push(`strength ${Math.round(Number(s.strength) || 0)}`)
    return {
        kind: 'live', side: s.side, title: `Magnet ${arrow} ${fmtPx(tp)}`,
        detail: parts.join(' · '), proof, proven, verdict, target: { price: tp, pct, usd, n },
    }
}

/** Unde cade magnetul pe o axa de pret desenata (in % fata de pret). */
export function magnetOnAxis(pct: number, loPct: number, hiPct: number):
    { where: 'inside' | 'above' | 'below'; pct: number } | null {
    const v = Number(pct), lo = Number(loPct), hi = Number(hiPct)
    if (![v, lo, hi].every(Number.isFinite) || !(hi >= lo)) return null
    return { where: v > hi ? 'above' : v < lo ? 'below' : 'inside', pct: v }
}
