import { useState } from 'react'
import ObiPage from './ObiPage'

const DS = (typeof import.meta !== 'undefined' && (import.meta as { env?: { VITE_DS_URL?: string } }).env?.VITE_DS_URL)
  || 'http://127.0.0.1:8000'

/** Sim matrix (all 27+ algos) + ICTSMC opt-level backtest — DS :8000 */
function SimIctPanel() {
  const [out, setOut] = useState<unknown>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [uAsset, setUAsset] = useState('BTC')
  const [uStart, setUStart] = useState('2020-01-01')
  const [uEnd, setUEnd] = useState('2023-12-01')
  const [allAlgos, setAllAlgos] = useState(true)
  const [tlist, setTlist] = useState('off')
  const [uAlgos, setUAlgos] = useState('DON_BO,EMA_STACK,RSI_CROSS')

  const [iAsset, setIAsset] = useState('BTC')
  const [iStart, setIStart] = useState('2018-01-01')
  const [iEnd, setIEnd] = useState('2024-01-01')
  const [iTrade, setITrade] = useState(true)
  const [iKz, setIKz] = useState(false)
  const [iGate, setIGate] = useState(false)
  const [iRetest, setIRetest] = useState<'loose' | 'strict'>('loose')
  const [iHold, setIHold] = useState(5)
  const [iStop, setIStop] = useState(1.5)
  const [iTp, setITp] = useState(2.0)

  const runUniverse = async (forceAllAlgos?: boolean) => {
    setBusy(true)
    setErr(null)
    setOut(null)
    const useAll = forceAllAlgos === true || allAlgos
    try {
      const q = new URLSearchParams({
        asset: uAsset,
        start: uStart,
        end: uEnd,
        interval: '1d',
        all_algos: useAll ? '1' : '0',
        trades_list: tlist,
        min_trades: '2',
        sample_per: '15',
      })
      if (!useAll && uAlgos.trim()) q.set('algos', uAlgos.replace(/\s+/g, ''))
      const r = await fetch(`${DS}/v1/sim/universe/?${q.toString()}`)
      const j = await r.json()
      if (!r.ok) throw new Error((j as { error?: string }).error || r.statusText)
      setOut(j)
      if (forceAllAlgos) setAllAlgos(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const runIctsmc = async () => {
    setBusy(true)
    setErr(null)
    setOut(null)
    try {
      const q = new URLSearchParams({
        asset: iAsset,
        start: iStart,
        end: iEnd,
        interval: '1d',
        trade: iTrade ? '1' : '0',
        e_kz: iKz ? '1' : '0',
        e_gate: iGate ? '1' : '0',
        e_bias: '1',
        retest: iRetest,
        hold: String(iHold),
        stop_atr: String(iStop),
        tp_atr: String(iTp),
      })
      const r = await fetch(`${DS}/v1/ictsmc/backtest/?${q.toString()}`)
      const j = await r.json()
      if (!r.ok) throw new Error((j as { error?: string }).error || r.statusText)
      setOut(j)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        fontFamily: 'var(--pl-font-family, "JetBrains Mono", monospace)',
        fontSize: 11,
        color: 'var(--pl-c-text, #e2e8f0)',
        borderBottom: '1px solid #334155',
        padding: '8px 12px',
        background: 'linear-gradient(90deg, #0f172a, #0c4a3e 40%, #0f172a)',
        marginBottom: 0,
      }}
    >
      <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 6 }}>
        Trade Lab · <strong>DS {DS}</strong> — turn on the full multi-algo sim, or run ICTSMC (entry/retest/exit) backtest.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ border: '1px solid #334155', borderRadius: 6, padding: 8, minWidth: 260, background: '#0f172a' }}>
          <div style={{ color: '#2dd4bf', fontWeight: 600, marginBottom: 6 }}>Multi-algo sim (competition)</div>
          <button
            type="button"
            onClick={() => { void runUniverse(true) }}
            disabled={busy}
            title="POST /v1/sim/universe/ with all 30 crypto algos (DS must be on :8000)"
            style={{
              display: 'block',
              width: '100%',
              marginBottom: 8,
              padding: '12px 14px',
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase' as const,
              border: '2px solid #2dd4bf',
              borderRadius: 8,
              cursor: busy ? 'wait' : 'pointer',
              background: 'linear-gradient(180deg, #115e59, #0d9488)',
              color: '#ecfeff',
              boxShadow: '0 0 24px rgba(45, 212, 191, 0.28)',
            }}
          >
            {busy ? 'Running…' : '▶ All algorithms (30)'}
          </button>
          <label style={{ display: 'block', marginBottom: 2, fontSize: 10, color: '#94a3b8' }}>
            <input type="checkbox" checked={allAlgos} onChange={(e) => setAllAlgos(e.target.checked)} /> Include all in “custom run”
          </label>
          {!allAlgos && (
            <label style={{ display: 'block', marginTop: 2 }}>
              algos
              <input
                value={uAlgos}
                onChange={(e) => setUAlgos(e.target.value)}
                style={{ width: '100%', marginTop: 2, fontSize: 10 }}
                placeholder="DON_BO,EMA_CROSS"
              />
            </label>
          )}
          <label>Asset <input value={uAsset} onChange={(e) => setUAsset(e.target.value)} style={{ width: 50 }} /></label>
          <label> Start <input value={uStart} onChange={(e) => setUStart(e.target.value)} style={{ width: 88 }} /></label>
          <label> End <input value={uEnd} onChange={(e) => setUEnd(e.target.value)} style={{ width: 88 }} /></label>
          <label style={{ display: 'block', marginTop: 4 }}>
            trade lists{' '}
            <select value={tlist} onChange={(e) => setTlist(e.target.value)}>
              <option value="off">off (stats only, fast)</option>
              <option value="sample">sample</option>
              <option value="all">all (heavy JSON)</option>
            </select>
          </label>
          <button type="button" onClick={() => { void runUniverse() }} disabled={busy} style={{ marginTop: 6, cursor: 'pointer', fontSize: 10 }}>
            {busy ? '…' : 'Custom run (uses options above)'}
          </button>
        </div>

        <div style={{ border: '1px solid #334155', borderRadius: 6, padding: 8, minWidth: 240, background: '#0f172a' }}>
          <div style={{ color: '#f472b6', fontWeight: 600, marginBottom: 4 }}>ICTSMC backtest (opt levels)</div>
          <label style={{ display: 'block' }}><input type="checkbox" checked={iTrade} onChange={(e) => setITrade(e.target.checked)} /> trade on</label>
          <label style={{ display: 'block' }}><input type="checkbox" checked={iKz} onChange={(e) => setIKz(e.target.checked)} /> entry: killzone</label>
          <label style={{ display: 'block' }}><input type="checkbox" checked={iGate} onChange={(e) => setIGate(e.target.checked)} /> entry: v_ict_whacker gate</label>
          <label>retest <select value={iRetest} onChange={(e) => setIRetest(e.target.value as 'loose' | 'strict')}>
            <option value="loose">loose (OB|FVG)</option>
            <option value="strict">strict (OB at bar)</option>
          </select></label>
          <br />
          <label> hold bars <input type="number" value={iHold} onChange={(e) => setIHold(+e.target.value)} style={{ width: 40 }} /></label>
          <label> stop ATR <input type="number" step={0.1} value={iStop} onChange={(e) => setIStop(+e.target.value)} style={{ width: 36 }} /></label>
          <label> tp ATR <input type="number" step={0.1} value={iTp} onChange={(e) => setITp(+e.target.value)} style={{ width: 36 }} /></label>
          <br />
          <label>asset <input value={iAsset} onChange={(e) => setIAsset(e.target.value)} style={{ width: 40 }} /></label>
          <label> start <input value={iStart} onChange={(e) => setIStart(e.target.value)} style={{ width: 88 }} /></label>
          <label> end <input value={iEnd} onChange={(e) => setIEnd(e.target.value)} style={{ width: 88 }} /></label>
          <button type="button" onClick={runIctsmc} disabled={busy} style={{ marginTop: 6, marginLeft: 4, cursor: 'pointer' }}>
            {busy ? '…' : 'Run /v1/ictsmc/backtest/'}
          </button>
        </div>
      </div>
      {err && <pre style={{ color: '#f87171', fontSize: 10, marginTop: 6 }}>{err}</pre>}
      {out && (
        <pre
          style={{
            maxHeight: 200,
            overflow: 'auto',
            fontSize: 9,
            color: '#cbd5e1',
            marginTop: 6,
            background: '#020617',
            padding: 6,
            borderRadius: 4,
          }}
        >
          {JSON.stringify(out, null, 0).slice(0, 12_000)}
        </pre>
      )}
    </div>
  )
}

export default function TradeLabPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <SimIctPanel />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <ObiPage />
      </div>
    </div>
  )
}
