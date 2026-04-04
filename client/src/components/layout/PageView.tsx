import type { ReactNode } from 'react'

/** Full-screen page view overlay — 1:1 from public/css zpv + public/js/ui/pageview.js */
export function PageView({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="zpv" id="zeus-page-view">
      <div className="zpv-header">
        <button className="zpv-back" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Back</span>
        </button>
        <span className="zpv-title">{title}</span>
      </div>
      <div className="zpv-content">
        {children}
      </div>
    </div>
  )
}
