import { useEffect, useRef, useCallback } from 'react'
import type { WsMessage } from '../types'

type Handler = (msg: WsMessage) => void

export function useWebSocket(onMessage: Handler) {
  const wsRef = useRef<WebSocket | null>(null)
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null)

  const connect = useCallback(() => {
    const token = localStorage.getItem('vantis_token')
    if (!token) return

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = window.location.host
    const ws = new WebSocket(`${proto}://${host}/ws?token=${token}`)

    ws.onmessage = (e) => {
      try {
        const msg: WsMessage = JSON.parse(e.data)
        onMessage(msg)
      } catch {}
    }

    ws.onopen = () => {
      heartbeat.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping')
      }, 30000)
    }

    ws.onclose = () => {
      if (heartbeat.current) clearInterval(heartbeat.current)
      setTimeout(connect, 3000)
    }

    wsRef.current = ws
  }, [onMessage])

  useEffect(() => {
    connect()
    return () => {
      if (heartbeat.current) clearInterval(heartbeat.current)
      wsRef.current?.close()
    }
  }, [connect])
}
