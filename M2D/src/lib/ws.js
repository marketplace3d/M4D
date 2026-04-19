// WebSocket → M3D /ws/algo (live council updates)
// Returns a writable Svelte store that auto-reconnects

import { writable } from 'svelte/store'

export function createAlgoWS() {
  const store = writable(null)
  let ws = null
  let retryTimer = null

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/ws/algo`)

    ws.onmessage = (e) => {
      try { store.set(JSON.parse(e.data)) } catch {}
    }

    ws.onclose = () => {
      retryTimer = setTimeout(connect, 3000)
    }

    ws.onerror = () => ws.close()
  }

  function stop() {
    clearTimeout(retryTimer)
    ws?.close()
  }

  return { subscribe: store.subscribe, connect, stop }
}
