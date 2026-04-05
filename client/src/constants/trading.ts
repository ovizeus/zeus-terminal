/**
 * Zeus Terminal — Trading constants (ported from public/js/core/constants.js)
 * Exposes: MACRO_MULT, STALL_GRACE_MS, GATE_DEFS
 */

export const MACRO_MULT: Record<string, { long: number; short: number; risk: number; exitRisk: number }> = {
  ACCUMULATION: { long: 1.25, short: 0.60, risk: 1.20, exitRisk: 0.85 },
  EARLY_BULL:   { long: 1.15, short: 0.80, risk: 1.10, exitRisk: 0.95 },
  LATE_BULL:    { long: 0.95, short: 1.05, risk: 0.95, exitRisk: 1.10 },
  DISTRIBUTION: { long: 0.75, short: 1.15, risk: 0.80, exitRisk: 1.20 },
  TOP_RISK:     { long: 0.60, short: 1.25, risk: 0.65, exitRisk: 1.35 },
  NEUTRAL:      { long: 1.00, short: 1.00, risk: 1.00, exitRisk: 1.00 },
}

export const STALL_GRACE_MS = 20000

export interface GateDef {
  id: string
  label: string
  required: boolean
}

export const GATE_DEFS: GateDef[] = [
  { id: 'regime',      label: 'REGIME OK',         required: true  },
  { id: 'mtf',         label: 'MTF ALIGN OK',      required: true  },
  { id: 'volume',      label: 'VOLUME CONFIRM OK', required: true  },
  { id: 'oi',          label: 'OI CONFIRM OK',     required: false },
  { id: 'orderflow',   label: 'ORDERFLOW OK',      required: true  },
  { id: 'sweep',       label: 'SWEEP/RECLAIM OK',  required: false },
  { id: 'displacement', label: 'DISPLACEMENT OK',  required: false },
  { id: 'session',     label: 'SESSION OK',        required: true  },
  { id: 'spread',      label: 'SPREAD/SLIP OK',    required: false },
  { id: 'cooldown',    label: 'COOLDOWN OFF',      required: true  },
  { id: 'risk',        label: 'RISK LIMITS OK',    required: true  },
  { id: 'news',        label: 'NEWS RISK OK',      required: true  },
]
