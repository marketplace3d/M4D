import React, { useState, useMemo, useEffect } from 'react'
import {
  Card,
  Elevation,
  Spinner,
  Tag,
} from '@blueprintjs/core'
import { Suggest } from '@blueprintjs/select'
import type { ItemRenderer, ItemPredicate } from '@blueprintjs/select'
import { MenuItem } from '@blueprintjs/core'
import { useAlgoDay, useAssets } from '../api/client'
import { LiveChart } from '../components/LiveChart'
import { AlgoSignalBar } from '../components/AlgoSignalBar'
import { OrderPanel } from '../components/OrderPanel'
import type { AlgoDayAsset, AssetVotes, Timeframe } from '../types'
import { BANK_A_IDS, BANK_B_IDS, BANK_C_IDS } from '../types'

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d']

// ─── Legend signals for current symbol ────────────────────────────────────────

const LEGEND_COLORS: Record<string, string> = {
  WN: '#f59e0b', MM: '#10b981', OR: '#3b82f6', SE: '#8b5cf6',
  RT: '#06b6d4', TF: '#f97316', DV: '#ec4899', WS: '#a3e635', DX: '#fbbf24',
}
const LEGEND_TRADER: Record<string, string> = {
  WN: 'Weinstein', MM: 'Minervini', OR: "O'Neil", SE: 'Stockbee',
  RT: 'Rayner', TF: 'TTrades', DV: 'Dragonfly', WS: 'Wyckoff', DX: 'Darvas',
}

interface LegSig { signal: boolean; score: number; reason: string; entry_zone: number; target: number; stop: number }
interface LegData { symbol: string; composite: number; signals: Record<string, LegSig> }

const LegendSignals: React.FC<{ symbol: string }> = ({ symbol }) => {
  const [data, setData] = useState<LegData | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [lastSym, setLastSym] = useState('')

  useEffect(() => {
    if (!symbol || symbol === lastSym) return
    setLoading(true)
    setErr('')
    setData(null)
    setLastSym(symbol)
    fetch(`/ds/v1/legend/${symbol}/`)
      .then(r => r.ok ? r.json() : r.json().then((e: {error?: string}) => { throw new Error(e.error ?? String(r.status)) }))
      .then(d => setData(d))
      .catch(e => setErr(String(e.message ?? e)))
      .finally(() => setLoading(false))
  }, [symbol])

  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
        Legend Signals · {symbol}
      </div>

      {loading && <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: '#475569', fontSize: 11 }}>
        <Spinner size={12} /> fetching…
      </div>}

      {err && <div style={{ fontSize: 10, color: '#f87171' }}>{err.slice(0, 80)}</div>}

      {data && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: '#64748b' }}>Composite</span>
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: data.composite > 0.5 ? '#4ade80' : data.composite > 0.3 ? '#fbbf24' : '#8f99a8', fontWeight: 700 }}>
              {(data.composite * 100).toFixed(0)}
            </span>
          </div>
          {Object.entries(data.signals).map(([id, sig]) => {
            const col = LEGEND_COLORS[id] ?? '#64748b'
            return (
              <div key={id} style={{
                display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3,
                opacity: sig.signal ? 1 : 0.35,
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: col, width: 20 }}>{id}</span>
                <div style={{ flex: 1, height: 3, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${sig.score * 100}%`, background: col, borderRadius: 2 }} />
                </div>
                {sig.signal && (
                  <Tag minimal style={{ fontSize: 8, padding: '0 3px', background: col + '33', color: col }}>
                    FIRE
                  </Tag>
                )}
              </div>
            )
          })}
          {data.signals && Object.values(data.signals).some(s => s.signal) && (
            <div style={{ marginTop: 6, fontSize: 9, color: '#475569', lineHeight: 1.4 }}>
              {Object.entries(data.signals).filter(([, s]) => s.signal).map(([id, s]) => (
                <div key={id}>
                  <span style={{ color: LEGEND_COLORS[id] }}>{LEGEND_TRADER[id] ?? id}:</span>{' '}
                  <span style={{ color: '#64748b' }}>{s.reason}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Asset suggest ─────────────────────────────────────────────────────────────

const filterAsset: ItemPredicate<AlgoDayAsset> = (query, asset) =>
  asset.symbol.toLowerCase().includes(query.toLowerCase())

const renderAsset: ItemRenderer<AlgoDayAsset> = (asset, { handleClick, modifiers }) => {
  if (!modifiers.matchesPredicate) return null
  const chgColor = asset.change_pct >= 0 ? '#4ade80' : '#f43f5e'
  return (
    <MenuItem
      key={asset.symbol}
      active={modifiers.active}
      disabled={modifiers.disabled}
      text={
        <span style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%' }}>
          <span style={{ fontWeight: 700, fontFamily: 'monospace', color: '#fff', minWidth: 60 }}>
            {asset.symbol}
          </span>
          <span style={{ color: '#8f99a8', fontSize: 11 }}>${asset.price.toFixed(2)}</span>
          <span style={{ color: chgColor, fontSize: 11, marginLeft: 'auto' }}>
            {asset.change_pct >= 0 ? '+' : ''}{asset.change_pct.toFixed(2)}%
          </span>
        </span>
      }
      onClick={handleClick}
    />
  )
}

// ─── Trader Page ──────────────────────────────────────────────────────────────

// Generate some mock assets if algoDay returns empty
const MOCK_ASSETS: AlgoDayAsset[] = [
  'AAPL', 'MSFT', 'TSLA', 'NVDA', 'AMZN', 'GOOGL', 'META', 'SPY', 'QQQ', 'AMD',
  'PLTR', 'COIN', 'MARA', 'SOFI', 'GME', 'AAON', 'MSTR', 'HOOD', 'RIVN', 'LCID',
].map((sym, i) => ({
  symbol: sym,
  votes: {},
  jedi_score: Math.round((Math.random() - 0.5) * 100),
  price: 50 + i * 23 + Math.random() * 10,
  change_pct: (Math.random() - 0.5) * 8,
}))

const TF_KEY  = 'm3d.trader.tf'
const SYM_KEY = 'm3d.trader.sym'

function loadTraderSym(): AlgoDayAsset {
  try {
    const raw = localStorage.getItem(SYM_KEY)
    if (raw) return JSON.parse(raw) as AlgoDayAsset
  } catch {}
  return MOCK_ASSETS[0]
}

function bankNet(votes: AssetVotes, ids: readonly string[]): number {
  let net = 0
  for (const id of ids) net += votes[id] ?? 0
  return net
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export const Trader: React.FC = () => {
  const [selectedSymbol, setSelectedSymbol] = useState<AlgoDayAsset>(loadTraderSym)
  const [timeframe, setTimeframe] = useState<Timeframe>(
    () => (localStorage.getItem(TF_KEY) as Timeframe) ?? '1h'
  )

  const pickSymbol = (sym: AlgoDayAsset) => {
    setSelectedSymbol(sym)
    try { localStorage.setItem(SYM_KEY, JSON.stringify(sym)) } catch {}
  }
  const pickTf = (tf: Timeframe) => {
    setTimeframe(tf)
    try { localStorage.setItem(TF_KEY, tf) } catch {}
  }

  const { data: algoDay } = useAlgoDay()
  const { data: rawAssets } = useAssets()

  // Merge algo-day data with fallback mocks
  const assets: AlgoDayAsset[] = useMemo(() => {
    if (algoDay?.assets && algoDay.assets.length > 0) return algoDay.assets
    if (rawAssets && rawAssets.length > 0) {
      return rawAssets.map(a => ({
        symbol: a.symbol,
        votes: {} as AssetVotes,
        jedi_score: a.jedi_score ?? 0,
        price: a.price ?? 0,
        change_pct: a.change_pct ?? 0,
      }))
    }
    return MOCK_ASSETS
  }, [algoDay, rawAssets])

  const currentAssetData = useMemo(
    () => assets.find(a => a.symbol === selectedSymbol.symbol) ?? selectedSymbol,
    [assets, selectedSymbol]
  )
  const orbA = bankNet(currentAssetData.votes, BANK_A_IDS)
  const orbB = bankNet(currentAssetData.votes, BANK_B_IDS)
  const orbC = bankNet(currentAssetData.votes, BANK_C_IDS)
  const councilNet = orbA + orbB + orbC
  const councilNorm = councilNet / 27 // [-1..1]
  const jediNorm = clamp(currentAssetData.jedi_score / 100, -1, 1)
  // Composite "JEDI front arrow": council votes + JEDI score blend.
  const composite = clamp(councilNorm * 0.72 + jediNorm * 0.28, -1, 1)
  const strengthPct = Math.round(Math.abs(composite) * 100)
  const side = composite > 0.06 ? 'LONG' : composite < -0.06 ? 'SHORT' : 'HOLD'
  const arrowGlyph = composite > 0.06 ? '↗' : composite < -0.06 ? '↘' : '→'
  const sideColor = side === 'LONG' ? '#4ade80' : side === 'SHORT' ? '#f43f5e' : '#94a3b8'
  const orbColor = (v: number) => (v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#64748b')

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        overflow: 'hidden',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
        }}
      >
        {/* Asset search */}
        <Suggest<AlgoDayAsset>
          items={assets}
          itemRenderer={renderAsset}
          itemPredicate={filterAsset}
          onItemSelect={pickSymbol}
          selectedItem={selectedSymbol}
          inputValueRenderer={a => a.symbol}
          noResults={<MenuItem disabled text="No matching assets" />}
          popoverProps={{ minimal: true }}
          inputProps={{ placeholder: 'Search symbol…', style: { width: 160 } }}
        />

        {/* Price tag */}
        <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: '#fff' }}>
          ${currentAssetData.price.toFixed(2)}
        </div>
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: 13,
            fontWeight: 600,
            color: currentAssetData.change_pct >= 0 ? '#4ade80' : '#f43f5e',
          }}
        >
          {currentAssetData.change_pct >= 0 ? '+' : ''}{currentAssetData.change_pct.toFixed(2)}%
        </div>

        {/* Jedi score */}
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: 12,
            color: '#FFB74D',
            background: 'rgba(255,183,77,0.1)',
            padding: '3px 8px',
            borderRadius: 4,
            border: '1px solid rgba(255,183,77,0.3)',
          }}
        >
          JEDI {currentAssetData.jedi_score > 0 ? '+' : ''}{currentAssetData.jedi_score}
        </div>

        {/* Timeframe buttons */}
        <div style={{ marginLeft: 'auto' }}>
          <div className="tf-btn-group">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf}
                className={`tf-btn${timeframe === tf ? ' active' : ''}`}
                onClick={() => pickTf(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Council Orbs + JEDI front arrow confidence strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 12px',
          borderBottom: '1px solid var(--border-color)',
          background: 'rgba(0,0,0,0.18)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, color: '#64748b', letterSpacing: '0.08em' }}>COUNCIL ORBS</span>
        {[
          { key: 'A', v: orbA },
          { key: 'B', v: orbB },
          { key: 'C', v: orbC },
        ].map(({ key, v }) => (
          <div
            key={key}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 6px',
              borderRadius: 999,
              border: `1px solid ${orbColor(v)}66`,
              background: `${orbColor(v)}1A`,
              color: orbColor(v),
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 700,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: orbColor(v) }} />
            {key} {v > 0 ? '+' : ''}{v}
          </div>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, color: '#64748b', letterSpacing: '0.08em' }}>JEDI FRONT</span>
          <div
            style={{
              fontSize: 30,
              fontWeight: 800,
              lineHeight: 1,
              color: sideColor,
              textShadow: `0 0 16px ${sideColor}55`,
              fontFamily: 'monospace',
            }}
          >
            {arrowGlyph}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, alignItems: 'flex-end' }}>
            <span style={{ color: sideColor, fontWeight: 800, fontSize: 12, fontFamily: 'monospace' }}>
              {side} {strengthPct}%
            </span>
            <span style={{ color: '#64748b', fontSize: 10, fontFamily: 'monospace' }}>
              C:{(councilNorm * 100).toFixed(0)} J:{(jediNorm * 100).toFixed(0)}
            </span>
          </div>
        </div>
      </div>

      {/* Main area: chart + order panel */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Chart area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ flex: 1, padding: 8, minHeight: 0 }}>
            <LiveChart
              symbol={selectedSymbol.symbol}
              timeframe={timeframe}
            />
          </div>

          {/* Algo signal bar */}
          <AlgoSignalBar votes={currentAssetData.votes} symbol={selectedSymbol.symbol} />
        </div>

        {/* Right sidebar: order panel + legend signals */}
        <Card
          elevation={Elevation.TWO}
          style={{
            width: 280,
            borderRadius: 0,
            padding: 0,
            flexShrink: 0,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <OrderPanel
            symbol={selectedSymbol.symbol}
            currentPrice={currentAssetData.price}
          />
          <LegendSignals symbol={selectedSymbol.symbol} />
        </Card>
      </div>
    </div>
  )
}
