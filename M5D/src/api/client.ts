import { useState, useEffect, useRef } from 'react'
import type { CouncilSnapshot, CrossAssetReport, GateReport, PaperStatus, ActivityReport } from '../types'

const API = ''           // proxied via Vite → :3300
const DS  = '/ds'        // proxied via Vite → :8000

export function usePoll<T>(url: string, ms = 30_000): T | null {
  const [d, setD] = useState<T | null>(null)
  const ref = useRef(url)
  ref.current = url
  useEffect(() => {
    let live = true
    const run = () =>
      fetch(ref.current)
        .then(r => r.json())
        .then(x => { if (live) setD(x) })
        .catch(() => {})
    run()
    const id = setInterval(run, ms)
    return () => { live = false; clearInterval(id) }
  }, [ms])
  return d
}

export const useCouncil     = () => usePoll<CouncilSnapshot>(`${API}/v1/council`, 10_000)
export const useCrossAsset  = () => usePoll<CrossAssetReport>(`${DS}/v1/cross/report/`, 60_000)
export const useGateReport  = () => usePoll<GateReport>(`${DS}/v1/gate/report/`, 120_000)
export const usePaperStatus = () => usePoll<PaperStatus>(`${DS}/v1/paper/status/`, 30_000)
export const useActivity    = () => usePoll<ActivityReport>(`${DS}/v1/ai/activity/`, 30_000)
