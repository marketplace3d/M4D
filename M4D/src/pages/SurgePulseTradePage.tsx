import { useEffect, useState, useRef } from 'react'

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
}
const mono = "'SF Mono','JetBrains Mono','Courier New',monospace"

const FUTURES_SYMS = ['ES', 'NQ', 'GC', 'CL'] as const
type FuturesSym = typeof FUTURES_SYMS[number]

function usePoll<T>(url: string, ms = 30_000): T | null {
  const [d, setD] = useState<T | null>(null)
  useEffect(() => {
    let live = true
    setD(null)
    const run = () => fetch(url).then(r => r.json()).then(x => { if (live) setD(x) }).catch(() => {})
    run()
    const id = setInterval(run, ms)
    return () => { live = false; clearInterval(id) }
  }, [url, ms])
  return d
}

const Row = ({ label, val, color = C.text, border = true }: { label:string; val:string; color?:string; border?:boolean }) => (
  <div style={{ display:'flex', justifyContent:'space-between', padding:'3px 0', borderBottom: border ? `1px solid ${C.border}` : 'none' }}>
    <span style={{ fontSize:9, color:C.dim2, fontFamily:mono }}>{label}</span>
    <span style={{ fontSize:9, color, fontFamily:mono, fontWeight:600 }}>{val}</span>
  </div>
)

const Panel = ({ head, headColor = C.blue, children, right }: {
  head:string; headColor?:string; children:React.ReactNode; right?:React.ReactNode
}) => (
  <div style={{ background:C.bg1, border:`1px solid ${C.border}`, borderRadius:3, overflow:'hidden', display:'flex', flexDirection:'column' }}>
    <div style={{ padding:'5px 10px', background:C.bg0, borderBottom:`1px solid ${C.dim}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
      <span style={{ fontSize:9, color:headColor, fontFamily:mono, fontWeight:700, letterSpacing:'0.14em' }}>{head}</span>
      {right}
    </div>
    <div style={{ padding:'8px 10px', flex:1 }}>{children}</div>
  </div>
)

const FireBtn = ({ label, color = C.blue, onClick, disabled = false }: { label:string; color?:string; onClick:()=>void; disabled?:boolean }) => {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width:'100%', padding:'9px 8px', fontSize:9, fontFamily:mono, fontWeight:700,
        letterSpacing:'0.12em', cursor: disabled ? 'not-allowed' : 'pointer',
        background: disabled ? C.bg3 : hov ? `${color}22` : `${color}11`,
        border: `1px solid ${disabled ? C.muted : color}`,
        color: disabled ? C.faint : color,
        borderRadius:2, transition:'all 0.12s',
        boxShadow: !disabled && hov ? `0 0 8px ${color}44` : 'none',
      }}
    >{label}</button>
  )
}

interface ScoreData {
  symbol: string; regime: string; soft_score: number; jedi_raw: number
  atr_rank: number; rvol_now: number; squeeze: boolean
  price: number; gates_pass: boolean; gates_killed: string[]
}
interface IbkrTrade {
  id: number; ts: string; symbol: string; side: string; qty: number;
  fill_price: number; mode: string; note: string
}
interface IbkrPos { symbol: string; side: string; qty: number; unrealized_pnl: number; avg_cost?: number }
interface IbkrAccount { equity: number; cash: number; unrealized_pnl?: number; currency?: string }
interface IbkrStatus {
  account?: IbkrAccount
  open_positions?: IbkrPos[]
  recent_trades?: IbkrTrade[]
  trade_count?: number
  error?: string
  connection?: { host:string; port:number }
}

export default function SurgePulseTradePage() {
  const [sym, setSym] = useState<FuturesSym>('ES')
  const scoreUrl = `${DS}/v1/ibkr/score/?symbol=${sym}`
  const score  = usePoll<ScoreData>(scoreUrl, 30_000)
  const ibkr   = usePoll<IbkrStatus>(`${DS}/v1/ibkr/status/`, 30_000)

  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<any>(null)
  const [mode, setMode] = useState<'PADAWAN'|'NORMAL'|'EUPHORIA'|'MAX'>('PADAWAN')

  const convScore = score && !('error' in score)
    ? Math.min(100, Math.round(
        45
        + (score.soft_score ?? 0) * 30
        + Math.abs(score.jedi_raw ?? 0) * 1.5
        - (score.squeeze ? 15 : 0)
        - (score.gates_pass ? 0 : 25)
      ))
    : null

  const livePrice  = score?.price    ?? null
  const liveSL     = livePrice ? Math.round(livePrice * 0.9964 * 10) / 10 : null  // −0.36% (≈2 ES pts)
  const liveTP1    = livePrice ? Math.round(livePrice * 1.0036 * 10) / 10 : null  // +0.36%
  const liveTP2    = livePrice ? Math.round(livePrice * 1.0072 * 10) / 10 : null  // +0.72%
  const dir        = score?.gates_pass && (score?.jedi_raw ?? 0) > 0 ? 'LONG' : (score?.jedi_raw ?? 0) < 0 ? 'SHORT' : null
  const regimeColor = (r: string) => r === 'TRENDING' ? C.green : r === 'BREAKOUT' ? C.gold : r === 'RISK-OFF' ? C.red : C.dim2

  const ibkrConnected = ibkr && !ibkr.error
  const positions = ibkr?.open_positions ?? []
  const trades    = ibkr?.recent_trades  ?? []

  const handleIbkrFire = async () => {
    setRunning(true)
    try {
      const r = await fetch(`${DS}/v1/ibkr/run/?mode=${mode}&asset=FUTURES`, { method:'POST' })
      const d = await r.json()
      setRunResult(d)
    } catch (e) { setRunResult({ ok:false, error:String(e) }) }
    setRunning(false)
  }

  const handleDryRun = async () => {
    setRunning(true)
    try {
      const r = await fetch(`${DS}/v1/ibkr/run/?mode=${mode}&asset=FUTURES&dry=1`, { method:'POST' })
      const d = await r.json()
      setRunResult(d)
    } catch (e) { setRunResult({ ok:false, error:String(e) }) }
    setRunning(false)
  }

  const handleFlatten = async (symbol: string) => {
    await fetch(`${DS}/v1/ibkr/flatten/?symbol=${symbol}&asset=FUTURES`, { method:'POST' }).catch(() => {})
  }

  return (
    <div style={{ background:C.bg0, minHeight:'100%', padding:10, fontFamily:mono, color:C.text, display:'flex', flexDirection:'column', gap:8 }}>

      {/* ── Header ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 10px', background:C.bg1, border:`1px solid ${C.border}`, borderRadius:3 }}>
        <div>
          <span style={{ fontSize:11, fontWeight:700, color:C.gold, letterSpacing:'0.16em' }}>③ TRADE</span>
          <span style={{ fontSize:9, color:C.dim2, marginLeft:12 }}>FUTURES · IBKR/TWS · ES/NQ/GC/CL · FIRE CONTROLS · TRADE LOG</span>
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          {/* Symbol selector */}
          <div style={{ display:'flex', gap:2 }}>
            {FUTURES_SYMS.map(s => (
              <button key={s} onClick={() => { setSym(s); setRunResult(null) }} style={{
                padding:'2px 7px', fontSize:8, fontFamily:mono, fontWeight:700,
                background: sym === s ? C.blueDD : C.bg3,
                border:`1px solid ${sym === s ? C.blue : C.dim}`,
                color: sym === s ? C.blue : C.faint,
                borderRadius:2, cursor:'pointer',
              }}>{s}</button>
            ))}
          </div>
          {convScore !== null && (
            <span style={{
              padding:'2px 7px', borderRadius:2, fontSize:9, fontFamily:mono, fontWeight:700,
              background: convScore >= 80 ? C.greenDD : convScore >= 60 ? C.goldDD : C.redDD,
              border:`1px solid ${convScore >= 80 ? C.green : convScore >= 60 ? C.gold : C.red}`,
              color: convScore >= 80 ? C.green : convScore >= 60 ? C.gold : C.red,
            }}>ARB {convScore}/100</span>
          )}
          <span style={{ fontSize:9, color: score && !('ok' in score && !(score as any).ok) ? C.green : C.faint, fontFamily:mono }}>
            {score && !('ok' in score && !(score as any).ok) ? `● ${sym} LIVE` : `○ ${sym} —`}
          </span>
        </div>
      </div>

      {/* ── Row 1: Score + Trade vals + Fire ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>

        {/* Live futures score */}
        <Panel head={`${sym} FUTURES SIGNAL`} headColor={score && !('ok' in score && !(score as any).ok) ? regimeColor((score as ScoreData).regime) : C.faint}>
          {score && !('ok' in score && !(score as any).ok) ? (
            <>
              <Row label="REGIME"     val={(score as ScoreData).regime}                                  color={regimeColor((score as ScoreData).regime)} />
              <Row label="JEDI"       val={(score as ScoreData).jedi_raw.toFixed(2)}                     color={Math.abs((score as ScoreData).jedi_raw) > 4 ? C.green : C.dim2} />
              <Row label="SOFT SCORE" val={(score as ScoreData).soft_score.toFixed(4)}                   color={C.blue} />
              <Row label="ATR RANK"   val={`${((score as ScoreData).atr_rank * 100).toFixed(0)}pct`}     color={(score as ScoreData).atr_rank > 0.30 ? C.text : C.red} />
              <Row label="RVOL"       val={`${(score as ScoreData).rvol_now.toFixed(2)}×`}               color={(score as ScoreData).rvol_now > 1.5 ? C.gold : C.dim2} />
              <Row label="SQUEEZE"    val={(score as ScoreData).squeeze ? 'LOCKED' : 'CLEAR'}            color={(score as ScoreData).squeeze ? C.red : C.green} />
              <Row label="GATES"      val={(score as ScoreData).gates_pass ? 'PASS ✓' : `KILL: ${(score as ScoreData).gates_killed.join(', ')}`} color={(score as ScoreData).gates_pass ? C.green : C.red} border={false} />
            </>
          ) : (
            <div style={{ fontSize:9, color:C.faint }}>
              {(score as any)?.error ?? `Loading… /v1/ibkr/score/?symbol=${sym}`}
            </div>
          )}
        </Panel>

        {/* Trade vals */}
        <Panel head="TRADE VALS" headColor={C.gold}>
          {livePrice !== null ? (
            <>
              <div style={{ textAlign:'center', padding:'8px 0', marginBottom:8, background: dir === 'LONG' ? C.greenDD : dir === 'SHORT' ? C.redDD : C.bg3, border:`1px solid ${dir === 'LONG' ? C.green : dir === 'SHORT' ? C.red : C.dim}`, borderRadius:2 }}>
                <span style={{ fontSize:16, fontWeight:700, color: dir === 'LONG' ? C.green : dir === 'SHORT' ? C.red : C.faint }}>
                  {dir ?? '— WAIT —'}
                </span>
              </div>
              <Row label="ENTRY"       val={livePrice.toLocaleString()}    color={C.gold} />
              <Row label="SL −0.36%"   val={liveSL?.toLocaleString() ?? '—'}    color={C.red} />
              <Row label="TP1 +0.36%"  val={liveTP1?.toLocaleString() ?? '—'}   color={C.green} />
              <Row label="TP2 +0.72%"  val={liveTP2?.toLocaleString() ?? '—'}   color={C.green} />
              <Row label="REGIME"      val={(score as ScoreData)?.regime ?? '—'} color={regimeColor((score as ScoreData)?.regime ?? '')} border={false} />
            </>
          ) : (
            <div style={{ fontSize:9, color:C.faint }}>Fetching {sym} price…</div>
          )}
        </Panel>

        {/* Fire panel */}
        <Panel head="FIRE / LAUNCH" headColor={C.red}
          right={<span style={{ fontSize:8, color: runResult?.ok ? C.green : C.dim2, fontFamily:mono }}>{runResult ? (runResult.ok ? '✓ EXECUTED' : '✗ ERR') : 'ARMED'}</span>}>

          <div style={{ display:'flex', gap:3, marginBottom:10 }}>
            {(['PADAWAN','NORMAL','EUPHORIA','MAX'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                flex:1, padding:'5px 2px', fontSize:8, fontFamily:mono, fontWeight:700,
                background: mode === m ? (m === 'MAX' ? `${C.red}22` : m === 'EUPHORIA' ? C.goldDD : C.blueDD) : C.bg3,
                border:`1px solid ${mode === m ? (m === 'MAX' ? C.red : m === 'EUPHORIA' ? C.gold : C.blue) : C.dim}`,
                color: mode === m ? (m === 'MAX' ? C.red : m === 'EUPHORIA' ? C.gold : C.blue) : C.faint,
                borderRadius:2, cursor:'pointer',
              }}>{m === 'PADAWAN' ? '¼K' : m === 'NORMAL' ? '½K' : m === 'EUPHORIA' ? '★FAT' : '⚡MAX'}</button>
            ))}
          </div>

          {runResult && (
            <div style={{
              padding:'5px 8px', marginBottom:8,
              background: runResult.ok ? C.greenDD : C.redDD,
              border:`1px solid ${runResult.ok ? C.greenD : C.redD}`,
              borderRadius:2, fontSize:8, color: runResult.ok ? C.green : C.red,
            }}>
              {runResult.ok
                ? `✓ ${runResult.regime ?? mode} · ${(runResult.entries ?? []).length} entered`
                : `✗ ${runResult.error ?? 'unknown error'}`}
            </div>
          )}

          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            <FireBtn
              label={`⚡ IBKR/TWS — ${mode} — FUTURES`}
              color={ibkrConnected ? (score && (score as ScoreData).gates_pass ? C.green : C.gold) : C.faint}
              onClick={handleIbkrFire}
              disabled={running}
            />
            <FireBtn
              label="DRY RUN (no orders placed)"
              color={C.blue}
              onClick={handleDryRun}
              disabled={running}
            />
          </div>

          {/* IBKR connection status */}
          <div style={{ marginTop:8, padding:'5px 8px', background:C.bg3, border:`1px solid ${C.border}`, borderRadius:2 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:8, color:C.faint, fontFamily:mono }}>TWS</span>
              <span style={{ fontSize:8, fontFamily:mono, fontWeight:700, color: ibkrConnected ? C.green : C.red }}>
                {ibkrConnected ? `● ${ibkr?.connection?.host}:${ibkr?.connection?.port}` : '○ NOT CONNECTED'}
              </span>
            </div>
            {ibkrConnected && ibkr?.account && (
              <div style={{ display:'flex', gap:12, marginTop:4 }}>
                <div>
                  <div style={{ fontSize:7, color:C.faint }}>EQUITY</div>
                  <div style={{ fontSize:10, fontWeight:700, color:C.blue }}>${ibkr.account.equity.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                </div>
                {(ibkr.account.unrealized_pnl ?? 0) !== 0 && (
                  <div>
                    <div style={{ fontSize:7, color:C.faint }}>UPL</div>
                    <div style={{ fontSize:10, fontWeight:700, color:(ibkr.account.unrealized_pnl ?? 0) >= 0 ? C.green : C.red }}>
                      {(ibkr.account.unrealized_pnl ?? 0) >= 0 ? '+' : ''}${Number(ibkr.account.unrealized_pnl ?? 0).toFixed(0)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ marginTop:6 }}>
            <FireBtn
              label="⛔ FLATTEN ALL (IBKR futures)"
              color={C.red}
              onClick={async () => {
                for (const p of positions) await handleFlatten(p.symbol)
              }}
            />
          </div>
        </Panel>
      </div>

      {/* ── Row 2: Positions + Trade log ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:8 }}>

        {/* Open positions */}
        <Panel head="IBKR OPEN POSITIONS" headColor={C.purple}
          right={<span style={{ fontSize:8, color:C.purple, fontFamily:mono }}>{positions.length} open</span>}>
          {positions.length > 0 ? positions.map((p, i) => (
            <div key={i} style={{
              display:'flex', alignItems:'center', gap:6, padding:'5px 0',
              borderBottom: i < positions.length - 1 ? `1px solid ${C.border}` : 'none',
            }}>
              <span style={{ fontSize:10, fontWeight:700, color:C.blue, width:55 }}>{p.symbol}</span>
              <span style={{ fontSize:9, color:C.dim2 }}>{p.side} ×{p.qty}</span>
              <span style={{ fontSize:10, fontWeight:700, marginLeft:'auto', color:(p.unrealized_pnl ?? 0) >= 0 ? C.green : C.red }}>
                {(p.unrealized_pnl ?? 0) >= 0 ? '+' : ''}${Number(p.unrealized_pnl ?? 0).toFixed(0)}
              </span>
              <button
                onClick={() => handleFlatten(p.symbol)}
                style={{ fontSize:8, padding:'2px 5px', background:C.redDD, border:`1px solid ${C.redD}`, color:C.red, borderRadius:2, cursor:'pointer', fontFamily:mono }}
              >FLAT</button>
            </div>
          )) : (
            <div style={{ fontSize:9, color:C.faint }}>
              {ibkr?.error ? `TWS offline — ${ibkr.error.slice(0,60)}` : 'No open positions'}
            </div>
          )}
        </Panel>

        {/* Trade log */}
        <Panel head="IBKR SESSION TRADE LOG" headColor={C.blue}
          right={<span style={{ fontSize:8, color:C.faint, fontFamily:mono }}>{ibkr?.trade_count ?? 0} total</span>}>
          {trades.length > 0 ? (
            <>
              <div style={{
                display:'grid', gridTemplateColumns:'55px 55px 45px 90px 65px 1fr',
                gap:4, padding:'3px 0', borderBottom:`1px solid ${C.dim}`,
                fontSize:8, color:C.faint, letterSpacing:'0.08em',
              }}>
                {['TIME','SYM','SIDE','PRICE','MODE','NOTE'].map(h => <span key={h}>{h}</span>)}
              </div>
              {trades.slice(0, 14).map((t, i) => {
                const d = new Date(t.ts)
                const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
                const isBuy = (t.side || '').toLowerCase().includes('buy') || (t.side || '').toLowerCase() === 'long'
                return (
                  <div key={i} style={{
                    display:'grid', gridTemplateColumns:'55px 55px 45px 90px 65px 1fr',
                    gap:4, padding:'3px 0', borderBottom:`1px solid ${C.border}`,
                    fontSize:9, alignItems:'center',
                  }}>
                    <span style={{ color:C.faint }}>{time}</span>
                    <span style={{ color:C.blue, fontWeight:700 }}>{t.symbol}</span>
                    <span style={{ color: isBuy ? C.green : C.red, fontWeight:700 }}>{isBuy ? 'L' : 'S'} ×{t.qty}</span>
                    <span style={{ color:C.text }}>{Number(t.fill_price ?? 0).toLocaleString()}</span>
                    <span style={{ color:C.gold, fontSize:8 }}>{t.mode ?? 'PADAWAN'}</span>
                    <span style={{ color:C.faint, fontSize:8, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.note ?? ''}</span>
                  </div>
                )
              })}
              <div style={{ display:'flex', gap:16, padding:'6px 0', borderTop:`1px solid ${C.dim}`, marginTop:4 }}>
                {[
                  ['TRADES', String(ibkr?.trade_count ?? 0), C.text],
                  ['OPEN', String(positions.length), C.gold],
                ].map(([l, v, col]) => (
                  <div key={l} style={{ display:'flex', flexDirection:'column', gap:1 }}>
                    <span style={{ fontSize:7, color:C.faint, letterSpacing:'0.1em' }}>{l}</span>
                    <span style={{ fontSize:11, fontWeight:700, color:col }}>{v}</span>
                  </div>
                ))}
                {ibkr?.account && (
                  <div style={{ marginLeft:'auto', display:'flex', gap:16 }}>
                    <div style={{ display:'flex', flexDirection:'column' }}>
                      <span style={{ fontSize:7, color:C.faint }}>EQUITY</span>
                      <span style={{ fontSize:11, fontWeight:700, color:C.blue }}>${ibkr.account.equity.toLocaleString(undefined,{maximumFractionDigits:0})}</span>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ fontSize:9, color:C.faint }}>
              {ibkr?.error ? 'TWS not connected — start TWS then reload' : 'No trades yet · run a cycle'}
            </div>
          )}
        </Panel>
      </div>

    </div>
  )
}
