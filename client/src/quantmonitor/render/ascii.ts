// QM ASCII helpers — 1:1 from HTML
const w = window as any

export function bar(v: number, mx: number, width: number): string {
  const f = Math.round(v / mx * width)
  return '\u2588'.repeat(Math.max(0, f)) + '\u2591'.repeat(Math.max(0, width - f))
}

export function binLine(width: number): string {
  let s = ''
  for (let i = 0; i < width; i++) { s += Math.random() > 0.5 ? '1' : '0'; if ((i + 1) % 4 === 0) s += ' '; if ((i + 1) % 32 === 0) s += ' ' }
  return s
}

export function fmtUSD(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K'
  return v.toFixed(0)
}

export function heatBarOB(val: number, width: number, side: string): string {
  let s = ''
  for (let i = 0; i < width; i++) {
    if (i / width < val) {
      const int = i / (val * width)
      if (side === 'bid') {
        if (int > 0.85) s += '<span class="h5">\u2588</span>'; else if (int > 0.65) s += '<span class="h4">\u2588</span>'
        else if (int > 0.45) s += '<span class="h3">\u2593</span>'; else if (int > 0.2) s += '<span class="h2">\u2592</span>'
        else s += '<span class="h1">\u2591</span>'
      } else {
        if (int > 0.85) s += '<span class="a5">\u2588</span>'; else if (int > 0.65) s += '<span class="a4">\u2588</span>'
        else if (int > 0.45) s += '<span class="a3">\u2593</span>'; else if (int > 0.2) s += '<span class="a2">\u2592</span>'
        else s += '<span class="a1">\u2591</span>'
      }
    } else s += '<span class="d">\u00B7</span>'
  }
  return s
}

export function asciiChart(W: number, H: number): string[] {
  const kl = w.S?.klines || []
  const data = kl.slice(-W)
  if (data.length < 3) return Array(H).fill(' '.repeat(W + 9))
  const ap = data.flatMap((d: any) => [d.h, d.l])
  const mn = Math.min(...ap), mx = Math.max(...ap), rng = mx - mn || 1
  const g = Array.from({ length: H }, () => Array(data.length).fill(' '))
  data.forEach((cd: any, x: number) => {
    const mp = (v: number) => Math.round((v - mn) / rng * (H - 1))
    const oY = mp(cd.o), cY = mp(cd.c), hY = mp(cd.h), lY = mp(cd.l)
    for (let y = lY; y <= hY; y++) g[H - 1 - y][x] = '|'
    const t = Math.max(oY, cY), b2 = Math.min(oY, cY)
    for (let y = b2; y <= t; y++) g[H - 1 - y][x] = cd.c >= cd.o ? '\u2588' : '\u2591'
    if (t === b2) g[H - 1 - oY][x] = cd.c >= cd.o ? '\u2593' : '\u2592'
  })
  return g.map((r, i) => { const p = mx - (i / (H - 1)) * rng; return p.toFixed(0).padStart(8) + ' |' + r.join('') })
}

export function cvdChart(): string {
  const dh = w.S?._qmDeltaHist || []
  if (dh.length < 3) return '  <span class="dg">Accumulating...</span>'
  const mn = Math.min(...dh), mx = Math.max(...dh), rng = mx - mn || 1
  const H = 4, W = Math.min(dh.length, 40), data = dh.slice(-W)
  const g = Array.from({ length: H }, () => Array(W).fill(' '))
  data.forEach((v: number, x: number) => { const y = Math.round((v - mn) / rng * (H - 1)); for (let j = 0; j <= y; j++) g[H - 1 - j][x] = v >= 0 ? '\u2593' : '\u2591' })
  return g.map((r: string[]) => '  ' + r.map(ch => ch === '\u2593' ? '<span class="g">' + ch + '</span>' : ch === '\u2591' ? '<span class="r">' + ch + '</span>' : '<span class="d">\u00B7</span>').join('')).join('\n')
}
