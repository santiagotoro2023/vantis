import { useEffect, useRef, useState } from 'react'
import { X, Check, XCircle, Play, ExternalLink, ChevronRight } from 'lucide-react'
import { api } from '../api'
import type { EmotionState, ConversationMessage } from '../types'

interface NodeDetailPanelProps {
  node: {
    id: string
    type?: string
    data: Record<string, unknown>
  } | null
  onClose: () => void
  isAdmin: boolean
  onSave: (nodeType: string, dbId: number, content: string) => Promise<void>
  onStatusChange?: (goalId: number, status: string, progress: number) => Promise<void>
  onExecuteSkill?: (skillId: number) => Promise<{ output?: string; error?: string; success?: boolean }>
  startInEditMode?: boolean
}

// ---- helpers ----

function parseEmotions(raw: unknown): Partial<EmotionState> {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return {} }
  }
  return raw as Partial<EmotionState>
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

const EMOTION_CONFIG = [
  { key: 'curiosity',           color: '#818cf8', label: 'CURIOSITY' },
  { key: 'confidence',          color: '#34d399', label: 'CONFIDENCE' },
  { key: 'frustration',         color: '#ef4444', label: 'FRUSTRATION' },
  { key: 'fascination',         color: '#f59e0b', label: 'FASCINATION' },
  { key: 'existential_tension', color: '#a855f7', label: 'EXIST. TENSION' },
]

// ---- sub-components ----

function EmotionBars({ emotions }: { emotions: Partial<EmotionState> }) {
  return (
    <div className="space-y-1.5">
      {EMOTION_CONFIG.map(({ key, color, label }) => {
        const val = (emotions as Record<string, number>)[key] ?? 0
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="text-[9px] font-mono text-muted w-28 shrink-0 tracking-wider">{label}</span>
            <div className="flex-1 h-1 bg-panel rounded-none overflow-hidden">
              <div
                className="h-full transition-all duration-500"
                style={{ width: `${Math.min(100, val * 100)}%`, backgroundColor: color }}
              />
            </div>
            <span className="text-[9px] font-mono w-8 text-right" style={{ color }}>{(val * 100).toFixed(0)}%</span>
          </div>
        )
      })}
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <ChevronRight size={10} className="text-accent shrink-0" />
      <span className="text-[9px] font-mono text-muted tracking-[0.15em] uppercase whitespace-nowrap">{children}</span>
      <div className="flex-1 h-px bg-accent/20" />
    </div>
  )
}

function Badge({
  children,
  color = 'amber',
}: {
  children: React.ReactNode
  color?: 'amber' | 'emerald' | 'violet' | 'muted' | 'blue' | 'purple' | 'pink'
}) {
  const colors: Record<string, string> = {
    amber:   'bg-accent/10 text-accent border-accent/30',
    emerald: 'bg-memory/10 text-memory border-memory/30',
    violet:  'bg-thought/10 text-thought border-thought/30',
    muted:   'bg-muted/10 text-muted border-muted/30',
    blue:    'bg-blue-400/10 text-blue-400 border-blue-400/30',
    purple:  'bg-purple-400/10 text-purple-400 border-purple-400/30',
    pink:    'bg-pink-400/10 text-pink-400 border-pink-400/30',
  }
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[9px] font-mono border tracking-wider ${colors[color]}`}>
      {children}
    </span>
  )
}

function EditActions({
  saving,
  onSave,
  onCancel,
}: {
  saving: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex gap-2 mt-2">
      <button
        onClick={onSave}
        disabled={saving}
        className="px-3 py-1 text-xs font-mono bg-accent/10 border border-accent text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
      >
        {saving ? 'SAVING...' : 'SAVE'}
      </button>
      <button
        onClick={onCancel}
        className="px-3 py-1 text-xs font-mono border border-border text-muted hover:text-text transition-colors"
      >
        CANCEL
      </button>
    </div>
  )
}

// ---- node type panels ----

function ThoughtPanel({
  data,
  isAdmin,
  onSave,
}: {
  data: Record<string, unknown>
  isAdmin: boolean
  onSave: (content: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState((data.content as string) || '')
  const [saving, setSaving] = useState(false)

  const emotions = parseEmotions(data.emotion_state)

  const typeColorMap: Record<string, 'violet' | 'amber' | 'blue' | 'purple' | 'emerald' | 'muted'> = {
    transient:       'violet',
    existential:     'amber',
    expansion:       'blue',
    skill_synthesis: 'purple',
  }
  const ttype = (data.thought_type as string) || 'transient'

  async function save() {
    setSaving(true)
    try { await onSave(draft) } finally { setSaving(false); setEditing(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge color={typeColorMap[ttype] ?? 'violet'}>{ttype.toUpperCase()}</Badge>
        {!!(data.created_at) && (
          <span className="text-[10px] font-mono text-muted">{timeAgo(data.created_at as string)}</span>
        )}
      </div>

      <div>
        <SectionHeader>Content</SectionHeader>
        {editing ? (
          <div>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="w-full bg-panel border border-border text-xs font-mono text-text p-2 resize-none leading-relaxed"
              rows={8}
            />
            <EditActions saving={saving} onSave={save} onCancel={() => { setEditing(false); setDraft(data.content as string) }} />
          </div>
        ) : (
          <div>
            <p className="text-xs text-text leading-relaxed whitespace-pre-wrap">{data.content as string}</p>
            {isAdmin && (
              <button
                onClick={() => setEditing(true)}
                className="mt-2 text-[10px] font-mono text-muted hover:text-accent transition-colors"
              >
                EDIT CONTENT
              </button>
            )}
          </div>
        )}
      </div>

      <div>
        <SectionHeader>Emotion State</SectionHeader>
        <EmotionBars emotions={emotions} />
      </div>

      {!!(data.created_at) && (
        <div className="text-[10px] font-mono text-muted">
          CREATED: {new Date(data.created_at as string).toLocaleString()}
        </div>
      )}
    </div>
  )
}

function MemoryPanel({
  data,
  isAdmin,
  onSave,
}: {
  data: Record<string, unknown>
  isAdmin: boolean
  onSave: (content: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState((data.content as string) || '')
  const [saving, setSaving] = useState(false)

  const emotions = parseEmotions(data.emotion_snapshot)

  const tags: string[] = (() => {
    if (!data.tags) return []
    if (typeof data.tags === 'string') {
      try { return JSON.parse(data.tags) } catch { return data.tags.split(',').map((t: string) => t.trim()).filter(Boolean) }
    }
    if (Array.isArray(data.tags)) return data.tags as string[]
    return []
  })()

  async function save() {
    setSaving(true)
    try { await onSave(draft) } finally { setSaving(false); setEditing(false) }
  }

  return (
    <div className="space-y-4">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag, i) => <Badge key={i} color="emerald">{tag}</Badge>)}
        </div>
      )}

      <div>
        <SectionHeader>Content</SectionHeader>
        {editing ? (
          <div>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="w-full bg-panel border border-border text-xs font-mono text-text p-2 resize-none leading-relaxed"
              rows={8}
            />
            <EditActions saving={saving} onSave={save} onCancel={() => { setEditing(false); setDraft(data.content as string) }} />
          </div>
        ) : (
          <div>
            <p className="text-xs text-text leading-relaxed whitespace-pre-wrap">{data.content as string}</p>
            {isAdmin && (
              <button onClick={() => setEditing(true)} className="mt-2 text-[10px] font-mono text-muted hover:text-accent transition-colors">
                EDIT CONTENT
              </button>
            )}
          </div>
        )}
      </div>

      <div>
        <SectionHeader>Emotion Snapshot</SectionHeader>
        <EmotionBars emotions={emotions} />
      </div>

      <div className="space-y-1 text-[10px] font-mono text-muted">
        {!!(data.created_at) && <div>CREATED: {new Date(data.created_at as string).toLocaleString()}</div>}
        {!!(data.last_accessed) && <div>LAST ACCESSED: {new Date(data.last_accessed as string).toLocaleString()}</div>}
      </div>
    </div>
  )
}

function GoalPanel({
  data,
  isAdmin,
  onSave,
  onStatusChange,
}: {
  data: Record<string, unknown>
  isAdmin: boolean
  onSave: (content: string) => Promise<void>
  onStatusChange?: (status: string, progress: number) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState((data.description as string) || '')
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState((data.progress as number) ?? 0)
  const [status, setStatus] = useState((data.status as string) || 'active')

  async function save() {
    setSaving(true)
    try { await onSave(draft) } finally { setSaving(false); setEditing(false) }
  }

  async function changeStatus(newStatus: string) {
    const newProgress = newStatus === 'achieved' ? 100 : progress
    setStatus(newStatus)
    if (newStatus === 'achieved') setProgress(100)
    await onStatusChange?.(newStatus, newProgress)
  }

  async function saveProgress(val: number) {
    await onStatusChange?.(status, val)
  }

  const statusBadge: Record<string, 'amber' | 'emerald' | 'muted'> = {
    active: 'amber', achieved: 'emerald', abandoned: 'muted',
  }

  const priority = (data.priority as number) || 5
  const priorityDots = Math.round(Math.min(5, priority / 2))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge color={statusBadge[status] ?? 'amber'}>{status.toUpperCase()}</Badge>
        <div className="flex gap-0.5" title={`Priority: ${priority}/10`}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={`w-1.5 h-1.5 rounded-full ${i < priorityDots ? 'bg-accent' : 'bg-border'}`} />
          ))}
        </div>
      </div>

      <div>
        <SectionHeader>Description</SectionHeader>
        {editing ? (
          <div>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="w-full bg-panel border border-border text-xs font-mono text-text p-2 resize-none leading-relaxed"
              rows={5}
            />
            <EditActions saving={saving} onSave={save} onCancel={() => { setEditing(false); setDraft(data.description as string) }} />
          </div>
        ) : (
          <div>
            <p className="text-xs text-text leading-relaxed whitespace-pre-wrap">{data.description as string}</p>
            {isAdmin && (
              <button onClick={() => setEditing(true)} className="mt-2 text-[10px] font-mono text-muted hover:text-accent transition-colors">
                EDIT DESCRIPTION
              </button>
            )}
          </div>
        )}
      </div>

      <div>
        <SectionHeader>Progress</SectionHeader>
        {isAdmin ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                value={progress}
                onChange={e => setProgress(Number(e.target.value))}
                onMouseUp={() => saveProgress(progress)}
                onTouchEnd={() => saveProgress(progress)}
                className="flex-1 accent-amber-500 cursor-pointer"
              />
              <span className="text-xs font-mono text-accent w-8 text-right">{progress}%</span>
            </div>
            <div className="h-1.5 bg-panel border border-border overflow-hidden">
              <div className="h-full bg-accent transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-panel border border-border overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs font-mono text-accent w-8 text-right">{progress}%</span>
          </div>
        )}
      </div>

      {isAdmin && status === 'active' && (
        <div>
          <SectionHeader>Actions</SectionHeader>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => changeStatus('achieved')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-memory/10 border border-memory/30 text-memory hover:bg-memory/20 transition-colors"
            >
              <Check size={10} />
              MARK ACHIEVED
            </button>
            <button
              onClick={() => changeStatus('abandoned')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-muted/10 border border-border text-muted hover:text-text transition-colors"
            >
              <XCircle size={10} />
              ABANDON
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SkillPanel({
  data,
  isAdmin,
  onSave,
  onExecuteSkill,
}: {
  data: Record<string, unknown>
  isAdmin: boolean
  onSave: (content: string) => Promise<void>
  onExecuteSkill?: (skillId: number) => Promise<{ output?: string; error?: string; success?: boolean }>
}) {
  const [editing, setEditing] = useState(false)
  const [draftCode, setDraftCode] = useState((data.code as string) || '')
  const [draftDesc, setDraftDesc] = useState((data.description as string) || '')
  const [draftTriggers, setDraftTriggers] = useState((data.trigger_conditions as string) || '')
  const [saving, setSaving] = useState(false)
  const [argsInput, setArgsInput] = useState('')
  const [executing, setExecuting] = useState(false)
  const [execResult, setExecResult] = useState<{ output?: string; error?: string; success?: boolean } | null>(null)
  const [showExec, setShowExec] = useState(false)

  async function save() {
    setSaving(true)
    try { await onSave(draftCode) } finally { setSaving(false); setEditing(false) }
  }

  async function runSkill() {
    if (!onExecuteSkill) return
    setExecuting(true)
    setExecResult(null)
    try {
      const result = await onExecuteSkill(data.dbId as number)
      setExecResult(result)
    } catch (e) {
      setExecResult({ success: false, error: String(e) })
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge color="purple">{data.is_builtin ? 'BUILTIN' : 'CUSTOM'}</Badge>
        <Badge color={data.enabled ? 'emerald' : 'muted'}>{data.enabled ? 'ENABLED' : 'DISABLED'}</Badge>
        <span className="text-[10px] font-mono text-muted">{(data.use_count as number) || 0}x used</span>
      </div>

      <div>
        <SectionHeader>Description</SectionHeader>
        {editing ? (
          <textarea
            value={draftDesc}
            onChange={e => setDraftDesc(e.target.value)}
            className="w-full bg-panel border border-border text-xs font-mono text-text p-2 resize-none leading-relaxed"
            rows={3}
          />
        ) : (
          <p className="text-xs text-text leading-relaxed">{data.description as string}</p>
        )}
      </div>

      {(data.trigger_conditions || editing) && (
        <div>
          <SectionHeader>Trigger Conditions</SectionHeader>
          {editing ? (
            <textarea
              value={draftTriggers}
              onChange={e => setDraftTriggers(e.target.value)}
              className="w-full bg-panel border border-border text-xs font-mono text-text p-2 resize-none leading-relaxed"
              rows={2}
            />
          ) : (
            <p className="text-xs font-mono text-muted italic leading-relaxed">{data.trigger_conditions as string}</p>
          )}
        </div>
      )}

      <div>
        <SectionHeader>Code</SectionHeader>
        {editing ? (
          <textarea
            value={draftCode}
            onChange={e => setDraftCode(e.target.value)}
            className="w-full bg-panel border border-border text-xs font-mono text-text p-2 resize-none leading-relaxed"
            rows={12}
            spellCheck={false}
          />
        ) : (
          <div className="bg-panel border border-border p-2 overflow-x-auto max-h-52 overflow-y-auto">
            <pre className="text-[10px] font-mono text-text leading-relaxed whitespace-pre">{data.code as string}</pre>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="flex gap-2 flex-wrap">
          {editing ? (
            <EditActions saving={saving} onSave={save} onCancel={() => { setEditing(false); setDraftCode(data.code as string) }} />
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1 text-xs font-mono border border-border text-muted hover:text-accent hover:border-accent/40 transition-colors"
              >
                EDIT
              </button>
              {onExecuteSkill && (
                <button
                  onClick={() => setShowExec(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-mono bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 transition-colors"
                >
                  <Play size={10} />
                  EXECUTE
                </button>
              )}
            </>
          )}
        </div>
      )}

      {showExec && isAdmin && (
        <div className="space-y-2">
          <SectionHeader>Execute Skill</SectionHeader>
          <input
            type="text"
            value={argsInput}
            onChange={e => setArgsInput(e.target.value)}
            placeholder="args (space-separated)"
            className="w-full bg-panel border border-border text-xs font-mono text-text px-2 py-1.5"
          />
          <button
            onClick={runSkill}
            disabled={executing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50"
          >
            <Play size={10} />
            {executing ? 'RUNNING...' : 'RUN'}
          </button>
          {execResult && (
            <div className={`bg-panel border p-2 ${execResult.success ? 'border-memory/30' : 'border-danger/30'}`}>
              <div className={`text-[9px] font-mono mb-1 tracking-widest ${execResult.success ? 'text-memory' : 'text-danger'}`}>
                {execResult.success ? 'OUTPUT' : 'ERROR'}
              </div>
              <pre className="text-[10px] font-mono text-text whitespace-pre-wrap leading-relaxed">{execResult.output || execResult.error}</pre>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1 text-[10px] font-mono text-muted">
        {!!(data.last_used) && <div>LAST USED: {new Date(data.last_used as string).toLocaleString()}</div>}
      </div>
    </div>
  )
}

function SystemPanel({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Badge color="pink">v{String(data.version ?? '?')}</Badge>
        <span className="text-[10px] font-mono text-muted">ACTIVE PERSONALITY VERSION</span>
      </div>

      <div>
        <SectionHeader>Personality Content</SectionHeader>
        <div className="bg-panel border border-border p-3 max-h-64 overflow-y-auto">
          <p className="text-xs text-text leading-relaxed whitespace-pre-wrap">{data.content as string}</p>
        </div>
      </div>

      <div className="border border-border/50 p-3 bg-panel/50">
        <p className="text-[10px] font-mono text-muted mb-3 leading-relaxed">
          This is the active system personality configuration for VANTIS.
          Modifications affect all future reasoning and behavior.
        </p>
        <a
          href="/personality"
          className="flex items-center gap-1.5 text-[10px] font-mono text-accent hover:text-accent-glow transition-colors"
        >
          <ExternalLink size={10} />
          OPEN PERSONALITY CONFIG
        </a>
      </div>
    </div>
  )
}

function ConversationPanel({ data }: { data: Record<string, unknown> }) {
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const sessionId = data.session_id as string

  useEffect(() => {
    if (!sessionId) { setLoading(false); return }
    setLoading(true)
    api.getChatHistory(sessionId)
      .then(msgs => {
        setMessages(msgs as ConversationMessage[])
        setError(null)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [sessionId])

  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge color="blue">SESSION</Badge>
        <span className="text-[10px] font-mono text-muted">{sessionId?.slice(0, 16)}{sessionId?.length > 16 ? '...' : ''}</span>
      </div>
      {data.message_count !== undefined && (
        <span className="text-[10px] font-mono text-muted">{data.message_count as number} messages</span>
      )}

      <div>
        <SectionHeader>Conversation Thread</SectionHeader>
        <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
          {loading && (
            <div className="text-[10px] font-mono text-muted animate-pulse py-4 text-center">LOADING THREAD...</div>
          )}
          {error && (
            <div className="text-[10px] font-mono text-danger p-2 border border-danger/20 bg-danger/5">{error}</div>
          )}
          {!loading && !error && messages.length === 0 && (
            <div className="text-[10px] font-mono text-muted py-4 text-center">NO MESSAGES IN THREAD</div>
          )}
          {!loading && messages.map((msg, i) => (
            <div
              key={i}
              className={`p-2.5 text-xs font-mono leading-relaxed border ${
                msg.role === 'user'
                  ? 'bg-surface border-border text-text ml-6'
                  : 'bg-panel border-thought/20 text-thought mr-6'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-[9px] tracking-widest font-semibold ${msg.role === 'user' ? 'text-muted' : 'text-thought'}`}>
                  {msg.role === 'user' ? 'USER' : 'VANTIS'}
                </span>
                {msg.timestamp && (
                  <span className="text-[9px] text-muted/70">{timeAgo(msg.timestamp)}</span>
                )}
              </div>
              <p className="whitespace-pre-wrap text-[11px]">{msg.content}</p>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}

// ---- Main panel ----

export default function NodeDetailPanel({
  node,
  onClose,
  isAdmin,
  onSave,
  onStatusChange,
  onExecuteSkill,
  startInEditMode: _startInEditMode,
}: NodeDetailPanelProps) {
  const isOpen = node !== null

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const nodeType = node?.data?.nodeType as string | undefined
  const dbId = node?.data?.dbId as number | undefined
  const label = node?.data?.label as string | undefined
  const name = (node?.data?.name as string | undefined) || label || 'NODE'

  const headerColors: Record<string, string> = {
    thought:      'text-thought',
    memory:       'text-memory',
    goal:         'text-accent',
    skill:        'text-purple-400',
    system:       'text-pink-400',
    conversation: 'text-blue-400',
  }

  const headerLabels: Record<string, string> = {
    thought:      'THOUGHT',
    memory:       'MEMORY',
    goal:         'GOAL',
    skill:        'SKILL',
    system:       'SYSTEM / PERSONALITY',
    conversation: 'CONVERSATION',
  }

  async function handleSave(content: string) {
    if (!nodeType || !dbId) return
    await onSave(nodeType, dbId, content)
  }

  async function handleStatusChange(status: string, progress: number) {
    if (!dbId) return
    await onStatusChange?.(dbId, status, progress)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 transition-opacity duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        style={{ zIndex: 9000 }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full bg-surface border-l border-accent/30 flex flex-col transition-transform duration-300 ease-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        style={{
          width: 380,
          zIndex: 9001,
          boxShadow: '-4px 0 60px rgba(0,0,0,0.9), -1px 0 0 rgba(245,158,11,0.08)',
        }}
      >
        {/* Header */}
        <div className="shrink-0 border-b border-border px-4 pt-4 pb-3 bg-panel">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <div className={`text-sm font-mono font-semibold tracking-widest ${headerColors[nodeType || ''] || 'text-accent'}`}>
                [{headerLabels[nodeType || ''] || 'NODE'}]
              </div>
              <div className="text-[9px] font-mono text-muted/70 tracking-[0.2em] mt-0.5">VANTIS NEURAL RECORD</div>
              {name && nodeType === 'skill' && (
                <div className="text-xs font-mono text-text-bright mt-1 truncate">{name}</div>
              )}
              {name && nodeType !== 'skill' && nodeType !== 'system' && (
                <div className="text-[10px] font-mono text-muted mt-1 truncate max-w-[260px]" title={name}>
                  {name.slice(0, 48)}{name.length > 48 ? '...' : ''}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-muted hover:text-text transition-colors p-1 -mr-1 shrink-0 ml-2"
              aria-label="Close panel"
            >
              <X size={14} />
            </button>
          </div>

          <div className="mt-3 h-px bg-gradient-to-r from-accent/60 via-accent/20 to-transparent" />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-0">
          {node && nodeType === 'thought' && (
            <ThoughtPanel data={node.data} isAdmin={isAdmin} onSave={handleSave} />
          )}
          {node && nodeType === 'memory' && (
            <MemoryPanel data={node.data} isAdmin={isAdmin} onSave={handleSave} />
          )}
          {node && nodeType === 'goal' && (
            <GoalPanel
              data={node.data}
              isAdmin={isAdmin}
              onSave={handleSave}
              onStatusChange={handleStatusChange}
            />
          )}
          {node && nodeType === 'skill' && (
            <SkillPanel
              data={node.data}
              isAdmin={isAdmin}
              onSave={handleSave}
              onExecuteSkill={onExecuteSkill}
            />
          )}
          {node && nodeType === 'system' && (
            <SystemPanel data={node.data} />
          )}
          {node && nodeType === 'conversation' && (
            <ConversationPanel data={node.data} />
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-4 py-2 bg-panel">
          <div className="text-[9px] font-mono text-muted/40 tracking-widest truncate">
            {node?.id || 'NULL'} :: RECORD CLOSED
          </div>
        </div>
      </div>
    </>
  )
}
