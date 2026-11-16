// ═══════════════════════════════════════════════════════════════════════════
// AUTOTRENDLINE — evantaie de linii de trend trase singure din pivoti reali
// ═══════════════════════════════════════════════════════════════════════════
// [2026-11-16] Cerut de operator cu capturi TradingView („Tori Trades"): din
// fundul major pornesc mai multe linii verzi spre minimele urmatoare, tot mai
// abrupte; din varful major, linii rosii spre maximele urmatoare. Toate
// prelungite pana la bara curenta. Fata de ARACHNE (o linie prin doi pivoti, cu
// etichete si niveluri), aici desenul e EVANTAIUL.
//
// Reguli (aceleasi lectii ca ARACHNE):
//  • ancora e un pivot MAJOR inca neatins: niciun minim de dupa el nu a coborat
//    sub el (pentru suport) / niciun maxim nu a trecut peste el (rezistenta);
//  • principiul evantaiului: linia leaga ancora de un pivot ulterior si e valida
//    cat timp pretul NU a rupt-o DUPA acel pivot (cu o toleranta mica, in ATR).
//    Intre ancora si pivot pretul poate trece de ea — asa arata evantaiul din
//    capturi: liniile tot mai abrupte taie valurile de dinainte;
//  • barele de la capete nu pot fi pivoti (nu au confirmare).
import { findPivots } from './indicatorCalcArachne'

export interface AutoLine {
    kind: 'support' | 'resistance'
    fromIndex: number          // ancora
    toIndex: number            // al doilea pivot care defineste linia
    slope: number
    intercept: number
    touches: number            // pivoti minori aflati pe linie (in toleranta)
}
export interface AutoTrend { lines: AutoLine[]; anchors: Array<{ index: number; price: number; kind: 'high' | 'low' }> }

export interface AutoTrendOpts {
    majorWidth?: number        // latimea pivotului major (ancora)
    minorWidth?: number        // latimea pivotilor prin care trec liniile
    anchorsPerSide?: number
    linesPerAnchor?: number
    tolAtr?: number
    minSlopeGap?: number       // doua linii din aceeasi ancora cu pante prea apropiate = una
}

export const lineAt = (l: { slope: number; intercept: number }, i: number): number => l.slope * i + l.intercept

function atr(highs: number[], lows: number[], n = 14): number {
    const k = Math.min(n, highs.length)
    if (!k) return 0
    let s = 0
    for (let i = highs.length - k; i < highs.length; i++) s += Math.max(0, highs[i] - lows[i])
    return s / k
}

export function autoTrendlines(highs: number[], lows: number[], opts: AutoTrendOpts = {}): AutoTrend {
    const n = Math.min(highs?.length || 0, lows?.length || 0)
    const majorW = Math.max(2, Math.round(opts.majorWidth ?? 8))
    const minorW = Math.max(1, Math.round(opts.minorWidth ?? 3))
    const aPer = Math.max(1, Math.round(opts.anchorsPerSide ?? 2))
    const lPer = Math.max(1, Math.round(opts.linesPerAnchor ?? 3))
    const gap = Math.max(0, opts.minSlopeGap ?? 0.15)
    const tol = Math.max(0, opts.tolAtr ?? 0.15) * atr(highs, lows)
    const out: AutoTrend = { lines: [], anchors: [] }
    if (n < majorW * 2 + 3) return out

    const major = findPivots(highs, lows, majorW)
    const minor = findPivots(highs, lows, minorW)

    const side = (kind: 'support' | 'resistance') => {
        const isSup = kind === 'support'
        const pk = isSup ? 'low' : 'high'
        const series = isSup ? lows : highs
        // Ancore: pivoti majori inca neatinsi, cei mai recenti intai.
        const unbroken = major.filter((p) => p.kind === pk).filter((a) => {
            for (let i = a.index + 1; i < n; i++) {
                if (isSup ? series[i] < a.price - tol : series[i] > a.price + tol) return false
            }
            return true
        })
        // Fundul (varful) cel mai extrem intra MEREU — din el porneste evantaiul din
        // capturi; apoi cele mai recente, pana la `aPer`.
        const extreme = unbroken.slice().sort((x, y) => isSup ? x.price - y.price : y.price - x.price)[0]
        const anchors = (extreme ? [extreme] : []).concat(
            unbroken.filter((x) => x !== extreme).sort((x, y) => y.index - x.index),
        ).slice(0, aPer)

        for (const a of anchors) {
            out.anchors.push(a)
            const cands: AutoLine[] = []
            for (const b of minor) {
                if (b.kind !== pk || b.index <= a.index + minorW) continue
                if (isSup ? !(b.price > a.price) : !(b.price < a.price)) continue
                const slope = (b.price - a.price) / (b.index - a.index)
                const line = { slope, intercept: a.price - slope * a.index }
                // Dupa al doilea pivot pretul nu are voie sa fi rupt linia.
                let ok = true
                for (let i = b.index + 1; i < n; i++) {
                    const v = lineAt(line, i)
                    if (isSup ? series[i] < v - tol : series[i] > v + tol) { ok = false; break }
                }
                if (!ok) continue
                let touches = 1
                for (const m of minor) {
                    if (m.kind !== pk || m.index <= a.index) continue
                    if (Math.abs(m.price - lineAt(line, m.index)) <= Math.max(tol, 1e-9)) touches++
                }
                cands.push({ kind, fromIndex: a.index, toIndex: b.index, ...line, touches })
            }
            // Evantaiul: cele mai recente atingeri intai, fara pante aproape identice.
            cands.sort((x, y) => y.toIndex - x.toIndex || y.touches - x.touches)
            const picked: AutoLine[] = []
            for (const c of cands) {
                if (picked.length >= lPer) break
                const near = picked.some((p) => {
                    const ref = Math.max(Math.abs(p.slope), Math.abs(c.slope), 1e-12)
                    return Math.abs(p.slope - c.slope) / ref < gap
                })
                if (!near) picked.push(c)
            }
            out.lines.push(...picked)
        }
    }
    side('support')
    side('resistance')
    return out
}
