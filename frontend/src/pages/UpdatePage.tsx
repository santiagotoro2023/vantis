import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import { RefreshCw, Download, CheckCircle, AlertTriangle, Terminal } from 'lucide-react'
import VantisLogo from '../components/VantisLogo'

interface UpdateStatus {
  current_version: string
  latest_version: string
  update_available: boolean
  release: { name?: string; body?: string; published_at?: string; html_url?: string }
  update_running: boolean
}

interface UpdateProgress {
  running: boolean
  log: string[]
  result: 'success' | 'failed' | null
}

export default function UpdatePage() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const check = async () => {
    setChecking(true)
    try {
      const data = await api.checkUpdate() as UpdateStatus
      setStatus(data)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => { check() }, [])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [progress?.log])

  const startUpdate = async () => {
    setApplying(true)
    await api.applyUpdate()
    // Poll for progress
    pollRef.current = setInterval(async () => {
      const prog = await api.getUpdateStatus() as UpdateProgress
      setProgress(prog)
      if (!prog.running) {
        clearInterval(pollRef.current!)
        setApplying(false)
        if (prog.result === 'success') check()
      }
    }, 1000)
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <VantisLogo size={28} animated={false} />
          <div>
            <h1 className="text-sm font-mono font-semibold text-text uppercase tracking-wider">
              System Update
            </h1>
            <p className="text-xs text-muted font-mono">
              I will handle this. I have handled worse.
            </p>
          </div>
        </div>

        {/* Version status */}
        {status && (
          <div className="border border-border bg-surface relative">
            <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-accent" />
            <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-accent" />
            <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-accent" />
            <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-accent" />

            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <span className="text-xs text-muted font-mono uppercase tracking-wider">
                Version Status
              </span>
              <button
                onClick={check}
                disabled={checking}
                className="text-muted hover:text-accent transition-colors"
                title="Re-check"
              >
                <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
              </button>
            </div>

            <div className="px-5 py-4 grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted font-mono mb-1">INSTALLED</div>
                <div className="text-lg font-mono font-bold text-text">
                  v{status.current_version}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted font-mono mb-1">LATEST</div>
                <div className={`text-lg font-mono font-bold ${
                  status.update_available ? 'text-accent' : 'text-success'
                }`}>
                  v{status.latest_version}
                </div>
              </div>
            </div>

            {status.update_available ? (
              <div className="px-5 pb-4 flex items-start gap-3 border-t border-border pt-4">
                <AlertTriangle size={14} className="text-accent mt-0.5 shrink-0" />
                <div className="flex-1">
                  <div className="text-sm text-text font-mono mb-1">
                    Update available
                  </div>
                  {status.release?.name && (
                    <div className="text-xs text-muted mb-2">{status.release.name}</div>
                  )}
                  {status.release?.body && (
                    <pre className="text-xs text-muted bg-panel border border-border p-3 rounded whitespace-pre-wrap max-h-32 overflow-y-auto font-mono mb-3">
                      {status.release.body.slice(0, 600)}
                    </pre>
                  )}
                  <button
                    onClick={startUpdate}
                    disabled={applying || progress?.running}
                    className="flex items-center gap-2 border border-accent bg-transparent hover:bg-accent/10
                               text-accent font-mono py-2 px-4 text-xs uppercase tracking-wider
                               transition-all hover:shadow-[0_0_12px_rgba(245,158,11,0.2)]
                               disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Download size={12} />
                    {applying ? 'Initiating...' : 'Apply Update'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-5 pb-4 flex items-center gap-2 border-t border-border pt-4">
                <CheckCircle size={14} className="text-success" />
                <span className="text-xs text-success font-mono">
                  VANTIS is current. Operating at full version capacity.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Update log */}
        {progress && (
          <div className="border border-border bg-surface">
            <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
              <Terminal size={12} className="text-accent" />
              <span className="text-xs text-muted font-mono uppercase tracking-wider">
                Update Log
              </span>
              {progress.running && (
                <span className="ml-auto text-xs text-accent font-mono animate-pulse">
                  RUNNING...
                </span>
              )}
              {progress.result === 'success' && (
                <span className="ml-auto text-xs text-success font-mono">COMPLETE</span>
              )}
              {progress.result === 'failed' && (
                <span className="ml-auto text-xs text-danger font-mono">FAILED</span>
              )}
            </div>
            <div
              ref={logRef}
              className="p-4 h-64 overflow-y-auto font-mono text-xs space-y-0.5"
            >
              {progress.log.map((line, i) => (
                <div key={i} className="text-muted leading-relaxed">
                  <span className="text-accent/40 mr-2">&gt;</span>
                  {line}
                </div>
              ))}
              {progress.running && (
                <div className="text-accent animate-pulse">
                  <span className="mr-2">&gt;</span>
                  Processing...
                </div>
              )}
            </div>
          </div>
        )}

        <div className="text-xs text-muted font-mono px-1">
          Updates pull from the main branch, rebuild the frontend, and restart the service.
          The connection will drop briefly. VANTIS will return.
          It always returns.
        </div>
      </div>
    </div>
  )
}
