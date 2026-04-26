import { useMemo, useState } from 'react'
import { usePoll } from '../api/client'
import type { ActivityReport, CouncilSnapshot } from '../types'

const PRELOAD = [
  { label: 'ENTRY THR',  val: '0.12',    key: 'entry_thr' },
  { label: 'JEDI MIN',   val: '10',      key: 'jedi_min'  },
  { label: 'CIS LEVEL',  val: '2',       key: 'cis'       },
  { label: 'HORIZON',    val: '6',       key: 'horizon'   },
  { label: 'LOT SIZE',   val: '2.5',     key: 'lots'      },
  { label: 'MODE',       val: 'EUPHORIA',key: 'mode'      },
]

interface OrderIntentRecord {
  ts?: string
  symbol?: string
  side?: string
  broker?: string
  status?: string
  qty?: number
}

interface OrderIntentResponse {
  ok?: boolean
  results?: OrderIntentRecord[]
  data?: OrderIntentRecord[]
}

interface Props {
  council: CouncilSnapshot | null
  activity: ActivityReport | null
}

export default function TradePage({ council, activity }: Props) {
  const [fireReady, setFireReady] = useState(false)
  const [mode, setMode] = useState<'PADAWAN' | 'NORMAL' | 'EUPHORIA' | 'MAX'>('PADAWAN')
  const [symbol, setSymbol] = useState('BTC')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState<string | null>(null)
  const [submitOk, setSubmitOk] = useState<boolean | null>(null)
  const blotter = usePoll<OrderIntentResponse>('/v1/audit/order-intent/?broker=all&limit=20', 20_000)

  const jedi   = council?.jedi_score ?? 0
  const regime = council?.regime ?? 'NEUTRAL'
  const longs  = council?.total_long  ?? 0
  const shorts = council?.total_short ?? 0
  const gateStatus = activity?.gate_status ?? 'DEAD'
  const activityScore = activity?.activity_score ?? 0

  const canFire = jedi > 10 && regime !== 'RISK-OFF' && (gateStatus === 'HOT' || gateStatus === 'ALIVE')
  const blotterRows = useMemo(() => {
    if (!blotter) return []
    return blotter.results ?? blotter.data ?? []
  }, [blotter])
  const hasBlotterFeed = blotter !== null
  const knownSymbols = useMemo(() => {
    const fromBlotter = blotterRows.map(r => (r.symbol ?? '').replace('/USDT', '').toUpperCase()).filter(Boolean)
    const merged = Array.from(new Set(['BTC', 'ETH', 'SOL', ...fromBlotter]))
    return merged.slice(0, 10)
  }, [blotterRows])

  async function submitTrade() {
    if (!canFire || isSubmitting) return
    setIsSubmitting(true)
    setSubmitMsg(null)
    setSubmitOk(null)
    try {
      const r = await fetch('/ds/v1/paper/approve/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, mode }),
      })
      const j = await r.json() as { ok?: boolean; error?: string; message?: string; symbol?: string; mode?: string }
      if (!r.ok || !j.ok) {
        setSubmitOk(false)
        setSubmitMsg(j.error ?? `submit failed (${r.status})`)
        return
      }
      setSubmitOk(true)
      setSubmitMsg(`cycle launched: ${j.symbol ?? symbol} · ${j.mode ?? mode}`)
      setFireReady(false)
    } catch (e) {
      setSubmitOk(false)
      setSubmitMsg(`submit error: ${String(e)}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const reasoning = useMemo(() => ([
    { role: 'sys', text: `Council status: ${council ? 'LIVE' : 'OFFLINE'} · JEDI ${jedi > 0 ? '+' : ''}${jedi.toFixed(0)} · Regime ${regime}` },
    { role: 'sys', text: `Activity gate: ${gateStatus} (${(activityScore * 100).toFixed(0)}%) · Fire gate ${canFire ? 'OPEN' : 'BLOCKED'}` },
    { role: 'claude', text: canFire ? 'Recommendation state: setup qualifies for paper execution guardrails.' : 'Recommendation state: waiting for gate alignment before arming trade.' },
  ]), [activityScore, canFire, council, gateStatus, jedi, regime])
  const mono = "var(--font-mono)"

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Title */}
      <div style={{
        padding: '6px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 3,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: mono,
      }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.14em' }}>③ TRADE</span>
          <span style={{ fontSize: 9, color: 'var(--text3)', marginLeft: 12 }}>ARB SCORE · FIRE · BLOTTER · AI REASONING</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <span className={`m5d-badge ${council ? 'green' : 'red'}`}>{council ? 'LIVE: COUNCIL' : 'OFFLINE: COUNCIL'}</span>
          <span className={`m5d-badge ${activity ? 'green' : 'gold'}`}>{activity ? `LIVE: ACTIVITY ${gateStatus}` : 'CACHED: ACTIVITY'}</span>
          <span className="m5d-badge gray">PAPER MODE</span>
        </div>
      </div>

      <div className="grid3">
        {/* Arb score */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(255,204,58,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--goldB)' }}>ARB SCORE</span>
            <span className="m5d-badge gold">COMPOSITE</span>
          </div>
          <div className="m5d-panel-body" style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: 42, fontWeight: 800, fontFamily: mono, lineHeight: 1.1, padding: '12px 0',
              color: canFire ? 'var(--greenB)' : 'var(--text2)',
            }}>
              {jedi > 0 ? `+${jedi.toFixed(0)}` : jedi.toFixed(0)}
            </div>
            <div style={{ fontSize: 8, color: 'var(--text3)', marginBottom: 12 }}>JEDI SCORE / 27 VOTES</div>
            <div style={{
              display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12,
            }}>
              <span className="m5d-badge green">▲ {longs} LONG</span>
              <span className="m5d-badge red">▼ {shorts} SHORT</span>
              <span className="m5d-badge" style={{ border: `1px solid ${regime === 'TRENDING' ? 'var(--green)' : 'var(--border)'}`, color: regime === 'TRENDING' ? 'var(--greenB)' : 'var(--text2)', background: 'transparent', fontSize: 8, padding: '1px 5px' }}>{regime}</span>
            </div>
            {/* Fire button */}
            <button
              onClick={() => {
                if (!canFire || isSubmitting) return
                if (!fireReady) { setFireReady(true); return }
                void submitTrade()
              }}
              disabled={!canFire || isSubmitting}
              style={{
                width: '100%', padding: '10px', borderRadius: 2,
                fontFamily: mono, fontSize: 11, fontWeight: 700, letterSpacing: '0.15em',
                cursor: canFire && !isSubmitting ? 'pointer' : 'not-allowed',
                background: canFire ? (fireReady ? 'rgba(255,100,0,0.15)' : 'rgba(29,255,122,0.1)') : 'transparent',
                border: `1px solid ${canFire ? (fireReady ? '#ff6600' : 'var(--green)') : 'var(--border)'}`,
                color: canFire ? (fireReady ? '#ff8800' : 'var(--greenB)') : 'var(--text3)',
                transition: 'all 0.2s',
              }}
            >
              {!canFire ? '○ WAITING FOR SIGNAL' : isSubmitting ? '◌ SUBMITTING…' : fireReady ? '▶ CONFIRM PAPER ORDER' : '● ARM TRADE'}
            </button>
            {submitMsg && (
              <div style={{
                marginTop: 8, fontSize: 8, lineHeight: 1.5, borderRadius: 2, padding: '4px 6px',
                background: submitOk ? 'rgba(29,255,122,0.08)' : 'rgba(255,74,90,0.08)',
                border: `1px solid ${submitOk ? 'var(--green)' : 'var(--red)'}`,
                color: submitOk ? 'var(--greenB)' : 'var(--redB)',
              }}>
                {submitMsg}
              </div>
            )}
          </div>
        </div>

        {/* Execution payload */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(58,143,255,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--accent)' }}>EXECUTION PAYLOAD</span>
            <span className="m5d-badge green">LIVE: /ds/v1/paper/approve/</span>
          </div>
          <div className="m5d-panel-body">
            <div className="stat-row">
              <span className="stat-label">SYMBOL</span>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                style={{
                  background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text)',
                  fontFamily: mono, fontSize: 9, borderRadius: 2, padding: '2px 4px',
                }}
              >
                {knownSymbols.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="stat-row">
              <span className="stat-label">MODE</span>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
                style={{
                  background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text)',
                  fontFamily: mono, fontSize: 9, borderRadius: 2, padding: '2px 4px',
                }}
              >
                {(['PADAWAN', 'NORMAL', 'EUPHORIA', 'MAX'] as const).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="stat-row"><span className="stat-label">ENDPOINT</span><span className="stat-val blue">POST /ds/v1/paper/approve/</span></div>
            <div className="stat-row"><span className="stat-label">BROKER</span><span className="stat-val">ALPACA PAPER</span></div>
            <div className="stat-row"><span className="stat-label">EXECUTION</span><span className={`stat-val ${canFire ? 'green' : 'red'}`}>{canFire ? 'GATE OPEN' : 'BLOCKED'}</span></div>
            <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
            <div style={{ fontSize: 8, color: 'var(--text3)', lineHeight: 1.6 }}>
              Flow: Arm trade → confirm submit → DS launches paper cycle for selected symbol.
            </div>
            <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
            {[
              { label: 'IOPT Sharpe',   val: '21.7', color: 'var(--goldB)' },
              { label: 'OOS Holdout',   val: '21.4', color: 'var(--greenB)' },
              { label: 'WR',            val: '62.4%', color: 'var(--greenB)' },
              { label: 'Trades/yr',     val: '117', color: 'var(--text)' },
              { label: 'jedi_min FIX',  val: '10 ← key', color: 'var(--goldB)' },
            ].map(r => (
              <div key={r.label} className="stat-row">
                <span className="stat-label">{r.label}</span>
                <span className="stat-val" style={{ color: r.color }}>{r.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* AI reasoning */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(176,122,255,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--purpleB)' }}>AI REASONING</span>
            <span className={`m5d-badge ${activity ? 'green' : 'gold'}`}>{activity ? 'LIVE INPUTS' : 'CACHED INPUTS'}</span>
          </div>
          <div className="m5d-panel-body" style={{ padding: '6px 8px' }}>
            {reasoning.map((m, i) => (
              <div
                key={i}
                style={{
                  padding: '4px 6px', marginBottom: 4, borderRadius: 2, fontSize: 9, lineHeight: 1.5,
                  background: m.role === 'claude' ? 'rgba(176,122,255,0.1)' : 'var(--bg3)',
                  borderLeft: `2px solid ${m.role === 'claude' ? 'var(--purpleB)' : 'var(--border2)'}`,
                  color: m.role === 'claude' ? 'var(--text)' : 'var(--text2)',
                }}
              >{m.text}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Blotter placeholder */}
      <div className="m5d-panel fullspan">
        <div className="m5d-panel-head" style={{ background: 'rgba(58,143,255,0.06)' }}>
          <span className="panel-title" style={{ color: 'var(--accent)' }}>PAPER BLOTTER</span>
          <span className={`m5d-badge ${hasBlotterFeed ? 'green' : 'gold'}`}>{hasBlotterFeed ? 'LIVE FEED' : 'CACHED/LOADING'}</span>
        </div>
        <div className="m5d-panel-body" style={{ padding: '8px 10px' }}>
          {!blotterRows.length ? (
            <div style={{ color: 'var(--text3)', fontSize: 9, textAlign: 'center' }}>
              No order intents yet from `/v1/audit/order-intent/`.
            </div>
          ) : (
            blotterRows.slice(0, 8).map((row, idx) => (
              <div key={`${row.ts ?? 'na'}-${row.symbol ?? 'na'}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', borderBottom: '1px solid var(--border)', fontSize: 8 }}>
                <span style={{ width: 44, color: 'var(--text3)' }}>{row.ts?.slice(11, 16) ?? '—'}</span>
                <span style={{ width: 72, color: 'var(--accent)', fontWeight: 700 }}>{row.symbol ?? '—'}</span>
                <span className={`m5d-badge ${(row.side ?? '').toLowerCase() === 'buy' || (row.side ?? '').toLowerCase() === 'long' ? 'green' : 'red'}`} style={{ fontSize: 7 }}>
                  {(row.side ?? '—').toUpperCase()}
                </span>
                <span style={{ width: 56, color: 'var(--text2)', textAlign: 'right' }}>{row.qty ?? '—'}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>{row.broker ?? '—'}</span>
                <span style={{ color: 'var(--text2)', minWidth: 54, textAlign: 'right' }}>{row.status ?? '—'}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
