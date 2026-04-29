import { useCallback, useEffect, useState } from 'react'
import type { Bar } from '$indicators/boom3d-tech'
import { fetchBarsForSymbol } from '@pwa/lib/fetchBars'
import { loadControls, saveControls } from '@pwa/lib/chartControls'
import { obiBoomMinimalControls } from '@pwa/lib/obiBoomMinimalControls'
import { TIMEFRAME_OPTIONS, loadTimeframe, saveTimeframe, type TimeframePreset } from '@pwa/lib/chartTimeframes'
import { useObPressureStream } from '../hooks/useObPressureStream'
import BoomLwChart from '../components/BoomLwChart'
import SteamGovernorHud from '../components/SteamGovernorHud'
import { SoloMasterOrb, type SoloOrbDirection } from '../viz/SoloMasterOrb'
import './TvLwChartsPage.css'

const CRYPTO_SYMS = ['BTC', 'ETH', 'SOL'] as const
type CryptoSym = typeof CRYPTO_SYMS[number]

const TF_SUBSET: TimeframePreset[] = ['1d1m', '5d5m', '1m15m']
const TF_LABELS: Record<string, string> = { '1d1m': '1m', '5d5m': '5m', '1m15m': '15m' }

const PHASE_C = { ACCUMULATION: '#00d4ff', COMPRESSION: '#ff6b00', POP: '#ffffff' } as const

export default function BtcPage() {
  const [sym, setSym]       = useState<CryptoSym>('BTC')
  const [tf, setTf]         = useState<TimeframePreset>(() => {
    const stored = loadTimeframe()
    return TF_SUBSET.includes(stored) ? stored : '1d1m'
  })
  const [bars, setBars]     = useState<Bar[]>([])
  const [err, setErr]       = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [steamOpen, setSteamOpen] = useState(true)
  const [muted, setMuted]   = useState(false)
  const [controls] = useState(() => obiBoomMinimalControls(loadControls()))

  const polygonKey = (import.meta.env.VITE_POLYGON_IO_KEY || import.meta.env.VITE_POLYGON_API_KEY) as string | undefined
  const obPressure = useObPressureStream(sym, polygonKey)

  const load = useCallback(async (s: CryptoSym, t: TimeframePreset) => {
    setLoading(true); setErr(null)
    try {
      const data = await fetchBarsForSymbol(s, polygonKey, t)
      setBars(data)
      if (!data.length) setErr('No bars returned')
    } catch (e) {
      setErr(String(e))
    } finally {
      setLoading(false)
    }
  }, [polygonKey])

  useEffect(() => { void load(sym, tf) }, [sym, tf, load])

  // ── Orb derivation ───────────────────────────────────────────────────────────
  const orbDir: SoloOrbDirection = obPressure.pressure > 0.08 ? 'LONG' : obPressure.pressure < -0.08 ? 'SHORT' : 'FLAT'
  const orbScore = Math.round(obPressure.confidence * 100)
  const orbConv = obPressure.phase === 'POP' ? 92 : obPressure.phase === 'COMPRESSION' ? 68 : 40
  const orbAngle = obPressure.pressure * 90
  const orbArrows = [
    { id: 'Δ',   dir: obPressure.delta  > 0.005 ? 'BULL' : obPressure.delta  < -0.005 ? 'BEAR' : 'NEUTRAL' },
    { id: 'ΔΔ',  dir: obPressure.deltaD > 0.002 ? 'BULL' : obPressure.deltaD < -0.002 ? 'BEAR' : 'NEUTRAL' },
    { id: 'PHS', dir: obPressure.phase === 'POP' ? (obPressure.pressure > 0 ? 'BEAR' : 'BULL') : obPressure.phase === 'COMPRESSION' ? (obPressure.pressure > 0 ? 'BULL' : 'BEAR') : 'NEUTRAL' },
  ] as const

  const phaseColor = PHASE_C[obPressure.phase]
  const pressurePct = Math.abs(obPressure.pressure * 100).toFixed(1)
  const statusDot = obPressure.status === 'live' ? '#4ade80' : obPressure.status === 'error' ? '#f43f5e' : '#60a5fa'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg0)', color: 'var(--fg)', fontFamily: 'var(--font-mono, monospace)' }}>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg1)', flexShrink: 0 }}>

        {/* Symbol pills */}
        <div style={{ display: 'flex', gap: 3 }}>
          {CRYPTO_SYMS.map(s => (
            <button key={s} type="button"
              onClick={() => setSym(s)}
              style={{ padding: '2px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', borderRadius: 3, border: 'none', cursor: 'pointer', background: sym === s ? 'var(--accent)' : 'var(--bg2)', color: sym === s ? '#000' : 'var(--fg-dim)' }}>
              {s}
            </button>
          ))}
        </div>

        {/* TF pills */}
        <div style={{ display: 'flex', gap: 3 }}>
          {TF_SUBSET.map(t => (
            <button key={t} type="button"
              onClick={() => { setTf(t); saveTimeframe(t) }}
              style={{ padding: '2px 8px', fontSize: 10, fontWeight: 600, borderRadius: 3, border: 'none', cursor: 'pointer', background: tf === t ? 'var(--gold)' : 'var(--bg2)', color: tf === t ? '#000' : 'var(--fg-dim)' }}>
              {TF_LABELS[t]}
            </button>
          ))}
        </div>

        {/* Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--fg-dim)' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusDot }} />
          {obPressure.status.toUpperCase()}
        </div>

        {/* Phase + pressure */}
        <div style={{ fontSize: 10, color: phaseColor, fontWeight: 700, letterSpacing: '0.08em' }}>
          {obPressure.phase} {obPressure.pressure >= 0 ? '▲' : '▼'} {pressurePct}%
          {obPressure.exhausted && <span style={{ color: '#fff', marginLeft: 4, animation: 'blink 0.5s step-end infinite' }}>⚠ EXHAUSTED</span>}
        </div>

        <div style={{ flex: 1 }} />

        {/* Reload */}
        <button type="button" onClick={() => void load(sym, tf)}
          style={{ padding: '2px 8px', fontSize: 10, borderRadius: 3, border: 'none', cursor: 'pointer', background: 'var(--bg2)', color: 'var(--fg-dim)' }}>
          ↺
        </button>

        {/* Mute */}
        <button type="button" onClick={() => setMuted(m => !m)} title="mute audio"
          style={{ padding: '2px 6px', fontSize: 11, borderRadius: 3, border: 'none', cursor: 'pointer', background: muted ? 'var(--bg2)' : 'var(--bg3, var(--bg2))', color: muted ? 'var(--fg-dim)' : 'var(--accent)' }}>
          {muted ? '🔇' : '🔊'}
        </button>

        {/* Steam toggle */}
        <button type="button" onClick={() => setSteamOpen(v => !v)} title="Steam Governor"
          style={{ padding: '2px 8px', fontSize: 11, borderRadius: 3, border: 'none', cursor: 'pointer', background: steamOpen ? 'rgba(255,106,0,0.18)' : 'var(--bg2)', color: steamOpen ? '#ff6a00' : 'var(--fg-dim)', fontWeight: 700 }}>
          ♨
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left: Orb + Chart */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Mini orb + pressure strip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 12px', background: 'var(--bg1)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <SoloMasterOrb
              direction={orbDir}
              score={orbScore}
              conviction={orbConv}
              strengthPct={orbConv}
              bigArrowAngleDeg={orbAngle}
              signalArrows={orbArrows.map(a => ({ ...a, dir: a.dir as 'BULL' | 'BEAR' | 'NEUTRAL' }))}
              density="focus"
            />

            {/* Δ / ΔΔ strip */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--fg-dim)', width: 20 }}>Δ</span>
                <div style={{ width: 80, height: 6, background: 'var(--bg2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, Math.abs(obPressure.delta) * 5000)}%`, height: '100%', background: obPressure.delta >= 0 ? '#4ade80' : '#f43f5e', borderRadius: 3, transition: 'width 0.3s, background 0.3s' }} />
                </div>
                <span style={{ color: obPressure.delta >= 0 ? '#4ade80' : '#f43f5e', minWidth: 40 }}>{(obPressure.delta * 1000).toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--fg-dim)', width: 20 }}>ΔΔ</span>
                <div style={{ width: 80, height: 6, background: 'var(--bg2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, Math.abs(obPressure.deltaD) * 10000)}%`, height: '100%', background: obPressure.exhausted ? '#fff' : obPressure.deltaD >= 0 ? '#4ade80' : '#f43f5e', borderRadius: 3, transition: 'width 0.3s, background 0.3s' }} />
                </div>
                <span style={{ color: obPressure.exhausted ? '#fff' : obPressure.deltaD >= 0 ? '#4ade80' : '#f43f5e', minWidth: 40 }}>{(obPressure.deltaD * 1000).toFixed(2)}</span>
              </div>
            </div>

            {/* Confidence arc */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div style={{ fontSize: 9, color: 'var(--fg-dim)' }}>CONF</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: phaseColor }}>{orbScore}%</div>
            </div>

            {loading && <div style={{ fontSize: 10, color: 'var(--fg-dim)', marginLeft: 8 }}>loading…</div>}
            {err && <div style={{ fontSize: 10, color: '#f43f5e', marginLeft: 8 }}>{err}</div>}
          </div>

          {/* Chart */}
          <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
            <BoomLwChart
              bars={bars}
              controls={controls}
              fitContainer
              symbol={sym}
              polygonKey={polygonKey}
              ltViz={{ obPressure: obPressure.pressure, obConfidence: obPressure.confidence }}
            />
          </div>
        </div>

        {/* Right: Steam Governor panel */}
        {steamOpen && (
          <div style={{ width: 308, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--bg1)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <SteamGovernorHud
              obPressure={obPressure}
              onClose={() => setSteamOpen(false)}
              muted={muted}
            />
          </div>
        )}
      </div>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
      `}</style>
    </div>
  )
}
