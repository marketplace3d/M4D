/**
 * ALGO WEIGHTS — Dynamic JEDI Weight Optimizer
 * MoE per strategy vote, regime × bank multipliers,
 * MAXCOGVIZ macro adjustments, IC backtest Bayesian update.
 *
 * POST /ds/v1/algo/weights/optimize/ → visualise weighted JEDI vs equal-weight.
 */
import { useState, useEffect, useCallback } from 'react'
import { Card, Elevation, Button, Spinner, Callout, Tag, HTMLTable, Switch } from '@blueprintjs/core'
import { useCouncil } from '../api/client'

const DS = '/ds'

const BANK_COLOR: Record<string, string> = {
  A: '#FFB74D',   // orange — BREAK/momentum
  B: '#22d3ee',   // cyan   — TREND/structure
  C: '#a78bfa',   // purple — MOMENTUM/swing
}

const BANK_LABEL: Record<string, string> = {
  A: 'BREAK',
  B: 'TREND',
  C: 'MOMENTUM',
}

const REGIME_OPTIONS = ['BULL', 'NEUTRAL', 'BEAR'] as const
type Regime = typeof REGIME_OPTIONS[number]

const REGIME_COLOR: Record<Regime, string> = {
  BULL: '#4ade80',
  NEUTRAL: '#fbbf24',
  BEAR: '#f43f5e',
}

// ── Regime × Bank reference matrix ───────────────────────────────────────────
const REGIME_BANK_MATRIX: Record<Regime, Record<string, number>> = {
  BULL:    { A: 1.30, B: 1.00, C: 0.70 },
  NEUTRAL: { A: 0.90, B: 1.25, C: 1.00 },
  BEAR:    { A: 0.55, B: 1.05, C: 1.45 },
}

interface AlgoDetail {
  id: string
  bank: 'A' | 'B' | 'C'
  name: string
  vote: number
  confidence: number
  equal_weight: number
  weight: number
  moe_weight: number
  factor: number
  weighted_contrib: number
  reasons: string[]
}

interface BoostEntry {
  algo: string
  weight: number
  factor: number
  bank: string
  name: string
  reasons: string[]
}

interface OptResult {
  ok: boolean
  regime: string
  method: string
  bank_multipliers: Record<string, number>
  equal_jedi: number
  weighted_jedi: number
  moe_jedi: number
  jedi_delta: number
  weights: Record<string, number>
  moe_weights: Record<string, number>
  boosts: BoostEntry[]
  suppressions: BoostEntry[]
  algo_detail: AlgoDetail[]
  timestamp: string
}

// ── JEDI Gauge ────────────────────────────────────────────────────────────────
function JediGauge({ value, label, color }: { value: number; label: string; color: string }) {
  const pct = ((value + 27) / 54) * 100
  const clamp = Math.max(0, Math.min(100, pct))
  return (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{
        fontSize: 26, fontWeight: 800, fontFamily: 'monospace',
        color: value > 3 ? '#4ade80' : value < -3 ? '#f43f5e' : '#fbbf24',
      }}>
        {value > 0 ? '+' : ''}{value.toFixed(1)}
      </div>
      <div style={{
        height: 6, borderRadius: 3, background: 'var(--bg-dark)',
        marginTop: 6, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${clamp}%`,
          background: color, borderRadius: 3,
          transition: 'width 0.5s ease',
        }} />
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
        range −27 … +27
      </div>
    </div>
  )
}

// ── Single algo weight bar ────────────────────────────────────────────────────
function AlgoBar({ d, maxW, showMoe }: { d: AlgoDetail; maxW: number; showMoe: boolean }) {
  const barW = (d.weight / maxW) * 100
  const moeW = (d.moe_weight / maxW) * 100
  const bc = BANK_COLOR[d.bank] ?? '#aaa'
  const voteColor = d.vote > 0 ? '#4ade80' : d.vote < 0 ? '#f43f5e' : '#64748b'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
      {/* Vote indicator */}
      <div style={{
        width: 12, height: 12, borderRadius: 2,
        background: voteColor, flexShrink: 0,
        border: '1px solid rgba(255,255,255,0.1)',
      }} title={`vote: ${d.vote}`} />

      {/* ID */}
      <span style={{
        width: 90, fontSize: 11, fontFamily: 'monospace',
        color: bc, flexShrink: 0,
      }}>
        {d.id}
      </span>

      {/* Bar */}
      <div style={{
        flex: 1, height: 16, background: 'var(--bg-dark)',
        borderRadius: 3, overflow: 'hidden', position: 'relative',
      }}>
        {/* MoE bar (ghost) */}
        {showMoe && (
          <div style={{
            position: 'absolute', top: 0, left: 0,
            width: `${moeW}%`, height: '100%',
            background: `${bc}33`, borderRadius: 3,
          }} />
        )}
        {/* Optimized weight bar */}
        <div style={{
          width: `${barW}%`, height: '100%',
          background: bc, borderRadius: 3, opacity: 0.85,
          transition: 'width 0.4s ease',
        }} />
        {/* Equal-weight marker (1/27 ≈ 3.7%) */}
        <div style={{
          position: 'absolute', top: 0,
          left: `${(d.equal_weight / maxW) * 100}%`,
          width: 1, height: '100%',
          background: 'rgba(255,255,255,0.3)',
        }} />
      </div>

      {/* Factor */}
      <span style={{
        width: 38, fontSize: 10, textAlign: 'right', flexShrink: 0,
        color: d.factor > 1.05 ? '#4ade80' : d.factor < 0.95 ? '#f43f5e' : 'var(--text-muted)',
        fontFamily: 'monospace',
      }}>
        ×{d.factor.toFixed(2)}
      </span>

      {/* Confidence */}
      <span style={{
        width: 30, fontSize: 10, textAlign: 'right', flexShrink: 0,
        color: 'var(--text-muted)', fontFamily: 'monospace',
      }}>
        {(d.confidence * 100).toFixed(0)}%
      </span>
    </div>
  )
}

// ── Regime matrix display ─────────────────────────────────────────────────────
function RegimeMatrix({ current }: { current: Regime }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <HTMLTable compact style={{ width: '100%', fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ color: 'var(--text-muted)' }}>Regime</th>
            {['A — BREAK', 'B — TREND', 'C — MOMENTUM'].map((b, i) => (
              <th key={i} style={{ color: BANK_COLOR['ABC'[i]], textAlign: 'center' }}>{b}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {REGIME_OPTIONS.map(r => (
            <tr key={r} style={{
              background: r === current ? 'rgba(255,255,255,0.04)' : 'transparent',
            }}>
              <td>
                <Tag minimal style={{ background: REGIME_COLOR[r] + '33', color: REGIME_COLOR[r] }}>
                  {r}
                </Tag>
                {r === current && <span style={{ marginLeft: 6, fontSize: 10, color: '#FFB74D' }}>◀ ACTIVE</span>}
              </td>
              {(['A', 'B', 'C'] as const).map(bank => {
                const v = REGIME_BANK_MATRIX[r][bank]
                return (
                  <td key={bank} style={{ textAlign: 'center', fontFamily: 'monospace' }}>
                    <span style={{
                      color: v > 1.05 ? '#4ade80' : v < 0.95 ? '#f43f5e' : '#fbbf24',
                      fontWeight: r === current ? 700 : 400,
                    }}>
                      ×{v.toFixed(2)}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </div>
  )
}

// ── Boost/suppress list ───────────────────────────────────────────────────────
function BoostList({ items, type }: { items: BoostEntry[]; type: 'boost' | 'suppress' }) {
  const color = type === 'boost' ? '#4ade80' : '#f97316'
  if (!items.length) return <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>None</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map(item => (
        <div key={item.algo} style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '6px 10px', borderRadius: 6,
          background: `${color}0d`,
          border: `1px solid ${color}22`,
        }}>
          <span style={{ color: BANK_COLOR[item.bank], fontFamily: 'monospace', fontSize: 11, flexShrink: 0 }}>
            {item.algo}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11 }}>{item.name}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              {item.reasons.join(' · ')}
            </div>
          </div>
          <span style={{ color, fontFamily: 'monospace', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
            ×{item.factor.toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AlgoWeights() {
  const council = useCouncil()
  const [regime, setRegime] = useState<Regime>('NEUTRAL')
  const [result, setResult] = useState<OptResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showMoe, setShowMoe] = useState(true)
  const [autoRun, setAutoRun] = useState(false)
  const [activeBank, setActiveBank] = useState<'ALL' | 'A' | 'B' | 'C'>('ALL')

  // Auto-detect regime from council data
  useEffect(() => {
    if (council.data?.regime) {
      const r = council.data.regime.toUpperCase() as Regime
      if (REGIME_OPTIONS.includes(r)) setRegime(r)
    }
  }, [council.data?.regime])

  const runOptimizer = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Build council votes from live data if available
      const votes: Record<string, number> = {}
      const scores: Record<string, number> = {}

      if (council.data?.algos) {
        for (const a of council.data.algos) {
          votes[a.id]  = a.vote ?? 0
          scores[a.id] = Math.abs(a.vote ?? 0) > 0 ? 0.75 : 0.5
        }
      }

      const body = {
        regime,
        council_votes:  votes,
        council_scores: scores,
      }

      const res = await fetch(`${DS}/v1/algo/weights/optimize/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`DS ${res.status}`)
      const data: OptResult = await res.json()
      if (!data.ok) throw new Error('Optimizer returned error')
      setResult(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [regime, council.data])

  // Auto-run when regime changes
  useEffect(() => {
    if (autoRun) runOptimizer()
  }, [regime, autoRun]) // eslint-disable-line react-hooks/exhaustive-deps

  const algos = result?.algo_detail ?? []
  const filtered = activeBank === 'ALL' ? algos : algos.filter(d => d.bank === activeBank)
  const maxW = Math.max(...algos.map(d => d.weight), 1 / 27)

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#FFB74D', letterSpacing: 1 }}>⚖ ALGO WEIGHTS</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Dynamic JEDI weight optimizer · MoE per strategy vote</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Regime selector */}
          {REGIME_OPTIONS.map(r => (
            <button key={r} onClick={() => setRegime(r)} style={{
              padding: '4px 12px', borderRadius: 4, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', border: `1px solid ${REGIME_COLOR[r]}`,
              background: regime === r ? REGIME_COLOR[r] + '33' : 'transparent',
              color: regime === r ? REGIME_COLOR[r] : 'var(--text-muted)',
            }}>{r}</button>
          ))}
          <Switch
            checked={autoRun}
            onChange={e => setAutoRun((e.target as HTMLInputElement).checked)}
            label="Auto-run"
            style={{ margin: 0, fontSize: 11 }}
          />
          <Button
            intent="warning"
            onClick={runOptimizer}
            loading={loading}
            icon="refresh"
            small
          >
            Run Optimizer
          </Button>
        </div>
      </div>

      {error && (
        <Callout intent="danger" title="Optimizer error" icon="error">
          {error} — ensure Django DS is running on :8800
        </Callout>
      )}

      {/* ── JEDI Comparison row ── */}
      {result && (
        <Card elevation={Elevation.ONE} style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
            JEDI SCORE COMPARISON
            <span style={{ marginLeft: 8, fontFamily: 'monospace', fontSize: 10 }}>
              method: {result.method}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <JediGauge value={result.equal_jedi}    label="Equal-Weight JEDI"    color="#64748b" />
            <JediGauge value={result.weighted_jedi} label="Optimized JEDI"       color="#FFB74D" />
            <JediGauge value={result.moe_jedi}       label="MoE Confidence JEDI"  color="#a78bfa" />
            {/* Delta */}
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>DELTA</div>
              <div style={{
                fontSize: 26, fontWeight: 800, fontFamily: 'monospace',
                color: result.jedi_delta > 0 ? '#4ade80' : result.jedi_delta < 0 ? '#f43f5e' : '#fbbf24',
              }}>
                {result.jedi_delta > 0 ? '+' : ''}{result.jedi_delta.toFixed(1)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10 }}>
                optimized vs equal
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── Main 2-col layout ── */}
      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0, flexWrap: 'wrap' }}>

        {/* ── Left: Weight bars ── */}
        <Card elevation={Elevation.ONE} style={{ flex: '1 1 400px', padding: 16, overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#FFB74D' }}>ALGO WEIGHTS</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {(['ALL', 'A', 'B', 'C'] as const).map(b => (
                <button key={b} onClick={() => setActiveBank(b)} style={{
                  padding: '2px 8px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
                  background: activeBank === b ? (b === 'ALL' ? '#FFB74D33' : BANK_COLOR[b] + '33') : 'transparent',
                  border: `1px solid ${b === 'ALL' ? '#FFB74D' : (BANK_COLOR[b] ?? '#555')}`,
                  color: b === 'ALL' ? '#FFB74D' : (BANK_COLOR[b] ?? 'var(--text-muted)'),
                }}>{b === 'ALL' ? 'ALL' : `${b} · ${BANK_LABEL[b]}`}</button>
              ))}
              <Switch checked={showMoe} onChange={e => setShowMoe((e.target as HTMLInputElement).checked)}
                label="MoE" style={{ margin: 0, fontSize: 10 }} />
            </div>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>
            <span>■ VOTE</span>
            <span style={{ marginLeft: 8 }}>ID</span>
            <span style={{ marginLeft: 'auto' }}>×FACTOR</span>
            <span>CONF%</span>
          </div>

          {!result && !loading && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
              Press "Run Optimizer" to compute weights
            </div>
          )}
          {loading && <Spinner size={32} style={{ margin: '40px auto' }} />}
          {filtered.map(d => (
            <AlgoBar key={d.id} d={d} maxW={maxW} showMoe={showMoe} />
          ))}
        </Card>

        {/* ── Right: Matrix + Boosts ── */}
        <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Regime matrix */}
          <Card elevation={Elevation.ONE} style={{ padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#22d3ee', marginBottom: 10 }}>
              REGIME × BANK MULTIPLIERS
            </div>
            <RegimeMatrix current={regime} />
            {result && (
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                {Object.entries(result.bank_multipliers).map(([bank, val]) => (
                  <div key={bank} style={{
                    flex: 1, padding: '6px 8px', borderRadius: 6, textAlign: 'center',
                    background: BANK_COLOR[bank] + '11',
                    border: `1px solid ${BANK_COLOR[bank]}33`,
                  }}>
                    <div style={{ fontSize: 10, color: BANK_COLOR[bank] }}>Bank {bank}</div>
                    <div style={{
                      fontSize: 18, fontWeight: 800, fontFamily: 'monospace',
                      color: (val as number) > 1.05 ? '#4ade80' : (val as number) < 0.95 ? '#f43f5e' : '#fbbf24',
                    }}>×{(val as number).toFixed(2)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Boosts */}
          {result && (
            <Card elevation={Elevation.ONE} style={{ padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', marginBottom: 8 }}>
                ↑ BOOSTED ALGOS
              </div>
              <BoostList items={result.boosts} type="boost" />
            </Card>
          )}

          {/* Suppressions */}
          {result && (
            <Card elevation={Elevation.ONE} style={{ padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f97316', marginBottom: 8 }}>
                ↓ SUPPRESSED ALGOS
              </div>
              <BoostList items={result.suppressions} type="suppress" />
            </Card>
          )}

          {/* Bank summary (live if result) */}
          {result && (() => {
            const byBank: Record<string, { count: number; avgW: number; totalContrib: number }> = {}
            for (const d of result.algo_detail) {
              if (!byBank[d.bank]) byBank[d.bank] = { count: 0, avgW: 0, totalContrib: 0 }
              byBank[d.bank].count++
              byBank[d.bank].avgW += d.weight
              byBank[d.bank].totalContrib += d.weighted_contrib
            }
            for (const b of Object.values(byBank)) {
              b.avgW = b.avgW / b.count
            }
            return (
              <Card elevation={Elevation.ONE} style={{ padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#FFB74D', marginBottom: 10 }}>
                  BANK CONTRIBUTION
                </div>
                {(['A', 'B', 'C'] as const).map(bank => {
                  const bb = byBank[bank]
                  if (!bb) return null
                  const totalW = result.algo_detail.reduce((s, d) => s + d.weight, 0)
                  const bankW = result.algo_detail.filter(d => d.bank === bank).reduce((s, d) => s + d.weight, 0)
                  const pct = (bankW / totalW) * 100
                  return (
                    <div key={bank} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                        <span style={{ color: BANK_COLOR[bank] }}>Bank {bank} — {BANK_LABEL[bank]}</span>
                        <span style={{ fontFamily: 'monospace' }}>{pct.toFixed(1)}%</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-dark)', overflow: 'hidden' }}>
                        <div style={{
                          width: `${pct}%`, height: '100%',
                          background: BANK_COLOR[bank], borderRadius: 3,
                          transition: 'width 0.5s',
                        }} />
                      </div>
                    </div>
                  )
                })}
              </Card>
            )
          })()}
        </div>
      </div>

      {/* ── Full algo table ── */}
      {result && (
        <Card elevation={Elevation.ONE} style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#FFB74D', marginBottom: 10 }}>
            FULL ALGO DETAIL
          </div>
          <div style={{ overflowX: 'auto' }}>
            <HTMLTable compact striped style={{ width: '100%', fontSize: 11 }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Bank</th>
                  <th>Name</th>
                  <th style={{ textAlign: 'right' }}>Vote</th>
                  <th style={{ textAlign: 'right' }}>Conf%</th>
                  <th style={{ textAlign: 'right' }}>Equal W</th>
                  <th style={{ textAlign: 'right' }}>Opt W</th>
                  <th style={{ textAlign: 'right' }}>MoE W</th>
                  <th style={{ textAlign: 'right' }}>×Factor</th>
                  <th>Reasons</th>
                </tr>
              </thead>
              <tbody>
                {result.algo_detail.map(d => (
                  <tr key={d.id}>
                    <td style={{ fontFamily: 'monospace', color: BANK_COLOR[d.bank] }}>{d.id}</td>
                    <td>
                      <Tag minimal style={{
                        background: BANK_COLOR[d.bank] + '22',
                        color: BANK_COLOR[d.bank], fontSize: 10,
                      }}>{d.bank}</Tag>
                    </td>
                    <td>{d.name}</td>
                    <td style={{
                      textAlign: 'right', fontFamily: 'monospace',
                      color: d.vote > 0 ? '#4ade80' : d.vote < 0 ? '#f43f5e' : 'var(--text-muted)',
                    }}>
                      {d.vote > 0 ? '+' : ''}{d.vote}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                      {(d.confidence * 100).toFixed(0)}%
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                      {(d.equal_weight * 100).toFixed(2)}%
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#FFB74D' }}>
                      {(d.weight * 100).toFixed(2)}%
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#a78bfa' }}>
                      {(d.moe_weight * 100).toFixed(2)}%
                    </td>
                    <td style={{
                      textAlign: 'right', fontFamily: 'monospace', fontWeight: 700,
                      color: d.factor > 1.05 ? '#4ade80' : d.factor < 0.95 ? '#f43f5e' : 'var(--text-muted)',
                    }}>
                      ×{d.factor.toFixed(3)}
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {d.reasons.join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </HTMLTable>
          </div>
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)' }}>
            Last computed: {new Date(result.timestamp).toLocaleTimeString()} · regime: {result.regime}
          </div>
        </Card>
      )}
    </div>
  )
}
