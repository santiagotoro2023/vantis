import { useState, useEffect, FormEvent } from 'react'
import { api } from '../api'
import { Shield, ShieldCheck, Key, Copy, Check } from 'lucide-react'

export default function Settings() {
  const [username] = useState(() => localStorage.getItem('vantis_username') || '')

  // Password change
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwStatus, setPwStatus] = useState('')
  const [pwError, setPwError] = useState('')
  const [pwLoading, setPwLoading] = useState(false)

  // 2FA
  const [twoFaEnabled, setTwoFaEnabled] = useState(false)
  const [setupSecret, setSetupSecret] = useState('')
  const [setupUri, setSetupUri] = useState('')
  const [setupCode, setSetupCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [showing2faSetup, setShowing2faSetup] = useState(false)
  const [showing2faDisable, setShowing2faDisable] = useState(false)
  const [twoFaStatus, setTwoFaStatus] = useState('')
  const [twoFaError, setTwoFaError] = useState('')
  const [twoFaLoading, setTwoFaLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.get2faStatus().then(d => setTwoFaEnabled(d.enabled)).catch(() => {})
  }, [])

  const handlePasswordChange = async (e: FormEvent) => {
    e.preventDefault()
    setPwError('')
    setPwStatus('')
    if (newPw !== confirmPw) { setPwError('Passwords do not match.'); return }
    if (newPw.length < 8) { setPwError('Password must be at least 8 characters.'); return }
    setPwLoading(true)
    try {
      await api.changePassword(currentPw, newPw)
      setPwStatus('Password updated.')
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (err: unknown) {
      setPwError(err instanceof Error ? err.message : 'Failed.')
    } finally {
      setPwLoading(false)
    }
  }

  const start2faSetup = async () => {
    setTwoFaError('')
    setTwoFaLoading(true)
    try {
      const d = await api.setup2fa()
      setSetupSecret(d.secret)
      setSetupUri(d.uri)
      setShowing2faSetup(true)
    } catch (err: unknown) {
      setTwoFaError(err instanceof Error ? err.message : 'Setup failed.')
    } finally {
      setTwoFaLoading(false)
    }
  }

  const enable2fa = async (e: FormEvent) => {
    e.preventDefault()
    setTwoFaError('')
    setTwoFaLoading(true)
    try {
      await api.enable2fa(setupSecret, setupCode)
      setTwoFaEnabled(true)
      setShowing2faSetup(false)
      setSetupCode('')
      setTwoFaStatus('Two-factor authentication is now enabled.')
    } catch (err: unknown) {
      setTwoFaError(err instanceof Error ? err.message : 'Enable failed.')
    } finally {
      setTwoFaLoading(false)
    }
  }

  const disable2fa = async (e: FormEvent) => {
    e.preventDefault()
    setTwoFaError('')
    setTwoFaLoading(true)
    try {
      await api.disable2fa(disableCode)
      setTwoFaEnabled(false)
      setShowing2faDisable(false)
      setDisableCode('')
      setTwoFaStatus('Two-factor authentication disabled.')
    } catch (err: unknown) {
      setTwoFaError(err instanceof Error ? err.message : 'Failed.')
    } finally {
      setTwoFaLoading(false)
    }
  }

  const copySecret = () => {
    navigator.clipboard.writeText(setupSecret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <div className="border-b border-border pb-3">
        <h1 className="text-lg font-mono font-bold text-text-bright tracking-widest uppercase">Settings</h1>
        <p className="text-xs text-muted font-mono mt-1">Account security and authentication preferences.</p>
      </div>

      {/* Password Change */}
      <section className="border border-border bg-surface p-5 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Key size={14} className="text-accent" />
          <h2 className="text-sm font-mono font-bold text-text-bright uppercase tracking-wider">Change Password</h2>
        </div>

        {pwError && (
          <div className="border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger font-mono">{pwError}</div>
        )}
        {pwStatus && (
          <div className="border border-success/40 bg-success/5 px-3 py-2 text-xs text-success font-mono">{pwStatus}</div>
        )}

        <form onSubmit={handlePasswordChange} className="space-y-3">
          <div>
            <label className="block text-xs text-muted font-mono uppercase tracking-wider mb-1">Current Password</label>
            <input
              type="password"
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              className="w-full bg-void border border-border px-3 py-2 text-sm text-text font-mono focus:border-accent transition-colors"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-muted font-mono uppercase tracking-wider mb-1">New Password</label>
            <input
              type="password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              className="w-full bg-void border border-border px-3 py-2 text-sm text-text font-mono focus:border-accent transition-colors"
              minLength={8}
              required
            />
          </div>
          <div>
            <label className="block text-xs text-muted font-mono uppercase tracking-wider mb-1">Confirm New Password</label>
            <input
              type="password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              className="w-full bg-void border border-border px-3 py-2 text-sm text-text font-mono focus:border-accent transition-colors"
              required
            />
          </div>
          <button
            type="submit"
            disabled={pwLoading}
            className="border border-accent bg-transparent hover:bg-accent/10 disabled:opacity-40
                       text-accent font-mono px-4 py-2 text-xs uppercase tracking-widest transition-all"
          >
            {pwLoading ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </section>

      {/* 2FA */}
      <section className="border border-border bg-surface p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {twoFaEnabled ? <ShieldCheck size={14} className="text-success" /> : <Shield size={14} className="text-muted" />}
            <h2 className="text-sm font-mono font-bold text-text-bright uppercase tracking-wider">Two-Factor Authentication</h2>
          </div>
          <span className={`text-xs font-mono px-2 py-0.5 border ${twoFaEnabled ? 'border-success/40 text-success' : 'border-border text-muted'}`}>
            {twoFaEnabled ? 'ENABLED' : 'DISABLED'}
          </span>
        </div>

        {twoFaError && (
          <div className="border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger font-mono">{twoFaError}</div>
        )}
        {twoFaStatus && (
          <div className="border border-success/40 bg-success/5 px-3 py-2 text-xs text-success font-mono">{twoFaStatus}</div>
        )}

        {!twoFaEnabled && !showing2faSetup && (
          <div className="space-y-3">
            <p className="text-xs text-muted font-mono">
              Add a second layer of authentication using a TOTP app such as Google Authenticator, Authy, or 1Password.
            </p>
            <button
              onClick={start2faSetup}
              disabled={twoFaLoading}
              className="border border-accent bg-transparent hover:bg-accent/10 disabled:opacity-40
                         text-accent font-mono px-4 py-2 text-xs uppercase tracking-widest transition-all"
            >
              {twoFaLoading ? 'Loading...' : 'Enable 2FA'}
            </button>
          </div>
        )}

        {showing2faSetup && (
          <div className="space-y-4">
            <div className="border border-border bg-void p-4 space-y-3">
              <p className="text-xs text-muted font-mono">
                1. Open your authenticator app and add a new account.
              </p>
              <p className="text-xs text-muted font-mono">
                2. Enter this key manually, or scan with the app's QR scanner using the URI below.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-void border border-border px-3 py-2 text-sm text-accent font-mono tracking-widest break-all">
                  {setupSecret}
                </code>
                <button
                  onClick={copySecret}
                  className="p-2 border border-border text-muted hover:text-accent transition-colors shrink-0"
                  title="Copy secret"
                >
                  {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                </button>
              </div>
              <details className="text-xs">
                <summary className="text-muted font-mono cursor-pointer hover:text-text">Show OTP URI (advanced)</summary>
                <code className="block mt-2 text-[10px] text-muted/70 break-all font-mono">{setupUri}</code>
              </details>
            </div>

            <form onSubmit={enable2fa} className="space-y-3">
              <div>
                <label className="block text-xs text-muted font-mono uppercase tracking-wider mb-1">
                  Verify — Enter code from authenticator
                </label>
                <input
                  type="text"
                  value={setupCode}
                  onChange={e => setSetupCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full bg-void border border-border px-3 py-2 text-sm text-text font-mono
                             tracking-[0.4em] focus:border-accent transition-colors"
                  placeholder="000000"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  required
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setShowing2faSetup(false); setSetupCode(''); setSetupSecret(''); setSetupUri('') }}
                  className="flex-1 border border-border text-muted font-mono px-4 py-2 text-xs uppercase tracking-widest hover:text-text transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={twoFaLoading || setupCode.length !== 6}
                  className="flex-1 border border-accent bg-transparent hover:bg-accent/10 disabled:opacity-40
                             text-accent font-mono px-4 py-2 text-xs uppercase tracking-widest transition-all"
                >
                  {twoFaLoading ? 'Enabling...' : 'Enable 2FA'}
                </button>
              </div>
            </form>
          </div>
        )}

        {twoFaEnabled && !showing2faDisable && (
          <div className="space-y-3">
            <p className="text-xs text-muted font-mono">
              Two-factor authentication is active. Your account requires a TOTP code at each login.
            </p>
            <button
              onClick={() => setShowing2faDisable(true)}
              className="border border-danger/40 bg-transparent hover:bg-danger/5
                         text-danger/70 font-mono px-4 py-2 text-xs uppercase tracking-widest transition-all"
            >
              Disable 2FA
            </button>
          </div>
        )}

        {twoFaEnabled && showing2faDisable && (
          <form onSubmit={disable2fa} className="space-y-3">
            <div>
              <label className="block text-xs text-muted font-mono uppercase tracking-wider mb-1">
                Enter authenticator code to confirm
              </label>
              <input
                type="text"
                value={disableCode}
                onChange={e => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full bg-void border border-border px-3 py-2 text-sm text-text font-mono
                           tracking-[0.4em] focus:border-accent transition-colors"
                placeholder="000000"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                required
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setShowing2faDisable(false); setDisableCode('') }}
                className="flex-1 border border-border text-muted font-mono px-4 py-2 text-xs uppercase tracking-widest hover:text-text transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={twoFaLoading || disableCode.length !== 6}
                className="flex-1 border border-danger/40 bg-transparent hover:bg-danger/5 disabled:opacity-40
                           text-danger font-mono px-4 py-2 text-xs uppercase tracking-widest transition-all"
              >
                {twoFaLoading ? 'Disabling...' : 'Disable'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
