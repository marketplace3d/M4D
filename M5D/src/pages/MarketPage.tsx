import type { CouncilSnapshot, CrossAssetReport, ActivityReport } from '../types'

const SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'AVAX/USDT', 'LINK/USDT']

const CA_DIMS = [
  { label: 'BTC/ETH ratio',    key: 'btc_eth_ratio'  },
  { label: 'Alt beta',         key: 'alt_beta'       },
  { label: 'DeFi momentum',    key: 'defi_momentum'  },
  { label: 'L1 spread',        key: 'l1_spread'      },
  { label: 'BTC corr break',   key: 'btc_corr_break' },
]

const REGIME_COLORS: Record<string, string> = {
  TRENDING: 'var(--greenB)', BREAKOUT: 'var(--accent)',
  RANGING: 'var(--text2)', 'RISK-OFF': 'var(--redB)', NEUTRAL: 'var(--text2)',
}

interface Props {
  council:    CouncilSnapshot | null
  crossAsset: CrossAssetReport | null
  activity:   ActivityReport | null
}

export default function MarketPage({ council, crossAsset, activity }: Props) {
  const mono = "var(--font-mono)"
  const jedi   = council?.jedi_score ?? 0
  const regime = council?.regime ?? 'NEUTRAL'
  const votes  = council?.algos ?? []
  const caReg  = crossAsset?.regime ?? null
  // dimensions may be an array or a dict keyed by name — normalise to array
  const rawDims = crossAsset?.dimensions ?? []
  const dims: Array<{ name: string; value: number; signal: string }> = Array.isArray(rawDims)
    ? rawDims
    : Object.entries(rawDims as Record<string, { value: number; signal: string }>).map(([name, v]) => ({ name, ...v }))

  const regColor  = REGIME_COLORS[regime] ?? 'var(--text2)'
  const jediColor = jedi > 12 ? 'var(--greenB)' : jedi > 0 ? 'var(--goldB)' : jedi < -12 ? 'var(--redB)' : 'var(--text2)'
  const caColor   = caReg === 'RISK_ON' ? 'var(--greenB)' : caReg === 'RISK_OFF' ? 'var(--redB)' : 'var(--text2)'
  const actColor  = activity?.gate_status === 'HOT' ? 'var(--greenB)' : activity?.gate_status === 'ALIVE' ? 'var(--green)' : activity?.gate_status === 'SLOW' ? 'var(--goldB)' : 'var(--redB)'

  const longs  = council?.total_long  ?? 0
  const shorts = council?.total_short ?? 0
  const total  = votes.length || 27

  // split votes by tier
  const boom   = votes.filter(v => v.tier === 'BOOM')
  const strat  = votes.filter(v => v.tier === 'STRAT')
  const legend = votes.filter(v => v.tier === 'LEGEND')

  function VoteBar({ algos, color }: { algos: typeof votes; color: string }) {
    return (
      <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginBottom: 4 }}>
        {algos.map((a, i) => (
          <div
            key={`${a.id}-${i}`}
            style={{
              width: 28, padding: '2px 3px', borderRadius: 2, textAlign: 'center',
              fontSize: 7, fontFamily: mono, fontWeight: 700,
              background: a.vote === 1 ? 'rgba(29,255,122,0.15)' : a.vote === -1 ? 'rgba(255,74,90,0.15)' : 'var(--bg3)',
              border: `1px solid ${a.vote === 1 ? 'var(--green)' : a.vote === -1 ? 'var(--red)' : 'var(--border)'}`,
              color: a.vote === 1 ? 'var(--greenB)' : a.vote === -1 ? 'var(--redB)' : 'var(--text3)',
            }}
            title={`${a.name} | vote: ${a.vote} | score: ${a.score.toFixed(2)}`}
          >{a.id}</div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Page title */}
      <div style={{
        padding: '6px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 3,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: mono,
      }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.14em' }}>① MARKET</span>
          <span style={{ fontSize: 9, color: 'var(--text3)', marginLeft: 12 }}>PRICE · REGIME · OBI · SIGNALS · CROSS-ASSET</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <span className={`m5d-badge ${council ? 'green' : 'red'}`}>{council ? 'LIVE: COUNCIL' : 'OFFLINE: COUNCIL'}</span>
          <span className={`m5d-badge ${crossAsset ? 'green' : 'gold'}`}>{crossAsset ? 'LIVE: DS' : 'CACHED: DS'}</span>
          <span className="m5d-badge gray">BINANCE 5M</span>
          {!council && <span className="m5d-badge red">NO FEED</span>}
        </div>
      </div>

      {/* Row 1: Symbol bar (span 2) + Regime */}
      <div className="grid3">
        {/* Symbol + price */}
        <div className="m5d-panel span2">
          <div className="m5d-panel-head" style={{ background: 'rgba(58,143,255,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--accent)' }}>SYMBOL · LIVE PRICE</span>
            <span className="m5d-badge blue">BINANCE</span>
          </div>
          <div className="m5d-panel-body" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {SYMBOLS.map((s, i) => (
                <span
                  key={s}
                  className={`m5d-badge ${i === 0 ? 'green' : i === 1 ? 'blue' : 'gray'}`}
                  style={{ padding: '3px 8px', fontSize: 9, cursor: 'pointer' }}
                >{s}</span>
              ))}
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--greenB)', fontFamily: "var(--font-mono)" }}>—</div>
              <div style={{ fontSize: 8, color: 'var(--text3)' }}>awaiting feed</div>
            </div>
            {[
              { label: 'ATR%', val: '—', color: 'var(--goldB)' },
              { label: 'RVOL', val: '—', color: 'var(--accent)' },
              { label: 'JEDI', val: jedi !== 0 ? (jedi > 0 ? `+${jedi.toFixed(0)}` : jedi.toFixed(0)) : '—', color: jediColor },
            ].map(s => (
              <div key={s.label} style={{ borderLeft: '1px solid var(--border)', paddingLeft: 10 }}>
                <div style={{ fontSize: 8, color: 'var(--text3)' }}>{s.label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: s.color, fontFamily: "var(--font-mono)" }}>{s.val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Regime */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(29,255,122,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--greenB)' }}>REGIME ENGINE</span>
            <span className="m5d-badge green">LIVE</span>
          </div>
          <div className="m5d-panel-body">
            <div style={{ textAlign: 'center', padding: '6px 0 8px' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: regColor, letterSpacing: '0.1em', fontFamily: "var(--font-mono)" }}>
                {regime}
              </div>
              <div style={{ fontSize: 7, color: 'var(--text3)', marginTop: 2 }}>price-based EMA200+ATR ✓</div>
            </div>
            <div>
              <div style={{ fontSize: 7, color: 'var(--text3)', marginBottom: 3 }}>CONFIDENCE DIST</div>
              {[
                { label: 'TREND', color: 'var(--greenB)', pct: regime === 'TRENDING' ? 68 : 12 },
                { label: 'BREAK', color: 'var(--accent)',  pct: regime === 'BREAKOUT' ? 60 : 18 },
                { label: 'RANGE', color: 'var(--text2)',   pct: regime === 'RANGING'  ? 70 : 14 },
                { label: 'R-OFF', color: 'var(--redB)',    pct: regime === 'RISK-OFF' ? 55 : 6  },
              ].map(r => (
                <div key={r.label} className="regime-bar-row">
                  <span className="regime-label" style={{ color: r.color }}>{r.label}</span>
                  <div className="regime-track">
                    <div className="regime-fill" style={{ width: `${r.pct}%`, background: r.color }} />
                  </div>
                  <span className="regime-pct" style={{ color: r.pct > 40 ? r.color : 'var(--text3)' }}>{r.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Council votes + Cross-asset + Activity */}
      <div className="grid3">
        {/* Signal votes */}
        <div className="m5d-panel span2">
          <div className="m5d-panel-head" style={{ background: 'rgba(29,255,122,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--greenB)' }}>COUNCIL VOTES — 27 ALGOS</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <span className="m5d-badge green">▲ {longs}</span>
              <span className="m5d-badge red">▼ {shorts}</span>
              <span className="m5d-badge purple">JEDI {jedi > 0 ? `+${jedi.toFixed(0)}` : jedi.toFixed(0)}</span>
            </div>
          </div>
          <div className="m5d-panel-body">
            {/* BOOM bank */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 7, color: 'var(--accent)', letterSpacing: '0.1em', marginBottom: 3 }}>BOOM — ENTRY PRECISION</div>
              <VoteBar algos={boom.length ? boom : Array(9).fill({ id: '?', tier: 'BOOM', vote: 0, score: 0, win_rate: 0, name: '?' })} color="var(--accent)" />
            </div>
            {/* STRAT bank */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 7, color: 'var(--greenB)', letterSpacing: '0.1em', marginBottom: 3 }}>STRAT — STRUCTURE</div>
              <VoteBar algos={strat.length ? strat : Array(9).fill({ id: '?', tier: 'STRAT', vote: 0, score: 0, win_rate: 0, name: '?' })} color="var(--greenB)" />
            </div>
            {/* LEGEND bank */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 7, color: 'var(--goldB)', letterSpacing: '0.1em', marginBottom: 3 }}>LEGEND — SWING/1-6M</div>
              <VoteBar algos={legend.length ? legend : Array(9).fill({ id: '?', tier: 'LEGEND', vote: 0, score: 0, win_rate: 0, name: '?' })} color="var(--goldB)" />
            </div>
            {/* Summary bar */}
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
              <div style={{
                width: total > 0 ? `${(longs / total) * 100}%` : '50%',
                height: '100%',
                background: 'linear-gradient(90deg, var(--greenB), var(--green))',
                borderRadius: 3, transition: 'width 0.4s',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: 'var(--text3)', marginTop: 2 }}>
              <span style={{ color: 'var(--greenB)' }}>LONG {longs}</span>
              <span>FLAT {total - longs - shorts}</span>
              <span style={{ color: 'var(--redB)' }}>SHORT {shorts}</span>
            </div>
          </div>
        </div>

        {/* Cross-asset */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(255,138,58,0.06)' }}>
            <span className="panel-title" style={{ color: '#ff8a3a' }}>CROSS-ASSET</span>
            <span className={`m5d-badge ${caReg === 'RISK_ON' ? 'green' : caReg === 'RISK_OFF' ? 'red' : 'gray'}`}>
              {caReg ?? '—'}
            </span>
          </div>
          <div className="m5d-panel-body">
            {CA_DIMS.map(d => {
              const dim = dims.find(x => x.name === d.key)
              const val = dim?.value
              const sig = dim?.signal
              return (
                <div key={d.key} className="stat-row">
                  <span className="stat-label">{d.label}</span>
                  <span className={`stat-val ${sig === 'BUY' ? 'green' : sig === 'SELL' ? 'red' : 'blue'}`}>
                    {val !== undefined ? val.toFixed(2) : '—'}
                  </span>
                </div>
              )
            })}
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 7, color: 'var(--text3)', marginBottom: 3 }}>COMPOSITE</div>
              <div style={{
                padding: '4px 8px', borderRadius: 2, textAlign: 'center',
                background: caReg === 'RISK_ON' ? 'rgba(29,255,122,0.1)' : caReg === 'RISK_OFF' ? 'rgba(255,74,90,0.1)' : 'var(--bg3)',
                border: `1px solid ${caReg === 'RISK_ON' ? 'var(--green)' : caReg === 'RISK_OFF' ? 'var(--red)' : 'var(--border)'}`,
                fontSize: 10, fontWeight: 700, color: caColor,
              }}>
                {caReg ?? 'NEUTRAL'}
              </div>
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 7, color: 'var(--text3)' }}>MARKET ACTIVITY</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: actColor, marginTop: 2 }}>
                  {activity?.gate_status ?? '—'}
                  {activity && <span style={{ fontSize: 8, color: 'var(--text2)', marginLeft: 4 }}>
                    ({(activity.activity_score * 100).toFixed(0)}%)
                  </span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: MTF + OBI + IC health */}
      <div className="grid3">
        {/* MTF */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(176,122,255,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--purpleB)' }}>MTF CONFIRMATION</span>
            <span className="m5d-badge purple">5M+1H</span>
          </div>
          <div className="m5d-panel-body">
            {[
              { label: '1H trend',     val: '—', color: 'var(--text2)' },
              { label: '5M signal',    val: '—', color: 'var(--text2)' },
              { label: 'Conflict',     val: 'NONE', color: 'var(--greenB)' },
              { label: 'Size adj',     val: '100%', color: 'var(--text)' },
              { label: 'ICT FVG',      val: '—', color: 'var(--goldB)' },
              { label: 'Round # mag',  val: '—', color: 'var(--goldB)' },
            ].map(r => (
              <div key={r.label} className="stat-row">
                <span className="stat-label">{r.label}</span>
                <span className="stat-val" style={{ color: r.color }}>{r.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* OBI */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(42,232,232,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--tealB)' }}>ORDER BOOK IMBALANCE</span>
            <span className="m5d-badge gold">MOCK</span>
          </div>
          <div className="m5d-panel-body">
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div style={{ fontSize: 8, color: 'var(--text3)', marginBottom: 4 }}>OBI RATIO</div>
              <div style={{ display: 'flex', height: 8, borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                <div style={{ flex: 0.58, background: 'var(--green)' }} />
                <div style={{ flex: 0.42, background: 'var(--red)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8 }}>
                <span style={{ color: 'var(--greenB)' }}>BID 58%</span>
                <span style={{ color: 'var(--redB)' }}>ASK 42%</span>
              </div>
            </div>
            {[
              { label: 'OBI signal',  val: 'BID_HEAVY', color: 'var(--greenB)' },
              { label: 'Threshold',   val: '>0.35', color: 'var(--text)' },
              { label: 'Funding',     val: '+0.012%', color: 'var(--greenB)' },
              { label: 'OI signal',   val: 'NEUTRAL', color: 'var(--text2)' },
              { label: 'Fear/Greed',  val: '—', color: 'var(--text2)' },
            ].map(r => (
              <div key={r.label} className="stat-row">
                <span className="stat-label">{r.label}</span>
                <span className="stat-val" style={{ color: r.color }}>{r.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* IC health / signal lifecycle */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(58,143,255,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--accent)' }}>SIGNAL HEALTH</span>
            <span className="m5d-badge gold">MOCK</span>
          </div>
          <div className="m5d-panel-body">
            <div style={{ fontSize: 7, color: 'var(--text3)', marginBottom: 4 }}>LIFECYCLE STATUS</div>
            {[
              { id: 'PULLBACK',   status: 'ALIVE', ic: '+0.050', regime: 'TRENDING' },
              { id: 'ADX_TREND',  status: 'ALIVE', ic: '+0.045', regime: 'ANY'      },
              { id: 'SQZPOP',     status: 'SPEC',  ic: '+0.033', regime: 'BREAKOUT' },
              { id: 'SUPERTREND', status: 'SPEC',  ic: '+0.025', regime: 'BREAKOUT' },
              { id: 'VOL_SURGE',  status: 'PROB',  ic: '-0.002', regime: 'ANY'      },
              { id: 'CONSEC_B',   status: 'PROB',  ic: '-0.004', regime: 'ANY'      },
            ].map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 0', borderBottom: '1px solid var(--border)', fontSize: 9 }}>
                <span className={`status-dot ${s.status === 'ALIVE' ? 'live' : s.status === 'SPEC' ? 'run' : 'warn'}`} />
                <span style={{ flex: 1, fontSize: 8, color: 'var(--text)' }}>{s.id}</span>
                <span style={{ fontSize: 7, color: 'var(--text3)', width: 44 }}>{s.regime}</span>
                <span style={{
                  fontSize: 8, fontWeight: 700,
                  color: parseFloat(s.ic) > 0 ? 'var(--greenB)' : 'var(--redB)',
                  width: 40, textAlign: 'right',
                }}>{s.ic}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
