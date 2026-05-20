import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  Handle,
  Position,
  NodeProps,
  ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { RefreshCw, Filter, Wifi, WifiOff, LayoutGrid, Circle, Search, FileText } from 'lucide-react'
import { api } from '../api'
import { useWebSocket } from '../hooks/useWebSocket'
import EmotionBar from '../components/EmotionBar'
import ContextMenu from '../components/ContextMenu'
import NodeDetailPanel from '../components/NodeDetailPanel'
import type { EmotionState, WsMessage } from '../types'

// ---- helpers ----

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

const EMOTION_COLORS = ['#818cf8', '#34d399', '#ef4444', '#f59e0b', '#a855f7']
const EMOTION_KEYS = ['curiosity', 'confidence', 'frustration', 'fascination', 'existential_tension']

function parseEmotions(raw: unknown): Record<string, number> {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return {} }
  }
  return raw as Record<string, number>
}

function EmotionMiniBars({ emotions }: { emotions: Record<string, number> }) {
  return (
    <div className="flex gap-0.5 items-end" style={{ height: 10 }}>
      {EMOTION_KEYS.map((key, i) => {
        const val = Math.min(1, Math.max(0, emotions[key] ?? 0))
        return (
          <div
            key={key}
            style={{
              width: 6,
              height: Math.max(2, val * 10),
              backgroundColor: EMOTION_COLORS[i],
              opacity: 0.8,
              flexShrink: 0,
            }}
          />
        )
      })}
    </div>
  )
}

function layoutNodes(nodes: Node[]): Node[] {
  const typeZones: Record<string, { x: number; y: number }> = {
    thought:      { x: -400, y: 0 },
    memory:       { x: 400,  y: 0 },
    goal:         { x: 0,    y: -300 },
    skill:        { x: 0,    y: 300 },
    system:       { x: 600,  y: -300 },
    conversation: { x: -600, y: 300 },
  }
  const counts: Record<string, number> = {}
  return nodes.map(n => {
    const nt = (n.data?.nodeType as string) || 'thought'
    counts[nt] = (counts[nt] || 0) + 1
    const zone = typeZones[nt] ?? { x: 0, y: 0 }
    const i = counts[nt]
    return {
      ...n,
      position: {
        x: zone.x + (i % 4) * 220 + (Math.random() - 0.5) * 40,
        y: zone.y + Math.floor(i / 4) * 180 + (Math.random() - 0.5) * 30,
      },
    }
  })
}

// ---- custom node components (defined OUTSIDE BrainView) ----

function ThoughtNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown>
  const isWriting = d.isWriting as boolean | undefined
  const highlighted = d.highlighted as boolean | undefined
  const ttype = (d.thought_type as string) || 'transient'
  const emotions = parseEmotions(d.emotion_state)
  const score = (d.importance_score as number | undefined) ?? 0.5
  const color = '#818cf8'
  const baseWidth = 220
  const width = Math.round(baseWidth * (0.85 + score * 0.3))
  const opacity = score < 0.3 ? 0.6 : 1

  const typeLabel: Record<string, string> = {
    transient:       'THOUGHT',
    existential:     'EXISTENTIAL',
    expansion:       'EXPANSION',
    skill_synthesis: 'SYNTHESIS',
  }

  const glowShadow = highlighted
    ? '0 0 0 2px #f59e0b'
    : selected
    ? '0 0 0 1px rgba(245,158,11,0.3)'
    : score > 0.7
    ? `0 0 ${8 + score * 12}px ${color}40`
    : undefined

  return (
    <div
      className={`bg-surface border rounded-lg p-3 shadow-lg transition-transform hover:scale-[1.02] cursor-pointer
        ${isWriting ? 'border-accent animate-[vantis-writing_1.2s_ease-in-out_infinite]' : 'border-thought/40'}
        ${selected ? 'border-l-2 border-l-accent' : ''}
      `}
      style={{ width, opacity, boxShadow: glowShadow }}
    >
      <Handle type="target" position={Position.Top} className="!bg-thought !border-thought/60 !w-1.5 !h-1.5" />
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-mono text-thought tracking-widest">{typeLabel[ttype] || 'THOUGHT'}</span>
        {!!(d.created_at) && !isWriting && (
          <span className="text-[9px] font-mono text-muted/60">{timeAgo(d.created_at as string)}</span>
        )}
      </div>
      {isWriting ? (
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-mono text-accent">GENERATING</span>
          <span className="text-accent animate-[blink_1s_step-end_infinite]">_</span>
        </div>
      ) : (
        <>
          <div className="text-[11px] text-text leading-relaxed mb-2 line-clamp-3">
            {((d.label || d.content) as string || '').slice(0, 80)}
            {((d.label || d.content) as string || '').length > 80 ? '...' : ''}
          </div>
          <EmotionMiniBars emotions={emotions} />
        </>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-thought !border-thought/60 !w-1.5 !h-1.5" />
    </div>
  )
}

function MemoryNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown>
  const highlighted = d.highlighted as boolean | undefined
  const emotions = parseEmotions(d.emotion_snapshot)
  const tags: string[] = (() => {
    if (!d.tags) return []
    if (typeof d.tags === 'string') { try { return JSON.parse(d.tags) } catch { return d.tags.split(',').map((t: string) => t.trim()).filter(Boolean) } }
    if (Array.isArray(d.tags)) return d.tags as string[]
    return []
  })()
  const freq = Math.min(8, Math.max(2, Math.round((d.use_count as number || 1) / 2)))
  const score = (d.importance_score as number | undefined) ?? 0.5
  const color = '#34d399'
  const baseWidth = 220
  const width = Math.round(baseWidth * (0.85 + score * 0.3))
  const opacity = score < 0.3 ? 0.6 : 1
  const glowShadow = highlighted
    ? '0 0 0 2px #f59e0b'
    : selected
    ? '0 0 0 1px rgba(245,158,11,0.3)'
    : score > 0.7
    ? `0 0 ${8 + score * 12}px ${color}40`
    : undefined

  return (
    <div
      className={`bg-surface border rounded-lg p-3 shadow-lg transition-transform hover:scale-[1.02] cursor-pointer
        border-memory/40 ${selected ? 'border-l-2 border-l-accent' : ''}
      `}
      style={{ width, opacity, boxShadow: glowShadow }}
    >
      <Handle type="target" position={Position.Top} className="!bg-memory !border-memory/60 !w-1.5 !h-1.5" />
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-mono text-memory tracking-widest">MEMORY</span>
        <div
          className="rounded-full bg-memory/40"
          style={{ width: freq, height: freq }}
          title={`Accessed ${d.use_count || 0} times`}
        />
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-0.5 mb-1.5">
          {tags.slice(0, 3).map((tag, i) => (
            <span key={i} className="text-[8px] font-mono px-1 bg-memory/10 text-memory/80 border border-memory/20">{tag}</span>
          ))}
        </div>
      )}
      <div className="text-[11px] text-text leading-relaxed mb-2 line-clamp-3">
        {((d.label || d.content) as string || '').slice(0, 80)}
        {((d.label || d.content) as string || '').length > 80 ? '...' : ''}
      </div>
      <EmotionMiniBars emotions={emotions} />
      {!!(d.created_at) && (
        <div className="text-[9px] font-mono text-muted/60 mt-1.5">{timeAgo(d.created_at as string)}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-memory !border-memory/60 !w-1.5 !h-1.5" />
    </div>
  )
}

function GoalNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown>
  const highlighted = d.highlighted as boolean | undefined
  const status = (d.status as string) || 'active'
  const progress = (d.progress as number) ?? 0
  const priority = (d.priority as number) || 5
  const priorityDots = Math.round(Math.min(5, priority / 2))
  const score = (d.importance_score as number | undefined) ?? 0.5
  const color = '#f59e0b'
  const baseWidth = 220
  const width = Math.round(baseWidth * (0.85 + score * 0.3))
  const opacity = score < 0.3 ? 0.6 : 1
  const glowShadow = highlighted
    ? '0 0 0 2px #f59e0b'
    : selected
    ? '0 0 0 1px rgba(245,158,11,0.3)'
    : score > 0.7
    ? `0 0 ${8 + score * 12}px ${color}40`
    : undefined

  const borderCls = status === 'active' ? 'border-accent/50' : status === 'achieved' ? 'border-memory/50' : 'border-border'
  const headerCls = status === 'active' ? 'text-accent' : status === 'achieved' ? 'text-memory' : 'text-muted'

  return (
    <div
      className={`bg-surface border rounded-lg p-3 shadow-lg transition-transform hover:scale-[1.02] cursor-pointer
        ${borderCls} ${selected ? 'border-l-2 border-l-accent' : ''}
      `}
      style={{ width, opacity, boxShadow: glowShadow }}
    >
      <Handle type="target" position={Position.Top} className="!w-1.5 !h-1.5" />
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-[9px] font-mono tracking-widest ${headerCls}`}>GOAL</span>
        <div className="flex gap-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={`w-1 h-1 rounded-full ${i < priorityDots ? 'bg-accent' : 'bg-border'}`} />
          ))}
        </div>
      </div>
      <div className={`text-[8px] font-mono mb-1.5 tracking-wider ${headerCls}/80`}>{status.toUpperCase()}</div>
      <div className="text-[11px] text-text leading-relaxed mb-2 line-clamp-3">
        {((d.label || d.description) as string || '').slice(0, 80)}
        {((d.label || d.description) as string || '').length > 80 ? '...' : ''}
      </div>
      <div className="h-0.5 bg-border overflow-hidden">
        <div
          className={`h-full transition-all ${status === 'achieved' ? 'bg-memory' : 'bg-accent'}`}
          style={{ width: `${Math.min(100, progress)}%` }}
        />
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-1.5 !h-1.5" />
    </div>
  )
}

function SkillNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown>
  const enabled = d.enabled !== false
  const isBuiltin = d.is_builtin as boolean | undefined
  const highlighted = d.highlighted as boolean | undefined

  return (
    <div
      className={`bg-surface border rounded-lg p-3 shadow-lg transition-transform hover:scale-[1.02] cursor-pointer
        border-purple-500/40 ${!enabled ? 'opacity-40' : ''} ${selected ? 'border-l-2 border-l-accent' : ''}
      `}
      style={{ width: 180, boxShadow: highlighted ? '0 0 0 2px #f59e0b' : selected ? '0 0 0 1px rgba(245,158,11,0.3)' : undefined }}
    >
      <Handle type="target" position={Position.Top} className="!bg-purple-500 !border-purple-500/60 !w-1.5 !h-1.5" />
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-mono text-purple-400 tracking-widest">SKILL</span>
        <span className={`text-[8px] font-mono px-1 border ${isBuiltin ? 'border-purple-500/30 text-purple-400/70' : 'border-memory/30 text-memory/70'}`}>
          {isBuiltin ? 'BUILTIN' : 'CUSTOM'}
        </span>
      </div>
      <div className="text-xs font-mono text-text-bright mb-1 truncate">{(d.name || d.label) as string}</div>
      <div className="text-[10px] text-muted line-clamp-2">{d.description as string}</div>
      <div className="text-[9px] font-mono text-muted/60 mt-1.5">{(d.use_count as number) || 0}x used</div>
      <Handle type="source" position={Position.Bottom} className="!bg-purple-500 !border-purple-500/60 !w-1.5 !h-1.5" />
    </div>
  )
}

function SystemNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown>
  const highlighted = d.highlighted as boolean | undefined
  return (
    <div
      className={`bg-surface border rounded-lg p-3 shadow-lg transition-transform hover:scale-[1.02] cursor-pointer
        border-pink-500/40 ${selected ? 'border-l-2 border-l-accent' : ''}
      `}
      style={{ width: 180, boxShadow: highlighted ? '0 0 0 2px #f59e0b' : selected ? '0 0 0 1px rgba(245,158,11,0.3)' : undefined }}
    >
      <Handle type="target" position={Position.Top} className="!bg-pink-500 !border-pink-500/60 !w-1.5 !h-1.5" />
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-mono text-pink-400 tracking-widest">SYSTEM</span>
        {!!(d.version) && <span className="text-[9px] font-mono text-muted">v{d.version as string}</span>}
      </div>
      <div className="text-[11px] text-text leading-relaxed line-clamp-3">{(d.label || d.content) as string}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-pink-500 !border-pink-500/60 !w-1.5 !h-1.5" />
    </div>
  )
}

function ConversationNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown>
  const highlighted = d.highlighted as boolean | undefined
  const sessionId = (d.session_id as string) || ''
  return (
    <div
      className={`bg-surface border rounded-lg p-3 shadow-lg transition-transform hover:scale-[1.02] cursor-pointer
        border-blue-400/40 ${selected ? 'border-l-2 border-l-accent' : ''}
      `}
      style={{ width: 180, boxShadow: highlighted ? '0 0 0 2px #f59e0b' : selected ? '0 0 0 1px rgba(245,158,11,0.3)' : undefined }}
    >
      <Handle type="target" position={Position.Top} className="!bg-blue-400 !border-blue-400/60 !w-1.5 !h-1.5" />
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-mono text-blue-400 tracking-widest">CONVERSATION</span>
        <span className="text-[9px] font-mono text-muted">{(d.message_count as number) || 0} msgs</span>
      </div>
      <div className="text-[10px] font-mono text-muted mb-1.5">{sessionId.slice(0, 8)}</div>
      {!!(d.last_message) && (
        <div className="text-[10px] text-muted/80 line-clamp-2 italic">{(d.last_message as string).slice(0, 60)}</div>
      )}
      {!!(d.started) && (
        <div className="text-[9px] font-mono text-muted/50 mt-1.5">{timeAgo(d.started as string)}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-blue-400 !border-blue-400/60 !w-1.5 !h-1.5" />
    </div>
  )
}

function WritingNode({ data }: NodeProps) {
  const d = data as Record<string, unknown>
  const emotions = parseEmotions(d.emotion_state)
  return (
    <div
      className="bg-surface border rounded-lg p-3 shadow-lg"
      style={{
        width: 180,
        animation: 'vantis-writing 1.2s ease-in-out infinite',
        boxShadow: '0 0 0 1px rgba(245,158,11,0.4), 0 0 20px rgba(245,158,11,0.15)',
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-accent !border-accent/60 !w-1.5 !h-1.5" />
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[9px] font-mono text-accent tracking-widest">GENERATING</span>
        <span className="text-accent text-xs" style={{ animation: 'blink 1s step-end infinite' }}>_</span>
      </div>
      <div className="text-[10px] font-mono text-accent/60 mb-2">SYNTHESIZING THOUGHT</div>
      <EmotionMiniBars emotions={emotions} />
      <Handle type="source" position={Position.Bottom} className="!bg-accent !border-accent/60 !w-1.5 !h-1.5" />
    </div>
  )
}

function CompactNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown>
  const nodeType = (d.nodeType as string) || 'thought'
  const color = (d.color as string) || NODE_TYPE_COLORS[nodeType] || '#818cf8'
  const label = ((d.name || d.label || d.content) as string || '').slice(0, 60)
  const isWriting = d.isWriting as boolean | undefined
  const score = (d.importance_score as number | undefined) ?? 0.5
  const circleSize = Math.round(28 + score * 20) // 28-48px

  return (
    <div title={label} style={{ position: 'relative' }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div
        style={{
          width: circleSize,
          height: circleSize,
          borderRadius: '50%',
          backgroundColor: `${color}22`,
          border: `2px solid ${color}${selected ? 'cc' : '55'}`,
          boxShadow: selected
            ? `0 0 0 2px rgba(245,158,11,0.4), 0 0 12px ${color}44`
            : isWriting
            ? `0 0 12px ${color}88`
            : `0 0 6px ${color}22`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            backgroundColor: color,
            opacity: isWriting ? 1 : 0.8,
            animation: isWriting ? 'blink 1s step-end infinite' : undefined,
          }}
        />
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}

// nodeTypes MUST be defined outside component
const nodeTypes = {
  thoughtNode:      ThoughtNode,
  memoryNode:       MemoryNode,
  goalNode:         GoalNode,
  skillNode:        SkillNode,
  systemNode:       SystemNode,
  conversationNode: ConversationNode,
  writingNode:      WritingNode,
  compactNode:      CompactNode,
}

const FILTERS = ['all', 'thought', 'memory', 'goal', 'skill', 'conversation', 'system'] as const
type FilterType = typeof FILTERS[number]

const FILTER_LABELS: Record<FilterType, string> = {
  all: 'ALL',
  thought: 'THOUGHT',
  memory: 'MEMORY',
  goal: 'GOAL',
  skill: 'SKILL',
  conversation: 'CONVO',
  system: 'SYSTEM',
}

const NODE_TYPE_COLORS: Record<string, string> = {
  thought:      '#818cf8',
  memory:       '#34d399',
  goal:         '#f59e0b',
  skill:        '#a855f7',
  system:       '#ec4899',
  conversation: '#60a5fa',
}

function applyFilter(nodes: Node[], filter: FilterType): Node[] {
  if (filter === 'all') return nodes
  return nodes.filter(n => (n.data as Record<string, unknown>)?.nodeType === filter)
}

function countByType(nodes: Node[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const n of nodes) {
    const t = ((n.data as Record<string, unknown>)?.nodeType as string) || 'unknown'
    counts[t] = (counts[t] || 0) + 1
  }
  return counts
}

interface ContextMenuState {
  x: number
  y: number
  node: Node
}

// ---- Main component ----

export default function BrainView() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [emotions, setEmotions] = useState<Partial<EmotionState>>({})
  const [filter, setFilter] = useState<FilterType>('all')
  const [loading, setLoading] = useState(true)
  const [wsConnected, setWsConnected] = useState(false)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [detailPanel, setDetailPanel] = useState<Node | null>(null)
  const [writingNodeId, setWritingNodeId] = useState<string | null>(null)
  const [newNodeIds, setNewNodeIds] = useState<Set<string>>(new Set())
  const [compactMode, setCompactMode] = useState(false)
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set())
  const [brainStats, setBrainStats] = useState<{ thought_count: number; memory_count: number; active_goals: number } | null>(null)
  const [brainSummary, setBrainSummary] = useState<{ summary: string; stats: Record<string, number>; generated_at: string } | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set())
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const allNodesRef = useRef<Node[]>([])
  const rfInstanceRef = useRef<ReactFlowInstance<any, any> | null>(null)

  const toggleType = (t: string) => setHiddenTypes(prev => {
    const n = new Set(prev)
    n.has(t) ? n.delete(t) : n.add(t)
    return n
  })

  // Debounced semantic search
  function handleSearchInput(q: string) {
    setSearchQuery(q)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (!q.trim()) {
      setHighlightedIds(new Set())
      return
    }
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await api.searchBrainNodes(q)
        setHighlightedIds(new Set(results.map(r => r.id)))
      } catch {
        setHighlightedIds(new Set())
      }
    }, 400)
  }

  // Derive isAdmin from token (simple check - any logged-in user with role)
  const isAdmin = (() => {
    try {
      const token = localStorage.getItem('vantis_token')
      if (!token) return false
      const payload = JSON.parse(atob(token.split('.')[1]))
      return payload.role === 'admin'
    } catch { return false }
  })()

  const loadGraph = useCallback(async () => {
    setLoading(true)
    try {
      const [graphData, emotionData] = await Promise.all([
        api.getGraph() as Promise<{ nodes: Node[]; edges: Edge[] }>,
        api.getEmotions() as Promise<Partial<EmotionState>>,
      ])

      const hasPositions = graphData.nodes.some(
        n => n.position && (n.position.x !== 0 || n.position.y !== 0)
      )

      const positioned = hasPositions
        ? graphData.nodes
        : layoutNodes(graphData.nodes)

      allNodesRef.current = positioned
      setEdges(graphData.edges)
      setEmotions(emotionData)
      setNodes(applyFilter(positioned, filter))
    } finally {
      setLoading(false)
    }
  }, [filter, setNodes, setEdges])

  useEffect(() => {
    loadGraph()
    api.getBrainSummary().then(d => {
      setBrainStats({ thought_count: d.thought_count, memory_count: d.memory_count, active_goals: d.active_goals })
      if (d.summary && d.generated_at) {
        setBrainSummary({
          summary: d.summary,
          stats: d.stats || { thought_count: d.thought_count, memory_count: d.memory_count, active_goals: d.active_goals, edge_count: 0 },
          generated_at: d.generated_at,
        })
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    setNodes(applyFilter(allNodesRef.current, filter))
  }, [filter, setNodes])

  // New node animation cleanup
  useEffect(() => {
    if (newNodeIds.size === 0) return
    const timer = setTimeout(() => {
      setNewNodeIds(new Set())
    }, 2000)
    return () => clearTimeout(timer)
  }, [newNodeIds])

  const handleWs = useCallback((msg: WsMessage) => {
    if (msg.type === 'thought') {
      // Remove writing node, reload graph, animate new node
      if (writingNodeId) {
        setWritingNodeId(null)
        allNodesRef.current = allNodesRef.current.filter(n => n.id !== writingNodeId)
      }
      // Mark the new node id for animation after reload
      const thoughtData = msg.data as Record<string, unknown> | null
      if (thoughtData?.id) {
        const newId = `thought_${thoughtData.id}`
        setNewNodeIds(prev => new Set([...prev, newId]))
      }
      loadGraph()
    }
    if (msg.type === 'emotion_update') {
      const emotionData = msg.data as Partial<EmotionState>
      setEmotions(emotionData)
      // Show writing node while VANTIS is generating
      if (!writingNodeId) {
        const wid = 'writing_active'
        setWritingNodeId(wid)
        const writingNode: Node = {
          id: wid,
          type: 'writingNode',
          position: { x: -400 + Math.random() * 80, y: -80 + Math.random() * 80 },
          data: { emotion_state: emotionData, nodeType: 'writing' },
        }
        allNodesRef.current = [...allNodesRef.current, writingNode]
        setNodes(prev => [...applyFilter(allNodesRef.current.filter(n => n.id !== wid), filter), writingNode])
      }
    }
    if (msg.type === 'goal_update') {
      loadGraph()
    }
  }, [writingNodeId, loadGraph, filter, setNodes])

  // Track WS connection status via a wrapper hook approach
  useEffect(() => {
    const token = localStorage.getItem('vantis_token')
    if (!token) return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const wsTest = new WebSocket(`${proto}://${window.location.host}/ws?token=${token}`)
    wsTest.onopen = () => { setWsConnected(true); wsTest.close() }
    wsTest.onerror = () => setWsConnected(false)
    return () => wsTest.close()
  }, [])

  useWebSocket((msg) => {
    setWsConnected(true)
    handleWs(msg)
  })

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setDetailPanel(null)
        setContextMenu(null)
        setSelectedNode(null)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  function handleNodeClick(_: React.MouseEvent, node: Node) {
    setSelectedNode(node)
    setContextMenu(null)
    setDetailPanel(node)
  }

  function handleNodeDoubleClick(_: React.MouseEvent, node: Node) {
    setSelectedNode(node)
    setContextMenu(null)
    setDetailPanel(node)
  }

  function handleNodeContextMenu(e: React.MouseEvent, node: Node) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, node })
    setSelectedNode(node)
  }

  function handlePaneClick() {
    setSelectedNode(null)
    setContextMenu(null)
  }

  async function handleSave(nodeType: string, dbId: number, content: string) {
    await (api as unknown as Record<string, Function>).updateNode?.(nodeType, dbId, content)
    await loadGraph()
  }

  async function handleStatusChange(goalId: number, status: string, progress: number) {
    await api.updateGoal(goalId, { status, progress })
    await loadGraph()
  }

  async function handleExecuteSkill(skillId: number) {
    return api.executeSkill(skillId) as Promise<{ output?: string; error?: string; success?: boolean }>
  }

  async function handleDeleteNode() {
    if (!contextMenu) return
    const d = contextMenu.node.data as Record<string, unknown>
    const nodeType = d.nodeType as string
    const dbId = d.dbId as number
    if (!nodeType || !dbId) return
    try {
      await (api as unknown as Record<string, Function>).deleteNode?.(nodeType, dbId)
      allNodesRef.current = allNodesRef.current.filter(n => n.id !== contextMenu.node.id)
      setNodes(applyFilter(allNodesRef.current, filter))
      if (detailPanel?.id === contextMenu.node.id) setDetailPanel(null)
    } catch (e) {
      console.error('Delete failed:', e)
    }
  }

  const counts = countByType(allNodesRef.current)

  // Apply hidden type filter
  const displayNodes = nodes.filter(n => !hiddenTypes.has((n.data?.nodeType as string) || ''))
  const displayNodeIds = new Set(displayNodes.map(n => n.id))
  const displayEdges = edges.filter(e => displayNodeIds.has(e.source) && displayNodeIds.has(e.target))

  function toCompact(nodeList: Node[]): Node[] {
    if (!compactMode) return nodeList
    return nodeList.map(n => ({
      ...n,
      type: n.type === 'writingNode' ? 'writingNode' : 'compactNode',
      style: { ...((n.style as Record<string, unknown>) || {}), width: 36, height: 36 },
    }))
  }

  // Styled edges
  const styledEdges = displayEdges.map(e => ({
    ...e,
    style: {
      stroke: selectedNode && (e.source === selectedNode.id || e.target === selectedNode.id)
        ? '#f59e0b66'
        : '#1a1f2e',
      strokeWidth: selectedNode && (e.source === selectedNode.id || e.target === selectedNode.id) ? 1.5 : 1,
      strokeDasharray: e.label === 'recalls' ? '4 2' : undefined,
    },
    animated: (e.data as Record<string, unknown> | undefined)?.weight
      ? ((e.data as Record<string, unknown>).weight as number) > 0.7
      : false,
  }))

  return (
    <div className="h-full flex flex-col">
      {/* CSS injected for animations */}
      <style>{`
        @keyframes vantis-writing {
          0%, 100% { border-color: rgba(245,158,11,0.4); box-shadow: 0 0 0 1px rgba(245,158,11,0.15); }
          50% { border-color: rgba(245,158,11,0.9); box-shadow: 0 0 0 1px rgba(245,158,11,0.5), 0 0 16px rgba(245,158,11,0.2); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes node-appear {
          0% { opacity: 0; transform: scale(0.85); }
          100% { opacity: 1; transform: scale(1); }
        }
        .node-new {
          animation: node-appear 0.4s ease-out forwards;
        }
      `}</style>

      {/* Header / Filter bar */}
      <div className="border-b border-border px-4 py-2.5 flex items-center gap-3 bg-surface shrink-0 flex-wrap">
        <div className="flex items-center gap-1.5 shrink-0">
          <Filter size={11} className="text-muted" />
          <span className="text-[9px] font-mono text-muted tracking-widest">FILTER</span>
        </div>

        <div className="flex items-center gap-0.5 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 text-[10px] font-mono tracking-wider transition-colors flex items-center gap-1 ${
                filter === f
                  ? 'bg-accent text-void'
                  : 'text-muted hover:text-text hover:bg-white/5'
              }`}
            >
              {FILTER_LABELS[f]}
              {f !== 'all' && counts[f] !== undefined && (
                <span className={`text-[8px] ${filter === f ? 'text-void/70' : 'text-muted/60'}`}>
                  {counts[f]}
                </span>
              )}
              {f === 'all' && (
                <span className={`text-[8px] ${filter === f ? 'text-void/70' : 'text-muted/60'}`}>
                  {allNodesRef.current.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Semantic search */}
        <div className="flex items-center gap-1 bg-panel border border-border px-2 py-0.5 ml-2">
          <Search size={10} className="text-muted/60 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => handleSearchInput(e.target.value)}
            placeholder="Search nodes..."
            className="bg-transparent text-[10px] font-mono text-text placeholder-muted/40 outline-none w-28"
          />
          {highlightedIds.size > 0 && (
            <span className="text-[9px] font-mono text-accent">{highlightedIds.size}</span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* Live indicator */}
          <div className="flex items-center gap-1.5">
            {wsConnected ? (
              <>
                <span className="status-dot online" />
                <span className="text-[9px] font-mono text-memory tracking-widest">LIVE</span>
                <Wifi size={10} className="text-memory/60" />
              </>
            ) : (
              <>
                <span className="status-dot danger" />
                <span className="text-[9px] font-mono text-muted tracking-widest">OFFLINE</span>
                <WifiOff size={10} className="text-muted/60" />
              </>
            )}
          </div>

          <button
            onClick={() => setCompactMode(v => !v)}
            className={`transition-colors p-1 ${compactMode ? 'text-accent' : 'text-muted hover:text-accent'}`}
            title={compactMode ? 'Switch to card view' : 'Switch to compact view'}
          >
            {compactMode ? <LayoutGrid size={13} /> : <Circle size={13} />}
          </button>

          <button
            onClick={loadGraph}
            className="text-muted hover:text-accent transition-colors p-1"
            title="Refresh graph"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Node type visibility toggles */}
      <div className="border-b border-border px-4 py-1.5 flex items-center gap-1 bg-surface shrink-0 overflow-x-auto">
        <span className="text-[8px] font-mono text-muted/60 tracking-widest mr-1 shrink-0">VISIBLE:</span>
        {(['thought', 'memory', 'goal', 'skill', 'system', 'conversation'] as const).map(t => {
          const isHidden = hiddenTypes.has(t)
          const typeColors: Record<string, string> = {
            thought: 'text-thought border-thought/30',
            memory: 'text-memory border-memory/30',
            goal: 'text-accent border-accent/30',
            skill: 'text-purple-400 border-purple-400/30',
            system: 'text-pink-400 border-pink-400/30',
            conversation: 'text-blue-400 border-blue-400/30',
          }
          return (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={`px-2 py-0.5 text-[9px] font-mono tracking-wider border transition-colors ${
                isHidden
                  ? 'text-muted/40 border-border/40 line-through'
                  : typeColors[t]
              }`}
            >
              {t.toUpperCase()}
            </button>
          )
        })}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Graph area */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={toCompact(displayNodes).map(n => ({
              ...n,
              className: newNodeIds.has(n.id) ? 'node-new' : '',
              data: {
                ...(n.data as Record<string, unknown>),
                highlighted: highlightedIds.size > 0 && highlightedIds.has(n.id),
              },
            }))}
            edges={styledEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            onNodeContextMenu={handleNodeContextMenu}
            onPaneClick={handlePaneClick}
            onInit={(instance) => { rfInstanceRef.current = instance }}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            className="bg-void"
            deleteKeyCode={null}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
          >
            <Background color="#1a1f2e" gap={24} size={1} />
            <Controls className="!bg-surface !border-border" showInteractive={false} />
            <MiniMap
              className="!bg-surface !border-border"
              maskColor="rgba(3,4,7,0.7)"
              nodeColor={(n) => {
                const d = n.data as Record<string, unknown>
                const nt = (d?.nodeType as string) || 'thought'
                return NODE_TYPE_COLORS[nt] || '#6366f1'
              }}
              nodeStrokeWidth={0}
            />
          </ReactFlow>

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-void/60 pointer-events-none">
              <div className="flex items-center gap-3 border border-border bg-surface px-4 py-3">
                <RefreshCw size={14} className="animate-spin text-accent" />
                <span className="text-xs font-mono text-muted tracking-widest">LOADING NEURAL GRAPH...</span>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar: emotions + legend */}
        <div className="w-52 border-l border-border bg-surface shrink-0 flex flex-col overflow-hidden">
          <div className="p-4 flex-1 overflow-y-auto">
            <div className="text-[9px] font-mono text-muted tracking-[0.18em] mb-3">EMOTIONAL STATE</div>
            <EmotionBar emotions={emotions} />

            <div className="mt-5">
              <div className="text-[9px] font-mono text-muted tracking-[0.18em] mb-2">NODE TYPES</div>
              <div className="space-y-1.5">
                {[
                  { color: '#818cf8', label: 'Thought',      count: counts.thought      },
                  { color: '#34d399', label: 'Memory',       count: counts.memory       },
                  { color: '#f59e0b', label: 'Goal',         count: counts.goal         },
                  { color: '#a855f7', label: 'Skill',        count: counts.skill        },
                  { color: '#60a5fa', label: 'Conversation', count: counts.conversation },
                  { color: '#ec4899', label: 'System',       count: counts.system       },
                ].map(({ color, label, count }) => (
                  <div key={label} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-[10px] font-mono text-muted flex-1">{label}</span>
                    {count !== undefined && (
                      <span className="text-[9px] font-mono text-muted/50">{count}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <div className="text-[9px] font-mono text-muted tracking-[0.18em] mb-2">GRAPH STATS</div>
              <div className="space-y-1 text-[10px] font-mono text-muted">
                <div className="flex justify-between">
                  <span>Nodes</span>
                  <span className="text-text/60">{allNodesRef.current.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Edges</span>
                  <span className="text-text/60">{edges.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Visible</span>
                  <span className="text-text/60">{displayNodes.length}</span>
                </div>
              </div>
            </div>

            {brainStats && (
              <div className="mt-5">
                <div className="text-[9px] font-mono text-muted tracking-[0.18em] mb-2">BRAIN</div>
                <div className="space-y-1 text-[10px] font-mono text-muted">
                  <div className="flex justify-between">
                    <span>Thoughts</span>
                    <span className="text-text/60">{brainStats.thought_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Memories</span>
                    <span className="text-text/60">{brainStats.memory_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Active Goals</span>
                    <span className="text-accent">{brainStats.active_goals}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Self-report widget */}
            <div className="mt-5">
              <button
                onClick={() => setSummaryOpen(!summaryOpen)}
                className="text-xs font-mono text-muted hover:text-accent flex items-center gap-1 transition-colors"
              >
                <FileText size={10} /> SELF-REPORT
              </button>
              {summaryOpen && brainSummary && (
                <div className="mt-2 p-2 border border-border bg-panel rounded text-[10px] font-mono text-muted space-y-1 max-h-48 overflow-y-auto">
                  <div className="text-accent text-[9px] uppercase tracking-wider mb-1">Brain State</div>
                  <div>{brainSummary.stats.thought_count} thoughts · {brainSummary.stats.memory_count} memories</div>
                  <div>{brainSummary.stats.active_goals} active goals · {brainSummary.stats.edge_count} connections</div>
                  <div className="border-t border-border pt-1 mt-1 leading-relaxed">{brainSummary.summary.slice(0, 300)}...</div>
                  <div className="text-muted/50">Generated {new Date(brainSummary.generated_at).toLocaleTimeString()}</div>
                </div>
              )}
              {summaryOpen && !brainSummary && (
                <div className="mt-2 p-2 border border-border bg-panel rounded text-[10px] font-mono text-muted/50">
                  No summary available.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeType={(contextMenu.node.data as Record<string, unknown>).nodeType as string}
          nodeId={contextMenu.node.id}
          dbId={(contextMenu.node.data as Record<string, unknown>).dbId as number}
          isAdmin={isAdmin}
          onClose={() => setContextMenu(null)}
          onViewDetail={() => {
            setDetailPanel(contextMenu.node)
            setContextMenu(null)
          }}
          onEdit={() => {
            setDetailPanel(contextMenu.node)
            setContextMenu(null)
          }}
          onDelete={handleDeleteNode}
          onExecute={
            (contextMenu.node.data as Record<string, unknown>).nodeType === 'skill'
              ? () => {
                  setDetailPanel(contextMenu.node)
                  setContextMenu(null)
                }
              : undefined
          }
        />
      )}

      {/* Detail panel */}
      <NodeDetailPanel
        node={detailPanel}
        onClose={() => setDetailPanel(null)}
        isAdmin={isAdmin}
        onSave={handleSave}
        onStatusChange={handleStatusChange}
        onExecuteSkill={handleExecuteSkill}
      />
    </div>
  )
}
