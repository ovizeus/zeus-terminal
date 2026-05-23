// Zeus — stores/mtfStore.ts
// [ZT3-A] Option A store for MTFPanel (Master Zero-Tail Close Plan v2)
// Snapshot written by engine/mtfSync.ts (bridged from BM.structure / BM.liqCycle /
// BM.regimeEngine / BM.phaseFilter) and consumed by components/dock/MTFPanel.tsx.
// Keeps the MTFPanel decoupled from document.getElementById writes performed by
// legacy renderMTFPanel().

import { create } from 'zustand'

export type MTFTone = '' | 'good' | 'warn' | 'bad'
export type MTFDir = 'bull' | 'bear' | 'neut'

export interface MTFCell {
  text: string
  tone: MTFTone
}

export interface MTFSnapshot {
  regime: MTFCell
  structure: MTFCell
  atrPct: MTFCell
  volMode: MTFCell
  squeeze: MTFCell & { html?: boolean }
  adx: MTFCell
  volRegime: MTFCell
  volPct: MTFCell
  sweep: MTFCell
  trapRate: MTFCell
  magnetAbove: MTFCell
  magnetBelow: MTFCell
  magnetBias: MTFCell
  align: Record<'15m' | '1h' | '4h', { dir: MTFDir; text: string }>
  score: number
  scoreText: string
  updatedAt: number | null
  updatedText: string

  re: { regime: MTFCell; trapRisk: MTFCell; confidence: MTFCell }
  pf: { phase: MTFCell; riskMode: MTFCell; sizeMultiplier: MTFCell }
}

export const emptyMTFCell: MTFCell = { text: '\u2014', tone: '' }

const emptyAlign: MTFSnapshot['align'] = {
  '15m': { dir: 'neut', text: '15m \u2014' },
  '1h': { dir: 'neut', text: '1h \u2014' },
  '4h': { dir: 'neut', text: '4h \u2014' },
}

export const emptyMTFSnapshot: MTFSnapshot = {
  regime: emptyMTFCell,
  structure: emptyMTFCell,
  atrPct: emptyMTFCell,
  volMode: emptyMTFCell,
  squeeze: { text: 'OFF', tone: '' },
  adx: emptyMTFCell,
  volRegime: emptyMTFCell,
  volPct: emptyMTFCell,
  sweep: emptyMTFCell,
  trapRate: emptyMTFCell,
  magnetAbove: emptyMTFCell,
  magnetBelow: emptyMTFCell,
  magnetBias: emptyMTFCell,
  align: emptyAlign,
  score: 0,
  scoreText: '0 / 100',
  updatedAt: null,
  updatedText: '\u2014 actualizat la \u2014',
  re: { regime: emptyMTFCell, trapRisk: emptyMTFCell, confidence: emptyMTFCell },
  pf: { phase: emptyMTFCell, riskMode: emptyMTFCell, sizeMultiplier: emptyMTFCell },
}

interface MTFStoreState {
  snapshot: MTFSnapshot
  setSnapshot: (s: MTFSnapshot) => void
}

export const useMTFStore = create<MTFStoreState>((set) => ({
  snapshot: emptyMTFSnapshot,
  setSnapshot: (snapshot) => set({ snapshot }),
}))
