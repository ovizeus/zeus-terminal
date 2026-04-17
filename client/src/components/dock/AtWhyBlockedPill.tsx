import { useBrainStore } from '../../stores/brainStore'
import { ATStatusIcon } from '../ATStatusIcon'

/**
 * [R30] Subscriber for the #at-why-blocked pill in AutoTradePanel. Source is
 * brainStore.safetyPill, written by data/klines.ts `_updateWhyBlocked` from
 * BlockReason state + degraded-feeds snapshot.
 */
export function AtWhyBlockedPill() {
  const pill = useBrainStore((s) => s.safetyPill)
  if (!pill || !pill.visible) {
    return <div id="at-why-blocked" className={pill?.className ?? 'ok'} style={{ display: 'none' }} />
  }
  return (
    <div id="at-why-blocked" className={pill.className} style={{ display: 'block' }}>
      <ATStatusIcon kind={pill.iconKind} />{pill.text}
    </div>
  )
}
