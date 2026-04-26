import { useMemo, useState } from 'react'
import type { ActivityReport, CrossAssetReport, GateReport, PaperStatus } from '../types'

const SHARPE_STACK = [
  { label: 'BASELINE equal-weight',     sharpe: 1.36,  delta: null,       color: 'var(--text2)'   },
  { label: '+ Sharpe-weighted routing', sharpe: 5.94,  delta: '+4.58',    color: 'var(--text)'    },
  { label: '+ Soft regime (thr=0.35)',  sharpe: 6.61,  delta: '+0.66',    color: 'var(--accent)'  },
  { label: '+ HOUR_KILLS',             sharpe: 9.18,  delta: '+2.57',    color: 'var(--tealB)'   },
  { label: '+ SQZ+ATR+RVOL+JEDI',     sharpe: 15.86, delta: '+6.68',    color: 'var(--greenB)'  },
  { label: 'DELTA OPS (CIS+scale)',    sharpe: 11.19, delta: 'mgmt',     color: 'var(--purpleB)' },
  { label: 'EUPHORIA (62.4% WR)',      sharpe: 19.83, delta: '117 trades',color: 'var(--goldB)'  },
  { label: '★ RE-ENTRY after CIS',    sharpe: 29.72, delta: '87 trades', color: 'var(--greenB)'  },
]

const GATES = [
  { id: 'hour_kills',   label: 'HOUR_KILLS',    delta: '+2.57',  on: true,  color: 'green'  },
  { id: 'regime_route', label: 'REGIME_ROUTING', delta: '+0.844', on: true,  color: 'green'  },
  { id: 'squeeze_lock', label: 'SQUEEZE_LOCK',   delta: '+0.934', on: true,  color: 'green'  },
  { id: 'atr_rank',     label: 'ATR_RANK_LOW',   delta: '+0.661', on: true,  color: 'green'  },
  { id: 'rvol_exhaust', label: 'RVOL_EXHAUSTION',delta: '+0.435', on: true,  color: 'green'  },
  { id: 'low_jedi',     label: 'LOW_JEDI_GATE',  delta: '+0.310', on: true,  color: 'green'  },
  { id: 'day_filter',   label: 'DAY_FILTER',     delta: '+0.729', on: true,  color: 'green'  },
  { id: 'rvol_gate',    label: 'RVOL_GATE',      delta: '±0.000', on: false, color: 'gray'   },
  { id: 'scalper',      label: 'SCALPER_MODE',   delta: '1.896',  on: false, color: 'orange' },
  { id: 'euphoria',     label: 'EUPHORIA_ONLY',  delta: '19.83',  on: false, color: 'gold'   },
]

const HOUR_DATA = [
  'bad','bad','bad','bad','meh','meh','meh','good',
  'good','good','good','good','good','good','good','good',
  'meh','meh','bad','bad','meh','meh','bad','bad',
]

const DAYS = ['MON','TUE','WED','THU','FRI','SAT','SUN']
const DAYS_INIT = [true,true,true,true,true,false,false]

const CIRCUIT = [
  { label: 'Daily DD limit (5%)',    val: '—',      status: 'ok'   },
  { label: 'Max open positions (5)', val: '—',      status: 'ok'   },
  { label: 'Correlation limit',      val: '—',      status: 'ok'   },
  { label: 'RVOL exhaust gate',      val: '—',      status: 'warn' },
  { label: 'SQUEEZE lock',           val: 'CLEAR',  status: 'ok'   },
  { label: 'ATR rank gate',          val: '—',      status: 'ok'   },
  { label: 'Hard daily notional',    val: '5% EQ',  status: 'ok'   },
  { label: 'Paper mode',             val: 'ACTIVE', status: 'ok'   },
]

interface Props {
  paper: PaperStatus | null
  gateReport: GateReport | null
  activity: ActivityReport | null
  crossAsset: CrossAssetReport | null
}

export default function PulsePage({ paper, gateReport, activity, crossAsset }: Props) {
  const [hours, setHours] = useState(HOUR_DATA)
  const [days, setDays] = useState(DAYS_INIT)
  const [kellyMult, setKellyMult] = useState(0.5)
  const mono = "var(--font-mono)"

  const equity = paper?.account?.equity ?? null
  const pnl    = paper?.account?.unrealized_pl ?? null
  const positions = paper?.positions ?? []

  const fullKelly = 19.12
  const halfKelly = 9.56
  const activeKelly = kellyMult === 1 ? fullKelly : kellyMult === 0.5 ? halfKelly : halfKelly * 0.5
  const gateLabelById = useMemo(
    () => Object.fromEntries(GATES.map(g => [g.id, g.label])),
    []
  )
  const liveGates = useMemo(() => {
    if (!gateReport?.gates?.length) return GATES
    return gateReport.gates.map(g => ({
      id: g.gate,
      label: gateLabelById[g.gate] ?? g.gate.toUpperCase(),
      delta: g.enabled ? 'LIVE ON' : 'LIVE OFF',
      on: g.enabled,
      color: g.enabled ? 'green' : 'gray',
    }))
  }, [gateReport, gateLabelById])
  const activeGates = liveGates.filter(g => g.on).length
  const liveGateFeed = Boolean(gateReport?.ok && gateReport?.gates?.length)

  const hourColor: Record<string, string> = { good: 'var(--greenB)', meh: 'var(--text3)', bad: 'var(--redB)' }
  const hourBg:    Record<string, string> = { good: 'rgba(29,255,122,0.1)', meh: 'var(--bg3)', bad: 'rgba(255,74,90,0.1)' }

  const nextHour = (s: string) => ({ bad: 'meh', meh: 'good', good: 'bad' } as Record<string, string>)[s] ?? 'meh'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Page title */}
      <div style={{
        padding: '6px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 3,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: mono,
      }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.14em' }}>② PULSE</span>
          <span style={{ fontSize: 9, color: 'var(--text3)', marginLeft: 12 }}>ALGO SYSCONTROLS · SAFETY · KELLY · GATES · IC DECAY</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <span className="m5d-badge green">● LIVE</span>
          <span className={`m5d-badge ${activeGates >= 7 ? 'green' : 'gold'}`}>{activeGates}/10 GATES ON</span>
          <span className={`m5d-badge ${liveGateFeed ? 'green' : 'gold'}`}>{liveGateFeed ? 'LIVE: GATE REPORT' : 'CACHED: GATE REPORT'}</span>
          <span className="m5d-badge gray">PAPER MODE</span>
        </div>
      </div>

      {/* Row 1: Sharpe stack + Kelly + Circuit breakers + Positions */}
      <div className="grid4">
        {/* Sharpe waterfall */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(29,255,122,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--greenB)' }}>SHARPE STACK</span>
            <span className="m5d-badge green">WATERFALL</span>
          </div>
          <div className="m5d-panel-body" style={{ padding: '6px 8px' }}>
            {SHARPE_STACK.map((r, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: i >= 6 ? '4px 0' : '3px 0',
                borderBottom: i < SHARPE_STACK.length - 1 ? '1px solid var(--border)' : 'none',
                background: i === 7 ? 'rgba(29,255,122,0.05)' : i === 6 ? 'rgba(255,204,58,0.05)' : 'transparent',
              }}>
                <div style={{ flex: 1, fontSize: 8, color: r.color, lineHeight: 1.2 }}>{r.label}</div>
                <div style={{ width: 44, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${(r.sharpe / 29.72) * 100}%`, height: '100%', background: r.color, transition: 'width 0.4s' }} />
                </div>
                <span style={{ fontSize: i >= 6 ? 11 : 10, fontWeight: 700, color: r.color, width: 32, textAlign: 'right' }}>
                  {r.sharpe.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Kelly */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(255,204,58,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--goldB)' }}>KELLY SIZING</span>
            <span className="m5d-badge gold">HALF-K</span>
          </div>
          <div className="m5d-panel-body">
            <div style={{ textAlign: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 8, color: 'var(--text3)', marginBottom: 2 }}>ACTIVE SIZE</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--greenB)', lineHeight: 1, fontFamily: mono }}>
                {activeKelly.toFixed(2)}%
              </div>
              <div style={{ fontSize: 8, color: 'var(--text2)', marginTop: 3 }}>× 1.20 CA (RISK_ON) = {(activeKelly * 1.2).toFixed(2)}%</div>
            </div>
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ width: `${kellyMult * 100}%`, height: '100%', background: 'linear-gradient(90deg, var(--accentD), var(--greenB))', borderRadius: 3 }} />
            </div>
            {/* Kelly selector */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {[0.25, 0.5, 1.0].map(m => (
                <button
                  key={m}
                  onClick={() => setKellyMult(m)}
                  style={{
                    flex: 1, padding: '3px 0', fontSize: 8, fontFamily: mono, cursor: 'pointer', borderRadius: 2,
                    background: kellyMult === m ? 'rgba(58,143,255,0.2)' : 'var(--bg3)',
                    border: `1px solid ${kellyMult === m ? 'var(--accent)' : 'var(--border)'}`,
                    color: kellyMult === m ? 'var(--accent)' : 'var(--text2)',
                  }}
                >{m === 0.25 ? '¼K' : m === 0.5 ? '½K' : 'FK'}</button>
              ))}
            </div>
            <div className="stat-row"><span className="stat-label">FULL KELLY</span><span className="stat-val blue">{fullKelly}%</span></div>
            <div className="stat-row"><span className="stat-label">HALF KELLY</span><span className="stat-val green">{halfKelly}%</span></div>
            <div className="stat-row"><span className="stat-label">RISK_ON adj</span><span className="stat-val green">+20%</span></div>
            <div className="stat-row"><span className="stat-label">RISK_OFF adj</span><span className="stat-val red">-30%</span></div>
          </div>
        </div>

        {/* Circuit breakers */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(255,74,90,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--redB)' }}>CIRCUIT BREAKERS</span>
          </div>
          <div className="m5d-panel-body">
            {[
              { label: 'Daily DD limit (5%)', val: 'LIVE', status: pnl !== null && pnl < -0.05 * (equity ?? 1) ? 'warn' : 'ok' },
              { label: 'Max open positions (5)', val: `${positions.length}/5`, status: positions.length > 5 ? 'warn' : 'ok' },
              { label: 'Cross-asset regime', val: crossAsset?.regime ?? '—', status: crossAsset?.regime === 'RISK_OFF' ? 'warn' : 'ok' },
              { label: 'Activity gate', val: activity?.gate_status ?? '—', status: activity?.gate_status === 'DEAD' ? 'warn' : 'ok' },
              ...CIRCUIT.slice(4),
            ].map(c => (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderBottom: '1px solid var(--border)', fontSize: 9 }}>
                <span className={`status-dot ${c.status === 'ok' ? 'live' : 'warn'}`} />
                <span style={{ flex: 1, fontSize: 8, color: 'var(--text2)' }}>{c.label}</span>
                <span style={{ fontWeight: 700, color: c.status === 'ok' ? 'var(--greenB)' : 'var(--goldB)', fontSize: 9 }}>{c.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Positions */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(176,122,255,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--purpleB)' }}>OPEN POSITIONS</span>
            <span className="m5d-badge purple">{positions.length} OPEN</span>
          </div>
          <div className="m5d-panel-body">
            {positions.length === 0 ? (
              <div style={{ color: 'var(--text3)', fontSize: 9, textAlign: 'center', padding: '12px 0' }}>NO OPEN POSITIONS</div>
            ) : positions.map((p, i) => (
              <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid var(--border)', fontSize: 9 }}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ color: 'var(--accent)', fontWeight: 700, width: 60 }}>{p.symbol.replace('/USDT','')}</span>
                  <span className={`m5d-badge ${p.side === 'long' ? 'green' : 'red'}`} style={{ fontSize: 7 }}>
                    {p.side.toUpperCase()}
                  </span>
                  <div style={{ flex: 1, height: 3, background: 'var(--border)', borderRadius: 1, overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.min(100, Math.abs(p.unrealized_plpc) * 20)}%`,
                      height: '100%',
                      background: p.unrealized_pl >= 0 ? 'var(--greenB)' : 'var(--redB)',
                    }} />
                  </div>
                  <span style={{ color: p.unrealized_pl >= 0 ? 'var(--greenB)' : 'var(--redB)', fontWeight: 700, width: 50, textAlign: 'right' }}>
                    {p.unrealized_pl >= 0 ? '+' : ''}{p.unrealized_pl.toFixed(0)}
                  </span>
                </div>
              </div>
            ))}
            {equity !== null && (
              <>
                <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
                <div className="stat-row"><span className="stat-label">EQUITY</span><span className="stat-val blue">${equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
                {pnl !== null && <div className="stat-row">
                  <span className="stat-label">UPL</span>
                  <span className={`stat-val ${pnl >= 0 ? 'green' : 'red'}`}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</span>
                </div>}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Gate controls + Hour kills + Day filter */}
      <div className="grid3">
        {/* Gate toggles */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(58,143,255,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--accent)' }}>GATE CONTROLS</span>
            <span className="m5d-badge blue">APPLY / SUSPEND</span>
          </div>
          <div className="m5d-panel-body">
            {liveGates.map(g => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderBottom: '1px solid var(--border)', fontSize: 9 }}>
                <span style={{ flex: 1, color: 'var(--text2)', fontSize: 8 }}>{g.label}</span>
                <span className={`m5d-badge ${g.on ? g.color : 'gray'}`} style={{ fontSize: 7 }}>{g.delta}</span>
                <span className={`status-dot ${g.on ? 'live' : 'dead'}`} />
              </div>
            ))}
          </div>
        </div>

        {/* Hour kill grid */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(255,74,90,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--redB)' }}>HOUR KILL MAP</span>
            <span className="m5d-badge red">UTC 24H</span>
          </div>
          <div className="m5d-panel-body">
            <div style={{ fontSize: 7, color: 'var(--text3)', marginBottom: 4 }}>Click to toggle kill/allow</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gap: 1 }}>
              {hours.map((h, i) => (
                <div
                  key={i}
                  onClick={() => setHours(hs => { const n = [...hs]; n[i] = nextHour(n[i]); return n })}
                  style={{
                    height: 12, borderRadius: 1, cursor: 'pointer',
                    background: hourBg[h], border: `1px solid ${hourColor[h]}20`,
                    fontSize: 6, textAlign: 'center', lineHeight: '12px', color: hourColor[h],
                  }}
                >{i}</div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 7 }}>
              <span><span style={{ color: 'var(--greenB)' }}>■</span> ALLOW</span>
              <span><span style={{ color: 'var(--text3)' }}>■</span> NEUTRAL</span>
              <span><span style={{ color: 'var(--redB)' }}>■</span> KILL</span>
            </div>
            <div style={{ height: 1, background: 'var(--border)', margin: '8px 0' }} />
            <div style={{ fontSize: 7, color: 'var(--text3)', marginBottom: 4 }}>DAY FILTER</div>
            <div style={{ display: 'flex', gap: 3 }}>
              {DAYS.map((d, i) => (
                <div
                  key={d}
                  onClick={() => setDays(ds => { const n = [...ds]; n[i] = !n[i]; return n })}
                  style={{
                    flex: 1, padding: '3px 0', borderRadius: 2, textAlign: 'center', cursor: 'pointer',
                    fontSize: 7, fontFamily: mono, fontWeight: 700,
                    background: days[i] ? 'rgba(29,255,122,0.1)' : 'rgba(255,74,90,0.1)',
                    border: `1px solid ${days[i] ? 'var(--green)' : 'var(--red)'}`,
                    color: days[i] ? 'var(--greenB)' : 'var(--redB)',
                  }}
                >{d}</div>
              ))}
            </div>
          </div>
        </div>

        {/* IC decay + signal lifecycle */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(58,143,255,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--accent)' }}>IC DECAY MONITOR</span>
            <span className="m5d-badge blue">14-DAY</span>
          </div>
          <div className="m5d-panel-body">
            <div style={{ fontSize: 7, color: 'var(--text3)', marginBottom: 4 }}>SIGNAL LIFECYCLE</div>
            {[
              { id: 'PULLBACK',   ic: '+0.050', slope: '+', regime: 'TRENDING',  state: 'ALIVE' },
              { id: 'ADX_TREND',  ic: '+0.045', slope: '+', regime: 'ANY',       state: 'ALIVE' },
              { id: 'SQZPOP',     ic: '+0.033', slope: '+', regime: 'BREAKOUT',  state: 'SPEC'  },
              { id: 'SUPERTREND', ic: '+0.025', slope: '−', regime: 'BREAKOUT',  state: 'SPEC'  },
              { id: 'EMA_STACK',  ic: '+0.018', slope: '+', regime: 'TRENDING',  state: 'SPEC'  },
              { id: 'MACD_CROSS', ic: '+0.012', slope: '=', regime: 'TRENDING',  state: 'SPEC'  },
              { id: 'RSI_STRONG', ic: '+0.009', slope: '−', regime: 'RANGING',   state: 'SPEC'  },
              { id: 'VOL_SURGE',  ic: '-0.002', slope: '−', regime: 'ANY',       state: 'PROB'  },
              { id: 'CONSEC_B',   ic: '-0.004', slope: '−', regime: 'ANY',       state: 'PROB'  },
            ].map(s => {
              const stateColor = s.state === 'ALIVE' ? 'var(--greenB)' : s.state === 'SPEC' ? 'var(--accent)' : 'var(--goldB)'
              return (
                <div key={s.id} style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '2px 0', borderBottom: '1px solid var(--border)', fontSize: 9 }}>
                  <span className={`status-dot ${s.state === 'ALIVE' ? 'live' : s.state === 'SPEC' ? 'run' : 'warn'}`} />
                  <span style={{ flex: 1, fontSize: 8 }}>{s.id}</span>
                  <span style={{ fontSize: 7, color: 'var(--text3)', width: 46 }}>{s.regime}</span>
                  <span style={{ color: s.slope === '+' ? 'var(--greenB)' : s.slope === '−' ? 'var(--redB)' : 'var(--text2)', width: 10, textAlign: 'center' }}>{s.slope}</span>
                  <span style={{ width: 40, textAlign: 'right', fontWeight: 700, color: parseFloat(s.ic) > 0 ? 'var(--greenB)' : 'var(--redB)' }}>{s.ic}</span>
                  <span className={`m5d-badge`} style={{ fontSize: 6, background: 'transparent', border: `1px solid ${stateColor}`, color: stateColor }}>{s.state}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
