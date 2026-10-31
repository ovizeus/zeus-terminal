// Zeus — liqmap/ranges.ts
//
// [RANGE 2026-10-31] Cererea lui: „poti face pe timeframe de 24h, 7 zile ca la
// coinglass si 4 ore?".
//
// Intervalul calatoreste spre server ca ZILE, zecimale — `liqStore` il inmulteste
// cu lungimea unei zile, deci sub-ziua merge fara nicio schimbare pe server
// (dovedit in tests/unit/liq-subday-range.test.js, pe toate cele patru functii
// care primesc `days`).
//
// Eticheta NU poate fi `${days}D`: patru ore ar scrie „0.16666666666666666D".

export const RANGES: { label: string; days: number }[] = [
    { label: '4H', days: 4 / 24 },
    { label: '24H', days: 1 },
    { label: '7D', days: 7 },
    { label: '30D', days: 30 },
    { label: '90D', days: 90 },
]

/**
 * Eticheta unui interval. Sub o zi se scrie în ore, de la o zi în sus în zile,
 * iar o zi fix se scrie `24H` — la fel ca pe Coinglass, şi la fel ca butonul.
 * Un interval fără sens nu primeşte etichetă inventată.
 */
export function rangeLabel(days: number | null | undefined): string {
    const d = Number(days)
    if (!Number.isFinite(d) || d <= 0) return '—'
    if (d < 1) return Math.round(d * 24) + 'H'
    if (d === 1) return '24H'
    return Math.round(d) + 'D'
}
