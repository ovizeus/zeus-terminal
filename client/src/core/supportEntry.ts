// [2026-11-15] Pictograma de suport din antet (castile).
//
// Un utilizator obisnuit ajunge in fereastra lui de suport (chatul cu echipa).
// Adminul NU are un chat al lui: la el pictograma oglindeste casuta din Admin →
// Support / Ops — bulina arata cate mesaje de la utilizatori n-a citit, iar
// apasarea deschide direct sectiunea aceea (cerut de operator: „sa-mi apara sus
// in pictograma si daca dau click sa se deschida panoul din admin").
//
// Functii pure, ca regula „cine ce vede" sa poata fi tinuta de un test.

export type SupportTarget = { modal: 'adminPage'; section: 'support' } | { modal: 'support'; section: null }

export function supportTarget(role: string | null | undefined): SupportTarget {
    return role === 'admin' ? { modal: 'adminPage', section: 'support' } : { modal: 'support', section: null }
}

/** Ce numar sta pe pictograma: adminul vede mesajele necitite ale TUTUROR, un utilizator doar raspunsurile lui. */
export function supportBadge(role: string | null | undefined, adminUnread: number, userUnread: number): number {
    const n = role === 'admin' ? Number(adminUnread) : Number(userUnread)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

export function badgeText(n: number): string {
    return n > 99 ? '99+' : String(n)
}
