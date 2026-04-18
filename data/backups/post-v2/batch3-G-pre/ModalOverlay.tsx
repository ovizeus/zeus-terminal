import type { ReactNode } from 'react'

/** Shared modal overlay wrapper — 1:1 from .mover + .modal pattern.
 *  Each modal is: <div class="mover"><div class="modal">...</div></div> */
interface ModalOverlayProps {
  id: string
  visible: boolean
  onClose: () => void
  children: ReactNode
  maxWidth?: string
  /** Optional inline z-index — use to ensure modal stacks above .ind-panel (z:8000)
   *  when opened from the indicator selector; inline wins over any cached CSS. */
  zIndex?: number
}

export function ModalOverlay({ id, visible, onClose, children, maxWidth, zIndex }: ModalOverlayProps) {
  // Always render in DOM (hidden when !visible) so old JS can find elements by ID.
  // Old app keeps .mover always in DOM — old JS pre-populates modal fields at boot.
  const overlayStyle: React.CSSProperties = { display: visible ? 'flex' : 'none' }
  if (zIndex !== undefined) overlayStyle.zIndex = zIndex
  return (
    <div className="mover" id={id} style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={maxWidth ? { maxWidth } : undefined}>
        {children}
      </div>
    </div>
  )
}

/** Modal header with title + close button */
export function ModalHeader({ title, onClose, titleStyle }: { title: string; onClose: () => void; titleStyle?: React.CSSProperties }) {
  return (
    <div className="mhdr">
      <div className="mtitle" style={titleStyle}>{title}</div>
      <span className="mclose" onClick={onClose}>✕</span>
    </div>
  )
}
