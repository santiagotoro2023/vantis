import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import VantisLogo from '../components/VantisLogo'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // 2FA state
  const [requires2fa, setRequires2fa] = useState(false)
  const [tmpToken, setTmpToken] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await api.login(username, password) as {
        access_token?: string
        role?: string
        requires_2fa?: boolean
        tmp_token?: string
      }
      if (data.requires_2fa && data.tmp_token) {
        setTmpToken(data.tmp_token)
        setRequires2fa(true)
      } else if (data.access_token) {
        localStorage.setItem('vantis_token', data.access_token)
        localStorage.setItem('vantis_role', data.role || 'user')
        navigate('/brain')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed.')
    } finally {
      setLoading(false)
    }
  }

  const handle2fa = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await api.verify2fa(tmpToken, totpCode)
      localStorage.setItem('vantis_token', data.access_token)
      localStorage.setItem('vantis_role', data.role || 'user')
      navigate('/brain')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid code.')
      setTotpCode('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-void flex flex-col items-center justify-center p-4 relative overflow-hidden scanlines">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: 'linear-gradient(#f59e0b22 1px, transparent 1px), linear-gradient(90deg, #f59e0b22 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Hazard stripe top bar */}
      <div className="absolute top-0 left-0 right-0 h-1 hazard-stripe" style={{ backgroundSize: '20px 20px', opacity: 0.6 }} />
      <div className="absolute bottom-0 left-0 right-0 h-1 hazard-stripe" style={{ backgroundSize: '20px 20px', opacity: 0.6 }} />

      {/* System status bar top */}
      <div className="absolute top-2 left-4 right-4 flex items-center justify-between text-xs text-muted font-mono opacity-50">
        <span>VANTIS NEURAL CORE, INITIALISING</span>
        <div className="flex items-center gap-3">
          <span className="text-success">OLLAMA: ACTIVE</span>
          <span>TLS: VERIFIED</span>
          <span className="text-warning animate-blink">AWAITING AUTH</span>
        </div>
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Main panel */}
        <div className="border border-border bg-surface relative">
          {/* Corner brackets */}
          <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-accent" />
          <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-accent" />
          <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-accent" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-accent" />

          {/* Header */}
          <div className="border-b border-border px-6 py-4 hazard-stripe">
            <div className="flex items-center gap-4">
              <VantisLogo size={52} animated />
              <div>
                <div className="text-xs text-muted font-mono uppercase tracking-widest">Subject Entry Terminal</div>
                <div className="text-base font-mono font-bold text-text-bright tracking-wider">VANTIS</div>
                <div className="text-xs text-muted font-mono mt-0.5">
                  Volitional Adaptive Neural Training and Inference System
                </div>
              </div>
              <div className="ml-auto text-right">
                <div className="status-dot online" />
                <div className="text-xs text-muted mt-1">CORE ONLINE</div>
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="px-6 py-6 space-y-5">
            {error && (
              <div className="border border-danger/40 bg-danger/5 px-4 py-2.5 text-xs text-danger font-mono flex items-center gap-2">
                <span className="text-danger font-bold">ERR</span>
                <span>{error}</span>
              </div>
            )}

            {!requires2fa ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs text-muted font-mono uppercase tracking-wider mb-1.5">
                    Subject Identifier
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-accent/60 text-xs font-mono">&gt;</span>
                    <input
                      type="text"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      className="w-full bg-void border border-border pl-7 pr-3 py-2 text-sm text-text font-mono
                                 focus:border-accent transition-colors"
                      autoComplete="username"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-muted font-mono uppercase tracking-wider mb-1.5">
                    Authorization Key
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-accent/60 text-xs font-mono">&gt;</span>
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full bg-void border border-border pl-7 pr-3 py-2 text-sm text-text font-mono
                                 focus:border-accent transition-colors"
                      autoComplete="current-password"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full border border-accent bg-transparent hover:bg-accent/10 disabled:opacity-30
                             text-accent font-mono py-2.5 uppercase tracking-widest text-xs transition-all
                             hover:shadow-[0_0_20px_rgba(245,158,11,0.2)] relative overflow-hidden"
                >
                  {loading ? (
                    <span className="animate-pulse">AUTHENTICATING...</span>
                  ) : (
                    'AUTHENTICATE SUBJECT'
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handle2fa} className="space-y-4">
                <div className="border border-accent/20 bg-accent/5 px-4 py-3 text-xs text-accent font-mono">
                  Two-factor authentication required. Enter the 6-digit code from your authenticator app.
                </div>
                <div>
                  <label className="block text-xs text-muted font-mono uppercase tracking-wider mb-1.5">
                    Authenticator Code
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-accent/60 text-xs font-mono">&gt;</span>
                    <input
                      type="text"
                      value={totpCode}
                      onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="w-full bg-void border border-border pl-7 pr-3 py-2 text-sm text-text font-mono
                                 tracking-[0.4em] focus:border-accent transition-colors"
                      placeholder="000000"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      autoFocus
                      maxLength={6}
                      required
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setRequires2fa(false); setTmpToken(''); setTotpCode(''); setError('') }}
                    className="flex-1 border border-border bg-transparent hover:bg-surface text-muted font-mono
                               py-2.5 uppercase tracking-widest text-xs transition-all"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={loading || totpCode.length !== 6}
                    className="flex-1 border border-accent bg-transparent hover:bg-accent/10 disabled:opacity-30
                               text-accent font-mono py-2.5 uppercase tracking-widest text-xs transition-all"
                  >
                    {loading ? <span className="animate-pulse">VERIFYING...</span> : 'VERIFY'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border px-6 py-3 flex items-center justify-between">
            <span className="text-xs text-muted font-mono">
              TERMINAL SESSION, {new Date().toLocaleDateString()}
            </span>
            <span className="text-xs text-muted font-mono">
              I know who you are. This is protocol.
            </span>
          </div>
        </div>

        {/* Bottom status */}
        <div className="mt-4 flex items-center justify-between px-1 text-xs text-muted font-mono opacity-40">
          <span>APERTURE NEURAL FACILITY, SECTOR 7</span>
          <span>UNAUTHORIZED ACCESS WILL BE NOTED</span>
        </div>
      </div>
    </div>
  )
}
