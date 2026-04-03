import { create } from 'zustand'
import type { JournalEntry } from '../types'

interface JournalStore {
  entries: JournalEntry[]
  setEntries: (entries: JournalEntry[]) => void
  addEntry: (entry: JournalEntry) => void
}

export const useJournalStore = create<JournalStore>()((set) => ({
  entries: [],
  setEntries: (entries) => set({ entries: entries.slice(-200) }),
  addEntry: (entry) => set((s) => ({ entries: [...s.entries.slice(-199), entry] })),
}))
