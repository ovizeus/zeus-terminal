import { describe, it, expect } from 'vitest'
import { ALERT_FIELDS, readAlertControls, alertControlValues, ALERT_MASTER_ID } from '../alertFields'

describe('one map, so save and hydrate cannot drift', () => {
  it('every control has a distinct id and a distinct key', () => {
    const ids = ALERT_FIELDS.map((f) => f.id)
    const keys = ALERT_FIELDS.map((f) => f.key)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('the Divergence control holds the DIVERGENCE setting', () => {
    // the audited bug: aDivEn was saved into rsiAlerts, clobbering aRSIEn
    expect(ALERT_FIELDS.find((f) => f.id === 'aDivEn')?.key).toBe('divergence')
    expect(ALERT_FIELDS.find((f) => f.id === 'aRSIEn')?.key).toBe('rsiAlerts')
  })

  it('leaves the master switch out — it has to ask for permission', () => {
    expect(ALERT_FIELDS.some((f) => f.key === 'enabled')).toBe(false)
    expect(ALERT_MASTER_ID).toBe('alertMaster')
  })

  it('is frozen', () => {
    expect(Object.isFrozen(ALERT_FIELDS)).toBe(true)
  })
})

describe('reading the controls', () => {
  it('reads booleans and numbers into their own keys', () => {
    const dom: Record<string, { checked?: boolean; value?: string }> = {
      aVolSpike: { checked: true }, aLiqEn: { checked: false },
      aLiqMin: { value: '2.5' }, aWhaleMin: { value: '250' },
    }
    const got = readAlertControls((id) => dom[id] || null)
    expect(got.volSpike).toBe(true)
    expect(got.liqAlerts).toBe(false)
    expect(got.liqMinBtc).toBe(2.5)
    expect(got.whaleMinBtc).toBe(250)
  })

  it('LEAVES OUT a control that is not on screen', () => {
    // the old code turned a missing element into `true`, so a panel that was
    // not rendered could switch things on by itself
    const got = readAlertControls(() => null)
    expect(got).toEqual({})
  })

  it('ignores a number field holding nonsense rather than storing NaN', () => {
    const got = readAlertControls((id) => (id === 'aLiqMin' ? { value: 'abc' } : null))
    expect('liqMinBtc' in got).toBe(false)
  })

  it('ignores a checkbox whose state is not a boolean', () => {
    const got = readAlertControls((id) => (id === 'aVolSpike' ? { value: 'on' } : null))
    expect('volSpike' in got).toBe(false)
  })
})

describe('hydrating the controls', () => {
  it('returns a value per saved setting, with its kind', () => {
    const vals = alertControlValues({ volSpike: false, liqMinBtc: 3, divergence: true })
    expect(vals).toEqual(expect.arrayContaining([
      { id: 'aVolSpike', kind: 'bool', value: false },
      { id: 'aLiqMin', kind: 'num', value: 3 },
      { id: 'aDivEn', kind: 'bool', value: true },
    ]))
  })

  it('skips a setting never chosen, so the control keeps its own default', () => {
    // forcing `false` here is how "not set yet" would become "turned off"
    expect(alertControlValues({}).length).toBe(0)
    expect(alertControlValues(null).length).toBe(0)
    expect(alertControlValues({ volSpike: undefined } as never).length).toBe(0)
  })

  it('round-trips: hydrate then read gives back what was saved', () => {
    const saved = { volSpike: true, liqAlerts: false, liqMinBtc: 4, rsiOB: true }
    const dom: Record<string, { checked?: boolean; value?: string }> = {}
    for (const f of ALERT_FIELDS) dom[f.id] = f.kind === 'bool' ? { checked: false } : { value: '0' }
    for (const v of alertControlValues(saved)) {
      if (v.kind === 'bool') dom[v.id].checked = v.value as boolean
      else dom[v.id].value = String(v.value)
    }
    const back = readAlertControls((id) => dom[id] || null)
    for (const [k, v] of Object.entries(saved)) expect(back[k]).toBe(v)
  })
})
