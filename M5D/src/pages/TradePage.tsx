import { useState } from 'react'
import type { CouncilSnapshot } from '../types'

const PRELOAD = [
  { label: 'ENTRY THR',  val: '0.12',    key: 'entry_thr' },
  { label: 'JEDI MIN',   val: '10',      key: 'jedi_min'  },
  { label: 'CIS LEVEL',  val: '2',       key: 'cis'       },
  { label: 'HORIZON',    val: '6',       key: 'horizon'   },
  { label: 'LOT SIZE',   val: '2.5',     key: 'lots'      },
  { label: 'MODE',       val: 'EUPHORIA',key: 'mode'      },
]

interface Props { council: CouncilSnapshot | null }

export default function TradePage({ council }: Props) {
  const [fireReady, setFireReady] = useState(false)
  const [reasoning] = useState([
    { role: 'sys',    text: 'All gates clear. JEDI +14. EUPHORIA conditions: checking…' },
    { role: 'claude', text: 'Regime: TRENDING. OBI: BID_HEAVY (0.58). Cross-asset: RISK_ON. Activity: HOT. All 7 gates ON. Entry threshold met.' },
    { role: 'sys',    text: 'Pre-trade checklist: ✓ SQUEEZE clear ✓ ATR rank 72pct ✓ RVOL 1.47× ✓ Hour OK ✓ MTF AGREE' },
    { role: 'claude', text: 'RECOMMENDATION: LONG BTC. EUPHORIA trigger criteria MET. Kelly: 9.56% × 1.20 CA = 11.47%. CIS horizon: 6 bars.' },
  ])

  const jedi   = council?.jedi_score ?? 0
  const regime = council?.regime ?? 'NEUTRAL'
  const longs  = council?.total_long  ?? 0
  const shorts = council?.total_short ?? 0

  const canFire = jedi > 10 && regime !== 'RISK-OFF'
  const mono = "var(--font-mono)"

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Title */}
      <div style={{
        padding: '6px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 3,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: mono,
      }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.14em' }}>③ TRADE</span>
          <span style={{ fontSize: 9, color: 'var(--text3)', marginLeft: 12 }}>ARB SCORE · FIRE · BLOTTER · AI REASONING</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <span className={`m5d-badge ${canFire ? 'green' : 'gray'}`}>{canFire ? '✓ CONDITIONS MET' : '○ AWAITING SIGNAL'}</span>
          <span className="m5d-badge gray">PAPER MODE</span>
        </div>
      </div>

      <div className="grid3">
        {/* Arb score */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(255,204,58,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--goldB)' }}>ARB SCORE</span>
            <span className="m5d-badge gold">COMPOSITE</span>
          </div>
          <div className="m5d-panel-body" style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: 42, fontWeight: 800, fontFamily: mono, lineHeight: 1.1, padding: '12px 0',
              color: canFire ? 'var(--greenB)' : 'var(--text2)',
            }}>
              {jedi > 0 ? `+${jedi.toFixed(0)}` : jedi.toFixed(0)}
            </div>
            <div style={{ fontSize: 8, color: 'var(--text3)', marginBottom: 12 }}>JEDI SCORE / 27 VOTES</div>
            <div style={{
              display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12,
            }}>
              <span className="m5d-badge green">▲ {longs} LONG</span>
              <span className="m5d-badge red">▼ {shorts} SHORT</span>
              <span className="m5d-badge" style={{ border: `1px solid ${regime === 'TRENDING' ? 'var(--green)' : 'var(--border)'}`, color: regime === 'TRENDING' ? 'var(--greenB)' : 'var(--text2)', background: 'transparent', fontSize: 8, padding: '1px 5px' }}>{regime}</span>
            </div>
            {/* Fire button */}
            <button
              onClick={() => setFireReady(r => !r)}
              disabled={!canFire}
              style={{
                width: '100%', padding: '10px', borderRadius: 2,
                fontFamily: mono, fontSize: 11, fontWeight: 700, letterSpacing: '0.15em',
                cursor: canFire ? 'pointer' : 'not-allowed',
                background: canFire ? (fireReady ? 'rgba(255,100,0,0.15)' : 'rgba(29,255,122,0.1)') : 'transparent',
                border: `1px solid ${canFire ? (fireReady ? '#ff6600' : 'var(--green)') : 'var(--border)'}`,
                color: canFire ? (fireReady ? '#ff8800' : 'var(--greenB)') : 'var(--text3)',
                transition: 'all 0.2s',
              }}
            >
              {!canFire ? '○ WAITING FOR SIGNAL' : fireReady ? '▶ CONFIRM FIRE ORDER' : '● ARM TRADE'}
            </button>
          </div>
        </div>

        {/* Preloaded values */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(58,143,255,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--accent)' }}>PRELOADED PARAMS</span>
            <span className="m5d-badge blue">EUPHORIA</span>
          </div>
          <div className="m5d-panel-body">
            {PRELOAD.map(p => (
              <div key={p.key} className="stat-row">
                <span className="stat-label">{p.label}</span>
                <span className="stat-val gold">{p.val}</span>
              </div>
            ))}
            <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
            {[
              { label: 'IOPT Sharpe',   val: '21.7', color: 'var(--goldB)' },
              { label: 'OOS Holdout',   val: '21.4', color: 'var(--greenB)' },
              { label: 'WR',            val: '62.4%', color: 'var(--greenB)' },
              { label: 'Trades/yr',     val: '117', color: 'var(--text)' },
              { label: 'jedi_min FIX',  val: '10 ← key', color: 'var(--goldB)' },
            ].map(r => (
              <div key={r.label} className="stat-row">
                <span className="stat-label">{r.label}</span>
                <span className="stat-val" style={{ color: r.color }}>{r.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* AI reasoning */}
        <div className="m5d-panel">
          <div className="m5d-panel-head" style={{ background: 'rgba(176,122,255,0.06)' }}>
            <span className="panel-title" style={{ color: 'var(--purpleB)' }}>AI REASONING</span>
            <span className="m5d-badge purple">CLAUDE</span>
          </div>
          <div className="m5d-panel-body" style={{ padding: '6px 8px' }}>
            {reasoning.map((m, i) => (
              <div
                key={i}
                style={{
                  padding: '4px 6px', marginBottom: 4, borderRadius: 2, fontSize: 9, lineHeight: 1.5,
                  background: m.role === 'claude' ? 'rgba(176,122,255,0.1)' : 'var(--bg3)',
                  borderLeft: `2px solid ${m.role === 'claude' ? 'var(--purpleB)' : 'var(--border2)'}`,
                  color: m.role === 'claude' ? 'var(--text)' : 'var(--text2)',
                }}
              >{m.text}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Blotter placeholder */}
      <div className="m5d-panel fullspan">
        <div className="m5d-panel-head" style={{ background: 'rgba(58,143,255,0.06)' }}>
          <span className="panel-title" style={{ color: 'var(--accent)' }}>PAPER BLOTTER</span>
          <span className="m5d-badge blue">ALPACA + IBKR</span>
        </div>
        <div className="m5d-panel-body" style={{ padding: '10px', color: 'var(--text3)', fontSize: 9, textAlign: 'center' }}>
          Paper blotter — wire to /v1/audit/order-intent/?broker=all
        </div>
      </div>
    </div>
  )
}
