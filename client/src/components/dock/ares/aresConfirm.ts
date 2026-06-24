import { create } from 'zustand'

// [2026-06-24] Promise-based confirm/input modal for ARES controls — replaces the raw browser
// window.confirm / window.prompt with a dedicated in-app box styled like the rest of Zeus
// (.mover/.modal). Usage: `const { confirmed, amount } = await aresConfirm({ ... })`.
export interface AresConfirmReq {
  title: string
  body: string
  tone?: 'normal' | 'danger' | 'info'
  confirmLabel?: string
  cancelLabel?: string
  /** When present the modal shows a numeric input; confirm resolves with `amount`. */
  amount?: { label: string; placeholder?: string; initial?: string }
}

interface ConfirmState {
  req: AresConfirmReq | null
  _resolve: ((r: { confirmed: boolean; amount?: number }) => void) | null
  open: (req: AresConfirmReq) => Promise<{ confirmed: boolean; amount?: number }>
  settle: (confirmed: boolean, amount?: number) => void
}

export const useAresConfirm = create<ConfirmState>((set, get) => ({
  req: null,
  _resolve: null,
  open: (req) => new Promise((resolve) => set({ req, _resolve: resolve })),
  settle: (confirmed, amount) => {
    const r = get()._resolve
    set({ req: null, _resolve: null })
    if (r) r({ confirmed, amount })
  },
}))

/** Imperative helper — open the ARES confirm modal and await the result. */
export function aresConfirm(req: AresConfirmReq): Promise<{ confirmed: boolean; amount?: number }> {
  return useAresConfirm.getState().open(req)
}
