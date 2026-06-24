import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('../services/api', () => ({
  profileApi: {
    get: vi.fn(async () => ({ ok: true, profile: { username: 'zeus_ovi', display_name: 'Ovi' } })),
    save: vi.fn(async (p: any) => p.username === 'taken' ? { ok: false, error: 'username_taken' } : { ok: true, profile: p }),
  },
}))
import { useProfileStore } from './profileStore'

describe('profileStore', () => {
  beforeEach(() => { useProfileStore.setState({ profile: {}, loaded: false, error: null }) })
  it('load populates profile', async () => {
    await useProfileStore.getState().load()
    expect(useProfileStore.getState().profile.username).toBe('zeus_ovi')
    expect(useProfileStore.getState().loaded).toBe(true)
  })
  it('save updates profile + returns true', async () => {
    const ok = await useProfileStore.getState().save({ tagline: 'hi' })
    expect(ok).toBe(true)
    expect(useProfileStore.getState().profile.tagline).toBe('hi')
  })
  it('save sets error on 409 username_taken', async () => {
    const ok = await useProfileStore.getState().save({ username: 'taken' })
    expect(ok).toBe(false)
    expect(useProfileStore.getState().error).toBe('username_taken')
  })
})
