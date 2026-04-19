/**
 * RANK page — All algos × all assets, ranked by Sharpe ratio.
 * Run on demand. Filter by bank, sort by any metric.
 */
import { useState, useMemo } from 'react'
import {
  Button, Card, Elevation, FormGroup, InputGroup,
  HTMLSelect, Tag, Intent, Spinner, Callout, HTMLTable,
} from '@blueprintjs/core'

const BANK_COLORS: Record<string, string> = {
  A: '#f97316',
  B: '#22d3ee',
  C: '#a78bfa',
}

const DEFAULT_ASSETS = 'BTC,ETH,SOL,BNB,XRP,ADA,AVAX,DOGE,LINK,DOT'

interface RankRow {
  algo: string
  asset: string
  bank: string
  name: string
  sharpe: number
  total_return: number
  win_rate: number
  max_drawdown: number
  num_trades: number
  rank_score: number
}

interface RankResponse {
  as_of: string
  assets: string[]
  algos: number
  combos_run: number
  results_returned: number
  results: RankRow[]
}

type SortKey = keyof Pick<RankRow, 'sharpe' | 'total_return' | 'win_rate' | 'max_drawdown' | 'rank_score' | 'num_trades'>

function pct(v: number, pos = '#4ade80', neg = '#f87171') {
  return <span style={{ color: v >= 0 ? pos : neg, fontWeight: 600, fontFamily: 'monospace' }}>
    {v >= 0 ? '+' : ''}{v.toFixed(2)}%
  </span>
}

function SharpeCell({ v }: { v: number }) {
  const col = v > 1.5 ? '#4ade80' : v > 0.8 ? '#fbbf24' : v > 0 ? '#94a3b8' : '#f87171'
  return <span style={{ color: col, fontWeight: 700, fontFamily: 'monospace' }}>{v.toFixed(3)}</span>
}

export default function Rank() {
  const [assets, setAssets] = useState(DEFAULT_ASSETS)
  const [start, setStart] = useState('2022-01-01')
  const [end, setEnd] = useState('2024-12-31')
  const [minTrades, setMinTrades] = useState(5)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<RankResponse | null>(null)
  const [error, setError] = useState('')
  const [bankFilter, setBankFilter] = useState<'all' | 'A' | 'B' | 'C'>('all')
  const [algoFilter, setAlgoFilter] = useState('')
  const [assetFilter, setAssetFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('sharpe')

  const handleRun = async () => {
    setLoading(true); setError(''); setData(null)
    try {
      const qs = new URLSearchParams({
        assets: assets.trim().toUpperCase(),
        start, end,
        min_trades: String(minTrades),
      })
      const res = await fetch(`/ds/v1/rank/?${qs}`)
      if (!res.ok) throw new Error(`${res.status}`)
      setData(await res.json())
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }

  const rows = useMemo(() => {
    if (!data) return []
    return data.results
      .filter(r => bankFilter === 'all' || r.bank === bankFilter)
      .filter(r => !algoFilter || r.algo.includes(algoFilter.toUpperCase()))
      .filter(r => !assetFilter || r.asset.includes(assetFilter.toUpperCase()))
      .sort((a, b) => b[sortKey] - a[sortKey])
  }, [data, bankFilter, algoFilter, assetFilter, sortKey])

  // Per-algo avg Sharpe summary
  const algoSummary = useMemo(() => {
    if (!data) return []
    const map: Record<string, { bank: string; name: string; sharpes: number[]; returns: number[] }> = {}
    for (const r of data.results) {
      if (!map[r.algo]) map[r.algo] = { bank: r.bank, name: r.name, sharpes: [], returns: [] }
      map[r.algo].sharpes.push(r.sharpe)
      map[r.algo].returns.push(r.total_return)
    }
    return Object.entries(map)
      .map(([id, v]) => ({
        id,
        bank: v.bank,
        name: v.name,
        avg_sharpe: v.sharpes.reduce((a, b) => a + b, 0) / v.sharpes.length,
        avg_return: v.returns.reduce((a, b) => a + b, 0) / v.returns.length,
        assets_traded: v.sharpes.length,
        best_sharpe: Math.max(...v.sharpes),
      }))
      .sort((a, b) => b.avg_sharpe - a.avg_sharpe)
  }, [data])

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <span
      onClick={() => setSortKey(k)}
      style={{
        cursor: 'pointer',
        color: sortKey === k ? '#FFB74D' : '#64748b',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {label}{sortKey === k ? ' ▼' : ''}
    </span>
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-dark)', color: '#e2e8f0' }}>

      {/* Sticky config */}
      <div style={{ flexShrink: 0, padding: '12px 16px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-panel)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#FFB74D', marginBottom: 8 }}>
          ⬛ RANK — All Algos × All Assets
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <FormGroup label="Assets (comma-sep)" style={{ margin: 0, flex: 1, minWidth: 220 }}>
            <InputGroup value={assets} onChange={e => setAssets(e.target.value)} placeholder="BTC,ETH,SOL…" />
          </FormGroup>
          <FormGroup label="Start" style={{ margin: 0 }}>
            <InputGroup type="date" value={start} onChange={e => setStart(e.target.value)} style={{ width: 130 }} />
          </FormGroup>
          <FormGroup label="End" style={{ margin: 0 }}>
            <InputGroup type="date" value={end} onChange={e => setEnd(e.target.value)} style={{ width: 130 }} />
          </FormGroup>
          <FormGroup label="Min trades" style={{ margin: 0, width: 80 }}>
            <InputGroup type="number" value={String(minTrades)}
              onChange={e => setMinTrades(Math.max(1, Number(e.target.value)))} />
          </FormGroup>
          <Button intent="danger" icon="play" onClick={handleRun} loading={loading} large>
            RUN ALL ALGOS
          </Button>
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>

        {error && <Callout intent="danger" style={{ marginBottom: 12 }}>{error}</Callout>}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 20, color: '#64748b' }}>
            <Spinner size={24} />
            <span>Running {algoSummary.length || '27'} algos × {assets.split(',').length} assets in parallel…
              this takes 30–90 seconds
            </span>
          </div>
        )}

        {!data && !loading && !error && (
          <div style={{ textAlign: 'center', padding: 60, color: '#334155' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⬛</div>
            <div style={{ fontSize: 16, marginBottom: 8 }}>Configure assets + dates then hit RUN ALL ALGOS</div>
            <div style={{ fontSize: 12 }}>Runs all 27 algos across every asset in parallel · ranked by Sharpe</div>
          </div>
        )}

        {data && (
          <>
            {/* Summary bar */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              {[
                { label: 'Combos Run', val: data.combos_run, col: '#94a3b8' },
                { label: 'Valid Results', val: data.results_returned, col: '#4ade80' },
                { label: 'Algos', val: data.algos, col: '#FFB74D' },
                { label: 'Assets', val: data.assets.length, col: '#22d3ee' },
              ].map(s => (
                <div key={s.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.col, fontFamily: 'monospace' }}>{s.val}</div>
                  <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</div>
                </div>
              ))}
              <div style={{ marginLeft: 'auto', fontSize: 10, color: '#334155', alignSelf: 'flex-end' }}>as of {data.as_of}</div>
            </div>

            {/* Algo leaderboard */}
            <Card elevation={Elevation.ONE} style={{ background: '#0f172a', padding: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                Algo Leaderboard — avg Sharpe across all assets
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {algoSummary.slice(0, 15).map((a, i) => (
                  <div key={a.id} style={{
                    background: '#1e293b', borderRadius: 6, padding: '6px 10px',
                    border: `1px solid ${BANK_COLORS[a.bank]}44`,
                    minWidth: 90,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                      <span style={{ fontSize: 9, color: '#475569' }}>#{i + 1}</span>
                      <span style={{ fontWeight: 700, color: BANK_COLORS[a.bank], fontFamily: 'monospace', fontSize: 12 }}>{a.id}</span>
                    </div>
                    <div style={{ fontSize: 9, color: '#64748b', marginBottom: 3 }}>{a.name.slice(0, 18)}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace',
                      color: a.avg_sharpe > 1 ? '#4ade80' : a.avg_sharpe > 0 ? '#fbbf24' : '#f87171' }}>
                      {a.avg_sharpe.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 9, color: '#334155' }}>{a.assets_traded} assets</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['all', 'A', 'B', 'C'] as const).map(b => (
                  <button key={b} onClick={() => setBankFilter(b)} style={{
                    padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 11,
                    background: bankFilter === b ? (b === 'all' ? '#334155' : BANK_COLORS[b]) : '#1e293b',
                    color: bankFilter === b ? '#fff' : '#64748b', fontWeight: bankFilter === b ? 700 : 400,
                  }}>{b === 'all' ? 'All Banks' : `Bank ${b}`}</button>
                ))}
              </div>
              <InputGroup placeholder="Filter algo…" value={algoFilter}
                onChange={e => setAlgoFilter(e.target.value)} style={{ width: 120, fontSize: 11 }} />
              <InputGroup placeholder="Filter asset…" value={assetFilter}
                onChange={e => setAssetFilter(e.target.value)} style={{ width: 100, fontSize: 11 }} />
              <span style={{ marginLeft: 'auto', fontSize: 10, color: '#475569' }}>{rows.length} rows</span>
            </div>

            {/* Main table */}
            <HTMLTable compact striped style={{ width: '100%', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#0f172a' }}>
                  <th>#</th>
                  <th>Algo</th>
                  <th>Asset</th>
                  <th>Bank</th>
                  <th><SortBtn k="sharpe" label="Sharpe" /></th>
                  <th><SortBtn k="rank_score" label="Rank Score" /></th>
                  <th><SortBtn k="total_return" label="Return" /></th>
                  <th><SortBtn k="win_rate" label="Win %" /></th>
                  <th><SortBtn k="max_drawdown" label="MaxDD" /></th>
                  <th><SortBtn k="num_trades" label="Trades" /></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.algo}-${r.asset}`}
                    style={{ borderLeft: `3px solid ${BANK_COLORS[r.bank]}44` }}>
                    <td style={{ color: '#475569' }}>{i + 1}</td>
                    <td>
                      <span style={{ fontWeight: 700, fontFamily: 'monospace', color: BANK_COLORS[r.bank] }}>{r.algo}</span>
                      <div style={{ fontSize: 9, color: '#475569' }}>{r.name}</div>
                    </td>
                    <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>{r.asset}</td>
                    <td>
                      <Tag minimal style={{
                        background: BANK_COLORS[r.bank] + '33', color: BANK_COLORS[r.bank],
                        fontSize: 9, padding: '1px 4px',
                      }}>{r.bank}</Tag>
                    </td>
                    <td><SharpeCell v={r.sharpe} /></td>
                    <td style={{ color: r.rank_score > 0 ? '#4ade80' : '#f87171', fontFamily: 'monospace' }}>
                      {r.rank_score.toFixed(2)}
                    </td>
                    <td>{pct(r.total_return)}</td>
                    <td style={{ color: r.win_rate > 50 ? '#4ade80' : '#94a3b8' }}>{r.win_rate.toFixed(1)}%</td>
                    <td style={{ color: r.max_drawdown < 15 ? '#4ade80' : r.max_drawdown < 30 ? '#fbbf24' : '#f87171' }}>
                      {r.max_drawdown.toFixed(1)}%
                    </td>
                    <td style={{ color: '#64748b' }}>{r.num_trades}</td>
                  </tr>
                ))}
              </tbody>
            </HTMLTable>

            {rows.length === 0 && (
              <Callout intent="none" style={{ marginTop: 12 }}>
                No results match current filters.
              </Callout>
            )}
          </>
        )}
      </div>
    </div>
  )
}
