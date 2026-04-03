import { describe, it, expect, beforeEach } from 'vitest'
import { wsService } from '../ws'

describe('wsService', () => {
  beforeEach(() => {
    wsService.disconnect()
  })

  it('isConnected returns false when not connected', () => {
    expect(wsService.isConnected()).toBe(false)
  })

  it('subscribe returns unsubscribe function', () => {
    const unsub = wsService.subscribe(() => {})
    expect(typeof unsub).toBe('function')
    unsub()
  })
})
