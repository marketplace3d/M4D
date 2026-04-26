import { useState, useEffect, useRef } from 'react'
import type { CouncilSnapshot, CrossAssetReport, ActivityReport } from '../types'

interface Alert {
  id: number
  level: 'euphoria' | 'warn' | 'info' | 'dead'
  title: string
  body: string
  ts: number
}

interface Props {
  council:    CouncilSnapshot | null
  crossAsset: CrossAssetReport | null
  activity:   ActivityReport  | null
}

let _seq = 0

export default function SurfacingPanel({ council, crossAsset, activity }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>([])

  const prevRegime   = useRef<string | null>(null)
  const prevActivity = useRef<string | null>(null)
  const prevCA       = useRef<string | null>(null)
  const prevJedi     = useRef<number | null>(null)
  const prevJediEuph = useRef(false)

  const push = (a: Omit<Alert, 'id' | 'ts'>) => {
    const alert: Alert = { ...a, id: ++_seq, ts: Date.now() }
    setAlerts(prev => [alert, ...prev].slice(0, 5))
    setTimeout(() => dismiss(alert.id), 12_000)
  }

  const dismiss = (id: number) =>
    setAlerts(prev => prev.filter(a => a.id !== id))

  // regime change
  useEffect(() => {
    const r = council?.regime ?? null
    if (r && prevRegime.current && r !== prevRegime.current)
      push({
        level: r === 'TRENDING' ? 'info' : r === 'RISK-OFF' ? 'warn' : 'info',
        title: 'REGIME SHIFT',
        body: `${prevRegime.current} → ${r}`,
      })
    prevRegime.current = r
  }, [council?.regime])

  // JEDI EUPHORIA threshold crossing (±18)
  useEffect(() => {
    const j = council?.jedi_score ?? null
    if (j !== null) {
      const isEuph = Math.abs(j) >= 18
      if (isEuph && !prevJediEuph.current)
        push({ level: 'euphoria', title: 'EUPHORIA THRESHOLD', body: `JEDI ${j > 0 ? '+' : ''}${j.toFixed(0)} — all banks aligned` })
      if (!isEuph && prevJediEuph.current)
        push({ level: 'warn', title: 'EUPHORIA CLEARED', body: `JEDI dropped to ${j.toFixed(0)}` })
      prevJediEuph.current = isEuph
    }
    prevJedi.current = j
  }, [council?.jedi_score])

  // activity gate change
  useEffect(() => {
    const g = activity?.gate_status ?? null
    if (g && prevActivity.current && g !== prevActivity.current) {
      const lvl = g === 'HOT' ? 'euphoria' : g === 'DEAD' ? 'dead' : 'info'
      push({ level: lvl, title: 'ACTIVITY GATE', body: `${prevActivity.current} → ${g}` })
    }
    prevActivity.current = g
  }, [activity?.gate_status])

  // cross-asset flip
  useEffect(() => {
    const r = crossAsset?.regime ?? null
    if (r && prevCA.current && r !== prevCA.current) {
      const lvl = r === 'RISK_OFF' ? 'warn' : r === 'RISK_ON' ? 'info' : 'info'
      push({ level: lvl, title: 'CROSS-ASSET FLIP', body: `${prevCA.current} → ${r}` })
    }
    prevCA.current = r
  }, [crossAsset?.regime])

  if (!alerts.length) return null

  return (
    <div style={{
      position: 'fixed', bottom: 16, right: 340, zIndex: 999,
      display: 'flex', flexDirection: 'column', gap: 6, width: 280,
    }}>
      {alerts.map(a => (
        <div key={a.id} style={{
          background: levelBg(a.level),
          border: `1px solid ${levelBorder(a.level)}`,
          borderRadius: 3,
          padding: '6px 10px',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          animation: 'fadeSlideIn 0.2s ease',
          cursor: 'pointer',
        }} onClick={() => dismiss(a.id)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 9, letterSpacing: '0.12em', color: levelColor(a.level) }}>
              {a.title}
            </span>
            <span style={{ color: 'var(--text3)', fontSize: 8 }}>✕</span>
          </div>
          <span style={{ color: 'var(--text2)' }}>{a.body}</span>
        </div>
      ))}
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

function levelBg(l: Alert['level']) {
  switch (l) {
    case 'euphoria': return 'rgba(29,255,122,0.08)'
    case 'warn':     return 'rgba(255,204,58,0.08)'
    case 'dead':     return 'rgba(255,74,90,0.08)'
    default:         return 'rgba(58,143,255,0.08)'
  }
}
function levelBorder(l: Alert['level']) {
  switch (l) {
    case 'euphoria': return 'var(--green)'
    case 'warn':     return 'var(--gold)'
    case 'dead':     return 'var(--red)'
    default:         return 'var(--accentD)'
  }
}
function levelColor(l: Alert['level']) {
  switch (l) {
    case 'euphoria': return 'var(--greenB)'
    case 'warn':     return 'var(--goldB)'
    case 'dead':     return 'var(--redB)'
    default:         return 'var(--accent)'
  }
}
