import { useEffect, useRef } from 'react'
import { Eye, Edit3, Link, Play, Trash2 } from 'lucide-react'

interface ContextMenuProps {
  x: number
  y: number
  nodeType: string
  nodeId: string
  dbId: number
  onClose: () => void
  onViewDetail: () => void
  onEdit: () => void
  onDelete: () => void
  onExecute?: () => void
  isAdmin: boolean
}

export default function ContextMenu({
  x,
  y,
  nodeType,
  nodeId: _nodeId,
  dbId: _dbId,
  onClose,
  onViewDetail,
  onEdit,
  onDelete,
  onExecute,
  isAdmin,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    // Slight delay so the right-click event that opened menu doesn't immediately close it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 50)
    document.addEventListener('keydown', handleKey)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const adjustedX = Math.min(x, window.innerWidth - 210)
  const adjustedY = Math.min(y, window.innerHeight - 240)

  const items: {
    icon: React.ReactNode
    label: string
    action: () => void
    className?: string
    show: boolean
  }[] = [
    {
      icon: <Eye size={11} />,
      label: 'View Details',
      action: () => { onViewDetail(); onClose() },
      show: true,
    },
    {
      icon: <Edit3 size={11} />,
      label: 'Edit Content',
      action: () => { onEdit(); onClose() },
      show: isAdmin,
    },
    {
      icon: <Link size={11} />,
      label: 'Link To...',
      action: () => { onClose() },
      show: true,
    },
    {
      icon: <Play size={11} />,
      label: 'Execute',
      action: () => { onExecute?.(); onClose() },
      show: isAdmin && nodeType === 'skill' && !!onExecute,
    },
    {
      icon: <Trash2 size={11} />,
      label: 'Delete Node',
      action: () => { onDelete(); onClose() },
      className: 'text-danger hover:bg-danger/10 hover:text-danger',
      show: isAdmin && nodeType !== 'system',
    },
  ]

  const visibleItems = items.filter(i => i.show)

  return (
    <div
      ref={menuRef}
      style={{ position: 'fixed', left: adjustedX, top: adjustedY, zIndex: 9999 }}
      className="corner-bracket"
    >
      <div
        className="min-w-[192px] bg-surface border border-accent/60"
        style={{
          boxShadow: '0 0 0 1px rgba(245,158,11,0.12), 0 8px 40px rgba(0,0,0,0.9), 0 0 24px rgba(245,158,11,0.06)',
        }}
      >
        {/* Header */}
        <div className="px-3 py-2 border-b border-border bg-panel flex items-center justify-between">
          <span className="text-[9px] font-mono text-muted tracking-[0.18em] uppercase">
            {nodeType.toUpperCase()} NODE
          </span>
          <span className="text-[9px] font-mono text-accent/50 tracking-widest">CTX</span>
        </div>

        {/* Items */}
        <div className="py-0.5">
          {visibleItems.map((item, idx) => {
            const isLast = idx === visibleItems.length - 1
            const isDanger = item.className?.includes('danger')
            return (
              <div key={idx}>
                {isDanger && visibleItems.length > 1 && (
                  <div className="mx-2 my-0.5 h-px bg-border/60" />
                )}
                <button
                  onClick={item.action}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-[11px] font-mono transition-colors text-left
                    ${item.className || 'text-text/80 hover:bg-accent/8 hover:text-accent'}`}
                  style={!item.className ? undefined : undefined}
                >
                  <span className="shrink-0 opacity-60">{item.icon}</span>
                  <span className="tracking-wide">{item.label}</span>
                </button>
                {isLast ? null : null}
              </div>
            )
          })}
        </div>

        {/* Bottom accent */}
        <div className="h-px bg-gradient-to-r from-accent/30 via-accent/10 to-transparent" />
      </div>
    </div>
  )
}
