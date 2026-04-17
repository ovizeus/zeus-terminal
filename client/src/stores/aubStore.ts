import { create } from 'zustand'

interface AUBStoreState {
  expanded: boolean
  sfxEnabled: boolean

  compatOk: boolean
  compatRows: string

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

  macroHtml: string

  simStatus: string
  simLast: string
  simResultHtml: string | null
  simShowApply: boolean

  patch: (partial: Partial<Omit<AUBStoreState, 'patch'>>) => void
}

export const useAUBStore = create<AUBStoreState>()((set) => ({
  expanded: false,
  sfxEnabled: false,

  compatOk: true,
  compatRows: '',

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

  macroHtml: '<div class="aub-row">No events loaded</div>',

  simStatus: 'Status: Idle',
  simLast: 'Last run: never',
  simResultHtml: null,
  simShowApply: false,

  patch: (partial) => set((s) => ({ ...s, ...partial })),
}))
