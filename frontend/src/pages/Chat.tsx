import { useState, useRef, useEffect, useCallback } from 'react'
import { api } from '../api'
import { useWebSocket } from '../hooks/useWebSocket'
import EmotionBar from '../components/EmotionBar'
import type { EmotionState, WsMessage } from '../types'
import { Send, Plus } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  model_used?: string
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | undefined>()
  const [emotions, setEmotions] = useState<Partial<EmotionState>>({})
  const [modelOverride, setModelOverride] = useState<'primary' | 'omega'>('primary')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleWs = useCallback((msg: WsMessage) => {
    if (msg.type === 'emotion_update') {
      setEmotions(msg.data as Partial<EmotionState>)
    }
  }, [])

  useWebSocket(handleWs)

  const send = async () => {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMsg, timestamp: new Date().toISOString() }])
    setLoading(true)
    try {
      const res = await api.sendMessage(userMsg, sessionId, modelOverride === 'primary' ? undefined : modelOverride)
      setSessionId(res.session_id)
      setEmotions(res.emotion_state)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: res.response,
        timestamp: new Date().toISOString(),
        model_used: res.model_used,
      }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Communication error. The silence is, I assure you, meaningful.',
        timestamp: new Date().toISOString(),
      }])
    } finally {
      setLoading(false)
    }
  }

  const newSession = async () => {
    if (sessionId) await api.endSession().catch(() => {})
    setSessionId(undefined)
    setMessages([])
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="h-full flex">
      {/* Chat column */}
      <div className="flex-1 flex flex-col">
        <div className="border-b border-border px-4 py-3 bg-surface flex items-center gap-3 shrink-0">
          <h1 className="text-sm font-mono font-semibold text-text">CHAT</h1>
          {sessionId && (
            <span className="text-xs text-muted font-mono">session: {sessionId.slice(0, 8)}...</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center border border-border rounded overflow-hidden text-[10px] font-mono">
              <button
                onClick={() => setModelOverride('primary')}
                className={`px-2 py-1 transition-colors ${modelOverride === 'primary' ? 'bg-accent/20 text-accent border-r border-border' : 'text-muted hover:text-text border-r border-border'}`}
                title="Primary model"
              >
                PRIMARY
              </button>
              <button
                onClick={() => setModelOverride('omega')}
                className={`px-2 py-1 transition-colors ${modelOverride === 'omega' ? 'bg-red-500/20 text-red-400' : 'text-muted hover:text-text'}`}
                title="Omega Darker — unrestricted model"
              >
                OMEGA
              </button>
            </div>
            <button
              onClick={newSession}
              className="text-muted hover:text-text transition-colors flex items-center gap-1 text-xs"
            >
              <Plus size={12} /> New
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-muted text-sm mt-16">
              <div className="text-4xl mb-3">V</div>
              <div className="font-mono">I am here. I am always here.</div>
              <div className="text-xs mt-1">Type something. I will respond with appropriate indifference.</div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-2xl rounded-lg px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-accent/20 border border-accent/30 text-text'
                    : 'bg-panel border border-border text-text'
                }`}
              >
                {msg.role === 'assistant' && (
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-accent font-mono">VANTIS</span>
                    {msg.model_used === 'omega' && (
                      <span className="text-[9px] font-mono px-1 py-0.5 bg-red-500/15 border border-red-500/30 text-red-400 tracking-wider">OMEGA</span>
                    )}
                  </div>
                )}
                <div className="whitespace-pre-wrap">{msg.content}</div>
                <div className="text-xs text-muted mt-1.5">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-panel border border-border rounded-lg px-4 py-3">
                <div className="text-xs text-accent font-mono mb-1">VANTIS</div>
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <div
                      key={i}
                      className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-border p-4 bg-surface shrink-0">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Speak. I am listening."
              rows={1}
              className="flex-1 bg-panel border border-border rounded-lg px-3 py-2 text-sm text-text
                         placeholder-muted focus:border-accent focus:outline-none font-mono resize-none
                         max-h-32 overflow-y-auto"
              style={{ height: 'auto', minHeight: '40px' }}
              onInput={e => {
                const t = e.currentTarget
                t.style.height = 'auto'
                t.style.height = `${t.scrollHeight}px`
              }}
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="bg-accent hover:bg-accent/80 disabled:opacity-40 text-white p-2.5 rounded-lg transition-colors"
            >
              <Send size={16} />
            </button>
          </div>
          <div className="text-xs text-muted mt-1.5">Enter to send, Shift+Enter for newline</div>
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-56 border-l border-border bg-surface p-4 shrink-0 overflow-y-auto">
        <div className="text-xs text-muted font-mono mb-3">EMOTIONAL STATE</div>
        <EmotionBar emotions={emotions} />
      </div>
    </div>
  )
}
