import { create } from 'zustand'
import { profileApi, type ProfileFields } from '../services/api'

// [2026-06-24] User profile state (flip-header). Loads once on boot, holds the current profile,
// saves patches to /api/profile. Surfaces a `username_taken` error from the server.
interface ProfileState {
  profile: ProfileFields
  loaded: boolean
  error: string | null
  load: () => Promise<void>
  save: (patch: Partial<ProfileFields>) => Promise<boolean>
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: {},
  loaded: false,
  error: null,
  load: async () => {
    const r = await profileApi.get()
    if (r && r.ok) set({ profile: r.profile || {}, loaded: true })
  },
  save: async (patch) => {
    const merged = { ...get().profile, ...patch }
    const r = await profileApi.save(merged)
    if (r && r.ok) { set({ profile: r.profile || merged, error: null }); return true }
    set({ error: (r && r.error) || 'save_failed' })
    return false
  },
}))
