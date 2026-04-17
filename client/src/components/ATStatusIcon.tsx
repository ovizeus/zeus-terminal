/**
 * AT status icon — small JSX-native renderer for the subset of _ZI icons
 * used inside AutoTradePanel status / mode / sentinel / log rows.
 * Keeps `dangerouslySetInnerHTML` out of the panel entirely.
 */

export type ATIconKind =
  | 'w' | 'x' | 'ok' | 'bolt' | 'siren' | 'lock' | 'pad'
  | 'mag' | 'timer' | 'clock' | 'bellX' | 'noent'
  | 'dRed' | 'dGrn' | 'dYlw' | 'dPur'

export function ATStatusIcon({ kind }: { kind: ATIconKind | null | undefined }) {
  if (!kind) return null
  switch (kind) {
    case 'dRed': return <span className="z-dot z-dot--red" />
    case 'dGrn': return <span className="z-dot z-dot--grn" />
    case 'dYlw': return <span className="z-dot z-dot--ylw" />
    case 'dPur': return <span className="z-dot z-dot--pur" />
    case 'w':     return svg('M8 2L1 14h14L8 2zM8 6v4m0 2h.01')
    case 'x':     return svg('M4 4l8 8m0-8l-8 8')
    case 'ok':    return svg('M3 8l4 4 6-8')
    case 'bolt':  return svg('M9 1L4 9h4l-1 6 5-8H8l1-6')
    case 'siren': return svg('M8 1v2m5 2l-1.4 1.4M3 5l1.4 1.4M2 10h2m8 0h2M5 13h6M6 10a2 2 0 014 0')
    case 'lock':  return svg('M5 7V5a3 3 0 016 0v2m-8 0h10v7H3V7z')
    case 'pad':   return svg('M4 5h8v7H4zM6 3h4v2H6zM6 8v2m4-2v2m-5 3h6')
    case 'mag':   return svg('M3 4l5-3 5 3v7l-5 3-5-3V4z')
    case 'timer': return svg('M8 1v2m0 0a5 5 0 100 10A5 5 0 008 3zm0 2v3l2 1')
    case 'clock': return svg('M8 2a6 6 0 100 12A6 6 0 008 2zm0 3v3l2 2')
    case 'bellX': return svg('M8 2a4 4 0 00-4 4c0 4-2 5-2 6h12s-2-2-2-6a4 4 0 00-4-4zM4 4l8 8')
    case 'noent': return svg('M8 2a6 6 0 100 12A6 6 0 008 2zM4 8h8')
  }
}

function svg(d: string) {
  return (
    <svg className="z-i" viewBox="0 0 16 16">
      <path d={d} />
    </svg>
  )
}
