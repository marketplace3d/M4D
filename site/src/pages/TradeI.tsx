/**
 * TRADEI — Trade Ideas Engine
 *
 * Two sources combined:
 *   1. LIVE — 500-asset engine scan → algo council vote → ranked opportunities
 *   2. AI   — MAXCOGVIZ synthesised trade ideas (Grok + models)
 *
 * Inspired by Trade Ideas concept: scan → rank → act.
 * Pattern: when you see it in the table, you can code it.
 */
import { useState, useMemo, useCallback, useEffect } from 'react'
import { Card, Elevation, Button, Spinner, HTMLTable, Tag } from '@blueprintjs/core'
import { useCouncil, useAlgoDay } from '../api/client'

// ── Types ──────────────────────────────────────────────────────────────────────
interface AITradeIdea {
  asset: string
  direction: 'LONG' | 'SHORT'
  entry_condition: string
  target_pct: number
  stop_pct: number
  conviction: number
  timeframe: string
}

interface LiveOpportunity {
  symbol: string
  jedi_score: number
  direction: 'LONG' | 'SHORT' | 'FLAT'
  bank_a: number   // BREAK algo votes
  bank_b: number   // TREND algo votes
  bank_c: number   // MOMENTUM algo votes
  aligned: boolean // all 3 banks same direction
  rr: number       // estimated reward:risk
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const DIR_COLOR = { LONG: '#4ade80', SHORT: '#f43f5e', FLAT: '#64748b' }
const TF_COLOR: Record<string, string> = {
  '1d': '#FFB74D', '1w': '#22d3ee', '1m': '#a78bfa',
}

function ConvBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ width: 60, height: 6, background: 'rgba(255,255,255,0.06)',
      borderRadius: 3, overflow: 'hidden', display: 'inline-block', verticalAlign: 'middle' }}>
      <div style={{
        width: `${Math.min(100, pct)}%`, height: '100%',
        background: color, borderRadius: 3,
        transition: 'width 0.4s',
      }} />
    </div>
  )
}

// ── AI Ideas table ────────────────────────────────────────────────────────────
function AIIdeasTable({ ideas, loading, onFire }: {
  ideas: AITradeIdea[]
  loading: boolean
  onFire: () => void
}) {
  return (
    <Card elevation={Elevation.ONE} style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#FFB74D', letterSpacing: 1 }}>
          ◈ AI TRADE IDEAS
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          Grok MAXCOGVIZ synthesis
        </span>
        <Button
          small minimal intent="warning" icon="refresh"
          loading={loading} onClick={onFire}
          style={{ marginLeft: 'auto' }}
        >
          Fire MAXCOGVIZ
        </Button>
      </div>

      {ideas.length === 0 && !loading && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
          Press "Fire MAXCOGVIZ" to generate AI trade ideas from 12-dimensional analysis
        </div>
      )}
      {loading && <Spinner size={24} style={{ margin: '20px auto' }} />}

      {ideas.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <HTMLTable compact style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Dir</th>
                <th style={{ minWidth: 180 }}>Entry Condition</th>
                <th style={{ textAlign: 'right' }}>Target</th>
                <th style={{ textAlign: 'right' }}>Stop</th>
                <th style={{ textAlign: 'right' }}>R:R</th>
                <th>Conv</th>
                <th>TF</th>
              </tr>
            </thead>
            <tbody>
              {ideas.map((t, i) => {
                const col = DIR_COLOR[t.direction]
                const rr  = t.stop_pct > 0 ? (t.target_pct / t.stop_pct).toFixed(1) : '—'
                const tfc = TF_COLOR[t.timeframe] ?? '#64748b'
                return (
                  <tr key={i}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, color: '#FFB74D' }}>
                      {t.asset.replace('USDT', '')}
                    </td>
                    <td>
                      <Tag minimal style={{
                        background: col + '22', color: col,
                        fontWeight: 700, fontSize: 10,
                      }}>{t.direction}</Tag>
                    </td>
                    <td style={{ color: '#94a3b8', fontSize: 11 }}>{t.entry_condition}</td>
                    <td style={{ textAlign: 'right', color: '#4ade80',
                      fontFamily: 'monospace', fontWeight: 700 }}>
                      +{t.target_pct.toFixed(1)}%
                    </td>
                    <td style={{ textAlign: 'right', color: '#f43f5e',
                      fontFamily: 'monospace' }}>
                      -{t.stop_pct.toFixed(1)}%
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace',
                      color: parseFloat(rr) >= 2 ? '#4ade80' : '#fbbf24' }}>
                      {rr}×
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ConvBar pct={t.conviction} color={col} />
                        <span style={{ fontSize: 10, fontFamily: 'monospace',
                          color: col }}>{t.conviction}%</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3,
                        background: tfc + '22', color: tfc }}>{t.timeframe}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </HTMLTable>
        </div>
      )}
    </Card>
  )
}

// ── Live scan opportunities ───────────────────────────────────────────────────
function LiveScanTable({ opps, regime }: { opps: LiveOpportunity[]; regime: string }) {
  const [sortKey, setSortKey] = useState<'jedi' | 'rr' | 'aligned'>('jedi')
  const [dirFilter, setDirFilter] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL')
  const [alignedOnly, setAlignedOnly] = useState(false)

  const sorted = useMemo(() => {
    let rows = [...opps].filter(o => o.direction !== 'FLAT')
    if (dirFilter !== 'ALL')  rows = rows.filter(o => o.direction === dirFilter)
    if (alignedOnly)          rows = rows.filter(o => o.aligned)
    if (sortKey === 'jedi')   rows.sort((a, b) => Math.abs(b.jedi_score) - Math.abs(a.jedi_score))
    if (sortKey === 'rr')     rows.sort((a, b) => b.rr - a.rr)
    if (sortKey === 'aligned')rows.sort((a, b) => Number(b.aligned) - Number(a.aligned))
    return rows.slice(0, 50)
  }, [opps, dirFilter, alignedOnly, sortKey])

  const longCount  = opps.filter(o => o.direction === 'LONG').length
  const shortCount = opps.filter(o => o.direction === 'SHORT').length
  const alignCount = opps.filter(o => o.aligned).length

  return (
    <Card elevation={Elevation.ONE} style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#22d3ee', letterSpacing: 1 }}>
          ▦ LIVE SCAN
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          500-asset engine · 5m refresh · regime: <b style={{ color: '#FFB74D' }}>{regime}</b>
        </span>

        {/* Stats */}
        <span style={{ fontSize: 10, color: '#4ade80' }}>↑{longCount}L</span>
        <span style={{ fontSize: 10, color: '#f43f5e' }}>↓{shortCount}S</span>
        <span style={{ fontSize: 10, color: '#FFB74D' }}>⬡{alignCount} aligned</span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {/* Dir filter */}
          {(['ALL', 'LONG', 'SHORT'] as const).map(d => (
            <button key={d} onClick={() => setDirFilter(d)} style={{
              padding: '2px 8px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
              background: dirFilter === d ? (d === 'LONG' ? 'rgba(74,222,128,0.15)' : d === 'SHORT' ? 'rgba(244,63,94,0.15)' : 'rgba(255,183,77,0.12)') : 'transparent',
              border: `1px solid ${dirFilter === d ? (d === 'LONG' ? '#4ade80' : d === 'SHORT' ? '#f43f5e' : '#FFB74D') : 'rgba(255,255,255,0.1)'}`,
              color: d === 'LONG' ? '#4ade80' : d === 'SHORT' ? '#f43f5e' : '#FFB74D',
            }}>{d}</button>
          ))}
          <button onClick={() => setAlignedOnly(v => !v)} style={{
            padding: '2px 8px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
            background: alignedOnly ? 'rgba(34,211,238,0.15)' : 'transparent',
            border: `1px solid ${alignedOnly ? '#22d3ee' : 'rgba(255,255,255,0.1)'}`,
            color: alignedOnly ? '#22d3ee' : 'var(--text-muted)',
          }}>⬡ Aligned only</button>

          {/* Sort */}
          {(['jedi', 'rr', 'aligned'] as const).map(s => (
            <button key={s} onClick={() => setSortKey(s)} style={{
              padding: '2px 8px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
              background: sortKey === s ? 'rgba(255,255,255,0.07)' : 'transparent',
              border: `1px solid ${sortKey === s ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)'}`,
              color: sortKey === s ? '#e2e8f0' : 'var(--text-muted)',
            }}>{s}</button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', padding: '20px 0' }}>
          No opportunities match filter
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <HTMLTable compact striped style={{ width: '100%', fontSize: 11 }}>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Dir</th>
                <th style={{ textAlign: 'right' }}>JEDI</th>
                <th style={{ textAlign: 'center', color: '#FFB74D' }}>A BREAK</th>
                <th style={{ textAlign: 'center', color: '#22d3ee' }}>B TREND</th>
                <th style={{ textAlign: 'center', color: '#a78bfa' }}>C MOM</th>
                <th>Banks</th>
                <th style={{ textAlign: 'right' }}>Score bar</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(o => {
                const col  = DIR_COLOR[o.direction]
                const absJ = Math.abs(o.jedi_score)
                const pct  = Math.min(100, (absJ / 27) * 100)
                return (
                  <tr key={o.symbol}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 700, color: '#e2e8f0' }}>
                      {o.symbol.replace('USDT', '')}
                    </td>
                    <td>
                      <Tag minimal style={{
                        background: col + '22', color: col,
                        fontWeight: 700, fontSize: 9, padding: '1px 5px',
                      }}>{o.direction}</Tag>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700,
                      color: o.jedi_score > 0 ? '#4ade80' : '#f43f5e' }}>
                      {o.jedi_score > 0 ? '+' : ''}{o.jedi_score.toFixed(0)}
                    </td>
                    <td style={{ textAlign: 'center', fontFamily: 'monospace',
                      color: o.bank_a > 0 ? '#4ade80' : o.bank_a < 0 ? '#f43f5e' : '#475569' }}>
                      {o.bank_a > 0 ? `+${o.bank_a}` : o.bank_a}
                    </td>
                    <td style={{ textAlign: 'center', fontFamily: 'monospace',
                      color: o.bank_b > 0 ? '#4ade80' : o.bank_b < 0 ? '#f43f5e' : '#475569' }}>
                      {o.bank_b > 0 ? `+${o.bank_b}` : o.bank_b}
                    </td>
                    <td style={{ textAlign: 'center', fontFamily: 'monospace',
                      color: o.bank_c > 0 ? '#4ade80' : o.bank_c < 0 ? '#f43f5e' : '#475569' }}>
                      {o.bank_c > 0 ? `+${o.bank_c}` : o.bank_c}
                    </td>
                    <td>
                      {o.aligned ? (
                        <span style={{ fontSize: 9, color: '#22d3ee', fontWeight: 700 }}>⬡ ALL</span>
                      ) : (
                        <span style={{ fontSize: 9, color: '#475569' }}>split</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <ConvBar pct={pct} color={col} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </HTMLTable>
        </div>
      )}
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
const MCV_KEY = 'm3d.maxcogviz.last'

// Bank membership for the 27 DS algos
const BANK_A_IDS = new Set(['DON_BO','BB_BREAK','KC_BREAK','SQZPOP','ATR_EXP','VOL_BO','CONSOL_BO','NEW_HIGH','RANGE_BO'])
const BANK_B_IDS = new Set(['EMA_CROSS','EMA_STACK','MACD_CROSS','SUPERTREND','ADX_TREND','GOLDEN','PSAR','PULLBACK','TREND_SMA'])
const BANK_C_IDS = new Set(['RSI_CROSS','RSI_STRONG','ROC_MOM','VOL_SURGE','CONSEC_BULL','OBV_TREND','STOCH_CROSS','MFI_CROSS','CMF_POS'])

export default function TradeI() {
  const council  = useCouncil()
  const algoDay  = useAlgoDay()

  const [aiIdeas, setAiIdeas]   = useState<AITradeIdea[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [lastMcvTs, setLastMcvTs] = useState<string>('')

  const regime  = council.data?.regime ?? 'NEUTRAL'
  const jedi    = council.data?.jedi_score ?? 0
  const algos   = council.data?.algos ?? []
  const assets  = algoDay.data?.assets ?? []

  // Load last MAXCOGVIZ result from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MCV_KEY)
      if (saved) {
        const d = JSON.parse(saved)
        const ideas = d?.synthesised?.trade_ideas ?? []
        if (ideas.length) {
          setAiIdeas(ideas)
          setLastMcvTs(d?.synthesised?.timestamp ?? '')
        }
      }
    } catch {}
  }, [])

  // Build per-asset opportunities from live algo-day data
  const liveOpps: LiveOpportunity[] = useMemo(() => {
    if (!assets.length || !algos.length) return []

    // Build vote map per algo
    const voteMap: Record<string, number> = {}
    for (const a of algos) voteMap[a.id] = a.vote ?? 0

    return assets
      .filter((asset: any) => Math.abs(asset.jedi_score ?? 0) >= 3)
      .map((asset: any) => {
        // Per-bank vote sums (rough proxy using asset jedi and algo votes)
        // In full implementation these would be per-asset per-algo
        const jediScore = asset.jedi_score ?? 0
        const dir: 'LONG' | 'SHORT' | 'FLAT' =
          jediScore > 2 ? 'LONG' : jediScore < -2 ? 'SHORT' : 'FLAT'

        // Approximate bank votes from council (same for all assets in this data model)
        const bankA = Array.from(BANK_A_IDS).reduce((s, id) => s + (voteMap[id] ?? 0), 0)
        const bankB = Array.from(BANK_B_IDS).reduce((s, id) => s + (voteMap[id] ?? 0), 0)
        const bankC = Array.from(BANK_C_IDS).reduce((s, id) => s + (voteMap[id] ?? 0), 0)

        const aligned = (bankA > 0 && bankB > 0 && bankC > 0) ||
                        (bankA < 0 && bankB < 0 && bankC < 0)

        return {
          symbol:     asset.symbol,
          jedi_score: jediScore,
          direction:  dir,
          bank_a:     bankA,
          bank_b:     bankB,
          bank_c:     bankC,
          aligned,
          rr: 2.0,  // default; will be dynamic when per-asset ATR available
        }
      })
      .filter((o: LiveOpportunity) => o.direction !== 'FLAT')
  }, [assets, algos])

  // Fire MAXCOGVIZ just for trade ideas (single model, fast)
  const fireMcv = useCallback(async () => {
    setAiLoading(true)
    try {
      const councilVotes: Record<string, number> = {}
      for (const a of algos) councilVotes[a.id] = a.vote ?? 0

      const res = await fetch('/ds/v1/ai/maxcogviz/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jedi, regime,
          models: ['grok'],
          council_votes: councilVotes,
          assets_snapshot: assets
            .slice(0, 20)
            .map((a: any) => ({ symbol: a.symbol, jedi_score: a.jedi_score ?? 0 })),
        }),
      })
      const data = await res.json()
      if (data.ok) {
        const ideas = data.synthesised?.trade_ideas ?? []
        setAiIdeas(ideas)
        setLastMcvTs(data.synthesised?.timestamp ?? new Date().toISOString())
        try { localStorage.setItem(MCV_KEY, JSON.stringify(data)) } catch {}
      }
    } catch { /* ignore */ } finally {
      setAiLoading(false)
    }
  }, [jedi, regime, algos, assets])

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16,
      background: 'var(--bg-dark)', color: '#e2e8f0' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#FFB74D', letterSpacing: 2 }}>
            Ι TRADEI
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Live scan · AI synthesis · rank · act
          </div>
        </div>

        {/* Live state */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
            <span style={{ color: 'var(--text-muted)' }}>JEDI </span>
            <span style={{ color: jedi > 0 ? '#4ade80' : jedi < 0 ? '#f43f5e' : '#fbbf24',
              fontWeight: 700 }}>
              {jedi > 0 ? '+' : ''}{jedi}
            </span>
          </div>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, fontWeight: 700,
            background: regime === 'BULL' ? 'rgba(74,222,128,0.12)' : regime === 'BEAR' ? 'rgba(244,63,94,0.12)' : 'rgba(251,191,36,0.12)',
            color: regime === 'BULL' ? '#4ade80' : regime === 'BEAR' ? '#f43f5e' : '#fbbf24',
          }}>{regime}</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {liveOpps.length} opp{liveOpps.length !== 1 ? 's' : ''} live
          </span>
          {lastMcvTs && (
            <span style={{ fontSize: 9, color: '#1e3a5f', fontFamily: 'monospace' }}>
              AI: {lastMcvTs.slice(11, 16)} UTC
            </span>
          )}
        </div>
      </div>

      {/* AI Ideas */}
      <AIIdeasTable ideas={aiIdeas} loading={aiLoading} onFire={fireMcv} />

      {/* Live scan */}
      {(council.isLoading || algoDay.isLoading) ? (
        <Spinner size={32} style={{ margin: '40px auto' }} />
      ) : (
        <LiveScanTable opps={liveOpps} regime={regime} />
      )}
    </div>
  )
}
