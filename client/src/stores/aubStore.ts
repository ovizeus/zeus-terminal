import { create } from 'zustand'

export interface AUBCompatItem { ok: boolean; label: string }
export interface AUBMacroItem { label: string; when: string; riskPct: number; impact: string }
export interface AUBSimResult { sl: number; rr: number; score: number; wins: number; total: number }

interface AUBStoreState {
  expanded: boolean
  sfxEnabled: boolean

  compatOk: boolean
  compatItems: AUBCompatItem[]

  guardCount: number
  guardLast: string

  perfHeavy: boolean
  rafFps: number
  domSkips: number

  dataLabel: string
  dataClass: string

  bbCount: number
  bbLast: string

  mtf: { '5m': number; '15m': number; '1h': number; '4h': number }
  mtfPenalty: string

  corrEth: string
  corrSol: string
  corrPenalty: boolean
  corrPenaltyText: string

  macroItems: AUBMacroItem[] | null

  simStatus: string
  simLast: string
  simResult: AUBSimResult | null
  simShowApply: boolean

  patch: (partial: Partial<Omit<AUBStoreState, 'patch'>>) => void
}

export const useAUBStore = create<AUBStoreState>()((set) => ({
  expanded: false,
  sfxEnabled: false,

  compatOk: true,
  compatItems: [],

  guardCount: 0,
  guardLast: '—',

  perfHeavy: false,
  rafFps: 0,
  domSkips: 0,

  dataLabel: 'DATA: WAIT',
  dataClass: 'info',

  bbCount: 0,
  bbLast: 'Last: —',

  mtf: { '5m': 0, '15m': 0, '1h': 0, '4h': 0 },
  mtfPenalty: 'Penalty: none',

  corrEth: '—',
  corrSol: '—',
  corrPenalty: false,
  corrPenaltyText: 'Penalty: inactive',

  macroItems: null,

  simStatus: 'Status: Idle',
  simLast: 'Last run: never',
  simResult: null,
  simShowApply: false,

  patch: (partial) => set((s) => ({ ...s, ...partial })),
}))
