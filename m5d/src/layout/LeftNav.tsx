import { useEffect, useState } from 'react'
import type { PageId } from '../types'

interface NavSection {
  id: PageId
  icon: string
  label: string
  sublabel: string
  status: 'live' | 'warn' | 'idle' | 'run' | 'dead'
  group: 'primary' | 'research'
}

interface TickerItem { sym: string; price: number; pct: number }

const PRIMARY: NavSection[] = [
  { id: 'market',  icon: '①', label: 'MARKET',    sublabel: 'Regime · OBI · Signals',   status: 'live', group: 'primary' },
  { id: 'pulse',   icon: '②', label: 'PULSE',     sublabel: 'Gates · Kelly · Risk',      status: 'live', group: 'primary' },
  { id: 'trade',   icon: '③', label: 'TRADE',     sublabel: 'Fire · Blotter · AI',       status: 'idle', group: 'primary' },
  { id: 'starray', icon: '④', label: 'STAR RAY',  sublabel: 'Opts · IOPT · Pipeline',   status: 'idle', group: 'primary' },
  { id: 'perf',    icon: '⑤', label: 'PERF',      sublabel: 'Sharpe · Stack · IC',       status: 'live', group: 'primary' },
]
const RESEARCH: NavSection[] = [
  { id: 'alphaseek', icon: '⟡', label: 'ALPHASEEK', sublabel: '27 Algos · IC · WF',   status: 'idle', group: 'research' },
  { id: 'medallion', icon: '✦', label: 'MEDALLION', sublabel: 'RenTech · Run Lab',     status: 'idle', group: 'research' },
  { id: 'obi',       icon: '◉', label: 'OBI',       sublabel: '8-Engine · Targets',    status: 'live', group: 'research' },
]

interface Props {
  page:         PageId
  onPageChange: (p: PageId) => void
  gates:        number
  equity:       number | null
  pnl:          number | null
  running:      boolean
  collapsed:    boolean
  onCollapse:   (v: boolean) => void
  jedi:         number | null
  regime:       string | null
  activity:     string | null
}

function contextSublabel(id: PageId, activePage: PageId, jedi: number|null, regime: string|null, activity: string|null, gates: number, equity: number|null): string {
  if (id !== activePage) return PRIMARY.find(s => s.id === id)?.sublabel ?? RESEARCH.find(s => s.id === id)?.sublabel ?? ''
  const j = jedi !== null ? (jedi > 0 ? `+${Math.round(jedi)}` : String(Math.round(jedi))) : '—'
  switch (id) {
    case 'market':    return `${regime ?? '—'} · JEDI ${j}`
    case 'pulse':     return `${gates}/10 GATES · KELLY ON`
    case 'trade':     return `${activity ?? '—'} · ${equity !== null ? `$${Math.round(equity / 1000)}k` : 'PAPER'}`
    case 'starray':   return 'IOPT · PIPELINE READY'
    case 'perf':      return 'SHARPE 29.72 · LIVE'
    case 'alphaseek': return `27 ALGOS · JEDI ${j}`
    case 'medallion': return 'SIGNAL CIVILISATION'
    case 'obi':       return '8-ENGINE · BTC LIVE'
    default:          return ''
  }
}

function NavItem({ s, active, collapsed, page, jedi, regime, activity, gates, equity, onPageChange }: {
  s: NavSection; active: boolean; collapsed: boolean; page: PageId
  jedi: number|null; regime: string|null; activity: string|null; gates: number; equity: number|null
  onPageChange: (p: PageId) => void
}) {
  const sub = contextSublabel(s.id, page, jedi, regime, activity, gates, equity)
  const dotColor = s.status === 'live' ? 'var(--greenB)' : s.status === 'run' ? 'var(--accent)' : s.status === 'warn' ? 'var(--goldB)' : 'var(--text3)'

  return (
    <div
      onClick={() => onPageChange(s.id)}
      title={collapsed ? `${s.label}` : undefined}
      style={{
        padding: collapsed ? '11px 0' : '8px 12px',
        cursor: 'pointer',
        background: active ? 'rgba(58,143,255,0.1)' : 'transparent',
        borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
        display: 'flex', alignItems: 'center',
        gap: collapsed ? 0 : 10,
        justifyContent: collapsed ? 'center' : 'flex-start',
        transition: 'background var(--transition)',
        position: 'relative',
      }}
    >
      {/* Active page status dot when collapsed */}
      {collapsed && active && (
        <div style={{ position: 'absolute', top: 6, right: 6, width: 4, height: 4, borderRadius: '50%', background: dotColor }} />
      )}

      <span style={{
        fontSize: collapsed ? 14 : 11,
        color: active ? 'var(--accent)' : 'var(--text2)',
        fontWeight: 700, flexShrink: 0,
        width: collapsed ? 24 : 16, textAlign: 'center',
      }}>{s.icon}</span>

      {!collapsed && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: active ? 'var(--text)' : 'var(--text2)', letterSpacing: '0.08em' }}>
              {s.label}
            </span>
            <div style={{ marginLeft: 'auto', width: 5, height: 5, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
          </div>
          <div style={{ fontSize: 7, color: active ? 'var(--text3)' : 'var(--text3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
        </div>
      )}
    </div>
  )
}

function IndicesTicker({ collapsed, tickers }: { collapsed: boolean; tickers: TickerItem[] }) {
  if (!tickers.length) return null

  if (collapsed) {
    return (
      <div style={{ borderTop: '1px solid var(--border)', padding: '6px 0' }}>
        {tickers.map(t => (
          <div key={t.sym} style={{ textAlign: 'center', padding: '3px 0' }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: t.pct >= 0 ? 'var(--greenB)' : 'var(--redB)', margin: '0 auto' }} title={`${t.sym} ${t.pct >= 0 ? '+' : ''}${t.pct.toFixed(2)}%`} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '6px 10px 8px' }}>
      <div style={{ fontSize: 7, color: 'var(--text3)', letterSpacing: '0.1em', marginBottom: 5 }}>INDICES</div>
      {tickers.map(t => (
        <div key={t.sym} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
          <span style={{ fontSize: 8, color: 'var(--text3)', fontWeight: 700 }}>{t.sym}</span>
          <span style={{ fontSize: 9, color: 'var(--text)', fontWeight: 600 }}>
            {t.price >= 1000 ? t.price.toLocaleString('en-US', { maximumFractionDigits: 0 }) : t.price.toFixed(2)}
          </span>
          <span style={{ fontSize: 8, fontWeight: 700, color: t.pct >= 0 ? 'var(--greenB)' : 'var(--redB)', minWidth: 36, textAlign: 'right' }}>
            {t.pct >= 0 ? '+' : ''}{t.pct.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  )
}

export default function LeftNav({ page, onPageChange, gates, equity, pnl, running, collapsed, onCollapse, jedi, regime, activity }: Props) {
  const mono = "var(--font-mono)"
  const w = collapsed ? 'var(--left-nav-col-w)' : 'var(--left-nav-w)'
  const [tickers, setTickers] = useState<TickerItem[]>([])

  useEffect(() => {
    const SYMS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
    const update = async () => {
      try {
        const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${JSON.stringify(SYMS)}`)
        if (!r.ok) return
        const data = await r.json() as Array<{ symbol: string; lastPrice: string; priceChangePercent: string }>
        setTickers(data.map(d => ({
          sym:   d.symbol.replace('USDT', ''),
          price: parseFloat(d.lastPrice),
          pct:   parseFloat(d.priceChangePercent),
        })))
      } catch {}
    }
    void update()
    const id = window.setInterval(update, 15_000)
    return () => window.clearInterval(id)
  }, [])

  const navItemProps = { page, jedi, regime, activity, gates, equity, onPageChange }

  return (
    <div style={{
      width: w, minWidth: w,
      background: 'var(--nav-bg)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      transition: 'width var(--transition), min-width var(--transition)',
      overflow: 'hidden', flexShrink: 0, fontFamily: mono,
    }}>

      {/* Section label */}
      {!collapsed && (
        <div style={{ fontSize: 7, color: 'var(--text3)', padding: '8px 12px 2px', letterSpacing: '0.1em' }}>TRADING</div>
      )}
      {collapsed && <div style={{ height: 6 }} />}

      {PRIMARY.map(s => <NavItem key={s.id} s={s} active={page === s.id} collapsed={collapsed} {...navItemProps} />)}

      <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

      {!collapsed && (
        <div style={{ fontSize: 7, color: 'var(--text3)', padding: '4px 12px 2px', letterSpacing: '0.1em' }}>RESEARCH</div>
      )}

      {RESEARCH.map(s => <NavItem key={s.id} s={s} active={page === s.id} collapsed={collapsed} {...navItemProps} />)}

      {/* System stats (expanded) */}
      {!collapsed && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '6px 12px', fontSize: 8, marginTop: 'auto' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            {[
              { label: ':3030', ok: true },
              { label: ':8000', ok: true },
              { label: 'PAPER', ok: equity !== null },
            ].map(s => (
              <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 3, color: s.ok ? 'var(--greenB)' : 'var(--redB)' }}>
                <span className={`status-dot ${s.ok ? 'live' : 'dead'}`} />
                <span style={{ fontSize: 7 }}>{s.label}</span>
              </span>
            ))}
          </div>
          {equity !== null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ color: 'var(--text3)', fontSize: 7 }}>EQUITY</span>
              <span style={{ color: 'var(--accent)', fontWeight: 700 }}>${equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          )}
          {pnl !== null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ color: 'var(--text3)', fontSize: 7 }}>UPL</span>
              <span style={{ color: pnl >= 0 ? 'var(--greenB)' : 'var(--redB)', fontWeight: 700 }}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text3)', fontSize: 7 }}>GATES</span>
            <span style={{ color: 'var(--greenB)', fontWeight: 700 }}>{gates}/10</span>
          </div>
          {running && (
            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent)' }}>
              <span className="status-dot run" /><span style={{ fontSize: 7 }}>IOPT RUNNING</span>
            </div>
          )}
        </div>
      )}

      {/* Collapsed system dots */}
      {collapsed && (
        <div style={{ marginTop: 'auto', padding: '6px 0', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <span className="status-dot live" title=":3030 OK" />
          <span className="status-dot live" title=":8000 OK" />
          {equity !== null && <span className="status-dot live" title={`$${Math.round(equity / 1000)}k`} />}
        </div>
      )}

      {/* Indices ticker */}
      <IndicesTicker collapsed={collapsed} tickers={tickers} />

      {/* Collapse toggle */}
      <div
        onClick={() => onCollapse(!collapsed)}
        style={{
          padding: '8px 0', borderTop: '1px solid var(--border)',
          cursor: 'pointer', textAlign: 'center', fontSize: 11, color: 'var(--text3)',
          transition: 'color 0.15s',
        }}
      >
        {collapsed ? '›' : '‹'}
      </div>
    </div>
  )
}
