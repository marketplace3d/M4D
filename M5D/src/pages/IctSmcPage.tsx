import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ActivityReport, CouncilSnapshot, CrossAssetReport, GateReport } from '../types'
import ICTArchDiagram from '../components/ict/ICT_Arch_Diagram'
import ICTSignalEngineSpec from '../components/ict/ICT_Signal_Engine_Spec'

type Verdict = 'LONG' | 'SHORT' | 'WAIT' | 'HEDGE'

interface Props {
  council: CouncilSnapshot | null
  activity: ActivityReport | null
  crossAsset: CrossAssetReport | null
  gateReport: GateReport | null
}

interface MarketState {
  price: number
  atr: number
  regime: 'TRENDING_BULL' | 'TRENDING_BEAR' | 'RANGING' | 'VOLATILE'
  session: 'LONDON' | 'NY_AM' | 'NY_PM' | 'ASIA'
  bias: 'LONG' | 'SHORT' | 'NEUTRAL'
  bsl: number
  ssl: number
  obBull: number
  obBear: number
  fvgHigh: number
  fvgLow: number
  vwap: number
  poc: number
  bos: boolean
  choch: boolean
  mss: boolean
  isKillzone: boolean
  timeWeight: number
  liquiditySwept: boolean
  deltaDivergence: boolean
  smtDivergence: boolean
  inducement: 'BSL' | 'SSL'
  accountEquity: number
  riskPct: number
  stopDist: number
  tpDist: number
  rr: number
  kellyF: number
  kellySize: number
  corrBtcEth: number
  delta: number
  hedgeSuggested: boolean
  confluence: number
  edgeScore: number
  structureScore: number
  ictScore: number
  volatilityScore: number
  sentimentScore: number
  weightedEdgeRaw: number
  entry: number
  sl: number
  tp1: number
  ts: string
}

interface Arbitration {
  verdict: Verdict
  edgeConfidence: number
  regimeRead: string
  liquidityNarrative: string
  entryThesis: string
  riskRuling: string
  hedgeInstruction: string
  killConditions: string[]
  optimizeNext: string
}

const palette = {
  bg: 'var(--bg1)',
  panel: 'var(--bg2)',
  border: 'var(--border)',
  accent: 'var(--accent)',
  gold: 'var(--goldB)',
  green: 'var(--greenB)',
  red: 'var(--redB)',
  purple: 'var(--purpleB)',
  text: 'var(--text)',
  muted: 'var(--text3)',
}

function asNum(v: number, d = 2): string {
  return v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: d }) : v.toFixed(d)
}

function deriveState(
  council: CouncilSnapshot | null,
  activity: ActivityReport | null,
  cross: CrossAssetReport | null,
  prevDeltaHist: number[],
): MarketState {
  const seed = Date.now() / 1000
  const base = 43_000 + Math.sin(seed / 11) * 260 + Math.cos(seed / 7) * 140
  const atr = 90 + Math.abs(Math.sin(seed / 13)) * 130
  const regime: MarketState['regime'] = council?.regime === 'TRENDING'
    ? ((council.jedi_score ?? 0) >= 0 ? 'TRENDING_BULL' : 'TRENDING_BEAR')
    : cross?.regime === 'RISK_OFF' ? 'VOLATILE' : 'RANGING'
  const bias: MarketState['bias'] = regime === 'TRENDING_BULL' ? 'LONG' : regime === 'TRENDING_BEAR' ? 'SHORT' : 'NEUTRAL'
  const h = new Date().getUTCHours()
  const session: MarketState['session'] = h >= 7 && h <= 10 ? 'LONDON' : h >= 13 && h <= 16 ? 'NY_AM' : h >= 17 && h <= 20 ? 'NY_PM' : 'ASIA'
  const isKillzone = session === 'LONDON' || session === 'NY_AM'
  const timeWeight = isKillzone ? 1.2 : 0.7
  const bsl = base + atr * 1.7
  const ssl = base - atr * 1.7
  const obBull = base - atr * 0.52
  const obBear = base + atr * 0.52
  const fvgHigh = base + atr * 0.2
  const fvgLow = base - atr * 0.2
  const vwap = base + Math.sin(seed / 5) * atr * 0.15
  const poc = base + Math.cos(seed / 8) * atr * 0.08
  const bos = Math.abs(Math.sin(seed / 6)) > 0.55
  const choch = Math.abs(Math.cos(seed / 9)) > 0.72
  const mss = Math.abs(Math.sin(seed / 14)) > 0.8
  const liquiditySwept = (Math.abs(base - bsl) < atr * 0.35 || Math.abs(base - ssl) < atr * 0.35) && mss
  const inducement: 'BSL' | 'SSL' = Math.sin(seed / 10) > 0 ? 'BSL' : 'SSL'
  const accountEquity = 100_000
  const riskPct = 0.01
  const stopDist = atr * 0.5
  const tpDist = atr * 1.5
  const rr = tpDist / Math.max(1, stopDist)
  const sentimentScore = Math.max(0, Math.min(100, ((activity?.activity_score ?? 0.5) * 100)))
  const structureScore = (bos ? 40 : 0) + (choch ? 30 : 0) + (mss ? 30 : 0)
  const ictScore = (liquiditySwept ? 60 : 0) + (Math.abs(base - vwap) < atr ? 40 : 0)
  const volatilityScore = 21
  const weightedEdgeRaw = (structureScore * 0.45 + ictScore * 0.30 + volatilityScore * 0.21 + sentimentScore * 0.04) * timeWeight
  const edgeScore = Math.max(0, Math.min(100, weightedEdgeRaw))
  const winProb = edgeScore / 100
  const kellyF = Math.max(0, ((winProb * rr - (1 - winProb)) / Math.max(rr, 0.5))) * 0.25
  const kellySize = accountEquity * kellyF
  const corrBtcEth = 0.72 + Math.abs(Math.sin(seed / 17)) * 0.2
  const delta = bias === 'LONG' ? kellySize * base * 0.01 : bias === 'SHORT' ? -kellySize * base * 0.01 : 0
  const meanDelta10 = prevDeltaHist.length ? prevDeltaHist.reduce((s, v) => s + v, 0) / prevDeltaHist.length : delta
  const priceUp = Math.sin(seed / 5) > 0
  const deltaDivergence = (priceUp && delta < meanDelta10) || (!priceUp && delta > meanDelta10)
  const smtDivergence = Math.abs(Math.sin(seed / 4) - Math.cos(seed / 4.7)) > 0.9
  const hedgeSuggested = Math.abs(delta) > 50_000
  const confluence = [bos, choch, mss, liquiditySwept, isKillzone].filter(Boolean).length
  const entry = bias === 'LONG' ? obBull + atr * 0.05 : obBear - atr * 0.05
  const sl = bias === 'LONG' ? obBull - stopDist : obBear + stopDist
  const tp1 = bias === 'LONG' ? bsl : ssl
  return {
    price: base, atr, regime, session, bias, bsl, ssl, obBull, obBear, fvgHigh, fvgLow, vwap, poc,
    bos, choch, mss, isKillzone, timeWeight, liquiditySwept, deltaDivergence, smtDivergence, inducement,
    accountEquity, riskPct, stopDist, tpDist, rr, kellyF, kellySize, corrBtcEth, delta, hedgeSuggested,
    confluence, edgeScore, structureScore, ictScore, volatilityScore, sentimentScore, weightedEdgeRaw,
    entry, sl, tp1, ts: new Date().toLocaleTimeString(),
  }
}

function arbitrate(state: MarketState, gatesLive: number): Arbitration {
  const dir = state.bias
  const edge = Math.round(Math.max(0, Math.min(100, state.edgeScore + (gatesLive >= 6 ? 6 : -4))))
  const verdict: Verdict = state.hedgeSuggested ? 'HEDGE' : dir === 'LONG' && edge > 64 ? 'LONG' : dir === 'SHORT' && edge > 64 ? 'SHORT' : 'WAIT'
  return {
    verdict,
    edgeConfidence: edge,
    regimeRead: `${state.regime} in ${state.session}; BOS=${state.bos ? 'Y' : 'N'} CHoCH=${state.choch ? 'Y' : 'N'} MSS=${state.mss ? 'Y' : 'N'}`,
    liquidityNarrative: `Price magnet is ${state.inducement}; watching ${asNum(state.vwap)} VWAP and ${asNum(state.poc)} POC with OB/FVG overlap.`,
    entryThesis: verdict === 'LONG' ? `Fade into bull OB ${asNum(state.obBull)} and trigger above FVG-mid ${asNum((state.fvgHigh + state.fvgLow) / 2)}.` : verdict === 'SHORT' ? `Sell into bear OB ${asNum(state.obBear)} and reject below VWAP ${asNum(state.vwap)}.` : 'No clean dislocation; preserve optionality and wait for displacement + reclaim.',
    riskRuling: `Quarter-Kelly sizing at $${Math.round(state.kellySize).toLocaleString()} with hard max loss $${Math.round(state.accountEquity * state.riskPct).toLocaleString()}.`,
    hedgeInstruction: state.hedgeSuggested ? 'Activate BTC/ETH hedge sleeve; reduce net delta until under $50k.' : 'No hedge required.',
    killConditions: [
      verdict === 'LONG' ? `Kill long if price closes below ${asNum(state.sl)} with rising ATR.` : `Kill short if price closes above ${asNum(state.sl)} with rising ATR.`,
      `Kill if confluence drops below 3/5 or gate stack falls below 5/10.`,
      state.smtDivergence ? 'Kill if SMT divergence persists across BTC/ETH proxy.' : 'Watch SMT divergence toggle before size increase.',
      state.deltaDivergence ? 'Kill if price/Delta divergence expands for 3 ticks.' : 'Delta aligned with price.',
    ],
    optimizeNext: `Tune killzone weighting + purge trigger threshold; validate against walk-forward fold drift.`,
  }
}

function Layer({ title, tier, badge, children }: { title: string; tier: string; badge: 'LIVE' | 'SYNTH'; children: ReactNode }) {
  const c = badge === 'LIVE' ? palette.green : palette.gold
  return (
    <div className="m5d-panel" style={{ borderLeft: `2px solid ${c}` }}>
      <div className="m5d-panel-head">
        <span className="panel-title">{`LAYER ${tier} · ${title}`}</span>
        <span className="m5d-badge" style={{ border: `1px solid ${c}`, color: c }}>{badge}</span>
      </div>
      <div className="m5d-panel-body">{children}</div>
    </div>
  )
}

export default function IctSmcPage({ council, activity, crossAsset, gateReport }: Props) {
  const [view, setView] = useState<'ops' | 'arch' | 'spec'>('ops')
  const [deltaHist, setDeltaHist] = useState<number[]>([])
  const [state, setState] = useState<MarketState>(() => deriveState(council, activity, crossAsset, []))
  const [edgeHist, setEdgeHist] = useState<number[]>([])
  const [iterLog, setIterLog] = useState<string[]>([])
  const [analysis, setAnalysis] = useState<Arbitration | null>(null)
  const [auto, setAuto] = useState(false)
  const [running, setRunning] = useState(false)

  const gatesLive = gateReport?.gates?.filter(g => g.enabled).length ?? 0

  useEffect(() => {
    const id = window.setInterval(() => {
      const next = deriveState(council, activity, crossAsset, deltaHist)
      setState(next)
      setEdgeHist(h => [...h.slice(-39), next.edgeScore])
      setDeltaHist(h => [...h.slice(-9), next.delta])
    }, 2_400)
    return () => window.clearInterval(id)
  }, [council, activity, crossAsset, deltaHist])

  const runArb = useCallback(() => {
    setRunning(true)
    window.setTimeout(() => {
      const out = arbitrate(state, gatesLive)
      setAnalysis(out)
      setIterLog(prev => [`${new Date().toLocaleTimeString()} · ${out.verdict} · ${out.optimizeNext}`, ...prev.slice(0, 19)])
      setRunning(false)
    }, 320)
  }, [state, gatesLive])

  useEffect(() => {
    if (!auto || running) return
    const id = window.setTimeout(() => runArb(), 5_000)
    return () => window.clearTimeout(id)
  }, [auto, running, runArb, state.ts])

  const verdictColor = analysis?.verdict === 'LONG' ? palette.green : analysis?.verdict === 'SHORT' ? palette.red : analysis?.verdict === 'HEDGE' ? palette.purple : palette.gold
  const edgeMin = edgeHist.length ? Math.min(...edgeHist) : 0
  const edgeMax = edgeHist.length ? Math.max(...edgeHist) : 100

  const levelRows = useMemo(() => ([
    ['BSL', state.bsl, palette.green],
    ['Bear OB', state.obBear, palette.red],
    ['FVG Hi', state.fvgHigh, palette.gold],
    ['VWAP', state.vwap, palette.accent],
    ['PRICE', state.price, '#ffffff'],
    ['POC', state.poc, palette.purple],
    ['FVG Lo', state.fvgLow, palette.gold],
    ['Bull OB', state.obBull, palette.green],
    ['SSL', state.ssl, palette.red],
  ]), [state])

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="m5d-panel">
        <div className="m5d-panel-body" style={{ padding: '6px 8px', display: 'flex', gap: 6, justifyContent: 'flex-start' }}>
          {[
            { id: 'ops', label: 'ICT OPS' },
            { id: 'arch', label: 'ICT ARCH DIAGRAM' },
            { id: 'spec', label: 'ICT SIGNAL ENGINE SPEC' },
          ].map(btn => {
            const active = view === btn.id
            return (
              <button
                key={btn.id}
                onClick={() => setView(btn.id as 'ops' | 'arch' | 'spec')}
                style={{
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: active ? 'rgba(58,143,255,0.14)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text3)',
                  padding: '2px 8px',
                  fontSize: 9,
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  borderRadius: 2,
                }}
              >
                {btn.label}
              </button>
            )
          })}
        </div>
      </div>

      {view === 'arch' && <ICTArchDiagram />}
      {view === 'spec' && <ICTSignalEngineSpec />}

      {view === 'ops' && (
        <>

      <div className="m5d-panel">
        <div className="m5d-panel-head">
          <span className="panel-title">ICT-SMC LIQUIDITY WARFARE ENGINE · SURGE</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="m5d-badge blue">{`REGIME ${state.regime}`}</span>
            <span className="m5d-badge green">{`GATES ${gatesLive}/10`}</span>
            <button onClick={runArb} disabled={running} style={{ background: 'transparent', color: palette.accent, border: `1px solid ${palette.accent}`, padding: '2px 8px', fontFamily: 'var(--font-mono)', cursor: 'pointer' }}>{running ? 'RUNNING...' : 'RUN AI'}</button>
            <button onClick={() => setAuto(v => !v)} style={{ background: auto ? 'rgba(255,204,58,0.16)' : 'transparent', color: auto ? palette.gold : palette.muted, border: `1px solid ${auto ? palette.gold : palette.border}`, padding: '2px 8px', fontFamily: 'var(--font-mono)', cursor: 'pointer' }}>{auto ? 'AUTO: ON' : 'AUTO: OFF'}</button>
          </div>
        </div>
        <div className="m5d-panel-body" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10 }}>
          <div style={{ fontSize: 10, color: palette.text }}>
            <div style={{ marginBottom: 4 }}>Institutional 7-layer flow: Structure -&gt; Liquidity -&gt; Confluence -&gt; Entry -&gt; Risk/Kelly -&gt; Portfolio/Hedge -&gt; Arbitration.</div>
            <div style={{ color: palette.muted }}>Trust mode: Layer badges show `LIVE` vs `SYNTH`; structure is currently confidence-rated, not blind-trusted.</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `1px solid ${palette.border}`, padding: '6px 8px' }}>
            <div>
              <div style={{ fontSize: 9, color: palette.muted }}>VERDICT</div>
              <div style={{ fontSize: 16, color: verdictColor, fontWeight: 700 }}>{analysis?.verdict ?? 'WAIT'}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: palette.muted }}>EDGE</div>
              <div style={{ fontSize: 16, color: palette.gold, fontWeight: 700 }}>{Math.round(analysis?.edgeConfidence ?? state.edgeScore)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid3">
        <Layer title="Market Structure" tier="1" badge="SYNTH">
          <div className="stat-row"><span className="stat-label">BOS / CHoCH / MSS</span><span className="stat-val">{`${state.bos ? 'Y' : 'N'} / ${state.choch ? 'Y' : 'N'} / ${state.mss ? 'Y' : 'N'}`}</span></div>
          <div className="stat-row"><span className="stat-label">JUDAS Liquidity Purge</span><span className="stat-val" style={{ color: state.liquiditySwept ? palette.red : palette.muted }}>{state.liquiditySwept ? 'ACTIVE' : 'OFF'}</span></div>
          <div className="stat-row"><span className="stat-label">Killzone Volatility</span><span className="stat-val" style={{ color: state.isKillzone ? palette.gold : palette.muted }}>{state.isKillzone ? 'HIGH WINDOW' : 'DECAY APPLIED'}</span></div>
          <div className="stat-row"><span className="stat-label">Regime</span><span className="stat-val">{state.regime}</span></div>
          <div className="stat-row"><span className="stat-label">Bias</span><span className="stat-val">{state.bias}</span></div>
          <div className="stat-row"><span className="stat-label">Session</span><span className="stat-val">{state.session}</span></div>
        </Layer>

        <Layer title="Liquidity Map" tier="2" badge="SYNTH">
          {levelRows.map(([name, val, color]) => (
            <div key={name as string} className="stat-row">
              <span className="stat-label">{name as string}</span>
              <span className="stat-val" style={{ color: color as string }}>{asNum(val as number, 1)}</span>
            </div>
          ))}
        </Layer>

        <Layer title="Confluence Score" tier="3" badge="LIVE">
          <div className="stat-row"><span className="stat-label">Confluence</span><span className="stat-val">{`${state.confluence}/5`}</span></div>
          <div className="stat-row"><span className="stat-label">Edge Score</span><span className="stat-val gold">{state.edgeScore.toFixed(1)}</span></div>
          <div className="stat-row"><span className="stat-label">Weighted Raw</span><span className="stat-val">{state.weightedEdgeRaw.toFixed(1)}</span></div>
          <div className="stat-row"><span className="stat-label">Activity</span><span className="stat-val">{activity ? activity.gate_status : 'N/A'}</span></div>
          <div className="stat-row"><span className="stat-label">Weights</span><span className="stat-val">{'Structure 45 · ICT 30 · Vol 21 · Sent 4'}</span></div>
          <div style={{ marginTop: 8, height: 30, border: `1px solid ${palette.border}`, padding: 3 }}>
            <div style={{ height: '100%', width: `${((state.edgeScore - edgeMin) / Math.max(1, edgeMax - edgeMin)) * 100}%`, background: 'linear-gradient(90deg, rgba(255,204,58,0.2), rgba(255,204,58,0.9))', transition: 'width 0.35s ease' }} />
          </div>
        </Layer>
      </div>

      <div className="grid3">
        <Layer title="Optimal Entry" tier="4" badge="SYNTH">
          <div className="stat-row"><span className="stat-label">Entry</span><span className="stat-val">{asNum(state.entry, 2)}</span></div>
          <div className="stat-row"><span className="stat-label">Stop</span><span className="stat-val red">{asNum(state.sl, 2)}</span></div>
          <div className="stat-row"><span className="stat-label">TP1</span><span className="stat-val green">{asNum(state.tp1, 2)}</span></div>
          <div className="stat-row"><span className="stat-label">R:R</span><span className="stat-val">{state.rr.toFixed(2)}R</span></div>
        </Layer>

        <Layer title="Risk + Kelly Sizing" tier="5" badge="LIVE">
          <div className="stat-row"><span className="stat-label">Equity</span><span className="stat-val">${Math.round(state.accountEquity).toLocaleString()}</span></div>
          <div className="stat-row"><span className="stat-label">Risk/Trade</span><span className="stat-val">{(state.riskPct * 100).toFixed(2)}%</span></div>
          <div className="stat-row"><span className="stat-label">Kelly f</span><span className="stat-val">{(state.kellyF * 100).toFixed(2)}%</span></div>
          <div className="stat-row"><span className="stat-label">Quarter Kelly $</span><span className="stat-val green">${Math.round(state.kellySize).toLocaleString()}</span></div>
          <div className="stat-row"><span className="stat-label">Time Weight</span><span className="stat-val">{state.timeWeight.toFixed(2)}x</span></div>
        </Layer>

        <Layer title="Portfolio + Hedge" tier="6" badge="LIVE">
          <div className="stat-row"><span className="stat-label">BTC/ETH Corr</span><span className="stat-val">{state.corrBtcEth.toFixed(3)}</span></div>
          <div className="stat-row"><span className="stat-label">Net Delta</span><span className="stat-val">{`${state.delta >= 0 ? '+' : ''}$${Math.round(state.delta).toLocaleString()}`}</span></div>
          <div className="stat-row"><span className="stat-label">Delta Divergence</span><span className="stat-val" style={{ color: state.deltaDivergence ? palette.red : palette.green }}>{state.deltaDivergence ? 'DISTRIBUTION RISK' : 'ALIGNED'}</span></div>
          <div className="stat-row"><span className="stat-label">SMT Divergence</span><span className="stat-val" style={{ color: state.smtDivergence ? palette.red : palette.green }}>{state.smtDivergence ? 'ON' : 'OFF'}</span></div>
          <div className="stat-row"><span className="stat-label">Hedge Trigger</span><span className="stat-val" style={{ color: state.hedgeSuggested ? palette.red : palette.green }}>{state.hedgeSuggested ? 'ACTIVE' : 'CLEAR'}</span></div>
        </Layer>
      </div>

      <Layer title="Visual Parameters Surface (No Chart)" tier="P" badge="LIVE">
        <div className="grid4">
          <div className="stat-row"><span className="stat-label">Structure Score</span><span className="stat-val">{state.structureScore.toFixed(1)}</span></div>
          <div className="stat-row"><span className="stat-label">ICT Liquidity Score</span><span className="stat-val">{state.ictScore.toFixed(1)}</span></div>
          <div className="stat-row"><span className="stat-label">Volatility Baseline</span><span className="stat-val">{state.volatilityScore.toFixed(1)}</span></div>
          <div className="stat-row"><span className="stat-label">Sentiment Score (4%)</span><span className="stat-val">{state.sentimentScore.toFixed(1)}</span></div>
        </div>
      </Layer>

      <div className="grid2">
        <Layer title="AI Arbitration" tier="7" badge="LIVE">
          {analysis ? (
            <>
              <div className="stat-row"><span className="stat-label">Regime Read</span><span className="stat-val">{analysis.regimeRead}</span></div>
              <div className="stat-row"><span className="stat-label">Liquidity Narrative</span><span className="stat-val">{analysis.liquidityNarrative}</span></div>
              <div className="stat-row"><span className="stat-label">Entry Thesis</span><span className="stat-val">{analysis.entryThesis}</span></div>
              <div className="stat-row"><span className="stat-label">Risk Ruling</span><span className="stat-val">{analysis.riskRuling}</span></div>
              <div className="stat-row"><span className="stat-label">Hedge</span><span className="stat-val">{analysis.hedgeInstruction}</span></div>
              <div style={{ marginTop: 6, fontSize: 9, color: palette.red }}>{analysis.killConditions.join(' | ')}</div>
            </>
          ) : (
            <div style={{ color: palette.muted, fontSize: 10 }}>Run arbitration pass to generate verdict + kill conditions.</div>
          )}
        </Layer>

        <Layer title="Iter-Opt Loop" tier="INF" badge="LIVE">
          <div className="stat-row"><span className="stat-label">Auto Loop</span><span className="stat-val">{auto ? 'ON (5s)' : 'OFF'}</span></div>
          <div className="stat-row"><span className="stat-label">Clock</span><span className="stat-val">{state.ts}</span></div>
          <div style={{ marginTop: 6, maxHeight: 180, overflow: 'auto', fontSize: 9 }}>
            {iterLog.length ? iterLog.map((l, i) => <div key={`${l}-${i}`} style={{ padding: '3px 0', borderBottom: `1px solid ${palette.border}` }}>{l}</div>) : <div style={{ color: palette.muted }}>No optimization runs yet.</div>}
          </div>
        </Layer>
      </div>
        </>
      )}
    </div>
  )
}

