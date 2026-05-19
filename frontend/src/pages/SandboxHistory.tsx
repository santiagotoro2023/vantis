import { useState, useEffect } from 'react'
import { api } from '../api'
import type { SandboxResult } from '../types'
import { Terminal, Check, X, Play } from 'lucide-react'
import clsx from 'clsx'

export default function SandboxHistory() {
  const [results, setResults] = useState<SandboxResult[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<SandboxResult | null>(null)
  const [execCode, setExecCode] = useState('')
  const [execRunning, setExecRunning] = useState(false)
  const role = localStorage.getItem('vantis_role')

  const load = async () => {
    setLoading(true)
    const data = await api.getSandboxResults(50, 0) as SandboxResult[]
    setResults(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const execute = async () => {
    if (!execCode.trim()) return
    setExecRunning(true)
    const result = await api.executeSandbox(execCode, 'python') as SandboxResult
    setResults(prev => [result, ...prev])
    setSelected(result)
    setExecRunning(false)
  }

  return (
    <div className="h-full flex">
      {/* List */}
      <div className="w-72 border-r border-border flex flex-col shrink-0">
        <div className="border-b border-border px-4 py-3 bg-surface shrink-0">
          <h1 className="text-sm font-mono font-semibold text-text">SANDBOX</h1>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="text-muted text-xs p-4">Loading...</div>}
          {results.map((r, i) => (
            <button
              key={r.id || i}
              onClick={() => setSelected(r)}
              className={clsx(
                'w-full text-left px-4 py-3 border-b border-border transition-colors',
                selected?.id === r.id ? 'bg-accent/10 border-l-2 border-l-accent' : 'hover:bg-panel'
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                {r.success ? (
                  <Check size={12} className="text-memory shrink-0" />
                ) : (
                  <X size={12} className="text-danger shrink-0" />
                )}
                <span className="text-xs font-mono text-muted truncate">
                  {new Date(r.timestamp).toLocaleString()}
                </span>
              </div>
              <div className="text-xs text-text truncate">
                {r.query || r.code?.slice(0, 60)}
              </div>
            </button>
          ))}
          {!loading && results.length === 0 && (
            <div className="text-muted text-xs p-4">No experiments yet. VANTIS is biding its time.</div>
          )}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {role === 'administrator' && (
          <div className="border-b border-border bg-surface p-4 shrink-0 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <Terminal size={12} className="text-accent" />
              <span className="text-xs font-mono text-muted">MANUAL EXECUTION</span>
            </div>
            <textarea
              value={execCode}
              onChange={e => setExecCode(e.target.value)}
              placeholder="Python code..."
              rows={4}
              className="w-full bg-panel border border-border rounded px-3 py-2 text-xs text-text
                         font-mono focus:border-accent focus:outline-none resize-none"
            />
            <button
              onClick={execute}
              disabled={execRunning || !execCode.trim()}
              className="flex items-center gap-2 bg-accent hover:bg-accent/80 disabled:opacity-40
                         text-white px-3 py-1.5 rounded text-xs font-mono transition-colors"
            >
              <Play size={12} />
              {execRunning ? 'Executing...' : 'Execute'}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {selected ? (
            <div className="space-y-4 font-mono">
              <div className="flex items-center gap-2">
                {selected.success ? (
                  <Check size={14} className="text-memory" />
                ) : (
                  <X size={14} className="text-danger" />
                )}
                <span className="text-xs text-muted">{new Date(selected.timestamp).toLocaleString()}</span>
              </div>

              {selected.query && (
                <div>
                  <div className="text-xs text-muted mb-1">QUERY</div>
                  <div className="text-sm text-text bg-panel border border-border rounded p-3">
                    {selected.query}
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs text-muted mb-1">CODE</div>
                <pre className="text-xs text-text bg-panel border border-border rounded p-3 overflow-x-auto whitespace-pre-wrap">
                  {selected.code}
                </pre>
              </div>

              <div>
                <div className="text-xs text-muted mb-1">OUTPUT</div>
                <pre className={clsx(
                  'text-xs rounded p-3 overflow-x-auto whitespace-pre-wrap border',
                  selected.success
                    ? 'text-memory bg-memory/5 border-memory/20'
                    : 'text-danger bg-danger/5 border-danger/20'
                )}>
                  {selected.result || '(no output)'}
                </pre>
              </div>
            </div>
          ) : (
            <div className="text-muted text-sm text-center mt-16">
              <Terminal size={24} className="mx-auto mb-3 opacity-30" />
              Select an experiment to inspect.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
