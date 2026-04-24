import { useState } from 'react'
import { usePoll } from '../api/client'

interface DeltaReport {
  mode: string
  n_trades: number
  sharpe: number
  win_rate: number
  avg_return: number
  scale_in_events: number
  scale_out_events: number
  breakeven_stops: number
  reentry_trades: number
  reentry_sharpe: number | null
  exit_breakdown: Record<string, { n: number; sharpe: number | null; win_rate: number }>
  config: {
    kelly_mult: number
    max_lots: number
    entry_thr: number
    cis_threshold: number
    reentry_window: number
  }
  generated_at: string
}

// Static reference data from SPEC (live backtest numbers)
const STACK_ROWS = [
  { label: 'BASELINE',            sharpe: 1.36,  delta: null,   note: 'equal-weight' },
  { label: '+ ROUTING',           sharpe: 5.94,  delta: +4.58,  note: 'regime-specialist' },
  { label: '+ SOFT REGIME',       sharpe: 6.61,  delta: +0.67,  note: 'thr=0.35' },
  { label: '+ HOUR_KILLS',        sharpe: 9.18,  delta: +2.57,  note: 'UTC dead hours' },
  { label: '+ SQZ+ATR+RVOL+JEDI', sharpe: 15.86, delta: +6.68,  note: '5 veto gates' },
  { label: 'EUPHORIA (frictionless)', sharpe: 19.83, delta: null, note: '62.4% WR, 117t' },
  { label: 'RE-ENTRY',            sharpe: 29.72, delta: null,   note: '87t — untapped' },
  { label: 'COST-ADJUSTED',       sharpe: 9.5,   delta: null,   note: '0.30% round-trip' },
]

const MODES = [
  { mode: 'PADAWAN',  kelly: '0.25×', lots: 1.5, thr: 0.35, sharpe: 11.19, wr: 52.2, trades: 1300, note: 'Capital protection' },
  { mode: 'NORMAL',   kelly: '1.0×',  lots: 3.0, thr: 0.35, sharpe: 11.19, wr: 52.2, trades: 1300, note: 'Full system' },
  { mode: 'EUPHORIA', kelly: '2.5×',  lots: 3.0, thr: 0.50, sharpe: 19.83, wr: 62.4, trades: 117,  note: 'Fat pitches only' },
  { mode: 'IOPT MAX', kelly: '4.0×',  lots: 5.0, thr: 0.35, sharpe: 17.80, wr: 59.8, trades: 92,   note: 'Optimised, seed=42' },
]

const GATE_ROWS = [
  { gate: 'HOUR_KILLS',       delta: 2.571, rate: 44.2, condition: 'UTC {0,1,3,4,5,12,13,20-23}' },
  { gate: 'SQUEEZE_LOCK',     delta: 0.934, rate: 37.2, condition: 'squeeze == 1' },
  { gate: 'ATR_RANK_LOW',     delta: 0.661, rate: 28.5, condition: 'atr < 30th pct of 50-bar window' },
  { gate: 'RVOL_EXHAUSTION',  delta: 0.435, rate: 37.5, condition: 'rvol > 90th pct of 100 bars' },
  { gate: 'LOW_JEDI',         delta: 0.310, rate: 25.1, condition: 'abs(jedi_raw) < 4' },
]

function fmt(n: number | null, d = 2) {
  if (n === null) return '—'
  return n.toFixed(d)
}

export default function PerfPage() {
  const report = usePoll<DeltaReport>('/ds/v1/delta/report/', 120_000)
  const [runMode, setRunMode] = useState('EUPHORIA')
  const [running, setRunning] = useState(false)
  const [runMsg, setRunMsg] = useState('')

  async function runDelta() {
    setRunning(true)
    setRunMsg('')
    try {
      const r = await fetch(`/ds/v1/delta/run/?mode=${runMode}`, { method: 'POST' })
      const j = await r.json()
      setRunMsg(j.status ?? 'OK')
    } catch { setRunMsg('error') }
    setRunning(false)
  }

  const sharpeBg = (s: number) => {
    if (s >= 15) return 'var(--greenB)'
    if (s >= 8)  return 'var(--goldB)'
    return 'var(--text2)'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* Row 1: live delta report + sharpe stack */}
      <div className="grid2">

        {/* Live delta report */}
        <div className="m5d-panel">
          <div className="m5d-panel-head">
            <span className="panel-title" style={{ color: 'var(--greenB)' }}>LIVE DELTA REPORT</span>
            {report && (
              <span style={{ fontSize: 8, color: 'var(--text3)' }}>
                {report.mode} · {report.generated_at?.slice(0, 16)}
              </span>
            )}
          </div>
          <div className="m5d-panel-body">
            {!report ? (
              <div style={{ color: 'var(--text3)', fontSize: 10 }}>polling /ds/v1/delta/report/…</div>
            ) : (
              <>
                <div className="grid2" style={{ marginBottom: 8 }}>
                  {[
                    { label: 'SHARPE',   val: fmt(report.sharpe), cls: report.sharpe >= 15 ? 'green' : report.sharpe >= 8 ? 'gold' : '' },
                    { label: 'WIN RATE', val: `${(report.win_rate * 100).toFixed(1)}%`, cls: report.win_rate >= 0.60 ? 'green' : '' },
                    { label: 'TRADES',   val: String(report.n_trades), cls: '' },
                    { label: 'AVG RET',  val: `${(report.avg_return * 100).toFixed(2)}%`, cls: report.avg_return > 0 ? 'green' : 'red' },
                    { label: 'SCALE-IN', val: String(report.scale_in_events), cls: '' },
                    { label: 'RE-ENTRY', val: String(report.reentry_trades), cls: '' },
                  ].map(r => (
                    <div key={r.label} className="stat-row">
                      <span className="stat-label">{r.label}</span>
                      <span className={`stat-val ${r.cls}`}>{r.val}</span>
                    </div>
                  ))}
                </div>

                {/* Config snapshot */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                  <div style={{ fontSize: 8, color: 'var(--text3)', marginBottom: 4, letterSpacing: '0.1em' }}>CONFIG</div>
                  <div className="grid2">
                    {[
                      ['KELLY', `${report.config.kelly_mult}×`],
                      ['MAX LOTS', String(report.config.max_lots)],
                      ['ENTRY THR', fmt(report.config.entry_thr)],
                      ['CIS', `${report.config.cis_threshold}/5`],
                    ].map(([k, v]) => (
                      <div key={k} className="stat-row">
                        <span className="stat-label">{k}</span>
                        <span className="stat-val">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Exit breakdown */}
                {report.exit_breakdown && (
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 6 }}>
                    <div style={{ fontSize: 8, color: 'var(--text3)', marginBottom: 4, letterSpacing: '0.1em' }}>EXIT BREAKDOWN</div>
                    {Object.entries(report.exit_breakdown).map(([k, v]) => (
                      <div key={k} className="stat-row">
                        <span className="stat-label">{k}</span>
                        <span className="stat-val">{v.n}t</span>
                        <span className="stat-val" style={{ color: 'var(--text2)', fontWeight: 400 }}>
                          {v.sharpe !== null ? `S:${fmt(v.sharpe)}` : ''} {(v.win_rate * 100).toFixed(0)}%WR
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Run controls */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                  {['PADAWAN', 'NORMAL', 'EUPHORIA', 'MAX'].map(m => (
                    <button key={m} onClick={() => setRunMode(m)} style={{
                      padding: '2px 7px', fontSize: 8, fontFamily: 'var(--font-mono)',
                      fontWeight: 700, letterSpacing: '0.08em', borderRadius: 2, cursor: 'pointer',
                      background: runMode === m ? 'rgba(58,143,255,0.15)' : 'var(--bg3)',
                      border: `1px solid ${runMode === m ? 'var(--accent)' : 'var(--border)'}`,
                      color: runMode === m ? 'var(--accent)' : 'var(--text2)',
                    }}>{m}</button>
                  ))}
                  <button onClick={runDelta} disabled={running} style={{
                    padding: '2px 9px', fontSize: 8, fontFamily: 'var(--font-mono)',
                    fontWeight: 700, letterSpacing: '0.08em', borderRadius: 2, cursor: running ? 'default' : 'pointer',
                    background: running ? 'var(--bg3)' : 'rgba(29,255,122,0.1)',
                    border: `1px solid ${running ? 'var(--border)' : 'var(--green)'}`,
                    color: running ? 'var(--text3)' : 'var(--greenB)',
                    marginLeft: 'auto',
                  }}>
                    {running ? 'RUNNING…' : 'RUN'}
                  </button>
                  {runMsg && <span style={{ fontSize: 8, color: 'var(--text3)' }}>{runMsg}</span>}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Sharpe build stack waterfall */}
        <div className="m5d-panel">
          <div className="m5d-panel-head">
            <span className="panel-title" style={{ color: 'var(--accent)' }}>SHARPE BUILD STACK</span>
            <span style={{ fontSize: 8, color: 'var(--text3)' }}>1,310 trades · OOS validated</span>
          </div>
          <div className="m5d-panel-body">
            {STACK_ROWS.map((r, i) => {
              const maxS = 30
              const pct = Math.min((r.sharpe / maxS) * 100, 100)
              return (
                <div key={i} style={{ marginBottom: 5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 9, color: 'var(--text2)' }}>{r.label}</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {r.delta !== null && (
                        <span style={{ fontSize: 8, color: 'var(--greenB)' }}>+{r.delta.toFixed(2)}</span>
                      )}
                      <span style={{ fontSize: 10, fontWeight: 700, color: sharpeBg(r.sharpe) }}>
                        {r.sharpe.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: sharpeBg(r.sharpe), borderRadius: 2, transition: 'width 0.4s' }} />
                  </div>
                  {r.note && (
                    <div style={{ fontSize: 7, color: 'var(--text3)', marginTop: 1 }}>{r.note}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Row 2: Mode comparison + Gate attribution */}
      <div className="grid2">

        {/* Mode comparison */}
        <div className="m5d-panel">
          <div className="m5d-panel-head">
            <span className="panel-title" style={{ color: 'var(--goldB)' }}>MODE COMPARISON</span>
          </div>
          <div className="m5d-panel-body">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
              <thead>
                <tr style={{ color: 'var(--text3)', fontSize: 8 }}>
                  {['MODE', 'SHARPE', 'WR%', 'TRADES', 'KELLY', 'NOTE'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '2px 4px', borderBottom: '1px solid var(--border)', letterSpacing: '0.08em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MODES.map(m => (
                  <tr key={m.mode} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '3px 4px', fontWeight: 700, color: m.mode === 'EUPHORIA' ? 'var(--greenB)' : m.mode === 'IOPT MAX' ? 'var(--goldB)' : 'var(--text)' }}>{m.mode}</td>
                    <td style={{ padding: '3px 4px', color: sharpeBg(m.sharpe), fontWeight: 700 }}>{m.sharpe.toFixed(2)}</td>
                    <td style={{ padding: '3px 4px', color: m.wr >= 60 ? 'var(--greenB)' : 'var(--text2)' }}>{m.wr}%</td>
                    <td style={{ padding: '3px 4px', color: 'var(--text2)' }}>{m.trades.toLocaleString()}</td>
                    <td style={{ padding: '3px 4px', color: 'var(--text2)' }}>{m.kelly}</td>
                    <td style={{ padding: '3px 4px', color: 'var(--text3)', fontSize: 8 }}>{m.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 10, padding: '6px 8px', background: 'rgba(29,255,122,0.05)', border: '1px solid var(--green)', borderRadius: 2 }}>
              <div style={{ fontSize: 8, color: 'var(--text3)', marginBottom: 3 }}>EUPHORIA TRIGGER (ALL required)</div>
              {[
                'JEDI ≥ ±18 (all 3 banks aligned)',
                'RVOL > 2.0',
                'Activity = HOT',
                'Cross-asset = RISK_ON',
                'soft_score ≥ 0.50',
                'All 5 gates clear',
              ].map(t => (
                <div key={t} style={{ fontSize: 9, color: 'var(--text2)', padding: '1px 0' }}>▸ {t}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Gate attribution */}
        <div className="m5d-panel">
          <div className="m5d-panel-head">
            <span className="panel-title" style={{ color: 'var(--purpleB)' }}>GATE ATTRIBUTION</span>
            <span style={{ fontSize: 8, color: 'var(--text3)' }}>Sharpe delta per gate</span>
          </div>
          <div className="m5d-panel-body">
            {GATE_ROWS.map(g => {
              const maxD = 3.0
              const pct = Math.min((g.delta / maxD) * 100, 100)
              const barColor = g.delta >= 2 ? 'var(--greenB)' : g.delta >= 1 ? 'var(--goldB)' : 'var(--accent)'
              return (
                <div key={g.gate} style={{ marginBottom: 7 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text)' }}>{g.gate}</span>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <span style={{ fontSize: 8, color: 'var(--text3)' }}>{g.rate}% hit</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: barColor }}>+{g.delta.toFixed(3)}</span>
                    </div>
                  </div>
                  <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 2 }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 2, transition: 'width 0.4s' }} />
                  </div>
                  <div style={{ fontSize: 7, color: 'var(--text3)' }}>{g.condition}</div>
                </div>
              )
            })}

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}>
              <div className="stat-row">
                <span className="stat-label">STACKED SHARPE</span>
                <span className="stat-val green">15.86</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">TRADE COUNT</span>
                <span className="stat-val">1,310</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">COST-ADJUSTED</span>
                <span className="stat-val gold">~8–11</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">COST MODEL</span>
                <span className="stat-val" style={{ color: 'var(--text2)' }}>0.30% round-trip</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: IC signal state + system health */}
      <div className="grid2">

        {/* Signal lifecycle */}
        <div className="m5d-panel">
          <div className="m5d-panel-head">
            <span className="panel-title" style={{ color: 'var(--tealB)' }}>SIGNAL IC STATE</span>
            <span style={{ fontSize: 8, color: 'var(--text3)' }}>2026-04-19 walkforward run</span>
          </div>
          <div className="m5d-panel-body">
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 8, color: 'var(--redB)', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 3 }}>RETIRE</div>
              {[
                ['DON_BO',   'BREAKOUT', '-0.101'],
                ['NEW_HIGH', 'BREAKOUT', '-0.081'],
                ['RANGE_BO', 'BREAKOUT', '-0.067'],
                ['RSI_CROSS','RANGING',  '-0.023'],
              ].map(([sig, reg, ic]) => (
                <div key={sig} className="stat-row">
                  <span className="stat-label">{sig}</span>
                  <span style={{ fontSize: 8, color: 'var(--text3)' }}>{reg}</span>
                  <span className="stat-val red">{ic}</span>
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 8, color: 'var(--goldB)', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 3 }}>KILL CORR CLONES (&gt;0.9)</div>
              {[
                ['VOL_SURGE', '0.991 with VOL_BO'],
                ['KC_BREAK',  '0.966 with VOL_BO'],
                ['BB_BREAK',  '0.921 with KC_BREAK'],
              ].map(([sig, note]) => (
                <div key={sig} className="stat-row">
                  <span className="stat-label">{sig}</span>
                  <span style={{ fontSize: 8, color: 'var(--text3)' }}>{note}</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 8, color: 'var(--goldB)', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 3 }}>WATCH</div>
              {[
                ['SQZPOP',    '-0.005', 'was +0.033 — alarming'],
                ['VOL_BO',    '-0.054', '2 more windows'],
                ['EMA_STACK', '-0.023', '2 more windows'],
              ].map(([sig, ic, note]) => (
                <div key={sig} className="stat-row">
                  <span className="stat-label">{sig}</span>
                  <span className="stat-val gold">{ic}</span>
                  <span style={{ fontSize: 8, color: 'var(--text3)' }}>{note}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* System health + OOO readiness */}
        <div className="m5d-panel">
          <div className="m5d-panel-head">
            <span className="panel-title" style={{ color: 'var(--accent)' }}>SYSTEM READINESS</span>
          </div>
          <div className="m5d-panel-body">
            {[
              { domain: 'Signal / engine pipeline',  pct: 77, label: '70–85%' },
              { domain: 'API surface + site',         pct: 72, label: '65–80%' },
              { domain: 'DS research + adapters',     pct: 65, label: '55–75%' },
              { domain: 'Real-time WS → UI',          pct: 50, label: '40–60%' },
              { domain: 'Execution (paper brokers)',  pct: 55, label: '45–65%' },
              { domain: 'Governance / audit',         pct: 25, label: '15–35%' },
              { domain: 'Family-office ops',          pct: 20, label: '10–30%' },
            ].map(r => (
              <div key={r.domain} style={{ marginBottom: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ fontSize: 9, color: 'var(--text2)' }}>{r.domain}</span>
                  <span style={{ fontSize: 8, color: r.pct >= 65 ? 'var(--greenB)' : r.pct >= 40 ? 'var(--goldB)' : 'var(--redB)' }}>{r.label}</span>
                </div>
                <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${r.pct}%`,
                    background: r.pct >= 65 ? 'var(--green)' : r.pct >= 40 ? 'var(--gold)' : 'var(--red)',
                    borderRadius: 2, transition: 'width 0.4s',
                  }} />
                </div>
              </div>
            ))}

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}>
              <div style={{ fontSize: 8, color: 'var(--text3)', marginBottom: 4, letterSpacing: '0.1em' }}>ORACLE MODE</div>
              <div style={{ padding: '5px 8px', background: 'rgba(58,143,255,0.08)', border: '1px solid var(--accentD)', borderRadius: 2 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)' }}>MODE B — GUARDRAILED SEMI-AUTO</div>
                <div style={{ fontSize: 8, color: 'var(--text3)', marginTop: 2 }}>Auto within mandate + risk box. Human for exceptions.</div>
                <div style={{ fontSize: 8, color: 'var(--text3)', marginTop: 1 }}>Until reconciliation + hard risk are green.</div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 6 }}>
              <div className="stat-row">
                <span className="stat-label">RENTECH GATES</span>
                <span className="stat-val gold">4 / 5</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">IC DECAY GATE</span>
                <span className="stat-val" style={{ color: 'var(--text2)' }}>regime-variance (not structural)</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">PAPER STATUS</span>
                <span className="stat-val green">ACTIVE</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">VALIDATED ON</span>
                <span className="stat-val" style={{ color: 'var(--text2)' }}>BTC only</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
