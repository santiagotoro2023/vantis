import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { api } from '../api'
import { useWebSocket } from '../hooks/useWebSocket'
import EmotionBar from '../components/EmotionBar'
import EmotionTimeline from '../components/EmotionTimeline'
import type { EmotionState, WsMessage } from '../types'
import { Send, Plus, Search, MessageSquare, Volume2, VolumeX, Menu, X, Mic, Paperclip } from 'lucide-react'

declare global {
  interface Window {
    SpeechRecognition: any
    webkitSpeechRecognition: any
  }
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  model_used?: string
  streaming?: boolean
}

interface ChatSession {
  session_id: string
  started: string
  message_count: number
  name?: string
}

interface BrainStats {
  thought_count: number
  memory_count: number
  active_goals: number
}

function parseUTC(dateStr: string): number {
  if (!dateStr) return Date.now()
  // SQLite CURRENT_TIMESTAMP has no timezone — treat as UTC
  const s = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z'
  return new Date(s).getTime()
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return ''
  const diff = Date.now() - parseUTC(dateStr)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown-body text-sm leading-relaxed">
      <ReactMarkdown
        components={{
          code: ({ children, className }) => {
            const isBlock = className?.includes('language-')
            return isBlock ? (
              <pre className="bg-panel border border-border rounded p-3 overflow-x-auto my-2">
                <code className="text-xs font-mono text-accent">{children}</code>
              </pre>
            ) : (
              <code className="bg-panel border border-border rounded px-1 py-0.5 text-xs font-mono text-accent">{children}</code>
            )
          },
          ul: ({ children }) => <ul className="list-disc list-inside my-1 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside my-1 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="text-sm">{children}</li>,
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="text-text font-semibold">{children}</strong>,
          em: ({ children }) => <em className="text-muted">{children}</em>,
          h1: ({ children }) => <h2 className="text-sm font-semibold text-accent mt-3 mb-1">{children}</h2>,
          h2: ({ children }) => <h3 className="text-sm font-semibold text-accent mt-2 mb-1">{children}</h3>,
          h3: ({ children }) => <h3 className="text-xs font-semibold text-muted uppercase mt-2 mb-1">{children}</h3>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-accent/40 pl-3 my-2 text-muted italic">{children}</blockquote>,
          a: ({ href, children }) => <a href={href} className="text-accent underline" target="_blank" rel="noopener noreferrer">{children}</a>,
          hr: () => <hr className="border-border my-2" />,
        }}
      >{content}</ReactMarkdown>
    </div>
  )
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | undefined>()
  const [emotions, setEmotions] = useState<Partial<EmotionState>>({})
  const [modelOverride, setModelOverride] = useState<'primary' | 'omega'>('primary')
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionSearch, setSessionSearch] = useState('')
  const [brainStats, setBrainStats] = useState<BrainStats | null>(null)
  const [emotionHistory, setEmotionHistory] = useState<Array<{ timestamp: string; emotions: Partial<EmotionState> }>>([])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [ttsEnabled, setTtsEnabled] = useState(() => localStorage.getItem('vantis_tts') === '1')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ session: ChatSession; x: number; y: number } | null>(null)
  const [listening, setListening] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [recallResults, setRecallResults] = useState<Array<{ id: string; type: string; label: string }> | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const recognitionRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Sentence-level TTS queue for parallel streaming playback
  const ttsBufferRef = useRef('')
  const ttsQueueRef = useRef<HTMLAudioElement[]>([])
  const ttsPlayingRef = useRef(false)
  const hasSpeechRecognition = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.getChatSessions()
      setSessions(data)
    } catch {
      // silently ignore
    }
  }, [])

  useEffect(() => {
    loadSessions()
    api.getBrainSummary().then(d => setBrainStats({
      thought_count: d.thought_count,
      memory_count: d.memory_count,
      active_goals: d.active_goals,
    })).catch(() => {})
    api.getEmotions().then(e => {
      setEmotions(e)
      setEmotionHistory([{ timestamp: new Date().toISOString(), emotions: e }])
    }).catch(() => {})
  }, [loadSessions])

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId) {
      setTimeout(() => renameInputRef.current?.focus(), 50)
    }
  }, [renamingId])

  // /recall inline search
  useEffect(() => {
    if (!input.startsWith('/recall ')) {
      setRecallResults(null)
      return
    }
    const q = input.slice(8).trim()
    if (!q) { setRecallResults([]); return }
    const t = setTimeout(async () => {
      try {
        const results = await api.searchBrainNodes(q)
        setRecallResults(results)
      } catch { setRecallResults([]) }
    }, 300)
    return () => clearTimeout(t)
  }, [input])

  const handleWs = useCallback((msg: WsMessage) => {
    if (msg.type === 'emotion_update') {
      const em = msg.data as Partial<EmotionState>
      setEmotions(em)
      setEmotionHistory(prev => [...prev.slice(-19), { timestamp: new Date().toISOString(), emotions: em }])
    }
  }, [])

  useWebSocket(handleWs)

  // Enqueue a sentence for sequential TTS playback
  const enqueueTTS = useCallback(async (sentence: string) => {
    if (!sentence.trim() || sentence.trim().length < 4) return
    try {
      const token = localStorage.getItem('vantis_token')
      const res = await fetch('/api/tts/sentence', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text: sentence.trim() }),
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => {
        URL.revokeObjectURL(url)
        ttsQueueRef.current.shift()
        if (ttsQueueRef.current.length > 0) {
          ttsQueueRef.current[0].play().catch(() => {})
        } else {
          ttsPlayingRef.current = false
        }
      }
      ttsQueueRef.current.push(audio)
      if (!ttsPlayingRef.current) {
        ttsPlayingRef.current = true
        audio.play().catch(() => {})
      }
    } catch { /* best-effort */ }
  }, [])

  const send = async () => {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMsg, timestamp: new Date().toISOString() }])
    setLoading(true)
    // Reset TTS sentence buffer
    ttsBufferRef.current = ''

    // Add placeholder assistant message that we'll stream into
    setMessages(prev => [...prev, { role: 'assistant', content: '', timestamp: new Date().toISOString(), streaming: true }])

    const ttsEnabledNow = ttsEnabled

    abortRef.current = api.streamMessage(
      userMsg,
      sessionId,
      modelOverride === 'primary' ? undefined : modelOverride,
      (token) => {
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: last.content + token }
          }
          return updated
        })
        setLoading(false)

        // Sentence-level TTS: buffer tokens and fire per sentence
        if (ttsEnabledNow) {
          ttsBufferRef.current += token
          // Detect sentence boundary: [.!?] followed by space/newline or at buffer end
          const match = ttsBufferRef.current.match(/^(.*?[.!?])(\s|$)/s)
          if (match && match[1].length >= 8) {
            const sentence = match[1]
            ttsBufferRef.current = ttsBufferRef.current.slice(sentence.length).trimStart()
            enqueueTTS(sentence)
          }
        }
      },
      (fullText, sid) => {
        setSessionId(sid || sessionId)
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: fullText, streaming: false }
          }
          return updated
        })
        setLoading(false)
        loadSessions()
        // Flush any remaining buffered text as final TTS chunk
        if (ttsEnabledNow && ttsBufferRef.current.trim()) {
          enqueueTTS(ttsBufferRef.current.trim())
          ttsBufferRef.current = ''
        }
      },
      (_err) => {
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'assistant' && last.streaming) {
            updated[updated.length - 1] = {
              ...last,
              content: last.content || 'Communication error. The silence is meaningful.',
              streaming: false,
            }
          }
          return updated
        })
        setLoading(false)
      },
    )
  }

  const newSession = async () => {
    if (sessionId) await api.endSession().catch(() => {})
    setSessionId(undefined)
    setMessages([])
    loadSessions()
  }

  const loadSession = async (sid: string) => {
    try {
      const history = await api.getChatHistory(sid)
      setMessages(history.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: m.timestamp,
      })))
      setSessionId(sid)
      setSidebarOpen(false)
    } catch {
      // ignore
    }
  }

  const startRename = (session: ChatSession) => {
    setCtxMenu(null)
    setRenamingId(session.session_id)
    setRenameValue(session.name || '')
  }

  const deleteSession = async (sid: string) => {
    setCtxMenu(null)
    await api.deleteSession(sid).catch(() => {})
    if (sessionId === sid) {
      setSessionId(undefined)
      setMessages([])
    }
    await loadSessions()
  }

  const saveRename = async (sid: string) => {
    if (renameValue.trim()) {
      await api.renameSession(sid, renameValue.trim()).catch(() => {})
      await loadSessions()
    }
    setRenamingId(null)
  }

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    const recognition = new SR()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'
    recognition.onresult = (e: any) => {
      setInput(prev => prev + e.results[0][0].transcript)
      setListening(false)
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    recognition.start()
    recognitionRef.current = recognition
    setListening(true)
  }

  const handleFileUpload = async (file: File) => {
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    const token = localStorage.getItem('vantis_token')
    try {
      const res = await fetch('/api/memory/upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setMessages(prev => [...prev, {
        role: 'assistant' as const,
        content: `File indexed. ${data.memories_created} memory chunks created from \`${data.filename}\`. You can now ask questions about its content.`,
        timestamp: new Date().toISOString(),
      }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant' as const,
        content: `File upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      }])
    } finally {
      setUploading(false)
    }
  }

  const exportSession = async (sid: string, name?: string) => {
    setCtxMenu(null)
    const token = localStorage.getItem('vantis_token')
    const res = await fetch(`/api/chat/sessions/${sid}/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name || sid.slice(0, 8)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const filteredSessions = sessions.filter(s => {
    if (!sessionSearch.trim()) return true
    const q = sessionSearch.toLowerCase()
    const name = (s.name || `Chat ${s.session_id.slice(0, 8)}`).toLowerCase()
    return name.includes(q) || s.session_id.includes(q)
  })

  const SessionsSidebar = () => (
    <div className="flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border flex items-center justify-between shrink-0">
        <span className="text-[9px] font-mono text-muted tracking-widest">CONVERSATIONS</span>
        <div className="flex items-center gap-1">
          <button
            onClick={newSession}
            title="New chat"
            className="text-muted hover:text-accent transition-colors p-0.5"
          >
            <Plus size={13} />
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            title="Close"
            className="text-muted hover:text-text transition-colors p-0.5 md:hidden"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 bg-panel border border-border px-2 py-1">
          <Search size={10} className="text-muted/60 shrink-0" />
          <input
            type="text"
            value={sessionSearch}
            onChange={e => setSessionSearch(e.target.value)}
            placeholder="Filter sessions..."
            className="flex-1 bg-transparent text-[10px] font-mono text-text placeholder-muted/40 outline-none"
          />
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {filteredSessions.length === 0 && (
          <div className="px-3 py-4 text-[9px] font-mono text-muted/50 text-center leading-relaxed">
            No sessions yet.
          </div>
        )}
        {filteredSessions.map(session => {
          const isActive = session.session_id === sessionId
          const displayName = session.name || `Chat ${session.session_id.slice(0, 8)}`
          const isRenaming = renamingId === session.session_id

          return (
            <div
              key={session.session_id}
              onClick={() => !isRenaming && loadSession(session.session_id)}
              onContextMenu={e => {
                e.preventDefault()
                setCtxMenu({ session, x: e.clientX, y: e.clientY })
              }}
              className={`px-3 py-2.5 cursor-pointer transition-colors border-l-2 ${
                isActive
                  ? 'bg-accent/10 border-l-accent'
                  : 'border-l-transparent hover:bg-white/5 hover:border-l-border'
              }`}
            >
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveRename(session.session_id)
                    if (e.key === 'Escape') setRenamingId(null)
                    e.stopPropagation()
                  }}
                  onBlur={() => saveRename(session.session_id)}
                  onClick={e => e.stopPropagation()}
                  className="w-full bg-panel border border-accent/40 text-[10px] font-mono text-text px-1 py-0.5 outline-none"
                />
              ) : (
                <>
                  <div className={`text-[10px] font-mono truncate mb-0.5 ${isActive ? 'text-accent' : 'text-text'}`}>
                    {displayName}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-mono text-muted/60">
                      {session.message_count} msg{session.message_count !== 1 ? 's' : ''}
                    </span>
                    <span className="text-[8px] font-mono text-muted/50">
                      {timeAgo(session.started)}
                    </span>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  // Context menu rendered at document level so it can escape the sidebar
  const ContextMenu = ctxMenu ? (
    <>
      <div className="fixed inset-0 z-[60]" onClick={() => setCtxMenu(null)} />
      <div
        className="fixed z-[61] bg-surface border border-border shadow-xl py-1 min-w-[140px]"
        style={{ left: ctxMenu.x, top: ctxMenu.y }}
      >
        <button
          onClick={() => startRename(ctxMenu.session)}
          className="w-full text-left px-3 py-1.5 text-[11px] font-mono text-text hover:bg-accent/10 hover:text-accent transition-colors"
        >
          Rename
        </button>
        <button
          onClick={() => exportSession(ctxMenu.session.session_id, ctxMenu.session.name)}
          className="w-full text-left px-3 py-1.5 text-[11px] font-mono text-text hover:bg-accent/10 hover:text-accent transition-colors"
        >
          Export
        </button>
        <button
          onClick={() => deleteSession(ctxMenu.session.session_id)}
          className="w-full text-left px-3 py-1.5 text-[11px] font-mono text-danger hover:bg-danger/10 transition-colors"
        >
          Delete
        </button>
      </div>
    </>
  ) : null

  return (
    <>
    {ContextMenu}
    <div className="h-full flex">
      {/* Sessions sidebar — desktop: always visible, mobile: overlay */}
      <div className="hidden md:flex w-[220px] shrink-0 border-r border-border bg-surface flex-col overflow-hidden">
        <SessionsSidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative z-50 w-[260px] bg-surface border-r border-border flex flex-col overflow-hidden">
            <SessionsSidebar />
          </div>
        </div>
      )}

      {/* Chat column */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="border-b border-border px-4 py-3 bg-surface flex items-center gap-3 shrink-0">
          {/* Mobile hamburger */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden text-muted hover:text-accent transition-colors"
            title="Sessions"
          >
            <Menu size={16} />
          </button>
          <MessageSquare size={13} className="text-muted" />
          <h1 className="text-sm font-mono font-semibold text-text">CHAT</h1>
          {sessionId && (
            <span className="text-xs text-muted font-mono hidden sm:inline">session: {sessionId.slice(0, 8)}...</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {/* TTS toggle */}
            <button
              onClick={() => {
                const next = !ttsEnabled
                setTtsEnabled(next)
                localStorage.setItem('vantis_tts', next ? '1' : '0')
              }}
              className={`text-xs font-mono px-2 py-1 border transition-colors ${ttsEnabled ? 'border-accent text-accent' : 'border-border text-muted hover:text-text'}`}
              title={ttsEnabled ? 'Voice on' : 'Voice off'}
            >
              {ttsEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
            </button>
            {/* Model toggle */}
            <div className="flex items-center border border-border overflow-hidden text-[10px] font-mono">
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
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-muted text-sm mt-16">
              <div className="text-4xl mb-3 font-mono text-muted/30">V</div>
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
                {msg.role === 'assistant' ? (
                  <>
                    {msg.content ? (
                      <MarkdownMessage content={msg.content} />
                    ) : null}
                    {msg.streaming && (
                      <>
                        {!msg.content && (
                          <div className="flex gap-1">
                            {[0, 1, 2].map(i => (
                              <div
                                key={i}
                                className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce"
                                style={{ animationDelay: `${i * 0.15}s` }}
                              />
                            ))}
                          </div>
                        )}
                        {msg.content && (
                          <span className="animate-pulse text-accent font-mono text-xs">|</span>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                )}
                <div className="text-xs text-muted mt-1.5">
                  {new Date(parseUTC(msg.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-border p-4 bg-surface shrink-0">
          {/* /recall popover */}
          {recallResults !== null && (
            <div className="mb-2 bg-surface border border-border shadow-xl max-h-48 overflow-y-auto">
              {recallResults.length === 0 ? (
                <div className="px-3 py-2 text-[11px] font-mono text-muted/60">No results.</div>
              ) : (
                recallResults.map(r => (
                  <button
                    key={r.id}
                    onClick={() => {
                      setInput(`/recall ${r.label}`)
                      setRecallResults(null)
                    }}
                    className="w-full text-left px-3 py-1.5 text-[11px] font-mono text-text hover:bg-accent/10 hover:text-accent transition-colors flex items-center gap-2"
                  >
                    <span className="text-muted/60 text-[9px]">{r.type}</span>
                    <span className="truncate">{r.label}</span>
                  </button>
                ))
              )}
            </div>
          )}
          {/* File input (hidden) */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.pdf,.py,.js,.ts,.json"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleFileUpload(file)
              e.target.value = ''
            }}
          />
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
            {/* Mic button */}
            {hasSpeechRecognition && (
              <button
                onClick={startListening}
                disabled={listening || uploading}
                title={listening ? 'Listening...' : 'Voice input'}
                className={`p-2.5 rounded-lg transition-colors ${listening ? 'bg-red-500/20 text-red-400 animate-pulse border border-red-500/40' : 'border border-border text-muted hover:text-accent hover:border-accent/40'}`}
              >
                <Mic size={16} />
              </button>
            )}
            {/* File upload button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title={uploading ? 'Uploading...' : 'Upload file'}
              className={`p-2.5 rounded-lg border transition-colors ${uploading ? 'border-accent/40 text-accent animate-pulse' : 'border-border text-muted hover:text-accent hover:border-accent/40'}`}
            >
              <Paperclip size={16} />
            </button>
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="bg-accent hover:bg-accent/80 disabled:opacity-40 text-white p-2.5 rounded-lg transition-colors"
            >
              <Send size={16} />
            </button>
          </div>
          <div className="text-xs text-muted mt-1.5 font-mono">Enter to send · Shift+Enter newline · /recall for brain search</div>
        </div>
      </div>

      {/* Right sidebar — 200px, hidden on mobile */}
      <div className="hidden md:flex w-[200px] shrink-0 border-l border-border bg-surface flex-col overflow-hidden">
        <div className="p-3 flex-1 overflow-y-auto space-y-4">
          {/* Emotion bars */}
          <div>
            <div className="text-[9px] font-mono text-muted tracking-widest mb-2">EMOTIONAL STATE</div>
            <EmotionBar emotions={emotions} />
          </div>

          {/* Emotion timeline */}
          {emotionHistory.length >= 2 && (
            <div>
              <div className="text-[9px] font-mono text-muted tracking-widest mb-2">EMOTION HISTORY</div>
              <EmotionTimeline entries={emotionHistory} />
            </div>
          )}

          {/* Brain summary */}
          {brainStats && (
            <div>
              <div className="text-[9px] font-mono text-muted tracking-widest mb-2">BRAIN</div>
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-mono text-muted/70">thoughts</span>
                  <span className="text-[10px] font-mono text-text/60">{brainStats.thought_count}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-mono text-muted/70">memories</span>
                  <span className="text-[10px] font-mono text-text/60">{brainStats.memory_count}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-mono text-muted/70">active goals</span>
                  <span className="text-[10px] font-mono text-accent">{brainStats.active_goals}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  )
}
