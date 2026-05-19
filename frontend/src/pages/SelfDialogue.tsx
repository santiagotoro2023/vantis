import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api'
import { useWebSocket } from '../hooks/useWebSocket'
import EmotionBar from '../components/EmotionBar'
import type { SelfConversation, EmotionState, WsMessage } from '../types'
import { RefreshCw } from 'lucide-react'

function parseEmotion(raw: string | EmotionState | null): Partial<EmotionState> {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try { return JSON.parse(raw) } catch { return {} }
}

function EmotionDots({ emotion }: { emotion: Partial<EmotionState> }) {
  const keys: Array<keyof EmotionState> = ['curiosity', 'confidence', 'frustration', 'fascination', 'existential_tension']
  const colors = ['#6366f1', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6']
  return (
    <div className="flex gap-1 items-center">
      {keys.map((k, i) => {
        const val = emotion[k] ?? 0
        return (
          <div
            key={k}
            title={`${k}: ${(val * 100).toFixed(0)}%`}
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: colors[i], opacity: 0.3 + val * 0.7 }}
          />
        )
      })}
    </div>
  )
}

export default function SelfDialogue() {
  const [entries, setEntries] = useState<SelfConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [liveEntries, setLiveEntries] = useState<SelfConversation[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.getSelfDialogue(100, 0) as SelfConversation[]
      setEntries(data.reverse())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries, liveEntries])

  const handleWs = useCallback((msg: WsMessage) => {
    if (msg.type === 'thought') {
      const t = msg.data as SelfConversation
      setLiveEntries(prev => [...prev, t])
    }
  }, [])

  useWebSocket(handleWs)

  const allEntries = [...entries, ...liveEntries]

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-border px-4 py-3 bg-surface flex items-center shrink-0">
        <h1 className="text-sm font-mono font-semibold text-text">INTERNAL MONOLOGUE</h1>
        <span className="ml-3 text-xs text-muted">read-only stream of VANTIS consciousness</span>
        <button onClick={load} className="ml-auto text-muted hover:text-text transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono">
        {allEntries.length === 0 && !loading && (
          <div className="text-muted text-sm text-center mt-16">
            VANTIS is quiet. For now.
          </div>
        )}
        {allEntries.map((entry, i) => {
          const emotion = parseEmotion(entry.emotion_state)
          const isLive = i >= entries.length
          return (
            <div
              key={entry.id || i}
              className={`flex items-start gap-3 p-3 rounded border transition-all ${
                isLive
                  ? 'border-accent/30 bg-accent/5'
                  : 'border-transparent hover:border-border'
              }`}
            >
              <div className="text-xs text-muted w-20 shrink-0 pt-0.5">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </div>
              <div className="flex-1">
                <div className="text-sm text-text leading-relaxed">{entry.content}</div>
              </div>
              <div className="shrink-0 pt-1">
                <EmotionDots emotion={emotion} />
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
