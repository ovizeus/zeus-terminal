import { memo } from 'react'
import { useAresStore } from '../../../stores/aresStore'

/** IMM — Immortality score progress. Keeps id='ares-imm-span' as DOM anchor
 * for orderflow.ts ML badge placement. */
export const ImmSpan = memo(function ImmSpan() {
  const pct = useAresStore((s) => s.ui.immPct)
  return <span id="ares-imm-span"> · IMM {pct.toFixed(1)}%</span>
})
