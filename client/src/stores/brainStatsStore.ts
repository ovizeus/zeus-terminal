// Zeus — stores/brainStatsStore.ts
// [ZT5-A] Store for the circuit-brain stats summary nodes in BrainCockpit.
// Populated by engine/brain.ts::renderCircuitBrain() and consumed by
// components/brain/BrainCockpit.tsx for the hidden cbn-* compat divs and any
// future visible consumers.
//
// Slices defined in ZT5-A: gates, regime, risk, auto.
// Follow-up sub-lots may extend this store with score/data/neurons/arm.

import { create } from 'zustand'

export type BrainStatsTone = 'ok' | 'warn' | 'bad' | 'mem' | 'vis' | 'neutral'

export interface BrainStatsNode {
  text: string
  sub: string
  tone: BrainStatsTone
}

export interface BrainInnerValues {
  flow: string
  vol: string
  struct: string
  liq: string
  risk: string
  volat: string
}

export interface BrainCenterOverlay {
  mode: string
  regime: string
  scoreText: string
  scoreTone: 'ok' | 'warn' | 'bad'
  scoreColor: string
}

export interface BrainArmDetail {
  mode: string
  profile: string
  score: string
  trigger: string
  tf: string
  cooldown: string
  gatesSummary: string
  modeArmed: boolean
  scoreArmed: boolean
  triggerActive: boolean
  cooldownReady: boolean
}

export interface BrainReceipt {
  mode: string
  score: string
  trigger: string
  tf: string
}

export interface BrainArmBadge {
  text: string
  cls: string
}

export interface BrainRegimeBadge {
  innerHtml: string
  cls: string
}

export interface BrainOfi {
  buyPct: number
  sellPct: number
}

// [BUG-D-2 FIX 2026-05-14] BrainForecast interface removed — pure dead code.
// QForecastBlock (consumer) was removed în BUG-D-1 (2026-05-07); this type
// had zero remaining consumers. Companion removal: renderQForecast IIFE
// în brain.ts:2022 + `forecast` field în BrainStatsSnapshot + initial state.

export interface BrainWhy {
  stateText: string
  stateCls: string
  whyList: string[]
  riskList: string[]
}

export type BrainNeuronState = 'ok' | 'fail' | 'wait' | 'inactive'
export type BrainNeuronId = 'rsi' | 'macd' | 'st' | 'vol' | 'fr' | 'mag' | 'reg' | 'ofi'
export interface BrainNeuronCell {
  state: BrainNeuronState
  val: string
}
export type BrainNeurons = Record<BrainNeuronId, BrainNeuronCell>

export const BRAIN_NEURON_IDS: readonly BrainNeuronId[] = ['rsi', 'macd', 'st', 'vol', 'fr', 'mag', 'reg', 'ofi']

export interface BrainStatsSnapshot {
  gates: BrainStatsNode
  regime: BrainStatsNode
  risk: BrainStatsNode
  auto: BrainStatsNode
  inner: BrainInnerValues
  center: BrainCenterOverlay
  arm: BrainArmDetail
  receipt: BrainReceipt
  armBadge: BrainArmBadge
  regimeBadge2: BrainRegimeBadge
  regimeDetail: string
  ofi: BrainOfi
  why: BrainWhy
  neurons: BrainNeurons
}

const emptyNode: BrainStatsNode = { text: '—', sub: '—', tone: 'neutral' }

const emptyInner: BrainInnerValues = {
  flow: '—', vol: '—', struct: '—', liq: '—', risk: '—', volat: '—',
}

const emptyCenter: BrainCenterOverlay = {
  mode: 'MANUAL', regime: '—', scoreText: '—', scoreTone: 'bad', scoreColor: '#ff3355',
}

const emptyArm: BrainArmDetail = {
  mode: 'MANUAL', profile: 'FAST', score: '—', trigger: '—', tf: '—', cooldown: 'READY',
  gatesSummary: 'Gates: —/— OK',
  modeArmed: false, scoreArmed: false, triggerActive: false, cooldownReady: true,
}

const emptyReceipt: BrainReceipt = { mode: '—', score: '—', trigger: '—', tf: '—' }

const emptyArmBadge: BrainArmBadge = { text: 'SCANNING', cls: 'znc-arm-badge scanning' }

const emptyRegimeBadge: BrainRegimeBadge = { innerHtml: 'LOADING ▲', cls: 'znc-regime-val unknown' }

const emptyNeurons: BrainNeurons = {
  rsi: { state: 'inactive', val: '—' },
  macd: { state: 'inactive', val: '—' },
  st: { state: 'inactive', val: '—' },
  vol: { state: 'inactive', val: '—' },
  fr: { state: 'inactive', val: '—' },
  mag: { state: 'inactive', val: '—' },
  reg: { state: 'inactive', val: '—' },
  ofi: { state: 'inactive', val: '—' },
}

export const emptyBrainStatsSnapshot: BrainStatsSnapshot = {
  gates: emptyNode,
  regime: emptyNode,
  risk: emptyNode,
  auto: emptyNode,
  inner: emptyInner,
  center: emptyCenter,
  arm: emptyArm,
  receipt: emptyReceipt,
  armBadge: emptyArmBadge,
  regimeBadge2: emptyRegimeBadge,
  regimeDetail: 'ADX: — | VOL: — | STRUCT: —',
  ofi: { buyPct: 50, sellPct: 50 },
  why: { stateText: 'WAIT', stateCls: 'bw-state wait', whyList: [], riskList: [] },
  neurons: emptyNeurons,
}

interface BrainStatsStoreState {
  snapshot: BrainStatsSnapshot
  setSnapshot: (s: BrainStatsSnapshot) => void
  patchStats: (p: Partial<BrainStatsSnapshot>) => void
  patchNeuron: (id: BrainNeuronId, cell: BrainNeuronCell) => void
}

export const useBrainStatsStore = create<BrainStatsStoreState>((set) => ({
  snapshot: emptyBrainStatsSnapshot,
  setSnapshot: (snapshot) => set({ snapshot }),
  patchStats: (p) => set((st) => ({ snapshot: { ...st.snapshot, ...p } })),
  patchNeuron: (id, cell) =>
    set((st) => ({
      snapshot: {
        ...st.snapshot,
        neurons: { ...st.snapshot.neurons, [id]: cell },
      },
    })),
}))
