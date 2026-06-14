import { create } from 'zustand'
import type { SupportMsg } from '../types/support'
export type { SupportMsg }

interface SupportStore {
  /** The current user's own conversation thread (user view). */
  thread: SupportMsg[]
  /** Unread admin replies for the current user (drives the user-side badge). */
  userUnread: number
  /** Total unread user messages for the admin (drives the admin header badge). */
  adminUnread: number

  setThread: (msgs: SupportMsg[]) => void
  appendLocal: (msg: SupportMsg) => void
  setUserUnread: (n: number) => void
  clearUserUnread: () => void
  setAdminUnread: (n: number) => void
  /** Dispatch a live WS support.message frame. Branches on sender:
   *  admin → this client is a user receiving a reply; user → this client is
   *  the admin receiving a new message (badge only). */
  onIncoming: (data: SupportMsg) => void
}

export const useSupportStore = create<SupportStore>((set) => ({
  thread: [],
  userUnread: 0,
  adminUnread: 0,

  setThread: (msgs) => set({ thread: msgs }),
  appendLocal: (msg) => set((s) => ({ thread: [...s.thread, msg] })),
  setUserUnread: (n) => set({ userUnread: n }),
  clearUserUnread: () => set({ userUnread: 0 }),
  setAdminUnread: (n) => set({ adminUnread: n }),

  onIncoming: (data) => {
    if (data.sender === 'admin') {
      set((s) => {
        const exists = s.thread.some((m) => m.id === data.id)
        return {
          thread: exists ? s.thread : [...s.thread, data],
          userUnread: s.userUnread + 1,
        }
      })
    } else {
      set((s) => ({ adminUnread: s.adminUnread + 1 }))
    }
  },
}))
