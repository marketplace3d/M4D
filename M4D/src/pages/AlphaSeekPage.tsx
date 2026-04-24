import { useEffect, useState, useRef, useCallback } from 'react'

const DS = 'http://127.0.0.1:8000'

const C = {
  bg0:'#020408', bg1:'#04080f', bg2:'#060c16', bg3:'#0a1220',
  border:'#0d1e35', dim:'#16304a', muted:'#1e4060',
  text:'#c8d8f0', dim2:'#7a9ab8', faint:'#3a5870',
  blue:'#3a8fff', blueD:'#1a5fcc', blueDD:'#061428',
  green:'#1dff7a', greenD:'#0faa50', greenDD:'#041208',
  gold:'#ffcc3a', goldD:'#c8940a', goldDD:'#1a1000',
  red:'#ff4a5a', redD:'#aa1a28', redDD:'#120008',
  purple:'#b07aff', purpleD:'#6a3acc', purpleDD:'#0a0418',
  teal:'#2ae8e8', tealD:'#0a8888',
  orange:'#ff8c20',
}

const REGIME_COLORS: Record<string, string> = {
  'RISK-OFF':        C.red,
  'EXHAUSTION':      C.orange,
  'SQUEEZE':         C.purple,
  'BREAKOUT':        C.teal,
  'TRENDING_STRONG': C.green,
  'TRENDING_WEAK':   '#6acc88',
  'RANGING':         C.faint,
}

const REGIME_DESC: Record<string, string> = {
  'RISK-OFF':        'Crisis — flatten, no new entries',
  'EXHAUSTION':      'Vol climax — expect reversal / pause',
  'SQUEEZE':         'Coiling — wait for release signal',
  'BREAKOUT':        'Squeeze released — highest-IC window',
  'TRENDING_STRONG': 'Full conviction — scale-in eligible',
  'TRENDING_WEAK':   'Trend present, subdued vol — ½ size',
  'RANGING':         'No structure — wait or mean-revert',
}

const REGIME_SIGNALS: Record<string, { active: string[]; muted: string[] }> = {
  'BREAKOUT':        { active:['SQZPOP','VOL_BO','BB_BREAK','SUPERTREND','EMA_STACK','TREND_SMA'],    muted:['RSI_STRONG','STOCH_CROSS','MFI_CROSS','EMA_CROSS','MACD_CROSS'] },
  'TRENDING_STRONG': { active:['SUPERTREND','EMA_CROSS','MACD_CROSS','EMA_STACK','TREND_SMA','PSAR'], muted:['RSI_STRONG','STOCH_CROSS','MFI_CROSS','SQZPOP','BB_BREAK'] },
  'TRENDING_WEAK':   { active:['EMA_STACK','TREND_SMA','ADX_TREND','PULLBACK'],                       muted:['RSI_STRONG','SQZPOP','VOL_BO'] },
  'RANGING':         { active:['RSI_STRONG','STOCH_CROSS','MFI_CROSS','CMF_POS'],                     muted:['SUPERTREND','EMA_CROSS','MACD_CROSS','PSAR','VOL_BO','SQZPOP'] },
  'SQUEEZE':         { active:['SQZPOP'],                                                              muted:['SUPERTREND','EMA_CROSS','MACD_CROSS','PSAR','VOL_BO','BB_BREAK'] },
  'EXHAUSTION':      { active:['RSI_STRONG','STOCH_CROSS','MFI_CROSS'],                               muted:['SUPERTREND','EMA_STACK','VOL_BO','SQZPOP','ATR_EXP'] },
  'RISK-OFF':        { active:['GOLDEN'],                                                              muted:['SUPERTREND','EMA_CROSS','MACD_CROSS','VOL_BO','SQZPOP','ATR_EXP'] },
}

const FUTURES_SYMS = ['ES','NQ','GC','CL'] as const
type FuturesSym = typeof FUTURES_SYMS[number]
const mono = "'SF Mono','JetBrains Mono','Courier New',monospace"

function usePoll<T>(url: string, ms = 60_000): T | null {
  const [d, setD] = useState<T | null>(null)
  useEffect(() => {
    let live = true
    const run = () => fetch(url).then(r => r.json()).then(x => { if (live) setD(x) }).catch(() => {})
    run()
    const id = setInterval(run, ms)
    return () => { live = false; clearInterval(id) }
  }, [url, ms])
  return d
}

const Panel = ({ head, headColor = C.blue, children, right }: {
  head:string; headColor?:string; children:React.ReactNode; right?:React.ReactNode
}) => (
  <div style={{ background:C.bg1, border:`1px solid ${C.border}`, borderRadius:3, overflow:'hidden', display:'flex', flexDirection:'column' }}>
    <div style={{ padding:'5px 10px', background:C.bg0, borderBottom:`1px solid ${C.dim}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
      <span style={{ fontSize:9, color:headColor, fontFamily:mono, fontWeight:700, letterSpacing:'0.14em' }}>{head}</span>
      {right}
    </div>
    <div style={{ padding:'8px 10px', flex:1, overflow:'auto' }}>{children}</div>
  </div>
)

const Btn = ({ label, color = C.blue, onClick, small }: { label:string; color?:string; onClick:()=>void; small?:boolean }) => (
  <button onClick={onClick} style={{
    padding: small ? '3px 8px' : '6px 12px',
    fontSize: small ? 8 : 9, fontFamily:mono, fontWeight:700, letterSpacing:'0.1em',
    background:`${color}11`, border:`1px solid ${color}66`, color,
    borderRadius:2, cursor:'pointer', whiteSpace:'nowrap',
    transition:'all 0.12s',
  }}>{label}</button>
)

interface Algo27 {
  id: string; bank: string; name: string; stop_pct: number; hold_bars: number
}
interface WalkData { algo: Algo27; folds: { oos_sharpe?: number; is_sharpe?: number; [k:string]: any }[] }

const PERSONA_NAMES = [
  { key:'trend', label:'Simons', color:C.green,  prompt:'You are Jim Simons. Statistical rigor. Brutal about overfitting. Assess IC/ICIR quality, sample size, multiple testing, regime breadth, alpha durability. Max 100 words.' },
  { key:'risk',  label:'Dalio',  color:C.gold,   prompt:'You are Ray Dalio. All-weather mindset. Assess worst-case drawdown, correlation risk, tail exposure, position sizing sanity, portfolio fit. Max 100 words.' },
  { key:'quant', label:'Soros',  color:C.purple, prompt:'You are George Soros. Macro reflexivity. Assess whether the edge is structural or ephemeral, regime dependency, and whether the algo is fighting the tape. Max 100 words.' },
]

interface RegimeSnap {
  ok: boolean; symbol: string; regime: string; bars_in_regime: number
  transition_risk: boolean; atr_rank: number; rvol_now: number; rvol_rank: number
  squeeze_now: boolean; squeeze_released: boolean; atr_velocity: number; ema_aligned: boolean
}
interface RegimeSeries { ok: boolean; labels: string[]; distribution: Record<string, number>; n: number }

export default function AlphaSeekPage() {
  const algos27   = usePoll<{ algos: Algo27[] }>(`${DS}/v1/algos/`, 300_000)
  const walkRpt   = usePoll<any>(`${DS}/v1/walkforward/`, 120_000)
  const discovRpt = usePoll<any>(`${DS}/v1/discovery/`, 120_000)
  const icRpt     = usePoll<any>(`${DS}/v1/ic/report/`, 120_000)

  const [tab, setTab] = useState<'council'|'walk'|'discovery'|'ic'|'regime'|'field'>('council')
  const [regimeSym, setRegimeSym] = useState<FuturesSym>('ES')
  const regimeSnap   = usePoll<RegimeSnap>(`${DS}/v1/regime/?symbol=${regimeSym}`, 30_000)
  const regimeSeries = usePoll<RegimeSeries>(`${DS}/v1/regime/series/?symbol=${regimeSym}&n=200`, 60_000)

  // Futures walk-forward
  const [futWfSym, setFutWfSym] = useState<FuturesSym>('ES')
  const [futWfYears, setFutWfYears] = useState<number>(3)
  const futWfRpt = usePoll<any>(`${DS}/v1/futures/wf/`, 300_000)

  // Discovery sym
  const [discovSym, setDiscovSym] = useState<string>('ES')

  const [selected, setSelected] = useState<Algo27 | null>(null)
  const [review, setReview] = useState<Record<string, string>>({})
  const [reviewing, setReviewing] = useState<Record<string, boolean>>({})
  const [filterBank, setFilterBank] = useState<string>('ALL')

  const algos = algos27?.algos ?? []
  const filtered = filterBank === 'ALL' ? algos : algos.filter(a => a.bank === filterBank)

  const runReview = useCallback(async (algo: Algo27, persona: typeof PERSONA_NAMES[0]) => {
    const key = `${algo.id}-${persona.key}`
    setReviewing(p => ({ ...p, [key]:true }))
    setReview(p => ({ ...p, [key]:'' }))
    try {
      const msg = `Algo: ${algo.id} | Bank: ${algo.bank} | Name: ${algo.name}\nStop: ${algo.stop_pct}% | Hold: ${algo.hold_bars} bars\n\nGive your assessment. Should this make the live candidate bench?`
      const r = await fetch(`${DS}/v1/ai/claude/`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ system: persona.prompt, message: msg }),
      })
      const d = await r.json()
      setReview(p => ({ ...p, [key]: d.ok ? d.text : `[${d.error}]` }))
    } catch (e) {
      setReview(p => ({ ...p, [key]:`[fetch error: ${String(e)}]` }))
    }
    setReviewing(p => ({ ...p, [key]:false }))
  }, [])

  const bankColor = (b: string) => b === 'A' ? C.blue : b === 'B' ? C.gold : C.purple

  return (
    <div style={{ background:C.bg0, minHeight:'100%', padding:10, fontFamily:mono, color:C.text, display:'flex', flexDirection:'column', gap:8 }}>

      {/* ── Header ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 10px', background:C.bg1, border:`1px solid ${C.border}`, borderRadius:3 }}>
        <div>
          <span style={{ fontSize:11, fontWeight:700, color:C.teal, letterSpacing:'0.16em' }}>⟡ ALPHASEEK</span>
          <span style={{ fontSize:9, color:C.dim2, marginLeft:12 }}>27 ALGOS · COUNCIL REVIEW · WALK-FORWARD · IC DECAY · DISCOVERY</span>
        </div>
        <div style={{ display:'flex', gap:4 }}>
          {(['ALL','A','B','C'] as const).map(b => (
            <button key={b} onClick={() => setFilterBank(b)} style={{
              padding:'3px 8px', fontSize:8, fontFamily:mono, fontWeight:700,
              background: filterBank === b ? `${bankColor(b)}22` : C.bg3,
              border:`1px solid ${filterBank === b ? bankColor(b) : C.dim}`,
              color: filterBank === b ? bankColor(b) : C.faint,
              borderRadius:2, cursor:'pointer',
            }}>{b === 'ALL' ? 'ALL' : `BANK ${b}`}</button>
          ))}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
        {([
          ['council',   'COUNCIL REVIEW', C.purple],
          ['walk',      'WALK-FORWARD',   C.green],
          ['discovery', 'DISCOVERY',      C.teal],
          ['ic',        'IC DECAY',       C.gold],
          ['regime',    'REGIME ENGINE',  C.orange],
          ['field',     '⚽ FIELD STATUS', C.green],
        ] as const).map(([id, label, color]) => (
          <button key={id} onClick={() => setTab(id as any)} style={{
            padding:'5px 12px', fontSize:9, fontFamily:mono, fontWeight:700,
            background: tab === id ? `${color}22` : C.bg2,
            border:`1px solid ${tab === id ? color : C.border}`,
            color: tab === id ? color : C.faint,
            borderRadius:3, cursor:'pointer',
          }}>{label}</button>
        ))}
      </div>

      {/* ── Content ── */}
      <div style={{ display:'grid', gridTemplateColumns:'220px 1fr 230px', gap:8, flex:1, minHeight:0 }}>

        {/* Algo list */}
        <div style={{ display:'flex', flexDirection:'column', gap:2, overflow:'auto', maxHeight:'calc(100vh - 200px)' }}>
          {filtered.map(a => (
            <button key={a.id} onClick={() => setSelected(a)} style={{
              display:'flex', justifyContent:'space-between', alignItems:'center',
              padding:'6px 8px', textAlign:'left',
              background: selected?.id === a.id ? `${bankColor(a.bank)}22` : C.bg1,
              border:`1px solid ${selected?.id === a.id ? bankColor(a.bank) : C.border}`,
              borderRadius:3, cursor:'pointer', color:C.text,
            }}>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color: selected?.id === a.id ? bankColor(a.bank) : C.text }}>
                  {a.id}
                </div>
                <div style={{ fontSize:8, color:C.faint, marginTop:1 }}>{a.name}</div>
              </div>
              <span style={{
                fontSize:8, padding:'1px 5px', borderRadius:2, fontWeight:700,
                background:`${bankColor(a.bank)}22`, border:`1px solid ${bankColor(a.bank)}44`,
                color:bankColor(a.bank),
              }}>BANK {a.bank}</span>
            </button>
          ))}
          {!algos.length && (
            <div style={{ fontSize:9, color:C.faint, padding:'8px' }}>Loading algos…</div>
          )}
        </div>

        {/* Right panel — tab content */}
        <div style={{ overflow:'auto' }}>
          {tab === 'council' && selected && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ padding:'8px 12px', background:C.bg2, border:`1px solid ${C.border}`, borderRadius:3 }}>
                <div style={{ fontSize:11, fontWeight:700, color:bankColor(selected.bank) }}>{selected.id} — {selected.name}</div>
                <div style={{ fontSize:9, color:C.dim2, marginTop:2 }}>
                  Bank {selected.bank} · Stop {selected.stop_pct}% · Hold {selected.hold_bars} bars
                </div>
              </div>

              {PERSONA_NAMES.map(p => {
                const key = `${selected.id}-${p.key}`
                const text = review[key]
                const loading = reviewing[key]
                return (
                  <Panel key={p.key} head={`${p.label.toUpperCase()} REVIEW`} headColor={p.color}
                    right={
                      <Btn label={loading ? 'RUNNING…' : '▶ RUN'} color={p.color} onClick={() => runReview(selected, p)} small />
                    }>
                    {text ? (
                      <div style={{ fontSize:9, color:C.text, lineHeight:1.7, whiteSpace:'pre-wrap' }}>{text}</div>
                    ) : loading ? (
                      <div style={{ fontSize:9, color:C.dim2 }}>Running Claude council review…</div>
                    ) : (
                      <div style={{ fontSize:9, color:C.faint }}>Press RUN to get {p.label}'s assessment of {selected.id}</div>
                    )}
                  </Panel>
                )
              })}
            </div>
          )}

          {tab === 'council' && !selected && (
            <div style={{ fontSize:9, color:C.faint, padding:20 }}>← Select an algo to run council review</div>
          )}

          {tab === 'walk' && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>

              {/* ── Futures WF ─────────────────────────────────────────────── */}
              <Panel head="FUTURES WALK-FORWARD (ES/NQ · bars_1m → 5m · 7-regime)" headColor={C.green}
                right={
                  <span style={{ fontSize:8, color: futWfRpt?.ok ? C.green : C.faint, fontFamily:mono }}>
                    {futWfRpt?.ok ? `● ${futWfRpt.symbol} ${futWfRpt.n_folds}f ${futWfRpt.verdict}` : '○ NOT RUN'}
                  </span>
                }>
                {/* Controls */}
                <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:8, flexWrap:'wrap' }}>
                  {FUTURES_SYMS.map(s => (
                    <button key={s} onClick={() => setFutWfSym(s)} style={{
                      padding:'2px 8px', fontSize:8, fontFamily:mono, cursor:'pointer', borderRadius:2,
                      background: futWfSym===s ? `${C.green}22` : C.bg2,
                      border:`1px solid ${futWfSym===s ? C.green : C.dim}`,
                      color: futWfSym===s ? C.green : C.dim2,
                    }}>{s}</button>
                  ))}
                  {[2,3,5].map(y => (
                    <button key={y} onClick={() => setFutWfYears(y)} style={{
                      padding:'2px 8px', fontSize:8, fontFamily:mono, cursor:'pointer', borderRadius:2,
                      background: futWfYears===y ? `${C.blue}22` : C.bg2,
                      border:`1px solid ${futWfYears===y ? C.blue : C.dim}`,
                      color: futWfYears===y ? C.blue : C.dim2,
                    }}>{y}yr</button>
                  ))}
                  <Btn small label={`RUN ${futWfSym} ${futWfYears}yr (~3min)`} color={C.green}
                    onClick={() => fetch(`${DS}/v1/futures/wf/run/?sym=${futWfSym}&years=${futWfYears}`, { method:'POST' })} />
                </div>

                {futWfRpt?.ok ? (() => {
                  const r = futWfRpt
                  const oos = r.summary?.oos_sharpe ?? {}
                  const ios = r.summary?.is_oos_ratio ?? {}
                  const gates = r.rentech_gates ?? {}
                  const lc = r.signal_lifecycle ?? {}
                  const STAT_COL = { color:C.text, fontWeight:700 }
                  return (
                    <div>
                      {/* Summary row */}
                      <div style={{ display:'flex', gap:16, marginBottom:8, flexWrap:'wrap' }}>
                        {[
                          ['OOS Sharpe', oos.mean != null ? `${oos.mean > 0 ? '+' : ''}${oos.mean.toFixed(2)} ±${oos.std?.toFixed(2)}` : '—', oos.mean > 0 ? C.green : C.red],
                          ['IS/OOS ratio', ios.mean != null ? ios.mean.toFixed(2) : '—', ios.mean >= 0.4 ? C.green : C.gold],
                          ['OOS +ve folds', `${((oos.pct_positive ?? 0)*100).toFixed(0)}%`, (oos.pct_positive ?? 0) >= 0.6 ? C.green : C.gold],
                          ['Gates', r.gates_passed, parseInt(r.gates_passed) >= 3 ? C.green : C.red],
                          ['Verdict', r.verdict, r.verdict === 'ROBUST' ? C.green : r.verdict === 'PROMISING' ? C.gold : C.red],
                          ['Symbol', `${r.symbol} ${r.years}yr`, C.blue],
                          ['Bars', r.n_bars?.toLocaleString(), C.dim2],
                          ['Folds', r.n_folds, C.dim2],
                        ].map(([label, val, col]) => (
                          <div key={label as string} style={{ display:'flex', flexDirection:'column', gap:1 }}>
                            <span style={{ fontSize:7, color:C.faint, fontFamily:mono }}>{label}</span>
                            <span style={{ fontSize:10, color:col as string, fontFamily:mono, fontWeight:700 }}>{val ?? '—'}</span>
                          </div>
                        ))}
                      </div>

                      {/* RenTech gates */}
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:8 }}>
                        {Object.entries(gates).map(([g, v]) => (
                          <span key={g} style={{
                            fontSize:7, fontFamily:mono, padding:'1px 5px', borderRadius:2,
                            background: v ? `${C.green}18` : `${C.red}18`,
                            border:`1px solid ${v ? C.green : C.red}66`,
                            color: v ? C.green : C.red,
                          }}>{g.replace(/_/g,' ')}</span>
                        ))}
                      </div>

                      {/* Regime OOS Sharpe */}
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:8 }}>
                        {Object.entries(r.regime_summary ?? {}).map(([rg, v]: [string, any]) => (
                          <div key={rg} style={{
                            fontSize:7, fontFamily:mono, padding:'2px 6px', borderRadius:2,
                            background:C.bg2, border:`1px solid ${REGIME_COLORS[rg] ?? C.dim}44`,
                            color: REGIME_COLORS[rg] ?? C.dim2,
                          }}>
                            {rg.replace('TRENDING_','T.')} {v.mean_sharpe > 0 ? '+' : ''}{v.mean_sharpe.toFixed(2)} ({v.n_folds}f)
                          </div>
                        ))}
                      </div>

                      {/* Signal lifecycle table */}
                      <div style={{ fontSize:8, color:C.faint, fontFamily:mono, marginBottom:4 }}>
                        SIGNAL LIFECYCLE — {Object.keys(lc).length} signals
                      </div>
                      <div style={{ display:'grid', gridTemplateColumns:'130px 130px 80px 70px 120px', gap:'1px 0' }}>
                        {['SIGNAL','STATUS','IC MEAN','IC SLOPE','BEST REGIME'].map(h => (
                          <span key={h} style={{ fontSize:7, color:C.faint, fontFamily:mono, padding:'2px 0', borderBottom:`1px solid ${C.border}` }}>{h}</span>
                        ))}
                        {Object.entries(lc)
                          .sort(([,a]: any, [,b]: any) => (b.ic_mean ?? -9) - (a.ic_mean ?? -9))
                          .map(([sig, v]: [string, any]) => {
                            const sc = v.status
                            const col = sc === 'ALIVE' ? C.green : sc === 'REGIME_SPECIALIST' ? C.gold : sc === 'RISING' ? C.teal : sc === 'DEAD' ? C.red : C.dim2
                            return [
                              <span key={`${sig}-n`} style={{ fontSize:8, color:C.text, fontFamily:mono, padding:'2px 0', borderBottom:`1px solid ${C.border}` }}>{sig}</span>,
                              <span key={`${sig}-s`} style={{ fontSize:8, color:col, fontFamily:mono, fontWeight:700, padding:'2px 0', borderBottom:`1px solid ${C.border}` }}>{sc}</span>,
                              <span key={`${sig}-i`} style={{ fontSize:8, color: v.ic_mean > 0 ? C.green : C.red, fontFamily:mono, padding:'2px 0', borderBottom:`1px solid ${C.border}` }}>
                                {v.ic_mean != null ? `${v.ic_mean > 0 ? '+' : ''}${v.ic_mean.toFixed(4)}` : '—'}
                              </span>,
                              <span key={`${sig}-sl`} style={{ fontSize:7, color: v.ic_slope > 0 ? C.green : C.red, fontFamily:mono, padding:'2px 0', borderBottom:`1px solid ${C.border}` }}>
                                {v.ic_slope != null ? `${v.ic_slope > 0 ? '↑' : '↓'}${Math.abs(v.ic_slope).toExponential(1)}` : '—'}
                              </span>,
                              <span key={`${sig}-r`} style={{
                                fontSize:7, padding:'2px 0', borderBottom:`1px solid ${C.border}`, fontFamily:mono,
                                color: REGIME_COLORS[v.best_regime ?? ''] ?? C.dim2,
                              }}>{v.best_regime ?? '—'}</span>,
                            ]
                          })}
                      </div>

                      {/* Fold timeline */}
                      <div style={{ fontSize:8, color:C.faint, fontFamily:mono, marginTop:10, marginBottom:4 }}>
                        FOLD TIMELINE — {r.folds?.length ?? 0} folds
                      </div>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:2 }}>
                        {(r.folds ?? []).map((f: any) => {
                          const sh = f.oos?.sharpe ?? 0
                          return (
                            <div key={f.fold} title={`${f.test_start} OOS=${sh} IS/OOS=${f.is_oos_ratio}`}
                              style={{
                                width:22, height:22, borderRadius:2, display:'flex', alignItems:'center', justifyContent:'center',
                                background: sh > 0 ? `${C.green}33` : `${C.red}33`,
                                border:`1px solid ${sh > 0 ? C.green : C.red}66`,
                                fontSize:7, fontFamily:mono, color: sh > 0 ? C.green : C.red, cursor:'default',
                              }}>
                              {sh != null ? (sh > 0 ? '+' : '') + sh.toFixed(1) : '?'}
                            </div>
                          )
                        })}
                      </div>
                      <div style={{ fontSize:7, color:C.faint, fontFamily:mono, marginTop:4 }}>
                        generated {r.generated_at} · {r.elapsed_s}s
                      </div>
                    </div>
                  )
                })() : (
                  <div style={{ fontSize:9, color:C.faint }}>No futures WF report — select symbol + years above and run.</div>
                )}
              </Panel>

              {/* ── Crypto signal_log WF (legacy) ──────────────────────────── */}
              <Panel head="SIGNAL LOG WALK-FORWARD (crypto · signal_log.db)" headColor={C.tealD}
                right={<span style={{ fontSize:8, color: walkRpt?.ok ? C.teal : C.faint, fontFamily:mono }}>{walkRpt?.ok ? `● ${walkRpt.n_folds}f ${walkRpt.verdict ?? '?'}` : '○ —'}</span>}>
                {walkRpt?.signal_lifecycle ? (
                  <div>
                    <div style={{ display:'flex', gap:12, marginBottom:6, flexWrap:'wrap' }}>
                      {[
                        ['OOS Sharpe', walkRpt.summary?.oos_sharpe?.mean != null ? `${walkRpt.summary.oos_sharpe.mean > 0 ? '+' : ''}${walkRpt.summary.oos_sharpe.mean.toFixed(2)}` : '—', walkRpt.summary?.oos_sharpe?.mean > 0 ? C.green : C.red],
                        ['Verdict', walkRpt.verdict, walkRpt.verdict === 'ROBUST' ? C.green : C.gold],
                        ['Folds', walkRpt.n_folds, C.dim2],
                        ['Retire', walkRpt.retire_candidates?.length ?? 0, C.red],
                        ['Specialist', walkRpt.specialist_list?.length ?? 0, C.gold],
                      ].map(([l, v, c]) => (
                        <div key={l as string} style={{ display:'flex', flexDirection:'column', gap:1 }}>
                          <span style={{ fontSize:7, color:C.faint, fontFamily:mono }}>{l}</span>
                          <span style={{ fontSize:9, color:c as string, fontFamily:mono, fontWeight:700 }}>{v ?? '—'}</span>
                        </div>
                      ))}
                    </div>
                    {Object.entries(walkRpt.signal_lifecycle).slice(0, 15).map(([sig, v]: [string, any]) => (
                      <div key={sig} style={{ display:'flex', gap:10, padding:'2px 0', borderBottom:`1px solid ${C.border}`, fontSize:8 }}>
                        <span style={{ color:C.text, width:120, fontFamily:mono }}>{sig}</span>
                        <span style={{
                          color: v.status === 'ALIVE' ? C.green : v.status === 'REGIME_SPECIALIST' ? C.gold : v.status === 'RISING' ? C.teal : v.status === 'DEAD' ? C.red : C.dim2,
                          fontWeight:700, width:130, fontFamily:mono,
                        }}>{v.status}</span>
                        <span style={{ color: v.ic_mean > 0 ? C.green : C.red, fontFamily:mono }}>
                          IC {v.ic_mean != null ? `${v.ic_mean > 0 ? '+' : ''}${v.ic_mean.toFixed(4)}` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize:9, color:C.faint, marginBottom:6 }}>No signal_log WF cached — requires signal_log.db data.</div>
                    <Btn small label="RUN SIGNAL LOG WF (~2min)" color={C.teal}
                      onClick={() => fetch(`${DS}/v1/walkforward/run/`, { method:'POST' })} />
                  </div>
                )}
              </Panel>
            </div>
          )}

          {tab === 'discovery' && (
            <Panel head="SIGNAL DISCOVERY (BH-FDR · 500+ OHLCV transforms)" headColor={C.teal}
              right={<span style={{ fontSize:8, color: discovRpt?.ok ? C.teal : C.faint, fontFamily:mono }}>
                {discovRpt?.ok ? `● ${discovRpt.symbol} ${discovRpt.n_fdr_survivors}/${discovRpt.n_candidates} FDR` : '○ —'}
              </span>}>
              {/* Sym selector + run */}
              <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:8, flexWrap:'wrap' }}>
                {['ES','NQ','GC','CL','BTC','ETH'].map(s => (
                  <button key={s} onClick={() => setDiscovSym(s)} style={{
                    padding:'2px 8px', fontSize:8, fontFamily:mono, cursor:'pointer', borderRadius:2,
                    background: discovSym===s ? `${C.teal}22` : C.bg2,
                    border:`1px solid ${discovSym===s ? C.teal : C.dim}`,
                    color: discovSym===s ? C.teal : C.dim2,
                  }}>{s}</button>
                ))}
                <Btn small label={`RUN ${discovSym} (~60s)`} color={C.teal}
                  onClick={() => fetch(`${DS}/v1/discovery/run/?symbol=${discovSym}`, { method:'POST' })} />
              </div>

              {discovRpt?.top_signals ? (
                <div>
                  <div style={{ fontSize:9, color:C.dim2, marginBottom:6 }}>
                    {discovRpt.n_candidates ?? '?'} candidates · {discovRpt.n_fdr_survivors ?? '?'} FDR survivors
                    · α={discovRpt.fdr_alpha ?? 0.05} · horizon {discovRpt.outcome_horizon ?? '?'}
                    · symbol {discovRpt.symbol ?? '?'} · {discovRpt.runtime_s ?? '?'}s
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'180px 70px 60px', gap:'1px 8px', marginBottom:4 }}>
                    {['FEATURE','IC','P-VALUE'].map(h => (
                      <span key={h} style={{ fontSize:7, color:C.faint, fontFamily:mono, borderBottom:`1px solid ${C.border}`, paddingBottom:2 }}>{h}</span>
                    ))}
                    {(discovRpt.top_signals ?? []).slice(0, 30).map((s: any, i: number) => [
                      <span key={`${i}-n`} style={{ fontSize:8, color:C.teal, fontFamily:mono, padding:'2px 0', borderBottom:`1px solid ${C.border}` }}>{s.name}</span>,
                      <span key={`${i}-ic`} style={{ fontSize:8, color: s.ic > 0 ? C.green : C.red, fontFamily:mono, padding:'2px 0', borderBottom:`1px solid ${C.border}` }}>
                        {s.ic > 0 ? '+' : ''}{s.ic?.toFixed(4)}
                      </span>,
                      <span key={`${i}-p`} style={{ fontSize:7, color:C.dim2, fontFamily:mono, padding:'2px 0', borderBottom:`1px solid ${C.border}` }}>
                        {s.pval?.toFixed(4)}
                      </span>,
                    ])}
                  </div>
                  <div style={{ fontSize:7, color:C.faint, fontFamily:mono }}>generated {discovRpt.generated_at}</div>
                </div>
              ) : (
                <div style={{ fontSize:9, color:C.faint }}>No discovery report — select symbol above and run.</div>
              )}
            </Panel>
          )}

          {tab === 'ic' && (
            <Panel head="IC HALF-LIFE MONITOR" headColor={C.gold}
              right={<span style={{ fontSize:8, color: icRpt ? C.gold : C.faint, fontFamily:mono }}>{icRpt ? '● CACHED' : '○ —'}</span>}>
              {icRpt?.signals ? (
                <div>
                  <div style={{ fontSize:9, color:C.dim2, marginBottom:8 }}>Rolling 14-day Spearman IC · RETIRE threshold slope &lt; −0.0003</div>
                  {Object.entries(icRpt.signals ?? {}).map(([sig, data]: [string, any]) => (
                    <div key={sig} style={{ display:'flex', gap:12, padding:'3px 0', borderBottom:`1px solid ${C.border}`, fontSize:9 }}>
                      <span style={{ color:C.text, width:140 }}>{sig}</span>
                      <span style={{
                        color: data.status === 'HEALTHY' ? C.green : data.status === 'RETIRE' ? C.red : C.dim2,
                        fontWeight:700, width:80,
                      }}>{data.status ?? '—'}</span>
                      <span style={{ color:C.gold }}>IC {(data.ic_latest ?? 0).toFixed(4)}</span>
                      {data.halflife_days && (
                        <span style={{ color:C.dim2 }}>HL {data.halflife_days.toFixed(0)}d</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize:9, color:C.faint, marginBottom:8 }}>No IC report cached.</div>
                  <Btn label="RUN IC MONITOR" color={C.gold}
                    onClick={() => fetch(`${DS}/v1/ic/run/`, { method:'POST' })} />
                </div>
              )}
            </Panel>
          )}
          {tab === 'regime' && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>

              {/* Symbol selector */}
              <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                <span style={{ fontSize:8, color:C.dim2, fontFamily:mono, letterSpacing:'0.1em' }}>SYMBOL</span>
                {FUTURES_SYMS.map(s => (
                  <button key={s} onClick={() => setRegimeSym(s)} style={{
                    padding:'3px 8px', fontSize:8, fontFamily:mono, fontWeight:700,
                    background: regimeSym === s ? `${C.orange}22` : C.bg3,
                    border:`1px solid ${regimeSym === s ? C.orange : C.dim}`,
                    color: regimeSym === s ? C.orange : C.faint,
                    borderRadius:2, cursor:'pointer',
                  }}>{s}</button>
                ))}
                <span style={{ fontSize:8, color: regimeSnap?.ok ? C.green : C.faint, marginLeft:8, fontFamily:mono }}>
                  {regimeSnap?.ok ? '● LIVE' : '○ —'}
                </span>
              </div>

              {/* Row 1: Live state + signal routing */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>

                {/* Live regime state */}
                <Panel head="LIVE REGIME STATE" headColor={regimeSnap?.ok ? (REGIME_COLORS[regimeSnap.regime] ?? C.faint) : C.faint}>
                  {regimeSnap?.ok ? (() => {
                    const rc = REGIME_COLORS[regimeSnap.regime] ?? C.faint
                    return (
                      <>
                        {/* Big regime label */}
                        <div style={{
                          textAlign:'center', padding:'12px 0', marginBottom:10,
                          background:`${rc}14`, border:`1px solid ${rc}44`, borderRadius:3,
                        }}>
                          <div style={{ fontSize:18, fontWeight:700, color:rc, letterSpacing:'0.12em' }}>
                            {regimeSnap.regime}
                          </div>
                          <div style={{ fontSize:8, color:C.dim2, marginTop:4 }}>
                            {REGIME_DESC[regimeSnap.regime] ?? ''}
                          </div>
                        </div>

                        {/* Diagnostics */}
                        {[
                          ['BARS IN REGIME',  String(regimeSnap.bars_in_regime),             regimeSnap.bars_in_regime > 20 ? C.gold : C.text],
                          ['ATR RANK',        `${(regimeSnap.atr_rank * 100).toFixed(0)}pct`, regimeSnap.atr_rank > 0.6 ? C.green : regimeSnap.atr_rank < 0.3 ? C.red : C.text],
                          ['RVOL NOW',        `${regimeSnap.rvol_now.toFixed(2)}×`,           regimeSnap.rvol_now > 1.5 ? C.gold : C.dim2],
                          ['SQUEEZE',         regimeSnap.squeeze_now ? 'ON ⚠' : 'OFF',       regimeSnap.squeeze_now ? C.purple : C.green],
                          ['EMA ALIGNED',     regimeSnap.ema_aligned ? 'YES' : 'NO',          regimeSnap.ema_aligned ? C.green : C.faint],
                          ['ATR VELOCITY',    regimeSnap.atr_velocity > 0 ? `+${regimeSnap.atr_velocity.toFixed(3)}` : regimeSnap.atr_velocity.toFixed(3), regimeSnap.atr_velocity > 0.02 ? C.green : regimeSnap.atr_velocity < -0.02 ? C.red : C.dim2],
                        ].map(([l, v, col]) => (
                          <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'3px 0', borderBottom:`1px solid ${C.border}`, fontSize:9 }}>
                            <span style={{ color:C.dim2 }}>{l}</span>
                            <span style={{ color:col as string, fontWeight:600 }}>{v}</span>
                          </div>
                        ))}

                        {regimeSnap.transition_risk && (
                          <div style={{ marginTop:8, padding:'5px 8px', background:`${C.gold}11`, border:`1px solid ${C.gold}44`, borderRadius:2, fontSize:8, color:C.gold }}>
                            ⚠ TRANSITION RISK — regime may be exhausting
                          </div>
                        )}
                        {regimeSnap.squeeze_released && (
                          <div style={{ marginTop:4, padding:'5px 8px', background:`${C.teal}11`, border:`1px solid ${C.teal}44`, borderRadius:2, fontSize:8, color:C.teal }}>
                            ◉ SQUEEZE JUST RELEASED — BREAKOUT WINDOW OPEN
                          </div>
                        )}
                      </>
                    )
                  })() : (
                    <div style={{ fontSize:9, color:C.faint }}>Loading… /v1/regime/?symbol={regimeSym}</div>
                  )}
                </Panel>

                {/* Signal routing in current regime */}
                <Panel head="SIGNAL ROUTING — CURRENT REGIME" headColor={C.orange}>
                  {regimeSnap?.ok ? (() => {
                    const routing = REGIME_SIGNALS[regimeSnap.regime]
                    if (!routing) return <div style={{ fontSize:9, color:C.faint }}>No routing data for {regimeSnap.regime}</div>
                    return (
                      <>
                        <div style={{ marginBottom:8 }}>
                          <div style={{ fontSize:8, color:C.dim2, marginBottom:4, letterSpacing:'0.1em' }}>BOOSTED SIGNALS</div>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                            {routing.active.map(sig => (
                              <span key={sig} style={{
                                padding:'2px 6px', borderRadius:2, fontSize:8, fontFamily:mono, fontWeight:700,
                                background:`${C.green}18`, border:`1px solid ${C.green}55`, color:C.green,
                              }}>{sig}</span>
                            ))}
                          </div>
                        </div>
                        <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:8 }}>
                          <div style={{ fontSize:8, color:C.dim2, marginBottom:4, letterSpacing:'0.1em' }}>SUPPRESSED SIGNALS</div>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                            {routing.muted.map(sig => (
                              <span key={sig} style={{
                                padding:'2px 6px', borderRadius:2, fontSize:8, fontFamily:mono,
                                background:`${C.red}10`, border:`1px solid ${C.red}33`, color:C.faint,
                              }}>{sig}</span>
                            ))}
                          </div>
                        </div>
                        <div style={{ borderTop:`1px solid ${C.border}`, marginTop:10, paddingTop:8 }}>
                          <div style={{ fontSize:8, color:C.dim2, marginBottom:6, letterSpacing:'0.1em' }}>ALL 7 REGIMES</div>
                          {Object.entries(REGIME_DESC).map(([r, desc]) => (
                            <div key={r} style={{ display:'flex', alignItems:'center', gap:6, padding:'2px 0' }}>
                              <span style={{
                                width:6, height:6, borderRadius:1, flexShrink:0,
                                background: REGIME_COLORS[r] ?? C.faint,
                                opacity: r === regimeSnap.regime ? 1 : 0.35,
                              }} />
                              <span style={{
                                fontSize:8, fontFamily:mono, fontWeight: r === regimeSnap.regime ? 700 : 400,
                                color: r === regimeSnap.regime ? (REGIME_COLORS[r] ?? C.text) : C.faint,
                                width:120,
                              }}>{r}</span>
                              <span style={{ fontSize:7, color:C.faint }}>{desc}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )
                  })() : (
                    <div style={{ fontSize:9, color:C.faint }}>Waiting for regime snapshot…</div>
                  )}
                </Panel>
              </div>

              {/* Row 2: Regime timeline */}
              <Panel head={`REGIME TIMELINE — LAST ${regimeSeries?.n ?? 200} BARS · ${regimeSym}`} headColor={C.dim2}>
                {regimeSeries?.ok && regimeSeries.labels.length > 0 ? (
                  <>
                    {/* Color strip */}
                    <div style={{ display:'flex', gap:1, marginBottom:8, overflow:'hidden' }}>
                      {regimeSeries.labels.map((r, i) => (
                        <div key={i} title={r} style={{
                          flex:1, height:18, minWidth:2,
                          background: REGIME_COLORS[r] ?? C.faint,
                          opacity: r === regimeSnap?.regime ? 1 : 0.55,
                          borderRadius:1,
                        }} />
                      ))}
                    </div>
                    {/* Legend */}
                    <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                      {Object.entries(regimeSeries.distribution)
                        .sort((a, b) => b[1] - a[1])
                        .map(([r, cnt]) => {
                          const pct = Math.round((cnt / regimeSeries.n) * 100)
                          const rc = REGIME_COLORS[r] ?? C.faint
                          return (
                            <div key={r} style={{ display:'flex', alignItems:'center', gap:4 }}>
                              <div style={{ width:10, height:10, borderRadius:2, background:rc, opacity: r === regimeSnap?.regime ? 1 : 0.6 }} />
                              <span style={{ fontSize:8, color: r === regimeSnap?.regime ? rc : C.dim2, fontFamily:mono }}>
                                {r} {pct}%
                              </span>
                            </div>
                          )
                        })}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize:9, color:C.faint }}>Loading regime series…</div>
                )}
              </Panel>

            </div>
          )}

          {/* ── FIELD STATUS tab ── */}
          {tab === 'field' && (() => {
            const regime = regimeSnap?.regime ?? null
            const activeIds: string[] = regime ? (REGIME_SIGNALS[regime]?.active ?? []) : []
            const mutedIds:  string[] = regime ? (REGIME_SIGNALS[regime]?.muted  ?? []) : []

            // classify each algo by field status
            const onField   = algos.filter(a => activeIds.some(s => a.id.includes(s) || a.name.toLowerCase().includes(s.toLowerCase())))
            const lockerRm  = algos.filter(a => !onField.includes(a) && !mutedIds.some(s => a.id.includes(s) || a.name.toLowerCase().includes(s.toLowerCase())))
            const benchd    = algos.filter(a => mutedIds.some(s => a.id.includes(s) || a.name.toLowerCase().includes(s.toLowerCase())))

            const fieldSection = (label: string, items: typeof algos, color: string, desc: string) => (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6, padding:'4px 0', borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:11, fontWeight:700, color, letterSpacing:'0.1em' }}>{label}</span>
                  <span style={{ fontSize:9, color:C.faint }}>{desc}</span>
                  <span style={{ marginLeft:'auto', fontSize:10, color, fontWeight:700 }}>{items.length}</span>
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                  {items.length === 0
                    ? <span style={{ fontSize:9, color:C.faint }}>—</span>
                    : items.map(a => (
                      <button key={a.id} onClick={() => { setSelected(a); setTab('council') }} style={{
                        padding:'3px 8px', fontSize:9, fontFamily:mono, fontWeight:700,
                        background:`${bankColor(a.bank)}18`, border:`1px solid ${bankColor(a.bank)}55`,
                        color: color, borderRadius:3, cursor:'pointer',
                        opacity: label.includes('BENCH') ? 0.45 : 1,
                      }}>
                        {a.id}
                        <span style={{ fontSize:8, color:C.faint, marginLeft:4 }}>{a.bank}</span>
                      </button>
                    ))
                  }
                </div>
              </div>
            )

            return (
              <div style={{ overflow:'auto', padding:'0 4px' }}>
                {/* regime + action bar */}
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, padding:'8px 12px', background:C.bg1, border:`1px solid ${C.border}`, borderRadius:3 }}>
                  <span style={{ fontSize:10, color:C.dim2 }}>REGIME</span>
                  <span style={{ fontSize:13, fontWeight:700, color: regime ? (REGIME_COLORS[regime] ?? C.text) : C.faint }}>
                    {regime ?? 'loading…'}
                  </span>
                  {regime && <span style={{ fontSize:9, color:C.dim2 }}>{REGIME_DESC[regime]}</span>}
                  <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
                    <button onClick={() => window.location.hash = 'deltaops'} style={{
                      padding:'4px 10px', fontSize:9, fontFamily:mono, fontWeight:700,
                      border:`1px solid ${C.teal}`, borderRadius:3,
                      background:`${C.teal}11`, color:C.teal, cursor:'pointer',
                    }}>⟁ DELTA OPS →</button>
                    <button onClick={() => {
                      fetch(`http://127.0.0.1:8000/v1/delta/run/?mode=EUPHORIA&days=365`, { method:'POST' })
                        .then(r => r.json())
                        .then(j => alert(j.message ?? j.error))
                        .catch(() => alert('DS not running'))
                    }} style={{
                      padding:'4px 12px', fontSize:9, fontFamily:mono, fontWeight:700,
                      border:`1px solid ${C.gold}`, borderRadius:3,
                      background:`${C.gold}18`, color:C.gold, cursor:'pointer',
                      boxShadow:`0 0 6px ${C.gold}33`,
                    }}>✦ MEDALLION</button>
                  </div>
                </div>

                {regime
                  ? <>
                      {fieldSection('ON FIELD', onField,  C.green,  'active in current regime')}
                      {fieldSection('LOCKER ROOM', lockerRm, C.gold, 'eligible, not the right regime — ready')}
                      {fieldSection('BENCH', benchd, C.faint, 'signal muted by current regime conditions')}
                    </>
                  : <div style={{ fontSize:9, color:C.faint }}>Waiting for regime snapshot (DS :8000)…</div>
                }

                <div style={{ marginTop:12, padding:'8px 12px', background:C.bg1, border:`1px solid ${C.border}`, borderRadius:3, fontSize:9, color:C.faint, lineHeight:1.8 }}>
                  <span style={{color:C.dim2}}>BENCH = </span>signal muted by <code>{regime ?? '…'}</code> regime per REGIME_SIGNALS map. Click any algo chip → COUNCIL REVIEW.
                  <span style={{color:C.dim2, marginLeft:12}}>MEDALLION = </span>runs last 365d on EUPHORIA mode (~2min). Results in #deltaops IOPT tab.
                </div>
              </div>
            )
          })()}

        </div>

        {/* ── RIGHT: Medallion Research Panel (always visible, 4K) ── */}
        <div style={{ overflow:'auto', borderLeft:`1px solid ${C.border}`, padding:'8px 10px', display:'flex', flexDirection:'column', gap:8 }}>
          {/* header */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', paddingBottom:6, borderBottom:`1px solid ${C.goldD}44` }}>
            <span style={{ fontSize:10, color:C.gold, fontWeight:700, letterSpacing:'0.12em' }}>✦ MEDALLION</span>
            <button onClick={()=>{window.location.hash='medallion'}} style={{
              fontSize:8, padding:'2px 6px', border:`1px solid ${C.goldD}`, borderRadius:2,
              background:'transparent', color:C.goldD, cursor:'pointer',
            }}>FULL →</button>
          </div>

          {/* Simons doctrine simplified */}
          <div style={{ fontSize:8, color:C.faint, lineHeight:1.7, borderBottom:`1px solid ${C.border}`, paddingBottom:8 }}>
            <span style={{color:C.gold,fontWeight:700}}>DOCTRINE</span><br/>
            Signal civilisation, not rules.<br/>
            Decay is the permanent adversary.<br/>
            Execution kills paper alpha.<br/>
            System trades. No override.
          </div>

          {/* 7 blocks simplified */}
          <div style={{ fontSize:8, color:C.faint, fontWeight:700, letterSpacing:'0.1em', marginBottom:2 }}>7 BLOCKS — GAP STATUS</div>
          {[
            { id:'I',   label:'DATA UNIVERSE',    c:'#4a5568', gap:'BTC only. No alt data.' },
            { id:'II',  label:'SIGNAL DISCOVERY', c:C.purple,  gap:'IOPT = step 1 toward discovery.' },
            { id:'III', label:'SIGNAL LIBRARY',   c:C.teal,    gap:'signal_log.db = seed. No IC decomp.' },
            { id:'IV',  label:'DECAY ENGINE',     c:C.blue,    gap:'No half-life measurement.' },
            { id:'V',   label:'EXECUTION ALPHA',  c:'#ff8a3a', gap:'Frictionless proxy. Sharpe floor unknown.' },
            { id:'VI',  label:'CAPACITY',         c:'#ff6b6b', gap:'Single asset. No capacity model.' },
            { id:'VII', label:'RESEARCH LOOP',    c:C.green,   gap:'ghost_daemon.py not built yet.' },
          ].map(b => (
            <div key={b.id} style={{ padding:'5px 8px', borderRadius:3, background:`${b.c}12`, border:`1px solid ${b.c}33`, marginBottom:3 }}>
              <div style={{ display:'flex', alignItems:'baseline', gap:5 }}>
                <span style={{ fontSize:8, color:b.c, fontWeight:700, minWidth:16 }}>{b.id}</span>
                <span style={{ fontSize:9, fontWeight:700, color:C.text }}>{b.label}</span>
              </div>
              <div style={{ fontSize:8, color:C.faint, marginTop:2, lineHeight:1.4 }}>{b.gap}</div>
            </div>
          ))}

          {/* Medallion run */}
          <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:8, display:'flex', flexDirection:'column', gap:6 }}>
            <div style={{ fontSize:8, color:C.faint, fontWeight:700, letterSpacing:'0.1em' }}>QUICK RUN</div>
            <button onClick={async ()=>{
              try {
                const r = await fetch('http://127.0.0.1:8000/v1/delta/run/?mode=EUPHORIA&days=365',{method:'POST'})
                const j = await r.json()
                alert(j.message ?? j.error)
              } catch { alert('DS not running') }
            }} style={{
              padding:'5px 10px', fontSize:10, fontWeight:700, fontFamily:mono,
              border:`1px solid ${C.gold}`, borderRadius:4,
              background:C.goldDD, color:C.gold, cursor:'pointer',
              boxShadow:`0 0 8px ${C.gold}44`, letterSpacing:'0.1em',
            }}>✦ MEDALLION 365d</button>
            <button onClick={()=>{window.location.hash='star'}} style={{
              padding:'4px 10px', fontSize:9, fontWeight:700, fontFamily:mono,
              border:`1px solid ${C.teal}`, borderRadius:4,
              background:`${C.teal}11`, color:C.teal, cursor:'pointer',
            }}>★ STAR OPT LAB →</button>
            <button onClick={()=>{window.location.hash='deltaops'}} style={{
              padding:'4px 10px', fontSize:9, fontWeight:700, fontFamily:mono,
              border:`1px solid ${C.green}`, borderRadius:4,
              background:`${C.green}11`, color:C.green, cursor:'pointer',
            }}>⟁ DELTA OPS →</button>
          </div>
        </div>

      </div>
    </div>
  )
}
