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

export interface BrainForecast {
  mainText: string
  mainCls: string
  rangeText: string
  stateText: string
}

export interface BrainWhy {
  stateText: string
  stateCls: string
  whyList: string[]
  riskList: string[]
}

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
  forecast: BrainForecast
  why: BrainWhy
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
  forecast: { mainText: 'Neutral (0)', mainCls: 'bf-main neut', rangeText: '—', stateText: '—' },
  why: { stateText: 'WAIT', stateCls: 'bw-state wait', whyList: [], riskList: [] },
}

interface BrainStatsStoreState {
  snapshot: BrainStatsSnapshot
  setSnapshot: (s: BrainStatsSnapshot) => void
  patchStats: (p: Partial<BrainStatsSnapshot>) => void
}

export const useBrainStatsStore = create<BrainStatsStoreState>((set) => ({
  snapshot: emptyBrainStatsSnapshot,
  setSnapshot: (snapshot) => set({ snapshot }),
  patchStats: (p) => set((st) => ({ snapshot: { ...st.snapshot, ...p } })),
}))
