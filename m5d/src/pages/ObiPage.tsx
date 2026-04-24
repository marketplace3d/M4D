import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createChart, type IChartApi } from 'lightweight-charts'

// ── Bar type (standalone — no M4D imports) ──────────────────────────────────

interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }

// ── OBI math helpers ─────────────────────────────────────────────────────────

const T_COLORS = ['#ff6b00','#00d4ff','#a78bfa','#4ade80','#fbbf24','#f9a8d4']
const DIR_C: Record<string,'#4ade80'|'#f43f5e'|'#60a5fa'> = { BULL:'#4ade80', BEAR:'#f43f5e', NEUTRAL:'#60a5fa' }
const HEAT_C: Record<string,string> = { FIRE:'#ff6b00', GAS:'#00d4ff', CALM:'#60a5fa' }

interface ObiTarget { rank: number; label: string; price: number; dir: 'UP'|'DOWN'; confluence: number; probability: number; systems: string[]; heat: 'FIRE'|'GAS'|'CALM'; color: string }
type RawL = { price: number; system: string; dir: 'UP'|'DOWN'|'BOTH' }

function bATR(bars: Bar[], p = 14) {
  const n = bars.length; if (n < 2) return 0
  let sum = 0, cnt = 0
  for (let i = Math.max(1, n - p); i < n; i++) {
    const b = bars[i]!, pr = bars[i-1]!
    sum += Math.max(b.high - b.low, Math.abs(b.high - pr.close), Math.abs(b.low - pr.close)); cnt++
  }
  return cnt ? sum / cnt : 0
}
function bEMA(vals: number[], p: number) {
  if (!vals.length) return 0; const k = 2/(p+1); let e = vals[Math.max(0, vals.length-p)]!
  for (let i = Math.max(1, vals.length-p+1); i < vals.length; i++) e = vals[i]!*k + e*(1-k)
  return e
}
function bVWAP(bars: Bar[]) {
  let cpv = 0, cv = 0, cpv2 = 0
  for (const b of bars) { const tp = (b.high+b.low+b.close)/3; cpv += tp*b.volume; cv += b.volume; cpv2 += tp*tp*b.volume }
  const vw = cv ? cpv/cv : bars[bars.length-1]!.close, sd = cv ? Math.sqrt(Math.max(0, cpv2/cv - vw*vw)) : 0
  return { vw, u1:vw+sd, d1:vw-sd, u2:vw+2*sd, d2:vw-2*sd, u3:vw+3*sd, d3:vw-3*sd }
}
function bVolProfile(bars: Bar[], buckets = 50) {
  if (bars.length < 5) return { poc:0, vah:0, val:0 }
  const hi = Math.max(...bars.map(b => b.high)), lo = Math.min(...bars.map(b => b.low)), rng = hi-lo
  if (!rng) return { poc: bars[0]!.close, vah: bars[0]!.close, val: bars[0]!.close }
  const bsz = rng/buckets, vol = new Array<number>(buckets).fill(0)
  for (const b of bars) { const idx = Math.min(buckets-1, Math.floor(((b.high+b.low+b.close)/3 - lo)/bsz)); if (idx >= 0) vol[idx]! += b.volume }
  const total = vol.reduce((a,b) => a+b, 0), pocIdx = vol.indexOf(Math.max(...vol)), poc = lo+(pocIdx+0.5)*bsz
  let incV = vol[pocIdx]!, lo2 = pocIdx, hi2 = pocIdx
  while (incV < total*0.70 && (lo2 > 0 || hi2 < buckets-1)) {
    const up = hi2+1 < buckets ? vol[hi2+1]! : 0, dn = lo2-1 >= 0 ? vol[lo2-1]! : 0
    if (up >= dn && hi2+1 < buckets) { hi2++; incV += vol[hi2]! } else if (lo2-1 >= 0) { lo2--; incV += vol[lo2]! } else { hi2++; incV += vol[hi2]! }
  }
  return { poc, vah: lo+(hi2+1)*bsz, val: lo+lo2*bsz }
}
function bORB(bars: Bar[]) {
  if (bars.length < 10) return null
  const ib = bars.slice(0,6), ibH = Math.max(...ib.map(b => b.high)), ibL = Math.min(...ib.map(b => b.low)), sz = ibH-ibL
  const cur = bars[bars.length-1]!.close, dir: 'BULL'|'BEAR'|'NEUTRAL' = cur > ibH ? 'BULL' : cur < ibL ? 'BEAR' : 'NEUTRAL'
  return { ibH, ibL, dir, t1u:ibH+sz, t2u:ibH+sz*2, t1d:ibL-sz, t2d:ibL-sz*2 }
}
function bPivots(bars: Bar[]) {
  const prev = bars.slice(-48,-24); if (!prev.length) return null
  const H = Math.max(...prev.map(b => b.high)), L = Math.min(...prev.map(b => b.low)), Cl = prev[prev.length-1]!.close, P = (H+L+Cl)/3
  return { P, R1:2*P-L, R2:P+(H-L), R3:H+2*(P-L), S1:2*P-H, S2:P-(H-L), S3:L-2*(H-P) }
}
function bCam(bars: Bar[]) {
  const prev = bars.slice(-48,-24); if (!prev.length) return null
  const H = Math.max(...prev.map(b => b.high)), L = Math.min(...prev.map(b => b.low)), Cl = prev[prev.length-1]!.close, r = H-L
  return { H3:Cl+r*1.1/4, H4:Cl+r*1.1/2, L3:Cl-r*1.1/4, L4:Cl-r*1.1/2 }
}
function bICT(bars: Bar[]) {
  const prev = bars.slice(-48,-24)
  return { pdh: prev.length ? Math.max(...prev.map(b => b.high)) : 0, pdl: prev.length ? Math.min(...prev.map(b => b.low)) : 0 }
}
function bFib(bars: Bar[], dir: 'BULL'|'BEAR'|'NEUTRAL') {
  const sl = bars.slice(-50), swH = Math.max(...sl.map(b => b.high)), swL = Math.min(...sl.map(b => b.low)), rng = swH-swL
  if (dir==='BULL') return [1.0,1.272,1.618,2.0,2.618].map(r => ({ price:swL+rng*r, system:'FIB', dir:'UP' as const }))
  if (dir==='BEAR') return [1.0,1.272,1.618,2.0,2.618].map(r => ({ price:swH-rng*r, system:'FIB', dir:'DOWN' as const }))
  return []
}
function rankTargets(levels: RawL[], dir: 'BULL'|'BEAR'|'NEUTRAL', cur: number, atrVal: number): ObiTarget[] {
  if (!levels.length || dir==='NEUTRAL') return []
  const tol = atrVal*0.20, filtered = levels.filter(l => dir==='BULL' ? l.price>cur*1.001 : l.price<cur*0.999)
  const used = new Set<number>(), clusters: RawL[][] = []
  const sorted = [...filtered].sort((a,b) => Math.abs(a.price-cur)-Math.abs(b.price-cur))
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue
    const cl = [sorted[i]!]; used.add(i)
    for (let j = i+1; j < sorted.length; j++) if (!used.has(j) && Math.abs(sorted[j]!.price-sorted[i]!.price)<=tol) { cl.push(sorted[j]!); used.add(j) }
    clusters.push(cl)
  }
  return clusters.slice(0,6).map((cl,idx) => {
    const avg = cl.reduce((s,l) => s+l.price,0)/cl.length, systems = [...new Set(cl.map(l => l.system))], conf = systems.length
    const prob = Math.min(95, conf*11+Math.max(0,55-(Math.abs(avg-cur)/cur)*1500))
    return { rank:idx+1, label:`T${idx+1}`, price:avg, dir:(dir==='BULL'?'UP':'DOWN') as 'UP'|'DOWN', confluence:conf, probability:Math.round(prob), systems, heat:(conf>=4?'FIRE':conf>=2?'GAS':'CALM') as ObiTarget['heat'], color:T_COLORS[idx]??'#94a3b8' }
  }).sort((a,b) => b.confluence-a.confluence||a.rank-b.rank).map((t,i) => ({ ...t, rank:i+1, label:`T${i+1}` }))
}

function computeOBI(bars: Bar[]) {
  if (bars.length < 50) return null
  const cur = bars[bars.length-1]!.close, atrVal = bATR(bars)||cur*0.01, closes = bars.map(b => b.close)
  const e9 = bEMA(closes,9), e21 = bEMA(closes,21), vd = bVWAP(bars), orb = bORB(bars), vp = bVolProfile(bars)
  const bullV = [cur>vd.vw, e9>e21, cur>vp.poc, orb?.dir==='BULL'].filter(Boolean).length
  const bearV = [cur<vd.vw, e9<e21, cur<vp.poc, orb?.dir==='BEAR'].filter(Boolean).length
  const dir: 'BULL'|'BEAR'|'NEUTRAL' = bullV>bearV?'BULL':bearV>bullV?'BEAR':'NEUTRAL'
  const lv: RawL[] = []
  const add = (price: number, system: string, d: 'UP'|'DOWN'|'BOTH') => { if (isFinite(price)&&price>0) lv.push({ price, system, dir:d }) }
  add(vd.u1,'VWAP','UP'); add(vd.d1,'VWAP','DOWN'); add(vd.u2,'VWAP','UP'); add(vd.d2,'VWAP','DOWN'); add(vd.u3,'VWAP','UP'); add(vd.d3,'VWAP','DOWN')
  add(vp.poc,'VOL','BOTH'); add(vp.vah,'VOL','UP'); add(vp.val,'VOL','DOWN')
  if (orb) { add(orb.t1u,'ORB','UP'); add(orb.t2u,'ORB','UP'); add(orb.t1d,'ORB','DOWN'); add(orb.t2d,'ORB','DOWN') }
  bFib(bars,dir).forEach(l => add(l.price,l.system,l.dir))
  const piv = bPivots(bars)
  if (piv) { add(piv.P,'PIV','BOTH'); add(piv.R1,'PIV','UP'); add(piv.R2,'PIV','UP'); add(piv.R3,'PIV','UP'); add(piv.S1,'PIV','DOWN'); add(piv.S2,'PIV','DOWN'); add(piv.S3,'PIV','DOWN') }
  const cam = bCam(bars)
  if (cam) { add(cam.H3,'CAM','UP'); add(cam.H4,'CAM','UP'); add(cam.L3,'CAM','DOWN'); add(cam.L4,'CAM','DOWN') }
  const ict = bICT(bars); add(ict.pdh,'ICT','UP'); add(ict.pdl,'ICT','DOWN')
  const dv = dir==='BULL'?1:-1
  if (dir!=='NEUTRAL') [0.5,1,1.5,2,3].forEach(m => add(cur+dv*atrVal*m,'ATR',dir==='BULL'?'UP':'DOWN'))
  const targets = rankTargets(lv,dir,cur,atrVal), stop = dir==='BULL'?cur-atrVal*1.5:cur+atrVal*1.5
  const t1 = targets[0]?.price??cur, rr = parseFloat((Math.abs(t1-cur)/(atrVal*1.5)).toFixed(1))
  const preds = [
    { id:'ORB',  dir: orb?.dir??'NEUTRAL' },
    { id:'VWAP', dir: cur>vd.vw?'BULL':'BEAR' },
    { id:'VOL',  dir: cur>vp.poc?'BULL':'BEAR' },
    { id:'FIB',  dir },
    { id:'PIV',  dir: piv?(cur>piv.P?'BULL':'BEAR'):'NEUTRAL' },
    { id:'CAM',  dir: cam?(cur>(cam.H3+cam.L3)/2?'BULL':'BEAR'):'NEUTRAL' },
    { id:'ICT',  dir: ict.pdh?(cur>(ict.pdh+ict.pdl)/2?'BULL':'BEAR'):'NEUTRAL' },
    { id:'EMA',  dir: e9>e21?'BULL':'BEAR' },
  ] as { id: string; dir: 'BULL'|'BEAR'|'NEUTRAL' }[]
  return { dir, targets, stop, entry:cur, rr, atrVal, preds }
}

// ── OBI Panel ─────────────────────────────────────────────────────────────────

function ObiPanel({ bars }: { bars: Bar[] }) {
  const obi = useMemo(() => computeOBI(bars), [bars])
  if (!obi) return null
  const dc = DIR_C[obi.dir]??'#60a5fa'
  const fmt = (p: number) => p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits:1 }) : p < 10 ? p.toFixed(5) : p.toFixed(2)

  return (
    <div style={{ width:240, flexShrink:0, background:'rgba(8,11,18,0.97)', borderLeft:'1px solid rgba(167,139,250,0.15)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'8px 10px 6px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
          <span style={{ fontSize:10, fontWeight:800, color:'#a78bfa', fontFamily:'monospace', letterSpacing:2, textShadow:'0 0 10px #a78bfa' }}>◉ OBI</span>
          <span style={{ fontSize:8, color:'#334155', fontFamily:'monospace' }}>8-ENGINE</span>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ fontSize:11, fontWeight:800, color:dc, fontFamily:'monospace', textShadow:`0 0 8px ${dc}` }}>{obi.dir}</span>
          <span style={{ fontSize:9, color:'#475569', fontFamily:'monospace' }}>R:R 1:{obi.rr}</span>
          <span style={{ fontSize:9, color:'#f43f5e', fontFamily:'monospace', marginLeft:'auto' }}>⊗ {fmt(obi.stop)}</span>
        </div>
      </div>

      <div style={{ flex:1, overflow:'auto', minHeight:0 }}>
        {obi.targets.length === 0 && (
          <div style={{ padding:16, textAlign:'center', fontSize:9, color:'#1e293b', fontFamily:'monospace' }}>NEUTRAL — NO TARGETS</div>
        )}
        {obi.targets.map(t => {
          const hc = HEAT_C[t.heat]??'#60a5fa'
          return (
            <div key={t.rank} style={{ padding:'6px 10px', borderBottom:'1px solid rgba(255,255,255,0.04)', background:t.rank===1?'rgba(255,107,0,0.04)':'transparent' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3 }}>
                <div style={{ display:'flex', gap:5, alignItems:'center' }}>
                  <span style={{ fontSize:9, color:t.color, fontWeight:800, fontFamily:'monospace', textShadow:`0 0 6px ${t.color}` }}>{t.label}</span>
                  <span style={{ fontSize:7, padding:'1px 3px', borderRadius:2, background:`${hc}22`, color:hc, fontFamily:'monospace' }}>{t.heat}</span>
                  <span style={{ fontSize:8, color:t.dir==='UP'?'#4ade80':'#f43f5e' }}>{t.dir==='UP'?'↑':'↓'}</span>
                </div>
                <span style={{ fontSize:10, color:t.color, fontFamily:'monospace', fontWeight:700 }}>{fmt(t.price)}</span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                <div style={{ flex:1, height:2, background:'#1e293b', borderRadius:1 }}>
                  <div style={{ height:'100%', width:`${(t.confluence/8)*100}%`, background:t.color, borderRadius:1, boxShadow:`0 0 4px ${t.color}` }}/>
                </div>
                <span style={{ fontSize:7, color:'#475569', fontFamily:'monospace', minWidth:26 }}>{t.probability}%</span>
              </div>
              <div style={{ display:'flex', gap:2, flexWrap:'wrap', marginTop:3 }}>
                {t.systems.map(s => <span key={s} style={{ fontSize:7, padding:'1px 3px', borderRadius:2, background:'rgba(255,255,255,0.05)', color:'#475569', fontFamily:'monospace' }}>{s}</span>)}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ borderTop:'1px solid rgba(255,255,255,0.06)', flexShrink:0, padding:'4px 0' }}>
        <div style={{ padding:'2px 10px 3px', fontSize:7, color:'#1e293b', fontFamily:'monospace', letterSpacing:2 }}>PREDICTORS</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr' }}>
          {obi.preds.map(p => {
            const c = DIR_C[p.dir]??'#60a5fa'
            return (
              <div key={p.id} style={{ display:'flex', alignItems:'center', gap:4, padding:'2px 10px' }}>
                <span style={{ fontSize:9, color:c }}>{p.dir==='NEUTRAL'?'○':'●'}</span>
                <span style={{ fontSize:7, color:p.dir==='NEUTRAL'?'#1e293b':'#475569', fontFamily:'monospace', flex:1 }}>{p.id}</span>
                <span style={{ fontSize:7, color:c, fontFamily:'monospace' }}>{p.dir==='BULL'?'↑':p.dir==='BEAR'?'↓':'—'}</span>
              </div>
            )
          })}
        </div>
        <div style={{ height:4 }}/>
      </div>
    </div>
  )
}

// ── Lightweight chart wrapper ─────────────────────────────────────────────────

function ObiChart({ bars }: { bars: Bar[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!ref.current || !bars.length) return
    const chart = createChart(ref.current, {
      layout: { background: { color: '#080b12' }, textColor: '#475569' },
      grid: { vertLines: { color: '#0f172a' }, horzLines: { color: '#0f172a' } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#1e293b' },
      timeScale: { borderColor: '#1e293b', timeVisible: true },
    })
    chartRef.current = chart
    const series = chart.addCandlestickSeries({
      upColor: '#4ade80', downColor: '#f43f5e',
      borderUpColor: '#4ade80', borderDownColor: '#f43f5e',
      wickUpColor: '#4ade80', wickDownColor: '#f43f5e',
    })
    series.setData(bars.map(b => ({ time: b.time as import('lightweight-charts').UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })))
    chart.timeScale().fitContent()

    const obs = new ResizeObserver(() => {
      if (ref.current) chart.resize(ref.current.clientWidth, ref.current.clientHeight)
    })
    obs.observe(ref.current)
    return () => { obs.disconnect(); chart.remove(); chartRef.current = null }
  }, [bars])

  return <div ref={ref} style={{ width:'100%', height:'100%' }} />
}

// ── Binance fetch ─────────────────────────────────────────────────────────────

const SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','AVAXUSDT','LINKUSDT','AAVEUSDT','DOTUSDT']
const INTERVALS = ['5m','15m','1h','4h','1d'] as const
type Interval = typeof INTERVALS[number]

async function fetchBinanceBars(symbol: string, interval: Interval, limit = 300): Promise<Bar[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Binance ${r.status}`)
  const data = await r.json() as [number,string,string,string,string,string][]
  return data.map(k => ({
    time:   Math.floor(k[0] / 1000),
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }))
}

// ── OBI Page ──────────────────────────────────────────────────────────────────

export default function ObiPage() {
  const [bars, setBars]         = useState<Bar[]>([])
  const [sym, setSym]           = useState('BTCUSDT')
  const [tf, setTf]             = useState<Interval>('5m')
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState('')
  const [obiVisible, setObiVisible] = useState(true)

  const load = useCallback(async (s: string, iv: Interval) => {
    setLoading(true); setErr('')
    try { setBars(await fetchBinanceBars(s, iv)) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBars([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load(sym, tf) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = window.setInterval(() => void load(sym, tf), 30_000)
    return () => window.clearInterval(id)
  }, [sym, tf, load])

  const lastBar = bars.length ? bars[bars.length-1]! : null
  const prevBar = bars.length > 1 ? bars[bars.length-2]! : null
  const pct = lastBar && prevBar ? ((lastBar.close - prevBar.close)/prevBar.close*100) : null
  const fmt = (p: number) => p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits:2 }) : p.toFixed(4)

  const pill = (active: boolean, onClick: ()=>void, children: React.ReactNode) => (
    <button onClick={onClick} style={{
      padding:'2px 7px', fontSize:8, fontFamily:'monospace', fontWeight:700, cursor:'pointer', borderRadius:2,
      background: active ? 'rgba(58,143,255,0.18)' : 'transparent',
      border: `1px solid ${active ? '#3a8fff' : '#1e293b'}`,
      color: active ? '#3a8fff' : '#475569',
    }}>{children}</button>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'#080b12', color:'#c8d8f0', fontFamily:'monospace' }}>

      {/* Control strip */}
      <div style={{ padding:'6px 12px', borderBottom:'1px solid #1e293b', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', flexShrink:0, background:'#0a0f1a' }}>
        <span style={{ fontSize:11, fontWeight:800, color:'#a78bfa', letterSpacing:2, textShadow:'0 0 8px #a78bfa' }}>◉ OBI</span>
        <div style={{ width:1, height:16, background:'#1e293b' }}/>

        {/* Symbol selector */}
        <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
          {SYMBOLS.map(s => pill(sym===s, () => { setSym(s); void load(s, tf) }, s.replace('USDT','')))}
        </div>
        <div style={{ width:1, height:16, background:'#1e293b' }}/>

        {/* Timeframe */}
        <div style={{ display:'flex', gap:3 }}>
          {INTERVALS.map(iv => pill(tf===iv, () => { setTf(iv); void load(sym, iv) }, iv))}
        </div>
        <div style={{ width:1, height:16, background:'#1e293b' }}/>

        {/* OBI toggle */}
        {pill(obiVisible, () => setObiVisible(v => !v), 'OBI')}

        <div style={{ marginLeft:'auto', display:'flex', gap:10, alignItems:'center', fontSize:10 }}>
          {lastBar && (
            <>
              <span style={{ color:'#94a3b8', fontSize:9 }}>{sym}</span>
              <span style={{ color:'#c8d8f0', fontWeight:700 }}>{fmt(lastBar.close)}</span>
              {pct !== null && (
                <span style={{ color: pct >= 0 ? '#4ade80' : '#f43f5e', fontSize:9 }}>
                  {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                </span>
              )}
            </>
          )}
          {loading && <span style={{ fontSize:8, color:'#475569' }}>LOADING…</span>}
          {err && <span style={{ fontSize:8, color:'#f43f5e' }}>{err}</span>}
        </div>
      </div>

      {/* Chart stage */}
      <div style={{ flex:1, display:'flex', minHeight:0 }}>
        <div style={{ flex:1, minWidth:0, position:'relative' }}>
          {bars.length > 0 && <ObiChart bars={bars} />}
          {!loading && bars.length === 0 && !err && (
            <div style={{ padding:20, fontSize:9, color:'#334155' }}>Select a symbol above</div>
          )}
        </div>
        {obiVisible && bars.length > 0 && <ObiPanel bars={bars} />}
      </div>
    </div>
  )
}
