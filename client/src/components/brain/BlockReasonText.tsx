import { useBrainStore } from '../../stores/brainStore'

/**
 * [R30] Subscriber component for the #zad-block-reason pill inside
 * BrainCockpit. Source is brainStore.blockReasonDisplay, written by
 * engine/brain.ts top-reason logic every brain cycle.
 *
 * Parent (BrainCockpit) is memo'd and treated as a static DOM shell — this
 * child is the only thing that re-renders on blockReasonDisplay change, so
 * the shell's engine-owned DOM writes are not disturbed.
 */
export function BlockReasonText() {
  const disp = useBrainStore((s) => s.blockReasonDisplay)
  const text = disp?.text ?? 'AUTO WAIT: Initializing...'
  const className = disp?.className ?? 'znc-block-reason wait'
  return <div className={className} id="zad-block-reason">{text}</div>
}
