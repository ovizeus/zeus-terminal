/**
 * [2026-11-08] The Settings hub must not destroy what it never read.
 *
 * Found by audit: `hubSaveAll` reads the hub checkboxes with
 * `_getC(id, true)`, which returns `element.checked` whenever the element
 * exists. The modals stay in the DOM (`display:none`), so they DO exist — and
 * nothing ever hydrated them, because the React modal never called
 * `hubPopulate()`. So every alert checkbox read as unchecked and SAVE ALL
 * persisted `false` over the lot.
 *
 * Pressing the obvious save button turned the user's alerts off, silently.
 *
 * Two defences, and the tests want BOTH: the panel is hydrated when it opens,
 * and a save refuses to run against a panel that was never hydrated. The
 * second one matters because it does not depend on anyone remembering the
 * first.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
// Imported STATICALLY and before the state is set: `dev` pulls in core/state,
// which assigns window.S on module load. A lazy import inside each test let
// that assignment land AFTER the test's own state and silently replace it.
import { hubPopulate, hubSaveAll } from '../dev'

const ALERT_IDS = ['hubAlertMaster', 'hubAlertVol', 'hubAlertWhale', 'hubAlertLiq', 'hubAlertDiv', 'hubAlertRsi']

function buildPanel() {
  document.body.innerHTML = `
    <div id="msettings">
      <input type="checkbox" id="hubNotifyEnabled" checked />
      <input type="checkbox" id="hubDevEnabled" />
      ${ALERT_IDS.map((id) => `<input type="checkbox" id="${id}" />`).join('')}
      <input id="hubWhaleMin" value="100" />
      <input id="hubLiqMin" value="1" />
      <input id="hubCloudEmail" value="" />
      <select id="themeSelect"><option value="native">a</option></select>
    </div>`
}

// NOT globalThis: under vitest's jsdom the module's `window` and the test's
// `globalThis` are different objects, and the first version of this test set
// the state somewhere production never looks.
const w = window as unknown as { S: Record<string, unknown>; _usSave?: () => void }

beforeEach(() => {
  buildPanel()
  w.S = {
    alerts: {
      enabled: true, volSpike: true, whaleOrders: true, liqAlerts: true,
      divergence: true, rsiAlerts: true, whaleMinBtc: 250, liqMinBtc: 3,
    },
  }
  w._usSave = vi.fn()
})

describe('opening the panel shows the TRUTH, not the JSX defaults', () => {
  it('hydrates every alert switch from the saved state', () => {
    hubPopulate()
    for (const id of ALERT_IDS) {
      expect((document.getElementById(id) as HTMLInputElement).checked).toBe(true)
    }
    expect((document.getElementById('hubWhaleMin') as HTMLInputElement).value).toBe('250')
    expect((document.getElementById('hubLiqMin') as HTMLInputElement).value).toBe('3')
  })

  it('shows OFF when it really is off — the default must not win', () => {
    ;(w.S.alerts as Record<string, unknown>).enabled = false
    ;(w.S.alerts as Record<string, unknown>).volSpike = false
    // Pre-set them TRUE so a no-op cannot pass this test: an unhydrated panel
    // renders unchecked, which would have looked like a correct "off".
    for (const id of ALERT_IDS) (document.getElementById(id) as HTMLInputElement).checked = true
    hubPopulate()
    expect((document.getElementById('hubAlertMaster') as HTMLInputElement).checked).toBe(false)
    expect((document.getElementById('hubAlertVol') as HTMLInputElement).checked).toBe(false)
  })
})

describe('a save round-trips instead of wiping', () => {
  it('hydrate then save leaves the settings exactly as they were', () => {
    const before = JSON.parse(JSON.stringify(w.S.alerts))
    hubPopulate()
    hubSaveAll()
    expect(w.S.alerts).toEqual(before)
  })

  it('REFUSES to save a panel nobody hydrated, instead of writing false over everything', () => {
    // the exact bug: open settings, press SAVE ALL, lose every alert
    const before = JSON.parse(JSON.stringify(w.S.alerts))
    hubSaveAll()
    expect(w.S.alerts).toEqual(before)
    expect((w.S.alerts as Record<string, unknown>).enabled).toBe(true)
  })

  it('saves a real change the user made', () => {
    hubPopulate()
    ;(document.getElementById('hubAlertVol') as HTMLInputElement).checked = false
    ;(document.getElementById('hubLiqMin') as HTMLInputElement).value = '7'
    hubSaveAll()
    expect((w.S.alerts as Record<string, unknown>).volSpike).toBe(false)
    expect((w.S.alerts as Record<string, unknown>).liqMinBtc).toBe(7)
    expect((w.S.alerts as Record<string, unknown>).enabled).toBe(true) // untouched
  })

  it('the master switch is not fought over by two checkboxes', () => {
    // `enabled` used to be written twice in one save: first from the General
    // checkbox, then overwritten by the Alerts master. Second writer won.
    hubPopulate()
    ;(document.getElementById('hubAlertMaster') as HTMLInputElement).checked = false
    hubSaveAll()
    expect((w.S.alerts as Record<string, unknown>).enabled).toBe(false)
    hubPopulate()
    expect((document.getElementById('hubNotifyEnabled') as HTMLInputElement).checked).toBe(false)
    expect((document.getElementById('hubAlertMaster') as HTMLInputElement).checked).toBe(false)
  })
})
