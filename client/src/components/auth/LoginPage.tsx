import { useState } from 'react'
import { authApi } from '../../services/api'
import { useAuthStore } from '../../stores'

type Step = 'login' | 'register' | 'code'

export function LoginPage() {
  const [step, setStep] = useState<Step>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const checkAuth = useAuthStore((s) => s.checkAuth)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const res = await authApi.login(email, password)
    setLoading(false)
    if (res.ok) {
      if (res.data?.needsCode) {
        setStep('code')
        setInfo(res.data.message ?? 'Verification code sent to email.')
      } else {
        await checkAuth()
      }
    } else {
      setError(res.message || res.error || 'Login failed')
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirmPw) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 12) {
      setError('Password must be at least 12 characters')
      return
    }
    setLoading(true)
    const res = await authApi.register(email, password)
    setLoading(false)
    if (res.ok) {
      if (res.data?.role === 'admin') {
        await checkAuth()
      } else {
        setInfo('Account created. Waiting for admin approval.')
        setStep('login')
      }
    } else {
      setError(res.message || res.error || 'Registration failed')
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const res = await authApi.verifyCode(email, code)
    setLoading(false)
    if (res.ok) {
      await checkAuth()
    } else {
      setError(res.message || res.error || 'Invalid code')
    }
  }

  return (
    <div className="zr-login">
      <div className="zr-login__card">
        <h1 className="zr-login__title">Zeus Terminal</h1>

        {error && <div className="zr-login__error">{error}</div>}
        {info && <div className="zr-login__info">{info}</div>}

        {step === 'login' && (
          <form onSubmit={handleLogin}>
            <input
              className="zr-login__input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <input
              className="zr-login__input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button className="zr-login__btn" type="submit" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            <p className="zr-login__switch">
              No account?{' '}
              <button type="button" onClick={() => { setStep('register'); setError(null) }}>
                Register
              </button>
            </p>
          </form>
        )}

        {step === 'register' && (
          <form onSubmit={handleRegister}>
            <input
              className="zr-login__input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <input
              className="zr-login__input"
              type="password"
              placeholder="Password (min 12 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
            />
            <input
              className="zr-login__input"
              type="password"
              placeholder="Confirm password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              required
            />
            <button className="zr-login__btn" type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Account'}
            </button>
            <p className="zr-login__switch">
              Have an account?{' '}
              <button type="button" onClick={() => { setStep('login'); setError(null) }}>
                Sign In
              </button>
            </p>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleVerifyCode}>
            <input
              className="zr-login__input"
              type="text"
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              maxLength={6}
              autoFocus
            />
            <button className="zr-login__btn" type="submit" disabled={loading || code.length !== 6}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>
            <p className="zr-login__switch">
              <button type="button" onClick={() => { setStep('login'); setError(null) }}>
                Back to login
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
