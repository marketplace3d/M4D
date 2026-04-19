import { useState, useCallback } from 'react'
import {
  Button, Card, Elevation, InputGroup, FormGroup,
  Spinner, Tag, Intent, Callout, HTMLTable, ProgressBar,
} from '@blueprintjs/core'

// ── types ─────────────────────────────────────────────────────────────────────

interface LegendSignal {
  signal: boolean
  score: number
  reason: string
  entry_zone: string
  target: string
  stop: string
}

interface LegendResult {
  symbol: string
  composite: number
  firing: string[]
  count: number
  signals: Record<string, LegendSignal>
}

interface ScanResponse {
  as_of: string
  scanned: number
  failed?: number
  results: LegendResult[]
}

interface SymbolResponse {
  symbol: string
  composite: number
  as_of: string
  signals: Record<string, LegendSignal>
}

// ── legend algo metadata ──────────────────────────────────────────────────────

const LEGEND_META: Record<string, { name: string; trader: string; color: string; timeline: string }> = {
  WN:  { name: 'Stage 2 Breakout',    trader: 'Weinstein',  color: '#f59e0b', timeline: '3-6M' },
  MM:  { name: 'VCP Breakout',         trader: 'Minervini', color: '#10b981', timeline: '2-4M' },
  OR:  { name: 'CAN SLIM',             trader: "O'Neil",    color: '#3b82f6', timeline: '1-3M' },
  SE:  { name: 'Episodic Pivot',       trader: 'Stockbee',  color: '#8b5cf6', timeline: '1-2M' },
  RT:  { name: '200MA Pullback',       trader: 'Rayner T.', color: '#06b6d4', timeline: '1-3M' },
  TF:  { name: 'Fractal Breakout',     trader: 'TTrades',   color: '#f97316', timeline: '2-4M' },
  DV:  { name: 'RS Line Leader',       trader: 'Dragonfly', color: '#ec4899', timeline: '2-6M' },
  WS:  { name: 'Spring / LPS',         trader: 'Wyckoff',   color: '#a3e635', timeline: '2-4M' },
  DX:  { name: 'Darvas Box Break',     trader: 'Darvas',    color: '#fbbf24', timeline: '1-3M' },
}

// ── score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ score, size = 'sm' }: { score: number; size?: 'sm' | 'lg' }) {
  const pct = Math.max(0, Math.min(1, score))
  const col = pct > 0.7 ? '#4ade80' : pct > 0.4 ? '#fbbf24' : '#f87171'
  const h = size === 'lg' ? 8 : 4
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: h, background: '#1e293b', borderRadius: 2, overflow: 'hidden', minWidth: size === 'lg' ? 120 : 60 }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, background: col, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: size === 'lg' ? 13 : 10, color: col, fontFamily: 'monospace', minWidth: 32 }}>
        {(pct * 100).toFixed(0)}
      </span>
    </div>
  )
}

// ── firing badge strip ────────────────────────────────────────────────────────

function FiringBadges({ firing }: { firing: string[] }) {
  if (!firing.length) return <span style={{ color: '#334155', fontSize: 10 }}>none</span>
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
      {firing.map(id => {
        const m = LEGEND_META[id]
        return (
          <Tag key={id} minimal style={{
            background: (m?.color ?? '#64748b') + '33',
            color: m?.color ?? '#64748b',
            fontSize: 9, padding: '1px 4px',
          }}>
            {id}
          </Tag>
        )
      })}
    </div>
  )
}

// ── symbol detail drawer ──────────────────────────────────────────────────────

function SymbolDetail({ data }: { data: SymbolResponse }) {
  return (
    <Card elevation={Elevation.TWO} style={{ background: '#0f172a', padding: 16, marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>
          {data.symbol}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>Composite</span>
          <ScoreBar score={data.composite} size="lg" />
        </div>
      </div>
      <HTMLTable compact style={{ width: '100%', fontSize: 11 }}>
        <thead>
          <tr>
            <th>Algo</th>
            <th>Trader</th>
            <th>Timeline</th>
            <th>Signal</th>
            <th>Score</th>
            <th>Reason</th>
            <th>Entry Zone</th>
            <th>Target</th>
            <th>Stop</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(data.signals).map(([id, sig]) => {
            const m = LEGEND_META[id]
            return (
              <tr key={id} style={sig.signal ? { background: '#0a1628' } : {}}>
                <td>
                  <span style={{ color: m?.color ?? '#94a3b8', fontWeight: 700 }}>{id}</span>
                  <div style={{ fontSize: 9, color: '#475569' }}>{m?.name}</div>
                </td>
                <td style={{ color: '#94a3b8' }}>{m?.trader ?? id}</td>
                <td>
                  <Tag minimal style={{ fontSize: 9 }}>{m?.timeline ?? '?'}</Tag>
                </td>
                <td>
                  {sig.signal
                    ? <Tag intent={Intent.SUCCESS} minimal style={{ fontSize: 9 }}>FIRE</Tag>
                    : <Tag minimal style={{ fontSize: 9, color: '#334155' }}>—</Tag>}
                </td>
                <td><ScoreBar score={sig.score} /></td>
                <td style={{ color: '#8892a4', maxWidth: 220 }}>{sig.reason || '—'}</td>
                <td style={{ color: '#fbbf24', fontFamily: 'monospace', fontSize: 10 }}>{sig.entry_zone || '—'}</td>
                <td style={{ color: '#4ade80', fontFamily: 'monospace', fontSize: 10 }}>{sig.target || '—'}</td>
                <td style={{ color: '#f87171', fontFamily: 'monospace', fontSize: 10 }}>{sig.stop || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </HTMLTable>
    </Card>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

const DS_URL = '/ds'
const LS_HISTORY_KEY = 'm3d.legend.history'

interface ScanHistoryEntry {
  ts: string
  symbols: string
  topN: number
  scanned: number
  firing: number
  topResults: Array<{ symbol: string; composite: number; count: number }>
}

function loadLsHistory(): ScanHistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(LS_HISTORY_KEY) ?? '[]') } catch { return [] }
}

function appendLsHistory(e: ScanHistoryEntry) {
  try {
    const h = loadLsHistory()
    h.unshift(e)
    localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(h.slice(0, 10)))
  } catch {}
}

async function fetchLegendScan(params: string): Promise<ScanResponse> {
  const res = await fetch(`${DS_URL}/v1/legend/scan/?${params}`)
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((e as { error?: string }).error ?? res.statusText)
  }
  return res.json()
}

async function fetchLegendSymbol(symbol: string): Promise<SymbolResponse> {
  const res = await fetch(`${DS_URL}/v1/legend/${symbol}/`)
  if (!res.ok) throw new Error(`Error ${res.status}`)
  return res.json()
}

export default function LegendScanner() {
  const [symbolInput, setSymbolInput] = useState('')
  const [topN, setTopN] = useState(30)
  const [scanning, setScanning] = useState(false)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null)
  const [detail, setDetail] = useState<SymbolResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [history, setHistory] = useState<ScanHistoryEntry[]>(loadLsHistory)
  const [showHistory, setShowHistory] = useState(false)

  const handleScan = useCallback(async () => {
    setScanning(true)
    setError(null)
    setScanResult(null)
    setDetail(null)
    setSelectedSymbol(null)
    try {
      const qs = new URLSearchParams({ top: String(topN) })
      if (symbolInput.trim()) qs.set('symbols', symbolInput.trim().toUpperCase())
      const data = await fetchLegendScan(qs.toString())
      setScanResult(data)
      const entry: ScanHistoryEntry = {
        ts: new Date().toISOString(),
        symbols: symbolInput.trim() || 'default universe',
        topN,
        scanned: data.scanned,
        firing: data.results.filter(r => r.count > 0).length,
        topResults: data.results.slice(0, 5).map(r => ({
          symbol: r.symbol, composite: r.composite, count: r.count,
        })),
      }
      appendLsHistory(entry)
      setHistory(loadLsHistory())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setScanning(false)
    }
  }, [symbolInput, topN])

  const handleSelectSymbol = async (sym: string) => {
    if (selectedSymbol === sym) {
      setSelectedSymbol(null)
      setDetail(null)
      return
    }
    setSelectedSymbol(sym)
    setLookupLoading(true)
    try {
      const d = await fetchLegendSymbol(sym)
      setDetail(d)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLookupLoading(false)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-dark)', color: '#e2e8f0' }}>

      {/* ── Sticky controls ─────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, padding: '12px 16px 0', background: 'var(--bg-dark)', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#FFB74D' }}>★ LEGEND Scanner</div>
            <div style={{ fontSize: 10, color: '#475569' }}>
              Weinstein · Minervini · O'Neil · Stockbee · Rayner · TTrades · Dragonfly · Wyckoff · Darvas
            </div>
          </div>
          {history.length > 0 && (
            <button
              onClick={() => setShowHistory(v => !v)}
              style={{
                marginLeft: 'auto', fontSize: 10, padding: '3px 10px', borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.1)', background: showHistory ? '#1e293b' : 'transparent',
                color: '#64748b', cursor: 'pointer',
              }}
            >
              {showHistory ? 'Hide' : 'Show'} History ({history.length})
            </button>
          )}
        </div>

        <Card elevation={Elevation.ONE} style={{ padding: '10px 12px', marginBottom: 10, background: 'var(--bg-panel)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <FormGroup label="Symbols — comma-sep, blank = default 40 caps" style={{ margin: 0, flex: 1, minWidth: 260 }}>
              <InputGroup
                value={symbolInput}
                onChange={e => setSymbolInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleScan()}
                placeholder="AAPL,MSFT,NVDA — or leave blank"
              />
            </FormGroup>
            <FormGroup label="Top N" style={{ margin: 0, width: 70 }}>
              <InputGroup
                type="number"
                value={String(topN)}
                onChange={e => setTopN(Math.max(5, Math.min(100, Number(e.target.value))))}
              />
            </FormGroup>
            <Button intent="warning" icon="search" onClick={handleScan} loading={scanning}>
              Scan Legends
            </Button>
          </div>
        </Card>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>

      {/* History panel */}
      {showHistory && history.length > 0 && (
        <Card elevation={Elevation.ONE} style={{ background: '#0f172a', padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Last {history.length} Scan Runs
          </div>
          {history.map((h, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0',
              borderBottom: '1px solid rgba(255,255,255,0.04)', flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 10, color: '#334155', minWidth: 120 }}>{h.ts.slice(0, 16).replace('T', ' ')}</span>
              <span style={{ fontSize: 10, color: '#64748b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {h.symbols}
              </span>
              <span style={{ fontSize: 10, color: '#fbbf24', fontFamily: 'monospace' }}>
                {h.scanned} scanned · <span style={{ color: '#4ade80' }}>{h.firing} firing</span>
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {h.topResults.map(r => (
                  <span key={r.symbol} style={{
                    fontSize: 9, background: r.count > 0 ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.04)',
                    color: r.count > 0 ? '#4ade80' : '#475569',
                    padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace',
                  }}>
                    {r.symbol} {r.count > 0 ? `${r.count}/9` : ''}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </Card>
      )}

      {error && <Callout intent="danger" style={{ marginBottom: 12 }}>{error}</Callout>}

      {scanning && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, color: '#64748b' }}>
          <Spinner size={20} />
          <span>Scanning stocks with 9 legendary trader methods — fetching from yfinance...</span>
        </div>
      )}

      {/* Legend algo key — show when no results yet */}
      {!scanResult && !scanning && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {Object.entries(LEGEND_META).map(([id, m]) => (
            <div key={id} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: '#0f172a', border: `1px solid ${m.color}33`,
              borderRadius: 6, padding: '6px 10px',
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: m.color, fontFamily: 'monospace', width: 24 }}>{id}</span>
              <div>
                <div style={{ fontSize: 11, color: '#e2e8f0' }}>{m.trader}</div>
                <div style={{ fontSize: 9, color: '#475569' }}>{m.name} · {m.timeline}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Results */}
      {scanResult && (
        <div>
          <div style={{ fontSize: 11, color: '#475569', marginBottom: 8 }}>
            {scanResult.scanned} symbols scanned · {scanResult.results.length} ranked ·{' '}
            {scanResult.results.filter(r => r.count > 0).length} firing · as of {scanResult.as_of}
            {(scanResult as any).failed > 0 && (
              <span style={{ color: '#f87171', marginLeft: 8 }}>{(scanResult as any).failed} failed</span>
            )}
          </div>

          <HTMLTable compact striped style={{ width: '100%', fontSize: 12, cursor: 'pointer' }}>
            <thead>
              <tr>
                <th>#</th>
                <th>Symbol</th>
                <th style={{ minWidth: 160 }}>Score</th>
                <th>Active Signals</th>
                <th>Fire</th>
              </tr>
            </thead>
            <tbody>
              {scanResult.results.map((r, i) => (
                <>
                  <tr
                    key={r.symbol}
                    onClick={() => handleSelectSymbol(r.symbol)}
                    style={{
                      background: selectedSymbol === r.symbol ? '#0a1628' : undefined,
                      borderLeft: selectedSymbol === r.symbol
                        ? '3px solid #FFB74D'
                        : r.count > 0 ? '3px solid #4ade8044' : '3px solid transparent',
                    }}
                  >
                    <td style={{ color: '#475569' }}>{i + 1}</td>
                    <td>
                      <div style={{ fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace', fontSize: 13 }}>
                        {r.symbol}
                      </div>
                      {r.count === 0 && (
                        <div style={{ fontSize: 9, color: '#334155' }}>building</div>
                      )}
                    </td>
                    <td style={{ minWidth: 160 }}>
                      <ScoreBar score={r.composite} size="lg" />
                    </td>
                    <td>
                      <FiringBadges firing={r.firing} />
                    </td>
                    <td>
                      <Tag
                        intent={r.count >= 3 ? Intent.SUCCESS : r.count >= 1 ? Intent.WARNING : Intent.NONE}
                        minimal
                        style={{ fontSize: 11, fontWeight: 700 }}
                      >
                        {r.count}/9
                      </Tag>
                    </td>
                  </tr>
                  {selectedSymbol === r.symbol && (
                    <tr key={`${r.symbol}-detail`}>
                      <td colSpan={5} style={{ padding: 0 }}>
                        {lookupLoading
                          ? <div style={{ padding: 16 }}><Spinner size={20} /></div>
                          : detail && detail.symbol === r.symbol && <SymbolDetail data={detail} />
                        }
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </HTMLTable>

          {scanResult.results.length === 0 && (
            <Callout intent="none" title="No data returned">
              Check Django DS is running on :8800 and try again.
            </Callout>
          )}
        </div>
      )}

      </div> {/* end scrollable body */}
    </div>
  )
}
