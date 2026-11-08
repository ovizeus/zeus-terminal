/**
 * Alerts — the single map from a control on screen to the setting it holds.
 *
 * [2026-11-08] Written after an audit found `saveAlerts()` saving three keys
 * out of twenty, and saving one of them from the WRONG control: it read the
 * Divergence checkbox and wrote `rsiAlerts`, so pressing Save silently
 * overwrote whatever the dedicated RSI checkbox had been set to.
 *
 * One map, used by both the save and the hydrate, is the only way those two
 * cannot drift apart — and the only way a new control cannot be forgotten by
 * one of them.
 */

export interface AlertField {
  /** DOM id of the control in the full Alerts panel. */
  id: string
  /** Key under `S.alerts`. */
  key: string
  /** How to read and write it. */
  kind: 'bool' | 'num'
}

export const ALERT_FIELDS: readonly AlertField[] = Object.freeze([
  { id: 'aVolSpike', key: 'volSpike', kind: 'bool' },
  { id: 'aVolThresh', key: 'volThreshold', kind: 'num' },

  { id: 'aWhaleOrders', key: 'whaleOrders', kind: 'bool' },
  { id: 'aWhaleMin', key: 'whaleMinBtc', kind: 'num' },
  { id: 'aWhaleBid', key: 'whaleBid', kind: 'bool' },
  { id: 'aWhaleAsk', key: 'whaleAsk', kind: 'bool' },
  { id: 'aWhaleRem', key: 'whaleRem', kind: 'bool' },

  { id: 'aLiqEn', key: 'liqAlerts', kind: 'bool' },
  { id: 'aLiqMin', key: 'liqMinBtc', kind: 'num' },

  { id: 'aDivEn', key: 'divergence', kind: 'bool' },
  { id: 'aDivRSI', key: 'divRSI', kind: 'bool' },
  { id: 'aDivMACD', key: 'divMACD', kind: 'bool' },
  { id: 'aDivBull', key: 'divBull', kind: 'bool' },
  { id: 'aDivBear', key: 'divBear', kind: 'bool' },
  { id: 'aDivHid', key: 'divHidden', kind: 'bool' },

  { id: 'aPivotEn', key: 'pivotAlerts', kind: 'bool' },

  { id: 'aRSIEn', key: 'rsiAlerts', kind: 'bool' },
  { id: 'aRSIOB', key: 'rsiOB', kind: 'bool' },
  { id: 'aRSIOS', key: 'rsiOS', kind: 'bool' },
])

/** The master switch is deliberately NOT in the list: it goes through
 *  `setAlertsEnabled`, which also asks for notification permission. */
export const ALERT_MASTER_ID = 'alertMaster'

/**
 * Reads the controls into a plain object. A control that is not on screen is
 * LEFT OUT rather than defaulted — the old code turned a missing element into
 * `true`, which is how a closed panel could switch things on by itself.
 */
export function readAlertControls(
  get: (id: string) => { checked?: boolean; value?: string } | null,
): Record<string, boolean | number> {
  const out: Record<string, boolean | number> = {}
  for (const f of ALERT_FIELDS) {
    const el = get(f.id)
    if (!el) continue
    if (f.kind === 'bool') {
      if (typeof el.checked !== 'boolean') continue
      out[f.key] = el.checked
    } else {
      const n = parseFloat(String(el.value ?? ''))
      if (!Number.isFinite(n)) continue
      out[f.key] = n
    }
  }
  return out
}

/**
 * The values to push into the controls, from the saved settings. A setting
 * that has never been set is left for the control's own default rather than
 * forced, so "not chosen yet" does not read as "turned off".
 */
export function alertControlValues(
  alerts: Record<string, unknown> | null | undefined,
): Array<{ id: string; kind: 'bool' | 'num'; value: boolean | number }> {
  const a = (alerts && typeof alerts === 'object') ? alerts : {}
  const out: Array<{ id: string; kind: 'bool' | 'num'; value: boolean | number }> = []
  for (const f of ALERT_FIELDS) {
    const v = a[f.key]
    if (f.kind === 'bool') {
      if (typeof v !== 'boolean') continue
      out.push({ id: f.id, kind: 'bool', value: v })
    } else {
      const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
      if (!Number.isFinite(n)) continue
      out.push({ id: f.id, kind: 'num', value: n })
    }
  }
  return out
}
