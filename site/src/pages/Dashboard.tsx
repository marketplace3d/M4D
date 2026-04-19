import React, { useMemo, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Card,
  HTMLTable,
  NonIdealState,
  Spinner,
  Tag,
  Intent,
  Elevation,
  Button,
  Callout,
} from '@blueprintjs/core'
import { useCouncil, useAlgoDay } from '../api/client'
import { PulseHero } from '../components/PulseHero'
import { CouncilMatrix } from '../components/CouncilMatrix'
import type { AlgoDayAsset, Regime } from '../types'

// ─── Legend Mini Widget ────────────────────────────────────────────────────────

const LEGEND_COLORS: Record<string, string> = {
  WN: '#f59e0b', MM: '#10b981', OR: '#3b82f6', SE: '#8b5cf6',
  RT: '#06b6d4', TF: '#f97316', DV: '#ec4899', WS: '#a3e635', DX: '#fbbf24',
}
const LEGEND_TRADER: Record<string, string> = {
  WN: 'Weinstein', MM: 'Minervini', OR: "O'Neil", SE: 'Stockbee',
  RT: 'Rayner', TF: 'TTrades', DV: 'Dragonfly', WS: 'Wyckoff', DX: 'Darvas',
}

interface LegendPick { symbol: string; composite: number; firing: string[]; count: number }

const LegendMini: React.FC = () => {
  const [picks, setPicks] = useState<LegendPick[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [asOf, setAsOf] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      // Scan top 20 liquid names — fast batch call
      const res = await fetch('/ds/v1/legend/scan/?top=8')
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setPicks(data.results ?? [])
      setAsOf(data.as_of ?? '')
      setLoaded(true)
    } catch {
      setLoaded(true)
    } finally {
      setLoading(false)
    }
  }

  if (!loaded) {
    return (
      <div style={{ padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: '#FFB74D', fontWeight: 700 }}>★</span>
          <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>
            Legend Stock Setups
          </span>
        </div>
        <Button small minimal icon="search" onClick={load} loading={loading} style={{ color: '#FFB74D' }}>
          Scan 40 Stocks
        </Button>
        <div style={{ fontSize: 10, color: '#334155', marginTop: 4 }}>
          Weinstein · Minervini · O'Neil · Stockbee · Rayner + 4 more
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '10px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#FFB74D', fontWeight: 700 }}>★</span>
          <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>Legend Stock Setups</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {asOf && <span style={{ fontSize: 9, color: '#334155' }}>{asOf}</span>}
          <Button small minimal icon="refresh" onClick={load} loading={loading} />
        </div>
      </div>

      {picks.length === 0 ? (
        <div style={{ fontSize: 11, color: '#334155' }}>No active setups found</div>
      ) : (
        picks.map(p => (
          <div key={p.symbol} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
          }}>
            <span style={{ fontWeight: 700, fontFamily: 'monospace', color: '#e2e8f0', width: 52, fontSize: 12 }}>
              {p.symbol}
            </span>
            <div style={{ flex: 1, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {p.firing.map(id => (
                <span key={id} style={{
                  fontSize: 8, padding: '1px 3px', borderRadius: 2,
                  background: (LEGEND_COLORS[id] ?? '#64748b') + '33',
                  color: LEGEND_COLORS[id] ?? '#64748b',
                  fontWeight: 700,
                }}>
                  {id}
                </span>
              ))}
            </div>
            <span style={{ fontSize: 10, color: '#fbbf24', fontFamily: 'monospace', width: 28, textAlign: 'right' }}>
              {p.count}/9
            </span>
          </div>
        ))
      )}
    </div>
  )
}

// ─── Regime Banner ─────────────────────────────────────────────────────────────

const RegimeBanner: React.FC<{ regime: Regime; score: number }> = ({ regime, score }) => {
  const cls = regime === 'BULL' ? 'bull' : regime === 'BEAR' ? 'bear' : 'neutral'
  const icon = regime === 'BULL' ? '↑' : regime === 'BEAR' ? '↓' : '→'
  const desc =
    regime === 'BULL'
      ? 'Bullish regime — majority algo alignment positive'
      : regime === 'BEAR'
      ? 'Bearish regime — majority algo alignment negative'
      : 'Neutral regime — mixed signals, reduce size'

  return (
    <div className={`regime-banner ${cls}`}>
      <span style={{ fontSize: 20 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 14 }}>MARKET REGIME: {regime}</div>
        <div style={{ fontSize: 11, fontWeight: 400, opacity: 0.8 }}>{desc}</div>
      </div>
      <div style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 18 }}>
        {score > 0 ? `+${score}` : score}
      </div>
    </div>
  )
}

// ─── Top Movers Table ─────────────────────────────────────────────────────────

const TopMoversTable: React.FC<{ assets: AlgoDayAsset[] }> = ({ assets }) => {
  const sorted = useMemo(
    () =>
      [...assets]
        .sort((a, b) => Math.abs(b.jedi_score) - Math.abs(a.jedi_score))
        .slice(0, 20),
    [assets]
  )

  if (assets.length === 0) {
    return (
      <NonIdealState
        icon="timeline-line-chart"
        title="No data"
        description="Waiting for algo-day data…"
      />
    )
  }

  return (
    <div className="scroll-panel">
      <HTMLTable
        compact
        striped={false}
        style={{ width: '100%', fontSize: 12 }}
      >
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Score</th>
            <th>Price</th>
            <th>Chg%</th>
            <th>L/S</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(asset => {
            const longCount = Object.values(asset.votes).filter(v => v === 1).length
            const shortCount = Object.values(asset.votes).filter(v => v === -1).length
            const chgCls =
              asset.change_pct > 0
                ? 'pnl-positive'
                : asset.change_pct < 0
                ? 'pnl-negative'
                : 'pnl-neutral'
            const scoreCls =
              asset.jedi_score > 30
                ? 'pnl-positive'
                : asset.jedi_score < -30
                ? 'pnl-negative'
                : 'text-gold'

            return (
              <tr key={asset.symbol}>
                <td>
                  <span style={{ fontWeight: 700, fontFamily: 'monospace', color: '#fff' }}>
                    {asset.symbol}
                  </span>
                </td>
                <td>
                  <span className={`mono ${scoreCls}`} style={{ fontWeight: 700 }}>
                    {asset.jedi_score > 0 ? `+${asset.jedi_score}` : asset.jedi_score}
                  </span>
                </td>
                <td className="mono">${asset.price.toFixed(2)}</td>
                <td className={`mono ${chgCls}`}>
                  {asset.change_pct > 0 ? '+' : ''}
                  {asset.change_pct.toFixed(2)}%
                </td>
                <td>
                  <span className="pnl-positive">{longCount}</span>
                  {'/'}
                  <span className="pnl-negative">{shortCount}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </HTMLTable>
    </div>
  )
}

// ─── Mini stats strip ─────────────────────────────────────────────────────────

const StatsStrip: React.FC<{
  totalLong: number
  totalShort: number
  jediScore: number
}> = ({ totalLong, totalShort, jediScore }) => {
  const flat = 27 - totalLong - totalShort
  const bullPct = ((totalLong / 27) * 100).toFixed(0)
  const bearPct = ((totalShort / 27) * 100).toFixed(0)

  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        padding: '8px 16px',
        background: 'rgba(255,255,255,0.03)',
        borderRadius: 6,
        flexWrap: 'wrap',
      }}
    >
      {[
        { label: 'Long Algos', value: `${totalLong} (${bullPct}%)`, color: '#4ade80' },
        { label: 'Short Algos', value: `${totalShort} (${bearPct}%)`, color: '#f43f5e' },
        { label: 'Flat Algos', value: String(flat), color: '#8f99a8' },
        { label: 'Total Council', value: '27', color: '#FFB74D' },
      ].map(stat => (
        <div key={stat.label} style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: stat.color,
              fontFamily: 'monospace',
            }}
          >
            {stat.value}
          </div>
          <div style={{ fontSize: 10, color: '#8f99a8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── How / when algos run · sizing · safety (dashboard explainer) ─────────────

const AlgoOpsExplainer: React.FC<{
  asOf: string
  regime: Regime
  totalLong: number
  totalShort: number
}> = ({ asOf, regime, totalLong, totalShort }) => {
  const activeLong = totalLong
  const activeShort = totalShort
  const flat = 27 - activeLong - activeShort

  return (
    <Card
      elevation={Elevation.ONE}
      style={{
        background: '#131820',
        border: '1px solid rgba(255,183,77,0.12)',
        padding: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#FFB74D', fontFamily: 'monospace', letterSpacing: 1 }}>
          HOW ALGOS “TRADE” AND SAFETY
        </div>
        <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>
          algo-day as of {asOf ? new Date(asOf).toLocaleString() : '—'}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 10 }}>
        <Callout intent="primary" style={{ fontSize: 11, background: '#0a1628' }}>
          <strong>Cadence</strong> — Rust engine runs on <Tag minimal intent="warning">~5m</Tag> Binance bars. Each cycle all{' '}
          <strong>27 algos</strong> vote per asset; JEDI + regime update. That is the <em>research signal lattice</em>, not
          a broker fill. Charts/matrix stay in sync with the last completed bar close (no intrabar HFT path here).
        </Callout>
        <Callout intent="success" style={{ fontSize: 11, background: '#0a1628' }}>
          <strong>When they “fire”</strong> — Long/short columns in Top Movers and the council matrix count valid ± votes this
          bar. <Tag minimal>{activeLong}</Tag> long ·<Tag minimal intent="danger">{activeShort}</Tag> short ·{' '}
          <Tag minimal>{flat}</Tag> flat. <strong>Regime</strong> now:{' '}
          <Tag minimal intent={regime === 'NEUTRAL' ? Intent.NONE : Intent.WARNING}>{regime}</Tag> (conditions sizing emphasis on{' '}
          <Link to="/weights" style={{ color: '#FFB74D' }}>Weights</Link> / rank).
        </Callout>
        <Callout intent="warning" style={{ fontSize: 11, background: '#0a1628' }}>
          <strong>Kelly-style sizing</strong> — Exposed in{' '}
          <Link to="/hedge" style={{ color: '#FFB74D' }}>
            Hedge
          </Link>{' '}
          (JEDI-scaled allocation) and DS <code>jedi_signal</code> fractional-Kelly (conviction × base, clamped). The raw council
          stream is <em>votes + strength</em>; execution stacks MoE / Kelly / risk gate before size hits a route.
        </Callout>
        <Callout intent="danger" style={{ fontSize: 11, background: '#0a1628' }}>
          <strong>Hedge-fund safety stack</strong> — DS <code>risk_gate.py</code>: daily halt (~2% port), per-name cap (~5%), pod
          kill (~3% DD), correlation crowd check, min alpha/confidence, HIGH_VOL_NEWS filter. Wire every live path through the
          gate per <code>AGENT/AGENTS.md</code>.
        </Callout>
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: '#94a3ab', lineHeight: 1.5 }}>
        <strong>Self-tune and regime</strong> — <Link to="/rank">Rank</Link> walks IS/OOS Sharpe across assets;{' '}
        <Link to="/weights">Weights</Link> MoE mixes banks by regime; <Link to="/mrt">MRT</Link> runs a parallel micro-signal
        library + vol-tile snapshot (:3340, start via <code>./gort.sh</code>). Prefer promoting algos only after walk-forward,
        not a single-window peak.
      </div>
    </Card>
  )
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

export const Dashboard: React.FC = () => {
  const { data: council, isLoading: councilLoading, isError: councilError } = useCouncil()
  const { data: algoDay, isLoading: dayLoading } = useAlgoDay()

  if (councilLoading) {
    return (
      <div className="flex-center" style={{ height: '100%' }}>
        <Spinner size={60} />
      </div>
    )
  }

  if (councilError) {
    return (
      <div className="flex-center" style={{ height: '100%' }}>
        <NonIdealState
          icon="error"
          title="Cannot connect to backend"
          description="Make sure the Rust Axum server is running on http://localhost:3300"
          action={
            <Tag intent={Intent.DANGER} large>
              localhost:3300 unreachable
            </Tag>
          }
        />
      </div>
    )
  }

  const score = council?.jedi_score ?? 0
  const regime = council?.regime ?? 'NEUTRAL'
  const algos = council?.algos ?? []
  const assets = algoDay?.assets ?? []

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 12,
        overflow: 'auto',
        minHeight: 0,
      }}
    >
      {/* Stats + main grid: at least 50% viewport height so Pulse/Council/Movers aren’t crushed */}
      <div
        style={{
          flex: '1 0 auto',
          minHeight: '50vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <StatsStrip
          totalLong={council?.total_long ?? 0}
          totalShort={council?.total_short ?? 0}
          jediScore={score}
        />

        <div className="dashboard-grid" style={{ flex: 1, minHeight: 0 }}>
        {/* Left: PulseHero */}
        <Card elevation={Elevation.TWO} className="dashboard-left" style={{ padding: 0, overflow: 'hidden' }}>
          <PulseHero
            score={score}
            regime={regime}
            totalLong={council?.total_long ?? 0}
            totalShort={council?.total_short ?? 0}
          />
        </Card>

        {/* Center: Council Matrix */}
        <Card elevation={Elevation.TWO} className="dashboard-center" style={{ padding: 0, overflow: 'hidden' }}>
          <CouncilMatrix algos={algos} />
        </Card>

        {/* Right: Top Movers + Legend Setups */}
        <Card elevation={Elevation.TWO} className="dashboard-right" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 12px 4px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="section-title">Top Movers by Jedi Score</div>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {dayLoading ? (
              <div className="flex-center" style={{ height: 200 }}>
                <Spinner size={30} />
              </div>
            ) : (
              <TopMoversTable assets={assets} />
            )}
          </div>
          {/* Legend mini-scanner */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
            <LegendMini />
          </div>
        </Card>
        </div>
      </div>

      {/* Bottom: Regime Banner */}
      <div className="dashboard-bottom">
        <RegimeBanner regime={regime} score={score} />
      </div>

      <AlgoOpsExplainer
        asOf={algoDay?.timestamp ?? ''}
        regime={regime}
        totalLong={council?.total_long ?? 0}
        totalShort={council?.total_short ?? 0}
      />
    </div>
  )
}
