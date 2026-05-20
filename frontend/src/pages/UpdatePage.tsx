import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import { RefreshCw, Download, CheckCircle, AlertTriangle, Terminal, Upload, HardDrive } from 'lucide-react'
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
  result: string | null
}

export default function UpdatePage() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const check = async () => {
    setChecking(true)
    try {
      const data = await api.checkUpdate()
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

  const handleExport = async () => {
    setExporting(true)
    try {
      const blob = await api.exportInstance() as Blob
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `vantis_export_${new Date().toISOString().slice(0,10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Export failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportResult(null)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const result = await api.importInstance(data, true) as { status: string; imported: Record<string, unknown> }
      setImportResult(`Imported: ${Object.entries(result.imported).map(([k,v]) => `${k}=${v}`).join(', ')}`)
    } catch (e) {
      setImportResult('Import failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

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

        {/* Export / Import */}
        <div className="border border-border bg-surface relative">
          <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-accent/40" />
          <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-accent/40" />
          <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-accent/40" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-accent/40" />

          <div className="px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <HardDrive size={12} className="text-accent/70" />
              <span className="text-xs text-muted font-mono uppercase tracking-wider">Instance Export / Import</span>
            </div>
            <p className="text-[10px] text-muted/60 font-mono mt-1">
              Export memories, thoughts, goals, skills and personality. Import merges with existing data.
            </p>
          </div>

          <div className="px-5 py-4 flex items-center gap-3 flex-wrap">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-2 border border-memory/40 bg-transparent hover:bg-memory/10
                         text-memory font-mono py-2 px-4 text-xs uppercase tracking-wider
                         transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={12} />
              {exporting ? 'Exporting...' : 'Export Instance'}
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-2 border border-border bg-transparent hover:bg-white/5
                         text-muted hover:text-text font-mono py-2 px-4 text-xs uppercase tracking-wider
                         transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Upload size={12} />
              {importing ? 'Importing...' : 'Import Instance'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImport}
            />
          </div>

          {importResult && (
            <div className={`px-5 pb-4 text-[10px] font-mono ${importResult.startsWith('Import failed') ? 'text-danger' : 'text-memory'}`}>
              {importResult}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
