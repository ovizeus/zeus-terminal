// [2026-06-24] Client username validator — mirrors the server rule (3-20 chars, letters/digits/_).
export function validateUsername(s: string): boolean {
  return /^[a-zA-Z0-9_]{3,20}$/.test(s || '')
}
