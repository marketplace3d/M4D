import { useEffect, useState } from 'react'
import type { CouncilSnapshot, CrossAssetReport, ActivityReport, GateReport } from '../types'

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
  gateReport:      GateReport | null
  open?:           boolean
  onOpenChange?:   (v: boolean) => void
}

export default function RightRail({ council, crossAsset, activity, gateReport, open: openProp, onOpenChange }: Props) {
  const [openLocal, setOpenLocal]   = useState(false)
  const [gatesOpen, setGatesOpen]   = useState(true)
  const [nowMs, setNowMs]           = useState(() => Date.now())
  const mono = "var(--font-mono)"

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

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
  const liveGates = gateReport?.gates ?? []
  const activeGates = liveGates.filter(g => g.enabled).length
  const gatesColor  = activeGates >= 7 ? 'var(--greenB)' : activeGates >= 5 ? 'var(--goldB)' : 'var(--redB)'
  const councilTsMs = council?.timestamp ? Date.parse(council.timestamp) : null
  const councilAgeS = councilTsMs ? Math.max(0, Math.floor((nowMs - councilTsMs) / 1000)) : null
  const councilFresh = councilAgeS !== null && councilAgeS <= 30

  const dataHealth = {
    council: council !== null,
    crossAsset: crossAsset !== null,
    activity: activity !== null,
  }

  function ageLabel(s: number | null): string {
    if (s === null) return '—'
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    const rem = s % 60
    return `${m}m ${rem}s`
  }

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
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:4, marginBottom:8 }}>
          {[
            { label:'COUNCIL', ok:dataHealth.council, hint:dataHealth.council ? (councilFresh ? 'LIVE' : `STALE ${ageLabel(councilAgeS)}`) : 'OFFLINE' },
            { label:'CROSS', ok:dataHealth.crossAsset, hint:dataHealth.crossAsset ? 'LIVE' : 'OFFLINE' },
            { label:'ACT', ok:dataHealth.activity, hint:dataHealth.activity ? 'LIVE' : 'OFFLINE' },
          ].map(s => (
            <div key={s.label} style={{ border:'1px solid var(--border)', borderRadius:2, padding:'3px 4px', background:'var(--bg3)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                <span className={`status-dot ${s.ok ? 'live' : 'dead'}`} />
                <span style={{ fontSize:7, color:'var(--text3)' }}>{s.label}</span>
              </div>
              <div style={{ fontSize:8, fontWeight:700, color:s.ok ? 'var(--greenB)' : 'var(--redB)', marginTop:2 }}>{s.hint}</div>
            </div>
          ))}
        </div>

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
          title="LIVE GATE SNAPSHOT"
          open={gatesOpen}
          onToggle={() => setGatesOpen(o => !o)}
          badge={
            <div style={{ display:'flex', gap:4 }}>
              <span className={`m5d-badge ${activeGates >= 7 ? 'green' : 'gold'}`}>{activeGates}/10 ON</span>
              <span className={`m5d-badge ${gateReport?.ok ? 'green' : 'gold'}`}>{gateReport?.ok ? 'LIVE' : 'CACHED'}</span>
            </div>
          }
        >
          {liveGates.length === 0 && (
            <div style={{ fontSize: 8, color: 'var(--text3)', lineHeight: 1.6 }}>
              No live gate report yet. Open `#pulse` for full controls once feed returns.
            </div>
          )}
          {liveGates.map(g => (
            <div key={g.gate} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1, color: 'var(--text2)', fontSize: 8 }}>{g.gate.toUpperCase()}</span>
              <span className={`m5d-badge ${g.enabled ? 'green' : 'gray'}`} style={{ fontSize: 7 }}>{g.enabled ? 'ON' : 'OFF'}</span>
              <span className={`status-dot ${g.enabled ? 'live' : 'dead'}`} />
            </div>
          ))}
        </Section>

        <div style={{ padding:'8px 10px', borderTop:'1px solid var(--border)', background:'var(--bg2)' }}>
          <div style={{ fontSize:7, color:'var(--text3)', marginBottom:4, letterSpacing:'0.1em' }}>VISIBILITY NOTE</div>
          <div style={{ fontSize:8, color:'var(--text2)', lineHeight:1.6 }}>
            LIVE: Council/Cross/Activity + Gate Snapshot.<br/>
            Use `#pulse` for full execution controls.
          </div>
        </div>
      </div>
    </div>
  )
}
