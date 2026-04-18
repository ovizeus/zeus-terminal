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

export interface BrainStatsSnapshot {
  gates: BrainStatsNode
  regime: BrainStatsNode
  risk: BrainStatsNode
  auto: BrainStatsNode
  inner: BrainInnerValues
  center: BrainCenterOverlay
}

const emptyNode: BrainStatsNode = { text: '—', sub: '—', tone: 'neutral' }

const emptyInner: BrainInnerValues = {
  flow: '—', vol: '—', struct: '—', liq: '—', risk: '—', volat: '—',
}

const emptyCenter: BrainCenterOverlay = {
  mode: 'MANUAL', regime: '—', scoreText: '—', scoreTone: 'bad', scoreColor: '#ff3355',
}

export const emptyBrainStatsSnapshot: BrainStatsSnapshot = {
  gates: emptyNode,
  regime: emptyNode,
  risk: emptyNode,
  auto: emptyNode,
  inner: emptyInner,
  center: emptyCenter,
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
