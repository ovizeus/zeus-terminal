// ═══════════════════════════════════════════════════════════════════════════
// FUSURI ORARE — lista de tari si verificarea numelor
// ═══════════════════════════════════════════════════════════════════════════
// [2026-11-15] „Schimb timezone si da engine error, trebuie refresh." Cauza:
// fereastra Chart Settings trimitea coduri scurte („RO", „US", „JP", „UK") ca
// fus orar. `Intl.DateTimeFormat` arunca RangeError la orice nume care nu e
// IANA, iar ora se formateaza peste tot (chart, jurnal, brain) — deci tot
// motorul cadea. Valoarea gresita se si salva in setari si revenea la pornire.
//
// Aici: lista de tari (cod, nume, fus IANA), un singur loc care spune daca un
// nume e valid, si traducerea codurilor vechi salvate in setari.

export type TzEntry = { code: string; country: string; tz: string; region: string }

export const DEFAULT_TZ = 'Europe/Bucharest'

export const TZ_LIST: TzEntry[] = [
    { code: 'UTC', country: 'UTC (Coordinated Universal Time)', tz: 'UTC', region: 'Global' },
    // Europa
    { code: 'RO', country: 'Romania', tz: 'Europe/Bucharest', region: 'Europe' },
    { code: 'MD', country: 'Moldova', tz: 'Europe/Chisinau', region: 'Europe' },
    { code: 'GB', country: 'United Kingdom', tz: 'Europe/London', region: 'Europe' },
    { code: 'IE', country: 'Ireland', tz: 'Europe/Dublin', region: 'Europe' },
    { code: 'PT', country: 'Portugal', tz: 'Europe/Lisbon', region: 'Europe' },
    { code: 'ES', country: 'Spain', tz: 'Europe/Madrid', region: 'Europe' },
    { code: 'FR', country: 'France', tz: 'Europe/Paris', region: 'Europe' },
    { code: 'BE', country: 'Belgium', tz: 'Europe/Brussels', region: 'Europe' },
    { code: 'NL', country: 'Netherlands', tz: 'Europe/Amsterdam', region: 'Europe' },
    { code: 'LU', country: 'Luxembourg', tz: 'Europe/Luxembourg', region: 'Europe' },
    { code: 'DE', country: 'Germany', tz: 'Europe/Berlin', region: 'Europe' },
    { code: 'CH', country: 'Switzerland', tz: 'Europe/Zurich', region: 'Europe' },
    { code: 'AT', country: 'Austria', tz: 'Europe/Vienna', region: 'Europe' },
    { code: 'IT', country: 'Italy', tz: 'Europe/Rome', region: 'Europe' },
    { code: 'MT', country: 'Malta', tz: 'Europe/Malta', region: 'Europe' },
    { code: 'DK', country: 'Denmark', tz: 'Europe/Copenhagen', region: 'Europe' },
    { code: 'NO', country: 'Norway', tz: 'Europe/Oslo', region: 'Europe' },
    { code: 'SE', country: 'Sweden', tz: 'Europe/Stockholm', region: 'Europe' },
    { code: 'FI', country: 'Finland', tz: 'Europe/Helsinki', region: 'Europe' },
    { code: 'EE', country: 'Estonia', tz: 'Europe/Tallinn', region: 'Europe' },
    { code: 'LV', country: 'Latvia', tz: 'Europe/Riga', region: 'Europe' },
    { code: 'LT', country: 'Lithuania', tz: 'Europe/Vilnius', region: 'Europe' },
    { code: 'PL', country: 'Poland', tz: 'Europe/Warsaw', region: 'Europe' },
    { code: 'CZ', country: 'Czechia', tz: 'Europe/Prague', region: 'Europe' },
    { code: 'SK', country: 'Slovakia', tz: 'Europe/Bratislava', region: 'Europe' },
    { code: 'HU', country: 'Hungary', tz: 'Europe/Budapest', region: 'Europe' },
    { code: 'SI', country: 'Slovenia', tz: 'Europe/Ljubljana', region: 'Europe' },
    { code: 'HR', country: 'Croatia', tz: 'Europe/Zagreb', region: 'Europe' },
    { code: 'RS', country: 'Serbia', tz: 'Europe/Belgrade', region: 'Europe' },
    { code: 'BA', country: 'Bosnia and Herzegovina', tz: 'Europe/Sarajevo', region: 'Europe' },
    { code: 'ME', country: 'Montenegro', tz: 'Europe/Podgorica', region: 'Europe' },
    { code: 'MK', country: 'North Macedonia', tz: 'Europe/Skopje', region: 'Europe' },
    { code: 'AL', country: 'Albania', tz: 'Europe/Tirane', region: 'Europe' },
    { code: 'BG', country: 'Bulgaria', tz: 'Europe/Sofia', region: 'Europe' },
    { code: 'GR', country: 'Greece', tz: 'Europe/Athens', region: 'Europe' },
    { code: 'CY', country: 'Cyprus', tz: 'Asia/Nicosia', region: 'Europe' },
    { code: 'TR', country: 'Turkey', tz: 'Europe/Istanbul', region: 'Europe' },
    { code: 'UA', country: 'Ukraine', tz: 'Europe/Kyiv', region: 'Europe' },
    { code: 'BY', country: 'Belarus', tz: 'Europe/Minsk', region: 'Europe' },
    { code: 'RU', country: 'Russia (Moscow)', tz: 'Europe/Moscow', region: 'Europe' },
    { code: 'GE', country: 'Georgia', tz: 'Asia/Tbilisi', region: 'Europe' },
    // America de Nord
    { code: 'US-E', country: 'United States — Eastern (New York)', tz: 'America/New_York', region: 'Americas' },
    { code: 'US-C', country: 'United States — Central (Chicago)', tz: 'America/Chicago', region: 'Americas' },
    { code: 'US-M', country: 'United States — Mountain (Denver)', tz: 'America/Denver', region: 'Americas' },
    { code: 'US-AZ', country: 'United States — Arizona (Phoenix)', tz: 'America/Phoenix', region: 'Americas' },
    { code: 'US-P', country: 'United States — Pacific (Los Angeles)', tz: 'America/Los_Angeles', region: 'Americas' },
    { code: 'US-AK', country: 'United States — Alaska', tz: 'America/Anchorage', region: 'Americas' },
    { code: 'US-HI', country: 'United States — Hawaii', tz: 'Pacific/Honolulu', region: 'Americas' },
    { code: 'CA-E', country: 'Canada — Eastern (Toronto)', tz: 'America/Toronto', region: 'Americas' },
    { code: 'CA-W', country: 'Canada — Pacific (Vancouver)', tz: 'America/Vancouver', region: 'Americas' },
    { code: 'MX', country: 'Mexico', tz: 'America/Mexico_City', region: 'Americas' },
    // America Centrala si de Sud
    { code: 'GT', country: 'Guatemala', tz: 'America/Guatemala', region: 'Americas' },
    { code: 'CR', country: 'Costa Rica', tz: 'America/Costa_Rica', region: 'Americas' },
    { code: 'PA', country: 'Panama', tz: 'America/Panama', region: 'Americas' },
    { code: 'DO', country: 'Dominican Republic', tz: 'America/Santo_Domingo', region: 'Americas' },
    { code: 'CO', country: 'Colombia', tz: 'America/Bogota', region: 'Americas' },
    { code: 'VE', country: 'Venezuela', tz: 'America/Caracas', region: 'Americas' },
    { code: 'EC', country: 'Ecuador', tz: 'America/Guayaquil', region: 'Americas' },
    { code: 'PE', country: 'Peru', tz: 'America/Lima', region: 'Americas' },
    { code: 'BO', country: 'Bolivia', tz: 'America/La_Paz', region: 'Americas' },
    { code: 'CL', country: 'Chile', tz: 'America/Santiago', region: 'Americas' },
    { code: 'AR', country: 'Argentina', tz: 'America/Argentina/Buenos_Aires', region: 'Americas' },
    { code: 'UY', country: 'Uruguay', tz: 'America/Montevideo', region: 'Americas' },
    { code: 'PY', country: 'Paraguay', tz: 'America/Asuncion', region: 'Americas' },
    { code: 'BR', country: 'Brazil (São Paulo)', tz: 'America/Sao_Paulo', region: 'Americas' },
    { code: 'BR-AM', country: 'Brazil — Amazon (Manaus)', tz: 'America/Manaus', region: 'Americas' },
    // Africa si Orientul Mijlociu
    { code: 'MA', country: 'Morocco', tz: 'Africa/Casablanca', region: 'Africa & Middle East' },
    { code: 'DZ', country: 'Algeria', tz: 'Africa/Algiers', region: 'Africa & Middle East' },
    { code: 'TN', country: 'Tunisia', tz: 'Africa/Tunis', region: 'Africa & Middle East' },
    { code: 'EG', country: 'Egypt', tz: 'Africa/Cairo', region: 'Africa & Middle East' },
    { code: 'NG', country: 'Nigeria', tz: 'Africa/Lagos', region: 'Africa & Middle East' },
    { code: 'GH', country: 'Ghana', tz: 'Africa/Accra', region: 'Africa & Middle East' },
    { code: 'KE', country: 'Kenya', tz: 'Africa/Nairobi', region: 'Africa & Middle East' },
    { code: 'ZA', country: 'South Africa', tz: 'Africa/Johannesburg', region: 'Africa & Middle East' },
    { code: 'IL', country: 'Israel', tz: 'Asia/Jerusalem', region: 'Africa & Middle East' },
    { code: 'JO', country: 'Jordan', tz: 'Asia/Amman', region: 'Africa & Middle East' },
    { code: 'LB', country: 'Lebanon', tz: 'Asia/Beirut', region: 'Africa & Middle East' },
    { code: 'SA', country: 'Saudi Arabia', tz: 'Asia/Riyadh', region: 'Africa & Middle East' },
    { code: 'QA', country: 'Qatar', tz: 'Asia/Qatar', region: 'Africa & Middle East' },
    { code: 'KW', country: 'Kuwait', tz: 'Asia/Kuwait', region: 'Africa & Middle East' },
    { code: 'BH', country: 'Bahrain', tz: 'Asia/Bahrain', region: 'Africa & Middle East' },
    { code: 'AE', country: 'United Arab Emirates', tz: 'Asia/Dubai', region: 'Africa & Middle East' },
    { code: 'OM', country: 'Oman', tz: 'Asia/Muscat', region: 'Africa & Middle East' },
    { code: 'IR', country: 'Iran', tz: 'Asia/Tehran', region: 'Africa & Middle East' },
    // Asia
    { code: 'AM', country: 'Armenia', tz: 'Asia/Yerevan', region: 'Asia' },
    { code: 'AZ', country: 'Azerbaijan', tz: 'Asia/Baku', region: 'Asia' },
    { code: 'KZ', country: 'Kazakhstan', tz: 'Asia/Almaty', region: 'Asia' },
    { code: 'UZ', country: 'Uzbekistan', tz: 'Asia/Tashkent', region: 'Asia' },
    { code: 'PK', country: 'Pakistan', tz: 'Asia/Karachi', region: 'Asia' },
    { code: 'IN', country: 'India', tz: 'Asia/Kolkata', region: 'Asia' },
    { code: 'LK', country: 'Sri Lanka', tz: 'Asia/Colombo', region: 'Asia' },
    { code: 'NP', country: 'Nepal', tz: 'Asia/Kathmandu', region: 'Asia' },
    { code: 'BD', country: 'Bangladesh', tz: 'Asia/Dhaka', region: 'Asia' },
    { code: 'MM', country: 'Myanmar', tz: 'Asia/Yangon', region: 'Asia' },
    { code: 'TH', country: 'Thailand', tz: 'Asia/Bangkok', region: 'Asia' },
    { code: 'VN', country: 'Vietnam', tz: 'Asia/Ho_Chi_Minh', region: 'Asia' },
    { code: 'KH', country: 'Cambodia', tz: 'Asia/Phnom_Penh', region: 'Asia' },
    { code: 'MY', country: 'Malaysia', tz: 'Asia/Kuala_Lumpur', region: 'Asia' },
    { code: 'SG', country: 'Singapore', tz: 'Asia/Singapore', region: 'Asia' },
    { code: 'ID', country: 'Indonesia (Jakarta)', tz: 'Asia/Jakarta', region: 'Asia' },
    { code: 'PH', country: 'Philippines', tz: 'Asia/Manila', region: 'Asia' },
    { code: 'CN', country: 'China', tz: 'Asia/Shanghai', region: 'Asia' },
    { code: 'HK', country: 'Hong Kong', tz: 'Asia/Hong_Kong', region: 'Asia' },
    { code: 'TW', country: 'Taiwan', tz: 'Asia/Taipei', region: 'Asia' },
    { code: 'MN', country: 'Mongolia', tz: 'Asia/Ulaanbaatar', region: 'Asia' },
    { code: 'KR', country: 'South Korea', tz: 'Asia/Seoul', region: 'Asia' },
    { code: 'JP', country: 'Japan', tz: 'Asia/Tokyo', region: 'Asia' },
    { code: 'RU-V', country: 'Russia — Far East (Vladivostok)', tz: 'Asia/Vladivostok', region: 'Asia' },
    // Oceania
    { code: 'AU-W', country: 'Australia — Western (Perth)', tz: 'Australia/Perth', region: 'Oceania' },
    { code: 'AU-C', country: 'Australia — Central (Adelaide)', tz: 'Australia/Adelaide', region: 'Oceania' },
    { code: 'AU-Q', country: 'Australia — Queensland (Brisbane)', tz: 'Australia/Brisbane', region: 'Oceania' },
    { code: 'AU-E', country: 'Australia — Eastern (Sydney)', tz: 'Australia/Sydney', region: 'Oceania' },
    { code: 'NZ', country: 'New Zealand', tz: 'Pacific/Auckland', region: 'Oceania' },
]

// Codurile scurte salvate de fereastra veche.
const LEGACY: Record<string, string> = {
    RO: 'Europe/Bucharest', UTC: 'UTC', US: 'America/New_York', NY: 'America/New_York',
    JP: 'Asia/Tokyo', TK: 'Asia/Tokyo', UK: 'Europe/London', LN: 'Europe/London',
}

const _valid = new Map<string, boolean>()
/** E un fus orar pe care browserul il stie? (`Intl` arunca la orice altceva.) */
export function isValidTz(tz: unknown): tz is string {
    if (typeof tz !== 'string' || !tz.trim()) return false
    const k = tz.trim()
    const hit = _valid.get(k)
    if (hit !== undefined) return hit
    let ok = false
    try { new Intl.DateTimeFormat('en-GB', { timeZone: k }).format(0); ok = true } catch { ok = false }
    _valid.set(k, ok)
    return ok
}

/** Orice valoare (veche, gresita, lipsa) → un fus valid. Nu arunca niciodata. */
export function normalizeTz(tz: unknown): string {
    if (typeof tz === 'string') {
        const t = tz.trim()
        if (Object.prototype.hasOwnProperty.call(LEGACY, t)) return LEGACY[t]
        if (isValidTz(t)) return t
    }
    return DEFAULT_TZ
}

/** Eticheta scurta din antetul chartului: codul tarii, sau „UTC+5:30" pentru un fus din afara listei. */
export function tzLabel(tz: unknown, now: number = Date.now()): string {
    const t = normalizeTz(tz)
    const e = TZ_LIST.find((x) => x.tz === t)
    if (e) return e.code
    return utcOffsetLabel(t, now)
}

/** „UTC+2", „UTC-3:30", „UTC" — fata de ora universala, acum (tine cont de ora de vara). */
export function utcOffsetLabel(tz: unknown, now: number = Date.now()): string {
    const t = normalizeTz(tz)
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: t, timeZoneName: 'shortOffset' }).formatToParts(new Date(now))
        const name = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT'
        const m = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(name)
        if (!m) return 'UTC'
        const h = Number(m[1]), min = m[2] ? ':' + m[2] : ''
        if (h === 0 && !m[2]) return 'UTC'
        return 'UTC' + (h >= 0 ? '+' : '') + h + min
    } catch { return 'UTC' }
}

/** Cautare dupa tara, cod sau fus. Fara text: toata lista. */
export function searchTz(q: string): TzEntry[] {
    const s = String(q || '').trim().toLowerCase()
    if (!s) return TZ_LIST
    return TZ_LIST.filter((e) => e.country.toLowerCase().includes(s) || e.code.toLowerCase() === s
        || e.code.toLowerCase().startsWith(s) || e.tz.toLowerCase().includes(s))
}
