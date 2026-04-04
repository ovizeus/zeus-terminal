import { useState, useEffect, useRef, useCallback } from 'react'
import { authApi } from '../../services/api'
import type { AdminUser } from '../../services/api'
import { useAuthStore } from '../../stores'
import './login.css'

/* ── SVG icons for password eye toggle ── */
const EYE_SVG = (
  <svg viewBox="0 0 24 24">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)
const EYE_OFF_SVG = (
  <svg viewBox="0 0 24 24">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
)

/* ── Password Eye Toggle Button ── */
function PwEye({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [show, setShow] = useState(false)
  function toggle() {
    if (!inputRef.current) return
    const next = !show
    setShow(next)
    inputRef.current.type = next ? 'text' : 'password'
  }
  return (
    <button type="button" className={`pw-eye${show ? ' active' : ''}`} onClick={toggle} tabIndex={-1} aria-label="Show password">
      {show ? EYE_OFF_SVG : EYE_SVG}
    </button>
  )
}

/* ── Ticker data types ── */
interface TickerPair {
  sym: string
  id: string
  dec: number
}
const PAIRS: TickerPair[] = [
  { sym: 'btcusdt', id: 'BTC', dec: 1 },
  { sym: 'ethusdt', id: 'ETH', dec: 2 },
  { sym: 'solusdt', id: 'SOL', dec: 2 },
  { sym: 'bnbusdt', id: 'BNB', dec: 2 },
]

/* ── Spark bar renderer ── */
function SparkBars({ data }: { data: number[] }) {
  if (data.length === 0) return null
  const slice = data.slice(-15)
  const max = Math.max(...slice)
  const min = Math.min(...slice)
  const range = max - min || 1
  const last = slice[slice.length - 1]
  return (
    <>
      {slice.map((v, i) => {
        const h = 4 + ((v - min) / range) * 16
        const color = v >= last ? 'var(--green)' : 'var(--cyan)'
        return <div key={i} className="bar" style={{ height: h + 'px', background: color, opacity: 0.7 }} />
      })}
    </>
  )
}

/* ── Chart Background Canvas ── */
function ChartBgCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    let W: number, H: number
    let animId: number

    function resize() {
      W = cv!.width = window.innerWidth
      H = cv!.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const CANDLES = 120
    const candleW = 14
    const gap = 4
    let offset = 0
    const speed = 0.3

    interface Candle { open: number; close: number; high: number; low: number; volume: number }

    function genCandle(prevClose: number): Candle {
      const vol = 0.003 + Math.random() * 0.015
      const dir = Math.random() > 0.48 ? 1 : -1
      const open = prevClose
      const close = open + dir * vol * open
      const high = Math.max(open, close) + Math.random() * vol * 0.6 * open
      const low = Math.min(open, close) - Math.random() * vol * 0.6 * open
      const volume = 0.2 + Math.random() * 0.8
      return { open, close, high, low, volume }
    }

    let candles: Candle[] = []
    let price = 0.5
    for (let i = 0; i < CANDLES + 40; i++) {
      const c = genCandle(price)
      candles.push(c)
      price = c.close
    }

    function getMA(idx: number, period: number) {
      let sum = 0, cnt = 0
      for (let i = Math.max(0, idx - period); i <= idx; i++) {
        sum += candles[i].close; cnt++
      }
      return sum / cnt
    }

    function draw() {
      ctx!.clearRect(0, 0, W, H)
      offset += speed
      if (offset >= candleW + gap) {
        offset -= (candleW + gap)
        candles.shift()
        candles.push(genCandle(candles[candles.length - 1].close))
      }

      const visibleEnd = Math.min(candles.length, Math.ceil(W / (candleW + gap)) + 2)
      let pMin = Infinity, pMax = -Infinity
      for (let i = 0; i < visibleEnd; i++) {
        if (candles[i].low < pMin) pMin = candles[i].low
        if (candles[i].high > pMax) pMax = candles[i].high
      }
      const pRange = pMax - pMin || 0.01

      function scaleY(p: number) { return H * 0.12 + (1 - (p - pMin) / pRange) * (H * 0.76) }

      // Grid lines
      ctx!.strokeStyle = 'rgba(0,175,255,0.04)'
      ctx!.lineWidth = 1
      for (let i = 0; i < 8; i++) {
        const y = H * 0.12 + i * (H * 0.76) / 7
        ctx!.beginPath()
        ctx!.moveTo(0, y)
        ctx!.lineTo(W, y)
        ctx!.stroke()
      }

      // Volume bars
      for (let i = 0; i < visibleEnd; i++) {
        const x = i * (candleW + gap) - offset
        if (x + candleW < 0 || x > W) continue
        const c = candles[i]
        const bullish = c.close >= c.open
        const volH = c.volume * H * 0.08
        ctx!.fillStyle = bullish ? 'rgba(0,255,136,0.08)' : 'rgba(255,68,85,0.08)'
        ctx!.fillRect(x, H - volH, candleW, volH)
      }

      // Candles
      for (let i = 0; i < visibleEnd; i++) {
        const x = i * (candleW + gap) - offset
        if (x + candleW < 0 || x > W) continue
        const c = candles[i]
        const bullish = c.close >= c.open
        const oY = scaleY(c.open)
        const cY = scaleY(c.close)
        const hY = scaleY(c.high)
        const lY = scaleY(c.low)

        const wickX = x + candleW / 2
        ctx!.strokeStyle = bullish ? 'rgba(0,255,136,0.5)' : 'rgba(255,68,85,0.5)'
        ctx!.lineWidth = 1.5
        ctx!.beginPath()
        ctx!.moveTo(wickX, hY)
        ctx!.lineTo(wickX, lY)
        ctx!.stroke()

        const bodyTop = Math.min(oY, cY)
        const bodyH = Math.max(Math.abs(oY - cY), 1)
        if (bullish) {
          ctx!.fillStyle = 'rgba(0,255,136,0.25)'
          ctx!.strokeStyle = 'rgba(0,255,136,0.6)'
        } else {
          ctx!.fillStyle = 'rgba(255,68,85,0.25)'
          ctx!.strokeStyle = 'rgba(255,68,85,0.6)'
        }
        ctx!.lineWidth = 1
        ctx!.fillRect(x + 1, bodyTop, candleW - 2, bodyH)
        ctx!.strokeRect(x + 1, bodyTop, candleW - 2, bodyH)
      }

      // MA 20
      ctx!.beginPath()
      ctx!.strokeStyle = 'rgba(0,175,255,0.7)'
      ctx!.lineWidth = 2
      ctx!.shadowColor = 'rgba(0,175,255,0.4)'
      ctx!.shadowBlur = 6
      let started = false
      for (let i = 0; i < visibleEnd; i++) {
        const x = i * (candleW + gap) - offset + candleW / 2
        if (x < -20 || x > W + 20) continue
        const ma = getMA(i, 20)
        const y = scaleY(ma)
        if (!started) { ctx!.moveTo(x, y); started = true }
        else ctx!.lineTo(x, y)
      }
      ctx!.stroke()
      ctx!.shadowBlur = 0

      // MA 7
      ctx!.beginPath()
      ctx!.strokeStyle = 'rgba(240,192,64,0.5)'
      ctx!.lineWidth = 1.5
      ctx!.shadowColor = 'rgba(240,192,64,0.3)'
      ctx!.shadowBlur = 4
      started = false
      for (let i = 0; i < visibleEnd; i++) {
        const x = i * (candleW + gap) - offset + candleW / 2
        if (x < -20 || x > W + 20) continue
        const ma = getMA(i, 7)
        const y = scaleY(ma)
        if (!started) { ctx!.moveTo(x, y); started = true }
        else ctx!.lineTo(x, y)
      }
      ctx!.stroke()
      ctx!.shadowBlur = 0

      animId = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animId)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      id="chartBg"
      style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none', opacity: 0.12 }}
    />
  )
}

/* ── Particles ── */
function Particles() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    for (let i = 0; i < 20; i++) {
      const p = document.createElement('div')
      p.className = 'particle'
      p.style.left = Math.random() * 100 + '%'
      p.style.animationDuration = (8 + Math.random() * 12) + 's'
      p.style.animationDelay = Math.random() * 10 + 's'
      p.style.width = p.style.height = (1 + Math.random() * 2) + 'px'
      c.appendChild(p)
    }
  }, [])
  return <div className="particles" id="particles" ref={ref}></div>
}

/* ── Feature Cards Data ── */
const FEATURES = [
  { mod: 'mod-brain', icon: 'Z', chip: 'CORE', label: 'ZEUS Brain', desc: 'Adaptive regime detection, layered confluence scoring, behavioral state logic, and controlled decision-routing.' },
  { mod: 'mod-dsl', icon: 'D', chip: 'PROTECTION', label: 'DSL Protection Engine', desc: 'Dynamic stop logic, activation thresholds, impulse tracking, pivot control, and structured exit behavior.' },
  { mod: 'mod-intel', icon: 'M', chip: 'FLOW', label: 'Market Intelligence', desc: 'Order flow context, multi-timeframe structure, volatility mapping, liquidity behavior, and chart-state awareness.' },
  { mod: 'mod-signal', icon: 'S', chip: 'SIGNAL', label: 'Signal Fusion', desc: 'Multi-layer signal synthesis combining timing logic, regime alignment, contextual filters, and execution-assistance scoring.' },
  { mod: 'mod-risk', icon: 'R', chip: 'CONTROL', label: 'Risk & Execution Control', desc: 'Exposure discipline, leverage boundaries, position constraints, loss protection rails, and execution-side safety.' },
  { mod: 'mod-perf', icon: 'P', chip: 'REVIEW', label: 'Performance Review', desc: 'Trade journal insight, execution feedback, post-session review, behavioral tracking, and refinement data.' },
  { mod: 'mod-ares', icon: 'A', chip: 'ARES', label: 'ARES Watch', desc: 'Autonomous wallet logic, control-state supervision, position intelligence, and protected execution monitoring.' },
]

/* ═══════════════════════════════════════════
   MAIN LOGIN PAGE COMPONENT
   ═══════════════════════════════════════════ */

export function LoginPage() {
  const checkAuth = useAuthStore((s) => s.checkAuth)

  /* ── Body styles: match original login.html body ── */
  useEffect(() => {
    document.body.classList.add('login-page')
    return () => { document.body.classList.remove('login-page') }
  }, [])

  /* ── State ── */
  const [active, setActive] = useState(false) // sliding overlay toggle
  const [shaking, setShaking] = useState(false)

  // Sign-in fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [submitText, setSubmitText] = useState('Sign In')

  // 2FA code step
  const [showCodeStep, setShowCodeStep] = useState(false)
  const [codeValue, setCodeValue] = useState('')
  const [codeTimerText, setCodeTimerText] = useState('Code expires in 5:00')
  const [verifyText, setVerifyText] = useState('VERIFY')
  const codeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pendingEmailRef = useRef('')
  const pendingPasswordRef = useRef('')

  // Forgot password step
  const [showForgotStep, setShowForgotStep] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotMsg, setForgotMsg] = useState('')
  const [forgotMsgColor, setForgotMsgColor] = useState('')
  const [forgotSendText, setForgotSendText] = useState('SEND RESET CODE')
  const [forgotSendDisabled, setForgotSendDisabled] = useState(false)
  const [showForgotCodeForm, setShowForgotCodeForm] = useState(false)
  const [forgotCode, setForgotCode] = useState('')
  const [forgotNewPass, setForgotNewPass] = useState('')
  const [forgotCodeMsg, setForgotCodeMsg] = useState('')
  const [forgotCodeMsgColor, setForgotCodeMsgColor] = useState('')
  const [forgotConfirmText, setForgotConfirmText] = useState('RESET PASSWORD')
  const [forgotConfirmDisabled, setForgotConfirmDisabled] = useState(false)

  // Register fields
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [registerErrorMsg, setRegisterErrorMsg] = useState('')
  const [showPendingMsg, setShowPendingMsg] = useState(false)
  const [registerBtnText, setRegisterBtnText] = useState('Request an Invite')

  // Admin panel
  const [adminStatus, setAdminStatus] = useState('')
  const [showAdminPanel, setShowAdminPanel] = useState(false)
  const [users, setUsers] = useState<AdminUser[]>([])

  // Tickers
  const [tickerData, setTickerData] = useState<Record<string, { price: string; change: string; up: boolean }>>({
    BTC: { price: '--', change: '--', up: true },
    ETH: { price: '--', change: '--', up: true },
    SOL: { price: '--', change: '--', up: true },
    BNB: { price: '--', change: '--', up: true },
  })
  const [sparkData, setSparkData] = useState<Record<string, number[]>>({ BTC: [], ETH: [], SOL: [], BNB: [] })
  const [tickerVisible, setTickerVisible] = useState(true)

  // Input refs for pw-eye
  const pwRef = useRef<HTMLInputElement>(null)
  const regPwRef = useRef<HTMLInputElement>(null)
  const regConfirmRef = useRef<HTMLInputElement>(null)
  const forgotNewPassRef = useRef<HTMLInputElement>(null)

  /* ── Shake helper ── */
  function shake() {
    setShaking(true)
    setTimeout(() => setShaking(false), 400)
  }

  /* ── Show error on sign-in form ── */
  function showSignInError(msg: string) {
    setErrorMsg(msg)
    setShowPendingMsg(false)
    shake()
  }

  function showRegError(msg: string) {
    setRegisterErrorMsg(msg)
    shake()
  }

  /* ── Code timer ── */
  function startCodeTimer() {
    if (codeTimerRef.current) clearInterval(codeTimerRef.current)
    let seconds = 300
    setCodeTimerText('Code expires in 5:00')
    codeTimerRef.current = setInterval(() => {
      seconds--
      if (seconds <= 0) {
        clearInterval(codeTimerRef.current!)
        setCodeTimerText('Code expired')
        return
      }
      const m = Math.floor(seconds / 60)
      const s = seconds % 60
      setCodeTimerText('Code expires in ' + m + ':' + String(s).padStart(2, '0'))
    }, 1000)
  }

  /* ── Auth: Sign In ── */
  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    const em = email.trim()
    const pw = password
    setSubmitText('...')
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, password: pw }),
      })
      const data = await res.json()
      if (res.ok) {
        if (data.needsCode) {
          pendingEmailRef.current = em
          pendingPasswordRef.current = pw
          setErrorMsg('')
          setShowCodeStep(true)
          setCodeValue('')
          startCodeTimer()
        } else {
          await checkAuth()
        }
      } else {
        showSignInError(data.error || 'Unknown error')
      }
    } catch {
      showSignInError('Connection error')
    } finally {
      setSubmitText('SIGN IN')
    }
  }

  /* ── Auth: Verify Code ── */
  const verifyCode = useCallback(async () => {
    const code = codeValue.trim()
    if (code.length !== 6) { showSignInError('Enter the 6-digit code'); return }
    setVerifyText('...')
    try {
      const res = await fetch('/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmailRef.current, code }),
      })
      const data = await res.json()
      if (res.ok) {
        await checkAuth()
      } else {
        showSignInError(data.error || 'Invalid code')
      }
    } catch {
      showSignInError('Connection error')
    } finally {
      setVerifyText('VERIFY')
    }
  }, [codeValue, checkAuth])

  /* ── Auth: Resend Code ── */
  async function resendCode() {
    if (!pendingEmailRef.current || !pendingPasswordRef.current) return
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmailRef.current, password: pendingPasswordRef.current }),
      })
      const data = await res.json()
      if (res.ok && data.needsCode) {
        setErrorMsg('')
        startCodeTimer()
        setCodeValue('')
      } else {
        showSignInError(data.error || 'Failed to resend')
      }
    } catch {
      showSignInError('Connection error')
    }
  }

  /* ── Back to login from code step ── */
  function backToLogin() {
    setShowCodeStep(false)
    setErrorMsg('')
    if (codeTimerRef.current) clearInterval(codeTimerRef.current)
  }

  /* ── Forgot Password ── */
  function showForgotPassword() {
    setShowForgotStep(true)
    setShowCodeStep(false)
    setErrorMsg('')
    setForgotEmail(email || '')
  }

  function backFromForgot() {
    setShowForgotStep(false)
    setShowForgotCodeForm(false)
    setForgotMsg('')
    setForgotCodeMsg('')
    setForgotEmail('')
    setForgotCode('')
    setForgotNewPass('')
  }

  async function forgotSendCodeFn() {
    const em = (forgotEmail || '').trim()
    if (!em || em.indexOf('@') < 1) {
      setForgotMsg('Enter a valid email')
      setForgotMsgColor('#ff8844')
      return
    }
    setForgotSendDisabled(true)
    setForgotSendText('Sending...')
    try {
      const res = await fetch('/auth/forgot-password/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em }),
      })
      const data = await res.json()
      setForgotSendDisabled(false)
      setForgotSendText('SEND RESET CODE')
      if (!res.ok) {
        setForgotMsg(data.error || 'Error')
        setForgotMsgColor('#ff4444')
        return
      }
      setForgotMsg('If the email exists, a code has been sent.')
      setForgotMsgColor('#00ff88')
      setShowForgotCodeForm(true)
    } catch {
      setForgotSendDisabled(false)
      setForgotSendText('SEND RESET CODE')
      setForgotMsg('Connection error')
      setForgotMsgColor('#ff4444')
    }
  }

  async function forgotConfirmCodeFn() {
    const em = (forgotEmail || '').trim()
    const cd = (forgotCode || '').trim()
    const np = forgotNewPass
    if (!cd || cd.length !== 6) { setForgotCodeMsg('Enter the 6-digit code'); setForgotCodeMsgColor('#ff8844'); return }
    if (!np || np.length < 12) { setForgotCodeMsg('Password must be at least 12 characters'); setForgotCodeMsgColor('#ff8844'); return }
    if (!/[a-z]/.test(np) || !/[A-Z]/.test(np) || !/\d/.test(np)) { setForgotCodeMsg('Must contain uppercase, lowercase and a digit'); setForgotCodeMsgColor('#ff8844'); return }
    setForgotConfirmDisabled(true)
    setForgotConfirmText('Verifying...')
    try {
      const res = await fetch('/auth/forgot-password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, code: cd, newPassword: np }),
      })
      const data = await res.json()
      setForgotConfirmDisabled(false)
      setForgotConfirmText('RESET PASSWORD')
      if (!res.ok) { setForgotCodeMsg(data.error || 'Error'); setForgotCodeMsgColor('#ff4444'); return }
      setForgotCodeMsg(data.message)
      setForgotCodeMsgColor('#00ff88')
      setTimeout(backFromForgot, 3000)
    } catch {
      setForgotConfirmDisabled(false)
      setForgotConfirmText('RESET PASSWORD')
      setForgotCodeMsg('Connection error')
      setForgotCodeMsgColor('#ff4444')
    }
  }

  /* ── Auth: Register ── */
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    const em = regEmail.trim()
    const pw = regPassword
    const cf = confirmPassword

    if (pw !== cf) { showRegError('Passwords do not match'); return }
    if (pw.length < 12) { showRegError('Password must be at least 12 characters'); return }
    if (!/[a-z]/.test(pw)) { showRegError('Must contain at least one lowercase letter'); return }
    if (!/[A-Z]/.test(pw)) { showRegError('Must contain at least one uppercase letter'); return }
    if (!/\d/.test(pw)) { showRegError('Password must contain at least one digit'); return }

    setRegisterBtnText('...')
    try {
      const res = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, password: pw }),
      })
      const data = await res.json()
      if (res.ok) {
        if (data.pending) {
          setRegisterErrorMsg('')
          setShowPendingMsg(true)
        } else {
          await checkAuth()
        }
      } else {
        showRegError(data.error || 'Unknown error')
      }
    } catch {
      showRegError('Connection error')
    } finally {
      setRegisterBtnText('REQUEST AN INVITE')
    }
  }

  /* ── Admin ── */
  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch('/auth/admin/users')
      const data = await res.json()
      if (!data.ok) return
      setUsers(data.users || [])
    } catch { /* */ }
  }, [])

  async function approveUser(userEmail: string) {
    if (!confirm('Approve user ' + userEmail + '?')) return
    try {
      const res = await fetch('/auth/admin/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userEmail }) })
      if (res.ok) loadUsers()
    } catch { alert('Error') }
  }

  async function deleteUser(userEmail: string) {
    if (!confirm('Delete user ' + userEmail + '?')) return
    try {
      const res = await fetch('/auth/admin/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userEmail }) })
      if (res.ok) loadUsers()
    } catch { alert('Error') }
  }

  /* ── Check if already logged in ── */
  useEffect(() => {
    async function checkExisting() {
      try {
        const res = await fetch('/auth/me')
        if (!res.ok) return
        const data = await res.json()
        if (data.role === 'admin' || data.ok) {
          await checkAuth()
        }
      } catch { /* not logged in */ }
    }
    checkExisting()
  }, [checkAuth])

  /* ── Live Market Tickers (WebSocket) ── */
  useEffect(() => {
    let retries = 0
    let ws: WebSocket | null = null
    let closed = false

    function connect() {
      if (closed) return
      const streams = PAIRS.map(p => p.sym + '@ticker').join('/')
      ws = new WebSocket('wss://fstream.binance.com/stream?streams=' + streams)
      ws.onopen = () => { retries = 0 }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          const d = msg.data
          if (!d || !d.s) return
          const pair = PAIRS.find(p => p.sym === d.s.toLowerCase())
          if (!pair) return
          const price = parseFloat(d.c)
          const change = parseFloat(d.P)
          const priceStr = price.toLocaleString('en-US', { minimumFractionDigits: pair.dec, maximumFractionDigits: pair.dec })
          const changeStr = (change >= 0 ? '+' : '') + change.toFixed(2) + '%'
          const isUp = change >= 0

          setTickerData(prev => ({
            ...prev,
            [pair.id]: { price: priceStr, change: changeStr, up: isUp },
          }))
          setSparkData(prev => {
            const arr = [...(prev[pair.id] || []), price]
            if (arr.length > 30) arr.shift()
            return { ...prev, [pair.id]: arr }
          })
        } catch { /* */ }
      }
      ws.onclose = () => {
        if (closed) return
        retries++
        if (retries >= 5) {
          setTickerVisible(false)
          return
        }
        setTimeout(connect, 3000)
      }
      ws.onerror = () => { ws?.close() }
    }
    connect()

    return () => {
      closed = true
      ws?.close()
    }
  }, [])

  /* ── Cleanup code timer on unmount ── */
  useEffect(() => {
    return () => {
      if (codeTimerRef.current) clearInterval(codeTimerRef.current)
    }
  }, [])

  /* ── Determine which fields to show in sign-in form ── */
  const showLoginFields = !showCodeStep && !showForgotStep

  return (
    <>
      {/* Animated Background */}
      <div className="bg-grid"></div>
      <Particles />
      <ChartBgCanvas />

      <div className="page">
        {/* Market Ticker Strip */}
        {tickerVisible && (
          <div className="ticker-strip" id="tickerStrip">
            {PAIRS.map(pair => (
              <div className="tick" key={pair.id} id={`tick${pair.id}`}>
                <div>
                  <div className="tick-pair">{pair.id} / USDT</div>
                  <div className="tick-price" id={`p${pair.id}`}>{tickerData[pair.id]?.price ?? '--'}</div>
                </div>
                <div className="tick-spark" id={`spark${pair.id}`}>
                  <SparkBars data={sparkData[pair.id] || []} />
                </div>
                <div className={`tick-change ${tickerData[pair.id]?.up ? 'up' : 'down'}`} id={`c${pair.id}`}>
                  {tickerData[pair.id]?.change ?? '--'}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Main Row: Login Card + Features */}
        <div className="main-row">
          {/* Sliding Login Card */}
          <div className={`container${active ? ' active' : ''}${shaking ? ' shake' : ''}`} id="loginBox">

            {/* REQUEST ACCESS (right side, hidden initially) */}
            <div className="form-container sign-up">
              <form id="registerForm" autoComplete="on" onSubmit={handleRegister}>
                <h1>Request Access</h1>
                <div className="subtitle">AI Trading Analytics Platform</div>
                <div className="error-msg" id="registerErrorMsg" style={{ display: registerErrorMsg ? 'block' : 'none' }}>{registerErrorMsg}</div>
                <div className="pending-msg" id="pendingMsg" style={{ display: showPendingMsg ? 'block' : 'none' }}>
                  Access request submitted.<br />
                  Your account is pending administrator approval.<br />
                  <span style={{ fontSize: '10px', color: '#445', marginTop: '6px', display: 'inline-block' }}>This is a private beta — approval is manual and may take time.</span>
                </div>
                <label>Email</label>
                <input type="email" id="regEmail" placeholder="you@example.com" required autoComplete="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} />
                <label>Password</label>
                <div className="pw-wrap">
                  <input type="password" id="regPassword" placeholder="Min 12 chars, A-z + digit" required autoComplete="new-password" ref={regPwRef} value={regPassword} onChange={e => setRegPassword(e.target.value)} />
                  <PwEye inputRef={regPwRef} />
                </div>
                <label>Confirm Password</label>
                <div className="pw-wrap">
                  <input type="password" id="confirmPassword" placeholder="Repeat password" autoComplete="new-password" ref={regConfirmRef} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
                  <PwEye inputRef={regConfirmRef} />
                </div>
                <button type="submit" className="main-btn" id="registerBtn">{registerBtnText}</button>
                <div className="link-line">Already have an account? <a id="backToLogin2" href="#" onClick={e => { e.preventDefault(); setActive(false) }}>Sign in</a></div>
                <div className="footer-note">Access requests are manually reviewed</div>
              </form>
            </div>

            {/* SIGN IN (left side, visible initially) */}
            <div className="form-container sign-in">
              <form id="authForm" autoComplete="on" onSubmit={handleSignIn}>
                <h1>Sign In</h1>
                <div className="subtitle">AI Trading Analytics Platform</div>
                <div id="adminStatus" style={{ display: adminStatus ? 'block' : 'none', fontSize: '10px', color: 'var(--cyan)', letterSpacing: '1px', marginBottom: '8px' }}>{adminStatus}</div>
                <div className="error-msg" id="errorMsg" style={{ display: errorMsg ? 'block' : 'none' }}>{errorMsg}</div>

                {/* Normal login fields */}
                <div id="loginFields" style={{ width: '100%', display: showLoginFields ? 'block' : 'none' }}>
                  <label>Email</label>
                  <input type="email" id="email" placeholder="you@example.com" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
                  <label>Password</label>
                  <div className="pw-wrap">
                    <input type="password" id="password" placeholder="Enter password" required autoComplete="current-password" ref={pwRef} value={password} onChange={e => setPassword(e.target.value)} />
                    <PwEye inputRef={pwRef} />
                  </div>
                  <button type="submit" className="main-btn" id="submitBtn">{submitText}</button>
                  <div className="link-line">Need access? <a href="#" id="goToRegister2" onClick={e => { e.preventDefault(); setActive(true) }}>Request an invite</a></div>
                  <a href="#" className="link" id="forgotLink" onClick={e => { e.preventDefault(); showForgotPassword() }}>Forgot password?</a>
                  <div className="footer-note">Access requests are manually reviewed</div>
                </div>

                {/* 2FA Code Step */}
                <div className="code-step" id="codeStep" style={{ display: showCodeStep ? 'block' : 'none' }}>
                  <div className="code-msg">Verification code sent to your email.<br />Enter the 6-digit code:</div>
                  <input
                    type="text"
                    className="code-input"
                    id="codeInput"
                    maxLength={6}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="------"
                    autoComplete="one-time-code"
                    value={codeValue}
                    onChange={e => setCodeValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); verifyCode() } }}
                    autoFocus={showCodeStep}
                  />
                  <div className="code-timer" id="codeTimer">{codeTimerText}</div>
                  <button type="button" className="main-btn" id="verifyBtn" onClick={verifyCode} style={{ marginTop: '14px' }}>{verifyText}</button>
                  <div className="code-resend" id="codeResend">
                    <a onClick={resendCode}>&#8635; Resend code</a> &nbsp;|&nbsp; <a onClick={backToLogin}>&#8592; Back</a>
                  </div>
                </div>

                {/* FORGOT PASSWORD STEP */}
                <div className="forgot-step" id="forgotStep" style={{ display: showForgotStep ? 'block' : 'none' }}>
                  <div className="code-msg" style={{ marginBottom: '12px' }}>Reset your password</div>
                  <div style={{ width: '100%' }}>
                    <label>Email address</label>
                    <input type="email" id="forgotEmail" placeholder="you@example.com" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} />
                  </div>
                  <button type="button" className="main-btn" id="forgotSendBtn" onClick={forgotSendCodeFn} disabled={forgotSendDisabled} style={{ marginBottom: '10px' }}>{forgotSendText}</button>
                  <div id="forgot-msg" style={{ fontSize: '10px', minHeight: '16px', marginBottom: '8px', color: forgotMsgColor }}>{forgotMsg}</div>
                  <div id="forgotCodeForm" style={{ display: showForgotCodeForm ? 'block' : 'none', width: '100%' }}>
                    <div style={{ width: '100%' }}>
                      <label>6-digit code</label>
                      <input
                        type="text"
                        className="code-input"
                        id="forgotCode"
                        maxLength={6}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="------"
                        autoComplete="one-time-code"
                        value={forgotCode}
                        onChange={e => setForgotCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      />
                    </div>
                    <div style={{ width: '100%', marginTop: '10px' }}>
                      <label>New password (min 12 chars, A-z + digit)</label>
                      <div className="pw-wrap">
                        <input type="password" id="forgotNewPass" placeholder="New password" ref={forgotNewPassRef} value={forgotNewPass} onChange={e => setForgotNewPass(e.target.value)} />
                        <PwEye inputRef={forgotNewPassRef} />
                      </div>
                    </div>
                    <button type="button" className="main-btn" id="forgotConfirmBtn" onClick={forgotConfirmCodeFn} disabled={forgotConfirmDisabled}>{forgotConfirmText}</button>
                    <div id="forgot-code-msg" style={{ fontSize: '10px', minHeight: '16px', marginTop: '6px', color: forgotCodeMsgColor }}>{forgotCodeMsg}</div>
                  </div>
                  <div className="code-resend" style={{ marginTop: '10px' }}>
                    <a onClick={backFromForgot}>&#8592; Back to login</a>
                  </div>
                </div>

                {/* Admin Panel */}
                <div className="admin-panel" id="adminPanel" style={{ display: showAdminPanel ? 'block' : 'none' }}>
                  <h3>Admin — User Management</h3>
                  <div id="usersList">
                    {users.map(u => (
                      <div className="user-row" key={u.email}>
                        <span className="email">{u.email}</span>
                        <span className={`badge ${u.role === 'admin' ? 'badge-admin' : u.approved ? 'badge-approved' : 'badge-pending'}`}>
                          {u.role === 'admin' ? 'ADMIN' : u.approved ? 'APPROVED' : 'PENDING'}
                        </span>
                        {u.role !== 'admin' && (
                          <div className="user-actions">
                            {!u.approved && (
                              <button className="btn-approve" onClick={() => approveUser(u.email)}>&#10003; APPROVE</button>
                            )}
                            <button className="btn-delete" onClick={() => deleteUser(u.email)}>&#10005; DELETE</button>
                          </div>
                        )}
                      </div>
                    ))}
                    {users.length <= 1 && (
                      <div className="no-pending">No other users registered</div>
                    )}
                  </div>
                </div>
              </form>
            </div>

            {/* SLIDING OVERLAY */}
            <div className="toggle-container">
              <div className="toggle">
                <div className="grid"></div>
                <div className="toggle-panel toggle-left">
                  <img className="logo-img" src="/assets/logo-zeus.jpg" alt="Zeus" />
                  <div className="brand">ZEU&apos;S</div>
                  <div className="tagline">AI Trading Analytics Platform</div>
                  <div className="features-text">Intelligence &middot; Signals &middot; Protection &middot; Execution Assistance</div>
                  <div className="beta-note">Private Beta &middot; Invite-Only<br />Access Subject to Approval</div>
                  <button type="button" className="ghost-btn" id="overlayLoginBtn" onClick={() => setActive(false)}>Sign In</button>
                </div>
                <div className="toggle-panel toggle-right">
                  <img className="logo-img" src="/assets/logo-zeus.jpg" alt="Zeus" />
                  <div className="brand">ZEU&apos;S</div>
                  <div className="tagline">AI Trading Analytics Platform</div>
                  <div className="features-text">Intelligence &middot; Signals &middot; Protection &middot; Execution Assistance</div>
                  <div className="beta-note">Private Beta &middot; Invite-Only<br />Access Subject to Approval</div>
                  <button type="button" className="ghost-btn" id="overlayRegisterBtn" onClick={() => setActive(true)}>Request an Invite</button>
                </div>
              </div>
            </div>
          </div>
          {/* END Login Card */}

          {/* System Modules */}
          <div className="features">
            {FEATURES.map((f, i) => (
              <div className={`feat-card ${f.mod}`} key={i}>
                <div className="feat-head">
                  <div className="feat-icon">{f.icon}</div>
                  <div className="feat-meta">
                    <span className="feat-chip">{f.chip}</span>
                    <span className="feat-label">{f.label}</span>
                  </div>
                </div>
                <div className="feat-desc">{f.desc}</div>
                <div className="feat-scan"></div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="footer">
          <div className="footer-left">&copy; {new Date().getFullYear()} Zeus Terminal</div>
          <div className="footer-right">
            <a href="/privacy.html">Privacy</a>
            <a href="/terms.html">Terms</a>
            <a href="/cookies.html">Cookies</a>
            <a href="/support.html">Support</a>
          </div>
        </div>
      </div>
    </>
  )
}
