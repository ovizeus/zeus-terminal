/**
 * Zeus Terminal — Tab Leader Election (ported from public/js/core/tabLeader.js)
 * Only leader tab runs AT execution. All tabs run brain display.
 * Fail-open: if leader heartbeat stale >5s, any tab takes over.
 */

const KEY = 'zeus_tab_leader'
const HEARTBEAT_MS = 3000
const STALE_MS = 5000
const tabId = Date.now() + '_' + Math.random().toString(36).slice(2, 8)
let _isLeader = false
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null

function _read(): { id: string; ts: number } | null {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null } catch { return null }
}
function _write(): void {
  try { localStorage.setItem(KEY, JSON.stringify({ id: tabId, ts: Date.now() })) } catch { /* */ }
}
function _startHeartbeat(): void {
  if (_heartbeatTimer) clearInterval(_heartbeatTimer)
  _heartbeatTimer = setInterval(() => { if (_isLeader) _write() }, HEARTBEAT_MS)
}

export function claim(): boolean {
  const current = _read()
  if (!current || current.id === tabId || (Date.now() - current.ts) > STALE_MS) {
    _isLeader = true; _write(); _startHeartbeat()
    console.log('[TabLeader] \uD83D\uDC51 This tab is LEADER (' + tabId + ')')
    return true
  }
  _isLeader = false
  console.log('[TabLeader] \uD83D\uDCCB This tab is FOLLOWER (leader=' + current.id + ')')
  return false
}

export function release(): void {
  if (!_isLeader) return
  const current = _read()
  if (current && current.id === tabId) { try { localStorage.removeItem(KEY) } catch { /* */ } }
  _isLeader = false
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null }
}

export function checkLeader(): boolean {
  const current = _read()
  if (!current || current.id === tabId) {
    if (!_isLeader) { _isLeader = true; _startHeartbeat(); _write(); console.log('[TabLeader] \uD83D\uDC51 Claimed leadership (was vacant)') }
    return true
  }
  if ((Date.now() - current.ts) > STALE_MS) {
    _isLeader = true; _write(); _startHeartbeat(); console.log('[TabLeader] \uD83D\uDC51 Claimed leadership (previous leader stale)')
    return true
  }
  _isLeader = false; return false
}

export function isLeader(): boolean { return _isLeader }

// Auto-claim on module load
claim()

// Listen for storage events from other tabs
window.addEventListener('storage', (e: StorageEvent) => {
  if (e.key !== KEY) return
  if (!e.newValue) {
    setTimeout(() => {
      claim()
      if (_isLeader) {
        setTimeout(() => {
          const check = _read()
          if (check && check.id !== tabId) {
            _isLeader = false
            if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null }
            console.log('[TabLeader] Yielded — another tab (' + check.id + ') won race')
          }
        }, 200)
      }
    }, 50 + Math.random() * 100)
  } else {
    try { const data = JSON.parse(e.newValue); if (data.id !== tabId) _isLeader = false } catch { /* */ }
  }
})

export const TabLeader = { isLeader, checkLeader, claim, release, tabId }
