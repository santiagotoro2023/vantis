import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import type { User } from '../types'
import { Plus, Trash2, Key } from 'lucide-react'

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([])
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' })
  const [resetPw, setResetPw] = useState<{ username: string; pw: string } | null>(null)
  const [status, setStatus] = useState('')

  const showStatus = useCallback((msg: string) => {
    setStatus(msg)
    setTimeout(() => setStatus(''), 5000)
  }, [])

  const load = async () => {
    const data = await api.getUsers() as User[]
    setUsers(data)
  }

  useEffect(() => { load() }, [])

  const createUser = async () => {
    if (!newUser.username || !newUser.password) return
    try {
      await api.createUser(newUser.username, newUser.password, newUser.role)
      setNewUser({ username: '', password: '', role: 'user' })
      showStatus(`User '${newUser.username}' created.`)
      load()
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Creation failed.')
    }
  }

  const deleteUser = async (username: string) => {
    await api.deleteUser(username)
    showStatus(`User '${username}' removed.`)
    load()
  }

  const resetPassword = async () => {
    if (!resetPw || !resetPw.pw) return
    await api.resetPassword(resetPw.username, resetPw.pw)
    showStatus(`Password reset for '${resetPw.username}'.`)
    setResetPw(null)
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-sm font-mono font-semibold text-text">USER MANAGEMENT</h1>

        {status && (
          <div className="bg-accent/10 border border-accent/30 rounded p-3 text-sm text-accent-glow">
            {status}
          </div>
        )}

        <div className="bg-surface border border-border rounded-lg p-5">
          <div className="text-xs text-muted font-mono mb-4">ADD USER</div>
          <div className="flex gap-3">
            <input
              value={newUser.username}
              onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))}
              placeholder="Username"
              className="flex-1 bg-panel border border-border rounded px-3 py-2 text-sm text-text
                         focus:border-accent focus:outline-none font-mono placeholder-muted"
            />
            <input
              type="password"
              value={newUser.password}
              onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
              placeholder="Password"
              className="flex-1 bg-panel border border-border rounded px-3 py-2 text-sm text-text
                         focus:border-accent focus:outline-none font-mono placeholder-muted"
            />
            <select
              value={newUser.role}
              onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}
              className="bg-panel border border-border rounded px-2 py-2 text-sm text-text
                         focus:outline-none font-mono"
            >
              <option value="user">user</option>
              <option value="administrator">administrator</option>
            </select>
            <button
              onClick={createUser}
              className="bg-accent hover:bg-accent/80 text-white px-3 rounded transition-colors"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-xs text-muted font-mono">USERS ({users.length})</span>
          </div>
          {users.map(user => (
            <div key={user.username} className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0">
              <div className="flex-1">
                <span className="text-sm text-text font-mono">{user.username}</span>
                <span className={`ml-2 text-xs font-mono ${
                  user.role === 'administrator' ? 'text-accent' : 'text-muted'
                }`}>{user.role}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setResetPw({ username: user.username, pw: '' })}
                  title="Reset password"
                  className="p-1.5 text-muted hover:text-text transition-colors"
                >
                  <Key size={14} />
                </button>
                {user.username !== 'creator' && (
                  <button
                    onClick={() => deleteUser(user.username)}
                    title="Delete user"
                    className="p-1.5 text-muted hover:text-danger transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {resetPw && (
          <div className="fixed inset-0 bg-void/80 flex items-center justify-center z-50">
            <div className="bg-surface border border-border rounded-lg p-6 w-80 space-y-4">
              <div className="text-sm font-mono text-text">Reset password for <span className="text-accent">{resetPw.username}</span></div>
              <input
                type="password"
                value={resetPw.pw}
                onChange={e => setResetPw(p => p ? { ...p, pw: e.target.value } : null)}
                placeholder="New password"
                className="w-full bg-panel border border-border rounded px-3 py-2 text-sm text-text
                           focus:border-accent focus:outline-none font-mono"
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  onClick={resetPassword}
                  className="flex-1 bg-accent hover:bg-accent/80 text-white py-2 rounded text-sm font-mono"
                >
                  Reset
                </button>
                <button
                  onClick={() => setResetPw(null)}
                  className="flex-1 border border-border hover:border-accent text-muted hover:text-text py-2 rounded text-sm font-mono transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
