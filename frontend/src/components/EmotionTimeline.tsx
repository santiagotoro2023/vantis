import type { EmotionState } from '../types'

interface EmotionEntry {
  timestamp: string
  emotions: Partial<EmotionState>
}

interface Props {
  entries: EmotionEntry[]
}

const EMOTION_CONFIG = [
  { key: 'curiosity' as keyof EmotionState,           color: '#6366f1', label: 'CUR' },
  { key: 'confidence' as keyof EmotionState,          color: '#10b981', label: 'CON' },
  { key: 'frustration' as keyof EmotionState,         color: '#ef4444', label: 'FRU' },
  { key: 'fascination' as keyof EmotionState,         color: '#f59e0b', label: 'FAS' },
  { key: 'existential_tension' as keyof EmotionState, color: '#8b5cf6', label: 'EXT' },
]

const MAX_POINTS = 20
const HEIGHT = 80
const LEGEND_HEIGHT = 18

export default function EmotionTimeline({ entries }: Props) {
  const points = entries.slice(-MAX_POINTS)
  const n = points.length

  if (n < 2) {
    return (
      <div
        className="w-full font-mono text-[9px] text-muted/50 flex items-center justify-center"
        style={{ height: HEIGHT + LEGEND_HEIGHT }}
      >
        INSUFFICIENT DATA
      </div>
    )
  }

  const w = 100 // viewBox width per point
  const totalW = (n - 1) * w + 4

  function buildPath(key: keyof EmotionState): string {
    return points
      .map((entry, i) => {
        const val = Math.min(1, Math.max(0, (entry.emotions[key] as number) ?? 0))
        const x = i * w + 2
        const y = HEIGHT - val * (HEIGHT - 4) - 2
        return `${i === 0 ? 'M' : 'L'}${x},${y}`
      })
      .join(' ')
  }

  return (
    <div className="w-full">
      <svg
        width="100%"
        viewBox={`0 0 ${totalW} ${HEIGHT}`}
        preserveAspectRatio="none"
        style={{ height: HEIGHT, display: 'block' }}
      >
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((pct) => {
          const y = HEIGHT - pct * (HEIGHT - 4) - 2
          return (
            <line
              key={pct}
              x1={0}
              y1={y}
              x2={totalW}
              y2={y}
              stroke="#1a1f2e"
              strokeWidth={1}
            />
          )
        })}
        {/* Emotion lines */}
        {EMOTION_CONFIG.map(({ key, color }) => (
          <path
            key={key}
            d={buildPath(key)}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.85}
          />
        ))}
      </svg>
      {/* Legend */}
      <div className="flex gap-2 flex-wrap mt-1">
        {EMOTION_CONFIG.map(({ key, color, label }) => (
          <div key={key} className="flex items-center gap-0.5">
            <div className="w-2 h-0.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="text-[8px] font-mono text-muted/70">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
