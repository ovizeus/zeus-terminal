// Zeus — stores/pinLockStore.ts
// [BATCH3-Q] PIN lock screen visibility + error state. Controls <PinLockScreen />.
// Storage strategy: sessionStorage key 'zeus_pin_unlocked' — persists across
// reloads within the same tab/session, clears on tab close or Android app kill.
// This matches user requirement: "only prompt on full exit, not on refresh".
import { create } from 'zustand'

export interface PinLockStore {
  visible: boolean
  message: string
  shaking: boolean
  setVisible: (v: boolean) => void
  setMessage: (m: string) => void
  setShaking: (s: boolean) => void
}

export const usePinLockStore = create<PinLockStore>()((set) => ({
  visible: false,
  message: '',
  shaking: false,
  setVisible: (v) => set({ visible: v }),
  setMessage: (m) => set({ message: m }),
  setShaking: (s) => set({ shaking: s }),
}))
