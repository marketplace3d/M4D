import { useEffect, useState, useRef } from 'react'

const DS = 'http://127.0.0.1:8000'

// ── palette (vibrant dark-blue fintech) ───────────────────────────────────────
const C = {
  bg0:    '#020408', bg1:  '#04080f', bg2:  '#060c16', bg3:  '#0a1220',
  border: '#0d1e35', dim:  '#16304a', muted:'#1e4060',
  text:   '#c8d8f0', dim2: '#7a9ab8', faint:'#3a5870',
  blue:   '#3a8fff', blueD:'#1a5fcc', blueDD:'#061428',
  green:  '#1dff7a', greenD:'#0faa50', greenDD:'#041208',
  gold:   '#ffcc3a', goldD: '#c8940a', goldDD:'#1a1000',
  red:    '#ff4a5a', redD:  '#aa1a28', redDD: '#120008',
  purple: '#b07aff', purpleD:'#6a3acc', purpleDD:'#0a0418',
  teal:   '#2ae8e8', tealD: '#0a8888',
}

const mono = "'SF Mono','JetBrains Mono','Courier New',monospace"

function usePoll<T>(url: string, ms = 30_000): T | null {
  const [d, setD] = useState<T | null>(null)
  const urlRef = useRef(url)
  useEffect(() => {
    let live = true
    const run = () => fetch(urlRef.current).then(r => r.json()).then(x => { if (live) setD(x) }).catch(() => {})
    run()
    const id = setInterval(run, ms)
    return () => { live = false; clearInterval(id) }
  }, [ms])
  return d
}

const Chip = ({ label, val, color = C.text, onClick }: { label: string; val: string; color?: string; onClick?: () => void }) => (
  <div
    onClick={onClick}
    style={{
      display:'flex', flexDirection:'column', gap:2,
      padding:'6px 10px', background: C.bg2, border:`1px solid ${C.border}`,
      borderRadius:3, cursor: onClick ? 'pointer' : 'default',
      minWidth:80,
    }}
  >
    <span style={{ fontSize:8, color:C.faint, fontFamily:mono, letterSpacing:'0.12em', textTransform:'uppercase' }}>{label}</span>
    <span style={{ fontSize:13, fontWeight:700, color, fontFamily:mono }}>{val}</span>
  </div>
)

const Row = ({ label, val, color = C.text, border = true }: { label:string; val:string; color?:string; border?:boolean }) => (
  <div style={{ display:'flex', justifyContent:'space-between', padding:'3px 0', borderBottom: border ? `1px solid ${C.border}` : 'none' }}>
    <span style={{ fontSize:9, color:C.dim2, fontFamily:mono }}>{label}</span>
    <span style={{ fontSize:9, color, fontFamily:mono, fontWeight:600 }}>{val}</span>
  </div>
)

const Pill = ({ on, label, color = C.blue }: { on:boolean; label:string; color?:string }) => (
  <span style={{
    padding:'2px 6px', borderRadius:2, fontSize:8, fontFamily:mono, fontWeight:700,
    background: on ? `${color}22` : C.bg3,
    border: `1px solid ${on ? color : C.dim}`,
    color: on ? color : C.faint,
  }}>{label}</span>
)

const Panel = ({ head, headColor = C.blue, children, right }: {
  head: string; headColor?: string; children: React.ReactNode; right?: React.ReactNode
}) => (
  <div style={{ background:C.bg1, border:`1px solid ${C.border}`, borderRadius:3, overflow:'hidden', display:'flex', flexDirection:'column' }}>
    <div style={{ padding:'5px 10px', background:C.bg0, borderBottom:`1px solid ${C.dim}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
      <span style={{ fontSize:9, color:headColor, fontFamily:mono, fontWeight:700, letterSpacing:'0.14em' }}>{head}</span>
      {right}
    </div>
    <div style={{ padding:'8px 10px', flex:1 }}>{children}</div>
  </div>
)

const SHARPE_STACK = [
  { label:'Base (OOS)',            sharpe:5.35,  color:C.dim2 },
  { label:'+ Hour gates',          sharpe:7.92,  color:C.blue },
  { label:'+ ATR/RVOL gates',      sharpe:9.84,  color:C.blue },
  { label:'+ Soft routing',        sharpe:12.45, color:C.green },
  { label:'+ Regime routing',      sharpe:13.20, color:C.green },
  { label:'+ MTF confirm',         sharpe:14.60, color:C.teal },
  { label:'+ Cross-asset mult',    sharpe:15.86, color:C.teal },
  { label:'+ Delta Ops exits',     sharpe:17.89, color:C.gold },
  { label:'EUPHORIA (fat-pitch)',   sharpe:19.83, color:C.gold },
  { label:'Re-entry (OOS thin)',   sharpe:29.72, color:C.purple },
]

export default function PulsePage() {
  const council     = usePoll<any>(`${DS}/v1/ai/activity/`, 30_000)
  const caRpt       = usePoll<any>(`${DS}/v1/cross/report/`, 60_000)
  const paperStatus = usePoll<any>(`${DS}/v1/paper/status/`, 30_000)
  const gateRpt     = usePoll<any>(`${DS}/v1/gate/report/`, 60_000)
  const fngRpt      = usePoll<any>(`${DS}/v1/fng/`, 60_000)
  const sessionRpt  = usePoll<any>(`${DS}/v1/session/`, 30_000)
  const ibkrRpt     = usePoll<any>(`${DS}/v1/ibkr/status/`, 30_000)

  const [kellyFrac, setKellyFrac] = useState<0.25 | 0.5 | 1>(0.5)
  const [mode, setMode] = useState<'PADAWAN'|'NORMAL'|'EUPHORIA'>('PADAWAN')
  const [haltMsg, setHaltMsg] = useState('')

  const jedi   = council?.jedi_score ?? null
  const regime = council?.regime     ?? council?.label ?? null
  const ca     = caRpt?.ca_regime ?? null
  const equity = paperStatus?.account?.equity ?? null
  const upl    = paperStatus?.account?.unrealized_pl ?? null
  const fng    = fngRpt?.value ?? null

  const regimeColor = (r: string | null) =>
    r === 'TRENDING'  ? C.green  :
    r === 'BREAKOUT'  ? C.gold   :
    r === 'RISK-OFF'  ? C.red    : C.dim2

  const caColor = (c: string | null) =>
    c === 'RISK_ON'  ? C.green :
    c === 'RISK_OFF' ? C.red   : C.dim2

  const handleHalt = async () => {
    const r = await fetch(`${DS}/v1/control/halt-lock/`, { method:'POST' }).then(x => x.json()).catch(() => null)
    setHaltMsg(r?.ok ? 'HALT SET' : r?.error ?? 'ERR')
  }

  return (
    <div style={{ background:C.bg0, minHeight:'100%', padding:10, fontFamily:mono, color:C.text, display:'flex', flexDirection:'column', gap:8 }}>

      {/* ── Header ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 10px', background:C.bg1, border:`1px solid ${C.border}`, borderRadius:3 }}>
        <div>
          <span style={{ fontSize:11, fontWeight:700, color:C.blue, letterSpacing:'0.16em' }}>② PULSE</span>
          <span style={{ fontSize:9, color:C.dim2, marginLeft:12 }}>ALGO SYSCONTROLS · SAFETY · KELLY · GATES · IC DECAY</span>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <Pill on={!!council}     label={council     ? '● :8000' : '○ DS'} color={C.green} />
          <Pill on={!!paperStatus} label={paperStatus ? '● PAPER'  : '○ PAPER'} color={C.blue} />
          <Pill on={!!ibkrRpt?.connected} label={ibkrRpt?.connected ? '● IBKR' : '○ IBKR'} color={C.gold} />
        </div>
      </div>

      {/* ── Live intel strip ── */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        <Chip label="JEDI"   val={jedi !== null ? (jedi > 0 ? `+${jedi}` : String(jedi)) : '—'} color={jedi !== null && jedi > 0 ? C.green : C.red} />
        <Chip label="REGIME" val={regime ?? '—'} color={regimeColor(regime)} />
        <Chip label="CA"     val={ca ?? '—'}     color={caColor(ca)} />
        <Chip label="F&G"    val={fng !== null ? `${fng}` : '—'} color={fng !== null && fng > 60 ? C.red : fng !== null && fng < 30 ? C.green : C.dim2} />
        {equity !== null && (
          <Chip label="EQUITY" val={`$${equity.toLocaleString(undefined, { maximumFractionDigits:0 })}`} color={C.blue} />
        )}
        {upl !== null && (
          <Chip label="UPL" val={`${upl >= 0 ? '+' : ''}$${upl.toFixed(2)}`} color={upl >= 0 ? C.green : C.red} />
        )}
        {sessionRpt?.session_active === false && (
          <Chip label="SESSION" val="CLOSED" color={C.red} />
        )}
      </div>

      {/* ── Row 1: Sharpe waterfall + Kelly + Mode ── */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:8 }}>

        {/* Sharpe waterfall */}
        <Panel head="SHARPE STACK WATERFALL" headColor={C.green}
          right={<span style={{ fontSize:8, color:C.green, fontFamily:mono }}>STACKED Σ</span>}>
          {SHARPE_STACK.map((row, i) => {
            const max = 29.72
            return (
              <div key={i} style={{
                display:'flex', alignItems:'center', gap:8,
                borderBottom: i < SHARPE_STACK.length - 1 ? `1px solid ${C.border}` : 'none',
                padding:'4px 0',
                background: i === 9 ? `${C.purpleDD}` : i === 8 ? `${C.goldDD}` : 'transparent',
              }}>
                <div style={{ width:160, fontSize:8, color:row.color, lineHeight:1.3, flexShrink:0 }}>{row.label}</div>
                <div style={{ flex:1, height:4, background:C.border, borderRadius:2, overflow:'hidden' }}>
                  <div style={{ width:`${(row.sharpe / max) * 100}%`, height:'100%', background:row.color, borderRadius:2, transition:'width 0.4s' }} />
                </div>
                <div style={{ fontSize:i >= 8 ? 12 : 10, fontWeight:700, color:row.color, width:44, textAlign:'right', flexShrink:0 }}>
                  {row.sharpe.toFixed(2)}
                </div>
              </div>
            )
          })}
        </Panel>

        {/* Kelly */}
        <Panel head="KELLY SIZING" headColor={C.gold}>
          <div style={{ textAlign:'center', marginBottom:12 }}>
            <div style={{ fontSize:8, color:C.faint, marginBottom:2 }}>ACTIVE SIZE</div>
            <div style={{ fontSize:30, fontWeight:700, color:C.green, lineHeight:1 }}>
              {(kellyFrac === 0.25 ? 4.78 : kellyFrac === 0.5 ? 9.56 : 19.12).toFixed(2)}%
            </div>
            <div style={{ fontSize:8, color:C.dim2, marginTop:2 }}>
              ×{(ca === 'RISK_ON' ? 1.20 : ca === 'RISK_OFF' ? 0.70 : 1.0).toFixed(2)} CA adj
            </div>
          </div>
          <div style={{ display:'flex', gap:4, marginBottom:10 }}>
            {([['¼K', 0.25, '4.78%'], ['½K', 0.5, '9.56%'], ['1K', 1, '19.12%']] as const).map(([label, v, pct]) => (
              <button key={v} onClick={() => setKellyFrac(v as any)} style={{
                flex:1, padding:'6px 0', fontSize:9, fontFamily:mono,
                background: kellyFrac === v ? C.blueDD : C.bg3,
                border:`1px solid ${kellyFrac === v ? C.blue : C.dim}`,
                color: kellyFrac === v ? C.blue : C.faint,
                borderRadius:2, cursor:'pointer', fontWeight:700,
              }}>{label}<br /><span style={{ fontSize:7 }}>{pct}</span></button>
            ))}
          </div>
          <div style={{ fontSize:8, color:C.faint, marginBottom:4 }}>CA REGIME</div>
          <div style={{ padding:'6px 8px', background: ca === 'RISK_ON' ? C.greenDD : ca === 'RISK_OFF' ? C.redDD : C.bg3, border:`1px solid ${caColor(ca)}`, borderRadius:2, textAlign:'center' }}>
            <span style={{ fontSize:11, fontWeight:700, color:caColor(ca) }}>{ca ?? 'LOADING…'}</span>
          </div>
        </Panel>

        {/* Mode + Halt */}
        <Panel head="OPERATOR MODE" headColor={C.purple}>
          <div style={{ fontSize:8, color:C.faint, marginBottom:6 }}>TRADE MODE</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4, marginBottom:12 }}>
            {(['PADAWAN','NORMAL','EUPHORIA'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                padding:'7px 10px', fontSize:9, fontFamily:mono, fontWeight:700,
                background: mode === m ? (m === 'EUPHORIA' ? C.goldDD : C.blueDD) : C.bg3,
                border:`1px solid ${mode === m ? (m === 'EUPHORIA' ? C.gold : C.blue) : C.dim}`,
                color: mode === m ? (m === 'EUPHORIA' ? C.gold : m === 'NORMAL' ? C.green : C.blue) : C.faint,
                borderRadius:2, cursor:'pointer', textAlign:'left',
              }}>
                {m === 'PADAWAN' ? '▸ PADAWAN — ¼K · 3/day · CIS' :
                 m === 'NORMAL'  ? '▸ NORMAL — ½K · 5/day' :
                                   '★ EUPHORIA — 1K · fat pitch only'}
              </button>
            ))}
          </div>
          <button onClick={handleHalt} style={{
            width:'100%', padding:'8px', fontSize:9, fontFamily:mono, fontWeight:700,
            background:C.redDD, border:`1px solid ${C.red}`, color:C.red,
            borderRadius:2, cursor:'pointer',
          }}>
            ⛔ HALT LOCK
          </button>
          {haltMsg && <div style={{ fontSize:8, color:C.red, textAlign:'center', marginTop:4 }}>{haltMsg}</div>}
        </Panel>
      </div>

      {/* ── Row 2: Gate status + IBKR + Paper positions ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>

        {/* Gate report */}
        <Panel head="GATE STATUS" headColor={C.teal}>
          {gateRpt ? (
            Object.entries(gateRpt.best_gates ?? {}).slice(0, 8).map(([g, v]: [string, any]) => (
              <Row key={g} label={g} val={`+${Number(v).toFixed(3)} Sharpe`} color={C.teal} />
            ))
          ) : (
            <div style={{ fontSize:9, color:C.faint }}>Fetching gate report… ({DS}/v1/gate/report/)</div>
          )}
        </Panel>

        {/* IBKR status */}
        <Panel head="IBKR / TWS" headColor={C.gold}
          right={<Pill on={!!ibkrRpt?.connected} label={ibkrRpt?.connected ? 'CONNECTED' : 'OFFLINE'} color={C.gold} />}>
          {ibkrRpt ? (
            <>
              <Row label="ACCT" val={ibkrRpt.account ?? '—'} />
              <Row label="NET LIQ" val={ibkrRpt.net_liq ? `$${Number(ibkrRpt.net_liq).toLocaleString(undefined,{maximumFractionDigits:0})}` : '—'} color={C.blue} />
              <Row label="POSITIONS" val={String(ibkrRpt.positions?.length ?? 0)} />
              <Row label="CASH" val={ibkrRpt.cash ? `$${Number(ibkrRpt.cash).toLocaleString(undefined,{maximumFractionDigits:0})}` : '—'} color={C.dim2} border={false} />
              {(ibkrRpt.positions ?? []).slice(0, 4).map((p: any, i: number) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'3px 0', borderTop:`1px solid ${C.border}`, fontSize:9 }}>
                  <span style={{ color:C.blue, fontWeight:700 }}>{p.symbol}</span>
                  <span style={{ color:C.text }}>{p.qty}</span>
                  <span style={{ color:(p.unrealized_pl ?? 0) >= 0 ? C.green : C.red }}>
                    {(p.unrealized_pl ?? 0) >= 0 ? '+' : ''}${Number(p.unrealized_pl ?? 0).toFixed(2)}
                  </span>
                </div>
              ))}
            </>
          ) : (
            <div style={{ fontSize:9, color:C.faint }}>TWS not connected · Start via ibkr.sh</div>
          )}
        </Panel>

        {/* Paper positions */}
        <Panel head="ALPACA PAPER" headColor={C.blue}
          right={equity !== null ? <span style={{ fontSize:8, color:C.blue, fontFamily:mono }}>${equity.toLocaleString(undefined,{maximumFractionDigits:0})}</span> : undefined}>
          {paperStatus ? (
            <>
              <Row label="EQUITY"   val={`$${(paperStatus.account?.equity ?? 0).toLocaleString(undefined,{maximumFractionDigits:0})}`} color={C.blue} />
              <Row label="CASH"     val={`$${(paperStatus.account?.cash ?? 0).toLocaleString(undefined,{maximumFractionDigits:0})}`} />
              <Row label="UPL"      val={`${(paperStatus.account?.unrealized_pl ?? 0) >= 0 ? '+' : ''}$${(paperStatus.account?.unrealized_pl ?? 0).toFixed(2)}`} color={(paperStatus.account?.unrealized_pl ?? 0) >= 0 ? C.green : C.red} />
              <Row label="POSITIONS" val={String(paperStatus.positions?.length ?? 0)} border={false} />
              {(paperStatus.positions ?? []).slice(0, 3).map((p: any, i: number) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'3px 0', borderTop:`1px solid ${C.border}`, fontSize:9 }}>
                  <span style={{ color:C.blue, fontWeight:700 }}>{(p.symbol || '').replace(/USD$/,'')}</span>
                  <span style={{ color:C.dim2 }}>{p.side} {p.qty}</span>
                  <span style={{ color:(p.unrealized_pl ?? 0) >= 0 ? C.green : C.red }}>
                    {(p.unrealized_pl ?? 0) >= 0 ? '+' : ''}${Number(p.unrealized_pl ?? 0).toFixed(2)}
                  </span>
                </div>
              ))}
            </>
          ) : (
            <div style={{ fontSize:9, color:C.faint }}>Alpaca not connected · set ALPACA_KEY</div>
          )}
        </Panel>
      </div>

    </div>
  )
}
