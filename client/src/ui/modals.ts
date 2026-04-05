// Zeus v122 — ui/modals.ts (ported from ui/modals.js)
// Modal dialogs & overlays
const w = window as any;

let _execActive = false;
let _execQueue: any[] = [];

// Exec overlay
export function _showExecOverlay(html: any, cssClass: any, duration: any): void {
  const div = document.createElement('div');
  div.className = 'zeus-exec-overlay ' + cssClass;
  div.innerHTML = html;
  document.body.appendChild(div);
  requestAnimationFrame(() => requestAnimationFrame(() => div.classList.add('show')));
  setTimeout(() => {
    div.classList.add('exit-anim');
    setTimeout(() => {
      try { document.body.removeChild(div); } catch(_) {}
      _execActive = false;
      if(_execQueue.length) { const next = _execQueue.shift(); _showExecOverlay(...next); }
    }, 350);
  }, duration || 2500);
}

export function _queueExecOverlay(html: any, cssClass: any, duration: any): void {
  if(_execActive) { _execQueue.push([html, cssClass, duration]); return; }
  _execActive = true;
  _showExecOverlay(html, cssClass, duration);
}

// ── ENTRY POPUP ──────────────────────────────────────────
