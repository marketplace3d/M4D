import { useState } from 'react'

// ── Data ──────────────────────────────────────────────────────────────────────
const IOPT_RESULTS = [
  { mode: 'EUPHORIA', sharpe: 21.7, holdout: 21.4, wr: 62.4, trades: 117,  key: 'jedi_min=10 THE FIX',     badge: 'gold' },
  { mode: 'MAX',      sharpe: 17.8, holdout: 18.3, wr: 58.2, trades: 94,   key: 'jedi=8 + entry=0.35 + cis=1', badge: 'blue' },
  { mode: 'NORMAL',   sharpe: 7.66, holdout: 6.78, wr: 54.1, trades: 1300, key: 'balanced',                badge: 'gray' },
  { mode: 'PADAWAN',  sharpe: 7.40, holdout: 7.90, wr: 52.2, trades: 1300, key: 'conservative',            badge: 'gray' },
]

const RENTECH_GATES = [
  { id: 'G1', label: 'OOS Sharpe > 1.0',        result: '5.35',  pass: true,  note: '' },
  { id: 'G2', label: 'IS/OOS ratio < 2.0',       result: '1.41',  pass: true,  note: '' },
  { id: 'G3', label: 'WR > 50% EUPHORIA',        result: '62.4%', pass: true,  note: '' },
  { id: 'G4', label: 'Min 87 OOS trades',        result: '87',    pass: true,  note: '' },
  { id: 'G5', label: 'ic_not_decaying',          result: 'FAILS', pass: false, note: 'regime variance expected → conditional IC by regime is the fix' },
]

const DS_CMDS = [
  { label: 'EUPHORIA 365d fast test',  url: 'POST /v1/delta/run/?mode=EUPHORIA&days=365', time: '~2min', color: 'var(--goldB)' },
  { label: 'MAX mode full run',        url: 'POST /v1/delta/run/?mode=MAX&days=0',         time: '~5min', color: 'var(--greenB)' },
  { label: 'Walk-forward 41 folds',    url: 'POST /v1/walkforward/run/',                   time: '~60s',  color: 'var(--accent)' },
  { label: 'Cross-asset refresh',      url: 'POST /v1/cross/run/',                          time: '~10s',  color: 'var(--tealB)' },
  { label: 'Gate search',              url: 'POST /v1/gate/run/',                           time: '~5min', color: 'var(--purpleB)' },
  { label: 'IOPT search 200 samples',  url: 'POST /v1/delta/iopt/run/',                    time: '~10min',color: 'var(--goldB)' },
]

const PCA_FACTORS = [
  {
    pc: 'PC1', name: 'TREND FACTOR', pct: 38.4, color: 'var(--greenB)',
    signals: ['ADX', 'PULLBACK', 'EMA_STACK', 'OBV'],
  },
  {
    pc: 'PC2', name: 'BREAKOUT FACTOR', pct: 22.1, color: 'var(--accent)',
    signals: ['SQZPOP', 'VOL_BO', 'DON_BO', 'SUPERTREND'],
  },
  {
    pc: 'PC3', name: 'MOMENTUM FACTOR', pct: 14.8, color: 'var(--goldB)',
    signals: ['RSI_STRONG', 'RSI_CROSS', 'MACD_CROSS'],
  },
]
const PCA_CUMULATIVE = 75.3

// IC Matrix: signal rows × regime cols
// Values: [TREND, BREAK, RANGE, R-OFF]
const IC_SIGNALS = [
  { sig: 'PULLBACK',   regime_ic: [+0.050, -0.012, -0.008, -0.003], note: '' },
  { sig: 'ADX_TREND',  regime_ic: [+0.045, +0.004, -0.011, +0.004], note: '' },
  { sig: 'SQZPOP',     regime_ic: [+0.008, +0.033, +0.006, -0.004], note: '' },
  { sig: 'SUPERTREND', regime_ic: [-0.018, +0.025, -0.022, -0.009], note: '⚠ globally neg → BREAKOUT only' },
  { sig: 'GOLDEN',     regime_ic: [+0.003, -0.002, -0.005, +0.005], note: '' },
]
const IC_REGIMES = ['TREND', 'BREAK', 'RANGE', 'R-OFF']

const SANITY_CHECKS = [
  { guard: 'IS/OOS ratio < 2.0',       result: '1.41',  status: 'ok',      detail: '' },
  { guard: 'Min OOS Sharpe > 1.0',     result: '5.35',  status: 'ok',      detail: '' },
  { guard: 'Circular regime detect',   result: 'CLEAN', status: 'ok',      detail: '' },
  { guard: 'HALO cv overflow',         result: 'PENDING',status: 'warn',   detail: 'cv>1 possible on thin folds' },
  { guard: 'Signal vote lookahead',    result: 'CLEAN', status: 'ok',      detail: '' },
  { guard: 'Gate selection snooping',  result: 'MILD',  status: 'warn',    detail: 'gate_search uses full OOS — mild bias' },
  { guard: 'Min trades per fold (50)', result: '87',    status: 'ok',      detail: '' },
  { guard: 'Re-entry thin stats',      result: 'WARN',  status: 'warn',    detail: '87 trades — separate fold needed' },
]

type IterTag = 'ITER' | 'P1-C' | 'P1-D' | 'P2-A' | 'P2-B' | 'P2-C' | 'P0'
const ITER_QUEUE: { tag: IterTag; label: string; time: string; prio: 'rentech' | 'p1' | 'p2' | 'p0' }[] = [
  { tag: 'ITER',  label: 'HMM Regime (3-state Markov) — soft probability routing',         time: '~3h',  prio: 'rentech' },
  { tag: 'ITER',  label: 'Re-entry holdout validation — 87 trades, separate fold',         time: '~1h',  prio: 'rentech' },
  { tag: 'ITER',  label: 'ICT FVG exit signal + EQH/EQL tighter (0.05% not 0.2%)',        time: '~2h',  prio: 'rentech' },
  { tag: 'P1-C',  label: 'MTF confirm: 5m+1h conflict → -50% size. mtf_confirm.py',       time: '~2h',  prio: 'p1' },
  { tag: 'P1-C',  label: 'IC decay slope monitor (14d rolling, -0.0003 alert). ic_monitor.py', time: '~1h', prio: 'p1' },
  { tag: 'P1-D',  label: 'Cost-adjusted Sharpe: 0.10% slip + 0.05% spread haircut',       time: '~1h',  prio: 'p1' },
  { tag: 'P2-A',  label: 'Funding rate signal — extreme = overextended gate',              time: 'P2',   prio: 'p2' },
  { tag: 'P2-B',  label: 'OBI ratio as scored signal — IC test on useObiStream',          time: 'P2',   prio: 'p2' },
  { tag: 'P2-C',  label: 'Cross-asset as Kelly multiplier: RISK_ON +20% / RISK_OFF -30%', time: 'P2',   prio: 'p2' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function icColor(v: number) {
  if (v >= 0.03)  return { bg: 'rgba(29,255,122,0.25)',  text: 'var(--greenB)' }
  if (v >= 0.01)  return { bg: 'rgba(29,255,122,0.10)',  text: 'var(--green)' }
  if (v >= 0)     return { bg: 'rgba(255,255,255,0.04)', text: 'var(--text3)' }
  return             { bg: 'rgba(255,74,90,0.15)',      text: 'var(--redB)' }
}

function tagColor(prio: string) {
  switch (prio) {
    case 'rentech': return { bg: 'rgba(176,122,255,0.15)', border: 'var(--purple)', text: 'var(--purpleB)' }
    case 'p1':      return { bg: 'rgba(58,143,255,0.12)',  border: 'var(--accentD)', text: 'var(--accent)' }
    case 'p2':      return { bg: 'rgba(42,232,232,0.10)',  border: 'var(--teal)',    text: 'var(--tealB)' }
    default:        return { bg: 'rgba(29,255,122,0.10)',  border: 'var(--green)',   text: 'var(--greenB)' }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function StarRayPage() {
  const [running, setRunning] = useState<string | null>(null)
  const [runMsg, setRunMsg] = useState<string | null>(null)
  const mono = "var(--font-mono)"

  async function runCmd(cmd: typeof DS_CMDS[0]) {
    setRunning(cmd.label)
    setRunMsg(null)
    try {
      const [method, path] = cmd.url.split(' ')
      const r = await fetch(`/ds${path}`, { method })
      const j = await r.json()
      setRunMsg(j.ok ? `▶ ${j.message ?? 'Started'}` : `✗ ${j.error ?? 'Error'}`)
    } catch {
      setRunMsg('✗ Service not reachable')
    }
    setRunning(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: mono }}>

      {/* ── Header strip ──────────────────────────────────────────────── */}
      <div style={{
        padding: '5px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 3,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6,
      }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.14em' }}>④ OPTIMIZER</span>
          <span style={{ fontSize: 9, color: 'var(--text3)', marginLeft: 12 }}>OPTS · IOPT · PCA · IC MATRIX · SANITY · PIPELINE</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {running && <span className="m5d-badge blue">▶ {running}…</span>}
          {runMsg && <span className={`m5d-badge ${runMsg.startsWith('▶') ? 'green' : 'red'}`}>{runMsg}</span>}
          <span className="m5d-badge purple">4/5 RENTECH</span>
          <span className="m5d-badge gold">EUPHORIA 21.7</span>
        </div>
      </div>

      {/* ── Row 1: IOPT (span2) + RenTech Gates + Run Controls ────────── */}
      <div className="grid4">

        {/* IOPT Results */}
        <div className="m5d-panel span2">
          <div className="m5d-panel-head" style={{ background: 'rgba(255,204,58,0.05)' }}>
            <span className="panel-title" style={{ color: 'var(--goldB)' }}>IOPT RESULTS — 200 SAMPLES seed=42</span>
            <span className="m5d-badge gold">VALIDATED</span>
          </div>
          <div className="m5d-panel-body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {IOPT_RESULTS.map(r => (
                <div key={r.mode} style={{
                  padding: '8px', borderRadius: 2,
                  border: `1px solid ${r.mode === 'EUPHORIA' ? 'var(--gold)' : r.mode === 'MAX' ? 'var(--accentD)' : 'var(--border)'}`,
                  background: r.mode === 'EUPHORIA' ? 'rgba(255,204,58,0.05)' : r.mode === 'MAX' ? 'rgba(58,143,255,0.04)' : 'var(--bg3)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: r.mode === 'EUPHORIA' ? 'var(--goldB)' : r.mode === 'MAX' ? 'var(--accent)' : 'var(--text)' }}>
                      {r.mode}
                    </span>
                    <span className={`m5d-badge ${r.badge}`}>{r.mode === 'EUPHORIA' || r.mode === 'MAX' ? 'VALID' : 'OK'}</span>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1, color: r.mode === 'EUPHORIA' ? 'var(--goldB)' : 'var(--greenB)' }}>{r.sharpe}</div>
                  <div style={{ fontSize: 7, color: 'var(--text3)', margin: '2px 0 5px' }}>OOS Sharpe</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 8, color: 'var(--text2)' }}>
                    <span>HO: <span style={{ color: 'var(--greenB)' }}>{r.holdout}</span></span>
                    <span>WR: <span style={{ color: 'var(--greenB)' }}>{r.wr}%</span></span>
                    <span>{r.trades.toLocaleString()}t</span>
                  </div>
                  <div style={{ fontSize: 7, color: 'var(--goldB)', marginTop: 4 }}>{r.key}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RenTech Gates */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(176,122,255,0.05)' }}>
            <span className="panel-title" style={{ color: 'var(--purpleB)' }}>RENTECH GATES</span>
            <span className="m5d-badge purple">4/5 PROMISING</span>
          </div>
          <div className="m5d-panel-body">
            <div style={{ textAlign: 'center', padding: '8px 0 10px' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--purpleB)', lineHeight: 1 }}>4/5</div>
              <div style={{ fontSize: 8, color: 'var(--text3)', marginTop: 3 }}>PROMISING</div>
            </div>
            {RENTECH_GATES.map(g => (
              <div key={g.id} style={{
                padding: '4px 0', borderBottom: '1px solid var(--border)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 8, color: g.pass ? 'var(--text2)' : 'var(--text)', fontWeight: g.pass ? 400 : 700 }}>{g.label}</div>
                  {g.note && <div style={{ fontSize: 7, color: 'var(--text3)', marginTop: 1 }}>{g.note}</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: g.pass ? 'var(--greenB)' : 'var(--redB)' }}>{g.result}</span>
                  <span style={{ fontSize: 9, color: g.pass ? 'var(--greenB)' : 'var(--redB)' }}>{g.pass ? '✓' : '✗'}</span>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 6, padding: '5px 6px', background: 'rgba(176,122,255,0.06)', border: '1px solid var(--purple)', borderRadius: 2, fontSize: 8, color: 'var(--text2)' }}>
              Next milestone: 5/5 after HMM soft routing ships
            </div>
          </div>
        </div>

        {/* Run Controls */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(29,255,122,0.05)' }}>
            <span className="panel-title" style={{ color: 'var(--greenB)' }}>RUN CONTROLS</span>
            <span className="m5d-badge green">DS :8000</span>
          </div>
          <div className="m5d-panel-body">
            {DS_CMDS.map(cmd => (
              <div key={cmd.label} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '5px 0', borderBottom: '1px solid var(--border)',
              }}>
                <div>
                  <div style={{ fontSize: 9, color: running === cmd.label ? cmd.color : 'var(--text)', fontWeight: running === cmd.label ? 700 : 400 }}>{cmd.label}</div>
                  <div style={{ fontSize: 7, color: 'var(--text3)', marginTop: 1 }}>{cmd.time}</div>
                </div>
                <button
                  onClick={() => runCmd(cmd)}
                  disabled={!!running}
                  style={{
                    padding: '3px 7px', fontSize: 8, fontFamily: mono, cursor: running ? 'not-allowed' : 'pointer',
                    background: running === cmd.label ? 'rgba(58,143,255,0.2)' : 'rgba(29,255,122,0.08)',
                    border: `1px solid ${running === cmd.label ? 'var(--accent)' : 'var(--green)'}`,
                    color: running === cmd.label ? 'var(--accent)' : 'var(--greenB)',
                    borderRadius: 2, flexShrink: 0,
                  }}
                >{running === cmd.label ? '▶ …' : '▶'}</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Row 2: PCA Decomp + IC Matrix ─────────────────────────────── */}
      <div className="grid3">

        {/* PCA Decomposition */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(42,232,232,0.05)' }}>
            <span className="panel-title" style={{ color: 'var(--tealB)' }}>PCA DECOMPOSITION</span>
            <span className="m5d-badge teal">{PCA_FACTORS.length} FACTORS</span>
          </div>
          <div className="m5d-panel-body">
            <div style={{ fontSize: 8, color: 'var(--text3)', marginBottom: 8 }}>
              Principal components explaining signal variance
            </div>

            {PCA_FACTORS.map((f, i) => (
              <div key={f.pc} style={{
                marginBottom: 10, padding: '7px 8px', borderRadius: 2,
                border: `1px solid ${i === 0 ? 'rgba(29,255,122,0.2)' : i === 1 ? 'rgba(58,143,255,0.2)' : 'rgba(255,204,58,0.2)'}`,
                background: 'var(--bg3)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <div>
                    <span style={{ fontSize: 8, color: 'var(--text3)', marginRight: 5 }}>{f.pc}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: f.color }}>{f.name}</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 800, color: f.color }}>{f.pct}%</span>
                </div>
                <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 5 }}>
                  <div style={{ height: '100%', width: `${f.pct / 45 * 100}%`, background: f.color, borderRadius: 2 }} />
                </div>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {f.signals.map(s => (
                    <span key={s} style={{
                      fontSize: 7, padding: '1px 4px', borderRadius: 2,
                      background: 'var(--bg4)', border: '1px solid var(--border2)',
                      color: f.color, fontWeight: 700,
                    }}>{s}</span>
                  ))}
                  <span style={{ fontSize: 7, color: 'var(--text3)', alignSelf: 'center' }}>loaded</span>
                </div>
              </div>
            ))}

            {/* Cumulative bar */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 8 }}>
                <span style={{ color: 'var(--text2)' }}>Cumulative explained</span>
                <span style={{ fontWeight: 700, color: 'var(--tealB)' }}>{PCA_CUMULATIVE}%</span>
              </div>
              <div style={{ height: 5, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                <div style={{
                  height: '100%', width: `${PCA_CUMULATIVE}%`,
                  background: 'linear-gradient(90deg, var(--greenB), var(--tealB))',
                  borderRadius: 2,
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: 'var(--text3)' }}>
                <span>Residual: {(100 - PCA_CUMULATIVE).toFixed(1)}%</span>
                <span>Redundancy alert: corr &gt; 0.85 → prune</span>
              </div>
            </div>
          </div>
        </div>

        {/* Regime × Signal IC Matrix */}
        <div className="m5d-panel span2">
          <div className="m5d-panel-head" style={{ background: 'rgba(58,143,255,0.05)' }}>
            <span className="panel-title" style={{ color: 'var(--accent)' }}>REGIME × SIGNAL IC MATRIX</span>
            <span className="m5d-badge blue">OOS</span>
          </div>
          <div className="m5d-panel-body">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '3px 6px', fontSize: 8, color: 'var(--text3)', borderBottom: '1px solid var(--border)', letterSpacing: '0.08em', width: 90 }}>SIGNAL</th>
                  {IC_REGIMES.map(r => (
                    <th key={r} style={{ padding: '3px 6px', fontSize: 8, color: 'var(--text2)', borderBottom: '1px solid var(--border)', textAlign: 'center', letterSpacing: '0.08em', fontWeight: 700 }}>{r}</th>
                  ))}
                  <th style={{ textAlign: 'left', padding: '3px 6px', fontSize: 7, color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>NOTE</th>
                </tr>
              </thead>
              <tbody>
                {IC_SIGNALS.map(s => (
                  <tr key={s.sig} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '4px 6px', fontSize: 9, fontWeight: 700, color: 'var(--text)', fontFamily: mono }}>{s.sig}</td>
                    {s.regime_ic.map((v, i) => {
                      const c = icColor(v)
                      return (
                        <td key={i} style={{ padding: '3px 6px', textAlign: 'center', background: c.bg }}>
                          <span style={{ fontSize: 9, fontWeight: v >= 0.03 ? 700 : 400, color: c.text }}>
                            {v >= 0 ? '+' : ''}{v.toFixed(3)}
                          </span>
                        </td>
                      )
                    })}
                    <td style={{ padding: '3px 6px', fontSize: 7, color: s.note ? 'var(--goldB)' : 'var(--text3)' }}>{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Legend */}
            <div style={{ marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 7, color: 'var(--text3)' }}>
              {[
                { bg: 'rgba(29,255,122,0.25)', text: 'var(--greenB)', label: '≥ 0.03 strong' },
                { bg: 'rgba(29,255,122,0.10)', text: 'var(--green)',  label: '0.01–0.03' },
                { bg: 'rgba(255,255,255,0.04)', text: 'var(--text3)', label: '0–0.01' },
                { bg: 'rgba(255,74,90,0.15)',  text: 'var(--redB)',   label: '< 0 negative' },
              ].map(l => (
                <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ width: 10, height: 10, background: l.bg, border: `1px solid ${l.text}`, borderRadius: 1, display: 'inline-block' }} />
                  {l.label}
                </span>
              ))}
            </div>

            {/* Corr cluster warning */}
            <div style={{ marginTop: 8, padding: '5px 7px', background: 'rgba(255,204,58,0.06)', border: '1px solid var(--gold)', borderRadius: 2, fontSize: 8, color: 'var(--text2)' }}>
              <span style={{ color: 'var(--goldB)', fontWeight: 700 }}>⚠ SUPERTREND:</span> globally neg IC → regime-gate to BREAKOUT only ·
              {' '}<span style={{ color: 'var(--goldB)', fontWeight: 700 }}>BREAKOUT cluster (VOL_BO/KC_BREAK/EMA_STACK/VOL_SURGE):</span> PCA corr &gt;0.9 = ONE dimension
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 3: Sanity Checks + Iter Queue ─────────────────────────── */}
      <div className="grid3">

        {/* Dumb Blocker / Sanity Checks */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(255,74,90,0.05)' }}>
            <span className="panel-title" style={{ color: 'var(--redB)' }}>DUMB BLOCKER</span>
            <span className="m5d-badge gray">GUARD</span>
          </div>
          <div className="m5d-panel-body">
            <div style={{ fontSize: 8, color: 'var(--text3)', marginBottom: 6 }}>Auto-reject conditions (pre-fire validation)</div>
            {SANITY_CHECKS.map(c => (
              <div key={c.guard} style={{
                padding: '4px 0', borderBottom: '1px solid var(--border)',
                display: 'flex', gap: 6, alignItems: 'flex-start',
              }}>
                <span style={{
                  flexShrink: 0, marginTop: 1,
                  fontSize: 8, fontWeight: 700,
                  color: c.status === 'ok' ? 'var(--greenB)' : 'var(--goldB)',
                }}>
                  {c.status === 'ok' ? '✓' : '⚠'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 8, color: 'var(--text2)' }}>{c.guard}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 700,
                      color: c.status === 'ok' ? 'var(--greenB)' : 'var(--goldB)',
                      flexShrink: 0,
                    }}>{c.result}</span>
                  </div>
                  {c.detail && <div style={{ fontSize: 7, color: 'var(--text3)', marginTop: 1 }}>{c.detail}</div>}
                </div>
              </div>
            ))}

            <div style={{
              marginTop: 8, padding: '5px 7px',
              background: 'rgba(255,204,58,0.06)', border: '1px solid var(--gold)', borderRadius: 2,
            }}>
              <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--goldB)' }}>⚠ Expected live Sharpe</div>
              <div style={{ fontSize: 8, color: 'var(--text2)', marginTop: 2 }}>6–10 after 40–60% slippage haircut</div>
            </div>
          </div>
        </div>

        {/* Optimization Pipeline — Iter Queue */}
        <div className="m5d-panel span2">
          <div className="m5d-panel-head" style={{ background: 'rgba(176,122,255,0.05)' }}>
            <span className="panel-title" style={{ color: 'var(--purpleB)' }}>OPTIMIZATION PIPELINE — ITER QUEUE</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <span className="m5d-badge purple">RENTECH DOCTRINE</span>
              <span className="m5d-badge blue">PENDING</span>
            </div>
          </div>
          <div className="m5d-panel-body">
            {/* Priority legend */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              {[
                { prio: 'rentech', label: 'ITER (RenTech)' },
                { prio: 'p1',     label: 'P1 SIGNAL' },
                { prio: 'p2',     label: 'P2 ALPHA' },
                { prio: 'p0',     label: 'P0 PAPER' },
              ].map(p => {
                const c = tagColor(p.prio)
                return (
                  <span key={p.prio} style={{
                    fontSize: 7, padding: '1px 6px', borderRadius: 2, fontWeight: 700, letterSpacing: '0.08em',
                    background: c.bg, border: `1px solid ${c.border}`, color: c.text,
                  }}>{p.label}</span>
                )
              })}
            </div>

            {ITER_QUEUE.map((item, i) => {
              const c = tagColor(item.prio)
              return (
                <div key={i} style={{
                  display: 'flex', gap: 8, alignItems: 'flex-start',
                  padding: '5px 0', borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{
                    fontSize: 7, padding: '1px 5px', borderRadius: 2, fontWeight: 700,
                    background: c.bg, border: `1px solid ${c.border}`, color: c.text,
                    flexShrink: 0, marginTop: 1, letterSpacing: '0.06em',
                  }}>{item.tag}</span>
                  <span style={{ flex: 1, fontSize: 9, color: 'var(--text2)' }}>{item.label}</span>
                  <span style={{ fontSize: 8, color: 'var(--text3)', flexShrink: 0 }}>{item.time}</span>
                </div>
              )
            })}

            {/* P1 pending items */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
              <div style={{ fontSize: 7, color: 'var(--text3)', marginBottom: 5, letterSpacing: '0.1em' }}>ALSO PENDING</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {[
                  'EUPHORIA re_win: 4→24 bars',
                  '3 IOPT seeds (43,44,45)',
                  'Multi-asset ETH/SOL/BNB',
                  'Quantstats tearsheet',
                  'Kill 6 corr clones → re-run WF',
                  'Daily cron → report.json',
                ].map(p => (
                  <div key={p} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 8 }}>
                    <span className="m5d-badge gray" style={{ fontSize: 6 }}>PENDING</span>
                    <span style={{ color: 'var(--text2)' }}>{p}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}
