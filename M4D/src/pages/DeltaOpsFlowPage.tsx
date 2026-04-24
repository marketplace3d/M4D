/**
 * DeltaOpsFlowPage — live visual of the Delta Ops decision pipeline.
 * Shows param inputs → calculations → gates → mode selection → trade output.
 * Polls /v1/delta/report/ every 5s for live values.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState,
  type Node, type Edge, type Connection,
  Handle, Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

// ── colour tokens ────────────────────────────────────────────────────────────
const C = {
  bg:      '#0a0c10',
  panel:   '#0f1318',
  border:  '#1e2530',
  active:  '#22c55e',
  warn:    '#f59e0b',
  dead:    '#ef4444',
  blue:    '#38bdf8',
  purple:  '#a78bfa',
  gold:    '#f0c030',
  faint:   '#4a5568',
  text:    '#e2e8f0',
  dim:     '#8892a4',
}

// ── Node data types ──────────────────────────────────────────────────────────
type NodeData = {
  label: string
  sub?: string
  value?: string | number | null
  unit?: string
  color?: string
  pass?: boolean | null   // null = unknown/neutral
  tier?: 'input' | 'calc' | 'gate' | 'mode' | 'output'
}

// ── Custom node renderer ─────────────────────────────────────────────────────
function DeltaNode({ data }: { data: NodeData }) {
  const d = data as NodeData
  const borderColor =
    d.pass === true  ? C.active :
    d.pass === false ? C.dead   :
    d.color ?? C.border

  const tierColor =
    d.tier === 'input'  ? C.blue   :
    d.tier === 'calc'   ? C.purple :
    d.tier === 'gate'   ? C.warn   :
    d.tier === 'mode'   ? C.gold   :
    d.tier === 'output' ? C.active :
    C.faint

  return (
    <div style={{
      background:   C.panel,
      border:       `1px solid ${borderColor}`,
      borderRadius: 6,
      padding:      '8px 12px',
      minWidth:     120,
      maxWidth:     160,
      fontFamily:   'monospace',
      boxShadow:    d.pass === true ? `0 0 8px ${C.active}44` :
                    d.pass === false ? `0 0 8px ${C.dead}44` : 'none',
    }}>
      <Handle type="target" position={Position.Left}
        style={{ background: C.faint, border: 'none', width: 6, height: 6 }} />

      {/* tier badge */}
      <div style={{ fontSize: 8, color: tierColor, letterSpacing: 1, marginBottom: 2, textTransform: 'uppercase' }}>
        {d.tier ?? ''}
      </div>

      {/* label */}
      <div style={{ fontSize: 11, fontWeight: 600, color: d.color ?? C.text, lineHeight: 1.3 }}>
        {d.label}
      </div>

      {/* sub-label */}
      {d.sub && (
        <div style={{ fontSize: 9, color: C.dim, marginTop: 2 }}>{d.sub}</div>
      )}

      {/* live value */}
      {d.value !== undefined && d.value !== null && (
        <div style={{
          fontSize: 13, fontWeight: 700,
          color: d.pass === true ? C.active : d.pass === false ? C.dead : C.text,
          marginTop: 4,
        }}>
          {d.value}{d.unit ? <span style={{ fontSize: 9, color: C.dim }}> {d.unit}</span> : null}
        </div>
      )}

      <Handle type="source" position={Position.Right}
        style={{ background: C.faint, border: 'none', width: 6, height: 6 }} />
    </div>
  )
}

const nodeTypes = { delta: DeltaNode }

// ── Static layout — columns by pipeline stage ────────────────────────────────
// Col 0: raw inputs  (x=0)
// Col 1: computed    (x=220)
// Col 2: gates       (x=440)
// Col 3: mode select (x=660)
// Col 4: trade out   (x=880)

function buildNodes(report: Record<string, unknown>): Node<NodeData>[] {
  const cfg  = (report?.config  ?? {}) as Record<string, unknown>
  const mode = (report?.mode    ?? '?') as string
  const sh   = report?.sharpe   as number | null ?? null
  const wr   = report?.win_rate as number | null ?? null
  const nt   = report?.n_trades as number | null ?? null
  const si   = report?.scale_in_events  as number ?? 0
  const be   = report?.breakeven_stops  as number ?? 0
  const hl   = report?.harvested_lots   as number ?? 0

  const sharp_ok = sh !== null && sh > 5

  return [
    // ── COL 0: Inputs ─────────────────────────────────────────────────────
    { id:'i1', type:'delta', position:{x:0,   y:0},
      data:{ label:'soft_score', sub:'ensemble agreement', tier:'input', color:C.blue,
             value: cfg.entry_thr != null ? `≥ ${cfg.entry_thr}` : '–' }},
    { id:'i2', type:'delta', position:{x:0,   y:90},
      data:{ label:'jedi_raw', sub:'council net vote', tier:'input', color:C.blue,
             value: cfg.jedi_min != null ? `|j| ≥ ${cfg.jedi_min}` : '–' }},
    { id:'i3', type:'delta', position:{x:0,   y:180},
      data:{ label:'regime', sub:'7-state classifier', tier:'input', color:C.blue,
             value: '7-state' }},
    { id:'i4', type:'delta', position:{x:0,   y:270},
      data:{ label:'rvol', sub:'realised volatility', tier:'input', color:C.blue }},
    { id:'i5', type:'delta', position:{x:0,   y:360},
      data:{ label:'close', sub:'bar close price', tier:'input', color:C.blue }},
    { id:'i6', type:'delta', position:{x:0,   y:450},
      data:{ label:'atr_rank', sub:'ATR percentile', tier:'input', color:C.blue }},
    { id:'i7', type:'delta', position:{x:0,   y:540},
      data:{ label:'squeeze', sub:'BB inside KC', tier:'input', color:C.blue }},

    // ── COL 1: Computed ───────────────────────────────────────────────────
    { id:'c1', type:'delta', position:{x:220, y:0},
      data:{ label:'ENTRY THR', sub:`score ≥ entry_thr`, tier:'calc', color:C.purple,
             value: cfg.entry_thr as number ?? null }},
    { id:'c2', type:'delta', position:{x:220, y:100},
      data:{ label:'JEDI GATE', sub:`|jedi| ≥ jedi_min`, tier:'calc', color:C.purple,
             value: cfg.jedi_min as number ?? null }},
    { id:'c3', type:'delta', position:{x:220, y:200},
      data:{ label:'ACCEL', sub:`score+rvol ↑ ${cfg.accel_bars}bar`, tier:'calc', color:C.purple,
             value: cfg.accel_bars != null ? `${cfg.accel_bars} bar` : '–' }},
    { id:'c4', type:'delta', position:{x:220, y:300},
      data:{ label:'CIS SCORE', sub:'5-signal invalidation', tier:'calc', color:C.purple,
             value: `thresh ${cfg.cis_threshold ?? '?'}` }},
    { id:'c5', type:'delta', position:{x:220, y:400},
      data:{ label:'BE TRIGGER', sub:`${cfg.be_bars ?? 0} bars cont.`, tier:'calc', color:C.purple,
             value: cfg.be_bars != null ? `${cfg.be_bars} bars` : 'off' }},
    { id:'c6', type:'delta', position:{x:220, y:490},
      data:{ label:'HORIZON', sub:'max hold', tier:'calc', color:C.purple,
             value: cfg.horizon_bars != null ? `${cfg.horizon_bars}×5m` : '–' }},

    // ── COL 2: Gates ──────────────────────────────────────────────────────
    { id:'g1', type:'delta', position:{x:440, y:50},
      data:{ label:'ENTRY GATE', sub:'score + jedi both pass', tier:'gate',
             pass: (cfg.entry_thr != null && cfg.jedi_min != null) ? true : null }},
    { id:'g2', type:'delta', position:{x:440, y:170},
      data:{ label:'CIS EXIT', sub:'2/5 → full exit', tier:'gate',
             pass: true, color:C.warn }},
    { id:'g3', type:'delta', position:{x:440, y:290},
      data:{ label:'PYRAMID', sub:`accel → +${
        mode === 'MAX' || mode === 'EUPHORIA' ? 'exp' : '0.5'} lots`, tier:'gate',
             pass: si > 0, value: si > 0 ? `${si} fired` : 'none' }},
    { id:'g4', type:'delta', position:{x:440, y:400},
      data:{ label:'BE STOP', sub:'stop → entry price', tier:'gate',
             pass: be > 0, value: be > 0 ? `${be} exits` : 'armed' }},
    { id:'g5', type:'delta', position:{x:440, y:490},
      data:{ label:'HARVEST', sub:'1 lot locked on scale', tier:'gate',
             pass: hl > 0, value: hl > 0 ? `${hl} lots` : 'none' }},

    // ── COL 3: Mode ───────────────────────────────────────────────────────
    { id:'m1', type:'delta', position:{x:660, y:30},
      data:{ label:'PADAWAN', sub:'¼K · ≤1.5 lots', tier:'mode',
             pass: mode === 'PADAWAN', color: mode === 'PADAWAN' ? C.active : C.faint }},
    { id:'m2', type:'delta', position:{x:660, y:130},
      data:{ label:'NORMAL', sub:'1× · ≤3 lots', tier:'mode',
             pass: mode === 'NORMAL', color: mode === 'NORMAL' ? C.active : C.faint }},
    { id:'m3', type:'delta', position:{x:660, y:230},
      data:{ label:'EUPHORIA', sub:'2.5× · exp · 30m', tier:'mode', color:C.gold,
             pass: mode === 'EUPHORIA', value: mode === 'EUPHORIA' ? 'ACTIVE' : null }},
    { id:'m4', type:'delta', position:{x:660, y:350},
      data:{ label:'MAX', sub:'4× · exp · 30m · BE2', tier:'mode', color:C.dead,
             pass: mode === 'MAX', value: mode === 'MAX' ? 'ACTIVE' : null }},

    // ── COL 4: Output ─────────────────────────────────────────────────────
    { id:'o1', type:'delta', position:{x:880, y:60},
      data:{ label:'SHARPE', tier:'output', color: sharp_ok ? C.active : C.dead,
             value: sh !== null ? sh.toFixed(3) : '–', pass: sharp_ok }},
    { id:'o2', type:'delta', position:{x:880, y:160},
      data:{ label:'WIN RATE', tier:'output',
             value: wr !== null ? `${(wr*100).toFixed(1)}%` : '–',
             pass: wr !== null && wr > 0.5, color: wr !== null && wr > 0.5 ? C.active : C.dead }},
    { id:'o3', type:'delta', position:{x:880, y:260},
      data:{ label:'TRADES', tier:'output', color:C.blue,
             value: nt !== null ? nt : '–', pass: nt !== null && nt > 20 }},
    { id:'o4', type:'delta', position:{x:880, y:360},
      data:{ label:'SCALE-INS', tier:'output', color:C.purple,
             value: si, pass: si > 0 }},
    { id:'o5', type:'delta', position:{x:880, y:450},
      data:{ label:'HARVESTED', sub:'lots booked', tier:'output', color:C.gold,
             value: hl, pass: hl > 0 }},
  ]
}

const STATIC_EDGES: Edge[] = [
  // inputs → computed
  { id:'e-i1-c1', source:'i1', target:'c1', style:{stroke:C.blue,    strokeWidth:1.5}, animated:false },
  { id:'e-i2-c2', source:'i2', target:'c2', style:{stroke:C.blue,    strokeWidth:1.5} },
  { id:'e-i4-c3', source:'i4', target:'c3', style:{stroke:C.blue,    strokeWidth:1.5} },
  { id:'e-i3-c4', source:'i3', target:'c4', style:{stroke:C.blue,    strokeWidth:1.5} },
  { id:'e-i5-c5', source:'i5', target:'c5', style:{stroke:C.blue,    strokeWidth:1.5} },
  { id:'e-i6-c4', source:'i6', target:'c4', style:{stroke:C.faint,   strokeWidth:1, strokeDasharray:'4 2'} },
  { id:'e-i7-c4', source:'i7', target:'c4', style:{stroke:C.faint,   strokeWidth:1, strokeDasharray:'4 2'} },
  // computed → gates
  { id:'e-c1-g1', source:'c1', target:'g1', style:{stroke:C.purple,  strokeWidth:1.5} },
  { id:'e-c2-g1', source:'c2', target:'g1', style:{stroke:C.purple,  strokeWidth:1.5} },
  { id:'e-c4-g2', source:'c4', target:'g2', style:{stroke:C.warn,    strokeWidth:1.5} },
  { id:'e-c3-g3', source:'c3', target:'g3', style:{stroke:C.purple,  strokeWidth:1.5} },
  { id:'e-c5-g4', source:'c5', target:'g4', style:{stroke:C.purple,  strokeWidth:1.5} },
  { id:'e-c5-g5', source:'c5', target:'g5', style:{stroke:C.faint,   strokeWidth:1, strokeDasharray:'4 2'} },
  { id:'e-c6-g2', source:'c6', target:'g2', style:{stroke:C.faint,   strokeWidth:1, strokeDasharray:'4 2'} },
  // gates → mode
  { id:'e-g1-m1', source:'g1', target:'m1', style:{stroke:C.faint,   strokeWidth:1, strokeDasharray:'3 3'} },
  { id:'e-g1-m2', source:'g1', target:'m2', style:{stroke:C.faint,   strokeWidth:1, strokeDasharray:'3 3'} },
  { id:'e-g1-m3', source:'g1', target:'m3', style:{stroke:C.gold,    strokeWidth:2} },
  { id:'e-g1-m4', source:'g1', target:'m4', style:{stroke:C.dead,    strokeWidth:1.5} },
  { id:'e-g2-m3', source:'g2', target:'m3', style:{stroke:C.warn,    strokeWidth:1.5} },
  { id:'e-g3-m3', source:'g3', target:'m3', style:{stroke:C.purple,  strokeWidth:1.5} },
  { id:'e-g4-m4', source:'g4', target:'m4', style:{stroke:C.warn,    strokeWidth:1.5} },
  { id:'e-g5-m4', source:'g5', target:'m4', style:{stroke:C.gold,    strokeWidth:1.5} },
  // mode → output
  { id:'e-m3-o1', source:'m3', target:'o1', style:{stroke:C.active,  strokeWidth:2},   animated:true },
  { id:'e-m3-o2', source:'m3', target:'o2', style:{stroke:C.active,  strokeWidth:1.5}, animated:true },
  { id:'e-m3-o3', source:'m3', target:'o3', style:{stroke:C.blue,    strokeWidth:1.5} },
  { id:'e-m3-o4', source:'m3', target:'o4', style:{stroke:C.purple,  strokeWidth:1.5} },
  { id:'e-m4-o1', source:'m4', target:'o1', style:{stroke:C.dead,    strokeWidth:1.5, strokeDasharray:'5 2'} },
  { id:'e-m4-o5', source:'m4', target:'o5', style:{stroke:C.gold,    strokeWidth:1.5} },
]

// ── Mode param summary table ─────────────────────────────────────────────────
const MODE_ROWS = [
  { mode:'PADAWAN',  entry:0.05, jedi:4,  cis:2, accel:3, hor:48, be:0,  lots:1.5, sh:7.40,  hold:'4h'   },
  { mode:'NORMAL',   entry:0.12, jedi:4,  cis:2, accel:3, hor:48, be:0,  lots:3.0, sh:7.66,  hold:'4h'   },
  { mode:'EUPHORIA', entry:0.12, jedi:10, cis:2, accel:1, hor:6,  be:5,  lots:2.5, sh:21.73, hold:'30m'  },
  { mode:'MAX',      entry:0.35, jedi:8,  cis:1, accel:2, hor:6,  be:2,  lots:5.0, sh:17.80, hold:'30m'  },
]

const CIS_SIGNALS = [
  { name:'SQUEEZE_FIRED',  desc:'BB inside KC while in position'           },
  { name:'REGIME_FLIP',    desc:'Regime degraded from entry state'          },
  { name:'JEDI_REVERSAL',  desc:'Council conviction reversed'               },
  { name:'SCORE_DECAY',    desc:'soft_score < 40% of entry score'           },
  { name:'ATR_COLLAPSE',   desc:'ATR rank < 20th pct — market frozen'       },
]

const IOPT_INSIGHT = [
  'jedi_min=10 was THE fix — not entry_thr',
  'score ≥ 0.22 + jedi=8 = exhaustion signal',
  'score ≥ 0.12 + jedi=10 = quality continuation',
  'accel_bars=1 fires fast enough for 30m horizon',
  'cis=2 gives fat pitches room — cis=1 cuts winners',
  'MAX: entry_thr does quality filtering, not jedi',
]

// ── Component ────────────────────────────────────────────────────────────────
export default function DeltaOpsFlowPage() {
  const [report, setReport] = useState<Record<string, unknown>>({})
  const [activeMode, setActiveMode] = useState<string>('EUPHORIA')
  const [lastPoll, setLastPoll] = useState<string>('–')
  const [tab, setTab] = useState<'flow' | 'params' | 'cis' | 'iopt' | 'gates'>('flow')
  const [medallionRunning, setMedallionRunning] = useState(false)
  const [medallionMsg, setMedallionMsg] = useState<string | null>(null)
  const [gates, setGates] = useState([
    { id:'regime_routing', label:'REGIME_ROUTING',    delta:'+0.84', on:true,  color:'#22c55e' },
    { id:'hour_kills',     label:'HOUR_KILLS',         delta:'+2.57', on:true,  color:'#2ae8e8' },
    { id:'day_filter',     label:'DAY_FILTER',         delta:'+0.73', on:true,  color:'#22c55e' },
    { id:'squeeze_lock',   label:'SQUEEZE_LOCK',       delta:'+edge', on:true,  color:'#22c55e' },
    { id:'atr_rank',       label:'ATR_RANK_GATE',      delta:'+edge', on:true,  color:'#22c55e' },
    { id:'rvol_exhaust',   label:'RVOL_EXHAUST',       delta:'+edge', on:true,  color:'#22c55e' },
    { id:'low_jedi',       label:'LOW_JEDI_GATE',      delta:'+edge', on:true,  color:'#22c55e' },
    { id:'rvol_gate',      label:'RVOL_GATE',          delta:'±0.00', on:false, color:'#8892a4' },
    { id:'scalper_mode',   label:'SCALPER_MODE',       delta:'1.90',  on:false, color:'#f59e0b' },
    { id:'euphoria',       label:'EUPHORIA_ONLY',      delta:'19.83', on:false, color:'#f0c030' },
  ])

  // poll delta report
  useEffect(() => {
    const fetch_ = async () => {
      try {
        const r = await fetch('http://127.0.0.1:8000/v1/delta/report/')
        if (r.ok) {
          const j = await r.json()
          setReport(j)
          if (j.mode) setActiveMode(j.mode)
          setLastPoll(new Date().toLocaleTimeString())
        }
      } catch { /* DS not running */ }
    }
    fetch_()
    const t = setInterval(fetch_, 5000)
    return () => clearInterval(t)
  }, [])

  const initNodes = buildNodes(report)
  const [nodes, , onNodesChange] = useNodesState(initNodes)
  const [edges, , onEdgesChange] = useEdgesState(STATIC_EDGES)

  // rebuild nodes when report changes
  const liveNodes = buildNodes(report)

  const onConnect = useCallback(
    (connection: Connection) => addEdge(connection, edges),
    [edges],
  )

  const runMedallion = async (days = 365) => {
    setMedallionRunning(true)
    setMedallionMsg(null)
    try {
      const r = await fetch(
        `http://127.0.0.1:8000/v1/delta/run/?mode=${activeMode}&days=${days}`,
        { method: 'POST' },
      )
      const j = await r.json()
      setMedallionMsg(j.ok ? `▶ ${j.message}` : `✗ ${j.error}`)
    } catch (e) {
      setMedallionMsg('✗ DS not running')
    } finally {
      setMedallionRunning(false)
    }
  }

  const tabStyle = (t: typeof tab) => ({
    padding: '4px 12px', fontSize: 11, fontFamily: 'monospace',
    cursor: 'pointer', border: 'none',
    background: tab === t ? '#1a2030' : 'transparent',
    color: tab === t ? C.active : C.dim,
    borderBottom: tab === t ? `1px solid ${C.active}` : '1px solid transparent',
  })

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:C.bg, color:C.text, fontFamily:'monospace' }}>

      {/* ── Header ── */}
      <div style={{ padding:'8px 16px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', gap:16 }}>
        <span style={{ fontSize:13, fontWeight:700, color:C.active }}>DELTA OPS FLOW</span>
        <span style={{ fontSize:11, color:C.dim }}>param pipeline · live values</span>
        <div style={{ marginLeft:'auto', display:'flex', gap:6, alignItems:'center' }}>
          {['PADAWAN','NORMAL','EUPHORIA','MAX'].map(m => (
            <button key={m} onClick={() => setActiveMode(m)} style={{
              fontSize:10, padding:'2px 8px', border:`1px solid ${activeMode===m ? C.active : C.border}`,
              borderRadius:3, background: activeMode===m ? '#0f2a1a' : 'transparent',
              color: activeMode===m ? C.active : C.faint, cursor:'pointer',
            }}>{m}</button>
          ))}
          <span style={{ fontSize:10, color:C.faint, marginLeft:8 }}>poll: {lastPoll}</span>
          <div style={{ width:1, height:20, background:C.border, margin:'0 8px' }} />
          {/* MEDALLION — fast run on last 365 days */}
          <button
            onClick={() => runMedallion(365)}
            disabled={medallionRunning}
            title="Run on last 365 days of data — fast representative test"
            style={{
              padding: '4px 14px', fontSize: 11, fontWeight: 700,
              border: `1px solid ${C.gold}`,
              borderRadius: 4,
              background: medallionRunning ? '#1a1400' : 'linear-gradient(135deg,#1a1400 0%,#2a2000 100%)',
              color: medallionRunning ? C.faint : C.gold,
              cursor: medallionRunning ? 'not-allowed' : 'pointer',
              letterSpacing: 1,
              boxShadow: medallionRunning ? 'none' : `0 0 8px ${C.gold}44`,
              transition: 'all 0.15s',
            }}
          >
            {medallionRunning ? '◌ RUNNING…' : '✦ MEDALLION'}
          </button>
          {/* full-data run */}
          <button
            onClick={() => runMedallion(0)}
            disabled={medallionRunning}
            title="Run on ALL historical data — slow, once per day"
            style={{
              padding: '4px 10px', fontSize: 10,
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              background: 'transparent',
              color: C.faint,
              cursor: medallionRunning ? 'not-allowed' : 'pointer',
            }}
          >
            FULL
          </button>
          {medallionMsg && (
            <span style={{ fontSize: 10, color: medallionMsg.startsWith('✗') ? C.dead : C.active, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {medallionMsg}
            </span>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display:'flex', borderBottom:`1px solid ${C.border}` }}>
        {(['flow','params','cis','iopt','gates'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={tabStyle(t)}>
            {t === 'flow' ? '⟡ FLOW' : t === 'params' ? '⊞ PARAMS' : t === 'cis' ? '⛨ CIS' : t === 'iopt' ? '★ IOPT' : '⊕ GATES'}
          </button>
        ))}
      </div>

      {/* ── FLOW tab ── */}
      {tab === 'flow' && (
        <div style={{ flex:1, position:'relative' }}>
          <ReactFlow
            nodes={liveNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            style={{ background: C.bg }}
          >
            <Background color={C.border} gap={24} />
            <Controls style={{ background:C.panel, border:`1px solid ${C.border}` }} />
            <MiniMap style={{ background:C.panel, border:`1px solid ${C.border}` }}
              nodeColor={() => C.border} />
          </ReactFlow>

          {/* legend */}
          <div style={{
            position:'absolute', bottom:16, left:16,
            background:C.panel, border:`1px solid ${C.border}`,
            borderRadius:6, padding:'8px 12px', fontSize:10, lineHeight:2,
          }}>
            {[
              { color:C.blue,   label:'INPUT' },
              { color:C.purple, label:'COMPUTED' },
              { color:C.warn,   label:'GATE' },
              { color:C.gold,   label:'MODE' },
              { color:C.active, label:'OUTPUT' },
            ].map(({ color, label }) => (
              <div key={label} style={{ display:'flex', alignItems:'center', gap:6 }}>
                <div style={{ width:10, height:10, borderRadius:2, background:color }} />
                <span style={{ color:C.dim }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── PARAMS tab ── */}
      {tab === 'params' && (
        <div style={{ flex:1, overflow:'auto', padding:16 }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${C.border}`, color:C.dim }}>
                {['MODE','entry_thr','jedi_min','cis','accel_bars','horizon','be_bars','max_lots','OOS Sharpe','hold'].map(h => (
                  <th key={h} style={{ padding:'6px 10px', textAlign:'left', fontWeight:400 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODE_ROWS.map(r => {
                const isActive = r.mode === activeMode
                return (
                  <tr key={r.mode} style={{
                    borderBottom:`1px solid ${C.border}`,
                    background: isActive ? '#0f2a1a' : 'transparent',
                  }}>
                    <td style={{ padding:'8px 10px', color: isActive ? C.active : r.mode==='MAX' ? C.dead : r.mode==='EUPHORIA' ? C.gold : C.text, fontWeight:600 }}>
                      {r.mode}{isActive ? ' ◀' : ''}
                    </td>
                    <td style={{ padding:'8px 10px', color:C.blue }}>{r.entry}</td>
                    <td style={{ padding:'8px 10px', color:C.blue }}>{r.jedi}</td>
                    <td style={{ padding:'8px 10px', color: r.cis===1 ? C.warn : C.text }}>{r.cis}</td>
                    <td style={{ padding:'8px 10px', color: r.accel===1 ? C.gold : C.text }}>{r.accel}</td>
                    <td style={{ padding:'8px 10px', color:C.purple }}>{r.hor}×5m = {r.hold}</td>
                    <td style={{ padding:'8px 10px', color: r.be>0 ? C.active : C.faint }}>{r.be > 0 ? r.be : '—'}</td>
                    <td style={{ padding:'8px 10px', color:C.text }}>{r.lots}</td>
                    <td style={{ padding:'8px 10px', color: r.sh > 10 ? C.active : r.sh > 5 ? C.gold : C.dead, fontWeight:700 }}>{r.sh.toFixed(2)}</td>
                    <td style={{ padding:'8px 10px', color:C.dim }}>{r.hold}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* param explanations */}
          <div style={{ marginTop:24, display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            {[
              { param:'entry_thr', val:'0.12 (EUPHORIA)', what:'soft_score percentile gate. Top ~5% of ensemble agreement. HIGHER ≠ better — exhaustion lives at top 1%.', color:C.blue },
              { param:'jedi_min',  val:'10 (EUPHORIA)',   what:'Council net directional vote. |jedi|≥10 = strong conviction. THE key fix: jedi filters exhaustion that score alone cannot.', color:C.blue },
              { param:'cis_threshold', val:'2 (EUPHORIA) / 1 (MAX)', what:'Signals needed to exit. cis=1: any single invalidation = out. cis=2: need structural confirmation. Fat pitches → 2. Max size → 1.', color:C.warn },
              { param:'accel_bars', val:'1 (EUPHORIA)',  what:'Bars of score+rvol improvement before scale-in fires. 1 = fastest detection. Required for 30min horizon — longer windows miss the move.', color:C.purple },
              { param:'horizon_bars', val:'6×5m = 30min', what:'Clock exit. "Get off at next station." NOT a signal exit. Prevents holding through session end or next regime transition.', color:C.purple },
              { param:'be_bars',   val:'5 (EUPHORIA)',   what:'After 5 bars of continuation with close > entry, stop locks to entry price. House money: worst case = breakeven.', color:C.active },
              { param:'max_lots',  val:'2.5 (EUPHORIA)', what:'Pyramid cap. With accel=1 (fast scale-in) and 30m horizon, 2.5 prevents over-pyramiding a move that peaks early.', color:C.text },
              { param:'reentry_lot_mult', val:'2.0 / 3.0', what:'Re-entry after CIS exit starts at 2× (EUPHORIA) or 3× (MAX) base lot. Retest confirmation = highest conviction setup in the system.', color:C.gold },
            ].map(({ param, val, what, color }) => (
              <div key={param} style={{ background:C.panel, border:`1px solid ${C.border}`, borderRadius:6, padding:'10px 12px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <span style={{ color, fontWeight:600, fontSize:11 }}>{param}</span>
                  <span style={{ color:C.gold, fontSize:10 }}>{val}</span>
                </div>
                <div style={{ fontSize:10, color:C.dim, lineHeight:1.6 }}>{what}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── CIS tab ── */}
      {tab === 'cis' && (
        <div style={{ flex:1, overflow:'auto', padding:16 }}>
          <div style={{ color:C.dim, fontSize:11, marginBottom:16 }}>
            Combined Invalidation Score — 5 independent market structure signals.
            Any {report?.config ? (report.config as Record<string,unknown>).cis_threshold ?? '2' : '2'} firing = full position exit.
            Not a stop-loss. An invalidation exit.
          </div>

          {CIS_SIGNALS.map((s, i) => (
            <div key={s.name} style={{
              background:C.panel, border:`1px solid ${C.border}`, borderRadius:6,
              padding:'12px 16px', marginBottom:8, display:'flex', alignItems:'flex-start', gap:12,
            }}>
              <div style={{ fontSize:16, color:C.warn, minWidth:24 }}>{i+1}</div>
              <div>
                <div style={{ color:C.warn, fontWeight:600, fontSize:12, marginBottom:4 }}>{s.name}</div>
                <div style={{ color:C.dim, fontSize:11 }}>{s.desc}</div>
              </div>
            </div>
          ))}

          <div style={{ marginTop:24, background:C.panel, border:`1px solid ${C.border}`, borderRadius:6, padding:16 }}>
            <div style={{ color:C.gold, fontWeight:600, fontSize:11, marginBottom:12 }}>MODE-SPECIFIC CIS BEHAVIOUR</div>
            <div style={{ fontSize:10, color:C.dim, lineHeight:2 }}>
              <div><span style={{color:C.text}}>PADAWAN / NORMAL</span> — REGIME_DEGRADE + JEDI_FADE (early-warning: exit before full reversal)</div>
              <div><span style={{color:C.gold}}>EUPHORIA</span> — structural-only: RISK-OFF/EXHAUSTION flip, hard JEDI reversal. TRENDING_STRONG→WEAK = noise, hold through it.</div>
              <div><span style={{color:C.dead}}>MAX</span> — any single signal = exit. 5× position size means zero tolerance for holding invalidated trades.</div>
            </div>
          </div>
        </div>
      )}

      {/* ── IOPT tab ── */}
      {tab === 'iopt' && (
        <div style={{ flex:1, overflow:'auto', padding:16 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
            {[
              { mode:'EUPHORIA', oos:21.73, holdout:21.37, wr:'55.2%', trades:230, verdict:'VALID', color:C.gold },
              { mode:'MAX',      oos:17.80, holdout:18.25, wr:'59.8%', trades:92,  verdict:'VALID', color:C.dead },
            ].map(r => (
              <div key={r.mode} style={{ background:C.panel, border:`1px solid ${r.color}44`, borderRadius:6, padding:16 }}>
                <div style={{ color:r.color, fontWeight:700, fontSize:13, marginBottom:8 }}>{r.mode}</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4, fontSize:11 }}>
                  <div style={{color:C.dim}}>OOS Sharpe</div>   <div style={{color:C.active,fontWeight:700}}>{r.oos}</div>
                  <div style={{color:C.dim}}>Holdout</div>      <div style={{color:C.active,fontWeight:700}}>{r.holdout}</div>
                  <div style={{color:C.dim}}>Win rate</div>     <div style={{color:C.text}}>{r.wr}</div>
                  <div style={{color:C.dim}}>Trades</div>       <div style={{color:C.text}}>{r.trades}</div>
                  <div style={{color:C.dim}}>Verdict</div>      <div style={{color:C.active,fontWeight:700}}>{r.verdict}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ background:C.panel, border:`1px solid ${C.border}`, borderRadius:6, padding:16, marginBottom:16 }}>
            <div style={{ color:C.gold, fontWeight:600, fontSize:11, marginBottom:12 }}>KEY IOPT FINDINGS (200 samples, seed=42)</div>
            {IOPT_INSIGHT.map(s => (
              <div key={s} style={{ display:'flex', gap:8, marginBottom:6, fontSize:11 }}>
                <span style={{color:C.active}}>→</span>
                <span style={{color:C.dim}}>{s}</span>
              </div>
            ))}
          </div>

          <div style={{ background:C.panel, border:`1px solid ${C.border}`, borderRadius:6, padding:16 }}>
            <div style={{ color:C.warn, fontWeight:600, fontSize:11, marginBottom:12 }}>OPEN RISKS</div>
            {[
              ['Exit returns use outcome_1h_pct (forward price)',   'Proxy — live Sharpe will be lower. Run --realistic flag to see floor.'],
              ['200 IOPT samples = 0.12% coverage of 9-dim space', 'Run 3 seeds to confirm robustness. Single-seed optimum may be lucky.'],
              ['EUPHORIA re_win=4 → 0 re-entries',                 '29.7 Sharpe re-entry edge from prior session is untapped. Expand re_win.'],
              ['25% account usage in one day',                     'Hard daily limit missing in paper adapters. Add now.'],
              ['Momentum energy model = 1-bar proxy only',         'OBI at scale-in bar is the real energy confirmation. Not yet gated.'],
            ].map(([risk, action]) => (
              <div key={risk as string} style={{ marginBottom:10, borderBottom:`1px solid ${C.border}`, paddingBottom:10 }}>
                <div style={{ color:C.warn, fontSize:10, marginBottom:2 }}>{risk}</div>
                <div style={{ color:C.dim,  fontSize:10 }}>{action}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── GATES tab ── */}
      {tab === 'gates' && (
        <div style={{ flex:1, overflow:'auto', padding:16, display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>

          {/* Sharpe waterfall */}
          <div style={{ background:C.panel, border:`1px solid ${C.border}`, borderRadius:6, padding:16 }}>
            <div style={{ color:C.gold, fontWeight:600, fontSize:11, marginBottom:12, letterSpacing:1 }}>SHARPE BUILD STACK</div>
            {[
              { label:'BASELINE — equal weight',               sharpe:1.36,  delta:null,       color:C.faint  },
              { label:'+ Sharpe-weighted routing',             sharpe:5.94,  delta:'+4.58',    color:C.text   },
              { label:'+ Soft regime (thr=0.35)',              sharpe:6.61,  delta:'+0.66',    color:C.blue   },
              { label:'+ HOUR_KILLS gate',                     sharpe:9.18,  delta:'+2.57',    color:'#2ae8e8'},
              { label:'+ SQZ_LOCK + ATR_RANK + RVOL + JEDI',  sharpe:15.86, delta:'+6.68',    color:C.active },
              { label:'DELTA OPS (PADAWAN + CIS + scale)',     sharpe:11.19, delta:'mgmt',     color:C.purple },
              { label:'EUPHORIA — fat pitches only',           sharpe:19.83, delta:'62.4% WR', color:C.gold   },
              { label:'★ RE-ENTRY after CIS exit',             sharpe:29.72, delta:'87t',      color:C.active },
            ].map((r, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:7 }}>
                <div style={{ flex:1, background:'#0a0c10', borderRadius:2, height:22, overflow:'hidden', position:'relative' }}>
                  <div style={{ position:'absolute', left:0, top:0, bottom:0, background:`${r.color}28`, width:`${Math.min(100,(r.sharpe/30)*100)}%`, borderRadius:2 }} />
                  <div style={{ position:'absolute', left:8, top:0, bottom:0, display:'flex', alignItems:'center', fontSize:9, color:r.color, fontFamily:'monospace', whiteSpace:'nowrap', overflow:'hidden' }}>
                    {r.label}
                  </div>
                </div>
                <div style={{ minWidth:38, textAlign:'right', fontSize:10, fontWeight:700, color:r.color }}>{r.sharpe.toFixed(2)}</div>
                {r.delta && <div style={{ minWidth:52, fontSize:9, color:C.active }}>{r.delta}</div>}
              </div>
            ))}
          </div>

          {/* Gate toggles */}
          <div style={{ background:C.panel, border:`1px solid ${C.border}`, borderRadius:6, padding:16 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <span style={{ color:C.warn, fontWeight:600, fontSize:11, letterSpacing:1 }}>GATE CONTROLS</span>
              <div style={{ display:'flex', gap:6 }}>
                <span style={{ fontSize:9, color:C.active }}>{gates.filter(g=>g.on).length} ON</span>
                <span style={{ fontSize:9, color:C.faint }}>{gates.filter(g=>!g.on).length} OFF</span>
              </div>
            </div>
            {gates.map(g => (
              <div key={g.id}
                onClick={() => setGates(prev => prev.map(x => x.id===g.id ? {...x, on:!x.on} : x))}
                style={{
                  display:'flex', alignItems:'center', gap:10, marginBottom:5,
                  padding:'6px 10px', borderRadius:4, cursor:'pointer',
                  background: g.on ? `${g.color}12` : 'transparent',
                  border:`1px solid ${g.on ? g.color+'44' : C.border}`,
                  transition:'all 0.12s',
                }}>
                <div style={{ width:10, height:10, borderRadius:2, flexShrink:0, background:g.on ? g.color : C.faint, boxShadow:g.on ? `0 0 5px ${g.color}88` : 'none' }} />
                <span style={{ flex:1, fontSize:10, fontFamily:'monospace', color:g.on ? C.text : C.faint, fontWeight:g.on ? 600 : 400 }}>{g.label}</span>
                <span style={{ fontSize:10, fontWeight:700, color:g.on ? g.color : C.faint, minWidth:44, textAlign:'right' }}>{g.delta}</span>
              </div>
            ))}
            <div style={{ marginTop:10, padding:'6px 8px', background:'#0a0c10', borderRadius:4, fontSize:9, color:C.faint, lineHeight:1.6 }}>
              Visual only — fire <span style={{color:C.gold}}>✦ MEDALLION</span> (header) to test gate combinations against signal_log.db
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
