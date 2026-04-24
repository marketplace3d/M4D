import { useState } from 'react'
import type { CouncilSnapshot, CrossAssetReport, ActivityReport } from '../types'

const EUPHORIA_PARAMS = [
  { key: 'entry_thr',  label: 'ENTRY THR',   val: '0.12'  },
  { key: 'jedi_min',   label: 'JEDI MIN',    val: '10'    },
  { key: 'cis',        label: 'CIS LVL',     val: '2/5'   },
  { key: 'horizon',    label: 'HORIZON',     val: '6 bars' },
  { key: 'be_stop',    label: 'BE STOP',     val: '5 bars' },
  { key: 're_win',     label: 'RE-WIN',      val: '4 bars' },
  { key: 'lots',       label: 'LOTS',        val: '2.5×'  },
  { key: 'mode',       label: 'MODE',        val: 'EUPHORIA' },
]

const GATES = [
  { id: 'hour_kills',   label: 'HOUR_KILLS',    delta: '+2.57', on: true  },
  { id: 'regime_route', label: 'REGIME_ROUTING', delta: '+0.84', on: true  },
  { id: 'squeeze_lock', label: 'SQUEEZE_LOCK',  delta: '+0.93', on: true  },
  { id: 'atr_rank',     label: 'ATR_RANK',      delta: '+0.66', on: true  },
  { id: 'rvol_exhaust', label: 'RVOL_EXHAUST',  delta: '+0.44', on: true  },
  { id: 'low_jedi',     label: 'LOW_JEDI',      delta: '+0.31', on: true  },
  { id: 'day_filter',   label: 'DAY_FILTER',    delta: '+0.73', on: true  },
  { id: 'rvol_gate',    label: 'RVOL_GATE',     delta: '±0.00', on: false },
  { id: 'scalper',      label: 'SCALPER_MODE',  delta: '1.90',  on: false },
  { id: 'euphoria',     label: 'EUPHORIA_ONLY', delta: '19.83', on: false },
]

interface Props {
  council:         CouncilSnapshot | null
  crossAsset:      CrossAssetReport | null
  activity:        ActivityReport  | null
  open?:           boolean
  onOpenChange?:   (v: boolean) => void
}

export default function RightRail({ council, crossAsset, activity, open: openProp, onOpenChange }: Props) {
  const [openLocal, setOpenLocal]   = useState(false)
  const [gatesOpen, setGatesOpen]   = useState(true)
  const [paramsOpen, setParamsOpen] = useState(true)
  const [paramsLocked, setParamsLocked] = useState(true)
  const [gates, setGates]           = useState(GATES)
  const mono = "var(--font-mono)"

  const open    = openProp !== undefined ? openProp : openLocal
  const setOpen = (v: boolean) => { setOpenLocal(v); onOpenChange?.(v) }

  const jedi   = council?.jedi_score ?? null
  const regime = council?.regime ?? null
  const ca     = crossAsset?.regime ?? null
  const act    = activity?.gate_status ?? null

  const jediColor  = jedi === null ? 'var(--text3)' : jedi > 12 ? 'var(--greenB)' : jedi > 0 ? 'var(--goldB)' : jedi < -12 ? 'var(--redB)' : 'var(--text2)'
  const caColor    = ca === 'RISK_ON' ? 'var(--greenB)' : ca === 'RISK_OFF' ? 'var(--redB)' : 'var(--text2)'
  const actColor   = act === 'HOT' ? 'var(--greenB)' : act === 'ALIVE' ? 'var(--green)' : act === 'SLOW' ? 'var(--goldB)' : 'var(--redB)'
  const regColor   = regime === 'TRENDING' ? 'var(--greenB)' : regime === 'BREAKOUT' ? 'var(--accent)' : regime === 'RISK-OFF' ? 'var(--redB)' : 'var(--text3)'
  const activeGates = gates.filter(g => g.on).length
  const gatesColor  = activeGates >= 7 ? 'var(--greenB)' : activeGates >= 5 ? 'var(--goldB)' : 'var(--redB)'

  // ── Collapsed indicator strip ───────────────────────────────────────────────
  if (!open) {
    return (
      <div style={{
        width: 32, minWidth: 32, flexShrink: 0,
        background: 'var(--nav-bg)',
        borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        fontFamily: mono, overflow: 'hidden',
      }}>
        {/* Expand arrow */}
        <div
          onClick={() => setOpen(true)}
          title="Expand algo status"
          style={{
            width: '100%', padding: '10px 0', cursor: 'pointer',
            textAlign: 'center', fontSize: 13, color: 'var(--text3)',
            borderBottom: '1px solid var(--border)',
            transition: 'color 0.15s',
          }}
        >‹</div>

        {/* Vertical indicators */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '10px 0' }}>

          {/* JEDI score — rotated vertical */}
          <div
            title={`JEDI: ${jedi !== null ? (jedi > 0 ? `+${jedi.toFixed(0)}` : jedi.toFixed(0)) : '—'}`}
            style={{
              writingMode: 'vertical-rl', transform: 'rotate(180deg)',
              fontSize: 9, fontWeight: 800, color: jediColor, letterSpacing: '0.06em',
              lineHeight: 1,
            }}
          >
            {jedi !== null ? (jedi > 0 ? `+${Math.round(jedi)}` : String(Math.round(jedi))) : '—'}
          </div>

          <div style={{ width: 20, height: 1, background: 'var(--border)' }} />

          {/* Regime dot */}
          <div
            title={`Regime: ${regime ?? '—'}`}
            style={{ width: 7, height: 7, borderRadius: '50%', background: regColor, boxShadow: `0 0 5px ${regColor}` }}
          />

          {/* Cross-asset dot */}
          <div
            title={`Cross-asset: ${ca ?? '—'}`}
            style={{ width: 7, height: 7, borderRadius: '50%', background: caColor }}
          />

          <div style={{ width: 20, height: 1, background: 'var(--border)' }} />

          {/* Gates count */}
          <div
            title={`${activeGates}/10 gates active`}
            style={{ fontSize: 9, fontWeight: 800, color: gatesColor }}
          >{activeGates}</div>

          {/* Activity dot */}
          <div
            title={`Market: ${act ?? '—'}`}
            style={{ width: 7, height: 7, borderRadius: '50%', background: actColor, boxShadow: `0 0 4px ${actColor}` }}
          />
        </div>
      </div>
    )
  }

  // ── Full panel ──────────────────────────────────────────────────────────────

  const regimeBars = [
    { label: 'TREND',  color: 'var(--greenB)', pct: regime === 'TRENDING' ? 68 : 12 },
    { label: 'BREAK',  color: 'var(--accent)',  pct: regime === 'BREAKOUT' ? 60 : 18 },
    { label: 'RANGE',  color: 'var(--text2)',   pct: regime === 'RANGING'  ? 70 : 14 },
    { label: 'R-OFF',  color: 'var(--redB)',    pct: regime === 'RISK-OFF' ? 55 : 6  },
  ]

  function Section({ title, open: sOpen, onToggle, badge, children }: {
    title: string; open: boolean; onToggle: () => void; badge?: React.ReactNode; children: React.ReactNode
  }) {
    return (
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <div onClick={onToggle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', cursor: 'pointer', background: 'var(--bg3)' }}>
          <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--text2)', letterSpacing: '0.12em' }}>{title}</span>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            {badge}
            <span style={{ fontSize: 9, color: 'var(--text3)' }}>{sOpen ? '▲' : '▼'}</span>
          </div>
        </div>
        {sOpen && <div style={{ padding: '6px 10px' }}>{children}</div>}
      </div>
    )
  }

  return (
    <div style={{
      width: 'var(--right-rail-w)', minWidth: 'var(--right-rail-w)',
      background: 'var(--nav-bg)',
      borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      transition: 'width var(--transition), min-width var(--transition)',
      overflow: 'hidden', flexShrink: 0, fontFamily: mono,
    }}>

      {/* Header */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg3)' }}>
        {/* Collapse arrow — leftmost so it's clear */}
        <span
          onClick={() => setOpen(false)}
          title="Collapse panel"
          style={{ cursor: 'pointer', color: 'var(--text3)', fontSize: 13, padding: '0 2px', lineHeight: 1 }}
        >›</span>
        <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--text2)', letterSpacing: '0.12em', flex: 1 }}>
          ALGO STATUS
        </span>
        <span className={`m5d-badge ${activeGates >= 7 ? 'green' : activeGates >= 5 ? 'gold' : 'red'}`}>
          {activeGates}/10
        </span>
      </div>

      {/* Quick stats */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 7, color: 'var(--text3)', alignSelf: 'flex-end' }}>JEDI</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: jediColor, lineHeight: 1 }}>
            {jedi !== null ? (jedi > 0 ? `+${jedi.toFixed(0)}` : jedi.toFixed(0)) : '—'}
          </span>
        </div>

        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 7, color: 'var(--text3)', marginBottom: 3 }}>REGIME</div>
          {regimeBars.map(r => (
            <div key={r.label} className="regime-bar-row">
              <span className="regime-label" style={{ color: r.color, fontWeight: r.pct > 40 ? 700 : 400 }}>{r.label}</span>
              <div className="regime-track">
                <div className="regime-fill" style={{ width: `${r.pct}%`, background: r.color, opacity: r.pct > 40 ? 1 : 0.4 }} />
              </div>
              <span className="regime-pct" style={{ color: r.pct > 40 ? r.color : 'var(--text3)' }}>{r.pct}%</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 2, padding: '4px 6px' }}>
            <div style={{ fontSize: 7, color: 'var(--text3)' }}>CROSS-ASSET</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: caColor }}>{ca ?? '—'}</div>
          </div>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 2, padding: '4px 6px' }}>
            <div style={{ fontSize: 7, color: 'var(--text3)' }}>MARKET</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: actColor }}>{act ?? '—'}</div>
          </div>
        </div>
      </div>

      {/* Scrollable sections */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <Section
          title="GATE CONTROLS"
          open={gatesOpen}
          onToggle={() => setGatesOpen(o => !o)}
          badge={<span className={`m5d-badge ${activeGates >= 7 ? 'green' : 'gold'}`}>{activeGates} ON</span>}
        >
          {gates.map(g => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1, color: 'var(--text2)', fontSize: 8 }}>{g.label}</span>
              <span className={`m5d-badge ${g.on ? 'green' : 'gray'}`} style={{ fontSize: 7 }}>{g.delta}</span>
              <div className={`m5d-toggle ${g.on ? 'on' : 'off'}`} onClick={() => setGates(gs => gs.map(x => x.id === g.id ? { ...x, on: !x.on } : x))} />
            </div>
          ))}
        </Section>

        <Section title="KELLY SIZING" open={true} onToggle={() => {}}>
          <div style={{ textAlign: 'center', padding: '4px 0 8px' }}>
            <div style={{ fontSize: 7, color: 'var(--text3)', marginBottom: 2 }}>HALF-KELLY ACTIVE</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--greenB)' }}>9.56%</div>
            <div style={{ fontSize: 8, color: 'var(--text2)', marginTop: 2 }}>× 1.20 CA (RISK_ON) = 11.47%</div>
          </div>
          <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ width: '50%', height: '100%', background: 'linear-gradient(90deg, var(--accentD), var(--greenB))', borderRadius: 3 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'var(--text2)' }}>
            <span>FULL: 19.12%</span>
            <span>EUPHORIA: 2-3×</span>
          </div>
        </Section>

        <Section
          title="EUPHORIA PARAMS"
          open={paramsOpen}
          onToggle={() => setParamsOpen(o => !o)}
          badge={
            <button
              onClick={e => { e.stopPropagation(); setParamsLocked(l => !l) }}
              style={{
                padding: '1px 6px', fontSize: 7, fontFamily: mono, cursor: 'pointer',
                background: paramsLocked ? 'rgba(255,74,90,0.1)' : 'rgba(29,255,122,0.1)',
                border: `1px solid ${paramsLocked ? 'var(--red)' : 'var(--green)'}`,
                color: paramsLocked ? 'var(--redB)' : 'var(--greenB)',
                borderRadius: 2,
              }}
            >
              {paramsLocked ? '🔒' : '🔓 EDIT'}
            </button>
          }
        >
          {EUPHORIA_PARAMS.map(p => (
            <div key={p.key} className="stat-row">
              <span className="stat-label">{p.label}</span>
              {paramsLocked ? (
                <span className="stat-val gold">{p.val}</span>
              ) : (
                <input
                  defaultValue={p.val}
                  style={{
                    background: 'var(--bg3)', border: '1px solid var(--accent)', color: 'var(--goldB)',
                    fontSize: 9, fontFamily: mono, padding: '1px 4px', borderRadius: 2, width: 64, textAlign: 'right',
                  }}
                />
              )}
            </div>
          ))}
        </Section>

        <Section title="SHARPE STACK" open={true} onToggle={() => {}}>
          {[
            { label: 'BASELINE',     val: 1.36,  color: 'var(--text2)' },
            { label: '+ROUTING',     val: 5.94,  color: 'var(--text)' },
            { label: '+REGIME',      val: 6.61,  color: 'var(--accent)' },
            { label: '+GATES',       val: 15.86, color: 'var(--greenB)' },
            { label: 'EUPHORIA',     val: 19.83, color: 'var(--goldB)' },
            { label: '★ RE-ENTRY',  val: 29.72, color: 'var(--greenB)' },
          ].map(r => (
            <div key={r.label} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1, fontSize: 8, color: 'var(--text2)' }}>{r.label}</span>
              <div style={{ width: 50, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${(r.val / 29.72) * 100}%`, height: '100%', background: r.color }} />
              </div>
              <span style={{ width: 32, textAlign: 'right', fontWeight: 700, color: r.color, fontSize: 9 }}>{r.val}</span>
            </div>
          ))}
        </Section>
      </div>
    </div>
  )
}
