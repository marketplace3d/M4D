/**
 * MAXCOGVIZ ALPHA — 12-dimensional market intelligence radar.
 * The ground slope beneath our feet: macro, money flow, geopolitical,
 * pandemic, energy, central banks, crypto-native, sentiment, velocity,
 * black swan, tech disruption, alpha signal.
 *
 * Multi-model: xAI Grok-4.20 + Claude + Gemini in parallel.
 * Structured JSON → radar polygon + dimension grid + hourly history.
 * 3D-ready data structure.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Card, Elevation, Button, Spinner, Callout, Tag } from '@blueprintjs/core'
import { useCouncil, useAlgoDay } from '../api/client'

// ── 12 Alpha Dimensions ───────────────────────────────────────────────────────
const DIMS = [
  { id: 'macro_slope',     label: 'MACRO SLOPE',    icon: '🏔', desc: 'Yield curve · DXY · real rates',      color: '#22d3ee' },
  { id: 'money_flow',      label: 'MONEY FLOW',     icon: '💰', desc: 'Institutional capital rotation',       color: '#4ade80' },
  { id: 'geopolitical',    label: 'GEOPOLITICAL',   icon: '⚔', desc: 'War · sanctions · supply chains',     color: '#f43f5e' },
  { id: 'pandemic',        label: 'PANDEMIC',       icon: '🦠', desc: 'Biosecurity · shutdown risk',          color: '#f97316' },
  { id: 'energy',          label: 'ENERGY',         icon: '⚡', desc: 'Oil · gas · rare earth · food',        color: '#fbbf24' },
  { id: 'central_bank',    label: 'CENTRAL BANK',   icon: '🏦', desc: 'Fed pivot · ECB · BOJ · PBOC',         color: '#a78bfa' },
  { id: 'crypto_native',   label: 'CRYPTO',         icon: '₿',  desc: 'On-chain · ETF flows · halving',       color: '#FFB74D' },
  { id: 'sentiment_wave',  label: 'SENTIMENT',      icon: '🌊', desc: 'Fear/greed 1d · 1w · 1m wave',         color: '#38bdf8' },
  { id: 'velocity',        label: 'VELOCITY',       icon: '⚡', desc: 'Rate of change · acceleration',        color: '#34d399' },
  { id: 'black_swan',      label: 'BLACK SWAN',     icon: '🦢', desc: 'Tail risk · 3σ · known unknowns',      color: '#64748b' },
  { id: 'tech_disruption', label: 'TECH DISRUPT',   icon: '🤖', desc: 'AI displacement · sector rotation',   color: '#e879f9' },
  { id: 'alpha_signal',    label: 'ALPHA SIGNAL',   icon: '◈',  desc: 'Synthesised across all 11 dims',       color: '#FFB74D' },
]

const GROUND_SLOPE_LABELS: Record<string, { label: string; color: string; desc: string }> = {
  STEEP_RISE: { label: '⬆ STEEP RISE', color: '#4ade80', desc: 'Strong structural tailwind — press longs' },
  RISING:     { label: '↗ RISING',     color: '#86efac', desc: 'Positive slope — conditions improving' },
  FLAT:       { label: '→ FLAT',       color: '#fbbf24', desc: 'No directional edge — stay disciplined' },
  FALLING:    { label: '↘ FALLING',    color: '#f97316', desc: 'Structural headwind — reduce exposure' },
  CLIFF_EDGE: { label: '⬇ CLIFF EDGE', color: '#ff1744', desc: 'Extreme structural risk — SEALS protocol' },
}

const POSTURE_COLOR: Record<string, string> = {
  FULL_RISK_ON: '#4ade80', RISK_ON: '#86efac', NEUTRAL: '#fbbf24',
  RISK_OFF: '#f97316',    CRISIS: '#ff1744',
}

// ── SVG Radar Polygon + Spidy-sense change wings ─────────────────────────────
// prevScores = ghost shape (last run or MA). Delta wings show direction of travel.
// Rising dim  → green boomerang pointing OUTWARD (expanding)
// Falling dim → red boomerang pointing INWARD  (contracting)
function RadarPolygon({
  scores,
  prevScores,
}: {
  scores:      Record<string, number>
  prevScores?: Record<string, number>
}) {
  const N = DIMS.length
  const CX = 200, CY = 200, R = 160
  const rings = [0.25, 0.5, 0.75, 1.0]

  // Axis angle for dimension i
  const angle = (i: number) => (i / N) * 2 * Math.PI - Math.PI / 2

  function polar(i: number, r: number) {
    const a = angle(i)
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) }
  }

  // -10..+10 → 0.05..1 radial fraction
  const norm = (s: number) => Math.max(0.05, (s + 10) / 20)

  const polyPts = DIMS.map((d, i) => {
    const pt = polar(i, R * norm(scores[d.id] ?? 0))
    return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`
  }).join(' ')

const composite = DIMS.reduce((sum, d) => sum + (scores[d.id] ?? 0), 0) / N
  const fill   = composite > 1 ? 'rgba(74,222,128,0.15)' : composite < -1 ? 'rgba(244,63,94,0.15)' : 'rgba(255,183,77,0.1)'
  const stroke = composite > 1 ? '#4ade80'               : composite < -1 ? '#f43f5e'               : '#FFB74D'

  // Diff sector: filled arc ring between prev and curr radius for dimension i.
  // Green where expanding, red where contracting. Bright area = magnitude of change.
  function diffSector(i: number, curr: number, prev: number): { path: string; col: string; alpha: number } | null {
    const delta = curr - prev
    if (Math.abs(delta) < 0.4) return null

    const span = (0.72 * Math.PI) / N   // 72% of sector width — leaves visible gaps
    const a0   = angle(i) - span
    const a1   = angle(i) + span

    const r0 = R * norm(Math.min(curr, prev))  // inner radius
    const r1 = R * norm(Math.max(curr, prev))  // outer radius
    if (r1 - r0 < 1) return null               // too thin to see

    const ix0 = (CX + r0 * Math.cos(a0)).toFixed(1), iy0 = (CY + r0 * Math.sin(a0)).toFixed(1)
    const ix1 = (CX + r0 * Math.cos(a1)).toFixed(1), iy1 = (CY + r0 * Math.sin(a1)).toFixed(1)
    const ox0 = (CX + r1 * Math.cos(a0)).toFixed(1), oy0 = (CY + r1 * Math.sin(a0)).toFixed(1)
    const ox1 = (CX + r1 * Math.cos(a1)).toFixed(1), oy1 = (CY + r1 * Math.sin(a1)).toFixed(1)

    const path = `M ${ix0} ${iy0} A ${r0.toFixed(1)} ${r0.toFixed(1)} 0 0 1 ${ix1} ${iy1} L ${ox1} ${oy1} A ${r1.toFixed(1)} ${r1.toFixed(1)} 0 0 0 ${ox0} ${oy0} Z`
    const col   = delta > 0 ? '#4ade80' : '#f43f5e'
    const alpha = Math.min(0.75, 0.25 + Math.abs(delta) * 0.05)
    return { path, col, alpha }
  }

  return (
    <svg width={400} height={400} style={{ display: 'block', margin: '0 auto' }}>
      {/* Grid rings */}
      {rings.map((r, ri) => {
        const pts = DIMS.map((_, i) => {
          const pt = polar(i, R * r)
          return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`
        }).join(' ')
        return <polygon key={ri} points={pts} fill="none"
          stroke={`rgba(255,255,255,${0.03 + ri * 0.02})`} strokeWidth={1} />
      })}

      {/* Axis lines */}
      {DIMS.map((_, i) => {
        const outer = polar(i, R)
        return <line key={i} x1={CX} y1={CY} x2={outer.x} y2={outer.y}
          stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
      })}

      {/* Diff sectors — colored arc bands between prev and curr per dimension */}
      {prevScores && DIMS.map((d, i) => {
        const s = diffSector(i, scores[d.id] ?? 0, prevScores[d.id] ?? 0)
        if (!s) return null
        return <path key={`diff-${d.id}`} d={s.path} fill={s.col} opacity={s.alpha} />
      })}

      {/* Current data polygon */}
      <polygon points={polyPts} fill={fill} stroke={stroke}
        strokeWidth={2} strokeLinejoin="round" />

      {/* Score dots on current polygon */}
      {DIMS.map((d, i) => {
        const s   = scores[d.id] ?? 0
        const pt  = polar(i, R * norm(s))
        const col = s > 3 ? '#4ade80' : s < -3 ? '#f43f5e' : '#fbbf24'
        return <circle key={d.id} cx={pt.x} cy={pt.y} r={4} fill={col} />
      })}

      {/* Labels */}
      {DIMS.map((d, i) => {
        const outer  = polar(i, R + 22)
        const s      = scores[d.id] ?? 0
        const prev   = prevScores?.[d.id]
        const delta  = prev !== undefined ? s - prev : 0
        const col    = s > 3 ? '#4ade80' : s < -3 ? '#f43f5e' : d.color
        const anchor = outer.x < CX - 5 ? 'end' : outer.x > CX + 5 ? 'start' : 'middle'
        const arrow  = Math.abs(delta) >= 0.4 ? (delta > 0 ? ' ▲' : ' ▼') : ''
        const arCol  = delta > 0 ? '#4ade80' : '#f43f5e'
        return (
          <g key={d.id}>
            <text x={outer.x} y={outer.y - 4} textAnchor={anchor}
              fontSize={9} fill={col} fontFamily="monospace" fontWeight={700}>
              {d.icon} {d.label}
            </text>
            <text x={outer.x} y={outer.y + 8} textAnchor={anchor}
              fontSize={8} fontFamily="monospace">
              <tspan fill={col + 'cc'}>{s > 0 ? '+' : ''}{s.toFixed(1)}</tspan>
              {arrow && <tspan fill={arCol} fontSize={7}>{arrow}</tspan>}
            </text>
          </g>
        )
      })}

      {/* Centre */}
      <text x={CX} y={CY - 6} textAnchor="middle" fontSize={20} fontWeight={800}
        fill={stroke} fontFamily="monospace">
        {composite > 0 ? '+' : ''}{composite.toFixed(1)}
      </text>
      <text x={CX} y={CY + 10} textAnchor="middle" fontSize={9}
        fill="rgba(255,255,255,0.4)" fontFamily="monospace">
        ALPHA COMPOSITE
      </text>

      {/* Legend */}
      {prevScores && (
        <g>
          <rect x={8} y={383} width={12} height={8} rx={2} fill="#4ade80" opacity={0.6} />
          <text x={24} y={391} fontSize={8} fill="rgba(255,255,255,0.4)" fontFamily="monospace">rising</text>
          <rect x={64} y={383} width={12} height={8} rx={2} fill="#f43f5e" opacity={0.6} />
          <text x={80} y={391} fontSize={8} fill="rgba(255,255,255,0.4)" fontFamily="monospace">falling</text>
        </g>
      )}
    </svg>
  )
}

// ── Ground Slope Visualisation ────────────────────────────────────────────────
function GroundSlope({ slope }: { slope: string }) {
  const info = GROUND_SLOPE_LABELS[slope] ?? GROUND_SLOPE_LABELS.FLAT
  const pct = slope === 'STEEP_RISE' ? 90 : slope === 'RISING' ? 65 : slope === 'FLAT' ? 50
    : slope === 'FALLING' ? 35 : 10

  return (
    <div style={{ padding: 12, background: '#0a0f1a', borderRadius: 8,
      border: `1px solid ${info.color}33` }}>
      <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
        Ground Slope — Structural Market Force
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: info.color, fontFamily: 'monospace', marginBottom: 4 }}>
        {info.label}
      </div>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8 }}>{info.desc}</div>
      {/* Terrain bar */}
      <div style={{ height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
        <div style={{
          height: '100%', borderRadius: 4, transition: 'width 1s ease',
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${info.color}66, ${info.color})`,
        }} />
      </div>
    </div>
  )
}

// ── Dimension Card ────────────────────────────────────────────────────────────
function DimCard({ dim, data }: { dim: typeof DIMS[0]; data: any }) {
  if (!data) return null
  const s = data.score ?? 0
  const col = s > 3 ? '#4ade80' : s < -3 ? '#f43f5e' : s > 0 ? '#fbbf24' : '#94a3b8'
  const dirIcon = data.direction === 'UP' ? '↑' : data.direction === 'DOWN' ? '↓' : '→'

  return (
    <div style={{
      background: '#0a0f1a', borderRadius: 8, padding: 10,
      border: `1px solid ${dim.color}22`,
      borderLeft: `3px solid ${col}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 14 }}>{dim.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: dim.color, fontFamily: 'monospace', letterSpacing: 0.5 }}>
            {dim.label}
          </div>
          <div style={{ fontSize: 8, color: '#334155' }}>{dim.desc}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: col, fontFamily: 'monospace' }}>
            {s > 0 ? '+' : ''}{s.toFixed(1)}
          </div>
          <div style={{ fontSize: 10, color: col }}>{dirIcon} {data.confidence ?? 0}%</div>
        </div>
      </div>
      {data.signal && (
        <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic', marginBottom: 3 }}>
          "{data.signal}"
        </div>
      )}
      {/* Score bar */}
      <div style={{ height: 3, background: '#1e293b', borderRadius: 2, position: 'relative' }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#334155' }} />
        <div style={{
          position: 'absolute', height: '100%', borderRadius: 2, background: col,
          left: s >= 0 ? '50%' : `${(0.5 + s / 20) * 100}%`,
          width: `${(Math.abs(s) / 20) * 100}%`,
        }} />
      </div>
      {/* Extra fields */}
      {(data.hot_sector || data.hotspot || data.key_event || data.key_metric || data.top_risk || data.key_commodity) && (
        <div style={{ fontSize: 8, color: '#475569', marginTop: 4 }}>
          {data.hot_sector && <span>▸ {data.hot_sector} </span>}
          {data.hotspot && <span>▸ {data.hotspot} </span>}
          {data.key_event && <span>▸ {data.key_event} </span>}
          {data.key_metric && <span>▸ {data.key_metric} </span>}
          {data.top_risk && <span>▸ {data.top_risk} </span>}
          {data.key_commodity && <span>▸ {data.key_commodity} </span>}
          {data.fear_greed !== undefined && <span>▸ F&G: {data.fear_greed} </span>}
        </div>
      )}
    </div>
  )
}

// ── History Sparkline ─────────────────────────────────────────────────────────
function HistoryLine({ history }: { history: any[] }) {
  if (history.length < 2) return null
  const vals = history.map((h: any) => h.alpha_composite ?? 0)
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1
  const W = 600, H = 50
  const pts = vals.map((v: number, i: number) => {
    const x = (i / (vals.length - 1)) * W
    const y = H - ((v - min) / range) * (H - 6) - 3
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const last = vals[vals.length - 1]
  const col = last > 2 ? '#4ade80' : last < -2 ? '#f43f5e' : '#fbbf24'

  return (
    <div style={{ padding: '8px 12px', background: '#0a0f1a', borderRadius: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1 }}>
          Alpha Composite — last {history.length} readings
        </span>
        <span style={{ fontSize: 9, color: col, fontFamily: 'monospace' }}>
          {last > 0 ? '+' : ''}{last.toFixed(2)}
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
        <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
        <polyline points={pts} fill="none" stroke={col} strokeWidth={1.5} />
        <circle cx={parseFloat(pts.split(' ').pop()!.split(',')[0])} cy={parseFloat(pts.split(' ').pop()!.split(',')[1])} r={3} fill={col} />
      </svg>
    </div>
  )
}

// ── Dimension Profile — bidirectional horizontal bar chart ────────────────────
// Like a volume profile: each row = 1 dimension, bar extends left(bear) or right(bull)
// Pattern recognition at a glance — when you see a pattern, you can code it.
function DimensionProfile({
  scores, dims, sortBy,
}: {
  scores: Record<string, number>
  dims: typeof DIMS
  sortBy: 'fixed' | 'magnitude' | 'score'
}) {
  const MAX = 10
  const ordered = [...dims].sort((a, b) => {
    if (sortBy === 'magnitude') return Math.abs(scores[b.id] ?? 0) - Math.abs(scores[a.id] ?? 0)
    if (sortBy === 'score')     return (scores[b.id] ?? 0) - (scores[a.id] ?? 0)
    return 0 // fixed = DIMS order
  })

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Axis label */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9,
        color: '#334155', fontFamily: 'monospace', marginBottom: 6, padding: '0 8px' }}>
        <span>← BEAR −10</span>
        <span style={{ color: '#1e3a5f' }}>0</span>
        <span>BULL +10 →</span>
      </div>

      {ordered.map(dim => {
        const score = scores[dim.id] ?? 0
        const pct   = Math.abs(score) / MAX * 50   // 50% = full side
        const isPos = score >= 0
        const col   = isPos ? (score > 6 ? '#4ade80' : '#86efac') : (score < -6 ? '#f43f5e' : '#f97316')
        const barStyle: React.CSSProperties = {
          position: 'absolute',
          top: 0, bottom: 0,
          width: `${pct}%`,
          background: `${col}cc`,
          borderRadius: isPos ? '0 3px 3px 0' : '3px 0 0 3px',
          left:  isPos ? '50%' : `${50 - pct}%`,
          transition: 'width 0.4s ease',
        }

        return (
          <div key={dim.id} style={{ display: 'flex', alignItems: 'center', gap: 0,
            padding: '2px 8px', borderRadius: 4,
            background: 'rgba(255,255,255,0.01)',
            marginBottom: 2,
          }}>
            {/* Label */}
            <div style={{ width: 130, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              <span style={{ fontSize: 11 }}>{dim.icon}</span>
              <span style={{ fontSize: 10, color: '#64748b', letterSpacing: 0.3 }}>{dim.label}</span>
            </div>

            {/* Bidirectional bar */}
            <div style={{ flex: 1, position: 'relative', height: 18,
              background: 'rgba(255,255,255,0.03)', borderRadius: 3 }}>
              {/* Center line */}
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0,
                width: 1, background: 'rgba(255,255,255,0.12)' }} />
              {/* Score bar */}
              <div style={barStyle} />
            </div>

            {/* Score */}
            <div style={{
              width: 38, textAlign: 'right', fontFamily: 'monospace',
              fontSize: 11, fontWeight: 700, flexShrink: 0, marginLeft: 6,
              color: col,
            }}>
              {score > 0 ? '+' : ''}{score.toFixed(1)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Movers Profile — asset JEDI as colored bars ───────────────────────────────
function MoversProfile({ assets }: { assets: Array<{ symbol: string; jedi_score: number }> }) {
  if (!assets.length) return null

  const sorted = [...assets]
    .filter(a => a.jedi_score !== undefined)
    .sort((a, b) => b.jedi_score - a.jedi_score)

  const top  = sorted.slice(0, 8)
  const bot  = sorted.slice(-5).reverse()
  const MAX  = Math.max(...sorted.map(a => Math.abs(a.jedi_score)), 1)

  const Row = ({ a }: { a: { symbol: string; jedi_score: number } }) => {
    const s   = a.jedi_score
    const pct = Math.min(100, (Math.abs(s) / MAX) * 100)
    const col = s > 12 ? '#4ade80' : s > 6 ? '#86efac' : s > 0 ? '#fbbf24'
              : s < -6 ? '#f43f5e' : '#f97316'

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        <span style={{ width: 60, fontSize: 10, fontFamily: 'monospace',
          color: col, fontWeight: 700, flexShrink: 0 }}>
          {a.symbol.replace('USDT', '')}
        </span>
        <div style={{ flex: 1, height: 14, background: 'rgba(255,255,255,0.04)',
          borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            width: `${pct}%`, height: '100%',
            background: col, borderRadius: 3, opacity: 0.8,
            transition: 'width 0.4s ease',
          }} />
        </div>
        <span style={{ width: 32, fontSize: 10, fontFamily: 'monospace',
          color: col, textAlign: 'right', flexShrink: 0 }}>
          {s > 0 ? '+' : ''}{s.toFixed(0)}
        </span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 9, color: '#4ade80', textTransform: 'uppercase',
          letterSpacing: 1, marginBottom: 6 }}>↑ SURGING</div>
        {top.map(a => <Row key={a.symbol} a={a} />)}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 9, color: '#f43f5e', textTransform: 'uppercase',
          letterSpacing: 1, marginBottom: 6 }}>↓ CRASHING</div>
        {bot.map(a => <Row key={a.symbol} a={a} />)}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const MCV_HISTORY_KEY = 'm3d.maxcogviz.last'
const MCV_PREV_KEY    = 'm3d.maxcogviz.prev'

export default function MaxCogViz() {
  const { data: council } = useCouncil()
  const { data: algoDay } = useAlgoDay()

  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<any[]>([])
  const [models, setModels] = useState<string[]>(['grok'])
  const [lastRun, setLastRun] = useState<string>('')
  const [profileView, setProfileView] = useState<'radar' | 'profile'>('radar')
  const [profileSort, setProfileSort] = useState<'fixed' | 'magnitude' | 'score'>('score')

  const jedi     = council?.jedi_score ?? 0
  const regime   = council?.regime ?? 'NEUTRAL'
  const longAlg  = council?.total_long ?? 0
  const shortAlg = council?.total_short ?? 0
  const algos    = council?.algos ?? []
  const assets   = algoDay?.assets ?? []

  const councilVotes = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of algos) m[a.id] = a.vote ?? 0
    return m
  }, [algos])

  // Load last result + previous result from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MCV_HISTORY_KEY)
      if (saved) setResult(JSON.parse(saved))
    } catch {}
  }, [])

  const [prevResult, setPrevResult] = useState<any>(null)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MCV_PREV_KEY)
      if (saved) setPrevResult(JSON.parse(saved))
    } catch {}
  }, [])

  // Fetch hourly history from server
  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch('/ds/v1/ai/maxcogviz/history/')
      const d = await r.json()
      if (d.ok) setHistory(d.history ?? [])
    } catch {}
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  const fire = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/ds/v1/ai/maxcogviz/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jedi, regime, long_algos: longAlg, short_algos: shortAlg,
          models,
          council_votes: councilVotes,
          assets_snapshot: assets.map((a: any) => ({ symbol: a.symbol, jedi_score: a.jedi_score ?? 0 })),
        }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error ?? 'MAXCOGVIZ query failed'); return }
      // Promote current → prev before overwriting
      try {
        const cur = localStorage.getItem(MCV_HISTORY_KEY)
        if (cur) { localStorage.setItem(MCV_PREV_KEY, cur); setPrevResult(JSON.parse(cur)) }
      } catch {}
      setResult(data)
      setLastRun(new Date().toISOString())
      try { localStorage.setItem(MCV_HISTORY_KEY, JSON.stringify(data)) } catch {}
      loadHistory()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [jedi, regime, longAlg, shortAlg, models, councilVotes, assets, loadHistory])

  const synth = result?.synthesised
  const dimScores: Record<string, number> = {}
  if (synth?.dimensions) {
    for (const [k, v] of Object.entries(synth.dimensions)) {
      dimScores[k] = (v as any).score ?? 0
    }
  }

  // Previous scores for spidy-sense wings.
  // Source 1: prevResult (localStorage — available from 2nd fire onward, instant)
  // Source 2: history fallback (server-side, oldest-first array)
  const prevScores = useMemo((): Record<string, number> | undefined => {
    // Prefer localStorage prev (set when current result was promoted)
    const prevSynth = prevResult?.synthesised
    if (prevSynth?.dimensions) {
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(prevSynth.dimensions))
        out[k] = (v as any).score ?? 0
      if (Object.keys(out).length > 0) return out
    }
    // Fallback: server history second-to-last entry
    if (history.length >= 2) {
      const entry = history[history.length - 2]
      const dims = entry?.dimensions
      if (dims && typeof dims === 'object') {
        const out: Record<string, number> = {}
        for (const [k, v] of Object.entries(dims)) out[k] = Number(v) || 0
        if (Object.keys(out).length > 0) return out
      }
    }
    return undefined
  }, [prevResult, history])

  const slope      = synth?.ground_slope ?? 'FLAT'
  const posture    = synth?.posture ?? 'NEUTRAL'
  const postureCol = POSTURE_COLOR[posture] ?? '#fbbf24'
  const composite  = synth?.alpha_composite ?? null

  const MODEL_OPTS = [
    { id: 'grok',   label: 'Grok-4.20 ★', color: '#FFB74D' },
    { id: 'claude', label: 'Claude',       color: '#a855f7' },
    { id: 'gemini', label: 'Gemini',       color: '#4ade80' },
  ]

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16, background: 'var(--bg-dark)', color: '#e2e8f0' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#FFB74D', fontFamily: 'monospace', letterSpacing: 2 }}>
            ◈ MAXCOGVIZ ALPHA
          </div>
          <div style={{ fontSize: 10, color: '#334155', letterSpacing: 1 }}>
            12-DIMENSIONAL MARKET INTELLIGENCE · GROUND SLOPE SYSTEM · MULTI-MODEL SYNTHESIS
          </div>
          {lastRun && (
            <div style={{ fontSize: 9, color: '#1e3a5f', marginTop: 2 }}>
              Last run: {lastRun.slice(0, 19).replace('T', ' ')} UTC ·{' '}
              {result?.models_responded?.join(' + ') ?? ''}
            </div>
          )}
        </div>

        {/* Live state */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {composite !== null && (
            <div style={{
              padding: '6px 14px', borderRadius: 6, fontFamily: 'monospace', fontWeight: 800, fontSize: 18,
              background: `${postureCol}15`, color: postureCol,
              border: `1px solid ${postureCol}44`,
            }}>
              {composite > 0 ? '+' : ''}{composite.toFixed(1)}
            </div>
          )}
          {synth && (
            <Tag style={{ background: `${postureCol}22`, color: postureCol, fontWeight: 700, fontSize: 11 }}>
              {posture}
            </Tag>
          )}
          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#FFB74D' }}>
            JEDI {jedi > 0 ? '+' : ''}{jedi} · {regime}
          </div>
        </div>
      </div>

      <Callout intent="primary" icon="chart" style={{ marginBottom: 16, background: '#0a1628', fontSize: 12 }}>
        <strong>MRT lab</strong> — signal ensemble snapshot, regime summary, and replay vs market (charts + trade markers).{' '}
        <Link to="/mrt" style={{ color: '#FFB74D', fontWeight: 600 }}>
          Open MRT monitor →
        </Link>
      </Callout>

      {/* Controls */}
      <Card elevation={Elevation.ONE} style={{ background: '#0a0f1a', padding: 12, marginBottom: 16,
        border: '1px solid rgba(255,183,77,0.15)' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Model selector */}
          <div>
            <div style={{ fontSize: 9, color: '#475569', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
              Models to query in parallel
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {MODEL_OPTS.map(m => (
                <button key={m.id}
                  onClick={() => setModels(prev =>
                    prev.includes(m.id) ? prev.filter(x => x !== m.id) : [...prev, m.id]
                  )}
                  style={{
                    padding: '4px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
                    fontSize: 10, fontWeight: 700,
                    background: models.includes(m.id) ? `${m.color}22` : '#1e293b',
                    color: models.includes(m.id) ? m.color : '#475569',
                    outline: models.includes(m.id) ? `1px solid ${m.color}44` : 'none',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={fire}
            loading={loading}
            style={{
              background: 'rgba(255,183,77,0.12)', color: '#FFB74D',
              border: '1px solid rgba(255,183,77,0.3)',
              fontFamily: 'monospace', fontWeight: 800, fontSize: 12, letterSpacing: 1,
              padding: '8px 20px',
            }}
          >
            ◈ FIRE MAXCOGVIZ ALPHA
          </Button>

          <div style={{ fontSize: 9, color: '#1e3a5f', marginLeft: 'auto' }}>
            Mega-structured JSON · 12 dimensions · {assets.length} assets context<br />
            Hourly cadence recommended · overnight batch available
          </div>
        </div>

        {error && <Callout intent="danger" style={{ marginTop: 8, fontSize: 11 }}>{error}</Callout>}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, color: '#475569' }}>
            <Spinner size={16} />
            <span style={{ fontSize: 11, fontFamily: 'monospace' }}>
              Querying {models.join(' + ')} in parallel · 12-dimensional deep analysis…
            </span>
          </div>
        )}
      </Card>

      {/* Main content */}
      {synth ? (
        <>
          {/* 2-col: radar + intel brief */}
          <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 16, marginBottom: 16 }}>

            {/* Radar / Profile panel */}
            <Card elevation={Elevation.ONE} style={{ background: '#040d18', padding: 12 }}>

              {/* View toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                {(['radar', 'profile'] as const).map(v => (
                  <button key={v} onClick={() => setProfileView(v)} style={{
                    padding: '2px 10px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
                    background: profileView === v ? 'rgba(255,183,77,0.15)' : 'transparent',
                    border: `1px solid ${profileView === v ? '#FFB74D' : 'rgba(255,255,255,0.08)'}`,
                    color: profileView === v ? '#FFB74D' : '#475569',
                  }}>
                    {v === 'radar' ? '◎ RADAR' : '▤ PROFILE'}
                  </button>
                ))}

                {profileView === 'profile' && (
                  <>
                    <span style={{ fontSize: 9, color: '#334155', marginLeft: 6 }}>sort:</span>
                    {(['score', 'magnitude', 'fixed'] as const).map(s => (
                      <button key={s} onClick={() => setProfileSort(s)} style={{
                        padding: '1px 7px', borderRadius: 3, fontSize: 9, cursor: 'pointer',
                        background: profileSort === s ? 'rgba(255,255,255,0.07)' : 'transparent',
                        border: `1px solid ${profileSort === s ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)'}`,
                        color: profileSort === s ? '#e2e8f0' : '#334155',
                      }}>{s}</button>
                    ))}
                  </>
                )}

                <span style={{ marginLeft: 'auto', fontSize: 9, color: '#1e3a5f' }}>
                  {result?.models_responded?.length > 1 ? 'synthesised' : result?.models_responded?.[0] ?? ''}
                </span>
              </div>

              {profileView === 'radar' ? (
                <>
                  <RadarPolygon scores={dimScores} prevScores={prevScores} />
                  <GroundSlope slope={slope} />
                </>
              ) : (
                <>
                  <DimensionProfile scores={dimScores} dims={DIMS} sortBy={profileSort} />
                  <GroundSlope slope={slope} />
                </>
              )}
            </Card>

            {/* Intel brief + trade ideas + outlook */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Intelligence brief */}
              <Card elevation={Elevation.ONE} style={{ background: '#0a0f1a', padding: 14 }}>
                <div style={{ fontSize: 10, color: '#FFB74D', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  ◈ Intelligence Brief
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.8, fontStyle: 'italic' }}>
                  "{synth.intelligence_brief}"
                </div>
                {synth.recommended_action && (
                  <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6,
                    background: `${postureCol}10`, border: `1px solid ${postureCol}33` }}>
                    <div style={{ fontSize: 9, color: postureCol, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
                      Recommended Action
                    </div>
                    <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600 }}>{synth.recommended_action}</div>
                  </div>
                )}
                {synth.m3d_alignment && (
                  <div style={{ marginTop: 8, fontSize: 10, color: '#475569' }}>
                    M3D JEDI alignment:{' '}
                    <span style={{ color: synth.m3d_alignment === 'CONFIRMED' ? '#4ade80' : synth.m3d_alignment === 'DIVERGENT' ? '#f87171' : '#fbbf24', fontWeight: 700 }}>
                      {synth.m3d_alignment}
                    </span>
                    {synth.alignment_note && ` — ${synth.alignment_note}`}
                  </div>
                )}
              </Card>

              {/* Trade ideas */}
              {synth.trade_ideas?.length > 0 && (
                <Card elevation={Elevation.ONE} style={{ background: '#0a0f1a', padding: 12 }}>
                  <div style={{ fontSize: 10, color: '#4ade80', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                    ◈ AI Trade Ideas
                  </div>
                  {synth.trade_ideas.map((t: any, i: number) => {
                    const col = t.direction === 'LONG' ? '#4ade80' : '#f87171'
                    return (
                      <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center',
                        padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 800, color: col, width: 50, fontSize: 12 }}>
                          {t.asset}
                        </span>
                        <Tag minimal style={{ background: `${col}22`, color: col, fontSize: 9 }}>{t.direction}</Tag>
                        <div style={{ flex: 1, fontSize: 10, color: '#64748b' }}>{t.entry_condition}</div>
                        <div style={{ textAlign: 'right', fontSize: 10 }}>
                          <div style={{ color: '#4ade80' }}>+{t.target_pct?.toFixed(1)}%</div>
                          <div style={{ color: '#f87171' }}>-{t.stop_pct?.toFixed(1)}%</div>
                        </div>
                        <div style={{ width: 32, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: t.conviction > 70 ? '#4ade80' : '#fbbf24' }}>
                            {t.conviction}%
                          </div>
                          <div style={{ fontSize: 8, color: '#334155' }}>{t.timeframe}</div>
                        </div>
                      </div>
                    )
                  })}
                </Card>
              )}

              {/* Outlook */}
              {synth.outlook && (
                <Card elevation={Elevation.ONE} style={{ background: '#0a0f1a', padding: 12 }}>
                  <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                    ◈ Multi-Horizon Outlook
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                    {['30d', '90d', '180d'].map(h => {
                      const o = synth.outlook[h]
                      if (!o) return null
                      const col = o.bias === 'BULL' ? '#4ade80' : o.bias === 'BEAR' ? '#f87171' : '#fbbf24'
                      return (
                        <div key={h} style={{ textAlign: 'center', padding: '8px', background: '#0f172a', borderRadius: 6 }}>
                          <div style={{ fontSize: 9, color: '#334155', marginBottom: 3 }}>{h}</div>
                          <div style={{ fontSize: 14, fontWeight: 800, color: col }}>{o.bias}</div>
                          <div style={{ fontSize: 8, color: '#475569', marginTop: 3 }}>{o.key_catalyst}</div>
                          <div style={{ fontSize: 9, color: col, marginTop: 2 }}>{o.probability}%</div>
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )}
            </div>
          </div>

          {/* 12 Dimension grid */}
          <div style={{ fontSize: 10, color: '#334155', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            12 Alpha Dimensions — granular breakdown
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8, marginBottom: 16 }}>
            {DIMS.map(d => (
              <DimCard key={d.id} dim={d} data={synth.dimensions?.[d.id]} />
            ))}
          </div>

          {/* Movers Profile — asset JEDI bars */}
          {assets.length > 0 && (
            <Card elevation={Elevation.ONE} style={{ background: '#0a0f1a', padding: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: '#FFB74D', textTransform: 'uppercase',
                letterSpacing: 1, marginBottom: 10 }}>
                ▤ MOVERS PROFILE — live JEDI by asset
              </div>
              <MoversProfile assets={assets.map((a: any) => ({ symbol: a.symbol, jedi_score: a.jedi_score ?? 0 }))} />
            </Card>
          )}

          {/* Multi-model comparison */}
          {result?.models_responded?.length > 1 && (
            <Card elevation={Elevation.ONE} style={{ background: '#0a0f1a', padding: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: '#a855f7', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                Multi-Model Composite Scores
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {Object.entries(result.model_results ?? {}).map(([m, r]: [string, any]) => {
                  const col = m === 'grok' ? '#FFB74D' : m === 'claude' ? '#a855f7' : '#4ade80'
                  return (
                    <div key={m} style={{ textAlign: 'center', padding: '8px 14px',
                      background: `${col}10`, borderRadius: 6, border: `1px solid ${col}33` }}>
                      <div style={{ fontSize: 9, color: col, textTransform: 'uppercase', letterSpacing: 1 }}>{m}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: col, fontFamily: 'monospace' }}>
                        {(r?.alpha_composite ?? 0) > 0 ? '+' : ''}{(r?.alpha_composite ?? 0).toFixed(1)}
                      </div>
                      <div style={{ fontSize: 9, color: '#334155' }}>{r?.posture}</div>
                    </div>
                  )
                })}
                <div style={{ textAlign: 'center', padding: '8px 14px',
                  background: 'rgba(255,183,77,0.1)', borderRadius: 6, border: '1px solid rgba(255,183,77,0.3)' }}>
                  <div style={{ fontSize: 9, color: '#FFB74D', textTransform: 'uppercase', letterSpacing: 1 }}>SYNTHESISED</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#FFB74D', fontFamily: 'monospace' }}>
                    {composite! > 0 ? '+' : ''}{composite!.toFixed(1)}
                  </div>
                  <div style={{ fontSize: 9, color: '#475569' }}>{result.model_results ? `avg of ${result.models_responded.length}` : ''}</div>
                </div>
              </div>
            </Card>
          )}

          {/* History */}
          {history.length > 1 && (
            <Card elevation={Elevation.ONE} style={{ background: '#0a0f1a', padding: 12 }}>
              <HistoryLine history={history} />
            </Card>
          )}
        </>
      ) : !loading && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#1e3a5f' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>◈</div>
          <div style={{ fontSize: 14, fontFamily: 'monospace', color: '#334155', marginBottom: 8 }}>
            MAXCOGVIZ ALPHA STANDING BY
          </div>
          <div style={{ fontSize: 11, color: '#1e3a5f', maxWidth: 500, margin: '0 auto', lineHeight: 1.7 }}>
            12 dimensions · macro slope · money flow · geopolitical · pandemic · energy ·
            central bank · crypto native · sentiment wave · velocity · black swan ·
            tech disruption · alpha signal
          </div>
          <div style={{ fontSize: 10, color: '#0f1e2e', marginTop: 12 }}>
            Select models → Fire → Radar polygon renders
          </div>
        </div>
      )}
    </div>
  )
}
