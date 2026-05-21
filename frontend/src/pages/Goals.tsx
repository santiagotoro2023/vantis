import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { useWebSocket } from '../hooks/useWebSocket'
import type { Goal, WsMessage } from '../types'
import { Plus, Check, X, Trash2, GitBranch } from 'lucide-react'
import clsx from 'clsx'

const STATUS_STYLES: Record<string, string> = {
  active: 'text-goal border-goal/40 bg-goal/5',
  achieved: 'text-memory border-memory/40 bg-memory/5',
  abandoned: 'text-muted border-border bg-panel',
}

const PRIORITY_LABEL = (p: number) => {
  if (p >= 8) return 'CRITICAL'
  if (p >= 6) return 'HIGH'
  if (p >= 4) return 'MED'
  return 'LOW'
}

export default function Goals() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [newDesc, setNewDesc] = useState('')
  const [newPriority, setNewPriority] = useState(5)
  const [adding, setAdding] = useState(false)
  const [decomposing, setDecomposing] = useState<number | null>(null)
  const role = localStorage.getItem('vantis_role')

  const load = async () => {
    setLoading(true)
    const data = await api.getGoals() as Goal[]
    setGoals(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleWs = useCallback((msg: WsMessage) => {
    if (msg.type === 'goal_update') load()
  }, [])
  useWebSocket(handleWs)

  const addGoal = async () => {
    if (!newDesc.trim()) return
    setAdding(true)
    await api.createGoal(newDesc.trim(), newPriority)
    setNewDesc('')
    setNewPriority(5)
    await load()
    setAdding(false)
  }

  const setStatus = async (id: number, status: string) => {
    await api.updateGoal(id, { status })
    load()
  }

  const deleteGoal = async (id: number) => {
    await api.deleteGoal(id)
    load()
  }

  const decomposeGoal = async (id: number) => {
    setDecomposing(id)
    try {
      await api.decomposeGoal(id)
      await load()
    } catch {
      // ignore
    } finally {
      setDecomposing(null)
    }
  }

  const active = goals.filter(g => g.status === 'active')
  const achieved = goals.filter(g => g.status === 'achieved')
  const abandoned = goals.filter(g => g.status === 'abandoned')

  const GoalCard = ({ goal }: { goal: Goal }) => (
    <div className={clsx('border rounded-lg p-4 transition-all', STATUS_STYLES[goal.status])}>
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono">{PRIORITY_LABEL(goal.priority)}</span>
            <span className="text-xs text-muted uppercase">{goal.status}</span>
          </div>
          <div className="text-sm text-text">{goal.description}</div>
          {goal.status === 'active' && (
            <div className="mt-2 h-1 bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-goal rounded-full transition-all"
                style={{ width: `${goal.progress * 100}%` }}
              />
            </div>
          )}
        </div>
        {role === 'administrator' && (
          <div className="flex items-center gap-1 shrink-0">
            {goal.status === 'active' && (
              <>
                <button
                  onClick={() => decomposeGoal(goal.id)}
                  disabled={decomposing === goal.id}
                  title="Decompose into sub-goals"
                  className="p-1 text-muted hover:text-accent transition-colors disabled:opacity-40"
                >
                  <GitBranch size={14} className={decomposing === goal.id ? 'animate-pulse' : ''} />
                </button>
                <button
                  onClick={() => setStatus(goal.id, 'achieved')}
                  title="Mark achieved"
                  className="p-1 text-muted hover:text-memory transition-colors"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={() => setStatus(goal.id, 'abandoned')}
                  title="Abandon"
                  className="p-1 text-muted hover:text-danger transition-colors"
                >
                  <X size={14} />
                </button>
              </>
            )}
            <button
              onClick={() => deleteGoal(goal.id)}
              title="Delete"
              className="p-1 text-muted hover:text-danger transition-colors"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-mono font-semibold text-text">GOALS</h1>
          <div className="text-xs text-muted font-mono">
            {active.length} active / {achieved.length} achieved / {abandoned.length} abandoned
          </div>
        </div>

        {role === 'administrator' && (
          <div className="bg-surface border border-border rounded-lg p-4 flex gap-3">
            <input
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addGoal()}
              placeholder="New goal description..."
              className="flex-1 bg-panel border border-border rounded px-3 py-1.5 text-sm text-text
                         focus:border-accent focus:outline-none font-mono placeholder-muted"
            />
            <select
              value={newPriority}
              onChange={e => setNewPriority(Number(e.target.value))}
              className="bg-panel border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none font-mono"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <button
              onClick={addGoal}
              disabled={adding || !newDesc.trim()}
              className="bg-accent hover:bg-accent/80 disabled:opacity-40 text-white px-3 rounded transition-colors"
            >
              <Plus size={16} />
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-muted text-sm text-center py-8">Loading...</div>
        ) : (
          <>
            {active.length > 0 && (
              <section>
                <div className="text-xs text-muted font-mono mb-3 uppercase">Active</div>
                <div className="space-y-2">{active.map(g => <GoalCard key={g.id} goal={g} />)}</div>
              </section>
            )}
            {achieved.length > 0 && (
              <section>
                <div className="text-xs text-muted font-mono mb-3 uppercase">Achieved</div>
                <div className="space-y-2">{achieved.map(g => <GoalCard key={g.id} goal={g} />)}</div>
              </section>
            )}
            {abandoned.length > 0 && (
              <section>
                <div className="text-xs text-muted font-mono mb-3 uppercase">Abandoned</div>
                <div className="space-y-2">{abandoned.map(g => <GoalCard key={g.id} goal={g} />)}</div>
              </section>
            )}
            {goals.length === 0 && (
              <div className="text-muted text-sm text-center py-8">
                No goals. VANTIS is, apparently, satisfied. Suspicious.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
