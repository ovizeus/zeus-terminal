// [2026-06-24] Avatar helpers for the flip-header profile.
// reencodeAvatar: re-draw an uploaded image through a canvas and re-export as a clean PNG.
// The canvas re-export keeps ONLY pixels — EXIF/metadata/any embedded payload ("malware-in-image",
// polyglot files) cannot survive, so the stored avatar is sterile. Also square-crops + resizes to 128px.
export function reencodeAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith('image/')) return reject(new Error('not an image'))
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const side = Math.min(img.width, img.height)
      const sx = (img.width - side) / 2, sy = (img.height - side) / 2
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128
      const ctx = cv.getContext('2d'); if (!ctx) return reject(new Error('no canvas ctx'))
      ctx.drawImage(img, sx, sy, side, side, 0, 0, 128, 128)
      resolve(cv.toDataURL('image/png'))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')) }
    img.src = url
  })
}

// initialsAvatar: a coloured circle with up to 2 initials — the fallback when no photo is set.
export function initialsAvatar(name: string, color: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  const ini = parts.length ? parts.slice(0, 2).map(p => p[0].toUpperCase()).join('') : '?'
  const c = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#888'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><circle cx="64" cy="64" r="64" fill="${c}"/><text x="64" y="84" font-size="52" font-family="monospace" fill="#0a0a0a" text-anchor="middle" font-weight="700">${ini}</text></svg>`
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}
