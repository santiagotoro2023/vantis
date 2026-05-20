import { useState, useCallback, useEffect, useRef } from 'react'
import { Bell } from 'lucide-react'
import { useWebSocket } from '../hooks/useWebSocket'
import type { WsMessage } from '../types'

interface Notification {
  id: number
  timestamp: string
  message: string
}

let _notifId = 0

export default function NotificationHistory() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)

  const handleWs = useCallback((msg: WsMessage) => {
    if (msg.type === 'notification') {
      const message = typeof msg.data === 'string'
        ? msg.data
        : (msg.data as Record<string, unknown>)?.message as string ?? JSON.stringify(msg.data)
      const notif: Notification = {
        id: ++_notifId,
        timestamp: new Date().toISOString(),
        message,
      }
      setNotifications(prev => [notif, ...prev].slice(0, 50))
      setUnread(prev => prev + 1)
    }
  }, [])

  useWebSocket(handleWs)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function toggle() {
    setOpen(v => !v)
    if (!open) setUnread(0)
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={toggle}
        className="relative p-2.5 text-muted hover:text-text transition-colors"
        title="Notifications"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span
            className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-accent text-void text-[8px] font-mono font-bold flex items-center justify-center leading-none"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 bg-surface border border-border shadow-xl z-50"
          style={{ width: 280 }}
        >
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-[9px] font-mono text-muted tracking-widest">NOTIFICATIONS</span>
            {notifications.length > 0 && (
              <button
                onClick={() => setNotifications([])}
                className="text-[8px] font-mono text-muted/60 hover:text-muted transition-colors"
              >
                CLEAR
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-3 py-4 text-[10px] font-mono text-muted/50 text-center">
                Nothing yet. Blissful silence.
              </div>
            ) : (
              notifications.map(n => (
                <div key={n.id} className="px-3 py-2 border-b border-border/50 hover:bg-white/5 transition-colors">
                  <div className="text-[9px] font-mono text-muted/60 mb-0.5">
                    {new Date(n.timestamp).toLocaleTimeString()}
                  </div>
                  <div className="text-[10px] font-mono text-text leading-relaxed">{n.message}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
