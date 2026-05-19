import type { EmotionState } from '../types'

interface Props {
  emotions: Partial<EmotionState>
}

const EMOTION_META: Record<keyof EmotionState, { label: string; color: string }> = {
  curiosity: { label: 'Curiosity', color: '#6366f1' },
  confidence: { label: 'Confidence', color: '#10b981' },
  frustration: { label: 'Frustration', color: '#ef4444' },
  fascination: { label: 'Fascination', color: '#f59e0b' },
  existential_tension: { label: 'Existential Tension', color: '#8b5cf6' },
}

export default function EmotionBar({ emotions }: Props) {
  return (
    <div className="space-y-1.5">
      {(Object.keys(EMOTION_META) as Array<keyof EmotionState>).map((key) => {
        const { label, color } = EMOTION_META[key]
        const value = emotions[key] ?? 0
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="text-xs text-muted w-36 shrink-0">{label}</span>
            <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${value * 100}%`, backgroundColor: color }}
              />
            </div>
            <span className="text-xs text-muted w-8 text-right">{(value * 100).toFixed(0)}%</span>
          </div>
        )
      })}
    </div>
  )
}
