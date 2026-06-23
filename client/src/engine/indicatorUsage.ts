// Pure: the EFFECTIVE set of active indicator ids for usage telemetry.
// An indicator is "on" the same way the chart decides visibility (dom2.ts):
//   (id in activeInds) ? activeInds[id] : ind.def
// i.e. an explicitly-toggled value wins; otherwise the indicator's default-on flag applies.
// The old report sent only Object.keys(activeInds) — which MISSED every default-on
// indicator a user never toggled, so the picker's usage badge never counted them.
// No I/O, no window — unit-tested.
export function effectiveActiveIds(
  indicators: Array<{ id?: string; def?: boolean }>,
  activeInds: Record<string, boolean>,
): string[] {
  const ai = activeInds || {}
  return (indicators || [])
    .filter((ind) =>
      ind && typeof ind.id === 'string'
        ? (Object.prototype.hasOwnProperty.call(ai, ind.id) ? !!ai[ind.id] : !!ind.def)
        : false,
    )
    .map((ind) => ind.id as string)
}
