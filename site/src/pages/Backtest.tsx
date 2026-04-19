import { useState, useMemo } from 'react'
import {
  Button, Card, Elevation, FormGroup, InputGroup,
  HTMLSelect, Tag, Spinner, Intent, Callout, Tabs, Tab,
  HTMLTable, Tooltip, Icon,
} from '@blueprintjs/core'
import {
  useDsAlgos,
  useRunCryptoBacktest,
  useRunOptimize,
  type CryptoAlgoMeta,
  type CryptoBacktestResult,
  type OptResult,
  type OptRanking,
} from '../api/client'

// ── constants ─────────────────────────────────────────────────────────────────

const BANK_COLORS: Record<string, string> = {
  A: '#f97316', // orange — BREAK
  B: '#22d3ee', // cyan   — TREND
  C: '#a78bfa', // purple — MOMENTUM
}

const CRYPTO_ASSETS = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOGE',
  'LINK', 'DOT', 'MATIC', 'UNI', 'ATOM', 'LTC', 'NEAR',
]

// ── SVG equity curve ──────────────────────────────────────────────────────────

function EquityChart({ curve }: { curve: Array<{ t: string; v: number }> }) {
  if (!curve.length) return null

  const W = 800
  const H = 200
  const PAD = { top: 16, right: 16, bottom: 28, left: 64 }

  const values = curve.map(d => d.v)
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const range = maxV - minV || 1

  const scaleX = (i: number) =>
    PAD.left + (i / (curve.length - 1)) * (W - PAD.left - PAD.right)
  const scaleY = (v: number) =>
    PAD.top + (1 - (v - minV) / range) * (H - PAD.top - PAD.bottom)

  const pathD = curve
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(1)},${scaleY(d.v).toFixed(1)}`)
    .join(' ')

  const fillD = `${pathD} L${scaleX(curve.length - 1)},${scaleY(minV)} L${scaleX(0)},${scaleY(minV)} Z`

  const startV = values[0]
  const endV = values[values.length - 1]
  const isProfit = endV >= startV
  const lineColor = isProfit ? '#4ade80' : '#f87171'
  const fillColor = isProfit ? '#4ade8022' : '#f8717122'

  const nTicks = 4
  const yTicks = Array.from({ length: nTicks + 1 }, (_, i) => {
    const v = minV + (range * i) / nTicks
    return { y: scaleY(v), label: v.toFixed(0) }
  })

  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const i = Math.round(f * (curve.length - 1))
    return { x: scaleX(i), label: curve[i].t.slice(0, 7) }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }}>
      <path d={fillD} fill={fillColor} />
      {yTicks.map(t => (
        <g key={t.label}>
          <line x1={PAD.left} y1={t.y} x2={W - PAD.right} y2={t.y}
            stroke="#334155" strokeWidth={0.5} strokeDasharray="4,4" />
          <text x={PAD.left - 6} y={t.y + 4} fill="#94a3b8"
            fontSize={10} textAnchor="end">${t.label}</text>
        </g>
      ))}
      <line x1={PAD.left} y1={scaleY(startV)} x2={W - PAD.right} y2={scaleY(startV)}
        stroke="#475569" strokeWidth={1} strokeDasharray="2,4" />
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth={2} />
      {xTicks.map(t => (
        <text key={t.label} x={t.x} y={H - 4} fill="#64748b"
          fontSize={10} textAnchor="middle">{t.label}</text>
      ))}
    </svg>
  )
}

// ── SVG trade chart — price line with entry/exit markers ──────────────────────

function TradeChart({
  trades,
}: {
  curve?: Array<{ t: string; v: number }>
  trades: CryptoBacktestResult['trades']
}) {
  if (!trades.length) return null

  const W = 800
  const H = 180
  const PAD = { top: 16, right: 16, bottom: 28, left: 64 }

  // Build a continuous timeline from trade entry/exits
  // We reconstruct approximate price from entry/exit prices across time
  type Pt = { t: string; p: number }
  const pts: Pt[] = []
  for (const tr of trades) {
    pts.push({ t: tr.entry_time, p: tr.entry_price })
    pts.push({ t: tr.exit_time, p: tr.exit_price })
  }
  pts.sort((a, b) => a.t.localeCompare(b.t))

  // Deduplicate by time
  const seen = new Set<string>()
  const uniq = pts.filter(p => { if (seen.has(p.t)) return false; seen.add(p.t); return true })
  if (uniq.length < 2) return null

  const prices = uniq.map(p => p.p)
  const minP = Math.min(...prices)
  const maxP = Math.max(...prices)
  const rangeP = maxP - minP || 1

  const scaleX = (i: number) =>
    PAD.left + (i / (uniq.length - 1)) * (W - PAD.left - PAD.right)
  const scaleY = (p: number) =>
    PAD.top + (1 - (p - minP) / rangeP) * (H - PAD.top - PAD.bottom)

  // Map date string → x pixel (via index in uniq)
  const dateToX = (d: string): number => {
    const idx = uniq.findIndex(p => p.t === d)
    if (idx >= 0) return scaleX(idx)
    // interpolate: find nearest index
    const sorted = uniq.map((p, i) => ({ t: p.t, i }))
    for (let i = 0; i < sorted.length - 1; i++) {
      if (d >= sorted[i].t && d <= sorted[i + 1].t) {
        const frac = (d.localeCompare(sorted[i].t)) / (sorted[i + 1].t.localeCompare(sorted[i].t))
        return scaleX(sorted[i].i + frac)
      }
    }
    return scaleX(0)
  }

  const pathD = uniq
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(1)},${scaleY(p.p).toFixed(1)}`)
    .join(' ')

  const nTicks = 3
  const yTicks = Array.from({ length: nTicks + 1 }, (_, i) => {
    const p = minP + (rangeP * i) / nTicks
    return { y: scaleY(p), label: p > 1000 ? p.toFixed(0) : p.toFixed(2) }
  })

  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const i = Math.round(f * (uniq.length - 1))
    return { x: scaleX(i), label: uniq[i].t.slice(0, 7) }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }}>
      {/* Grid */}
      {yTicks.map(t => (
        <g key={t.label}>
          <line x1={PAD.left} y1={t.y} x2={W - PAD.right} y2={t.y}
            stroke="#1e293b" strokeWidth={0.5} strokeDasharray="4,4" />
          <text x={PAD.left - 6} y={t.y + 4} fill="#475569"
            fontSize={10} textAnchor="end">{t.label}</text>
        </g>
      ))}
      {/* Price line */}
      <path d={pathD} fill="none" stroke="#475569" strokeWidth={1.5} />
      {/* Trade segments + markers */}
      {trades.map((tr, i) => {
        const x1 = dateToX(tr.entry_time)
        const y1 = scaleY(tr.entry_price)
        const x2 = dateToX(tr.exit_time)
        const y2 = scaleY(tr.exit_price)
        const win = tr.pnl >= 0
        const col = win ? '#4ade80' : '#f87171'
        return (
          <g key={i}>
            {/* Trade line */}
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={col} strokeWidth={1.5} strokeDasharray="3,2" opacity={0.7} />
            {/* Entry: triangle up */}
            <polygon
              points={`${x1},${y1 - 8} ${x1 - 5},${y1} ${x1 + 5},${y1}`}
              fill="#4ade80" opacity={0.9}
            />
            {/* Exit: triangle down */}
            <polygon
              points={`${x2},${y2 + 8} ${x2 - 5},${y2} ${x2 + 5},${y2}`}
              fill={win ? '#4ade80' : '#f87171'} opacity={0.9}
            />
          </g>
        )
      })}
      {/* X labels */}
      {xTicks.map(t => (
        <text key={t.label} x={t.x} y={H - 4} fill="#334155"
          fontSize={10} textAnchor="middle">{t.label}</text>
      ))}
      {/* Legend */}
      <polygon points="16,12 11,20 21,20" fill="#4ade80" />
      <text x={24} y={19} fill="#4ade80" fontSize={9}>Entry</text>
      <polygon points="56,20 51,12 61,12" fill="#f87171" />
      <text x={64} y={19} fill="#f87171" fontSize={9}>Exit (loss)</text>
      <polygon points="120,20 115,12 125,12" fill="#4ade80" />
      <text x={128} y={19} fill="#4ade80" fontSize={9}>Exit (win)</text>
    </svg>
  )
}

// ── stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, intent }: {
  label: string; value: string; sub?: string; intent?: Intent
}) {
  const intentColor: Record<string, string> = {
    success: '#4ade80',
    danger:  '#f87171',
    warning: '#fbbf24',
    none:    '#e2e8f0',
  }
  const color = intentColor[intent ?? 'none']
  return (
    <Card elevation={Elevation.ONE} style={{ textAlign: 'center', padding: '12px 16px', flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{sub}</div>}
    </Card>
  )
}

// ── param editor ──────────────────────────────────────────────────────────────

function ParamEditor({
  grid, params, onChange,
}: {
  grid: Record<string, number[]>
  params: Record<string, number>
  onChange: (params: Record<string, number>) => void
}) {
  if (!Object.keys(grid).length) return null
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
      {Object.entries(grid).map(([key, values]) => (
        <FormGroup key={key} label={key} style={{ margin: 0 }}>
          <HTMLSelect
            value={params[key] ?? values[0]}
            onChange={e => onChange({ ...params, [key]: Number(e.target.value) })}
            style={{ width: 80 }}
          >
            {values.map(v => <option key={v} value={v}>{v}</option>)}
          </HTMLSelect>
        </FormGroup>
      ))}
    </div>
  )
}

// ── opt ranking table ─────────────────────────────────────────────────────────

function OptTable({ result }: { result: OptResult }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <Tag intent="primary">{result.n_combos_tested} combos tested</Tag>
        <Tag intent="none">IS: {result.start} → {result.is_end}</Tag>
        <Tag intent="warning">OOS: {result.oos_start} → {result.end}</Tag>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <HTMLTable compact striped style={{ width: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th>#</th>
              <th>Params</th>
              <th>IS Return%</th>
              <th>IS Sharpe</th>
              <th>IS Win%</th>
              <th>IS Trades</th>
              <th style={{ borderLeft: '2px solid #334155' }}>OOS Return%</th>
              <th>OOS Sharpe</th>
              <th>OOS Win%</th>
              <th>Decay</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {result.ranking.map((r: OptRanking, i: number) => {
              const isBest = i === 0
              const decayBad = r.sharpe_decay > 1.5
              return (
                <tr key={i} style={isBest ? { background: '#1e3a1e' } : {}}>
                  <td>{isBest ? '★' : i + 1}</td>
                  <td>
                    {Object.entries(r.params).map(([k, v]) => (
                      <Tag key={k} minimal style={{ marginRight: 2, fontSize: 10 }}>{k}={v}</Tag>
                    ))}
                  </td>
                  <td style={{ color: r.is_stats.total_return > 0 ? '#4ade80' : '#f87171' }}>
                    {r.is_stats.total_return.toFixed(1)}%
                  </td>
                  <td>{r.is_stats.sharpe.toFixed(2)}</td>
                  <td>{r.is_stats.win_rate.toFixed(1)}%</td>
                  <td>{r.is_stats.n_trades}</td>
                  <td style={{ borderLeft: '2px solid #334155', color: r.oos_stats.total_return > 0 ? '#4ade80' : '#f87171' }}>
                    {r.oos_stats.total_return.toFixed(1)}%
                  </td>
                  <td style={{ color: r.oos_stats.sharpe > 0 ? '#4ade80' : '#f87171' }}>
                    {r.oos_stats.sharpe.toFixed(2)}
                  </td>
                  <td>{r.oos_stats.win_rate.toFixed(1)}%</td>
                  <td style={{ color: decayBad ? '#f87171' : '#94a3b8' }}>
                    {r.sharpe_decay.toFixed(2)} {decayBad && '⚠'}
                  </td>
                  <td style={{ fontWeight: isBest ? 700 : 400, color: '#a78bfa' }}>
                    {r.rank_score.toFixed(3)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </HTMLTable>
      </div>
      {result.ranking.length === 0 && (
        <Callout intent="warning" title="No valid combos">
          All param combos had fewer than 10 trades in-sample. Try a longer date range.
        </Callout>
      )}
    </div>
  )
}

// ── trade log ─────────────────────────────────────────────────────────────────

function TradeLog({ trades }: { trades: CryptoBacktestResult['trades'] }) {
  return (
    <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
      <HTMLTable compact striped style={{ width: '100%', fontSize: 12 }}>
        <thead>
          <tr>
            <th>Entry</th>
            <th>Exit</th>
            <th>Entry $</th>
            <th>Exit $</th>
            <th>Return%</th>
            <th>PnL $</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={i}>
              <td>{t.entry_time}</td>
              <td>{t.exit_time}</td>
              <td>{t.entry_price.toFixed(2)}</td>
              <td>{t.exit_price.toFixed(2)}</td>
              <td style={{ color: t.return_pct >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                {t.return_pct >= 0 ? '+' : ''}{t.return_pct.toFixed(2)}%
              </td>
              <td style={{ color: t.pnl >= 0 ? '#4ade80' : '#f87171' }}>
                {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(0)}
              </td>
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </div>
  )
}

// ── Legend stock scanner panel for Backtest ───────────────────────────────────

const LEGEND_COLORS_BT: Record<string, string> = {
  WN: '#f59e0b', MM: '#10b981', OR: '#3b82f6', SE: '#8b5cf6',
  RT: '#06b6d4', TF: '#f97316', DV: '#ec4899', WS: '#a3e635', DX: '#fbbf24',
}
const LEGEND_META_BT: Record<string, { trader: string; timeline: string }> = {
  WN: { trader: 'Weinstein', timeline: '3-6M' }, MM: { trader: 'Minervini', timeline: '2-4M' },
  OR: { trader: "O'Neil",    timeline: '2-4M' }, SE: { trader: 'Stockbee',  timeline: '1-2M' },
  RT: { trader: 'Rayner',    timeline: '1-3M' }, TF: { trader: 'TTrades',   timeline: '2-4M' },
  DV: { trader: 'Dragonfly', timeline: '3-6M' }, WS: { trader: 'Wyckoff',   timeline: '2-4M' },
  DX: { trader: 'Darvas',    timeline: '1-3M' },
}

interface LegBTSig { signal: boolean; score: number; reason: string; entry_zone: number; target: number; stop: number }
interface LegBTResult { symbol: string; composite: number; firing: string[]; count: number; signals: Record<string, LegBTSig> }
interface LegBTScan { scanned: number; failed?: number; results: LegBTResult[]; as_of: string }

function LegendScanPanel() {
  const [symInput, setSymInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<LegBTScan | null>(null)
  const [err, setErr] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const run = async () => {
    setLoading(true); setErr(''); setData(null)
    try {
      const qs = symInput.trim() ? `?symbols=${encodeURIComponent(symInput.trim().toUpperCase())}&top=20` : '?top=20'
      const res = await fetch(`/ds/v1/legend/scan/${qs}`)
      if (!res.ok) throw new Error(`${res.status}`)
      setData(await res.json())
    } catch (e) { setErr(String((e as Error).message)) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        ★ Legend Stock Scanner
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <InputGroup
          value={symInput}
          onChange={e => setSymInput(e.target.value)}
          placeholder="AAPL,MSFT — blank = 40 large caps"
          style={{ flex: 1, fontSize: 11 }}
        />
        <Button intent="warning" icon="search" onClick={run} loading={loading} style={{ fontSize: 11 }}>Scan</Button>
      </div>
      {err && <div style={{ fontSize: 10, color: '#f87171', marginBottom: 6 }}>{err}</div>}
      {data && (
        <>
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 6 }}>
            {data.scanned} scanned · {data.results.filter(r => r.count > 0).length} firing · {data.as_of}
          </div>
          {data.results.map(r => (
            <div key={r.symbol}>
              <div
                onClick={() => setExpanded(expanded === r.symbol ? null : r.symbol)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 2px', cursor: 'pointer',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  background: expanded === r.symbol ? '#0a1628' : 'transparent',
                }}
              >
                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#e2e8f0', width: 50, fontSize: 12 }}>
                  {r.symbol}
                </span>
                <div style={{ flex: 1, height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${r.composite * 100}%`,
                    background: r.composite > 0.5 ? '#4ade80' : r.composite > 0.35 ? '#fbbf24' : '#475569',
                    borderRadius: 2,
                  }} />
                </div>
                <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#fbbf24', width: 26, textAlign: 'right' }}>
                  {r.count}/9
                </span>
              </div>
              {expanded === r.symbol && (
                <div style={{ padding: '6px 4px', background: '#0a1628', marginBottom: 2 }}>
                  {Object.entries(r.signals).map(([id, sig]) => {
                    const col = LEGEND_COLORS_BT[id] ?? '#64748b'
                    return (
                      <div key={id} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 2, opacity: sig.signal ? 1 : 0.35 }}>
                        <span style={{ fontSize: 8, color: col, fontWeight: 700, width: 20 }}>{id}</span>
                        <div style={{ flex: 1, height: 3, background: '#1e293b', borderRadius: 1, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${sig.score * 100}%`, background: col }} />
                        </div>
                        {sig.signal && <span style={{ fontSize: 8, color: col }}>▲</span>}
                      </div>
                    )
                  })}
                  {r.firing.length > 0 && (
                    <div style={{ fontSize: 9, color: '#4ade80', marginTop: 4 }}>
                      {r.firing.map(id => `${LEGEND_META_BT[id]?.trader ?? id}: ${r.signals[id]?.reason?.slice(0,40) ?? ''}`).join(' · ')}
                    </div>
                  )}
                  {r.firing.length > 0 && r.signals[r.firing[0]] && (
                    <div style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>
                      Entry ~${r.signals[r.firing[0]].entry_zone?.toFixed(2)} · Target ${r.signals[r.firing[0]].target?.toFixed(2)} · Stop ${r.signals[r.firing[0]].stop?.toFixed(2)}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

const BT_SETTINGS_KEY = 'm3d.bt.settings'
const BT_RESULT_KEY   = 'm3d.bt.lastResult'
const BT_HISTORY_KEY  = 'm3d.bt.history'

interface BtHistoryEntry {
  ts: string
  algo: string
  asset: string
  start: string
  end: string
  total_return: number
  sharpe: number
  win_rate: number
  max_drawdown: number
  num_trades: number
}

function loadBtSettings() {
  try {
    const raw = sessionStorage.getItem(BT_SETTINGS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}
function saveBtSettings(s: object) {
  try { sessionStorage.setItem(BT_SETTINGS_KEY, JSON.stringify(s)) } catch {}
}
function loadBtResult(): CryptoBacktestResult | null {
  try {
    const raw = sessionStorage.getItem(BT_RESULT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function saveBtResult(r: CryptoBacktestResult) {
  try { sessionStorage.setItem(BT_RESULT_KEY, JSON.stringify(r)) } catch {}
}
function loadBtHistory(): BtHistoryEntry[] {
  try {
    const raw = localStorage.getItem(BT_HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}
function appendBtHistory(e: BtHistoryEntry) {
  try {
    const hist = loadBtHistory()
    hist.unshift(e)
    localStorage.setItem(BT_HISTORY_KEY, JSON.stringify(hist.slice(0, 20)))
  } catch {}
}

export default function Backtest() {
  const { data: algos, isLoading: algosLoading } = useDsAlgos()
  const runBacktest = useRunCryptoBacktest()
  const runOptimize = useRunOptimize()

  const savedSettings = loadBtSettings()
  const [selectedAlgo, setSelectedAlgo] = useState<string>(savedSettings?.algo ?? 'DON_BO')
  const [selectedBank, setSelectedBank] = useState<'A' | 'B' | 'C' | 'all'>(savedSettings?.bank ?? 'all')
  const [asset, setAsset] = useState(savedSettings?.asset ?? 'BTC')
  const [startDate, setStartDate] = useState(savedSettings?.start ?? '2021-01-01')
  const [endDate, setEndDate] = useState(savedSettings?.end ?? '2024-12-31')
  const [paramOverrides, setParamOverrides] = useState<Record<string, number>>({})
  const [btResult, setBtResult] = useState<CryptoBacktestResult | null>(loadBtResult)
  const [optResult, setOptResult] = useState<OptResult | null>(null)
  const [activeTab, setActiveTab] = useState<'chart' | 'trades' | 'optimize' | 'legend' | 'history'>(
    loadBtResult() ? 'chart' : 'legend'
  )
  const [btHistory] = useState<BtHistoryEntry[]>(loadBtHistory)
  const [showHistory, setShowHistory] = useState(false)

  const filteredAlgos = useMemo(() => {
    if (!algos) return []
    if (selectedBank === 'all') return algos
    return algos.filter(a => a.bank === selectedBank)
  }, [algos, selectedBank])

  const currentAlgoMeta: CryptoAlgoMeta | undefined = algos?.find(a => a.id === selectedAlgo)

  const persistSettings = () =>
    saveBtSettings({ algo: selectedAlgo, bank: selectedBank, asset, start: startDate, end: endDate })

  const handleRunBacktest = async () => {
    if (!selectedAlgo) return
    persistSettings()
    setBtResult(null)
    setOptResult(null)
    try {
      const res = await runBacktest.mutateAsync({
        algo: selectedAlgo,
        asset,
        start: startDate,
        end: endDate,
        params: paramOverrides,
      })
      setBtResult(res)
      saveBtResult(res)
      appendBtHistory({
        ts: new Date().toISOString(),
        algo: selectedAlgo,
        asset,
        start: startDate,
        end: endDate,
        total_return: res.total_return,
        sharpe: res.sharpe,
        win_rate: res.win_rate,
        max_drawdown: res.max_drawdown,
        num_trades: res.num_trades,
      })
      setActiveTab('chart')
    } catch (_e) {}
  }

  const handleRunOptimize = async () => {
    if (!selectedAlgo) return
    setOptResult(null)
    try {
      const res = await runOptimize.mutateAsync({
        algo: selectedAlgo,
        asset,
        start: startDate,
        end: endDate,
        top_n: 10,
      })
      setOptResult(res)
      setActiveTab('optimize')
    } catch (_e) {}
  }

  const isRunning = runBacktest.isPending || runOptimize.isPending

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-dark)', color: '#e2e8f0' }}>

      {/* ── Algo Picker Sidebar ───────────────────────────────────── */}
      <div style={{ width: 260, borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <div style={{ padding: '16px 12px 8px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Bank</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'A', 'B', 'C'] as const).map(b => (
              <button
                key={b}
                onClick={() => setSelectedBank(b)}
                style={{
                  flex: 1, padding: '4px 0', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                  background: selectedBank === b ? (b === 'all' ? '#334155' : BANK_COLORS[b]) : '#1e293b',
                  color: selectedBank === b ? '#fff' : '#94a3b8',
                  fontWeight: selectedBank === b ? 700 : 400,
                }}
              >
                {b === 'all' ? 'All' : b}
              </button>
            ))}
          </div>
        </div>

        {algosLoading && <div style={{ padding: 16 }}><Spinner size={20} /></div>}

        <div style={{ padding: '4px 0', flex: 1 }}>
          {filteredAlgos.map(algo => (
            <div
              key={algo.id}
              onClick={() => { setSelectedAlgo(algo.id); setParamOverrides({}) }}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                background: selectedAlgo === algo.id ? '#1e293b' : 'transparent',
                borderLeft: selectedAlgo === algo.id ? `3px solid ${BANK_COLORS[algo.bank]}` : '3px solid transparent',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <Tag
                minimal
                style={{
                  background: BANK_COLORS[algo.bank] + '33',
                  color: BANK_COLORS[algo.bank],
                  fontSize: 9, width: 18, textAlign: 'center', padding: '1px 2px',
                }}
              >
                {algo.bank}
              </Tag>
              <div>
                <div style={{ fontSize: 12, fontWeight: selectedAlgo === algo.id ? 600 : 400, color: '#e2e8f0' }}>
                  {algo.id}
                </div>
                <div style={{ fontSize: 10, color: '#64748b' }}>{algo.name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main Content ──────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Config bar */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-dark)', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {/* Asset */}
          <FormGroup label="Asset" style={{ margin: 0 }}>
            <HTMLSelect value={asset} onChange={e => setAsset(e.target.value)} style={{ width: 90 }}>
              {CRYPTO_ASSETS.map(a => <option key={a} value={a}>{a}</option>)}
            </HTMLSelect>
          </FormGroup>

          {/* Custom asset */}
          <FormGroup label="Or type" style={{ margin: 0 }}>
            <InputGroup
              value={asset}
              onChange={e => setAsset(e.target.value.toUpperCase())}
              style={{ width: 80 }}
              placeholder="BTC"
            />
          </FormGroup>

          {/* Dates */}
          <FormGroup label="Start" style={{ margin: 0 }}>
            <InputGroup type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ width: 130 }} />
          </FormGroup>
          <FormGroup label="End" style={{ margin: 0 }}>
            <InputGroup type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ width: 130 }} />
          </FormGroup>

          {/* Params */}
          {currentAlgoMeta && (
            <FormGroup label={`${selectedAlgo} params`} style={{ margin: 0 }}>
              <ParamEditor
                grid={currentAlgoMeta.param_grid}
                params={{ ...currentAlgoMeta.default_params, ...paramOverrides }}
                onChange={setParamOverrides}
              />
            </FormGroup>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <Button
              intent="primary"
              icon="play"
              onClick={handleRunBacktest}
              loading={runBacktest.isPending}
              disabled={isRunning}
            >
              Run Backtest
            </Button>
            <Tooltip content="Run walk-forward param optimization (IS/OOS) across all param combos using vectorbt">
              <Button
                intent="warning"
                icon="settings"
                onClick={handleRunOptimize}
                loading={runOptimize.isPending}
                disabled={isRunning}
              >
                Optimize
              </Button>
            </Tooltip>
            {btHistory.length > 0 && (
              <Button
                variant="minimal"
                icon="history"
                active={showHistory}
                onClick={() => { setShowHistory(v => !v); setActiveTab('history') }}
                style={{ color: '#64748b', fontSize: 11 }}
              >
                History ({btHistory.length})
              </Button>
            )}
          </div>
        </div>

        {/* Error display */}
        {(runBacktest.isError || runOptimize.isError) && (
          <Callout intent="danger" style={{ margin: 12 }}>
            {(runBacktest.error as Error)?.message ?? (runOptimize.error as Error)?.message}
          </Callout>
        )}

        {/* Loading */}
        {isRunning && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 16px', color: '#94a3b8' }}>
            <Spinner size={20} />
            <span>
              {runBacktest.isPending
                ? 'Running backtest...'
                : `Optimizing ${selectedAlgo} on ${asset} — testing all param combos with vectorbt...`}
            </span>
          </div>
        )}

        {/* Stats row */}
        {btResult && (
          <div style={{ display: 'flex', gap: 8, padding: '12px 16px', flexWrap: 'wrap' }}>
            <StatCard
              label="Total Return"
              value={`${btResult.total_return >= 0 ? '+' : ''}${btResult.total_return.toFixed(1)}%`}
              intent={btResult.total_return > 0 ? 'success' : 'danger'}
            />
            <StatCard
              label="Sharpe"
              value={btResult.sharpe.toFixed(2)}
              intent={btResult.sharpe > 1 ? 'success' : btResult.sharpe > 0 ? 'warning' : 'danger'}
            />
            <StatCard
              label="Win Rate"
              value={`${btResult.win_rate.toFixed(1)}%`}
              intent={btResult.win_rate > 50 ? 'success' : 'warning'}
            />
            <StatCard
              label="Max Drawdown"
              value={`${btResult.max_drawdown.toFixed(1)}%`}
              intent={btResult.max_drawdown < 15 ? 'success' : btResult.max_drawdown < 30 ? 'warning' : 'danger'}
            />
            <StatCard
              label="Trades"
              value={String(btResult.num_trades)}
              sub={`${btResult.start} → ${btResult.end}`}
            />
          </div>
        )}

        {/* Tabs — Legend always visible, others need results */}
        {(btResult || optResult || true) && (
          <div style={{ flex: 1, overflow: 'auto', padding: '0 16px 16px' }}>
            <Tabs
              id="backtest-tabs"
              selectedTabId={activeTab}
              onChange={id => setActiveTab(id as typeof activeTab)}
              animate
            >
              <Tab
                id="chart"
                title="Charts"
                disabled={!btResult}
                panel={btResult
                  ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {/* Equity curve */}
                      <Card elevation={Elevation.ONE} style={{ background: 'var(--bg-dark)', padding: 12 }}>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                          Equity Curve — {selectedAlgo} · {asset} · {btResult.num_trades} trades ·&nbsp;
                          <span style={{ color: btResult.total_return >= 0 ? '#4ade80' : '#f87171' }}>
                            {btResult.total_return >= 0 ? '+' : ''}{btResult.total_return.toFixed(1)}%
                          </span>
                        </div>
                        <EquityChart curve={btResult.equity_curve} />
                      </Card>
                      {/* Trade markers chart */}
                      <Card elevation={Elevation.ONE} style={{ background: 'var(--bg-dark)', padding: 12 }}>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                          Trade Entries &amp; Exits — ▲ entry · ▼ exit (green=win, red=loss)
                        </div>
                        <TradeChart curve={btResult.equity_curve} trades={btResult.trades} />
                      </Card>
                    </div>
                  : <span />
                }
              />
              <Tab
                id="trades"
                title={`Trades ${btResult ? `(${btResult.num_trades})` : ''}`}
                disabled={!btResult}
                panel={btResult ? <TradeLog trades={btResult.trades} /> : <span />}
              />
              <Tab
                id="optimize"
                title={`Optimize ${optResult ? `(${optResult.n_combos_tested} combos)` : ''}`}
                disabled={!optResult}
                panel={optResult ? <OptTable result={optResult} /> : <span />}
              />
              <Tab
                id="legend"
                title="★ Legends"
                panel={<LegendScanPanel />}
              />
              <Tab
                id="history"
                title={`History ${btHistory.length > 0 ? `(${btHistory.length})` : ''}`}
                disabled={btHistory.length === 0}
                panel={
                  <div style={{ overflowX: 'auto' }}>
                    <HTMLTable compact striped style={{ width: '100%', fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>When</th><th>Algo</th><th>Asset</th><th>Period</th>
                          <th>Return</th><th>Sharpe</th><th>Win%</th><th>MaxDD</th><th>Trades</th>
                        </tr>
                      </thead>
                      <tbody>
                        {btHistory.map((h, i) => (
                          <tr key={i} style={{ cursor: 'pointer' }} onClick={() => {
                            setSelectedAlgo(h.algo); setAsset(h.asset)
                            setStartDate(h.start); setEndDate(h.end)
                          }}>
                            <td style={{ color: '#475569', whiteSpace: 'nowrap' }}>{h.ts.slice(0, 16).replace('T', ' ')}</td>
                            <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>{h.algo}</td>
                            <td>{h.asset}</td>
                            <td style={{ color: '#475569', fontSize: 10 }}>{h.start.slice(0,7)} → {h.end.slice(0,7)}</td>
                            <td style={{ color: h.total_return >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                              {h.total_return >= 0 ? '+' : ''}{h.total_return.toFixed(1)}%
                            </td>
                            <td style={{ color: h.sharpe > 1 ? '#4ade80' : h.sharpe > 0 ? '#fbbf24' : '#f87171' }}>
                              {h.sharpe.toFixed(2)}
                            </td>
                            <td>{h.win_rate.toFixed(0)}%</td>
                            <td style={{ color: h.max_drawdown < 15 ? '#4ade80' : '#f87171' }}>
                              {h.max_drawdown.toFixed(1)}%
                            </td>
                            <td>{h.num_trades}</td>
                          </tr>
                        ))}
                      </tbody>
                    </HTMLTable>
                    <div style={{ fontSize: 10, color: '#334155', padding: '6px 4px' }}>
                      Click a row to reload those settings · Last 20 runs stored locally
                    </div>
                  </div>
                }
              />
            </Tabs>
          </div>
        )}

        {/* Empty state — hidden when on Legend tab */}
        {!btResult && !optResult && !isRunning && activeTab !== 'legend' && !runBacktest.isError && !runOptimize.isError && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#334155' }}>
            <Icon icon="chart" size={64} color="#1e293b" />
            <div style={{ marginTop: 16, fontSize: 14 }}>Select an algo, set dates, then Run Backtest or Optimize</div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#1e293b' }}>
              Optimize uses vectorbt — tests thousands of param combos with IS/OOS walk-forward
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
