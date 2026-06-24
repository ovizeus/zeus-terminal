import { describe, it, expect } from 'vitest'
import { useConfirmDialog, appConfirm } from './confirmDialog'

describe('appConfirm text mode', () => {
  it('resolves with the typed text on confirm', async () => {
    const p = appConfirm({ title: 'Name', body: '', text: { label: 'Name', initial: 'Ovi' } })
    useConfirmDialog.getState().settle(true, undefined, 'Ovi2')
    expect(await p).toEqual({ confirmed: true, text: 'Ovi2' })
  })
  it('resolves confirmed:false on cancel', async () => {
    const p = appConfirm({ title: 'X', body: '', text: { label: 'L' } })
    useConfirmDialog.getState().settle(false)
    const r = await p
    expect(r.confirmed).toBe(false)
  })
})
