import { useState, useEffect } from 'react'
import { api } from '../api'
import { Store, Download, Check, AlertCircle, RefreshCw } from 'lucide-react'
import clsx from 'clsx'

interface MarketplaceSkill {
  id: string
  name: string
  category: string
  description: string
  trigger_conditions: string
  author: string
  installed: boolean
}

interface Registry {
  version: string
  skills: MarketplaceSkill[]
}

const CATEGORY_COLORS: Record<string, string> = {
  utilities: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  finance: 'text-green-400 bg-green-400/10 border-green-400/30',
  system: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  development: 'text-purple-400 bg-purple-400/10 border-purple-400/30',
}

export default function MarketplacePage() {
  const [registry, setRegistry] = useState<Registry | null>(null)
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')

  const fetchMarketplace = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getMarketplace()
      setRegistry(data)
      const installed = new Set(
        data.skills.filter(s => s.installed).map(s => s.id)
      )
      setInstalledIds(installed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load marketplace')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchMarketplace() }, [])

  const handleInstall = async (skill: MarketplaceSkill) => {
    setInstalling(prev => new Set(prev).add(skill.id))
    try {
      await api.installMarketplaceSkill(skill.id)
      await fetchMarketplace()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Install failed')
    } finally {
      setInstalling(prev => {
        const next = new Set(prev)
        next.delete(skill.id)
        return next
      })
    }
  }

  const categories = registry
    ? Array.from(new Set(registry.skills.map(s => s.category))).sort()
    : []

  const filtered = registry?.skills.filter(skill => {
    const matchesCategory = !filter || skill.category === filter
    const matchesSearch =
      !search ||
      skill.name.toLowerCase().includes(search.toLowerCase()) ||
      skill.description.toLowerCase().includes(search.toLowerCase()) ||
      skill.trigger_conditions.toLowerCase().includes(search.toLowerCase())
    return matchesCategory && matchesSearch
  }) ?? []

  return (
    <div className="flex flex-col h-full bg-void">
      {/* Header */}
      <div className="border-b border-border bg-surface px-6 py-4 flex items-center gap-3 shrink-0">
        <Store size={18} className="text-accent" />
        <div>
          <h1 className="font-mono text-sm font-bold text-text tracking-wider uppercase">
            Skill Marketplace
          </h1>
          <p className="text-xs text-muted font-mono mt-0.5">
            {registry ? `v${registry.version} — ${registry.skills.length} skills available` : 'Fetching registry...'}
          </p>
        </div>
        <button
          onClick={fetchMarketplace}
          disabled={loading}
          className="ml-auto p-1.5 text-muted hover:text-accent transition-colors disabled:opacity-40"
          title="Refresh marketplace"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filters */}
      <div className="border-b border-border bg-surface/50 px-6 py-3 flex items-center gap-3 shrink-0 flex-wrap">
        <input
          type="text"
          placeholder="Search skills..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-void border border-border text-text font-mono text-xs px-3 py-1.5 outline-none
                     focus:border-accent/50 placeholder:text-muted/50 w-48"
        />
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setFilter('')}
            className={clsx(
              'px-2.5 py-1 text-xs font-mono border transition-colors',
              !filter
                ? 'border-accent text-accent bg-accent/10'
                : 'border-border text-muted hover:text-text hover:border-border/80'
            )}
          >
            All
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setFilter(filter === cat ? '' : cat)}
              className={clsx(
                'px-2.5 py-1 text-xs font-mono border transition-colors capitalize',
                filter === cat
                  ? CATEGORY_COLORS[cat] || 'border-accent text-accent bg-accent/10'
                  : 'border-border text-muted hover:text-text'
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {error && (
          <div className="mb-4 flex items-center gap-2 text-danger text-xs font-mono border border-danger/30 bg-danger/5 px-3 py-2">
            <AlertCircle size={13} />
            {error}
          </div>
        )}

        {loading && !registry && (
          <div className="flex items-center justify-center h-40 text-muted text-xs font-mono gap-2">
            <RefreshCw size={14} className="animate-spin" />
            Loading marketplace...
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex items-center justify-center h-40 text-muted text-xs font-mono">
            No skills match your filter.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(skill => {
            const isInstalled = installedIds.has(skill.id) || skill.installed
            const isInstalling = installing.has(skill.id)
            const catColor = CATEGORY_COLORS[skill.category] || 'text-muted bg-muted/10 border-muted/30'

            return (
              <div
                key={skill.id}
                className="border border-border bg-surface flex flex-col gap-3 p-4 hover:border-border/80 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-sm text-text font-semibold truncate">{skill.name}</span>
                  <span className={clsx('text-[10px] font-mono px-1.5 py-0.5 border capitalize shrink-0', catColor)}>
                    {skill.category}
                  </span>
                </div>

                <p className="text-xs text-muted font-mono leading-relaxed flex-1">
                  {skill.description}
                </p>

                <div className="text-[10px] text-muted/60 font-mono truncate" title={skill.trigger_conditions}>
                  Triggers: {skill.trigger_conditions}
                </div>

                <div className="flex items-center justify-between mt-auto pt-1 border-t border-border/40">
                  <span className="text-[10px] text-muted/50 font-mono">{skill.author}</span>
                  {isInstalled ? (
                    <span className="flex items-center gap-1 text-[10px] text-green-400 font-mono">
                      <Check size={11} />
                      Installed
                    </span>
                  ) : (
                    <button
                      onClick={() => handleInstall(skill)}
                      disabled={isInstalling}
                      className={clsx(
                        'flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 border transition-colors',
                        isInstalling
                          ? 'border-border text-muted opacity-60 cursor-not-allowed'
                          : 'border-accent/50 text-accent hover:bg-accent/10'
                      )}
                    >
                      <Download size={11} className={isInstalling ? 'animate-bounce' : ''} />
                      {isInstalling ? 'Installing...' : 'Install'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
