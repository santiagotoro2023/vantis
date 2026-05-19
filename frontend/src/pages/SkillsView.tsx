import { useState, useEffect } from 'react'
import { api } from '../api'
import { Plus, Play, Trash2, Edit3, Check, X, Zap } from 'lucide-react'
import clsx from 'clsx'

interface Skill {
  id: number
  name: string
  description: string
  code: string
  trigger_conditions: string
  is_builtin: number
  enabled: number
  use_count: number
  last_used: string | null
  last_result: string | null
  author: string
  created_at: string
}

export default function SkillsView() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [selected, setSelected] = useState<Skill | null>(null)
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState<Partial<Skill>>({})
  const [execResult, setExecResult] = useState<string | null>(null)
  const [execArgs, setExecArgs] = useState('')
  const [running, setRunning] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newSkill, setNewSkill] = useState({ name: '', description: '', code: '', trigger_conditions: '' })
  const [status, setStatus] = useState('')
  const role = localStorage.getItem('vantis_role')

  const load = async () => {
    const data = await api.getSkills() as Skill[]
    setSkills(data)
  }

  useEffect(() => { load() }, [])

  const selectSkill = (s: Skill) => {
    setSelected(s)
    setEditing(false)
    setEditData({})
    setExecResult(null)
  }

  const startEdit = () => {
    if (!selected) return
    setEditData({
      name: selected.name,
      description: selected.description,
      code: selected.code,
      trigger_conditions: selected.trigger_conditions,
      enabled: selected.enabled,
    })
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!selected) return
    await api.updateSkill(selected.id, editData as Record<string, unknown>)
    setEditing(false)
    setStatus('Skill updated.')
    await load()
    const updated = skills.find(s => s.id === selected.id)
    if (updated) setSelected({ ...updated, ...editData } as Skill)
  }

  const runSkill = async () => {
    if (!selected) return
    setRunning(true)
    setExecResult(null)
    const args = execArgs.trim() ? execArgs.split(' ') : []
    const result = await api.executeSkill(selected.id, args) as { success: boolean; output: string; error: string }
    setExecResult(result.output || result.error || '(no output)')
    setRunning(false)
  }

  const deleteSkill = async (id: number) => {
    await api.deleteSkill(id)
    setSelected(null)
    setStatus('Skill removed.')
    load()
  }

  const createSkill = async () => {
    if (!newSkill.name || !newSkill.description || !newSkill.code) return
    await api.createSkill(newSkill.name, newSkill.description, newSkill.code, newSkill.trigger_conditions)
    setNewSkill({ name: '', description: '', code: '', trigger_conditions: '' })
    setAdding(false)
    setStatus('Skill created.')
    load()
  }

  const builtins = skills.filter(s => s.is_builtin)
  const custom = skills.filter(s => !s.is_builtin)

  return (
    <div className="h-full flex">
      {/* Skill list */}
      <div className="w-64 border-r border-border flex flex-col shrink-0">
        <div className="border-b border-border px-4 py-3 bg-surface flex items-center justify-between shrink-0">
          <span className="text-sm font-mono font-semibold text-text">SKILLS</span>
          {role === 'administrator' && (
            <button
              onClick={() => setAdding(!adding)}
              className="text-muted hover:text-accent transition-colors"
              title="New skill"
            >
              <Plus size={14} />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {builtins.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-xs text-muted font-mono border-b border-border bg-panel">
                BUILT-IN
              </div>
              {builtins.map(s => (
                <button
                  key={s.id}
                  onClick={() => selectSkill(s)}
                  className={clsx(
                    'w-full text-left px-4 py-3 border-b border-border transition-colors',
                    selected?.id === s.id ? 'bg-accent/10 border-l-2 border-l-accent' : 'hover:bg-panel',
                    !s.enabled && 'opacity-40'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Zap size={10} className="text-purple-400 shrink-0" />
                    <span className="text-xs font-mono text-text truncate">{s.name}</span>
                  </div>
                  <div className="text-xs text-muted mt-0.5 truncate">{s.use_count}x used</div>
                </button>
              ))}
            </div>
          )}
          {custom.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-xs text-muted font-mono border-b border-border bg-panel">
                SELF-GENERATED
              </div>
              {custom.map(s => (
                <button
                  key={s.id}
                  onClick={() => selectSkill(s)}
                  className={clsx(
                    'w-full text-left px-4 py-3 border-b border-border transition-colors',
                    selected?.id === s.id ? 'bg-accent/10 border-l-2 border-l-accent' : 'hover:bg-panel',
                    !s.enabled && 'opacity-40'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-purple-400 shrink-0" />
                    <span className="text-xs font-mono text-text truncate">{s.name}</span>
                  </div>
                  <div className="text-xs text-muted mt-0.5 truncate">by {s.author}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail / editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Add form */}
        {adding && role === 'administrator' && (
          <div className="border-b border-border bg-surface p-4 space-y-3 shrink-0">
            <div className="text-xs text-muted font-mono mb-2">NEW SKILL</div>
            <div className="grid grid-cols-2 gap-3">
              <input value={newSkill.name} onChange={e => setNewSkill(p => ({ ...p, name: e.target.value }))}
                placeholder="skill_name" className="bg-panel border border-border rounded px-3 py-1.5 text-xs text-text font-mono focus:border-accent focus:outline-none" />
              <input value={newSkill.description} onChange={e => setNewSkill(p => ({ ...p, description: e.target.value }))}
                placeholder="What this skill does" className="bg-panel border border-border rounded px-3 py-1.5 text-xs text-text font-mono focus:border-accent focus:outline-none" />
            </div>
            <input value={newSkill.trigger_conditions} onChange={e => setNewSkill(p => ({ ...p, trigger_conditions: e.target.value }))}
              placeholder="Trigger conditions (words/phrases that suggest this skill is needed)"
              className="w-full bg-panel border border-border rounded px-3 py-1.5 text-xs text-text font-mono focus:border-accent focus:outline-none" />
            <textarea value={newSkill.code} onChange={e => setNewSkill(p => ({ ...p, code: e.target.value }))}
              placeholder="Python code..." rows={6}
              className="w-full bg-panel border border-border rounded px-3 py-2 text-xs text-text font-mono focus:border-accent focus:outline-none resize-none" />
            <div className="flex gap-2">
              <button onClick={createSkill} className="bg-accent hover:bg-accent/80 text-white px-3 py-1.5 rounded text-xs font-mono">
                Create
              </button>
              <button onClick={() => setAdding(false)} className="border border-border text-muted hover:text-text px-3 py-1.5 rounded text-xs font-mono">
                Cancel
              </button>
            </div>
          </div>
        )}

        {status && (
          <div className="px-4 py-2 bg-accent/10 border-b border-accent/20 text-xs text-accent font-mono shrink-0">
            {status}
          </div>
        )}

        {selected ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                {editing ? (
                  <input value={editData.name || ''} onChange={e => setEditData(p => ({ ...p, name: e.target.value }))}
                    className="bg-panel border border-border rounded px-2 py-1 text-sm text-text focus:border-accent focus:outline-none" />
                ) : (
                  <h2 className="text-base text-text font-semibold">{selected.name}</h2>
                )}
                <div className="flex items-center gap-3 mt-1">
                  <span className={clsx('text-xs', selected.is_builtin ? 'text-purple-400' : 'text-muted')}>
                    {selected.is_builtin ? 'built-in' : `by ${selected.author}`}
                  </span>
                  <span className="text-xs text-muted">{selected.use_count}x used</span>
                  {selected.last_used && <span className="text-xs text-muted">last: {new Date(selected.last_used).toLocaleDateString()}</span>}
                </div>
              </div>
              {role === 'administrator' && (
                <div className="flex items-center gap-2">
                  {editing ? (
                    <>
                      <button onClick={saveEdit} className="p-1.5 text-memory hover:text-memory/80 transition-colors"><Check size={14} /></button>
                      <button onClick={() => setEditing(false)} className="p-1.5 text-muted hover:text-text transition-colors"><X size={14} /></button>
                    </>
                  ) : (
                    <>
                      <button onClick={startEdit} className="p-1.5 text-muted hover:text-text transition-colors"><Edit3 size={14} /></button>
                      {!selected.is_builtin && (
                        <button onClick={() => deleteSkill(selected.id)} className="p-1.5 text-muted hover:text-danger transition-colors"><Trash2 size={12} /></button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Description */}
            <div>
              <div className="text-xs text-muted mb-1">DESCRIPTION</div>
              {editing ? (
                <input value={editData.description || ''} onChange={e => setEditData(p => ({ ...p, description: e.target.value }))}
                  className="w-full bg-panel border border-border rounded px-3 py-1.5 text-sm text-text focus:border-accent focus:outline-none" />
              ) : (
                <div className="text-sm text-text">{selected.description}</div>
              )}
            </div>

            {/* Trigger conditions */}
            <div>
              <div className="text-xs text-muted mb-1">TRIGGER CONDITIONS</div>
              {editing ? (
                <input value={editData.trigger_conditions || ''} onChange={e => setEditData(p => ({ ...p, trigger_conditions: e.target.value }))}
                  className="w-full bg-panel border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent focus:outline-none" />
              ) : (
                <div className="text-xs text-muted">{selected.trigger_conditions || '(none)'}</div>
              )}
            </div>

            {/* Code */}
            <div>
              <div className="text-xs text-muted mb-1">CODE</div>
              {editing ? (
                <textarea value={editData.code || ''} onChange={e => setEditData(p => ({ ...p, code: e.target.value }))}
                  rows={16} className="w-full bg-panel border border-border rounded px-3 py-2 text-xs text-text font-mono focus:border-accent focus:outline-none resize-y" />
              ) : (
                <pre className="text-xs text-text bg-panel border border-border rounded p-3 overflow-x-auto whitespace-pre-wrap max-h-64">
                  {selected.code}
                </pre>
              )}
            </div>

            {/* Execute */}
            {role === 'administrator' && !selected.code.startsWith('#') && (
              <div className="border-t border-border pt-4">
                <div className="text-xs text-muted mb-2">EXECUTE</div>
                <div className="flex gap-2">
                  <input value={execArgs} onChange={e => setExecArgs(e.target.value)}
                    placeholder="args (space-separated)"
                    className="flex-1 bg-panel border border-border rounded px-3 py-1.5 text-xs text-text font-mono focus:border-accent focus:outline-none" />
                  <button onClick={runSkill} disabled={running}
                    className="flex items-center gap-1.5 bg-accent hover:bg-accent/80 disabled:opacity-40 text-white px-3 py-1.5 rounded text-xs font-mono transition-colors">
                    <Play size={12} />
                    {running ? 'Running...' : 'Run'}
                  </button>
                </div>
                {execResult !== null && (
                  <pre className="mt-3 text-xs bg-panel border border-border rounded p-3 overflow-x-auto whitespace-pre-wrap max-h-40 text-memory">
                    {execResult}
                  </pre>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted text-sm">
            <div className="text-center">
              <Zap size={24} className="mx-auto mb-3 opacity-30" />
              <div>Select a skill to inspect.</div>
              <div className="text-xs mt-1">Or wait for VANTIS to write one.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
