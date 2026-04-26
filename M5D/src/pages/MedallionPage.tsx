import { useEffect, useRef, useState } from 'react'
import type { PageId } from '../types'

const DS = '/ds'

const C = {
  bg:      '#020408', bg1: '#04080f', bg2: '#060c16', bg3: '#0a1220',
  panel:   '#0d1830', border: '#0d2040', border2: '#162a4a',
  text:    '#c8d8f0', muted: '#6a8aae', faint: '#2a4a6e',
  gold:    '#ffcc3a', goldD: '#c8940a', goldDD: '#1a1000',
  green:   '#1dff7a', greenD: '#0faa50', greenDD: '#041208',
  blue:    '#3a8fff', blueD:  '#1a5fcc', blueDD:  '#061428',
  purple:  '#b07aff', purpleD:'#6a3acc', purpleDD:'#1a0a3a',
  teal:    '#2ae8e8', tealD:  '#0a8888', tealDD:  '#061818',
  red:     '#ff4a5a', redD:   '#aa1a28', redDD:   '#1a0508',
  amber:   '#ff8a3a', amberDD:'#1a0d00',
  coral:   '#ff6b6b', coralDD:'#1a0808',
  mono:    "'SF Mono','JetBrains Mono','Courier New',monospace",
}

const ARCH = [
  { id:'I',   label:'DATA UNIVERSE',      color:C.muted,  bg:C.bg2,      tag:'non-financial · alt data · ignored by markets',
    detail:'Pure mathematics, not finance. Mathematicians, cryptographers, speech recognition researchers. Satellite · shipping · weather · patents · language · human behavioural cycles. Edge lives in data financial people don\'t look at.',
    gap:'BTC price/vol only. No alternative data. Largest gap from RenTech doctrine.' },
  { id:'II',  label:'SIGNAL DISCOVERY',   color:C.purple, bg:C.purpleDD, tag:'exhaustive features · FDR-corrected · thousands of weak signals',
    detail:'Start here. The whole game. Systematic mining of thousands of weak, decorrelated signals. Multiple hypothesis testing with FDR correction. Minimum description length validation. Not "momentum + MA" — patterns nobody else looked for.',
    gap:'27 algos are heuristic rules, not discovered signals. IOPT is first step toward systematic discovery.' },
  { id:'III', label:'SIGNAL LIBRARY',     color:C.teal,   bg:C.tealDD,   tag:'lifecycle · decay tracking · capacity · regime tags',
    detail:'The library IS the fund. Each signal: IS-ICIR, OOS-ICIR, decay rate, capacity, regime tags. Promotion / demotion / retirement / revival managed continuously. Managing the library is the moat.',
    gap:'No signal library yet. signal_log.db is the seed — needs IC decomposition to identify independent signals.' },
  { id:'IV',  label:'DECAY ENGINE',       color:C.blue,   bg:C.blueDD,   tag:'CUSUM changepoint · rolling IR half-life · crowding detector',
    detail:'Non-stationarity is the permanent adversary. CUSUM changepoint, rolling IR half-life, automatic weight reduction as decay detected, crowding detection (signal being traded by too many funds = dies). Simons\' obsession.',
    gap:'No decay measurement. IOPT gives snapshots, not half-life trends.' },
  { id:'V',   label:'EXECUTION AS ALPHA', color:C.amber,  bg:C.amberDD,  tag:'market impact · adverse selection · intraday liquidity',
    detail:'At scale execution IS alpha. Almgren-Chriss impact model, optimal trade scheduling, dark pool intelligence, adverse selection detection, transaction cost feeds back into signal sizing.',
    gap:'Transaction cost not modeled. outcome_1h_pct is frictionless. Real Sharpe floor unknown.' },
  { id:'VI',  label:'CAPACITY-AWARE',     color:C.coral,  bg:C.coralDD,  tag:'per-signal capacity ceiling · no discretionary override',
    detail:'Medallion stayed small deliberately. Per-signal capacity estimation. No single signal > X% of expected PnL. No discretionary override. Ever. They returned capital because edge was finite-capacity.',
    gap:'No capacity model. Single BTC asset = no diversification discipline.' },
  { id:'VII', label:'RESEARCH MACHINE',   color:C.green,  bg:C.greenDD,  tag:'maths PhDs · shared ownership · PnL → signal validation',
    detail:'Signal discovery never stops. Research pipeline, researcher incentive alignment (everyone owns the fund), knowledge sharing, feedback: live PnL → signal validation. The loop never closes.',
    gap:'IOPT is first iteration. ghost_daemon.py (background search) is the perpetual loop — not built yet.' },
]

const DISCOVERY = [
  { id:'1', label:'FEATURE GENERATION',   color:C.muted,  bg:C.bg2,
    tag:'every operator × every series → O(10M) candidates',
    detail:'Returns N periods, rolling z-score, percentile rank, autocorrelation, Hurst, cross-sectional rank/demean, interaction terms (A×B), lags t-1→t-252, nonlinear (log, sqrt, tanh). Target: 10M candidate features.',
    out:'O(10M) candidate features', gap:'Not started. 27 fixed algos, not generated features.' },
  { id:'2', label:'DATA PARTITION',       color:C.purple, bg:C.purpleDD,
    tag:'60% discovery · 20% validation · 20% holdout — split ONCE',
    detail:'Split ONCE, irrevocably, before any research begins. 60% in-sample. 20% validation. 20% holdout NEVER TOUCHED. Physically enforced. Researchers cannot see holdout until final blessing.',
    out:'Holdout locked — no researcher sees it', gap:'signal_log.db uses 70/30 OOS split. Holdout not physically locked.' },
  { id:'3', label:'IC SCREENING',         color:C.blue,   bg:C.blueDD,
    tag:'IC, ICIR, t-stat for every feature — in-sample only',
    detail:'For each of 10M features: IC (rank correlation with forward returns), ICIR (IC/std(IC)), t-statistic. GPU-accelerated. In-sample only. Minimum ICIR threshold to pass.',
    out:'O(10M) → O(100K) candidates', gap:'Not started. No IC screening on individual signals.' },
  { id:'4', label:'FDR CORRECTION',       color:C.red,    bg:C.redDD,
    tag:'Bonferroni · Benjamini-Hochberg FDR · Storey q-value',
    detail:'⚠ WHERE MOST QUANT FUNDS FAIL. Testing 100K signals on same data → ~5K false positives at p=0.05 uncorrected. Benjamini-Hochberg FDR controls expected false discovery proportion. Failed signals → morgue (archived, not deleted — re-tested as new data arrives).',
    out:'Genuinely anomalous survivors', gap:'Not started. 27 algos run together with no FDR correction.' },
  { id:'5', label:'MDL + SNOOPING',       color:C.teal,   bg:C.tealDD,
    tag:'MDL · Hansen-Timmermann · White Reality Check · SPA',
    detail:'Minimum Description Length: accept signal only if it can\'t be explained by a simpler model. Hansen-Timmermann predictive ability test. White Reality Check (bootstrap data-snooping). SPA test (Superior Predictive Ability).',
    out:'Signals not explainable by known factors', gap:'Not started. No MDL or data-snooping tests.' },
  { id:'6', label:'DECORRELATION',        color:C.amber,  bg:C.amberDD,
    tag:'cluster by IC correlation · keep best ICIR per cluster',
    detail:'Cluster surviving signals by pairwise IC correlation. IC corr > 0.7 → grouped, keep highest ICIR per group. Hierarchical clustering. 50 correlated signals ≠ 50× edge — they consume 50× capacity.',
    out:'Independent signal set', gap:'Partial: IOPT kills low-Sharpe configs. No IC correlation clustering.' },
  { id:'7', label:'OOS + HALF-LIFE',      color:C.coral,  bg:C.coralDD,
    tag:'OOS ICIR ≥ 50% of IS · exponential decay fit',
    detail:'Out-of-sample validation on locked 20%: require OOS ICIR ≥ 50% IS ICIR. Fit exponential decay to rolling 252-day ICIR. Half-life < 60d = high-freq. 60-500d = daily. >500d = structural.',
    out:'half-life determines execution style', gap:'Yes: OOS 30% split + holdout. Half-life not measured yet.' },
]

const SHARPE_STACK = [
  { label:'BASELINE — equal weight',              s:1.36,  d:null,       c:C.muted  },
  { label:'+ Sharpe-weighted routing',            s:5.94,  d:'+4.58',    c:C.text   },
  { label:'+ Soft regime gate',                   s:6.61,  d:'+0.66',    c:C.blue   },
  { label:'+ HOUR_KILLS gate',                    s:9.18,  d:'+2.57',    c:C.teal   },
  { label:'+ SQZ + ATR + RVOL + JEDI',           s:15.86, d:'+6.68',    c:C.green  },
  { label:'DELTA OPS (PADAWAN + CIS)',            s:11.19, d:'mgmt',     c:C.purple },
  { label:'EUPHORIA — fat pitches',               s:19.83, d:'62.4% WR', c:C.gold   },
  { label:'★ RE-ENTRY after CIS exit',            s:29.72, d:'87t',      c:C.green  },
]

const GATES_INIT = [
  { id:'regime_routing', label:'REGIME_ROUTING',  d:'+0.84', on:true,  c:C.green  },
  { id:'hour_kills',     label:'HOUR_KILLS',       d:'+2.57', on:true,  c:C.teal   },
  { id:'day_filter',     label:'DAY_FILTER',       d:'+0.73', on:true,  c:C.green  },
  { id:'squeeze_lock',   label:'SQUEEZE_LOCK',     d:'+edge', on:true,  c:C.green  },
  { id:'atr_rank',       label:'ATR_RANK_GATE',    d:'+edge', on:true,  c:C.green  },
  { id:'rvol_exhaust',   label:'RVOL_EXHAUST',     d:'+edge', on:true,  c:C.green  },
  { id:'low_jedi',       label:'LOW_JEDI_GATE',    d:'+edge', on:true,  c:C.green  },
  { id:'rvol_gate',      label:'RVOL_GATE',        d:'±0.00', on:false, c:C.muted  },
  { id:'scalper_mode',   label:'SCALPER_MODE',     d:'1.90',  on:false, c:C.amber  },
  { id:'euphoria',       label:'EUPHORIA_ONLY',    d:'19.83', on:false, c:C.gold   },
]

function useRunProgress(mode: string, runTs: number | null) {
  const [result, setResult] = useState<Record<string,unknown>|null>(null)
  const [secs, setSecs] = useState(0)
  const t0 = useRef(0)
  useEffect(() => {
    if (!runTs) return
    t0.current = Date.now(); setResult(null); setSecs(0)
    const tick = setInterval(() => setSecs(Math.floor((Date.now()-t0.current)/1000)), 1000)
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`${DS}/v1/delta/report/`)
        if (r.ok) { const j = await r.json(); if (j.mode===mode) { setResult(j); clearInterval(poll); clearInterval(tick) } }
      } catch {}
    }, 5000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [runTs, mode])
  return { result, secs }
}

type DetailItem = typeof ARCH[0] & { out?: string }

interface Props {
  onPageChange: (p: PageId) => void
}

export default function MedallionPage({ onPageChange }: Props) {
  const [detail, setDetail]       = useState<DetailItem | null>(ARCH[1] as DetailItem)
  const [detailSrc, setDetailSrc] = useState<'arch'|'disc'>('arch')
  const [runMode, setRunMode]     = useState('EUPHORIA')
  const [runDays, setRunDays]     = useState(365)
  const [runTs, setRunTs]         = useState<number|null>(null)
  const [launching, setLaunching] = useState(false)
  const [launchMsg, setLaunchMsg] = useState<string|null>(null)
  const [gates, setGates]         = useState(GATES_INIT)
  const { result, secs }          = useRunProgress(runMode, runTs)
  const isRunning = runTs !== null && result === null

  const selectArch = (b: typeof ARCH[0]) => { setDetail(b as DetailItem); setDetailSrc('arch') }
  const selectDisc = (b: typeof DISCOVERY[0]) => { setDetail(b as DetailItem); setDetailSrc('disc') }

  const launch = async () => {
    setLaunching(true); setLaunchMsg(null)
    try {
      const r = await fetch(`${DS}/v1/delta/run/?mode=${runMode}&days=${runDays}`, { method:'POST' })
      const j = await r.json()
      if (j.ok) { setRunTs(Date.now()); setLaunchMsg(`▶ ${j.message}`) }
      else setLaunchMsg(`✗ ${j.error}`)
    } catch { setLaunchMsg('✗ DS not running') }
    setLaunching(false)
  }

  const colHead = (label: string, color: string) => (
    <div style={{ fontSize:9, color, fontFamily:C.mono, fontWeight:700, letterSpacing:'0.14em', padding:'6px 0 4px', borderBottom:`1px solid ${color}44`, marginBottom:6 }}>
      {label}
    </div>
  )

  const chip = (item: typeof ARCH[0]|typeof DISCOVERY[0], isSelected: boolean, onClick: ()=>void) => (
    <div key={item.id} onClick={onClick} style={{
      padding:'7px 10px', borderRadius:4, cursor:'pointer', marginBottom:4,
      background: isSelected ? `${item.color}20` : C.bg1,
      border:`1px solid ${isSelected ? item.color : C.border}`,
      boxShadow: isSelected ? `0 0 8px ${item.color}44` : 'none',
      transition:'all 0.12s',
    }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
        <span style={{ fontSize:9, color:item.color, fontWeight:700, minWidth:20, fontFamily:C.mono }}>{item.id}</span>
        <span style={{ fontSize:10, fontWeight:700, color: isSelected ? item.color : C.text, fontFamily:C.mono }}>{item.label}</span>
      </div>
      <div style={{ fontSize:8, color:C.faint, marginTop:2, lineHeight:1.4 }}>{item.tag}</div>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', background:C.bg, color:C.text, fontFamily:C.mono, minHeight:'100%' }}>

      {/* HEADER */}
      <div style={{
        padding:'7px 16px', borderBottom:`1px solid ${C.border}`,
        background:`linear-gradient(135deg,${C.goldDD} 0%,${C.bg1} 60%)`,
        display:'flex', alignItems:'center', gap:12, flexShrink:0, flexWrap:'wrap',
      }}>
        <span style={{ fontSize:15, color:C.gold }}>✦</span>
        <span style={{ fontSize:13, fontWeight:700, color:C.gold, letterSpacing:'0.18em' }}>MEDALLION</span>
        <span style={{ fontSize:8, color:C.goldD, letterSpacing:'0.1em' }}>SIGNAL CIVILISATION · NOT A TRADING SYSTEM</span>
        <div style={{ marginLeft:'auto', display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
          {(['EUPHORIA','MAX','NORMAL','PADAWAN'] as const).map(m=>(
            <button key={m} onClick={()=>setRunMode(m)} style={{
              padding:'2px 7px', fontSize:9, fontFamily:C.mono, fontWeight:700,
              border:`1px solid ${runMode===m?C.gold:C.border}`, borderRadius:3,
              background:runMode===m?C.goldDD:'transparent', color:runMode===m?C.gold:C.faint, cursor:'pointer',
            }}>{m}</button>
          ))}
          <div style={{width:1,height:16,background:C.border}}/>
          {([365,180,90] as const).map(d=>(
            <button key={d} onClick={()=>setRunDays(d)} style={{
              padding:'2px 6px', fontSize:9, fontFamily:C.mono,
              border:`1px solid ${runDays===d?C.goldD:C.border}`, borderRadius:3,
              background:runDays===d?`${C.goldDD}88`:'transparent', color:runDays===d?C.goldD:C.faint, cursor:'pointer',
            }}>{d}d</button>
          ))}
          <button onClick={()=>setRunDays(0)} style={{
            padding:'2px 6px', fontSize:9, fontFamily:C.mono,
            border:`1px solid ${runDays===0?C.goldD:C.border}`, borderRadius:3,
            background:runDays===0?`${C.goldDD}88`:'transparent', color:runDays===0?C.goldD:C.faint, cursor:'pointer',
          }}>ALL</button>
          <div style={{width:1,height:16,background:C.border}}/>
          <button onClick={launch} disabled={launching||isRunning} style={{
            padding:'4px 16px', fontSize:11, fontWeight:700, fontFamily:C.mono, letterSpacing:'0.14em',
            border:`1px solid ${C.gold}`, borderRadius:4,
            background:(launching||isRunning)?C.goldDD:`linear-gradient(135deg,${C.goldDD},#2a2000)`,
            color:(launching||isRunning)?C.goldD:C.gold,
            cursor:(launching||isRunning)?'not-allowed':'pointer',
            boxShadow:(launching||isRunning)?'none':`0 0 12px ${C.gold}55`,
            transition:'all 0.15s',
          }}>
            {launching?'◌ LAUNCHING…':isRunning?`◌ ${secs}s`:'✦ MEDALLION RUN'}
          </button>
          {launchMsg && <span style={{fontSize:9,color:launchMsg.startsWith('✗')?C.red:C.green,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{launchMsg}</span>}
        </div>
      </div>

      {/* progress stripe */}
      {isRunning && (
        <div style={{height:2,background:C.bg3,flexShrink:0}}>
          <div style={{height:2,background:C.gold,width:`${Math.min(95,(secs/120)*100)}%`,transition:'width 1s linear',boxShadow:`0 0 8px ${C.gold}`}}/>
        </div>
      )}

      {/* 4-COLUMN BODY */}
      <div className="medallion-grid" style={{ flex:1, gap:0 }}>

        {/* COL 1 — Architecture */}
        <div style={{ borderRight:`1px solid ${C.border}`, overflow:'auto', padding:'8px 8px' }}>
          {colHead('⬡ ARCHITECTURE', C.gold)}
          {ARCH.map((b) => chip(b, detailSrc==='arch' && detail?.id===b.id, ()=>selectArch(b)))}
          <div style={{marginTop:8,fontSize:8,color:C.faint,lineHeight:1.6}}>
            7 blocks. Signal civilisation, not a trading system. Start at II.
          </div>
        </div>

        {/* COL 2 — Discovery */}
        <div style={{ borderRight:`1px solid ${C.border}`, overflow:'auto', padding:'8px 8px' }}>
          {colHead('◈ SIGNAL DISCOVERY', C.purple)}
          {DISCOVERY.map((b) => chip(b, detailSrc==='disc' && detail?.id===b.id, ()=>selectDisc(b)))}
          <div style={{marginTop:8,fontSize:8,color:C.faint,lineHeight:1.6}}>
            7 stages. Stage 4 (FDR) is where most funds fail.
          </div>
        </div>

        {/* COL 3 — Detail + Sharpe */}
        <div style={{ borderRight:`1px solid ${C.border}`, overflow:'auto', padding:'12px 16px', display:'flex', flexDirection:'column', gap:12 }}>
          {detail ? (
            <>
              <div style={{ background:detail.bg, border:`1px solid ${detail.color}44`, borderRadius:5, padding:'12px 16px' }}>
                <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:8 }}>
                  <span style={{ fontSize:9, color:detail.color, fontWeight:700, letterSpacing:'0.12em' }}>
                    {detailSrc==='arch'?'BLOCK':'STAGE'} {detail.id}
                  </span>
                  <span style={{ fontSize:13, fontWeight:700, color:detail.color }}>{detail.label}</span>
                </div>
                <div style={{ fontSize:10, color:C.text, lineHeight:1.8, marginBottom:10 }}>{detail.detail}</div>
                {'out' in detail && detail.out && (
                  <div style={{ fontSize:9, color:detail.color, padding:'4px 8px', background:`${detail.color}18`, borderRadius:3, marginBottom:8 }}>→ {detail.out}</div>
                )}
                <div style={{ padding:'8px 10px', background:C.bg, borderRadius:4, fontSize:9, color:C.muted, lineHeight:1.7 }}>
                  <span style={{ color:C.gold, fontWeight:700 }}>WHERE WE ARE: </span>
                  {detail.gap}
                </div>
              </div>

              <div style={{ background:C.panel, border:`1px solid ${C.border}`, borderRadius:5, padding:'10px 14px' }}>
                {colHead('SHARPE BUILD STACK', C.gold)}
                {SHARPE_STACK.map((r,i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
                    <div style={{ flex:1, background:C.bg, borderRadius:2, height:20, overflow:'hidden', position:'relative' }}>
                      <div style={{ position:'absolute', left:0, top:0, bottom:0, background:`${r.c}28`, width:`${Math.min(100,(r.s/30)*100)}%`, borderRadius:2 }}/>
                      <div style={{ position:'absolute', left:6, top:0, bottom:0, display:'flex', alignItems:'center', fontSize:8, color:r.c, whiteSpace:'nowrap', overflow:'hidden' }}>{r.label}</div>
                    </div>
                    <span style={{ fontSize:10, fontWeight:700, color:r.c, minWidth:34, textAlign:'right' }}>{r.s.toFixed(2)}</span>
                    {r.d && <span style={{ fontSize:8, color:C.green, minWidth:46 }}>{r.d}</span>}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{fontSize:9,color:C.faint,padding:20}}>← click a block or stage</div>
          )}
        </div>

        {/* COL 4 — Gates + Run result */}
        <div style={{ overflow:'auto', padding:'8px 10px', display:'flex', flexDirection:'column', gap:10 }}>
          {colHead('⊕ GATE CONTROLS', C.amber)}
          {gates.map(g=>(
            <div key={g.id} onClick={()=>setGates(p=>p.map(x=>x.id===g.id?{...x,on:!x.on}:x))} style={{
              display:'flex', alignItems:'center', gap:7, padding:'5px 8px', borderRadius:3, cursor:'pointer',
              background:g.on?`${g.c}12`:'transparent', border:`1px solid ${g.on?g.c+'44':C.border}`,
              transition:'all 0.12s', marginBottom:3,
            }}>
              <div style={{ width:8, height:8, borderRadius:1, flexShrink:0, background:g.on?g.c:C.faint, boxShadow:g.on?`0 0 4px ${g.c}88`:'none' }}/>
              <span style={{ flex:1, fontSize:9, color:g.on?C.text:C.faint, fontWeight:g.on?600:400 }}>{g.label}</span>
              <span style={{ fontSize:9, fontWeight:700, color:g.on?g.c:C.faint, minWidth:38, textAlign:'right' }}>{g.d}</span>
            </div>
          ))}

          <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:8, marginTop:2 }}>
            {colHead('▶ LAST RESULT', result?C.green:C.faint)}
            {result ? (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'3px 6px' }}>
                {[
                  {l:'Mode',    v:String(result.mode??'–'),                                            c:C.gold  },
                  {l:'Sharpe',  v:result.sharpe!=null?Number(result.sharpe).toFixed(3):'–',            c:Number(result.sharpe??0)>5?C.green:C.red },
                  {l:'WinRate', v:result.win_rate!=null?`${(Number(result.win_rate)*100).toFixed(1)}%`:'–', c:Number(result.win_rate??0)>.5?C.green:C.amber },
                  {l:'Trades',  v:String(result.n_trades??'–'),                                        c:C.blue  },
                  {l:'ScaleIns',v:String(result.scale_in_events??'–'),                                 c:C.purple},
                  {l:'Harvest', v:String(result.harvested_lots??'–'),                                  c:C.gold  },
                  {l:'BEStops', v:String(result.breakeven_stops??'–'),                                 c:C.teal  },
                  {l:'Verdict', v:String((result.verdict??result.holdout_verdict)??'–'),               c:C.green },
                ].map(({l,v,c})=>(
                  <div key={l} style={{ display:'flex', flexDirection:'column', padding:'3px 0', borderBottom:`1px solid ${C.border}` }}>
                    <span style={{ fontSize:7, color:C.faint }}>{l}</span>
                    <span style={{ fontSize:10, fontWeight:700, color:c }}>{v}</span>
                  </div>
                ))}
              </div>
            ) : isRunning ? (
              <div style={{ fontSize:9, color:C.gold, lineHeight:1.8 }}>
                ◌ {runMode} · {runDays>0?`last ${runDays}d`:'all data'}<br/>
                {secs}s elapsed…
              </div>
            ) : (
              <div style={{ fontSize:8, color:C.faint, lineHeight:1.6 }}>Press ✦ MEDALLION RUN<br/>Results appear here live.</div>
            )}
          </div>

          <div style={{ marginTop:'auto', padding:'8px 8px', background:C.bg1, borderRadius:4, fontSize:8, color:C.faint, lineHeight:1.7, border:`1px solid ${C.border}` }}>
            <span style={{color:C.gold,fontWeight:700}}>DOCTRINE</span><br/>
            Signal civilisation, not rules.<br/>
            Non-stationarity = permanent adversary.<br/>
            Execution kills paper alpha at scale.<br/>
            System trades the system. No override.<br/>
            <button
              onClick={() => onPageChange('starray')}
              style={{ background:'none', border:'none', padding:0, cursor:'pointer', color:C.purple, fontSize:8, fontFamily:C.mono }}
            >→ STAR-RAY opts lab</button>
          </div>
        </div>
      </div>
    </div>
  )
}
