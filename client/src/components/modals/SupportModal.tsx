// Zeus — components/modals/SupportModal.tsx
// [2026-11-15] Suportul, scos din Settings la cererea operatorului: „ca la orice
// aplicatie, pictograma lui mica cu casti". Se deschide din antet (Header.tsx).
// Continutul e cel care statea in tabul SUPPORT din SettingsHubModal, neschimbat:
// contact, chatul viu cu echipa, categoriile de raportare.
//
// Adminul NU ajunge aici: pictograma lui deschide Admin → Support / Ops, unde
// vede toate conversatiile (vezi Header.tsx).
import { ModalOverlay, ModalHeader } from './ModalOverlay'
import { SupportChat } from './SupportChat'

const w = window as any

// [2026-06-13] Support — categorised mailto with auto diagnostics so users can
// report issues fast and we get context (version/symbol/mode/device).
const SUPPORT_EMAIL = 'support@zeus-terminal.com'
const SUPPORT_CATEGORIES = [
  { ico: '🐞', label: 'App broke / black screen / froze', subj: 'App broke or froze' },
  { ico: '📊', label: 'Chart or price not loading / wrong', subj: 'Chart or price issue' },
  { ico: '🤖', label: 'AutoTrade / Brain / orders issue', subj: 'AutoTrade / Brain issue' },
  { ico: '🔌', label: 'Exchange API / connection problem', subj: 'Exchange API / connection' },
  { ico: '🔐', label: 'Login / account / 2FA / PIN', subj: 'Login / account / 2FA' },
  { ico: '💾', label: 'Settings not saving / sync', subj: 'Settings / sync issue' },
  { ico: '💡', label: 'Suggestion / feedback', subj: 'Suggestion / feedback' },
  { ico: '❓', label: 'Something else', subj: 'Other' },
]
function _supportMailto(subj: string): string {
  let diag = ''
  try {
    const ver = (w.BUILD && w.BUILD.version) || 'v1.7.164'
    const sym = (w.S && w.S.symbol) || '—'
    const env = w._resolvedEnv || (w.S && w.S.mode) || '—'
    diag = [
      'Version: ' + ver,
      'Symbol: ' + sym,
      'Mode: ' + env,
      'When: ' + new Date().toString(),
      'Device: ' + (navigator.userAgent || '—'),
    ].join('\n')
  } catch (_) { /* best effort */ }
  const body = 'Describe what happened (steps, what you expected, what you saw):\n\n\n'
    + '────────── please keep the details below ──────────\n' + diag
  return 'mailto:' + SUPPORT_EMAIL + '?subject=' + encodeURIComponent('[Zeus] ' + subj) + '&body=' + encodeURIComponent(body)
}

interface Props { visible: boolean; onClose: () => void }

export function SupportModal({ visible, onClose }: Props) {
  return (
    <ModalOverlay id="msupport" visible={visible} onClose={onClose} maxWidth="500px">
      <ModalHeader title="SUPPORT" onClose={onClose} />
      <div className="mbody act" id="set-support" style={{ display: 'block' }}>
        <div className="msec">CONTACT</div>
        <div style={{fontSize:'10px',color:'#b3a2d4',lineHeight:1.6,marginBottom:'8px'}}>
          Having trouble? Reach the Zeus team at <b style={{color:'#d9c7ff'}}>{SUPPORT_EMAIL}</b>. Pick a category below — your email opens pre-filled with a few diagnostics so we can help faster.
        </div>
        <a className="hub-sbtn pri" href={_supportMailto('General support')} style={{width:'100%',padding:'9px',justifyContent:'center',textDecoration:'none',display:'flex',alignItems:'center',gap:'6px'}}>
          <svg className="z-i" viewBox="0 0 16 16"><path d="M2 4h12v8H2V4zm0 0l6 4 6-4" /></svg> Email Support
        </a>

        <SupportChat active={visible} />

        <div className="msec">REPORT A PROBLEM</div>
        <div style={{display:'flex',flexDirection:'column',gap:'5px'}}>
          {SUPPORT_CATEGORIES.map(c => (
            <a key={c.subj} className="hub-sbtn" href={_supportMailto(c.subj)} style={{display:'flex',alignItems:'center',gap:'8px',textDecoration:'none',padding:'8px 10px'}}>
              <span style={{fontSize:'13px'}}>{c.ico}</span> {c.label}
            </a>
          ))}
        </div>

        <div className="msec">BEFORE YOU WRITE</div>
        <div style={{fontSize:'10px',color:'#9a8cb8',lineHeight:1.8}}>
          • New accounts need manual admin approval — it can take a little while.<br/>
          • For 2FA / verification emails, check your spam / junk folder.<br/>
          • For exchange API issues, verify your key permissions + IP whitelist.<br/>
          • A hard refresh (fully close &amp; reopen Zeus) clears most temporary glitches.
        </div>

        <div className="msec">SAFETY</div>
        <div style={{fontSize:'10px',color:'#9a8cb8',lineHeight:1.6}}>
          We will <b style={{color:'#d9c7ff'}}>never</b> ask for your password, 2FA codes, or exchange API secrets by email.
        </div>

        <div style={{marginTop:'14px',display:'flex',gap:'14px',flexWrap:'wrap',fontSize:'10px'}}>
          <a href="/support.html" target="_blank" rel="noopener" style={{color:'#c9a8ff'}}>Support page ↗</a>
          <a href="/terms.html" target="_blank" rel="noopener" style={{color:'#c9a8ff'}}>Terms ↗</a>
          <a href="/privacy.html" target="_blank" rel="noopener" style={{color:'#c9a8ff'}}>Privacy ↗</a>
        </div>
      </div>
    </ModalOverlay>
  )
}
