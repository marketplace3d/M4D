import { useCallback, useEffect, useState } from 'react'
import type { PageId } from '../types'

// DS via Vite proxy
const DS = '/ds'

const REGIME_COLORS: Record<string, string> = {
  'RISK-OFF':        'var(--redB)',
  'EXHAUSTION':      '#ff8c20',
  'SQUEEZE':         'var(--purpleB)',
  'BREAKOUT':        'var(--tealB)',
  'TRENDING_STRONG': 'var(--greenB)',
  'TRENDING_WEAK':   '#6acc88',
  'RANGING':         'var(--text3)',
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
  'BREAKOUT':        { active:['SQZPOP','VOL_BO','BB_BREAK','SUPERTREND','EMA_STACK'],    muted:['RSI_STRONG','STOCH_CROSS','EMA_CROSS','MACD_CROSS'] },
  'TRENDING_STRONG': { active:['SUPERTREND','EMA_CROSS','MACD_CROSS','EMA_STACK','PSAR'], muted:['RSI_STRONG','STOCH_CROSS','SQZPOP','BB_BREAK'] },
  'TRENDING_WEAK':   { active:['EMA_STACK','ADX_TREND','PULLBACK'],                       muted:['RSI_STRONG','SQZPOP','VOL_BO'] },
  'RANGING':         { active:['RSI_STRONG','STOCH_CROSS'],                               muted:['SUPERTREND','EMA_CROSS','MACD_CROSS','VOL_BO','SQZPOP'] },
  'SQUEEZE':         { active:['SQZPOP'],                                                  muted:['SUPERTREND','EMA_CROSS','MACD_CROSS','VOL_BO'] },
  'EXHAUSTION':      { active:['RSI_STRONG','STOCH_CROSS'],                               muted:['SUPERTREND','EMA_STACK','VOL_BO','SQZPOP'] },
  'RISK-OFF':        { active:['GOLDEN'],                                                  muted:['SUPERTREND','EMA_CROSS','MACD_CROSS','VOL_BO','SQZPOP'] },
}
const FUTURES_SYMS = ['ES','NQ','GC','CL'] as const
type FuturesSym = typeof FUTURES_SYMS[number]

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

interface Algo27 { id: string; bank: string; name: string; stop_pct: number; hold_bars: number }

const PERSONA_NAMES = [
  { key:'trend', label:'Simons', color:'var(--greenB)', prompt:'You are Jim Simons. Statistical rigor. Brutal about overfitting. Assess IC/ICIR quality, sample size, multiple testing, regime breadth, alpha durability. Max 100 words.' },
  { key:'risk',  label:'Dalio',  color:'var(--goldB)',  prompt:'You are Ray Dalio. All-weather mindset. Assess worst-case drawdown, correlation risk, tail exposure, position sizing sanity, portfolio fit. Max 100 words.' },
  { key:'quant', label:'Soros',  color:'var(--purpleB)',prompt:'You are George Soros. Macro reflexivity. Assess whether the edge is structural or ephemeral, regime dependency, and whether the algo is fighting the tape. Max 100 words.' },
]

interface RegimeSnap {
  ok: boolean; symbol: string; regime: string; bars_in_regime: number
  transition_risk: boolean; atr_rank: number; rvol_now: number
  squeeze_now: boolean; squeeze_released: boolean; ema_aligned: boolean
}

interface Props { onPageChange: (p: PageId) => void }

const Panel = ({ head, headColor='var(--accent)', children, right }: {
  head:string; headColor?:string; children:React.ReactNode; right?:React.ReactNode
}) => (
  <div className="m5d-panel" style={{ marginBottom: 8 }}>
    <div className="m5d-panel-head" style={{ background: `${headColor}11` }}>
      <span className="panel-title" style={{ color: headColor }}>{head}</span>
      {right}
    </div>
    <div className="m5d-panel-body" style={{ overflow: 'auto' }}>{children}</div>
  </div>
)

const Btn = ({ label, color='var(--accent)', onClick, small }: { label:string; color?:string; onClick:()=>void; small?:boolean }) => (
  <button onClick={onClick} style={{
    padding: small ? '3px 8px' : '5px 11px',
    fontSize: small ? 8 : 9, fontFamily:'var(--font-mono)', fontWeight:700, letterSpacing:'0.1em',
    background:`${color}18`, border:`1px solid ${color}66`, color, borderRadius:2, cursor:'pointer', whiteSpace:'nowrap',
  }}>{label}</button>
)

export default function AlphaSeekPage({ onPageChange }: Props) {
  const algos27   = usePoll<{ algos: Algo27[] }>(`${DS}/v1/algos/`, 300_000)
  const walkRpt   = usePoll<any>(`${DS}/v1/walkforward/`, 120_000)
  const discovRpt = usePoll<any>(`${DS}/v1/discovery/`, 120_000)
  const icRpt     = usePoll<any>(`${DS}/v1/ic/report/`, 120_000)
  const ictWfRpt  = usePoll<any>(`${DS}/v1/ict-walkforward/`, 120_000)

  const [tab, setTab] = useState<'council'|'walk'|'discovery'|'ic'|'regime'|'field'|'ict'>('council')
  const [regimeSym, setRegimeSym] = useState<FuturesSym>('ES')
  const regimeSnap = usePoll<RegimeSnap>(`${DS}/v1/regime/?symbol=${regimeSym}`, 30_000)

  const [futWfSym, setFutWfSym] = useState<FuturesSym>('ES')
  const [futWfYears, setFutWfYears] = useState<number>(3)
  const futWfRpt = usePoll<any>(`${DS}/v1/futures/wf/`, 300_000)
  const [discovSym, setDiscovSym] = useState<string>('ES')

  const [selected, setSelected] = useState<Algo27 | null>(null)
  const [review, setReview] = useState<Record<string, string>>({})
  const [reviewing, setReviewing] = useState<Record<string, boolean>>({})
  const [filterBank, setFilterBank] = useState<string>('ALL')

  const algos = algos27?.algos ?? []
  const filtered = filterBank === 'ALL' ? algos : algos.filter(a => a.bank === filterBank)

  const bankColor = (b: string) => b === 'A' ? 'var(--accent)' : b === 'B' ? 'var(--goldB)' : 'var(--purpleB)'

  useEffect(() => {
    if (!filtered.length) {
      if (selected !== null) setSelected(null)
      return
    }
    if (!selected || !filtered.some(a => a.id === selected.id)) {
      setSelected(filtered[0]!)
    }
  }, [filtered, selected])

  const runReview = useCallback(async (algo: Algo27, persona: typeof PERSONA_NAMES[0]) => {
    const key = `${algo.id}-${persona.key}`
    setReviewing(p => ({ ...p, [key]:true }))
    setReview(p => ({ ...p, [key]:'' }))
    try {
      const msg = `Algo: ${algo.id} | Bank: ${algo.bank} | Name: ${algo.name}\nStop: ${algo.stop_pct}% | Hold: ${algo.hold_bars} bars\n\nGive your assessment. Should this make the live candidate bench?`
      const r = await fetch(`${DS}/v1/ai/claude/`, {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ system: persona.prompt, message: msg }),
      })
      const d = await r.json()
      setReview(p => ({ ...p, [key]: d.ok ? d.text : `[${d.error}]` }))
    } catch (e) {
      setReview(p => ({ ...p, [key]:`[fetch error: ${String(e)}]` }))
    }
    setReviewing(p => ({ ...p, [key]:false }))
  }, [])

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, fontFamily:'var(--font-mono)' }}>

      {/* Header */}
      <div style={{ padding:'6px 10px', background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:3, display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:6 }}>
        <div>
          <span style={{ fontSize:11, fontWeight:700, color:'var(--tealB)', letterSpacing:'0.16em' }}>⟡ ALPHASEEK</span>
          <span style={{ fontSize:9, color:'var(--text3)', marginLeft:12 }}>27 ALGOS · COUNCIL REVIEW · WALK-FORWARD · IC DECAY · DISCOVERY</span>
        </div>
        <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
          {(['ALL','A','B','C'] as const).map(b => (
            <button key={b} onClick={() => setFilterBank(b)} style={{
              padding:'3px 8px', fontSize:8, fontFamily:'var(--font-mono)', fontWeight:700,
              background: filterBank === b ? `rgba(58,143,255,0.15)` : 'var(--bg3)',
              border:`1px solid ${filterBank === b ? 'var(--accent)' : 'var(--border)'}`,
              color: filterBank === b ? bankColor(b === 'ALL' ? 'A' : b) : 'var(--text3)',
              borderRadius:2, cursor:'pointer',
            }}>{b === 'ALL' ? 'ALL' : `BANK ${b}`}</button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
        {([
          ['council',   'COUNCIL REVIEW', 'var(--purpleB)'],
          ['walk',      'WALK-FORWARD',   'var(--greenB)'],
          ['ict',       'ICT BACKTEST',   '#ff6b00'],
          ['discovery', 'DISCOVERY',      'var(--tealB)'],
          ['ic',        'IC DECAY',       'var(--goldB)'],
          ['regime',    'REGIME ENGINE',  '#ff8c20'],
          ['field',     'DEPLOYMENT STATUS', 'var(--greenB)'],
        ] as const).map(([id, label, color]) => (
          <button key={id} onClick={() => setTab(id as any)} style={{
            padding:'4px 11px', fontSize:9, fontFamily:'var(--font-mono)', fontWeight:700,
            background: tab === id ? `${color}22` : 'var(--bg2)',
            border:`1px solid ${tab === id ? color : 'var(--border)'}`,
            color: tab === id ? color : 'var(--text3)',
            borderRadius:3, cursor:'pointer',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', padding:'6px 8px', background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:3 }}>
        <span style={{ fontSize:8, color:'var(--text3)', letterSpacing:'0.1em' }}>ALGO</span>
        <select
          value={selected?.id ?? ''}
          onChange={(e) => {
            const next = filtered.find(a => a.id === e.target.value)
            if (next) setSelected(next)
          }}
          style={{
            minWidth: 260,
            padding:'4px 8px',
            fontSize:9,
            fontFamily:'var(--font-mono)',
            color:'var(--text)',
            background:'var(--bg3)',
            border:'1px solid var(--border)',
            borderRadius:3,
          }}
        >
          {!filtered.length && <option value="">No algos loaded</option>}
          {filtered.map(a => (
            <option key={a.id} value={a.id}>{`${a.id} · ${a.name} · Bank ${a.bank}`}</option>
          ))}
        </select>
        {selected && (
          <span className={`m5d-badge ${selected.bank === 'A' ? 'blue' : selected.bank === 'B' ? 'gold' : 'purple'}`}>{`BANK ${selected.bank}`}</span>
        )}
        <span style={{ marginLeft:'auto', fontSize:8, color:'var(--text3)' }}>
          {filtered.length ? `${filtered.length} algos` : 'Polling /v1/algos/…'}
        </span>
      </div>

      {/* Horizontal algo panels (restored) */}
      <div style={{
        border:'1px solid var(--border)',
        borderRadius:3,
        background:'var(--bg2)',
        padding:'6px',
        overflowX:'auto',
      }}>
        <div style={{ display:'flex', gap:6, minWidth: filtered.length ? filtered.length * 110 : 320 }}>
          {(filtered.length ? filtered : [
            { id:'NS', bank:'A', name:'placeholder', stop_pct:0, hold_bars:0 },
            { id:'CI', bank:'A', name:'placeholder', stop_pct:0, hold_bars:0 },
            { id:'BQ', bank:'A', name:'placeholder', stop_pct:0, hold_bars:0 },
            { id:'8E', bank:'B', name:'placeholder', stop_pct:0, hold_bars:0 },
            { id:'VT', bank:'B', name:'placeholder', stop_pct:0, hold_bars:0 },
            { id:'SE', bank:'C', name:'placeholder', stop_pct:0, hold_bars:0 },
          ] as Algo27[]).map(a => (
            <button
              key={a.id}
              onClick={() => setSelected(a)}
              style={{
                minWidth: 104,
                textAlign:'left',
                padding:'5px 6px',
                borderRadius:3,
                cursor:'pointer',
                background: selected?.id === a.id ? 'rgba(58,143,255,0.16)' : 'var(--bg3)',
                border:`1px solid ${selected?.id === a.id ? 'var(--accent)' : 'var(--border)'}`,
                color:'var(--text)',
                fontFamily:'var(--font-mono)',
              }}
              title={`${a.id} · ${a.name} · Bank ${a.bank}`}
            >
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:9, fontWeight:700, color: selected?.id === a.id ? bankColor(a.bank) : 'var(--text)' }}>{a.id}</span>
                <span className={`m5d-badge ${a.bank === 'A' ? 'blue' : a.bank === 'B' ? 'gold' : 'purple'}`} style={{ fontSize:6 }}>{a.bank}</span>
              </div>
              <div style={{ fontSize:7, color:'var(--text3)', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                {a.name}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 2-3 col responsive grid */}
      <div className="alphaseek-grid">

        {/* Col 1 — Algo list (retired; replaced by compact selector) */}
        {false && <div style={{ display:'flex', flexDirection:'column', gap:2, overflow:'auto', maxHeight:'calc(100vh - 260px)' }}>
          {filtered.map(a => (
            <button key={a.id} onClick={() => setSelected(a)} style={{
              display:'flex', justifyContent:'space-between', alignItems:'center',
              padding:'5px 8px', textAlign:'left',
              background: selected?.id === a.id ? 'rgba(58,143,255,0.12)' : 'var(--bg2)',
              border:`1px solid ${selected?.id === a.id ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius:3, cursor:'pointer', color:'var(--text)',
            }}>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color: selected?.id === a.id ? bankColor(a.bank) : 'var(--text)' }}>{a.id}</div>
                <div style={{ fontSize:8, color:'var(--text3)', marginTop:1 }}>{a.name}</div>
              </div>
              <span className={`m5d-badge ${a.bank === 'A' ? 'blue' : a.bank === 'B' ? 'gold' : 'purple'}`}>{a.bank}</span>
            </button>
          ))}
          {!algos.length && <div style={{ fontSize:9, color:'var(--text3)', padding:8 }}>Polling /v1/algos/…</div>}
        </div>}

        {/* Col 2 — Tab content */}
        <div style={{ overflow:'auto', minHeight:0 }}>

          {/* Council Review */}
          {tab === 'council' && selected && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ padding:'7px 10px', background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:3 }}>
                <div style={{ fontSize:11, fontWeight:700, color:bankColor(selected.bank) }}>{selected.id} — {selected.name}</div>
                <div style={{ fontSize:9, color:'var(--text3)', marginTop:2 }}>Bank {selected.bank} · Stop {selected.stop_pct}% · Hold {selected.hold_bars} bars</div>
              </div>
              {PERSONA_NAMES.map(p => {
                const key = `${selected.id}-${p.key}`
                const text = review[key]; const loading = reviewing[key]
                return (
                  <Panel key={p.key} head={`${p.label.toUpperCase()} REVIEW`} headColor={p.color}
                    right={<Btn label={loading ? 'RUNNING…' : '▶ RUN'} color={p.color} onClick={() => runReview(selected, p)} small />}>
                    {text ? (
                      <div style={{ fontSize:9, color:'var(--text)', lineHeight:1.7, whiteSpace:'pre-wrap' }}>{text}</div>
                    ) : loading ? (
                      <div style={{ fontSize:9, color:'var(--text3)' }}>Running Claude council review…</div>
                    ) : (
                      <div style={{ fontSize:9, color:'var(--text3)' }}>Press RUN to get {p.label}'s assessment</div>
                    )}
                  </Panel>
                )
              })}
            </div>
          )}
          {tab === 'council' && !selected && (
            <div style={{ fontSize:9, color:'var(--text3)', padding:20 }}>← Select an algo to run council review</div>
          )}

          {/* Walk-Forward */}
          {tab === 'walk' && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <Panel head="FUTURES WALK-FORWARD (ES/NQ)" headColor="var(--greenB)"
                right={<span style={{ fontSize:8, color: futWfRpt?.ok ? 'var(--greenB)' : 'var(--text3)' }}>{futWfRpt?.ok ? `● ${futWfRpt.symbol} ${futWfRpt.n_folds}f` : '○ —'}</span>}>
                <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:8, flexWrap:'wrap' }}>
                  {FUTURES_SYMS.map(s => (
                    <button key={s} onClick={() => setFutWfSym(s)} style={{
                      padding:'2px 7px', fontSize:8, fontFamily:'var(--font-mono)', cursor:'pointer', borderRadius:2,
                      background: futWfSym===s ? 'rgba(29,255,122,0.15)' : 'var(--bg3)',
                      border:`1px solid ${futWfSym===s ? 'var(--green)' : 'var(--border)'}`,
                      color: futWfSym===s ? 'var(--greenB)' : 'var(--text3)',
                    }}>{s}</button>
                  ))}
                  {[2,3,5].map(y => (
                    <button key={y} onClick={() => setFutWfYears(y)} style={{
                      padding:'2px 7px', fontSize:8, fontFamily:'var(--font-mono)', cursor:'pointer', borderRadius:2,
                      background: futWfYears===y ? 'rgba(58,143,255,0.15)' : 'var(--bg3)',
                      border:`1px solid ${futWfYears===y ? 'var(--accent)' : 'var(--border)'}`,
                      color: futWfYears===y ? 'var(--accent)' : 'var(--text3)',
                    }}>{y}yr</button>
                  ))}
                  <Btn small label={`RUN ${futWfSym} ${futWfYears}yr`} color="var(--greenB)"
                    onClick={() => fetch(`${DS}/v1/futures/wf/run/?sym=${futWfSym}&years=${futWfYears}`, { method:'POST' })} />
                </div>

                {futWfRpt?.ok ? (
                  <div>
                    <div style={{ display:'flex', gap:12, marginBottom:8, flexWrap:'wrap' }}>
                      {[
                        ['OOS Sharpe', futWfRpt.summary?.oos_sharpe?.mean != null ? `${futWfRpt.summary.oos_sharpe.mean > 0 ? '+' : ''}${futWfRpt.summary.oos_sharpe.mean.toFixed(2)}` : '—', futWfRpt.summary?.oos_sharpe?.mean > 0 ? 'var(--greenB)' : 'var(--redB)'],
                        ['Verdict', futWfRpt.verdict, futWfRpt.verdict === 'ROBUST' ? 'var(--greenB)' : 'var(--goldB)'],
                        ['Folds', futWfRpt.n_folds, 'var(--text3)'],
                      ].map(([l, v, c]) => (
                        <div key={l as string}>
                          <div style={{ fontSize:7, color:'var(--text3)' }}>{l}</div>
                          <div style={{ fontSize:10, color:c as string, fontWeight:700 }}>{v ?? '—'}</div>
                        </div>
                      ))}
                    </div>
                    {/* Fold timeline */}
                    <div style={{ display:'flex', flexWrap:'wrap', gap:2 }}>
                      {(futWfRpt.folds ?? []).map((f: any) => {
                        const sh = f.oos?.sharpe ?? 0
                        return (
                          <div key={f.fold} title={`${f.test_start} OOS=${sh}`}
                            style={{
                              width:20, height:20, borderRadius:2, display:'flex', alignItems:'center', justifyContent:'center',
                              background: sh > 0 ? 'rgba(29,255,122,0.2)' : 'rgba(255,74,90,0.2)',
                              border:`1px solid ${sh > 0 ? 'var(--green)' : 'var(--red)'}66`,
                              fontSize:7, color: sh > 0 ? 'var(--greenB)' : 'var(--redB)',
                            }}>
                            {sh != null ? (sh > 0 ? '+' : '') + sh.toFixed(1) : '?'}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize:9, color:'var(--text3)' }}>No futures WF — select symbol + years and run.</div>
                )}
              </Panel>

              <Panel head="SIGNAL LOG WF (crypto · signal_log.db)" headColor="var(--teal)"
                right={<span style={{ fontSize:8, color: walkRpt?.ok ? 'var(--tealB)' : 'var(--text3)' }}>{walkRpt?.ok ? `● ${walkRpt.n_folds}f ${walkRpt.verdict ?? '?'}` : '○ —'}</span>}>
                {walkRpt?.signal_lifecycle ? (
                  <div>
                    <div style={{ display:'flex', gap:10, marginBottom:6, flexWrap:'wrap' }}>
                      {[['OOS Sharpe', walkRpt.summary?.oos_sharpe?.mean != null ? `${walkRpt.summary.oos_sharpe.mean.toFixed(2)}` : '—', walkRpt.summary?.oos_sharpe?.mean > 0 ? 'var(--greenB)' : 'var(--redB)'],
                        ['Verdict', walkRpt.verdict, 'var(--goldB)'],
                        ['Retire', walkRpt.retire_candidates?.length ?? 0, 'var(--redB)'],
                      ].map(([l, v, c]) => (
                        <div key={l as string}>
                          <div style={{ fontSize:7, color:'var(--text3)' }}>{l}</div>
                          <div style={{ fontSize:9, color:c as string, fontWeight:700 }}>{v ?? '—'}</div>
                        </div>
                      ))}
                    </div>
                    {Object.entries(walkRpt.signal_lifecycle).slice(0,15).map(([sig, v]: [string, any]) => (
                      <div key={sig} style={{ display:'flex', gap:8, padding:'2px 0', borderBottom:'1px solid var(--border)', fontSize:8 }}>
                        <span style={{ color:'var(--text)', width:120 }}>{sig}</span>
                        <span style={{ color: v.status === 'ALIVE' ? 'var(--greenB)' : v.status === 'DEAD' ? 'var(--redB)' : 'var(--goldB)', fontWeight:700, width:130 }}>{v.status}</span>
                        <span style={{ color: v.ic_mean > 0 ? 'var(--greenB)' : 'var(--redB)' }}>IC {v.ic_mean != null ? `${v.ic_mean > 0 ? '+' : ''}${v.ic_mean.toFixed(4)}` : '—'}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize:9, color:'var(--text3)', marginBottom:6 }}>No signal_log WF — requires signal_log.db.</div>
                    <Btn small label="RUN SIGNAL LOG WF (~2min)" color="var(--tealB)"
                      onClick={() => fetch(`${DS}/v1/walkforward/run/`, { method:'POST' })} />
                  </div>
                )}
              </Panel>
            </div>
          )}

          {/* Discovery */}
          {tab === 'discovery' && (
            <Panel head="SIGNAL DISCOVERY (BH-FDR · 500+ candidates)" headColor="var(--tealB)"
              right={<span style={{ fontSize:8, color: discovRpt?.ok ? 'var(--tealB)' : 'var(--text3)' }}>{discovRpt?.ok ? `● ${discovRpt.n_fdr_survivors}/${discovRpt.n_candidates} FDR` : '○ —'}</span>}>
              <div style={{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap' }}>
                {['ES','NQ','GC','CL','BTC','ETH'].map(s => (
                  <button key={s} onClick={() => setDiscovSym(s)} style={{
                    padding:'2px 7px', fontSize:8, fontFamily:'var(--font-mono)', cursor:'pointer', borderRadius:2,
                    background: discovSym===s ? 'rgba(42,232,232,0.12)' : 'var(--bg3)',
                    border:`1px solid ${discovSym===s ? 'var(--teal)' : 'var(--border)'}`,
                    color: discovSym===s ? 'var(--tealB)' : 'var(--text3)',
                  }}>{s}</button>
                ))}
                <Btn small label={`RUN ${discovSym}`} color="var(--tealB)"
                  onClick={() => fetch(`${DS}/v1/discovery/run/?symbol=${discovSym}`, { method:'POST' })} />
              </div>
              {discovRpt?.top_signals ? (
                <div>
                  <div style={{ fontSize:9, color:'var(--text3)', marginBottom:6 }}>
                    {discovRpt.n_candidates ?? '?'} candidates · {discovRpt.n_fdr_survivors ?? '?'} FDR survivors · α={discovRpt.fdr_alpha ?? 0.05}
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'180px 70px 60px', gap:'1px 8px', marginBottom:4 }}>
                    {['FEATURE','IC','P-VALUE'].map(h => (
                      <span key={h} style={{ fontSize:7, color:'var(--text3)', borderBottom:'1px solid var(--border)', paddingBottom:2 }}>{h}</span>
                    ))}
                    {(discovRpt.top_signals ?? []).slice(0,25).map((s: any, i: number) => [
                      <span key={`${i}-n`} style={{ fontSize:8, color:'var(--tealB)', padding:'2px 0', borderBottom:'1px solid var(--border)' }}>{s.name}</span>,
                      <span key={`${i}-ic`} style={{ fontSize:8, color: s.ic > 0 ? 'var(--greenB)' : 'var(--redB)', padding:'2px 0', borderBottom:'1px solid var(--border)' }}>
                        {s.ic > 0 ? '+' : ''}{s.ic?.toFixed(4)}
                      </span>,
                      <span key={`${i}-p`} style={{ fontSize:7, color:'var(--text3)', padding:'2px 0', borderBottom:'1px solid var(--border)' }}>
                        {s.pval?.toFixed(4)}
                      </span>,
                    ])}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize:9, color:'var(--text3)' }}>No discovery report — select symbol and run.</div>
              )}
            </Panel>
          )}

          {/* IC Decay */}
          {tab === 'ic' && (
            <Panel head="IC HALF-LIFE MONITOR" headColor="var(--goldB)"
              right={<span style={{ fontSize:8, color: icRpt ? 'var(--goldB)' : 'var(--text3)' }}>{icRpt ? '● CACHED' : '○ —'}</span>}>
              {icRpt?.signals ? (
                <div>
                  <div style={{ fontSize:9, color:'var(--text3)', marginBottom:8 }}>Rolling 14-day Spearman IC · RETIRE threshold slope &lt; −0.0003</div>
                  {Object.entries(icRpt.signals ?? {}).map(([sig, data]: [string, any]) => (
                    <div key={sig} style={{ display:'flex', gap:10, padding:'3px 0', borderBottom:'1px solid var(--border)', fontSize:9 }}>
                      <span style={{ color:'var(--text)', width:140 }}>{sig}</span>
                      <span style={{ color: data.status === 'HEALTHY' ? 'var(--greenB)' : data.status === 'RETIRE' ? 'var(--redB)' : 'var(--text2)', fontWeight:700, width:80 }}>{data.status ?? '—'}</span>
                      <span style={{ color:'var(--goldB)' }}>IC {(data.ic_latest ?? 0).toFixed(4)}</span>
                      {data.halflife_days && <span style={{ color:'var(--text3)' }}>HL {data.halflife_days.toFixed(0)}d</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize:9, color:'var(--text3)', marginBottom:8 }}>No IC report cached.</div>
                  <Btn label="RUN IC MONITOR" color="var(--goldB)"
                    onClick={() => fetch(`${DS}/v1/ic/run/`, { method:'POST' })} />
                </div>
              )}
            </Panel>
          )}

          {/* Regime Engine */}
          {tab === 'regime' && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ display:'flex', gap:4, alignItems:'center', flexWrap:'wrap' }}>
                {FUTURES_SYMS.map(s => (
                  <button key={s} onClick={() => setRegimeSym(s)} style={{
                    padding:'3px 8px', fontSize:8, fontFamily:'var(--font-mono)', fontWeight:700,
                    background: regimeSym === s ? 'rgba(255,140,32,0.15)' : 'var(--bg3)',
                    border:`1px solid ${regimeSym === s ? '#ff8c20' : 'var(--border)'}`,
                    color: regimeSym === s ? '#ff8c20' : 'var(--text3)', borderRadius:2, cursor:'pointer',
                  }}>{s}</button>
                ))}
                <span style={{ fontSize:8, color: regimeSnap?.ok ? 'var(--greenB)' : 'var(--text3)', marginLeft:8 }}>
                  {regimeSnap?.ok ? '● LIVE' : '○ —'}
                </span>
              </div>

              <div className="grid2">
                <Panel head="LIVE REGIME STATE" headColor={regimeSnap?.ok ? (REGIME_COLORS[regimeSnap.regime] ?? 'var(--text3)') : 'var(--text3)'}>
                  {regimeSnap?.ok ? (
                    <>
                      <div style={{
                        textAlign:'center', padding:'10px 0', marginBottom:8,
                        background: `${REGIME_COLORS[regimeSnap.regime] ?? '#444'}18`,
                        border: `1px solid ${REGIME_COLORS[regimeSnap.regime] ?? '#444'}44`,
                        borderRadius:3,
                      }}>
                        <div style={{ fontSize:14, fontWeight:700, color: REGIME_COLORS[regimeSnap.regime], letterSpacing:'0.1em' }}>
                          {regimeSnap.regime}
                        </div>
                        <div style={{ fontSize:8, color:'var(--text3)', marginTop:3 }}>
                          {REGIME_DESC[regimeSnap.regime] ?? ''}
                        </div>
                      </div>
                      {[
                        ['BARS IN REGIME', String(regimeSnap.bars_in_regime), regimeSnap.bars_in_regime > 20 ? 'var(--goldB)' : 'var(--text)'],
                        ['ATR RANK', `${(regimeSnap.atr_rank * 100).toFixed(0)}pct`, regimeSnap.atr_rank > 0.6 ? 'var(--greenB)' : regimeSnap.atr_rank < 0.3 ? 'var(--redB)' : 'var(--text)'],
                        ['RVOL', `${regimeSnap.rvol_now.toFixed(2)}×`, regimeSnap.rvol_now > 1.5 ? 'var(--goldB)' : 'var(--text3)'],
                        ['SQUEEZE', regimeSnap.squeeze_now ? 'ON ⚠' : 'OFF', regimeSnap.squeeze_now ? 'var(--purpleB)' : 'var(--greenB)'],
                        ['EMA ALIGNED', regimeSnap.ema_aligned ? 'YES' : 'NO', regimeSnap.ema_aligned ? 'var(--greenB)' : 'var(--text3)'],
                      ].map(([l, v, col]) => (
                        <div key={l} className="stat-row">
                          <span className="stat-label">{l}</span>
                          <span className="stat-val" style={{ color: col as string }}>{v}</span>
                        </div>
                      ))}
                      {regimeSnap.transition_risk && (
                        <div style={{ marginTop:6, padding:'4px 6px', background:'rgba(255,204,58,0.08)', border:'1px solid var(--gold)', borderRadius:2, fontSize:8, color:'var(--goldB)' }}>
                          ⚠ TRANSITION RISK
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize:9, color:'var(--text3)' }}>Loading…</div>
                  )}
                </Panel>

                <Panel head="SIGNAL ROUTING — CURRENT REGIME" headColor="#ff8c20">
                  {regimeSnap?.ok ? (() => {
                    const routing = REGIME_SIGNALS[regimeSnap.regime]
                    if (!routing) return <div style={{ fontSize:9, color:'var(--text3)' }}>No routing for {regimeSnap.regime}</div>
                    return (
                      <>
                        <div style={{ marginBottom:8 }}>
                          <div style={{ fontSize:7, color:'var(--text3)', marginBottom:4, letterSpacing:'0.1em' }}>BOOSTED</div>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                            {routing.active.map(sig => (
                              <span key={sig} className="m5d-badge green" style={{ fontSize:7 }}>{sig}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize:7, color:'var(--text3)', marginBottom:4, letterSpacing:'0.1em' }}>SUPPRESSED</div>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                            {routing.muted.map(sig => (
                              <span key={sig} className="m5d-badge gray" style={{ fontSize:7 }}>{sig}</span>
                            ))}
                          </div>
                        </div>
                      </>
                    )
                  })() : (
                    <div style={{ fontSize:9, color:'var(--text3)' }}>Waiting for regime…</div>
                  )}
                </Panel>
              </div>
            </div>
          )}

          {/* Field Status */}
          {tab === 'field' && (() => {
            const regime = regimeSnap?.regime ?? null
            const activeIds = regime ? (REGIME_SIGNALS[regime]?.active ?? []) : []
            const mutedIds  = regime ? (REGIME_SIGNALS[regime]?.muted  ?? []) : []
            const onField   = algos.filter(a => activeIds.some(s => a.id.includes(s) || a.name.toLowerCase().includes(s.toLowerCase())))
            const benchd    = algos.filter(a => mutedIds.some(s => a.id.includes(s) || a.name.toLowerCase().includes(s.toLowerCase())))
            const lockerRm  = algos.filter(a => !onField.includes(a) && !benchd.includes(a))

            const section = (label: string, items: Algo27[], color: string, desc: string) => (
              <div style={{ marginBottom:12 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5, padding:'3px 0', borderBottom:'1px solid var(--border)' }}>
                  <span style={{ fontSize:10, fontWeight:700, color, letterSpacing:'0.1em' }}>{label}</span>
                  <span style={{ fontSize:8, color:'var(--text3)' }}>{desc}</span>
                  <span style={{ marginLeft:'auto', fontSize:10, color, fontWeight:700 }}>{items.length}</span>
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                  {items.length === 0
                    ? <span style={{ fontSize:9, color:'var(--text3)' }}>—</span>
                    : items.map(a => (
                      <button key={a.id} onClick={() => { setSelected(a); setTab('council') }} style={{
                        padding:'3px 8px', fontSize:9, fontFamily:'var(--font-mono)', fontWeight:700,
                        background: 'rgba(58,143,255,0.1)', border:'1px solid var(--accentD)',
                        color, borderRadius:3, cursor:'pointer',
                      }}>{a.id}</button>
                    ))
                  }
                </div>
              </div>
            )

            return (
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, padding:'6px 10px', background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:3 }}>
                  <span style={{ fontSize:9, color:'var(--text3)' }}>REGIME</span>
                  <span style={{ fontSize:12, fontWeight:700, color: regime ? (REGIME_COLORS[regime] ?? 'var(--text)') : 'var(--text3)' }}>
                    {regime ?? 'loading…'}
                  </span>
                  <button onClick={() => onPageChange('medallion')} style={{
                    marginLeft:'auto', padding:'3px 10px', fontSize:9, fontFamily:'var(--font-mono)', fontWeight:700,
                    border:'1px solid var(--gold)', borderRadius:3, background:'rgba(255,204,58,0.1)', color:'var(--goldB)', cursor:'pointer',
                  }}>✦ MEDALLION →</button>
                </div>
                {regime
                  ? <>{section('ACTIVE BOOK', onField, 'var(--greenB)', 'routed')}{section('CANDIDATE QUEUE', lockerRm, 'var(--goldB)', 'watchlist')}{section('SUPPRESSED SET', benchd, 'var(--text3)', 'muted')}</>
                  : <div style={{ fontSize:9, color:'var(--text3)' }}>Waiting for regime (DS :8000)…</div>
                }
              </div>
            )
          })()}

          {/* ICT BACKTEST */}
          {tab === 'ict' && (() => {
            const r = ictWfRpt
            const wf = r?.waterfall as any[] | undefined
            const maxSh = wf ? Math.max(...wf.map((w: any) => Math.abs(w.mean_oos_sharpe ?? 0)), 1) : 12
            const shColor = (v: number | null) => v == null ? 'var(--text3)' : v >= 10 ? '#ff6b00' : v > 0 ? 'var(--greenB)' : 'var(--redB)'
            const layerColor = (name: string) => name.startsWith('HK_+ict') ? '#ff6b00' : name.startsWith('L5') ? '#a78bfa' : name.startsWith('CTL') ? '#60a5fa' : 'var(--tealB)'
            return (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {/* Header row */}
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'5px 8px', background:'rgba(255,107,0,0.07)', border:'1px solid rgba(255,107,0,0.25)', borderRadius:3 }}>
                  <div>
                    <span style={{ fontSize:10, fontWeight:700, color:'#ff6b00', letterSpacing:'0.12em' }}>◉ ICT SIGNAL STACK BACKTEST</span>
                    {r?.data_range && <span style={{ fontSize:8, color:'var(--text3)', marginLeft:10 }}>{r.data_range.from} → {r.data_range.to} · {r.data_range.rows?.toLocaleString()} bars</span>}
                    {r?.generated_at && <span style={{ fontSize:8, color:'var(--text3)', marginLeft:8 }}>run: {r.generated_at.slice(0,16)}</span>}
                  </div>
                  <Btn small label="RUN (~5 min)" color="#ff6b00"
                    onClick={() => fetch(`${DS}/v1/ict-walkforward/run/`, { method:'POST' }).then(() => alert('ICT walkforward launched — refresh in 5min'))} />
                </div>

                {!r?.ok && (
                  <div style={{ fontSize:9, color:'var(--text3)', padding:'10px 0' }}>
                    No report yet. Click RUN to compute (~5min). Results persist across sessions.
                  </div>
                )}

                {wf && (
                  <>
                    {/* Waterfall chart */}
                    <div>
                      <div style={{ fontSize:8, color:'var(--text3)', marginBottom:4, letterSpacing:2 }}>SHARPE WATERFALL — OOS MEAN (42 FOLDS)</div>
                      {wf.map((row: any) => {
                        const sh = row.mean_oos_sharpe as number | null
                        const std = row.std_sharpe as number | null
                        const n = row.mean_n_per_fold as number | null
                        const wr = row.mean_win_rate as number | null
                        const pf = row.pct_pos_folds as number | null
                        const thin = row.thin_stats_warn as boolean
                        const barW = sh != null ? Math.abs(sh) / maxSh * 220 : 0
                        const color = layerColor(row.layer)
                        const isWinner = row.layer === 'HK_+ict_kz'
                        return (
                          <div key={row.layer} style={{ display:'flex', alignItems:'center', gap:6, padding:'2px 0', borderBottom:'1px solid rgba(255,255,255,0.04)', background: isWinner ? 'rgba(255,107,0,0.06)' : 'transparent' }}>
                            <span style={{ fontSize:7, color: isWinner ? '#ff6b00' : 'var(--text3)', width:280, flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontWeight: isWinner ? 700 : 400 }}
                              title={row.label}>{row.label}</span>
                            <div style={{ width:220, height:8, background:'var(--bg3)', borderRadius:1, flexShrink:0, position:'relative' }}>
                              {sh != null && <div style={{ position:'absolute', left:0, top:0, height:'100%', width:barW, background: isWinner ? '#ff6b00' : sh > 0 ? 'var(--greenB)' : 'var(--redB)', borderRadius:1, transition:'width 0.4s', boxShadow: isWinner ? '0 0 6px #ff6b00' : 'none' }} />}
                            </div>
                            <span style={{ fontSize:8, color: shColor(sh), fontWeight:700, width:44, textAlign:'right', flexShrink:0 }}>{sh != null ? `${sh > 0 ? '+' : ''}${sh.toFixed(2)}` : '—'}</span>
                            <span style={{ fontSize:7, color:'var(--text3)', width:34, flexShrink:0 }}>±{std != null ? std.toFixed(1) : '—'}</span>
                            <span style={{ fontSize:7, color:'var(--text3)', width:36, flexShrink:0 }}>{n != null ? `${Math.round(n)}N` : ''}</span>
                            <span style={{ fontSize:7, color: wr != null && wr >= 0.55 ? 'var(--greenB)' : 'var(--text3)', width:36, flexShrink:0 }}>{wr != null ? `${(wr*100).toFixed(0)}%WR` : ''}</span>
                            {thin && <span style={{ fontSize:6, color:'#ff8c20' }}>⚠THIN</span>}
                            {isWinner && <span style={{ fontSize:7, color:'#ff6b00', fontWeight:800 }}>★ BEST</span>}
                          </div>
                        )
                      })}
                    </div>

                    {/* RenTech gates */}
                    {r.rentech_gates && (
                      <div style={{ padding:'4px 8px', border:'1px solid rgba(255,255,255,0.07)', borderRadius:3 }}>
                        <div style={{ fontSize:8, color:'var(--text3)', marginBottom:4, letterSpacing:2 }}>
                          RENTECH GATES (L4 full ICT gate) — {r.rentech_gates.passed} · <span style={{ color: r.rentech_gates.verdict === 'ROBUST' ? 'var(--greenB)' : r.rentech_gates.verdict === 'PROMISING' ? 'var(--goldB)' : 'var(--redB)' }}>{r.rentech_gates.verdict}</span>
                        </div>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1px 8px' }}>
                          {Object.entries(r.rentech_gates.gates ?? {}).map(([k, v]) => (
                            <div key={k} style={{ display:'flex', gap:5, fontSize:7 }}>
                              <span style={{ color: v ? 'var(--greenB)' : 'var(--redB)' }}>{v ? '✓' : '○'}</span>
                              <span style={{ color:'var(--text3)' }}>{k.replace(/_/g,' ')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Signal fire rates + IC */}
                    <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                      <div style={{ flex:1, minWidth:180 }}>
                        <div style={{ fontSize:8, color:'var(--text3)', marginBottom:3, letterSpacing:2 }}>ICT SIGNAL FIRE RATES</div>
                        {Object.entries(r.signal_fire_rates ?? {}).map(([k, v]) => (
                          <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:7, padding:'1px 0', borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
                            <span style={{ color:'var(--text3)' }}>{k}</span>
                            <span style={{ color:'var(--text)', fontWeight:700 }}>{((v as number)*100).toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ flex:1, minWidth:180 }}>
                        <div style={{ fontSize:8, color:'var(--text3)', marginBottom:3, letterSpacing:2 }}>ICT SIGNAL IC (OOS SPEARMAN)</div>
                        {Object.entries(r.ict_ic ?? {}).map(([k, v]) => (
                          <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:7, padding:'1px 0', borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
                            <span style={{ color:'var(--text3)' }}>{k}</span>
                            <span style={{ color: (v as number) > 0.01 ? 'var(--greenB)' : (v as number) < -0.01 ? 'var(--redB)' : 'var(--text3)', fontWeight:700 }}>
                              {v != null ? `${(v as number) > 0 ? '+' : ''}${(v as number).toFixed(4)}` : '—'}
                            </span>
                          </div>
                        ))}
                        {r.killzone_overlap && (
                          <div style={{ marginTop:6, padding:'3px 6px', background:'rgba(255,255,255,0.04)', borderRadius:2 }}>
                            <div style={{ fontSize:7, color:'var(--text3)' }}>KZ blocked by HOUR_KILLS: <span style={{ color: (r.killzone_overlap.kz_blocked_by_hk ?? 0) > 0.6 ? 'var(--redB)' : 'var(--greenB)', fontWeight:700 }}>{((r.killzone_overlap.kz_blocked_by_hk ?? 0)*100).toFixed(0)}%</span></div>
                            <div style={{ fontSize:7, color:'var(--text3)', marginTop:1 }}>{r.killzone_overlap.note}</div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Devil's Advocate */}
                    {(r.devils_advocate?.length ?? 0) > 0 && (
                      <div style={{ padding:'4px 8px', border:'1px solid rgba(255,204,58,0.2)', borderRadius:3, background:'rgba(255,204,58,0.04)' }}>
                        <div style={{ fontSize:8, color:'var(--goldB)', marginBottom:4, letterSpacing:2 }}>DEVIL'S ADVOCATE</div>
                        {(r.devils_advocate as string[]).map((d, i) => (
                          <div key={i} style={{ fontSize:7, color:'var(--goldB)', opacity:0.85, padding:'1px 0' }}>⚠ {d}</div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })()}
        </div>

        {/* Col 3 — Medallion quick panel removed (duplicate of Medallion page) */}
        {false && <div style={{ overflow:'auto', borderLeft:'1px solid var(--border)', padding:'8px 10px', display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', paddingBottom:6, borderBottom:'1px solid rgba(255,204,58,0.3)' }}>
            <span style={{ fontSize:10, color:'var(--goldB)', fontWeight:700, letterSpacing:'0.12em' }}>✦ MEDALLION</span>
            <button onClick={() => onPageChange('medallion')} style={{
              fontSize:8, padding:'2px 6px', border:'1px solid var(--gold)', borderRadius:2,
              background:'transparent', color:'var(--gold)', cursor:'pointer',
            }}>FULL →</button>
          </div>
          <div style={{ fontSize:8, color:'var(--text3)', lineHeight:1.7 }}>
            <span style={{color:'var(--goldB)',fontWeight:700}}>DOCTRINE</span><br/>
            Signal civilisation, not rules.<br/>
            Decay is the permanent adversary.<br/>
            Execution kills paper alpha.<br/>
            System trades. No override.
          </div>
          {[
            { id:'I',   label:'DATA UNIVERSE',    c:'var(--text3)',   gap:'BTC only. No alt data.' },
            { id:'II',  label:'SIGNAL DISCOVERY', c:'var(--purpleB)', gap:'IOPT = step 1.' },
            { id:'III', label:'SIGNAL LIBRARY',   c:'var(--tealB)',   gap:'signal_log.db = seed.' },
            { id:'IV',  label:'DECAY ENGINE',     c:'var(--accent)',  gap:'No half-life measurement.' },
            { id:'V',   label:'EXECUTION ALPHA',  c:'#ff8a3a',        gap:'Frictionless proxy.' },
            { id:'VI',  label:'CAPACITY',         c:'#ff6b6b',        gap:'Single asset, BTC only.' },
            { id:'VII', label:'RESEARCH LOOP',    c:'var(--greenB)',  gap:'ghost_daemon not built yet.' },
          ].map(b => (
            <div key={b.id} style={{ padding:'4px 7px', borderRadius:3, background:'var(--bg3)', border:`1px solid ${b.c}33`, marginBottom:2 }}>
              <div style={{ display:'flex', gap:5, alignItems:'baseline' }}>
                <span style={{ fontSize:8, color:b.c, fontWeight:700, minWidth:16 }}>{b.id}</span>
                <span style={{ fontSize:9, fontWeight:700, color:'var(--text)' }}>{b.label}</span>
              </div>
              <div style={{ fontSize:7, color:'var(--text3)', marginTop:1 }}>{b.gap}</div>
            </div>
          ))}
          <button onClick={() => onPageChange('medallion')} style={{
            marginTop:4, padding:'5px 0', fontSize:10, fontWeight:700, fontFamily:'var(--font-mono)',
            border:'1px solid var(--gold)', borderRadius:4,
            background:'rgba(255,204,58,0.08)', color:'var(--goldB)', cursor:'pointer',
          }}>✦ MEDALLION RUN LAB →</button>
        </div>}

      </div>
    </div>
  )
}
