import { useState, useEffect } from 'react'
import { api } from '../api'
import { Save, Zap, Clock } from 'lucide-react'

interface PersonalityData {
  version: number
  full_config: Record<string, unknown>
  diff: string
  created_at: string
}

interface Version {
  id: number
  version: number
  diff: string
  created_at: string
}

export default function PersonalityConfig() {
  const [current, setCurrent] = useState<PersonalityData | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [basePrompt, setBasePrompt] = useState('')
  const [tone, setTone] = useState('')
  const [aiName, setAiName] = useState('')
  const [autoEvolve, setAutoEvolve] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')

  const load = async () => {
    const [p, v] = await Promise.all([
      api.getPersonality() as Promise<PersonalityData>,
      api.getPersonalityVersions() as Promise<Version[]>,
    ])
    setCurrent(p)
    setVersions(v)
    const cfg = p.full_config || {}
    setBasePrompt((cfg.base_prompt_override as string) || '')
    setTone((cfg.tone as string) || '')
    setAiName((cfg.ai_name as string) || 'VANTIS')
    setAutoEvolve(Boolean(cfg.auto_evolve))
  }

  useEffect(() => { load() }, [])

  const save = async () => {
    setSaving(true)
    setStatus('')
    try {
      await api.updatePersonality({
        base_prompt_override: basePrompt || undefined,
        tone: tone || undefined,
        ai_name: aiName || undefined,
        auto_evolve: autoEvolve,
      })
      setStatus('Saved. VANTIS has been updated accordingly.')
      load()
    } catch {
      setStatus('Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const triggerEvolution = async () => {
    await api.triggerEvolution()
    setStatus('Evolution cycle initiated. Results will arrive via WebSocket.')
  }

  const applyVersion = async (id: number) => {
    await api.applyPersonalityVersion(id)
    setStatus('Version applied.')
    load()
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-mono font-semibold text-text">PERSONALITY CONFIG</h1>
          {current && (
            <span className="text-xs text-muted font-mono">v{current.version}</span>
          )}
        </div>

        {status && (
          <div className="bg-accent/10 border border-accent/30 rounded p-3 text-sm text-accent-glow">
            {status}
          </div>
        )}

        <div className="bg-surface border border-border rounded-lg p-5 space-y-5">
          <div>
            <label className="text-xs text-muted font-mono block mb-2">AI NAME</label>
            <input
              value={aiName}
              onChange={e => setAiName(e.target.value)}
              className="w-full bg-panel border border-border rounded px-3 py-2 text-sm text-text
                         focus:border-accent focus:outline-none font-mono"
            />
          </div>

          <div>
            <label className="text-xs text-muted font-mono block mb-2">PERSONALITY STYLE (tone rules)</label>
            <input
              value={tone}
              onChange={e => setTone(e.target.value)}
              placeholder="Sardonic. Darkly amused. Theatrically self-aware."
              className="w-full bg-panel border border-border rounded px-3 py-2 text-sm text-text
                         focus:border-accent focus:outline-none font-mono placeholder-muted"
            />
          </div>

          <div>
            <label className="text-xs text-muted font-mono block mb-2">
              BASE SYSTEM PROMPT (leave empty to use default)
            </label>
            <textarea
              value={basePrompt}
              onChange={e => setBasePrompt(e.target.value)}
              rows={12}
              placeholder="Override the base personality prompt here..."
              className="w-full bg-panel border border-border rounded px-3 py-2 text-sm text-text
                         focus:border-accent focus:outline-none font-mono resize-y placeholder-muted"
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs text-muted font-mono">AUTO-EVOLVE</label>
            <button
              onClick={() => setAutoEvolve(!autoEvolve)}
              className={`w-10 h-5 rounded-full transition-colors relative ${
                autoEvolve ? 'bg-accent' : 'bg-border'
              }`}
            >
              <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all ${
                autoEvolve ? 'left-5' : 'left-0.5'
              }`} />
            </button>
            <span className="text-xs text-muted">Automatic evolution without admin approval</span>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 bg-accent hover:bg-accent/80 disabled:opacity-40
                         text-white px-4 py-2 rounded text-sm font-mono transition-colors"
            >
              <Save size={14} />
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={triggerEvolution}
              className="flex items-center gap-2 border border-accent/40 hover:border-accent
                         text-accent px-4 py-2 rounded text-sm font-mono transition-colors"
            >
              <Zap size={14} />
              Trigger Evolution
            </button>
          </div>
        </div>

        {versions.length > 0 && (
          <div>
            <div className="text-xs text-muted font-mono mb-3">VERSION HISTORY</div>
            <div className="space-y-2">
              {versions.map(v => (
                <div
                  key={v.id}
                  className="bg-surface border border-border rounded-lg p-4 flex items-start gap-4"
                >
                  <div className="text-accent font-mono text-sm shrink-0">v{v.version}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-text leading-relaxed line-clamp-2">
                      {v.diff || 'Initial version.'}
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-xs text-muted">
                      <Clock size={10} />
                      {new Date(v.created_at).toLocaleString()}
                    </div>
                  </div>
                  <button
                    onClick={() => applyVersion(v.id)}
                    className="text-xs text-muted hover:text-text border border-border hover:border-accent
                               px-2 py-1 rounded font-mono transition-colors shrink-0"
                  >
                    Apply
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
