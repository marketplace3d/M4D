import { useState, useEffect, useCallback, useRef } from "react";

// MISSION bundled copy — source of truth: `spec-kit/M4D_FullSystemVizDoc.jsx`
// (re-copy after edits; overlays absolute so MISSION nav stays visible.)

// ═══════════════════════════════════════════════════════════════════════
// M4D · MAXCOGVIZ · MISSION V1.0
// THE LIVING SPEC — All system elements, iconography, opt loop
// Jedi Orb · Sabre Array · Sword Council · Legend Traders
// Lobster Memory · Recursive Loop · Flatten Engine · Deploy Nodes
// ═══════════════════════════════════════════════════════════════════════

const FONT_MONO = "'Share Tech Mono','Courier New',monospace";
const FONT_DISPLAY = "'Barlow Condensed',sans-serif";

/** Bump when layout/zoom defaults change — if #mission header does not show this rev, dev server is stale (restart `./go.sh mission`). */
const VIZDOC_LAYOUT_REV = 9;
const VIZDOC_DEFAULT_ZOOM = 1.55;

// ── FULL ALGO ROSTER WITH ICONOGRAPHY ────────────────────────────────────────
const ALGOS_A = [
  { id:"NS", name:"NIALL SPIKE",     icon:"⚡", sub:"Vol Delta Explosion", color:"#22d3ee", method:"Ask-delta σ spike on 1m/5m. Institutional absorption." },
  { id:"CI", name:"CYBER-ICT",       icon:"🎯", sub:"OB Heatseeker",     color:"#a78bfa", method:"Auto-detect OB/FVG/Breaker on 15m+1H. Return entry." },
  { id:"BQ", name:"BANSHEE SQUEEZE", icon:"💥", sub:"TTM Momentum Release", color:"#f43f5e", method:"BB inside KC = squeeze. First expansion bar fires." },
  { id:"CC", name:"CELTIC CROSS",    icon:"✚",  sub:"EMA Ribbon Alignment", color:"#4ade80", method:"8/21/34/55/89 full bullish stack. Partial = fractional." },
  { id:"WH", name:"WOLFHOUND",       icon:"🐺", sub:"Scalp Velocity",    color:"#fb923c", method:"3 consecutive accel bars + expanding range." },
  { id:"SA", name:"STONE ANCHOR",    icon:"⚓", sub:"VP/VPOC",           color:"#94a3b8", method:"VPOC slope + HVN/LVN proximity scoring." },
  { id:"HK", name:"HIGH KING",       icon:"👑", sub:"Opening Range Bias", color:"#fbbf24", method:"ORB 5/30min. PDH/PDL macro filter." },
  { id:"GO", name:"GALLOWGLASS OB",  icon:"🗡️", sub:"OB Retest",        color:"#c084fc", method:"3× vol displacement. 50% OB retrace entry." },
  { id:"EF", name:"EMERALD FLOW",    icon:"🌊", sub:"Money Flow MFI",    color:"#34d399", method:"MFI(14) cross 50. Divergence = reversal flag." },
];

const ALGOS_B = [
  { id:"8E", name:"8-EMA RIBBON",    icon:"📈", sub:"Trend Momentum Gate", color:"#67e8f9", method:"Price vs 8EMA. Ribbon width = momentum score 0-10." },
  { id:"VT", name:"VEGA TRAP",       icon:"⚗️", sub:"Options Gamma Squeeze", color:"#818cf8", method:"Max pain, gamma walls, dealer hedging flow." },
  { id:"MS", name:"MARKET SHIFT",    icon:"🔄", sub:"CHoCH / BOS",       color:"#f97316", method:"Structure change on 15m/1H with volume confirm." },
  { id:"DP", name:"DARK POOL",       icon:"🌑", sub:"Institutional Prints", color:"#e879f9", method:"DP ratio anomaly >2× avg at key technical levels." },
  { id:"WS", name:"WYCKOFF SPRING",  icon:"🌀", sub:"Accum Phase Detector", color:"#fde68a", method:"SC/AR/ST/Spring/LPS/LPSY phase confidence scoring." },
  { id:"RV", name:"RENKO VAULT",     icon:"🧱", sub:"Noise-Filtered Trend", color:"#86efac", method:"1×ATR bricks. 3 consecutive bullish = long signal." },
  { id:"HL", name:"HARMONIC LENS",   icon:"🔭", sub:"Gartley/Bat/Butterfly PRZ", color:"#f0abfc", method:"PRZ completion ±0.5% + RSI divergence confirm." },
  { id:"AI", name:"ALPHA IMBALANCE", icon:"⚖️", sub:"FVG Fill Probability", color:"#a5f3fc", method:"FVG catalog by age+proximity+vol. 70th pct threshold." },
  { id:"VK", name:"VOLKOV KELTNER",  icon:"🌩️", sub:"KC Breakout",      color:"#60a5fa", method:"KC breakout with vol surge. ATR trail management." },
];

const ALGOS_C = [
  { id:"SE", name:"STOCKBEE EP",     icon:"🚀", sub:"Episodic Pivot 3×Vol", color:"#4ade80", method:"Gap-up 3×avg vol + catalyst. 20-30% target 1-3M.", horizon:"1-3M" },
  { id:"IC", name:"ICT WEEKLY FVG",  icon:"🏛️", sub:"Virgin FVG Displacement", color:"#a78bfa", method:"Weekly virgin FVG never touched. Monthly draw align.", horizon:"1-3M" },
  { id:"WN", name:"WEINSTEIN STAGE", icon:"📊", sub:"Stage 2 Base Breakout", color:"#fbbf24", method:"6-month base + vol expansion above 30W MA.", horizon:"3-6M" },
  { id:"CA", name:"CASPER IFVG",     icon:"👻", sub:"Inverse FVG Deep Draw", color:"#f9a8d4", method:"Quarterly IFVG as price target. Void depth scoring.", horizon:"3-6M" },
  { id:"TF", name:"TTRADES FRACTAL", icon:"🌿", sub:"MTF Fractal Swing", color:"#fb923c", method:"HH/HL daily+weekly+monthly alignment. Fib targets.", horizon:"1-6M" },
  { id:"RT", name:"RAYNER TREND",    icon:"🎯", sub:"200MA Pullback Entry", color:"#34d399", method:"200MA up-slope + 50EMA pullback. Min 1:3 RR.", horizon:"1-3M" },
  { id:"MM", name:"MINERVINI VCP",   icon:"🌡️", sub:"Volatility Contraction", color:"#67e8f9", method:"Progressive tighter bases 33% each. Pivot breakout.", horizon:"3-6M" },
  { id:"OR", name:"O'NEIL BREAKOUT", icon:"🏆", sub:"CAN SLIM C&H",      color:"#e879f9", method:"EPS accel + RS>80 + 40% vol pivot breakout.", horizon:"3-6M" },
  { id:"DV", name:"DRAGONFLY VOL",   icon:"🐉", sub:"Sector Rotation RS", color:"#fde68a", method:"RS line 52W high + institutional sector accumulation.", horizon:"1-6M" },
];

const ALL_ALGOS = [...ALGOS_A, ...ALGOS_B, ...ALGOS_C];

// ── CANVAS LAYOUT ─────────────────────────────────────────────────────────────
// Total canvas: 2800 × 2200 (pan/zoom navigable)
const CW = 2800, CH = 2200;

// Council + algo grid: same geometry as Warrior viz (`MaxCogVizXYFlow.jsx`) (1400-wide ref), scaled horizontally to CW.
const JEDI_X = CW / 2;
const JEDI_Y = 90;
const CA_X = CW * 0.18;
const CB_X = CW * 0.5;
const CC_X = CW * 0.82;
const COUNCIL_Y = 280;
const ALGO_Y_BASE = 460;
const ALGO_GAP_X = 140;
const ALGO_GAP_Y = 130;
const ALGO_GRID_INSET = 200; // startX = councilX - 200 (Warrior)
const ALGO_W = 120;
const ALGO_H = 68;

// System elements (left column)
const SYS_X = 100;
const LOOP_Y = 500, LOBSTER_Y = 700, FLATTEN_Y = 900, DEPLOY_Y = 1100;

// Opt loop (right column)  
const OPT_X = CW - 300;
const OPT_LOOP_Y = 500, WEIGHT_Y = 720, REGIME_Y = 920, CLOCK_Y = 1100;

// Output / Score row
const SCORE_Y = 1350;

function algoGrid(councilX, algos) {
  const cols = 3;
  return algos.map((a, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const startX = councilX - ALGO_GRID_INSET;
    return { ...a, x: startX + col * ALGO_GAP_X, y: ALGO_Y_BASE + row * ALGO_GAP_Y };
  });
}

const GRID_A = algoGrid(CA_X, ALGOS_A);
const GRID_B = algoGrid(CB_X, ALGOS_B);
const GRID_C = algoGrid(CC_X, ALGOS_C);
const ALL_GRIDS = [...GRID_A, ...GRID_B, ...GRID_C];

// ── HELPERS ───────────────────────────────────────────────────────────────────
const rand = (min,max) => Math.random()*(max-min)+min;
const randVote = () => [-1,-1,0,0,0,1,1][Math.floor(Math.random()*7)];

function initVotes() {
  const v={}, s={};
  ALL_ALGOS.forEach(a=>{ v[a.id]=randVote(); s[a.id]=rand(0.2,0.9); });
  v.jedi=1; s.jedi=0.92;
  return {v,s};
}

function computeScore(v) {
  const j = (v.jedi ?? 0) * 8.4;
  const a = ALGOS_A.reduce((t, al) => t + (v[al.id] ?? 0), 0) * 0.84;
  const b = ALGOS_B.reduce((t, al) => t + (v[al.id] ?? 0), 0) * 0.84;
  const c = ALGOS_C.reduce((t, al) => t + (v[al.id] ?? 0), 0) * 0.42;
  return +((j + a * 0.5 + b * 0.5 + c)).toFixed(1);
}

const vCol = (v,fallback="#1e3a50") => v===1?"#22d3ee":v===-1?"#ef4444":fallback;
const REGIME_COL = {LOW_VOL:"#22c55e",HIGH_VOL:"#ef4444",FOMC_FLAT:"#f59e0b"};
const LOOP_PHASES = ["IDLE","FETCHING","COMPARING","VAMA","WRITING","DONE"];

// SVG curve helpers
function bez(x1,y1,x2,y2,cp=0.45) {
  const dy=(y2-y1)*cp;
  return `M${x1},${y1} C${x1},${y1+dy} ${x2},${y2-dy} ${x2},${y2}`;
}
function hbez(x1,y1,x2,y2) {
  const dx=(x2-x1)*0.5;
  return `M${x1},${y1} C${x1+dx},${y1} ${x2-dx},${y2} ${x2},${y2}`;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
export default function M4DVizDoc() {
  const [{v:votes,s:strengths},setState]=useState(initVotes);
  const [tick,setTick]=useState(0);
  const [regime,setRegime]=useState("LOW_VOL");
  const [loopPhase,setLoopPhase]=useState("IDLE");
  const [loopPhaseIdx,setLoopPhaseIdx]=useState(0);
  const [loopScore,setLoopScore]=useState(null);
  const [loopATR,setLoopATR]=useState(null);
  const [driftHist,setDriftHist]=useState([]);
  const [countdown,setCountdown]=useState("--:--:--");
  const [selected,setSelected]=useState(null);
  // Center view on jedi + three councils + algo grids (matches Warrior composition).
  const [zoom, setZoom] = useState(VIZDOC_DEFAULT_ZOOM);
  const [pan, setPan] = useState(() => {
    const z = VIZDOC_DEFAULT_ZOOM;
    const focusX = CW / 2;
    const focusY = 460;
    return { x: CW / 2 - focusX * z, y: CH / 2 - focusY * z };
  });
  const [dragging,setDragging]=useState(false);
  const [ds,setDs]=useState(null);
  const [view,setView]=useState("FULL"); // FULL | SPEC | LOOP
  const svgRef=useRef();
  const viewportRef=useRef();
  const didCenterRef=useRef(false);

  const centerOn = useCallback((focusX, focusY, targetZoom) => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = rect.width / 2 - focusX * targetZoom;
    const y = rect.height / 2 - focusY * targetZoom;
    setPan({ x, y });
  }, []);

  useEffect(() => {
    if (didCenterRef.current) return;
    didCenterRef.current = true;
    centerOn(CW / 2, 520, zoom);
  }, [centerOn, zoom]);

  useEffect(()=>{
    const iv=setInterval(()=>{
      setTick(t=>t+1);
      setState(prev=>{
        const nv={...prev.v}, ns={...prev.s};
        for(let i=0;i<5;i++){
          const a=ALL_ALGOS[Math.floor(Math.random()*ALL_ALGOS.length)];
          nv[a.id]=randVote();
        }
        ALL_ALGOS.forEach(a=>{ns[a.id]=Math.max(0.08,Math.min(0.98,prev.s[a.id]+(Math.random()-0.5)*0.09));});
        ns.jedi=0.82+Math.random()*0.16;
        return {v:nv,s:ns};
      });
      if(Math.random()<0.018) setRegime(["LOW_VOL","LOW_VOL","HIGH_VOL","FOMC_FLAT"][Math.floor(Math.random()*4)]);
      if(Math.random()<0.028){
        setLoopPhaseIdx(i=>{
          const ni=(i+1)%LOOP_PHASES.length;
          setLoopPhase(LOOP_PHASES[ni]);
          if(LOOP_PHASES[ni]==="DONE"){
            setLoopScore(+((Math.random()-0.48)*10).toFixed(2));
            setLoopATR(+(0.8+Math.random()*2.4).toFixed(3));
            setDriftHist(h=>[...h.slice(-23),(Math.random()-0.48)*4]);
          }
          return ni;
        });
      }
      const now=new Date();
      const next=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate(),23,59,0));
      if(now.getUTCHours()>=23&&now.getUTCMinutes()>=59) next.setUTCDate(next.getUTCDate()+1);
      const d=next-now;
      setCountdown(`${String(Math.floor(d/3600000)).padStart(2,"0")}:${String(Math.floor((d%3600000)/60000)).padStart(2,"0")}:${String(Math.floor((d%60000)/1000)).padStart(2,"0")}`);
    },850);
    return ()=>clearInterval(iv);
  },[]);

  const score=computeScore(votes);
  const dir=score>=7?"LONG":score<=-7?"SHORT":"FLAT";
  const dirCol=dir==="LONG"?"#22d3ee":dir==="SHORT"?"#ef4444":"#3a5a6a";

  const onWheel=useCallback(e=>{
    e.preventDefault();
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setZoom((z) => {
      const next = Math.max(0.18, Math.min(2.5, z - e.deltaY * 0.0008));
      const left = -pan.x / z;
      const top = -pan.y / z;
      const worldX = left + (sx / rect.width) * (CW / z);
      const worldY = top + (sy / rect.height) * (CH / z);
      const nextLeft = worldX - (sx / rect.width) * (CW / next);
      const nextTop = worldY - (sy / rect.height) * (CH / next);
      setPan({ x: -nextLeft * next, y: -nextTop * next });
      return next;
    });
  },[pan.x, pan.y]);
  const onMD=useCallback(e=>{if(e.button!==0)return;setDragging(true);setDs({x:e.clientX-pan.x,y:e.clientY-pan.y});},[pan]);
  const onMM=useCallback(e=>{if(!dragging||!ds)return;setPan({x:e.clientX-ds.x,y:e.clientY-ds.y});},[dragging,ds]);
  const onMU=useCallback(()=>setDragging(false),[]);

  const aLong=GRID_A.filter(a=>votes[a.id]===1).length, aShort=GRID_A.filter(a=>votes[a.id]===-1).length;
  const bLong=GRID_B.filter(a=>votes[a.id]===1).length, bShort=GRID_B.filter(a=>votes[a.id]===-1).length;
  const cLong=GRID_C.filter(a=>votes[a.id]===1).length, cShort=GRID_C.filter(a=>votes[a.id]===-1).length;

  // Drift sparkline path
  const driftPath=()=>{
    if(driftHist.length<2)return"";
    const W=180,H=30,mid=H/2;
    const max=Math.max(...driftHist.map(Math.abs),1);
    return driftHist.map((d,i)=>{
      const x=(i/(driftHist.length-1))*W;
      const y=mid-(d/max)*(mid-2);
      return `${i===0?"M":"L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  };

  return (
    <div style={{width:"100%",height:"100%",minHeight:0,background:"#02040a",fontFamily:FONT_MONO,color:"#5a8090",position:"relative",overflow:"hidden",userSelect:"none"}}>

      {/* SCANLINES — absolute so MISSION shell nav stays visible */}
      <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:0,
        background:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.06) 2px,rgba(0,0,0,0.06) 4px)"}}/>

      {/* AMBIENT GLOW */}
      <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:1,
        background:`radial-gradient(ellipse 80% 50% at 50% 0%, ${dir==="LONG"?"rgba(34,211,238,0.03)":dir==="SHORT"?"rgba(239,68,68,0.03)":"rgba(75,85,99,0.02)"} 0%, transparent 70%)`,
        transition:"background 2s"}}/>

      {/* ── TOP COMMAND BAR ── */}
      <div style={{position:"absolute",top:0,left:0,right:0,height:50,zIndex:200,background:"#030610",borderBottom:"1px solid #081828",display:"flex",alignItems:"center",padding:"0 20px",gap:16}}>
        <div>
          <div style={{fontFamily:FONT_DISPLAY,fontSize:18,fontWeight:900,letterSpacing:4,color:"#22d3ee"}}>🛡️ M4D · MISSION</div>
          <div style={{fontSize:7,letterSpacing:2,color:"#0a2030"}}>JEDI ORB · 3 COUNCILS · 27 SABRES · OPT LOOP · LOBSTER MEMORY · FLATTEN ENGINE · DEPLOY NODES</div>
        </div>
        <div style={{width:1,height:30,background:"#081828"}}/>

        {/* VIEW SWITCHER */}
        {[["FULL","⚔️ MISSION"],["SPEC","📋 SPEC ELEMENTS"],["LOOP","🔁 OPT LOOP"]].map(([k,l])=>(
          <button key={k} onClick={()=>setView(k)} style={{fontFamily:FONT_MONO,fontSize:9,letterSpacing:2,padding:"4px 12px",
            background:view===k?"#081828":"transparent",
            border:`1px solid ${view===k?"#22d3ee":"#081828"}`,
            color:view===k?"#22d3ee":"#1e3a4a",cursor:"pointer"}}>
            {l}
          </button>
        ))}

        <div style={{position:"absolute",left:"50%",transform:"translateX(-50%)",textAlign:"center"}}>
          <div style={{fontFamily:FONT_DISPLAY,fontSize:44,fontWeight:900,lineHeight:1,color:dirCol,
            textShadow:`0 0 24px ${dirCol}99,0 0 48px ${dirCol}33`,transition:"all 0.5s",fontVariantNumeric:"tabular-nums"}}>
            {score>0?"+":""}{score}
          </div>
          <div style={{fontSize:10,letterSpacing:4,color:dirCol,opacity:0.7}}>{dir}</div>
        </div>

        <div style={{marginLeft:"auto",display:"flex",gap:16,alignItems:"center"}}>
          <div style={{fontSize:9,color:REGIME_COL[regime],letterSpacing:2,fontWeight:700}}>{regime}</div>
          <div style={{width:1,height:20,background:"#081828"}}/>
          <div style={{fontSize:9,color:"#f59e0b",letterSpacing:1}}>⏱ {countdown}</div>
          <div style={{width:1,height:20,background:"#081828"}}/>
          <div style={{fontSize:8,color:"#a0c8d8",letterSpacing:1}} title="If REV does not match repo, restart MISSION dev (Vite on /Volumes may skip HMR without polling).">
            MISSION REV{VIZDOC_LAYOUT_REV} · z={zoom.toFixed(2)} · SCROLL=ZOOM · DRAG=PAN
          </div>
        </div>
      </div>

      {/* ── SVG CANVAS ── */}
      <div ref={viewportRef} style={{position:"absolute",inset:0,top:50,cursor:dragging?"grabbing":"grab"}}
        onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={onMU} onWheel={onWheel}>
        <svg ref={svgRef} width="100%" height="100%"
          viewBox={`${-pan.x/zoom} ${-pan.y/zoom} ${CW/zoom} ${(CH)/zoom}`}>
          <defs>
            {/* RADIAL GRADIENTS */}
            {[["jG","#f59e0b"],["boomG","#22d3ee"],["strG","#818cf8"],["legG","#4ade80"],["redG","#ef4444"]].map(([id,c])=>(
              <radialGradient key={id} id={id} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={c} stopOpacity="0.3"/>
                <stop offset="100%" stopColor={c} stopOpacity="0"/>
              </radialGradient>
            ))}
            {/* FILTERS */}
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="softglow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="2" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="text-glow">
              <feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            {/* ARROWS */}
            {[["aJ","#f59e0b"],["aB","#22d3ee"],["aS","#818cf8"],["aL","#4ade80"],["aR","#ef4444"],["aG","#22c55e"],["aMu","#9ca3af"]].map(([id,c])=>(
              <marker key={id} id={id} markerWidth="7" markerHeight="7" refX="5" refY="2.5" orient="auto">
                <path d="M0,0 L0,5 L7,2.5 z" fill={c} opacity="0.85"/>
              </marker>
            ))}
            {/* SABRE CLIP */}
            <clipPath id="nodeClip"><rect width={ALGO_W} height={ALGO_H} rx="3"/></clipPath>
          </defs>

          {/* ── BACKGROUND GRID ── */}
          <g opacity="0.035">
            {Array.from({length:Math.ceil(CW/60)},(_,i)=><line key={`v${i}`} x1={i*60} y1={0} x2={i*60} y2={CH} stroke="#22d3ee" strokeWidth="0.5"/>)}
            {Array.from({length:Math.ceil(CH/60)},(_,i)=><line key={`h${i}`} x1={0} y1={i*60} x2={CW} y2={i*60} stroke="#22d3ee" strokeWidth="0.5"/>)}
          </g>

          {/* ── AMBIENT ZONES ── */}
          <ellipse cx={CA_X} cy={620} rx={280} ry={300} fill="url(#boomG)" opacity="0.6"/>
          <ellipse cx={CB_X} cy={620} rx={280} ry={300} fill="url(#strG)" opacity="0.6"/>
          <ellipse cx={CC_X} cy={620} rx={280} ry={300} fill="url(#legG)" opacity="0.6"/>
          <ellipse cx={JEDI_X} cy={JEDI_Y} rx={200} ry={140} fill="url(#jG)" opacity="0.9"/>
          <ellipse cx={SYS_X+200} cy={800} rx={160} ry={360} fill="url(#strG)" opacity="0.15"/>
          <ellipse cx={OPT_X} cy={800} rx={160} ry={360} fill="url(#jG)" opacity="0.15"/>

          {/* ═════════════════════════════════════════ */}
          {/* ── SYSTEM ELEMENTS (LEFT COLUMN) ──      */}
          {/* ═════════════════════════════════════════ */}
          {(view==="FULL"||view==="SPEC")&&<>
            {/* APP ENGINE FLOW BOX */}
            <SpecBox x={30} y={380} w={220} h={260} title="🚂 APP ENGINE FLOW" color="#818cf8">
              {[["🌐","Market Pulse","Live Feed"],
                ["🦞","AI Signal","30-Sabre Vote"],
                ["🧊","Cog Viz","Heat Meter PWA"],
                ["👾","Algo Trade","Rust Execution"],
                ["🫧","Management","Boom & Scale"],
                ["🛸","Opt 23:59","Recursive UTC"],
              ].map(([icon,name,sub],i)=>(
                <g key={i} transform={`translate(10,${30+i*38})`}>
                  <text fontSize="14" fill="#818cf8" opacity="0.9">{icon}</text>
                  <text x={28} y={-2} fontSize="9" fill="#a0c8d8" fontFamily={FONT_DISPLAY} fontWeight="700" letterSpacing="1">{name}</text>
                  <text x={28} y={10} fontSize="7" fill="#1e3a50" letterSpacing="0.5">{sub}</text>
                  {i<5&&<line x1={14} y1={18} x2={14} y2={36} stroke="#818cf8" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.3"/>}
                </g>
              ))}
            </SpecBox>

            {/* LOBSTER MEMORY */}
            <SpecBox x={30} y={670} w={220} h={180} title="🦞 LOBSTER MEMORY" color="#22d3ee">
              {[["session_id","TEXT PK"],["timestamp_utc","TEXT"],["weights_blob","JSON"],["loop_score","REAL"],["vama_atr","REAL"],["regime_state","TEXT"],["is_valid","INT DEFAULT 1"]].map(([col,type],i)=>(
                <g key={i} transform={`translate(10,${28+i*20})`}>
                  <text fontSize="8" fill="#22d3ee" opacity="0.8" letterSpacing="0.5">{col}</text>
                  <text x={120} fontSize="7" fill="#1e3a50" letterSpacing="0.5">{type}</text>
                </g>
              ))}
            </SpecBox>

            {/* FLATTEN ENGINE */}
            <SpecBox x={30} y={870} w={220} h={240} title="🗿 FLATTEN ENGINE" color="#ef4444">
              {[["P1","☠","HEARTBEAT DEAD","IMMEDIATE"],
                ["P2","💥","OUTLIER SURGE","IMMEDIATE"],
                ["P3","📅","FOMC HARD FLAT","SCHEDULED"],
                ["P4","📉","DRAWDOWN >3%","LOCK"],
                ["P5","⚖️","SIZE >2% RISK","REDUCE"],
                ["P6","🐢","VELOCITY DECEL","STANDARD"],
                ["P7","📻","HUM <500Hz","STANDARD"],
                ["P8","⚠","SCORE <7 MID","ALERT"],
              ].map(([p,icon,name,act],i)=>(
                <g key={i} transform={`translate(8,${28+i*26})`}>
                  <text fontSize="7" fill="#ef4444" opacity="0.5">{p}</text>
                  <text x={18} fontSize="11">{icon}</text>
                  <text x={36} y={-2} fontSize="8" fill="#a08080" letterSpacing="0.3">{name}</text>
                  <text x={36} y={9} fontSize="6" fill={act==="IMMEDIATE"?"#ef4444":act==="LOCK"?"#818cf8":"#f59e0b"} letterSpacing="1">{act}</text>
                </g>
              ))}
            </SpecBox>

            {/* DEPLOY NODES */}
            <SpecBox x={30} y={1130} w={220} h={160} title="🚀 DEPLOY NODES" color="#4ade80">
              {[["🖥️","MAC MINI","Brain · Grok Loop · Svelte Dev"],
                ["☁️","LINUX CLOUD","Muscle · Rust · Canonical Clock"],
                ["📱","ANDROID PWA","Pulse · Heat Meter · Hum 200-900Hz"],
              ].map(([icon,name,role],i)=>(
                <g key={i} transform={`translate(10,${32+i*44})`}>
                  <text fontSize="22">{icon}</text>
                  <text x={36} y={-4} fontSize="9" fill="#4ade80" fontFamily={FONT_DISPLAY} fontWeight="700" letterSpacing="2">{name}</text>
                  <text x={36} y={9} fontSize="7" fill="#1e3a50" letterSpacing="0.3">{role}</text>
                </g>
              ))}
            </SpecBox>

            {/* FIRE DOC ENGINE */}
            <SpecBox x={30} y={1310} w={220} h={80} title="🔥 FIRE DOC ENGINE" color="#f59e0b">
              <g transform="translate(10,32)">
                {["TXT","MD","PDF","🐘 SQLite"].map((step,i,arr)=>(
                  <g key={step} transform={`translate(${i*52},0)`}>
                    <text fontSize={i===3?12:9} fill={i===3?"#f59e0b":"#a0c8d8"} fontFamily={FONT_DISPLAY} fontWeight="700">{step}</text>
                    {i<arr.length-1&&<text x={i===2?38:32} fontSize="10" fill="#f59e0b" opacity="0.7">➔</text>}
                  </g>
                ))}
              </g>
            </SpecBox>
          </>}

          {/* ═════════════════════════════════════════ */}
          {/* ── OPT LOOP (RIGHT COLUMN) ──             */}
          {/* ═════════════════════════════════════════ */}
          {(view==="FULL"||view==="LOOP")&&<>
            {/* LOOP COUNTDOWN */}
            <SpecBox x={OPT_X-110} y={380} w={230} h={90} title="⏱ 23:59 UTC LOOP" color="#f59e0b">
              <g transform="translate(0,28)">
                <text x={115} textAnchor="middle" fontSize="7" fill="#1e3a50" letterSpacing="2">NEXT TRIGGER</text>
                <text x={115} y={24} textAnchor="middle" fontSize="28" fill="#f59e0b" fontFamily={FONT_DISPLAY} fontWeight="900" letterSpacing="4" style={{ fontVariantNumeric: "tabular-nums" }}>{countdown}</text>
              </g>
            </SpecBox>

            {/* LOOP PHASE PIPELINE */}
            <SpecBox x={OPT_X-110} y={490} w={230} h={100} title="🔁 LOOP PHASES" color="#f59e0b">
              <g transform="translate(8,24)">
                {LOOP_PHASES.map((ph,i)=>{
                  const active=ph===loopPhase;
                  const done=LOOP_PHASES.indexOf(loopPhase)>i&&loopPhase!=="IDLE";
                  return (
                    <g key={ph} transform={`translate(${(i%3)*72},${Math.floor(i/3)*34})`}>
                      <rect width={68} height={26} fill={active?"#1a1200":done?"#001a0a":"#040810"} stroke={active?"#f59e0b":done?"#22c55e":"#081828"} strokeWidth="0.8" rx="2"/>
                      <text x={34} y={10} textAnchor="middle" fontSize="7" fill={active?"#f59e0b":done?"#22c55e":"#1e3a50"} letterSpacing="1" fontFamily={FONT_DISPLAY} fontWeight={active?"700":"400"}>{ph}</text>
                      {active&&<rect x={0} y={20} width={68} height={3} fill="#f59e0b" opacity="0.6" rx="1"/>}
                      {done&&<rect x={0} y={20} width={68} height={3} fill="#22c55e" opacity="0.4" rx="1"/>}
                    </g>
                  );
                })}
              </g>
            </SpecBox>

            {/* REGIME CLASSIFIER */}
            <SpecBox x={OPT_X-110} y={610} w={230} h={130} title="🏛️ REGIME · HMM GATE" color={REGIME_COL[regime]}>
              <g transform="translate(8,24)">
                {[["LOW_VOL","#22c55e","VAMA ACTIVE · WEIGHTS UPDATE"],
                  ["HIGH_VOL","#ef4444","WEIGHTS FROZEN · NO WRITES"],
                  ["FOMC_FLAT","#f59e0b","HARD FLAT · ALL SUPPRESSED"]].map(([r,c,sub],i)=>(
                  <g key={r} transform={`translate(0,${i*34})`}>
                    <rect width={208} height={28} fill={regime===r?`${c}15`:"#040810"} stroke={regime===r?c:"#081828"} strokeWidth={regime===r?"1.2":"0.5"} rx="2"/>
                    {regime===r&&<rect width={3} height={28} fill={c} rx="1"/>}
                    <text x={14} y={11} fontSize="9" fill={regime===r?c:"#1e3a50"} fontFamily={FONT_DISPLAY} fontWeight="700" letterSpacing="2">{r}</text>
                    <text x={14} y={22} fontSize="6.5" fill={regime===r?`${c}aa`:"#0a1828"} letterSpacing="0.5">{sub}</text>
                  </g>
                ))}
              </g>
            </SpecBox>

            {/* WEIGHT LEDGER */}
            <SpecBox x={OPT_X-110} y={760} w={230} h={150} title="🐘 WEIGHT LEDGER" color="#22d3ee">
              <g transform="translate(8,22)">
                <text fontSize="7" fill="#1e3a50" letterSpacing="1">LOOP SCORE Δ</text>
                <text x={100} fontSize="16" fill={loopScore!==null?(loopScore>0?"#22d3ee":"#ef4444"):"#1e3a50"} fontFamily={FONT_DISPLAY} fontWeight="900">
                  {loopScore!==null?(loopScore>0?"+":"")+loopScore.toFixed(2):"—"}
                </text>
                <text y={22} fontSize="7" fill="#1e3a50" letterSpacing="1">VAMA ATR</text>
                <text x={100} y={22} fontSize="16" fill="#f59e0b" fontFamily={FONT_DISPLAY} fontWeight="900">
                  {loopATR!==null?loopATR.toFixed(3):"—"}
                </text>
                <text y={44} fontSize="7" fill="#1e3a50" letterSpacing="1">DRIFT HISTORY</text>
                {driftHist.length>1&&(()=>{
                  const max=Math.max(...driftHist.map(Math.abs),1);
                  const pts=driftHist.map((d,i)=>{
                    const x=(i/(driftHist.length-1))*180;
                    const y=15-(d/max)*13;
                    return `${i===0?"M":"L"}${x.toFixed(1)},${y.toFixed(1)}`;
                  }).join(" ");
                  const last=driftHist[driftHist.length-1];
                  return (
                    <g transform="translate(0,50)">
                      <rect width={180} height={30} fill="#020408" stroke="#081828" strokeWidth="0.5"/>
                      <line x1="0" y1="15" x2="180" y2="15" stroke="#081828" strokeWidth="0.5"/>
                      <path d={pts} fill="none" stroke={last>0?"#22d3ee":"#ef4444"} strokeWidth="1.5"/>
                      <circle cx={180} cy={15-(last/max)*13} r={3} fill={last>0?"#22d3ee":"#ef4444"}/>
                    </g>
                  );
                })()}
                <g transform="translate(0,86)">
                  <rect width={180} height={18} fill={loopPhase==="WRITING"||loopPhase==="DONE"?"#001a0a":"#040810"} stroke="#081828" strokeWidth="0.5"/>
                  <text x={6} y={12} fontSize="7" fill={loopPhase==="DONE"?"#22c55e":"#1e3a50"} letterSpacing="1">
                    APPEND-ONLY · NEVER OVERWRITE · {loopPhase}
                  </text>
                </g>
              </g>
            </SpecBox>

            {/* VAMA + ROLLBACK */}
            <SpecBox x={OPT_X-110} y={930} w={230} h={140} title="🌀 VAMA + ROLLBACK" color="#818cf8">
              <g transform="translate(8,22)">
                {[["HIGH VOL","Slow weight shifts","Anti-chase filter"],
                  ["CLEAN TREND","Fast weight shifts","Capture immediate α"],
                  ["ROLLBACK >15%","Auto is_valid=0","Fall back to prior"],
                ].map(([title,desc1,desc2],i)=>(
                  <g key={i} transform={`translate(0,${i*38})`}>
                    <rect width={208} height={32} fill="#040810" stroke="#0d1f38" strokeWidth="0.5" rx="2"/>
                    <text x={6} y={12} fontSize="8" fill="#818cf8" fontFamily={FONT_DISPLAY} fontWeight="700" letterSpacing="1">{title}</text>
                    <text x={6} y={22} fontSize="6.5" fill="#1e3a50">{desc1} · {desc2}</text>
                  </g>
                ))}
              </g>
            </SpecBox>

            {/* HEARTBEAT CONTRACT */}
            <SpecBox x={OPT_X-110} y={1090} w={230} h={120} title="💓 HEARTBEAT CONTRACT" color="#22c55e">
              <g transform="translate(8,22)">
                {[["LIVE","< 15s","#22c55e","Evaluate normally"],
                  ["STALE","15-60s","#f59e0b","Flatten if breach"],
                  ["DEAD","> 60s","#ef4444","IMMEDIATE FLAT ALL"],
                ].map(([state,time,c,action],i)=>(
                  <g key={state} transform={`translate(0,${i*30})`}>
                    <rect width={208} height={24} fill={`${c}12`} stroke={`${c}44`} strokeWidth="0.8" rx="2"/>
                    <rect width={3} height={24} fill={c} rx="1"/>
                    <text x={10} y={14} fontSize="8" fill={c} fontFamily={FONT_DISPLAY} fontWeight="700" letterSpacing="2">{state}</text>
                    <text x={52} y={14} fontSize="7" fill="#3a5a6a">{time}</text>
                    <text x={100} y={14} fontSize="7" fill={c} opacity="0.8">{action}</text>
                  </g>
                ))}
                <g transform="translate(0,92)">
                  <text fontSize="7" fill="#0a2030" letterSpacing="1">DEAD = UNCONDITIONAL FLAT · NO OVERRIDE</text>
                </g>
              </g>
            </SpecBox>
          </>}

          {/* ═════════════════════════════════════════════════ */}
          {/* ── EDGES: SYS BOX → JEDI ──                      */}
          {/* ═════════════════════════════════════════════════ */}
          {(view==="FULL"||view==="SPEC")&&<>
            <path d={hbez(250,500,JEDI_X-80,130)} fill="none" stroke="#818cf8" strokeWidth="0.8" strokeDasharray="6,4" opacity="0.25" markerEnd="url(#aS)"/>
            <path d={hbez(250,730,JEDI_X-80,140)} fill="none" stroke="#22d3ee" strokeWidth="0.8" strokeDasharray="6,4" opacity="0.2" markerEnd="url(#aB)"/>
          </>}

          {/* OPT LOOP → JEDI */}
          {(view==="FULL"||view==="LOOP")&&<>
            <path d={hbez(OPT_X-110,440,JEDI_X+80,130)} fill="none" stroke="#f59e0b" strokeWidth="0.8" strokeDasharray="6,4" opacity="0.25" markerEnd="url(#aJ)"/>
          </>}

          {/* ═════════════════════════════════════════════════ */}
          {/* ── EDGES: JEDI → COUNCILS ──                      */}
          {/* ═════════════════════════════════════════════════ */}
          {[{to:{x:CA_X,y:COUNCIL_Y},col:"#22d3ee",m:"aB"},{to:{x:CB_X,y:COUNCIL_Y},col:"#f59e0b",m:"aJ"},{to:{x:CC_X,y:COUNCIL_Y},col:"#4ade80",m:"aL"}].map(({to,col,m},i)=>(
            <g key={`je${i}`}>
              <path d={bez(JEDI_X,JEDI_Y+62,to.x,COUNCIL_Y-30)} fill="none" stroke={col} strokeWidth="1.5" strokeDasharray="8,5" opacity="0.45" markerEnd={`url(#${m})`}/>
              <path d={bez(JEDI_X,JEDI_Y+62,to.x,COUNCIL_Y-30)} fill="none" stroke={col} strokeWidth="6" opacity="0.03"/>
            </g>
          ))}

          {/* ── EDGES: COUNCILS → ALGOS ── */}
          {[{council:{x:CA_X,y:COUNCIL_Y},grid:GRID_A,col:"#22d3ee",m:"aB"},
            {council:{x:CB_X,y:COUNCIL_Y},grid:GRID_B,col:"#818cf8",m:"aS"},
            {council:{x:CC_X,y:COUNCIL_Y},grid:GRID_C,col:"#4ade80",m:"aL"},
          ].map(({council,grid,col,m},bi)=>
            grid.map((a,i)=>{
              const v=votes[a.id]??0;
              const ec=v===1?"#22d3ee":v===-1?"#ef4444":col;
              return(
                <path key={`ce-${bi}-${i}`}
                  d={bez(council.x,council.y+28,a.x+ALGO_W/2,a.y,0.4)}
                  fill="none" stroke={ec} strokeWidth={v!==0?"1":"0.5"}
                  opacity={v!==0?0.45:0.1} markerEnd={`url(#${m})`}/>
              );
            })
          )}

          {/* ── ALGO NODES → SCORE OUTPUT ── */}
          {ALL_GRIDS.filter(a=>votes[a.id]!==0).map(a=>(
            <line key={`ao-${a.id}`}
              x1={a.x+ALGO_W/2} y1={a.y+ALGO_H}
              x2={JEDI_X} y2={SCORE_Y-20}
              stroke={votes[a.id]===1?"#22d3ee":"#ef4444"}
              strokeWidth="0.4" opacity="0.08"/>
          ))}

          {/* ── 27 ALGO NODES ── */}
          {ALL_GRIDS.map(a=>(
            <AlgoNode key={a.id} a={a} vote={votes[a.id]??0} str={strengths[a.id]??0.5}
              sel={selected===a.id} onClick={()=>setSelected(s=>s===a.id?null:a.id)}/>
          ))}

          {/* ── COUNCIL NODES ── */}
          <CouncilNode x={CA_X} y={COUNCIL_Y} label="⚔️ BOOM STRENGTH" sub="Bank A · 9 Entry Algos" color="#22d3ee" long={aLong} short={aShort}/>
          <CouncilNode x={CB_X} y={COUNCIL_Y} label="🗡️ ALGO STRATEGIES" sub="Bank B · 9 Structure Algos" color="#818cf8" long={bLong} short={bShort}/>
          <CouncilNode x={CC_X} y={COUNCIL_Y} label="🏆 LEGEND SURFACE" sub="Bank C · 9 Legend Traders" color="#4ade80" long={cLong} short={cShort}/>

          <JediOrb x={JEDI_X} y={JEDI_Y} score={score} dir={dir} dirCol={dirCol} tick={tick} str={strengths.jedi??0.9}/>

          <ScoreOutput x={JEDI_X} y={SCORE_Y} score={score} dir={dir} dirCol={dirCol}
            regime={regime} aLong={aLong} aShort={aShort}
            bLong={bLong} bShort={bShort}
            cLong={cLong} cShort={cShort}/>

          {view!=="LOOP"&&<>
            <SectionLabel x={CA_X} y={ALGO_Y_BASE-28} color="#22d3ee" label="BANK A · BOOM STRENGTH SABRES"/>
            <SectionLabel x={CB_X} y={ALGO_Y_BASE-28} color="#818cf8" label="BANK B · ALGORITHM STRATEGY SWORDS"/>
            <SectionLabel x={CC_X} y={ALGO_Y_BASE-28} color="#4ade80" label="BANK C · LEGEND TRADER SURFACE"/>
          </>}

          {/* OPT LOOP LABEL */}
          {view!=="SPEC"&&(
            <text x={OPT_X} y={355} textAnchor="middle" fontSize="9" fill="#f59e0b" fontFamily={FONT_DISPLAY} fontWeight="700" letterSpacing="4" opacity="0.6">OPT LOOP ENGINE</text>
          )}
          {view!=="LOOP"&&(
            <text x={SYS_X+110} y={355} textAnchor="middle" fontSize="9" fill="#818cf8" fontFamily={FONT_DISPLAY} fontWeight="700" letterSpacing="4" opacity="0.6">SYSTEM SPEC</text>
          )}

          {/* ═══════════════════════════════════════════════ */}
          {/* ── RECURSIVE LOOP FLOW BANNER ──                */}
          {/* ═══════════════════════════════════════════════ */}
          <LoopBanner y={1260} score={score} dir={dir} dirCol={dirCol} loopPhase={loopPhase}/>

        </svg>
      </div>

      {/* ── INSPECTOR PANEL ── */}
      {selected&&(()=>{
        const algo=ALL_GRIDS.find(a=>a.id===selected);
        if(!algo)return null;
        return (
          <div style={{position:"absolute",bottom:10,right:10,width:270,zIndex:300,background:"#030610",border:`1px solid ${algo.color}55`,padding:"12px 14px",boxShadow:`0 0 28px ${algo.color}22`}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <span style={{fontSize:22}}>{algo.icon}</span>
              <div>
                <div style={{fontFamily:FONT_DISPLAY,fontSize:14,fontWeight:700,color:algo.color,letterSpacing:2}}>{algo.name}</div>
                <div style={{fontSize:8,color:"#1e3a50",letterSpacing:1}}>{algo.sub}</div>
              </div>
              <button onClick={()=>setSelected(null)} style={{marginLeft:"auto",background:"none",border:"none",color:"#1e3a50",cursor:"pointer",fontSize:14}}>✕</button>
            </div>
            <div style={{fontSize:8,color:"#3a5a6a",lineHeight:1.9,marginBottom:8}}>{algo.method}</div>
            {algo.horizon&&<div style={{fontSize:8,color:"#4ade80",letterSpacing:2,marginBottom:8}}>⌛ HORIZON: {algo.horizon}</div>}
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:9,color:vCol(votes[algo.id],"#2a3a4a"),letterSpacing:1}}>
                {votes[algo.id]===1?"▲ LONG":votes[algo.id]===-1?"▼ SHORT":"■ FLAT"}
              </span>
              <div style={{flex:1,height:2,background:"#081828"}}>
                <div style={{height:"100%",width:`${(strengths[algo.id]??0.5)*100}%`,background:algo.color,transition:"width 0.5s"}}/>
              </div>
              <span style={{fontSize:8,color:"#1e3a50"}}>{Math.round((strengths[algo.id]??0.5)*100)}%</span>
            </div>
          </div>
        );
      })()}

      {/* LEGEND */}
      <div style={{position:"absolute",bottom:10,left:10,zIndex:300,background:"#030610",border:"1px solid #081828",padding:"6px 12px",display:"flex",gap:14,alignItems:"center"}}>
        {[["▲ LONG","#22d3ee"],["▼ SHORT","#ef4444"],["■ FLAT","#2a3a4a"],["BOOM","#22d3ee"],["STRAT","#818cf8"],["LEGEND","#4ade80"],["JEDI","#f59e0b"],["SPEC","#818cf8"],["LOOP","#f59e0b"]].map(([l,c])=>(
          <div key={l} style={{fontSize:7,color:c,letterSpacing:1}}>{l}</div>
        ))}
        <div style={{width:1,height:12,background:"#081828"}}/>
        <div style={{fontSize:7,color:"#0a2030",letterSpacing:1}}>TICK {tick} · SCORE {score>0?"+":""}{score} · {dir}</div>
      </div>
    </div>
  );
}

// ── JEDI ORB ─────────────────────────────────────────────────────────────────
function JediOrb({x,y,score,dir,dirCol,tick,str}) {
  const R=68, pulse=0.85+Math.sin(tick*0.25)*0.15;
  return (
    <g transform={`translate(${x},${y})`} filter="url(#glow)" style={{cursor:"default"}}>
      {/* OUTER PULSE RINGS */}
      {[R+36,R+22,R+10].map((r,i)=>(
        <circle key={r} r={r} fill="none" stroke="#f59e0b" strokeWidth="0.5"
          opacity={(0.06+i*0.04)*pulse}
          strokeDasharray={i===0?"12,8":i===1?"6,4":"3,3"}/>
      ))}
      {/* BODY */}
      <circle r={R} fill="#03050d" stroke="#f59e0b" strokeWidth="1.8" opacity="0.97"/>
      <circle r={R*0.82} fill="none" stroke="#f59e0b" strokeWidth="0.5" opacity="0.12" strokeDasharray="4,4"/>
      <circle r={R*0.6} fill="none" stroke="#f59e0b" strokeWidth="0.3" opacity="0.08"/>
      {/* INNER AMBER GLOW */}
      <circle r={R*0.75} fill="#f59e0b" opacity={0.03*str}/>
      {/* ORBIT ARCS */}
      <ellipse rx={R+12} ry={16} fill="none" stroke="#f59e0b" strokeWidth="0.6" opacity="0.14"
        transform={`rotate(${tick*1.4})`} strokeDasharray="40,20"/>
      <ellipse rx={R+16} ry={10} fill="none" stroke="#f59e0b" strokeWidth="0.4" opacity="0.1"
        transform={`rotate(${-tick*0.9+45})`} strokeDasharray="25,35"/>
      {/* CROSS TICKS */}
      {[0,45,90,135,180,225,270,315].map(a=>{
        const r1=(a%90===0)?R-2:R+2, r2=(a%90===0)?R+10:R+6;
        return <line key={a} x1={Math.cos(a*Math.PI/180)*r1} y1={Math.sin(a*Math.PI/180)*r1}
          x2={Math.cos(a*Math.PI/180)*r2} y2={Math.sin(a*Math.PI/180)*r2}
          stroke="#f59e0b" strokeWidth={a%90===0?"1.5":"0.8"} opacity={a%90===0?0.7:0.3}/>;
      })}
      {/* LABELS */}
      <text y={-26} textAnchor="middle" fontSize="8" fill="#f59e0b" letterSpacing="3" fontFamily={FONT_MONO} fontWeight="700">JEDI MASTER</text>
      <text y={-14} textAnchor="middle" fontSize="6.5" fill="#7a5000" letterSpacing="2" fontFamily={FONT_MONO}>MTF · SITE AUTHORITY</text>
      {/* SCORE */}
      <text y={8} textAnchor="middle" fontFamily={FONT_DISPLAY} fontSize="26" fontWeight="900"
        fill={dirCol} letterSpacing="2" style={{filter:`drop-shadow(0 0 6px ${dirCol})`}}>
        {score>0?"+":""}{score}
      </text>
      <text y={24} textAnchor="middle" fontFamily={FONT_DISPLAY} fontSize="11" fontWeight="700"
        fill={dirCol} letterSpacing="5" opacity="0.8">{dir}</text>
      {/* THRESHOLD MARKERS */}
      <text y={38} textAnchor="middle" fontSize="6" fill="#2a3a4a" letterSpacing="1">±7 THRESHOLD · ±21 MAX</text>
    </g>
  );
}

// ── COUNCIL NODE ─────────────────────────────────────────────────────────────
function CouncilNode({x,y,label,sub,color,long,short}) {
  const flat=9-long-short, W=200, H=60;
  return (
    <g transform={`translate(${x-W/2},${y-H/2})`} filter="url(#softglow)">
      <rect width={W} height={H} fill="#030712" stroke={color} strokeWidth="1.2" rx="3"/>
      <rect width={W} height={3} fill={color} opacity="0.7" rx="1"/>
      <text x={W/2} y={18} textAnchor="middle" fontFamily={FONT_DISPLAY} fontSize="12" fontWeight="700"
        fill={color} letterSpacing="2">{label}</text>
      <text x={W/2} y={30} textAnchor="middle" fontFamily={FONT_MONO} fontSize="7"
        fill="#1e3a50" letterSpacing="1">{sub}</text>
      {/* VOTE BAR */}
      <rect x={6} y={36} width={W-12} height={8} fill="#020408" stroke="#081828" strokeWidth="0.4"/>
      <rect x={6} y={36} width={(long/9)*(W-12)} height={8} fill="#22d3ee" opacity="0.55"/>
      <rect x={6+(long/9)*(W-12)} y={36} width={(flat/9)*(W-12)} height={8} fill="#1e3a50" opacity="0.2"/>
      <rect x={6+((long+flat)/9)*(W-12)} y={36} width={(short/9)*(W-12)} height={8} fill="#ef4444" opacity="0.55"/>
      <text x={8} y={52} fontFamily={FONT_DISPLAY} fontSize="9" fontWeight="700" fill="#22d3ee">{long}L</text>
      <text x={W/2} y={52} textAnchor="middle" fontFamily={FONT_DISPLAY} fontSize="9" fill="#1e3a50">{flat}F</text>
      <text x={W-6} y={52} textAnchor="end" fontFamily={FONT_DISPLAY} fontSize="9" fontWeight="700" fill="#ef4444">{short}S</text>
    </g>
  );
}

// ── ALGO NODE ─────────────────────────────────────────────────────────────────
function AlgoNode({a,vote,str,sel,onClick}) {
  const bc=vote===1?"#22d3ee":vote===-1?"#ef4444":"#081828";
  const vc=vote===1?"#22d3ee":vote===-1?"#ef4444":"#1e3a50";
  const vi=vote===1?"▲":vote===-1?"▼":"■";
  return (
    <g transform={`translate(${a.x},${a.y})`} onClick={onClick} style={{cursor:"pointer"}}
      filter={vote!==0?"url(#softglow)":"none"}>
      {/* VOTE GLOW HALO */}
      {vote!==0&&<rect x={-3} y={-3} width={ALGO_W+6} height={ALGO_H+6} fill={vc} opacity={str*0.08} rx="4"/>}
      {/* BODY */}
      <rect width={ALGO_W} height={ALGO_H} fill="#030712"
        stroke={sel?a.color:bc} strokeWidth={sel?"1.5":"0.8"} rx="2" clipPath="url(#nodeClip)"/>
      {/* STRENGTH FILL */}
      <rect width={ALGO_W*str} height={ALGO_H} fill={a.color} opacity={0.04} rx="2"/>
      {/* TOP ACCENT */}
      <rect width={ALGO_W} height={vote!==0?2.5:1} fill={vote!==0?vc:a.color} opacity={vote!==0?0.9:0.25} rx="1"/>
      {/* ICON */}
      <text x={6} y={20} fontSize="16" opacity="0.9">{a.icon}</text>
      {/* NAME */}
      <text x={28} y={16} fontFamily={FONT_DISPLAY} fontSize="9.5" fontWeight="700"
        fill={vote!==0?vc:a.color} letterSpacing="0.8" opacity={vote!==0?1:0.55}>{a.name}</text>
      {/* SUB */}
      <text x={28} y={27} fontFamily={FONT_MONO} fontSize="6.5" fill="#1e3a50" letterSpacing="0.3">{a.sub}</text>
      {/* VOTE ICON */}
      <text x={ALGO_W-6} y={20} textAnchor="end" fontFamily={FONT_DISPLAY} fontSize="20" fontWeight="900"
        fill={vc} style={{filter:vote!==0?`drop-shadow(0 0 3px ${vc})`:"none"}}>{vi}</text>
      {/* STRENGTH BAR */}
      <rect x={6} y={34} width={ALGO_W-12} height={2} fill="#0a1828"/>
      <rect x={6} y={34} width={(ALGO_W-12)*str} height={2} fill={vote!==0?vc:a.color} opacity="0.65"/>
      {/* HORIZON */}
      {a.horizon&&<text x={6} y={48} fontSize="6.5" fill="#4ade80" letterSpacing="1">⌛ {a.horizon}</text>}
      {/* METHOD SNIPPET */}
      <text x={6} y={a.horizon?60:50} fontSize="6" fill="#0d2030" letterSpacing="0.3">
        {a.method.slice(0,38)}{a.method.length>38?"…":""}
      </text>
      {/* SLOT */}
      <text x={ALGO_W-4} y={ALGO_H-4} textAnchor="end" fontSize="6" fill="#0a1828">{a.id}</text>
    </g>
  );
}

// ── SCORE OUTPUT ──────────────────────────────────────────────────────────────
function ScoreOutput({x,y,score,dir,dirCol,regime,aLong,aShort,bLong,bShort,cLong,cShort}) {
  const W=560, H=100;
  return (
    <g transform={`translate(${x-W/2},${y})`}>
      {/* OUTER GLOW */}
      <rect x={-8} y={-8} width={W+16} height={H+16} fill={dirCol} opacity="0.03" rx="6"/>
      <rect width={W} height={H} fill="#030712" stroke={dirCol} strokeWidth="1.2" rx="4"/>
      <rect width={W} height={3} fill={dirCol} opacity="0.6" rx="2"/>
      {/* SCORE */}
      <text x={W/2} y={38} textAnchor="middle" fontFamily={FONT_DISPLAY} fontSize="40" fontWeight="900"
        fill={dirCol} letterSpacing="4"
        style={{ fontVariantNumeric: "tabular-nums", filter: `drop-shadow(0 0 10px ${dirCol}88)` }}>
        {score>0?"+":""}{score}
      </text>
      <text x={W/2} y={56} textAnchor="middle" fontFamily={FONT_DISPLAY} fontSize="12" fontWeight="700"
        fill={dirCol} letterSpacing="6" opacity="0.8">{dir}</text>
      {/* THRESHOLD BAR */}
      <rect x={20} y={62} width={W-40} height={4} fill="#020408" stroke="#081828" strokeWidth="0.5"/>
      <rect x={W/2-4} y={61} width={2} height={6} fill="#2a3a4a"/>
      {/* Score position */}
      <rect x={W/2+Math.max(-W/2+20,Math.min(W/2-20,(score/21)*(W/2-20)))-6} y={61} width={12} height={6} fill={dirCol} opacity="0.8" rx="1"/>
      <text x={22} y={74} fontSize="7" fill="#1e3a50">−21</text>
      <text x={W/2-8} y={74} fontSize="7" fill="#2a3a4a">0</text>
      <text x={W-28} y={74} fontSize="7" fill="#1e3a50">+21</text>
      <text x={W/2-70} y={74} fontSize="7" fill="#ef4444" opacity="0.6">SHORT ≤−7</text>
      <text x={W/2+20} y={74} fontSize="7" fill="#22d3ee" opacity="0.6">LONG ≥+7</text>
      {/* BANK TALLIES */}
      {[["A","#22d3ee",aLong,aShort,60],["B","#818cf8",bLong,bShort,230],["C","#4ade80",cLong,cShort,400]].map(([lbl,c,l,s,ox])=>(
        <g key={lbl} transform={`translate(${ox},80)`}>
          <text fontSize="7" fill={c} letterSpacing="1">BANK {lbl}</text>
          <text x={46} fontSize="7" fill="#22d3ee">{l}L</text>
          <text x={66} fontSize="7" fill="#1e3a50">/</text>
          <text x={72} fontSize="7" fill="#ef4444">{s}S</text>
        </g>
      ))}
    </g>
  );
}

// ── LOOP BANNER ───────────────────────────────────────────────────────────────
function LoopBanner({y,score,dir,dirCol,loopPhase}) {
  const nodes=[
    ["EXECUTION","👾",dirCol],["🦞 MEMORY","🦞","#22d3ee"],
    ["RECURSIVE OPT","🔁","#818cf8"],["RE-RANK","⚔️","#f59e0b"],
    ["FEEDBACK","📡","#4ade80"]
  ];
  const W=CW-300, startX=150, nodeW=180, gap=(W-nodeW*nodes.length)/(nodes.length-1);
  return (
    <g transform={`translate(0,${y})`}>
      <rect x={startX} y={0} width={W} height={80} fill="#030712" stroke="#081828" strokeWidth="0.8" rx="4"/>
      <text x={startX+W/2} y={-12} textAnchor="middle" fontSize="8" fill="#1e3a50" fontFamily={FONT_DISPLAY} fontWeight="700" letterSpacing="4">
        🔁 SYSTEM EXECUTION LOOP
      </text>
      {nodes.map(([label,icon,col],i)=>{
        const nx=startX+i*(nodeW+gap);
        const active=label==="RECURSIVE OPT"&&loopPhase!=="IDLE"||label==="EXECUTION"&&dir!=="FLAT";
        return (
          <g key={label} transform={`translate(${nx},0)`}>
            <rect width={nodeW} height={80} fill={active?`${col}08`:"#020408"} stroke={active?col:"#081828"} strokeWidth={active?"1":"0.5"} rx="3"/>
            {active&&<rect width={nodeW} height={2} fill={col} opacity="0.7"/>}
            <text x={nodeW/2} y={24} textAnchor="middle" fontSize="18">{icon}</text>
            <text x={nodeW/2} y={44} textAnchor="middle" fontFamily={FONT_DISPLAY} fontSize="10" fontWeight="700" fill={active?col:"#1e3a50"} letterSpacing="1">{label}</text>
            {i<nodes.length-1&&(
              <path d={`M${nodeW+2},40 L${nodeW+gap-2},40`} fill="none" stroke={col} strokeWidth="1" strokeDasharray="4,3" markerEnd={`url(#a${col==="#22d3ee"?"B":col==="#818cf8"?"S":col==="#f59e0b"?"J":"L"})`} opacity="0.5"/>
            )}
          </g>
        );
      })}
    </g>
  );
}

// ── SPEC BOX ─────────────────────────────────────────────────────────────────
function SpecBox({x,y,w,h,title,color,children}) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width={w} height={h} fill="#030712" stroke={color} strokeWidth="0.8" rx="3" opacity="0.95"/>
      <rect width={w} height={2} fill={color} opacity="0.5" rx="1"/>
      <text x={8} y={14} fontFamily={FONT_DISPLAY} fontSize="9" fontWeight="700" fill={color} letterSpacing="2">{title}</text>
      <line x1={4} y1={18} x2={w-4} y2={18} stroke={color} strokeWidth="0.3" opacity="0.3"/>
      <g transform="translate(0,2)">{children}</g>
    </g>
  );
}

// ── SECTION LABEL ────────────────────────────────────────────────────────────
function SectionLabel({x,y,color,label}) {
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" fontFamily={FONT_DISPLAY} fontSize="10" fontWeight="700"
        fill={color} letterSpacing="3" opacity="0.5">{label}</text>
    </g>
  );
}
