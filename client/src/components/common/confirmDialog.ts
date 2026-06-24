import { create } from 'zustand'

// [2026-06-24] App-wide promise-based confirm/input dialog — one dedicated in-app box (styled like
// the rest of Zeus, .mover/.modal) for ALL confirmations: ARES controls, AutoTrade on/off, manual
// CLOSE ALL / close position, demo add/reset balance, etc. Replaces raw window.confirm/prompt and
// the legacy _showConfirmDialog look. Usage: `const { confirmed, amount } = await appConfirm({...})`.
export interface ConfirmReq {
  title: string
  body: string
  tone?: 'normal' | 'danger' | 'info'
  confirmLabel?: string
  cancelLabel?: string
  /** When present the modal shows a numeric input; confirm resolves with `amount`. */
  amount?: { label: string; placeholder?: string; initial?: string }
}

interface ConfirmState {
  req: ConfirmReq | null
  _resolve: ((r: { confirmed: boolean; amount?: number }) => void) | null
  open: (req: ConfirmReq) => Promise<{ confirmed: boolean; amount?: number }>
  settle: (confirmed: boolean, amount?: number) => void
}

export const useConfirmDialog = create<ConfirmState>((set, get) => ({
  req: null,
  _resolve: null,
  open: (req) => new Promise((resolve) => set({ req, _resolve: resolve })),
  settle: (confirmed, amount) => {
    const r = get()._resolve
    set({ req: null, _resolve: null })
    if (r) r({ confirmed, amount })
  },
}))

/** Imperative helper — open the app confirm modal and await the result. Works from React and
 *  plain TS (the legacy bridge / data layer) alike. */
export function appConfirm(req: ConfirmReq): Promise<{ confirmed: boolean; amount?: number }> {
  return useConfirmDialog.getState().open(req)
}
