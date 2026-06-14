import { describe, it, expect, beforeEach } from 'vitest'
import { useSupportStore } from '../supportStore'

const reset = () => useSupportStore.setState({ thread: [], userUnread: 0, adminUnread: 0 })

describe('supportStore', () => {
  beforeEach(reset)

  it('setThread replaces messages; clearUserUnread resets badge', () => {
    useSupportStore.getState().setUserUnread(5)
    useSupportStore.getState().setThread([{ id: 1, sender: 'user', message: 'hi', created_at: 't' }])
    expect(useSupportStore.getState().thread.length).toBe(1)
    useSupportStore.getState().clearUserUnread()
    expect(useSupportStore.getState().userUnread).toBe(0)
  })

  it('incoming admin reply appends + bumps userUnread', () => {
    useSupportStore.getState().onIncoming({ id: 2, user_id: 7, sender: 'admin', message: 'hello', created_at: 't' })
    expect(useSupportStore.getState().thread.map(m => m.message)).toEqual(['hello'])
    expect(useSupportStore.getState().userUnread).toBe(1)
    expect(useSupportStore.getState().adminUnread).toBe(0)
  })

  it('incoming user message bumps adminUnread, does not append to user thread', () => {
    useSupportStore.getState().onIncoming({ id: 3, user_id: 7, sender: 'user', message: 'q', created_at: 't' })
    expect(useSupportStore.getState().adminUnread).toBe(1)
    expect(useSupportStore.getState().thread.length).toBe(0)
  })

  it('appendLocal adds an optimistic message', () => {
    useSupportStore.getState().appendLocal({ id: 9, sender: 'user', message: 'mine', created_at: 't' })
    expect(useSupportStore.getState().thread.length).toBe(1)
  })
})
