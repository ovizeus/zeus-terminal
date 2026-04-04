import type { ReactNode } from 'react'

/** Shared modal overlay wrapper — 1:1 from .mover + .modal pattern.
 *  Each modal is: <div class="mover"><div class="modal">...</div></div> */
interface ModalOverlayProps {
  id: string
  visible: boolean
  onClose: () => void
  children: ReactNode
  maxWidth?: string
}

export function ModalOverlay({ id, visible, onClose, children, maxWidth }: ModalOverlayProps) {
  // Always render in DOM (hidden when !visible) so old JS can find elements by ID.
  // Old app keeps .mover always in DOM — old JS pre-populates modal fields at boot.
  return (
    <div className="mover" id={id} style={{ display: visible ? 'flex' : 'none' }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
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
