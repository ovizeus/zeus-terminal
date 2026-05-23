// Zeus — stores/qexitRiskStore.ts
// [ZT4-A] Option A store for the EXIT RISK strip (qexit-risk-strip) inside
// the Scenario Engine section. Populated by engine/forecast.ts::syncQexitRiskStore
// and consumed by components/analysis/AnalysisSections.tsx.

import { create } from 'zustand'

export type QexitAction = 'HOLD' | 'TIGHTEN' | 'REDUCE' | 'EMERGENCY'

export interface QexitSignalRow {
  name: string
  valueHtml: string
}

export interface QexitRiskSnapshot {
  visible: boolean
  risk: number
  action: QexitAction
  fillColor: string
  valueColor: string
  signals: QexitSignalRow[]
  advisoryHtml: string
  advisoryColor: string
}

export const emptyQexitRiskSnapshot: QexitRiskSnapshot = {
  visible: false,
  risk: 0,
  action: 'HOLD',
  fillColor: '#556677',
  valueColor: '#556677',
  signals: [],
  advisoryHtml: 'Advisory mode &mdash; auto-exec disabled.',
  advisoryColor: '#556677',
}

interface QexitRiskStoreState {
  snapshot: QexitRiskSnapshot
  setSnapshot: (s: QexitRiskSnapshot) => void
}

export const useQexitRiskStore = create<QexitRiskStoreState>((set) => ({
  snapshot: emptyQexitRiskSnapshot,
  setSnapshot: (snapshot) => set({ snapshot }),
}))
