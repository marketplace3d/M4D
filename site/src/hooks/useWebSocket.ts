import { useEffect, useRef, useCallback, useState } from 'react'
import type { WsMessage } from '../types'

interface UseWebSocketOptions {
  onMessage?: (msg: WsMessage) => void
  reconnectDelay?: number
  maxRetries?: number
}

export interface WebSocketState {
  connected: boolean
  error: string | null
  lastMessage: WsMessage | null
  reconnectCount: number
}

export function useWebSocket(
  url: string = 'ws://localhost:3030/ws/algo',
  options: UseWebSocketOptions = {}
) {
  const { onMessage, reconnectDelay = 3000, maxRetries = 10 } = options

  const [state, setState] = useState<WebSocketState>({
    connected: false,
    error: null,
    lastMessage: null,
    reconnectCount: 0,
  })

  const wsRef = useRef<WebSocket | null>(null)
  const retriesRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    try {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) return
        retriesRef.current = 0
        setState(s => ({ ...s, connected: true, error: null }))
      }

      ws.onmessage = (event: MessageEvent) => {
        if (!mountedRef.current) return
        try {
          const msg = JSON.parse(event.data as string) as WsMessage
          setState(s => ({ ...s, lastMessage: msg }))
          onMessage?.(msg)
        } catch {
          // ignore parse errors
        }
      }

      ws.onerror = () => {
        if (!mountedRef.current) return
        setState(s => ({ ...s, error: 'WebSocket connection error' }))
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        setState(s => ({ ...s, connected: false }))

        if (retriesRef.current < maxRetries) {
          retriesRef.current++
          timeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              setState(s => ({ ...s, reconnectCount: retriesRef.current }))
              connect()
            }
          }, reconnectDelay)
        } else {
          setState(s => ({
            ...s,
            error: `WebSocket disconnected after ${maxRetries} retries`,
          }))
        }
      }
    } catch (err) {
      setState(s => ({
        ...s,
        error: err instanceof Error ? err.message : 'Failed to connect',
      }))
    }
  }, [url, onMessage, reconnectDelay, maxRetries])

  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [connect])

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  const disconnect = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    wsRef.current?.close()
  }, [])

  return { ...state, send, disconnect }
}
