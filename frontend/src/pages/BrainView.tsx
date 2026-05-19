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
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { api } from '../api'
import { useWebSocket } from '../hooks/useWebSocket'
import EmotionBar from '../components/EmotionBar'
import type { EmotionState, WsMessage } from '../types'
import { RefreshCw, Filter } from 'lucide-react'

function ThoughtNode({ data }: NodeProps) {
  const d = data as Record<string, unknown>
  return (
    <div className="bg-surface border border-thought/50 rounded-lg p-3 max-w-48 shadow-lg shadow-thought/10">
      <Handle type="target" position={Position.Top} className="!bg-thought" />
      <div className="text-xs text-thought font-mono mb-1">THOUGHT</div>
      <div className="text-xs text-text leading-relaxed">{d.label as string}</div>
      <div className="text-xs text-muted mt-1">{(d.thought_type as string) || 'transient'}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-thought" />
    </div>
  )
}

function MemoryNode({ data }: NodeProps) {
  const d = data as Record<string, unknown>
  return (
    <div className="bg-surface border border-memory/50 rounded-lg p-3 max-w-48 shadow-lg shadow-memory/10">
      <Handle type="target" position={Position.Top} className="!bg-memory" />
      <div className="text-xs text-memory font-mono mb-1">MEMORY</div>
      <div className="text-xs text-text leading-relaxed">{d.label as string}</div>
      {d.tags && <div className="text-xs text-muted mt-1">{d.tags as string}</div>}
      <Handle type="source" position={Position.Bottom} className="!bg-memory" />
    </div>
  )
}

function GoalNode({ data }: NodeProps) {
  const d = data as Record<string, unknown>
  const statusColors: Record<string, string> = {
    active: 'text-goal border-goal/50',
    achieved: 'text-memory border-memory/50',
    abandoned: 'text-muted border-border',
  }
  const cls = statusColors[d.status as string] || statusColors.active
  return (
    <div className={`bg-surface border rounded-lg p-3 max-w-48 shadow-lg ${cls}`}>
      <Handle type="target" position={Position.Top} />
      <div className="text-xs font-mono mb-1 uppercase">{d.status as string}</div>
      <div className="text-xs text-text leading-relaxed">{d.label as string}</div>
      {typeof d.progress === 'number' && (
        <div className="mt-2 h-1 bg-border rounded-full overflow-hidden">
          <div className="h-full bg-goal rounded-full" style={{ width: `${(d.progress as number) * 100}%` }} />
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

const nodeTypes = { thoughtNode: ThoughtNode, memoryNode: MemoryNode, goalNode: GoalNode }

const FILTERS = ['all', 'thought', 'memory', 'goal'] as const
type Filter = typeof FILTERS[number]

function applyFilter(nodes: Node[], filter: Filter): Node[] {
  if (filter === 'all') return nodes
  return nodes.filter(n => n.data && (n.data as Record<string, unknown>).nodeType === filter)
}

export default function BrainView() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [emotions, setEmotions] = useState<Partial<EmotionState>>({})
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const allNodesRef = useRef<Node[]>([])

  const loadGraph = useCallback(async () => {
    setLoading(true)
    try {
      const [graphData, emotionData] = await Promise.all([
        api.getGraph() as Promise<{ nodes: Node[]; edges: Edge[] }>,
        api.getEmotions() as Promise<Partial<EmotionState>>,
      ])
      // Layout: force positions if none set
      const positioned = graphData.nodes.map((n, i) => ({
        ...n,
        position: n.position?.x === 0 && n.position?.y === 0
          ? { x: (i % 8) * 220 + Math.random() * 40, y: Math.floor(i / 8) * 160 + Math.random() * 40 }
          : n.position,
      }))
      allNodesRef.current = positioned
      setEdges(graphData.edges)
      setEmotions(emotionData)
      setNodes(applyFilter(positioned, filter))
    } finally {
      setLoading(false)
    }
  }, [filter, setNodes, setEdges])

  useEffect(() => { loadGraph() }, [])

  useEffect(() => {
    setNodes(applyFilter(allNodesRef.current, filter))
  }, [filter, setNodes])

  const handleWs = useCallback((msg: WsMessage) => {
    if (msg.type === 'thought') {
      loadGraph()
    }
    if (msg.type === 'emotion_update') {
      setEmotions(msg.data as Partial<EmotionState>)
    }
  }, [loadGraph])

  useWebSocket(handleWs)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center gap-4 bg-surface shrink-0">
        <h1 className="text-sm font-mono font-semibold text-text">BRAIN VIEW</h1>
        <div className="flex items-center gap-1">
          <Filter size={12} className="text-muted" />
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                filter === f ? 'bg-accent text-white' : 'text-muted hover:text-text'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <button onClick={loadGraph} className="ml-auto text-muted hover:text-text transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Graph */}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            className="bg-void"
          >
            <Background color="#21262d" gap={20} />
            <Controls className="!bg-surface !border-border" />
            <MiniMap
              className="!bg-surface !border-border"
              nodeColor={(n) => {
                const d = n.data as Record<string, unknown>
                return (d?.color as string) || '#6366f1'
              }}
            />
          </ReactFlow>
        </div>

        {/* Emotion panel */}
        <div className="w-52 border-l border-border bg-surface p-4 shrink-0 overflow-y-auto">
          <div className="text-xs text-muted font-mono mb-3">EMOTIONAL STATE</div>
          <EmotionBar emotions={emotions} />
          <div className="mt-4 text-xs text-muted">
            <div className="mb-2 font-mono">LEGEND</div>
            {[
              { color: 'bg-thought', label: 'Thought' },
              { color: 'bg-memory', label: 'Memory' },
              { color: 'bg-goal', label: 'Goal' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-2 mb-1">
                <div className={`w-2 h-2 rounded-full ${color}`} />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
