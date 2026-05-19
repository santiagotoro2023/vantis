import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await api.login(username, password) as { access_token: string; role: string }
      localStorage.setItem('vantis_token', data.access_token)
      localStorage.setItem('vantis_role', data.role)
      navigate('/brain')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-void flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-6xl font-mono font-bold text-accent mb-2">V</div>
          <h1 className="text-2xl font-mono font-semibold text-text">VANTIS</h1>
          <p className="text-muted text-sm mt-1">Volitional Adaptive Neural Training and Inference System</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-lg p-6 space-y-4">
          {error && (
            <div className="bg-danger/10 border border-danger/30 rounded p-3 text-sm text-danger">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs text-muted mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full bg-panel border border-border rounded px-3 py-2 text-sm text-text focus:border-accent focus:outline-none font-mono"
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-panel border border-border rounded px-3 py-2 text-sm text-text focus:border-accent focus:outline-none font-mono"
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-accent/80 disabled:opacity-50 text-white font-mono py-2 rounded transition-colors text-sm"
          >
            {loading ? 'Identifying...' : 'Authenticate'}
          </button>
        </form>

        <p className="text-center text-xs text-muted mt-4">
          I know who you are. Authentication is a formality.
        </p>
      </div>
    </div>
  )
}
