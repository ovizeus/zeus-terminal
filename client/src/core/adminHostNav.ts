// [2026-11-27] Admin pe subdomeniu separat (server/middleware/adminHostGate.js, pornit cu ADMIN_HOST).
// Cand e pornit, rutele de admin raspund doar acolo — deci iconita de admin trimite browserul acolo.
// Doar un nume de host curat devine adresa (nu orice text venit de la server).
export function adminTarget(adminHost: string | null | undefined, currentHost: string): string | null {
  const h = String(adminHost || '').trim().toLowerCase()
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) return null
  if (String(currentHost || '').toLowerCase() === h) return null
  return `https://${h}/`
}
