/**
 * HEDGE — Hedge fund perspective page.
 * Long/Short construction, defense lasers (danger detection),
 * regime-based allocation, JEDI as the ORB, hedge components,
 * HALO Jump stealth execution, SEAL TEAM 6 AI-supervised protection.
 */
import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { Card, Elevation, Tag, Intent, ProgressBar, Button, HTMLSelect } from '@blueprintjs/core'
import { useCouncil, useAlgoDay } from '../api/client'

// ── Types ──────────────────────────────────────────────────────────────────────
interface PulseTrigger {
  trigger_id: string
  ts: string
  trigger_class: string
  urgency: 'NOW' | '5MIN' | '1HR' | 'EOD' | 'NEXT_SESSION'
  direction: 'LONG' | 'SHORT' | 'HEDGE' | 'HOLD' | 'EXIT' | 'REDUCE'
  ticker: string | null
  sector: string | null
  catalyst_type: string | null
  confidence: number
  source_confidence: number
  gaming_detected: boolean
  gaming_flags: string[]
  entry_window_min: number | null
  target_pct: number | null
  stop_pct: number | null
  source: string
  raw_headline: string
  halo_auto: boolean
}

// ── PulseFeed — live Grok trigger stream ──────────────────────────────────────
const URGENCY_COLOR: Record<string, string> = {
  NOW:          '#ff1744',
  '5MIN':       '#FFB74D',
  '1HR':        '#fbbf24',
  EOD:          '#64748b',
  NEXT_SESSION: '#475569',
}
const DIR_COLOR: Record<string, string> = {
  LONG: '#4ade80', SHORT: '#f43f5e', HEDGE: '#a78bfa',
  HOLD: '#64748b', EXIT: '#f97316', REDUCE: '#fb923c',
}

function PulseTriggerRow({ t }: { t: PulseTrigger }) {
  const [expanded, setExpanded] = useState(false)
  const age = Math.round((Date.now() - new Date(t.ts).getTime()) / 1000)
  const ageStr = age < 60 ? `${age}s ago` : `${Math.floor(age / 60)}m ago`

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        padding: '7px 10px',
        borderRadius: 6,
        background: t.urgency === 'NOW'
          ? 'rgba(255,23,68,0.08)'
          : t.urgency === '5MIN'
            ? 'rgba(255,183,77,0.06)'
            : 'rgba(255,255,255,0.03)',
        border: `1px solid ${t.urgency === 'NOW'
          ? 'rgba(255,23,68,0.35)'
          : t.urgency === '5MIN'
            ? 'rgba(255,183,77,0.25)'
            : 'rgba(255,255,255,0.07)'}`,
        cursor: 'pointer',
        animation: t.urgency === 'NOW' ? 'alarm-border 1.2s ease-in-out infinite' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {/* Urgency badge */}
        <span style={{
          fontSize: 9, fontWeight: 800, padding: '2px 5px', borderRadius: 3,
          background: URGENCY_COLOR[t.urgency] + '33',
          color: URGENCY_COLOR[t.urgency],
          letterSpacing: 1,
        }}>{t.urgency}</span>

        {/* Direction */}
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
          background: DIR_COLOR[t.direction] + '22',
          color: DIR_COLOR[t.direction],
        }}>{t.direction}</span>

        {/* Ticker */}
        {t.ticker && (
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#FFB74D', fontWeight: 700 }}>
            {t.ticker}
          </span>
        )}

        {/* Headline */}
        <span style={{
          fontSize: 11, color: '#e2e8f0', flex: 1,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          minWidth: 0,
        }}>
          {t.raw_headline}
        </span>

        {/* Confidence */}
        <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, fontFamily: 'monospace' }}>
          {t.confidence}% · {ageStr}
        </span>

        {/* HALO badge */}
        {t.halo_auto && (
          <span style={{
            fontSize: 9, padding: '1px 5px', borderRadius: 3,
            background: 'rgba(0,255,180,0.12)', color: '#00ffb4',
            border: '1px solid rgba(0,255,180,0.3)', fontWeight: 700,
          }}>HALO</span>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.07)', fontSize: 10, color: 'var(--text-muted)' }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>Class: <b style={{ color: '#e2e8f0' }}>{t.trigger_class}</b></span>
            {t.catalyst_type && <span>Catalyst: <b style={{ color: '#e2e8f0' }}>{t.catalyst_type}</b></span>}
            {t.sector && <span>Sector: <b style={{ color: '#e2e8f0' }}>{t.sector}</b></span>}
            <span>Src conf: <b style={{ color: t.source_confidence >= 80 ? '#4ade80' : '#f97316' }}>{t.source_confidence}%</b></span>
            {t.entry_window_min && <span>Window: <b style={{ color: '#e2e8f0' }}>{t.entry_window_min}min</b></span>}
            {t.target_pct && <span>Target: <b style={{ color: '#4ade80' }}>+{t.target_pct}%</b></span>}
            {t.stop_pct && <span>Stop: <b style={{ color: '#f43f5e' }}>-{t.stop_pct}%</b></span>}
            <span>Source: <b style={{ color: '#e2e8f0' }}>{t.source}</b></span>
          </div>
        </div>
      )}
    </div>
  )
}

function PulseFeed() {
  const [triggers, setTriggers]       = useState<PulseTrigger[]>([])
  const [stale, setStale]             = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [firing, setFiring]           = useState(false)
  const [filter, setFilter]           = useState<'ALL' | 'NOW' | '5MIN' | 'HALO'>('ALL')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchPulse = useCallback(async () => {
    try {
      const res = await fetch('/ds/v1/ai/pulse/?limit=30')
      if (!res.ok) return
      const data = await res.json()
      setTriggers(data.triggers ?? [])
      setStale(data.stale ?? false)
      setLastUpdated(data.last_updated)
    } catch { /* daemon not running yet */ }
  }, [])

  useEffect(() => {
    fetchPulse()
    timerRef.current = setInterval(fetchPulse, 30_000)   // re-poll every 30s
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [fetchPulse])

  const fireNow = async () => {
    setFiring(true)
    try {
      const res = await fetch('/ds/v1/ai/pulse/run/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json()
      if (data.triggers) setTriggers(prev => [...data.triggers, ...prev].slice(0, 50))
      setLastUpdated(new Date().toISOString())
      setStale(false)
    } catch { /* ignore */ } finally {
      setFiring(false)
    }
  }

  const visible = triggers.filter(t => {
    if (filter === 'NOW')  return t.urgency === 'NOW'
    if (filter === '5MIN') return t.urgency === 'NOW' || t.urgency === '5MIN'
    if (filter === 'HALO') return t.halo_auto
    return true
  })

  const nowCount  = triggers.filter(t => t.urgency === 'NOW').length
  const haloCount = triggers.filter(t => t.halo_auto).length

  const ageStr = lastUpdated
    ? Math.round((Date.now() - new Date(lastUpdated).getTime()) / 1000) + 's ago'
    : 'never'

  return (
    <Card elevation={Elevation.ONE} style={{
      padding: 14, marginBottom: 16,
      border: nowCount > 0 ? '1px solid rgba(255,23,68,0.4)' : '1px solid var(--border-color)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#f43f5e', letterSpacing: 1 }}>
          ⚡ PULSE
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          Grok live search · 3-min scan · gaming-filtered
        </span>

        {/* Staleness indicator */}
        <span style={{
          fontSize: 9, padding: '2px 6px', borderRadius: 3,
          background: stale ? 'rgba(249,115,22,0.15)' : 'rgba(74,222,128,0.1)',
          color: stale ? '#f97316' : '#4ade80',
          border: `1px solid ${stale ? 'rgba(249,115,22,0.3)' : 'rgba(74,222,128,0.2)'}`,
        }}>
          {stale ? `⚠ STALE ${ageStr}` : `● LIVE ${ageStr}`}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          {/* Filter tabs */}
          {(['ALL', 'NOW', '5MIN', 'HALO'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '2px 8px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
              background: filter === f ? 'rgba(255,183,77,0.15)' : 'transparent',
              border: `1px solid ${filter === f ? '#FFB74D' : 'rgba(255,255,255,0.1)'}`,
              color: filter === f ? '#FFB74D' : 'var(--text-muted)',
            }}>
              {f}{f === 'NOW' && nowCount > 0 ? ` (${nowCount})` : ''}
              {f === 'HALO' && haloCount > 0 ? ` (${haloCount})` : ''}
            </button>
          ))}

          <Button
            small minimal icon="refresh"
            loading={firing}
            onClick={fireNow}
            style={{ marginLeft: 4 }}
            title="Fire manual pulse scan now"
          />
        </div>
      </div>

      {/* Trigger list */}
      {visible.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
          {lastUpdated
            ? 'No triggers in current filter — market quiet or daemon scanning'
            : 'Pulse daemon not started. Run: python ds/grok_pulse.py  OR  press ↺ for on-demand scan'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {visible.map(t => <PulseTriggerRow key={t.trigger_id} t={t} />)}
        </div>
      )}
    </Card>
  )
}

// ── Seeded LCG random (deterministic per seed, looks organic) ─────────────────
function makePrng(seed: number) {
  let s = seed | 0
  return () => {
    s = Math.imul(1664525, s) + 1013904223 | 0
    return (s >>> 0) / 0xffffffff
  }
}

// ── HALO Jump — Stealth execution cloaking ───────────────────────────────────
interface HaloOrder {
  seq: number
  delayMin: number    // minutes from T0
  sizePct: number     // % of total position
  type: 'LIMIT' | 'MARKET'
  offset: number      // price offset % (negative = below market for buy)
  note: string
}

function generateHaloPlan(side: 'LONG' | 'SHORT', slices: number, windowMin: number, seed: number): HaloOrder[] {
  const rng = makePrng(seed)
  const orders: HaloOrder[] = []

  // Base size per slice with jitter
  const basePct = 100 / slices
  let remaining = 100
  let t = 0

  for (let i = 0; i < slices; i++) {
    const isLast = i === slices - 1
    // Jitter size ±22%
    const jitter = isLast ? remaining : Math.round(basePct * (0.78 + rng() * 0.44))
    const size = isLast ? remaining : Math.min(jitter, remaining - (slices - i - 1) * 3)
    remaining -= size

    // Time gap: random 1-12 minutes, weighted toward 2-6
    const gap = isLast ? 0 : Math.round(1 + rng() * rng() * 11 + 1)
    t += gap

    // Order type: 70% limit, 30% market; first and last always limit for stealth
    const isMarket = i > 0 && i < slices - 1 && rng() < 0.28
    const type: 'LIMIT' | 'MARKET' = isMarket ? 'MARKET' : 'LIMIT'

    // Price offset for limits (buy below, sell above — don't look desperate)
    const offBase = type === 'LIMIT' ? (0.04 + rng() * 0.18) : 0
    const offset = side === 'LONG' ? -offBase : offBase

    // Human-looking notes
    const notes = [
      'blend with tape', 'passive fill', 'iceberg slice', 'follow flow',
      'anti-spike', 'volume-weighted', 'quiet fill', 'stealth add',
    ]
    const note = notes[Math.floor(rng() * notes.length)]

    orders.push({ seq: i + 1, delayMin: t, sizePct: size, type, offset: parseFloat(offset.toFixed(3)), note })
  }

  return orders
}

function HaloJump({ jedi }: { jedi: number }) {
  const [side, setSide] = useState<'LONG' | 'SHORT'>(jedi >= 0 ? 'LONG' : 'SHORT')
  const [slices, setSlices] = useState(8)
  const [windowMin, setWindowMin] = useState(60)
  const [plan, setPlan] = useState<HaloOrder[]>([])
  const [cloakActive, setCloakActive] = useState(false)

  const generate = useCallback(() => {
    const p = generateHaloPlan(side, slices, windowMin, Date.now())
    setPlan(p)
    setCloakActive(false)
  }, [side, slices, windowMin])

  const totalT = plan.length > 0 ? plan[plan.length - 1].delayMin : 0

  return (
    <Card elevation={Elevation.TWO} style={{
      background: '#030d08',
      border: '1px solid rgba(0,255,140,0.2)',
      padding: 16, marginBottom: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#00ff8c', letterSpacing: 2, fontFamily: 'monospace' }}>
            ◈ HALO JUMP — STEALTH EXECUTION
          </div>
          <div style={{ fontSize: 10, color: '#334155', marginTop: 2 }}>
            Mask market entry · Appear human · Zero footprint · No attention
          </div>
        </div>
        {plan.length > 0 && (
          <div
            className={cloakActive ? 'cloak-active' : ''}
            style={{
              padding: '4px 12px', borderRadius: 4, fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
              background: cloakActive ? 'rgba(0,255,140,0.15)' : 'rgba(51,65,85,0.5)',
              color: cloakActive ? '#00ff8c' : '#475569',
              border: `1px solid ${cloakActive ? 'rgba(0,255,140,0.4)' : 'rgba(71,85,105,0.4)'}`,
            }}
          >
            {cloakActive ? '◉ CLOAK ACTIVE' : '○ STANDBY'}
          </div>
        )}
      </div>

      {/* Config row */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 9, color: '#475569', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Direction</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['LONG', 'SHORT'] as const).map(s => (
              <button key={s} onClick={() => setSide(s)} style={{
                padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                background: side === s ? (s === 'LONG' ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)') : '#1e293b',
                color: side === s ? (s === 'LONG' ? '#4ade80' : '#f87171') : '#64748b',
              }}>{s}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: '#475569', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
            Slices ({slices})
          </div>
          <input type="range" min={4} max={15} value={slices} onChange={e => setSlices(Number(e.target.value))}
            style={{ width: 100, accentColor: '#00ff8c' }} />
        </div>
        <div>
          <div style={{ fontSize: 9, color: '#475569', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
            Window
          </div>
          <HTMLSelect
            value={String(windowMin)}
            onChange={e => setWindowMin(Number(e.target.value))}
            style={{ fontSize: 11, background: '#1e293b', color: '#94a3b8', border: '1px solid #334155' }}
          >
            {[30, 60, 120, 240, 480].map(w => (
              <option key={w} value={String(w)}>{w >= 60 ? `${w / 60}h` : `${w}m`}</option>
            ))}
          </HTMLSelect>
        </div>
        <Button onClick={generate} style={{
          background: 'rgba(0,255,140,0.1)', color: '#00ff8c',
          border: '1px solid rgba(0,255,140,0.3)', fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
        }}>
          ◈ GENERATE INSERTION PLAN
        </Button>
        {plan.length > 0 && (
          <Button onClick={() => setCloakActive(a => !a)} style={{
            background: cloakActive ? 'rgba(0,255,140,0.2)' : 'rgba(51,65,85,0.3)',
            color: cloakActive ? '#00ff8c' : '#64748b',
            border: '1px solid rgba(0,255,140,0.2)', fontSize: 11,
          }}>
            {cloakActive ? '◉ DEACTIVATE' : '◎ ACTIVATE CLOAK'}
          </Button>
        )}
      </div>

      {/* HALO scan bar when active */}
      {cloakActive && <div className="halo-scan-bar" style={{ marginBottom: 12 }} />}

      {/* Execution plan table */}
      {plan.length > 0 && (
        <>
          <div style={{ fontSize: 9, color: '#1a4a2e', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
            Insertion sequence — {slices} orders over ~{totalT}m · looks organic
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(0,255,140,0.1)' }}>
                  {['#', 'T+min', 'Size', 'Type', 'Offset', 'Note'].map(h => (
                    <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: '#1a5c38', fontWeight: 600, fontSize: 9 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.map(o => (
                  <tr key={o.seq} style={{ borderBottom: '1px solid rgba(0,255,140,0.05)', opacity: cloakActive ? 1 : 0.85 }}>
                    <td style={{ padding: '3px 8px', color: '#1a5c38' }}>{o.seq}</td>
                    <td style={{ padding: '3px 8px', color: '#00ff8c' }}>T+{o.delayMin}m</td>
                    <td style={{ padding: '3px 8px', color: side === 'LONG' ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                      {o.sizePct}%
                    </td>
                    <td style={{ padding: '3px 8px', color: o.type === 'MARKET' ? '#fbbf24' : '#94a3b8' }}>{o.type}</td>
                    <td style={{ padding: '3px 8px', color: '#475569' }}>
                      {o.type === 'LIMIT' ? (o.offset > 0 ? '+' : '') + o.offset.toFixed(2) + '%' : '—'}
                    </td>
                    <td style={{ padding: '3px 8px', color: '#1a4a2e', fontSize: 9 }}>{o.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 8, fontSize: 9, color: '#0d2b18', fontStyle: 'italic' }}>
            ◈ {slices} slices · {plan.filter(o => o.type === 'LIMIT').length} LIMIT + {plan.filter(o => o.type === 'MARKET').length} MARKET
            · randomised gaps · size jitter ±22% · profile: human trader
          </div>
        </>
      )}

      {plan.length === 0 && (
        <div style={{ textAlign: 'center', padding: '20px 0', color: '#0d3a1e', fontSize: 11 }}>
          Configure insertion parameters and generate plan.<br />
          <span style={{ fontSize: 9 }}>Orders split, timed, and sized to mask algorithmic origin.</span>
        </div>
      )}
    </Card>
  )
}

// ── SEAL TEAM 6 — AI-supervised macro protection ──────────────────────────────
const SEAL_THREATS = [
  {
    id: 'doldrums',
    icon: '😴',
    label: 'LOW ATR DOLDRUMS',
    trigger: 'ATR < 0.8% · BB squeeze · Volume −40% vs 20d avg',
    color: '#64748b',
    threat: 'low',
    playbook: [
      'Reduce position size 50% — no edge in low-vol',
      'Tighten stops to 1×ATR (normal: 2×)',
      'Watch for squeeze BREAKOUT — huge move incoming',
      'Do NOT add — wait for volatility expansion',
    ],
    aiWatch: 'qwen2.5 / EMA ribbon compression signal',
  },
  {
    id: 'fomc',
    icon: '🏦',
    label: 'FED CHAIRMAN EVENT',
    trigger: 'FOMC meeting · Powell speech · CPI/PCE print day',
    color: '#f97316',
    threat: 'high',
    playbook: [
      'Flatten all positions 2h before event — no exceptions',
      'Re-enter only after 30min post-event confirmation',
      'JEDI must re-confirm ≥ +5 before resuming longs',
      'Options IV spike: sell premium, not direction',
    ],
    aiWatch: 'Grok (YODA) sentiment scan 1h before event',
  },
  {
    id: 'trump',
    icon: '📢',
    label: 'POLITICAL BLACK SWAN',
    trigger: 'Tweet / TruthSocial · Tariff announcement · Trade war escalation',
    color: '#f43f5e',
    threat: 'extreme',
    playbook: [
      'INSTANT stop trigger: 2×ATR hard stop, no manual override',
      'Sentiment can move 10-30% in minutes — gap risk is REAL',
      'Grok YODA on high alert — monitor sentiment every 5m',
      'Hedge with inverse ETF or options if >10% of book exposed',
    ],
    aiWatch: 'YODA (Grok-3) real-time xAI news sentiment — 35% weight active',
  },
  {
    id: 'exchange',
    icon: '⛓',
    label: 'EXCHANGE / LIQUIDITY RISK',
    trigger: 'Volume cliff · Exchange outage · Liquidation cascade',
    color: '#a855f7',
    threat: 'high',
    playbook: [
      'Split across ≥2 exchanges — never 100% on one venue',
      'Keep 20% of position liquid (market-sellable within 30s)',
      'Watch funding rate: if >0.1%/8h, reduce leverage',
      'HALO cloak re-activates on next entry — avoid cascade signal',
    ],
    aiWatch: 'qwen2.5-coder funding + OI anomaly detection',
  },
  {
    id: 'regime',
    icon: '🌀',
    label: 'REGIME FLIP',
    trigger: 'Council JEDI crosses 0 · Bank A + Bank B both flip short',
    color: '#22d3ee',
    threat: 'medium',
    playbook: [
      'Reduce by 50% on first JEDI zero-cross',
      'Full exit if Bank A + B both negative for 2 sessions',
      'Short book activates: top 3 weakest assets by JEDI',
      'LEGEND algos may diverge — keep swing book separate',
    ],
    aiWatch: 'Council vote trend — JEDI EMA(10) direction',
  },
  {
    id: 'drawdown',
    icon: '📉',
    label: 'DRAWDOWN CIRCUIT BREAKER',
    trigger: 'Portfolio −8% peak-to-trough · MaxDD > 15% · 3 losing sessions',
    color: '#ff1744',
    threat: 'extreme',
    playbook: [
      '−8%: mandatory size cut to 25% — no debate',
      '−15%: full stop. Cash + review. SEALS protocol.',
      'Do NOT average down on quant signals — the model may be wrong',
      '48h cool-off before re-entry after −15% breaker',
    ],
    aiWatch: 'JEDI + Grok dual-confirm required for re-entry after breaker',
  },
]

const THREAT_COLOR: Record<string, string> = {
  low: '#64748b', medium: '#fbbf24', high: '#f97316', extreme: '#ff1744',
}

function SealTeam6({ jedi, regime }: { jedi: number; regime: string }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  // Auto-highlight most relevant threat
  const activeThreats = useMemo(() => {
    const active: string[] = []
    if (jedi < -8 || regime === 'BEAR') active.push('drawdown', 'regime')
    if (Math.abs(jedi) < 3) active.push('doldrums')
    return active
  }, [jedi, regime])

  return (
    <Card elevation={Elevation.TWO} style={{
      background: '#0a0514',
      border: '1px solid rgba(168,85,247,0.2)',
      padding: 16, marginBottom: 16,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#a855f7', letterSpacing: 2, fontFamily: 'monospace', marginBottom: 4 }}>
        ⊕ SEAL TEAM 6 — AI OVERSIGHT PROTECTION
      </div>
      <div style={{ fontSize: 10, color: '#334155', marginBottom: 12 }}>
        All-weather protection · Low ATR → Fed → Trump → Drawdown · AI-supervised
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
        {SEAL_THREATS.map(t => {
          const isActive = activeThreats.includes(t.id)
          const isOpen = expanded === t.id
          return (
            <div
              key={t.id}
              onClick={() => setExpanded(isOpen ? null : t.id)}
              style={{
                borderRadius: 8, padding: 12, cursor: 'pointer',
                background: isActive ? `${t.color}0f` : '#0f172a',
                border: `1px solid ${isActive ? t.color + '55' : 'rgba(255,255,255,0.06)'}`,
                animation: isActive && t.threat === 'extreme' ? 'alarm-border 1.2s ease-in-out infinite' : undefined,
                transition: 'all 0.2s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isOpen ? 8 : 0 }}>
                <span style={{ fontSize: 16 }}>{t.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: t.color, letterSpacing: 0.5 }}>{t.label}</div>
                  <div style={{ fontSize: 9, color: '#334155' }}>{t.trigger}</div>
                </div>
                <div style={{
                  fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                  background: THREAT_COLOR[t.threat] + '22', color: THREAT_COLOR[t.threat],
                  textTransform: 'uppercase', letterSpacing: 1,
                }}>
                  {t.threat}
                </div>
                {isActive && (
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, flexShrink: 0,
                    boxShadow: `0 0 6px ${t.color}` }} />
                )}
              </div>

              {isOpen && (
                <>
                  <ul style={{ margin: '8px 0 8px 0', padding: '0 0 0 16px', listStyle: 'disc' }}>
                    {t.playbook.map((rule, i) => (
                      <li key={i} style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{rule}</li>
                    ))}
                  </ul>
                  <div style={{ fontSize: 9, color: '#475569', padding: '4px 8px', background: '#0f172a', borderRadius: 4 }}>
                    🤖 AI Watch: {t.aiWatch}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 10, fontSize: 9, color: '#1e1030', fontFamily: 'monospace' }}>
        SEAL TEAM 6 · AI-supervised · click any threat to expand playbook
        · auto-highlights active threats from live JEDI + regime data
      </div>
    </Card>
  )
}

// ── Rate limiter (2 req/min = 30s cooldown) ───────────────────────────────────
const RATE_LIMIT_MS = 31_000  // 31s between Grok calls (2/min with buffer)
const YODA_LAST_KEY = 'm3d.yoda.lastcall'

function canCallYoda(): boolean {
  try {
    const last = Number(localStorage.getItem(YODA_LAST_KEY) ?? 0)
    return Date.now() - last >= RATE_LIMIT_MS
  } catch { return true }
}
function markYodaCall() {
  try { localStorage.setItem(YODA_LAST_KEY, String(Date.now())) } catch {}
}
function yodaCooldownMs(): number {
  try {
    const last = Number(localStorage.getItem(YODA_LAST_KEY) ?? 0)
    return Math.max(0, RATE_LIMIT_MS - (Date.now() - last))
  } catch { return 0 }
}

// ── WIZZO Cockpit — 4 strategic Grok queries ──────────────────────────────────
const MISSIONS = [
  {
    id: 'q1',
    label: 'Q1 · THREAT MATRIX',
    icon: '🏔',
    sub: 'Enemy on Hills · Enemy in Camp · Known Unknowns',
    color: '#f43f5e',
  },
  {
    id: 'q2',
    label: 'Q2 · FAKE NEWS PUNISHER',
    icon: '📢',
    sub: 'Noise filter · Narrative authenticity · Signal vs pump',
    color: '#fbbf24',
  },
  {
    id: 'q3',
    label: 'Q3 · SURGERS & RUMBLINGS',
    icon: '🚀',
    sub: 'Breakout now · Steady risers · Early accumulation',
    color: '#4ade80',
  },
  {
    id: 'q4',
    label: 'Q4 · TRADING CONDITIONS',
    icon: '⚙',
    sub: 'Iter-opt signal · Bank fit · Optimal timeframe',
    color: '#22d3ee',
  },
]

interface YodaResult {
  q: string; answer: string; ts: string; ok: boolean; error?: string
}

// ── Chart Vision strip (reads Trader screenshot from sessionStorage) ──────────
function ChartVisionStrip({ canFire, loading, onResult, onFire, onDone, jedi, regime, model }: {
  canFire: boolean; loading: boolean; jedi: number; regime: string; model: string
  onResult: (r: YodaResult) => void; onFire: () => void; onDone: () => void
}) {
  const [snapshot, setSnapshot] = useState<{ symbol: string; tf: string; ts: number } | null>(null)

  // Poll sessionStorage for chart snapshot (set by LiveChart 👁 button)
  useEffect(() => {
    const check = () => {
      try {
        const raw = sessionStorage.getItem('m3d.chart.snapshot')
        if (!raw) { setSnapshot(null); return }
        const s = JSON.parse(raw)
        if (Date.now() - s.ts < 300_000) setSnapshot(s) // expire after 5min
        else { sessionStorage.removeItem('m3d.chart.snapshot'); setSnapshot(null) }
      } catch { setSnapshot(null) }
    }
    check()
    const id = setInterval(check, 1000)
    return () => clearInterval(id)
  }, [])

  const fireVision = async () => {
    if (!canFire || loading || !snapshot) return
    const raw = sessionStorage.getItem('m3d.chart.snapshot')
    if (!raw) return
    const { b64, symbol, tf } = JSON.parse(raw)
    onFire()
    try {
      const res = await fetch('/ds/v1/ai/vision/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_b64: b64, symbol, tf, jedi, regime, model }),
      })
      const data = await res.json()
      onResult({ q: 'vision', answer: data.analysis ?? '', ts: data.timestamp ?? new Date().toISOString(), ok: data.ok, error: data.error })
    } catch (e) {
      onResult({ q: 'vision', answer: '', ts: new Date().toISOString(), ok: false, error: (e as Error).message })
    } finally {
      onDone()
    }
  }

  return (
    <div style={{
      padding: '8px 16px',
      background: snapshot ? 'rgba(168,85,247,0.05)' : 'transparent',
      borderTop: '1px solid rgba(168,85,247,0.1)',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span style={{ fontSize: 16 }}>👁</span>
      {snapshot ? (
        <>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: '#a855f7', fontFamily: 'monospace', fontWeight: 700 }}>
              CHART READY: {snapshot.symbol} · {snapshot.tf}
            </div>
            <div style={{ fontSize: 9, color: '#334155' }}>
              Captured {Math.round((Date.now() - snapshot.ts) / 1000)}s ago · Press to send to YODA vision
            </div>
          </div>
          <Button
            disabled={!canFire || loading}
            onClick={fireVision}
            style={{
              background: 'rgba(168,85,247,0.15)', color: '#a855f7',
              border: '1px solid rgba(168,85,247,0.3)', fontSize: 10,
              fontFamily: 'monospace', fontWeight: 700,
            }}
          >
            ◈ ANALYSE CHART
          </Button>
          <button
            onClick={() => { sessionStorage.removeItem('m3d.chart.snapshot'); setSnapshot(null) }}
            style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', fontSize: 12 }}
          >✕</button>
        </>
      ) : (
        <div style={{ fontSize: 10, color: '#1e3a5f' }}>
          Go to Trader tab → press <span style={{ color: '#a855f7' }}>👁</span> on chart → return here to analyse with YODA vision
        </div>
      )}
    </div>
  )
}

function WizzoCockpit({ jedi, regime, longAlgos, shortAlgos, focusAsset, surgeAssets, risingAssets, allAssets, councilVotes }: {
  jedi: number; regime: string; longAlgos: number; shortAlgos: number
  focusAsset: string; surgeAssets: string[]; risingAssets: string[]
  allAssets: any[]; councilVotes: Record<string, number>
}) {
  const [result, setResult] = useState<YodaResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeQ, setActiveQ] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [model, setModel] = useState('grok-4.20-reasoning')
  const [fullCtx, setFullCtx] = useState(true)  // full 130+ asset context toggle

  // Countdown ticker
  useEffect(() => {
    const id = setInterval(() => setCooldown(yodaCooldownMs()), 500)
    return () => clearInterval(id)
  }, [])

  const fireQuery = useCallback(async (q: string) => {
    if (!canCallYoda()) return
    markYodaCall()
    setCooldown(RATE_LIMIT_MS)
    setLoading(true); setActiveQ(q); setResult(null)

    try {
      const qs = new URLSearchParams({
        q, jedi: String(jedi), regime, model,
        long_algos: String(longAlgos), short_algos: String(shortAlgos),
        asset: focusAsset,
        surge_assets: surgeAssets.slice(0, 6).join(','),
        rising_assets: risingAssets.slice(0, 6).join(','),
      })
      const res = await fetch(`/ds/v1/ai/yoda/?${qs}`)
      const data = await res.json()
      setResult({ q, answer: data.answer ?? '', ts: data.timestamp ?? new Date().toISOString(), ok: data.ok, error: data.error })
    } catch (e) {
      setResult({ q, answer: '', ts: new Date().toISOString(), ok: false, error: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }, [jedi, regime, longAlgos, shortAlgos, focusAsset, surgeAssets, risingAssets, model])

  const fireSitrep = useCallback(async () => {
    if (!canCallYoda()) return
    markYodaCall()
    setCooldown(RATE_LIMIT_MS)
    setLoading(true); setActiveQ('sitrep'); setResult(null)

    try {
      const res = await fetch('/ds/v1/ai/sitrep/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jedi, regime, long_algos: longAlgos, short_algos: shortAlgos,
          model, full_context: fullCtx,
          council_votes: councilVotes,
          assets: allAssets.map((a: any) => ({ symbol: a.symbol, jedi_score: a.jedi_score ?? 0 })),
        }),
      })
      const data = await res.json()
      setResult({
        q: 'sitrep',
        answer: data.sitrep ?? '',
        ts: data.timestamp ?? new Date().toISOString(),
        ok: data.ok,
        error: data.error,
      })
    } catch (e) {
      setResult({ q: 'sitrep', answer: '', ts: new Date().toISOString(), ok: false, error: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }, [jedi, regime, longAlgos, shortAlgos, model, fullCtx, councilVotes, allAssets])

  const mission = activeQ === 'sitrep'
    ? { id: 'sitrep', label: 'SITREP · MARKET SNAPSHOT', icon: '◈', color: '#FFB74D' }
    : activeQ === 'vision'
    ? { id: 'vision', label: 'CHART VISION · YODA SEES', icon: '👁', color: '#a855f7' }
    : MISSIONS.find(m => m.id === activeQ)
  const cooldownSec = Math.ceil(cooldown / 1000)
  const canFire = cooldown === 0

  return (
    <Card elevation={Elevation.TWO} style={{
      background: '#020b14',
      border: '1px solid rgba(255,183,77,0.2)',
      padding: 0, marginBottom: 16, overflow: 'hidden',
    }}>
      {/* Cockpit header */}
      <div style={{
        padding: '12px 16px',
        background: 'linear-gradient(90deg, #020b14 0%, rgba(255,183,77,0.06) 100%)',
        borderBottom: '1px solid rgba(255,183,77,0.15)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#FFB74D', letterSpacing: 3, fontFamily: 'monospace' }}>
            ◈ WIZZO COCKPIT
          </div>
          <div style={{ fontSize: 9, color: '#334155', letterSpacing: 2 }}>
            WEAPONS SYSTEM OPERATOR · YODA AI INTEL · xAI GROK-3
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Model picker */}
          <HTMLSelect
            value={model}
            onChange={e => setModel(e.target.value)}
            style={{ fontSize: 10, background: '#0a1628', color: '#FFB74D', border: '1px solid rgba(255,183,77,0.2)', borderRadius: 4 }}
          >
            <option value="grok-4.20-reasoning">grok-4.20-reasoning ★</option>
            <option value="grok-3">grok-3</option>
            <option value="grok-3-mini">grok-3-mini</option>
          </HTMLSelect>
          {/* Rate limiter display */}
          <div style={{
            fontFamily: 'monospace', fontSize: 11,
            color: canFire ? '#4ade80' : '#f97316',
            border: `1px solid ${canFire ? 'rgba(74,222,128,0.3)' : 'rgba(249,115,22,0.3)'}`,
            borderRadius: 4, padding: '3px 10px',
            background: canFire ? 'rgba(74,222,128,0.05)' : 'rgba(249,115,22,0.05)',
          }}>
            {canFire ? '◉ READY' : `⏱ ${cooldownSec}s`}
          </div>
          <div style={{ fontSize: 9, color: '#1e3a5f', textAlign: 'right' }}>
            JEDI {jedi > 0 ? '+' : ''}{jedi}<br />
            {regime}
          </div>
        </div>
      </div>

      {/* 4 mission buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'rgba(255,255,255,0.04)' }}>
        {MISSIONS.map(m => {
          const isActive = activeQ === m.id
          const isLoading = loading && isActive
          return (
            <button
              key={m.id}
              disabled={!canFire || loading}
              onClick={() => fireQuery(m.id)}
              style={{
                background: isActive ? `${m.color}12` : '#020b14',
                border: 'none', padding: '14px 16px', cursor: canFire && !loading ? 'pointer' : 'not-allowed',
                textAlign: 'left', transition: 'background 0.15s',
                borderLeft: `3px solid ${isActive ? m.color : 'transparent'}`,
                opacity: !canFire && !isActive ? 0.5 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{isLoading ? '⌛' : m.icon}</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: isActive ? m.color : '#64748b',
                    fontFamily: 'monospace', letterSpacing: 0.5 }}>
                    {m.label}
                  </div>
                  <div style={{ fontSize: 9, color: '#334155', marginTop: 1 }}>{m.sub}</div>
                </div>
                {isLoading && (
                  <span style={{ marginLeft: 'auto', fontSize: 9, color: m.color, fontFamily: 'monospace' }}>
                    TRANSMITTING…
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* CHART VISION — send Trader chart to Grok */}
      <ChartVisionStrip canFire={canFire} loading={loading}
        onResult={(res) => { setActiveQ('vision'); setResult(res) }}
        onFire={() => { markYodaCall(); setCooldown(RATE_LIMIT_MS); setLoading(true); setActiveQ('vision') }}
        onDone={() => setLoading(false)}
        jedi={jedi} regime={regime} model={model}
      />

      {/* SITREP — master situation report button */}
      <div style={{
        padding: '10px 16px',
        background: 'rgba(255,183,77,0.04)',
        borderTop: '1px solid rgba(255,183,77,0.12)',
        display: 'flex', gap: 10, alignItems: 'center',
      }}>
        <button
          disabled={!canFire || loading}
          onClick={fireSitrep}
          style={{
            flex: 1, padding: '10px 16px', borderRadius: 6, border: 'none', cursor: canFire && !loading ? 'pointer' : 'not-allowed',
            background: activeQ === 'sitrep' && loading
              ? 'rgba(255,183,77,0.15)'
              : canFire ? 'rgba(255,183,77,0.1)' : 'rgba(51,65,85,0.3)',
            color: canFire ? '#FFB74D' : '#475569',
            fontFamily: 'monospace', fontWeight: 800, fontSize: 13, letterSpacing: 2,
            borderLeft: activeQ === 'sitrep' ? '3px solid #FFB74D' : '3px solid transparent',
            transition: 'all 0.15s',
          }}
        >
          {activeQ === 'sitrep' && loading
            ? '◈ TRANSMITTING SITREP…'
            : `◈ FIRE SITREP — FULL MARKET SNAPSHOT${allAssets.length > 0 ? ` (${allAssets.length} assets)` : ''}`
          }
        </button>

        {/* Full context toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: '#334155', textTransform: 'uppercase', letterSpacing: 1 }}>
            {fullCtx ? 'FULL CTX' : 'BRIEF CTX'}
          </span>
          <button
            onClick={() => setFullCtx(f => !f)}
            style={{
              width: 36, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer',
              background: fullCtx ? 'rgba(255,183,77,0.4)' : '#1e293b',
              position: 'relative', transition: 'background 0.2s',
            }}
          >
            <div style={{
              position: 'absolute', top: 2, width: 14, height: 14, borderRadius: '50%',
              background: fullCtx ? '#FFB74D' : '#475569',
              left: fullCtx ? 20 : 2, transition: 'left 0.2s',
            }} />
          </button>
        </div>

        <div style={{ fontSize: 9, color: '#1e3a5f', flexShrink: 0, textAlign: 'right', lineHeight: 1.4 }}>
          {fullCtx ? '130+ assets\nin prompt' : 'Top 8\nper tier'}
        </div>
      </div>

      {/* Intel output */}
      {result && (
        <div style={{ padding: 16, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 16 }}>{mission?.icon ?? '◈'}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: mission?.color ?? '#FFB74D', fontFamily: 'monospace' }}>
              {mission?.label ?? result.q.toUpperCase()} · INTEL RECEIVED
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 9, color: '#1e3a5f', fontFamily: 'monospace' }}>
              {result.ts.slice(11, 19)} UTC
            </span>
          </div>

          {result.ok ? (
            <div style={{
              fontSize: 12, color: '#94a3b8', lineHeight: 1.8,
              whiteSpace: 'pre-wrap', fontFamily: 'monospace',
              background: '#0a0f1a', padding: 12, borderRadius: 6,
              border: `1px solid ${mission?.color ?? '#FFB74D'}18`,
              maxHeight: 320, overflowY: 'auto',
            }}>
              {result.answer || '—'}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#f87171', background: '#1a0a0f', padding: 10, borderRadius: 6 }}>
              ⚠ {result.error ?? 'YODA offline'}
            </div>
          )}
        </div>
      )}

      {!result && !loading && (
        <div style={{ padding: '20px 16px', textAlign: 'center', color: '#1e3a5f', fontFamily: 'monospace', fontSize: 11 }}>
          {canFire
            ? 'SELECT MISSION BRIEF · YODA STANDING BY'
            : `RATE LIMIT — COOLDOWN ${cooldownSec}s · 2 REQUESTS / MINUTE`
          }
        </div>
      )}
    </Card>
  )
}

// ── Surgers Panel — asset momentum classification ─────────────────────────────
function SurgersPanel({ assets, onSelect }: { assets: any[]; onSelect: (sym: string) => void }) {
  const classified = useMemo(() => {
    const tiers = {
      surge:   [] as any[],  // JEDI > 12
      rising:  [] as any[],  // JEDI 6-12
      rumbling:[] as any[],  // JEDI 2-6
      flat:    [] as any[],  // -2 to 2
      fading:  [] as any[],  // -6 to -2
      crash:   [] as any[],  // < -6
    }
    for (const a of assets) {
      const j = a.jedi_score ?? 0
      if (j > 12)       tiers.surge.push(a)
      else if (j > 6)   tiers.rising.push(a)
      else if (j > 2)   tiers.rumbling.push(a)
      else if (j >= -2) tiers.flat.push(a)
      else if (j >= -6) tiers.fading.push(a)
      else              tiers.crash.push(a)
    }
    // Sort each tier descending
    for (const t of Object.values(tiers)) t.sort((a: any, b: any) => (b.jedi_score ?? 0) - (a.jedi_score ?? 0))
    return tiers
  }, [assets])

  const TIERS = [
    { key: 'surge',    label: '🚀 SURGE',    color: '#00ff8c', bg: '#001a0a', desc: 'Breakout NOW' },
    { key: 'rising',   label: '📈 RISING',   color: '#4ade80', bg: '#0a1a0a', desc: 'Strong momentum' },
    { key: 'rumbling', label: '🌋 RUMBLE',   color: '#fbbf24', bg: '#1a1400', desc: 'Early accumulation' },
    { key: 'flat',     label: '⬜ FLAT',     color: '#475569', bg: '#0f172a', desc: 'No signal' },
    { key: 'fading',   label: '📉 FADING',   color: '#f97316', bg: '#1a0e00', desc: 'Losing momentum' },
    { key: 'crash',    label: '💥 CRASH',    color: '#f43f5e', bg: '#1a0208', desc: 'Avoid / short' },
  ]

  return (
    <Card elevation={Elevation.ONE} style={{ background: '#0a0f1a', padding: 14, marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB74D', letterSpacing: 2, fontFamily: 'monospace', marginBottom: 10 }}>
        ◉ SURGERS · RISERS · RUMBLINGS — Live Asset Signal Tiers
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {TIERS.map(tier => {
          const list = (classified as any)[tier.key] as any[]
          if (list.length === 0) return null
          return (
            <div key={tier.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ width: 100, flexShrink: 0, paddingTop: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: tier.color, fontFamily: 'monospace' }}>{tier.label}</div>
                <div style={{ fontSize: 8, color: '#334155' }}>{tier.desc}</div>
              </div>
              <div style={{ flex: 1, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {list.slice(0, 12).map((a: any) => (
                  <button
                    key={a.symbol}
                    onClick={() => onSelect(a.symbol)}
                    style={{
                      background: tier.bg,
                      border: `1px solid ${tier.color}44`,
                      borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
                      textAlign: 'left',
                      animation: tier.key === 'surge' ? 'alarm-border 2.5s ease-in-out infinite' : undefined,
                    }}
                  >
                    <div style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700, color: tier.color }}>
                      {a.symbol}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: 9, color: tier.color + 'aa' }}>
                      {(a.jedi_score ?? 0) > 0 ? '+' : ''}{a.jedi_score ?? 0}
                    </div>
                  </button>
                ))}
                {list.length > 12 && (
                  <span style={{ fontSize: 9, color: '#334155', padding: '4px 6px' }}>+{list.length - 12}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ── Defense Laser Alert ───────────────────────────────────────────────────────
function DefenseLaser({ jedi, regime, shortAlgos, longAlgos }: {
  jedi: number; regime: string; shortAlgos: number; longAlgos: number
}) {
  const danger  = jedi < -8 || (shortAlgos > longAlgos && shortAlgos > 10) || regime === 'BEAR'
  const caution = !danger && (jedi < 0 || shortAlgos > longAlgos)
  const status  = danger ? 'DANGER' : caution ? 'CAUTION' : 'CLEAR'

  const col   = danger ? '#ff1744' : caution ? '#FFB74D' : '#4ade80'
  const label = danger
    ? '🔴 DEFENSE LASER — HEDGE OR STAND DOWN'
    : caution
    ? '🟡 ORB DIMMING — Reduce exposure, tighten stops'
    : '🟢 ORB BRIGHT — Council aligned, press longs'

  return (
    <div style={{
      padding: '16px 20px',
      borderRadius: 10,
      border: `2px solid ${col}`,
      background: `${col}11`,
      marginBottom: 16,
      animation: danger ? 'signal-flash 1.4s ease-in-out infinite' : undefined,
    }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: col, letterSpacing: 1 }}>{label}</div>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>
          JEDI <span style={{ color: col, fontFamily: 'monospace', fontWeight: 700 }}>
            {jedi > 0 ? '+' : ''}{jedi}
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>
          Regime <span style={{ color: col, fontWeight: 700 }}>{regime}</span>
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>
          Bears <span style={{ color: '#f87171', fontFamily: 'monospace', fontWeight: 700 }}>{shortAlgos}</span>
          {' / '}
          Bulls <span style={{ color: '#4ade80', fontFamily: 'monospace', fontWeight: 700 }}>{longAlgos}</span>
        </div>
      </div>
    </div>
  )
}

// ── Position sizing by JEDI ───────────────────────────────────────────────────
function PositionSizer({ jedi }: { jedi: number }) {
  // Kelly-inspired JEDI position sizing: scale 0–100% of max allocation
  const raw    = Math.max(0, Math.min(27, jedi + 13.5)) / 27
  const pct    = Math.round(raw * 100)
  const maxPos = pct > 60 ? 'Full risk-on: 100% allocated' :
                 pct > 40 ? 'Moderate: 50–75% allocated' :
                 pct > 20 ? 'Defensive: 25% allocated' :
                            'Cash/hedge: 0–10% allocated'
  const col    = pct > 60 ? '#4ade80' : pct > 40 ? '#fbbf24' : pct > 20 ? '#f97316' : '#f87171'

  return (
    <Card elevation={Elevation.ONE} style={{ background: '#0f172a', padding: 14 }}>
      <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        JEDI Position Sizing
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: col, fontFamily: 'monospace' }}>{pct}% allocation</span>
        <span style={{ fontSize: 11, color: '#475569' }}>{maxPos}</span>
      </div>
      <ProgressBar value={raw} intent={pct > 60 ? Intent.SUCCESS : pct > 40 ? Intent.WARNING : Intent.DANGER} animate={false} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 9, color: '#334155' }}>
        <span>JEDI -13 → Cash</span>
        <span>JEDI 0 → Neutral</span>
        <span>JEDI +13 → Full</span>
      </div>
    </Card>
  )
}

// ── Hedge Strategy Card ───────────────────────────────────────────────────────
function HedgeCard({ title, icon, desc, rules, color }: {
  title: string; icon: string; desc: string; rules: string[]; color: string
}) {
  return (
    <Card elevation={Elevation.ONE} style={{ background: '#0f172a', padding: 14, borderLeft: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div style={{ fontSize: 12, fontWeight: 700, color }}>{title}</div>
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>{desc}</div>
      <ul style={{ margin: 0, padding: '0 0 0 14px', listStyle: 'disc' }}>
        {rules.map((r, i) => (
          <li key={i} style={{ fontSize: 11, color: '#94a3b8', marginBottom: 3 }}>{r}</li>
        ))}
      </ul>
    </Card>
  )
}

// ── Long / Short book ─────────────────────────────────────────────────────────
function LongShortBook({ algos, assets }: { algos: any[]; assets: any[] }) {
  const longs  = algos.filter(a => a.vote === 1).slice(0, 9)
  const shorts = algos.filter(a => a.vote === -1).slice(0, 9)

  // Top assets by JEDI for long book
  const longAssets  = [...(assets ?? [])].sort((a, b) => (b.jedi_score ?? 0) - (a.jedi_score ?? 0)).slice(0, 6)
  const shortAssets = [...(assets ?? [])].sort((a, b) => (a.jedi_score ?? 0) - (b.jedi_score ?? 0)).slice(0, 6)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {/* Long book */}
      <Card elevation={Elevation.ONE} style={{ background: '#0a1a0f', padding: 12, border: '1px solid rgba(74,222,128,0.2)' }}>
        <div style={{ fontSize: 10, color: '#4ade80', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          ▲ Long Book — {longs.length} algo signals
        </div>
        <div style={{ marginBottom: 8 }}>
          {longs.map(a => (
            <div key={a.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
              <span style={{ fontFamily: 'monospace', color: '#4ade80', fontSize: 11, width: 34 }}>{a.id}</span>
              <div style={{ flex: 1, height: 3, background: '#1e293b', borderRadius: 1, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(a.score ?? 0) * 100}%`, background: '#4ade80' }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 9, color: '#334155', marginBottom: 4 }}>TOP ASSETS TO LONG:</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {longAssets.map(a => (
            <Tag key={a.symbol} minimal style={{
              background: 'rgba(74,222,128,0.12)', color: '#4ade80',
              fontSize: 10, fontFamily: 'monospace',
            }}>
              {a.symbol} +{a.jedi_score ?? 0}
            </Tag>
          ))}
        </div>
      </Card>

      {/* Short book */}
      <Card elevation={Elevation.ONE} style={{ background: '#1a0a0f', padding: 12, border: '1px solid rgba(244,63,94,0.2)' }}>
        <div style={{ fontSize: 10, color: '#f87171', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          ▼ Short / Hedge Book — {shorts.length} algo signals
        </div>
        <div style={{ marginBottom: 8 }}>
          {shorts.length === 0
            ? <div style={{ color: '#334155', fontSize: 11 }}>No short signals — market may be neutral/bull</div>
            : shorts.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
                <span style={{ fontFamily: 'monospace', color: '#f87171', fontSize: 11, width: 34 }}>{a.id}</span>
                <div style={{ flex: 1, height: 3, background: '#1e293b', borderRadius: 1, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(a.score ?? 0) * 100}%`, background: '#f87171' }} />
                </div>
              </div>
            ))
          }
        </div>
        {shorts.length > 0 && (
          <>
            <div style={{ fontSize: 9, color: '#334155', marginBottom: 4 }}>WEAKEST ASSETS (short candidates):</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {shortAssets.map(a => (
                <Tag key={a.symbol} minimal style={{
                  background: 'rgba(244,63,94,0.12)', color: '#f87171',
                  fontSize: 10, fontFamily: 'monospace',
                }}>
                  {a.symbol} {a.jedi_score ?? 0}
                </Tag>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Hedge() {
  const { data: council } = useCouncil()
  const { data: algoDay } = useAlgoDay()

  const [focusAsset, setFocusAsset] = useState('BTC')

  const jedi      = council?.jedi_score ?? 0
  const regime    = council?.regime ?? 'NEUTRAL'
  const longAlg   = council?.total_long ?? 0
  const shortAlg  = council?.total_short ?? 0
  const algos     = council?.algos ?? []
  const assets    = algoDay?.assets ?? []

  // Net exposure: +1 fully long, -1 fully short
  const netExposure = useMemo(() => {
    const raw = (longAlg - shortAlg) / 27
    return Math.round(raw * 100)
  }, [longAlg, shortAlg])

  // Surge / rising asset lists for WIZZO context
  const surgeAssets  = useMemo(() => assets.filter((a: any) => (a.jedi_score ?? 0) > 12).map((a: any) => a.symbol), [assets])
  const risingAssets = useMemo(() => assets.filter((a: any) => (a.jedi_score ?? 0) > 6 && (a.jedi_score ?? 0) <= 12).map((a: any) => a.symbol), [assets])

  // Council votes map for SITREP context
  const councilVotes = useMemo(() => {
    const map: Record<string, number> = {}
    for (const a of algos) map[a.id] = a.vote ?? 0
    return map
  }, [algos])

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16, background: 'var(--bg-dark)', color: '#e2e8f0' }}>

      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#FFB74D' }}>🛡 HEDGE — Hedge Fund Command</div>
        <div style={{ fontSize: 10, color: '#475569' }}>
          Long/Short construction · Defense lasers · Position sizing · Risk framework
        </div>
      </div>

      {/* DEFENSE LASER — top priority alert */}
      <DefenseLaser jedi={jedi} regime={regime} shortAlgos={shortAlg} longAlgos={longAlg} />

      {/* Net exposure + position sizing */}
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12, marginBottom: 16 }}>
        <Card elevation={Elevation.ONE} style={{ background: '#0f172a', padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Net Exposure
          </div>
          <div style={{
            fontSize: 40, fontWeight: 800, fontFamily: 'monospace',
            color: netExposure > 15 ? '#4ade80' : netExposure < -15 ? '#f87171' : '#FFB74D',
          }}>
            {netExposure > 0 ? '+' : ''}{netExposure}%
          </div>
          <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>
            {netExposure > 20 ? 'RISK ON — press longs'
              : netExposure > 0 ? 'SLIGHT LONG BIAS'
              : netExposure < -20 ? 'RISK OFF — hedge/cash'
              : netExposure < 0 ? 'SLIGHT SHORT BIAS'
              : 'MARKET NEUTRAL'}
          </div>
        </Card>
        <PositionSizer jedi={jedi} />
      </div>

      {/* Long / Short book */}
      <div style={{ marginBottom: 16 }}>
        <LongShortBook algos={algos} assets={assets} />
      </div>

      {/* WIZZO Cockpit — YODA strategic intel */}
      <WizzoCockpit
        jedi={jedi} regime={regime} longAlgos={longAlg} shortAlgos={shortAlg}
        focusAsset={focusAsset} surgeAssets={surgeAssets} risingAssets={risingAssets}
        allAssets={assets} councilVotes={councilVotes}
      />

      {/* PULSE — live Grok trigger stream */}
      <PulseFeed />

      {/* Surgers · Risers · Rumblings — asset tier classification */}
      {assets.length > 0 && <SurgersPanel assets={assets} onSelect={setFocusAsset} />}

      {/* SEAL TEAM 6 — all-weather AI protection */}
      <SealTeam6 jedi={jedi} regime={regime} />

      {/* HALO Jump — stealth execution */}
      <HaloJump jedi={jedi} />

      {/* Hedge strategies */}
      <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
        Hedge Fund Playbook — active frameworks
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, marginBottom: 16 }}>
        <HedgeCard
          title="TREND FOLLOWING — SEALS"
          icon="🎯"
          color="#22d3ee"
          desc="Ride momentum. Enter after JEDI ≥ +8, Banks A+B aligned."
          rules={[
            'Long when JEDI > +8 AND regime = BULL',
            'Size: JEDI/27 × max allocation (Kelly-scaled)',
            'Trail stop: 2×ATR from entry',
            'Exit: JEDI crosses below 0 OR Bank A flips',
          ]}
        />
        <HedgeCard
          title="LONG / SHORT EQUITY"
          icon="⚖️"
          color="#a78bfa"
          desc="Pairs: long strongest JEDI assets, short weakest."
          rules={[
            'Long top 3 assets by JEDI score',
            'Short bottom 3 assets where short algos > 5',
            'Target 0% net exposure in NEUTRAL regime',
            'Collapse short book when JEDI > +10',
          ]}
        />
        <HedgeCard
          title="VOLATILITY DEFENCE — ORB SHIELD"
          icon="🛡"
          color="#f97316"
          desc="VIX-style squeeze detection. Purple bands = no-trade zone."
          rules={[
            'When PURPLE bands fire (BB inside KC): reduce size by 50%',
            'Short algos > 8: raise cash to 50%, add put-equiv hedge',
            'JEDI < -12: full defensive — 0% long, hold cash or inverse',
            'Resume after JEDI crosses back above -5 for 3 bars',
          ]}
        />
        <HedgeCard
          title="MACRO COUNCIL — JEDI MASTER"
          icon="🌐"
          color="#4ade80"
          desc="Top-down filter. JEDI drives regime allocation across all strategies."
          rules={[
            'JEDI +14 → +27: Full risk-on, 100% long book, no hedge',
            'JEDI  0  → +14: Moderate, 50–75%, light hedge',
            'JEDI -8  →  0 : Defensive, 25%, buy protection',
            'JEDI -27 →  -8: Crisis mode — hedge/cash/inverse ETF',
          ]}
        />
        <HedgeCard
          title="LEGEND SWING — 1–6 MONTH BOOK"
          icon="★"
          color="#fbbf24"
          desc="Weinstein · Minervini · O'Neil · Stockbee. Separate book."
          rules={[
            'LEGEND composite > 0.5: add to swing book (independent of JEDI)',
            'Hold period: 1–6 months. Stop: -8% from entry.',
            'Re-score monthly. Prune if composite < 0.3.',
            'Size: 3–5% per position, max 5 concurrent',
          ]}
        />
        <HedgeCard
          title="SEALS RESCUE — CRISIS RESPONSE"
          icon="🦅"
          color="#f43f5e"
          desc="When market drops 50%+. Defense lasers go red. SEALS deploy."
          rules={[
            'Trigger: JEDI < -18 OR short_algos > 20 for 3 sessions',
            'Action: Close all longs, move 80% to cash/stablecoin',
            'Hedge: Inverse ETFs or short BTC/ETH if available',
            'Re-entry: Wait for JEDI > 0 + 2 sessions of confirmation',
          ]}
        />
      </div>

      {/* Risk matrix */}
      <Card elevation={Elevation.ONE} style={{ background: '#0f172a', padding: 14 }}>
        <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          Risk Throttle Matrix — JEDI-gated rules
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['JEDI Zone', 'Label', 'Max Long%', 'Hedge', 'Action'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#475569', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { zone: '+14 → +27', label: 'FULL BULL', long: '100%', hedge: 'None', action: 'Press longs, trail stops', col: '#4ade80' },
                { zone: '+5 → +14',  label: 'BULL',      long: '75%',  hedge: 'Light',  action: 'Add on pullbacks', col: '#86efac' },
                { zone: '0 → +5',    label: 'CAUTIOUS',  long: '50%',  hedge: 'Moderate', action: 'Wait for clarity', col: '#fbbf24' },
                { zone: '-5 → 0',    label: 'NEUTRAL',   long: '25%',  hedge: 'Active', action: 'Reduce, hedge', col: '#f97316' },
                { zone: '-14 → -5',  label: 'DEFENSIVE', long: '10%',  hedge: 'Heavy', action: 'Cash + inverse', col: '#f87171' },
                { zone: '-27 → -14', label: '🔴 CRISIS',  long: '0%',   hedge: 'Max',   action: 'SEALS protocol — full exit', col: '#ff1744' },
              ].map(r => (
                <tr key={r.zone} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: r.col }}>{r.zone}</td>
                  <td style={{ padding: '6px 10px', fontWeight: 700, color: r.col }}>{r.label}</td>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{r.long}</td>
                  <td style={{ padding: '6px 10px', color: '#64748b' }}>{r.hedge}</td>
                  <td style={{ padding: '6px 10px', color: '#94a3b8' }}>{r.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
