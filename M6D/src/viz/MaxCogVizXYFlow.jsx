import { useState, useEffect, useCallback, useRef } from "react";
import { PriceOrb, RiskOrb, ConfluenceOrb, VolumeOrb, TVWebhookOrb } from "./MaxCogVizOrbsII";

// MISSION bundled copy — source of truth: `spec-kit/M4D_ALGOSX3_MaxCogViz_XYFlow.jsx`
// (re-copy after edits; embedded with `height:100%` + non-fixed scanlines for app shell.)

// ═══════════════════════════════════════════════════════════════
// M4D · MAXCOGVIZ · WARRIOR SYSTEM DIAGRAM
// Jedi Orb → 3 Councils → 9+9+9 Algo Grid
// ═══════════════════════════════════════════════════════════════

// ── PALETTE ──────────────────────────────────────────────────────
const C = {
  bg:       "#03050a",
  bg1:      "#070c14",
  bg2:      "#0a1020",
  border:   "#0f2030",
  jedi:     "#f59e0b",
  boom:     "#22d3ee",
  strat:    "#818cf8",
  legend:   "#4ade80",
  red:      "#ef4444",
  muted:    "#1e3a50",
  text:     "#5a8090",
  textHi:   "#a0c8d8",
};

// ── ALGORITHM DEFINITIONS ────────────────────────────────────────
const JEDI = {
  id: "jedi", label: "JEDI MASTER", sub: "Multi-Timeframe Alignment",
  desc: "Daily/Weekly/Quarterly Bias · Liquidity Draw · Structure Gate",
  color: C.jedi, tier: "JEDI",
  signals: ["MTF Bias","Quarterly Draw","Structure Break","Liquidity Pool"],
};

const COUNCIL_A = {
  id: "cA", label: "BOOM STRENGTH", sub: "Bank A · 9 Algos",
  desc: "Entry Precision · Real-time Execution Signals",
  color: C.boom,
};

const COUNCIL_B = {
  id: "cB", label: "ALGO STRATEGIES", sub: "Bank B · 9 Algos",
  desc: "Structural Alignment · Session Positioning",
  color: C.strat,
};

const COUNCIL_C = {
  id: "cC", label: "YT LEGEND SURFACE", sub: "Bank C · 9 Algos",
  desc: "1–3–6 Month Trade Surfacing · Alignment Required",
  color: C.legend,
};

const ALGOS_A = [
  { id:"NS", name:"NIALL SPIKE",    sub:"Vol Delta Explosion",      color:C.boom, method:"Ask-delta σ spike on 1m/5m. Institutional absorption." },
  { id:"CI", name:"CYBER-ICT",      sub:"OB Heatseeker",            color:"#a78bfa", method:"Auto-detect OB/FVG/Breaker on 15m+1H. Return entry." },
  { id:"BQ", name:"BANSHEE SQUEEZE",sub:"TTM Momentum Release",     color:"#f43f5e", method:"BB inside KC = squeeze. First expansion bar fires." },
  { id:"CC", name:"CELTIC CROSS",   sub:"EMA Ribbon Alignment",     color:"#4ade80", method:"8/21/34/55/89 full bullish stack. Partial = fractional." },
  { id:"WH", name:"WOLFHOUND",      sub:"Scalp Velocity",           color:"#fb923c", method:"3 consecutive accel bars + expanding range." },
  { id:"SA", name:"STONE ANCHOR",   sub:"Volume Profile VP/VPOC",   color:"#94a3b8", method:"VPOC slope + HVN/LVN proximity scoring." },
  { id:"HK", name:"HIGH KING",      sub:"Opening Range Bias",       color:"#fbbf24", method:"ORB 5/30min. PDH/PDL macro filter." },
  { id:"GO", name:"GALLOWGLASS OB", sub:"Aggressive OB Retest",     color:"#c084fc", method:"3× vol displacement. 50% OB retrace entry." },
  { id:"EF", name:"EMERALD FLOW",   sub:"Money Flow MFI",           color:"#34d399", method:"MFI(14) cross 50. Divergence = reversal flag." },
];

const ALGOS_B = [
  { id:"8E", name:"8-EMA RIBBON",   sub:"Trend Momentum Gate",      color:"#67e8f9", method:"Price vs 8EMA. Ribbon width = momentum score 0-10." },
  { id:"VT", name:"VEGA TRAP",      sub:"Options Gamma Squeeze",    color:"#818cf8", method:"Max pain, gamma walls, dealer hedging flow." },
  { id:"MS", name:"MARKET SHIFT",   sub:"CHoCH / BOS Detector",     color:"#f97316", method:"Structure change on 15m/1H with volume confirm." },
  { id:"DP", name:"DARK POOL",      sub:"Institutional Prints",     color:"#e879f9", method:"DP ratio anomaly >2× avg at key technical levels." },
  { id:"WS", name:"WYCKOFF SPRING", sub:"Accum Phase Detector",     color:"#fde68a", method:"SC/AR/ST/Spring/LPS/LPSY phase confidence scoring." },
  { id:"RV", name:"RENKO VAULT",    sub:"Noise-Filtered Trend",     color:"#86efac", method:"1×ATR bricks. 3 consecutive bullish = long signal." },
  { id:"HL", name:"HARMONIC LENS",  sub:"Gartley/Bat/Butterfly PRZ",color:"#f0abfc", method:"PRZ completion ±0.5% + RSI divergence confirm." },
  { id:"AI", name:"ALPHA IMBALANCE",sub:"FVG Fill Probability",     color:"#a5f3fc", method:"FVG catalog by age+proximity+vol. 70th pct threshold." },
  { id:"VK", name:"VOLKOV KELTNER", sub:"Keltner Breakout",         color:"#60a5fa", method:"KC breakout with vol surge. ATR trail management." },
];

const ALGOS_C = [
  { id:"SE", name:"STOCKBEE EP",    sub:"Episodic Pivot 3×Vol",     color:"#4ade80", method:"Gap-up 3×avg vol + catalyst. 20-30% target 1-3M.", horizon:"1-3M" },
  { id:"IC", name:"ICT WEEKLY FVG", sub:"Virgin FVG Displacement",  color:"#a78bfa", method:"Weekly virgin FVG never touched. Monthly draw align.", horizon:"1-3M" },
  { id:"WN", name:"WEINSTEIN STAGE",sub:"Stage 2 Base Breakout",    color:"#fbbf24", method:"6-month base + vol expansion above 30W MA.", horizon:"3-6M" },
  { id:"CA", name:"CASPER IFVG",    sub:"Inverse FVG Deep Draw",    color:"#f9a8d4", method:"Quarterly IFVG as price target. Void depth scoring.", horizon:"3-6M" },
  { id:"TF", name:"TTRADES FRACTAL",sub:"MTF Fractal Swing",        color:"#fb923c", method:"HH/HL daily+weekly+monthly alignment. Fib targets.", horizon:"1-6M" },
  { id:"RT", name:"RAYNER TREND",   sub:"200MA Pullback Entry",     color:"#34d399", method:"200MA up-slope + 50EMA pullback. Min 1:3 RR.", horizon:"1-3M" },
  { id:"MM", name:"MINERVINI VCP",  sub:"Volatility Contraction",   color:"#67e8f9", method:"Progressive tighter bases 33% each. Pivot breakout.", horizon:"3-6M" },
  { id:"OR", name:"O'NEIL BREAKOUT",sub:"CAN SLIM Cup & Handle",    color:"#e879f9", method:"EPS accel + RS>80 + 40% vol pivot breakout.", horizon:"3-6M" },
  { id:"DV", name:"DRAGONFLY VOL",  sub:"Sector Rotation RS",       color:"#fde68a", method:"RS line 52W high + institutional sector accumulation.", horizon:"1-6M" },
];

// ── LAYOUT CONSTANTS ──────────────────────────────────────────────
const W = 1400;
const H = 900;

// Node positions
const JEDI_POS   = { x: W/2, y: 90 };

const COUNCIL_POSITIONS = {
  cA: { x: W*0.18, y: 280 },
  cB: { x: W*0.50, y: 280 },
  cC: { x: W*0.82, y: 280 },
};

function algoPositions(councilX, algos) {
  const cols = 3;
  return algos.map((a, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const startX = councilX - 200;
    const x = startX + col * 140;
    const y = 460 + row * 130;
    return { ...a, x, y };
  });
}

const ALGOS_A_POS = algoPositions(COUNCIL_POSITIONS.cA.x, ALGOS_A);
const ALGOS_B_POS = algoPositions(COUNCIL_POSITIONS.cB.x, ALGOS_B);
const ALGOS_C_POS = algoPositions(COUNCIL_POSITIONS.cC.x, ALGOS_C);

// ── VOTE / STRENGTH SIM ───────────────────────────────────────────
function randVote() { return [-1,-1,0,0,0,1,1][Math.floor(Math.random()*7)]; }
function randStr()  { return 0.2 + Math.random() * 0.8; }

function initState() {
  const v = {}, s = {};
  [...ALGOS_A, ...ALGOS_B, ...ALGOS_C, JEDI].forEach(a => {
    v[a.id] = randVote();
    s[a.id] = randStr();
  });
  v["jedi"] = 1;
  s["jedi"] = 0.9;
  return { v, s };
}

function voteColor(v, def) {
  if (v === 1)  return "#22d3ee";
  if (v === -1) return "#ef4444";
  return def || "#1e3a50";
}

function heatGlow(vote, strength, color) {
  if (vote === 0) return "none";
  const base = vote === 1 ? "#22d3ee" : "#ef4444";
  const spread = Math.round(strength * 20);
  return `0 0 ${spread}px ${base}55, 0 0 ${spread*2}px ${base}22`;
}

function scoreFromVotes(v) {
  const j = (v["jedi"]??0)*8;
  const aSum = ALGOS_A.reduce((a,al)=>(a+(v[al.id]??0)),0)*0.84;
  const bSum = ALGOS_B.reduce((a,al)=>(a+(v[al.id]??0)),0)*0.84;
  const cSum = ALGOS_C.reduce((a,al)=>(a+(v[al.id]??0)),0)*0.42;
  return +((j+aSum*0.5+bSum*0.5+cSum)).toFixed(1);
}

// ── SVG ARROW HELPERS ─────────────────────────────────────────────
function cubicPath(x1,y1,x2,y2) {
  const dx = Math.abs(x2-x1)*0.4;
  const dy = Math.abs(y2-y1)*0.5;
  return `M${x1},${y1} C${x1},${y1+dy} ${x2},${y2-dy} ${x2},${y2}`;
}

function straightPath(x1,y1,x2,y2) {
  const mx = (x1+x2)/2, my = (y1+y2)/2;
  return `M${x1},${y1} Q${x1},${my} ${mx},${my} Q${x2},${my} ${x2},${y2}`;
}

// ── MAIN COMPONENT ────────────────────────────────────────────────
export default function MaxCogVizFlow() {
  const [{ v: votes, s: strengths }, setState] = useState(initState);
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState(null);
  const [regime, setRegime] = useState("LOW_VOL");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.82);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const svgRef = useRef();
  const viewportRef = useRef();
  const didCenterRef = useRef(false);

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
    centerOn(W / 2, 420, zoom);
  }, [centerOn, zoom]);

  useEffect(() => {
    const iv = setInterval(() => {
      setTick(t => t+1);
      setState(prev => {
        const nv = { ...prev.v };
        const ns = { ...prev.s };
        const all = [...ALGOS_A,...ALGOS_B,...ALGOS_C];
        for (let i=0;i<5;i++) {
          const a = all[Math.floor(Math.random()*all.length)];
          nv[a.id] = randVote();
        }
        all.forEach(a => {
          ns[a.id] = Math.max(0.1, Math.min(0.99, prev.s[a.id]+(Math.random()-0.5)*0.1));
        });
        ns["jedi"] = 0.85 + Math.random()*0.14;
        return { v: nv, s: ns };
      });
      if (Math.random()<0.02) {
        setRegime(["LOW_VOL","LOW_VOL","HIGH_VOL","FOMC_FLAT"][Math.floor(Math.random()*4)]);
      }
    }, 900);
    return () => clearInterval(iv);
  }, []);

  const score = scoreFromVotes(votes);
  const direction = score>=7?"LONG":score<=-7?"SHORT":"FLAT";
  const dirCol = direction==="LONG"?"#22d3ee":direction==="SHORT"?"#ef4444":"#3a5a6a";
  const totalAbsVotes = [...ALGOS_A, ...ALGOS_B, ...ALGOS_C]
    .reduce((sum, algo) => sum + Math.abs(votes[algo.id] ?? 0), 0);

  // Pan/zoom handlers
  const onWheel = useCallback(e => {
    e.preventDefault();
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setZoom((z) => {
      const next = Math.max(0.3, Math.min(2, z - e.deltaY * 0.001));
      const left = -pan.x / z;
      const top = -pan.y / z;
      const worldX = left + (sx / rect.width) * (W / z);
      const worldY = top + (sy / rect.height) * (H / z);
      const nextLeft = worldX - (sx / rect.width) * (W / next);
      const nextTop = worldY - (sy / rect.height) * (H / next);
      setPan({ x: -nextLeft * next, y: -nextTop * next });
      return next;
    });
  }, [pan.x, pan.y]);

  const onMouseDown = useCallback(e => {
    if (e.button !== 0) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);

  const onMouseMove = useCallback(e => {
    if (!dragging || !dragStart) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [dragging, dragStart]);

  const onMouseUp = useCallback(() => setDragging(false), []);

  const selectedAlgo = selected
    ? [...ALGOS_A,...ALGOS_B,...ALGOS_C].find(a=>a.id===selected)
    : null;

  const REGIME_C = { LOW_VOL:"#22c55e", HIGH_VOL:"#ef4444", FOMC_FLAT:"#f59e0b" };

  return (
    <div style={{
      width:"100%", height:"100%", minHeight:0,
      background: C.bg,
      fontFamily:"'Share Tech Mono','Courier New',monospace",
      color: C.text,
      position:"relative",
      overflow:"hidden",
      userSelect:"none",
    }}>
      {/* SCANLINES */}
      <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:0,
        background:"repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.05) 3px,rgba(0,0,0,0.05) 4px)"}}/>

      {/* TOP BAR */}
      <div style={{
        position:"absolute",top:0,left:0,right:0,height:44,zIndex:100,
        background:"#04080f",
        borderBottom:"1px solid #0a1828",
        display:"flex",alignItems:"center",
        padding:"0 20px",gap:20,
      }}>
        <div>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:16,fontWeight:900,letterSpacing:4,color:"#22d3ee"}}>
            🛡️ M4D · MAXCOGVIZ · WARRIOR
          </div>
          <div style={{fontSize:8,letterSpacing:2,color:C.muted}}>
            JEDI ORB · 3-COUNCIL ARRAY · 27 ALGO NODES · WARRIOR DIAGRAM
          </div>
        </div>
        <div style={{width:1,height:28,background:C.border}}/>
        <div style={{fontSize:9,color:REGIME_C[regime],letterSpacing:2,fontWeight:700}}>{regime}</div>
        <div style={{width:1,height:28,background:C.border}}/>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:32,fontWeight:900,color:dirCol,letterSpacing:3,
          textShadow:`0 0 16px ${dirCol}88`}}>
          {score>0?"+":""}{score} <span style={{fontSize:12,letterSpacing:3}}>{direction}</span>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:12,alignItems:"center"}}>
          {[["A·BOOM",C.boom],[`B·STRAT`,C.strat],["C·LEGEND",C.legend]].map(([l,c])=>(
            <div key={l} style={{fontSize:8,letterSpacing:2,color:c}}>{l}</div>
          ))}
          <div style={{width:1,height:14,background:C.border}}/>
          <div style={{fontSize:8,color:C.muted}}>SCROLL=ZOOM · DRAG=PAN</div>
        </div>
      </div>

      {/* SVG CANVAS */}
      <div
        ref={viewportRef}
        style={{position:"absolute",inset:0,top:44,cursor:dragging?"grabbing":"grab"}}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      >
        <svg
          ref={svgRef}
          width="100%" height="100%"
          viewBox={`${-pan.x/zoom} ${-pan.y/zoom} ${W/zoom} ${H/zoom}`}
          style={{display:"block"}}
        >
          <defs>
            {/* GRADIENTS */}
            <radialGradient id="jediGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.35"/>
              <stop offset="60%" stopColor="#f59e0b" stopOpacity="0.08"/>
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0"/>
            </radialGradient>
            <radialGradient id="boomGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.15"/>
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0"/>
            </radialGradient>
            <radialGradient id="stratGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#818cf8" stopOpacity="0.15"/>
              <stop offset="100%" stopColor="#818cf8" stopOpacity="0"/>
            </radialGradient>
            <radialGradient id="legendGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#4ade80" stopOpacity="0.15"/>
              <stop offset="100%" stopColor="#4ade80" stopOpacity="0"/>
            </radialGradient>

            {/* ARROW MARKERS */}
            {[["arrowJedi","#f59e0b"],["arrowBoom","#22d3ee"],["arrowStrat","#818cf8"],["arrowLegend","#4ade80"],["arrowLong","#22d3ee"],["arrowShort","#ef4444"],["arrowFlat","#2a3a4a"]].map(([id,col])=>(
              <marker key={id} id={id} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill={col} opacity="0.8"/>
              </marker>
            ))}

            {/* FILTER: bloom */}
            <filter id="bloom" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="softBloom" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="1.5" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>

          {/* ── BACKGROUND GRID ── */}
          <g opacity="0.06">
            {Array.from({length:Math.ceil(W/40)},(_,i)=>(
              <line key={`vg${i}`} x1={i*40} y1={0} x2={i*40} y2={H} stroke="#22d3ee" strokeWidth="0.5"/>
            ))}
            {Array.from({length:Math.ceil(H/40)},(_,i)=>(
              <line key={`hg${i}`} x1={0} y1={i*40} x2={W} y2={i*40} stroke="#22d3ee" strokeWidth="0.5"/>
            ))}
          </g>

          {/* ── AMBIENT GLOW ZONES ── */}
          <ellipse cx={COUNCIL_POSITIONS.cA.x} cy={520} rx={220} ry={180} fill="url(#boomGlow)" opacity="0.8"/>
          <ellipse cx={COUNCIL_POSITIONS.cB.x} cy={520} rx={220} ry={180} fill="url(#stratGlow)" opacity="0.8"/>
          <ellipse cx={COUNCIL_POSITIONS.cC.x} cy={520} rx={220} ry={180} fill="url(#legendGlow)" opacity="0.8"/>
          <ellipse cx={JEDI_POS.x} cy={JEDI_POS.y} rx={160} ry={100} fill="url(#jediGlow)" opacity="1"/>

          {/* ── EDGES: JEDI → COUNCILS ── */}
          {[
            { to: COUNCIL_POSITIONS.cA, col: C.boom,  marker:"arrowBoom"  },
            { to: COUNCIL_POSITIONS.cB, col: C.jedi,  marker:"arrowJedi"  },
            { to: COUNCIL_POSITIONS.cC, col: C.legend,marker:"arrowLegend"},
          ].map(({to,col,marker},i)=>(
            <g key={`je${i}`}>
              <path
                d={cubicPath(JEDI_POS.x, JEDI_POS.y+52, to.x, to.y-32)}
                fill="none" stroke={col} strokeWidth="1.5"
                strokeDasharray="6,4" opacity="0.5"
                markerEnd={`url(#${marker})`}
              />
              <path
                d={cubicPath(JEDI_POS.x, JEDI_POS.y+52, to.x, to.y-32)}
                fill="none" stroke={col} strokeWidth="4"
                opacity="0.04"
              />
            </g>
          ))}

          {/* ── EDGES: COUNCILS → ALGOS ── */}
          {[
            { council: COUNCIL_POSITIONS.cA, algos: ALGOS_A_POS, col: C.boom,  marker:"arrowBoom"   },
            { council: COUNCIL_POSITIONS.cB, algos: ALGOS_B_POS, col: C.strat, marker:"arrowStrat"  },
            { council: COUNCIL_POSITIONS.cC, algos: ALGOS_C_POS, col: C.legend,marker:"arrowLegend" },
          ].map(({council,algos,col,marker},bi)=>
            algos.map((a,i)=>{
              const vote = votes[a.id]??0;
              const edgeCol = vote===1?"#22d3ee":vote===-1?"#ef4444":col;
              const edgeOpacity = vote!==0?0.5:0.15;
              return (
                <g key={`ce-${bi}-${i}`}>
                  <path
                    d={straightPath(council.x, council.y+28, a.x+60, a.y)}
                    fill="none" stroke={edgeCol} strokeWidth={vote!==0?"1.2":"0.6"}
                    opacity={edgeOpacity}
                    markerEnd={`url(#${marker})`}
                  />
                </g>
              );
            })
          )}

          {/* ── EDGES: ALGOS → OUTPUT NODES (bottom) ── */}
          {[
            { algos: ALGOS_A_POS, ty: 880, tx: COUNCIL_POSITIONS.cA.x, col: C.boom },
            { algos: ALGOS_B_POS, ty: 880, tx: COUNCIL_POSITIONS.cB.x, col: C.strat },
            { algos: ALGOS_C_POS, ty: 880, tx: COUNCIL_POSITIONS.cC.x, col: C.legend },
          ].map(({algos,ty,tx,col},bi)=>
            algos.map((a,i)=>{
              const vote = votes[a.id]??0;
              if (vote===0) return null;
              return (
                <line key={`out-${bi}-${i}`}
                  x1={a.x+60} y1={a.y+70}
                  x2={tx} y2={ty-10}
                  stroke={vote===1?"#22d3ee":"#ef4444"}
                  strokeWidth="0.6" opacity="0.2"
                />
              );
            })
          )}

          {/* ── ALGO NODES: BANK A ── */}
          {ALGOS_A_POS.map(a => (
            <AlgoNode key={a.id} algo={a} vote={votes[a.id]??0} strength={strengths[a.id]??0.5}
              selected={selected===a.id} onClick={()=>setSelected(s=>s===a.id?null:a.id)} bank="A"/>
          ))}

          {/* ── ALGO NODES: BANK B ── */}
          {ALGOS_B_POS.map(a => (
            <AlgoNode key={a.id} algo={a} vote={votes[a.id]??0} strength={strengths[a.id]??0.5}
              selected={selected===a.id} onClick={()=>setSelected(s=>s===a.id?null:a.id)} bank="B"/>
          ))}

          {/* ── ALGO NODES: BANK C ── */}
          {ALGOS_C_POS.map(a => (
            <AlgoNode key={a.id} algo={a} vote={votes[a.id]??0} strength={strengths[a.id]??0.5}
              selected={selected===a.id} onClick={()=>setSelected(s=>s===a.id?null:a.id)} bank="C"/>
          ))}

          {/* ── COUNCIL NODES ── */}
          {[
            { c: COUNCIL_A, pos: COUNCIL_POSITIONS.cA, algos: ALGOS_A_POS },
            { c: COUNCIL_B, pos: COUNCIL_POSITIONS.cB, algos: ALGOS_B_POS },
            { c: COUNCIL_C, pos: COUNCIL_POSITIONS.cC, algos: ALGOS_C_POS },
          ].map(({c,pos,algos})=>{
            const aLong  = algos.filter(a=>votes[a.id]===1).length;
            const aShort = algos.filter(a=>votes[a.id]===-1).length;
            return (
              <CouncilNode key={c.id} council={c} pos={pos} long={aLong} short={aShort}/>
            );
          })}

          {/* ── JEDI ORB ── */}
          <JediOrb pos={JEDI_POS} vote={votes["jedi"]??1} strength={strengths["jedi"]??0.9}
            score={score} direction={direction} dirCol={dirCol} tick={tick}/>

          {/* ── OUTPUT VOTE BARS (bottom) ── */}
          {[
            { x: COUNCIL_POSITIONS.cA.x, col: C.boom,  algos: ALGOS_A_POS, label:"BOOM VOTE" },
            { x: COUNCIL_POSITIONS.cB.x, col: C.strat, algos: ALGOS_B_POS, label:"STRAT VOTE" },
            { x: COUNCIL_POSITIONS.cC.x, col: C.legend,algos: ALGOS_C_POS, label:"LEGEND VOTE" },
          ].map(({x,col,algos,label})=>{
            const l = algos.filter(a=>votes[a.id]===1).length;
            const s2 = algos.filter(a=>votes[a.id]===-1).length;
            const f = 9-l-s2;
            return (
              <g key={label}>
                <rect x={x-80} y={862} width={160} height={22} fill="#04080f" stroke={col} strokeWidth="0.5" opacity="0.8"/>
                <rect x={x-78} y={864} width={l/9*156} height={18} fill="#22d3ee" opacity="0.25"/>
                <rect x={x-78+(l/9*156)} y={864} width={f/9*156} height={18} fill="#1e3a50" opacity="0.2"/>
                <rect x={x-78+((l+f)/9*156)} y={864} width={s2/9*156} height={18} fill="#ef4444" opacity="0.25"/>
                <text x={x} y={876.5} textAnchor="middle" fontSize="7" fill={col} letterSpacing="2" fontFamily="Share Tech Mono">
                  {label} {l}L/{s2}S
                </text>
              </g>
            );
          })}

          {/* ── REGIME BANNER ── */}
          <g>
            <rect x={W/2-90} y={820} width={180} height={28} fill="#04080f" stroke={REGIME_C[regime]} strokeWidth="0.8"/>
            <text x={W/2} y={829} textAnchor="middle" fontSize="7" fill={REGIME_C[regime]} letterSpacing="3" fontFamily="Share Tech Mono">HMM REGIME</text>
            <text x={W/2} y={843} textAnchor="middle" fontSize="10" fill={REGIME_C[regime]} letterSpacing="3" fontFamily="Barlow Condensed" fontWeight="700">{regime}</text>
          </g>

        </svg>
      </div>

      {/* DETAIL PANEL */}
      <div style={{
        position:"absolute",
        top: 112,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 180,
        display: "grid",
        gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
        alignItems: "start",
        gap: 2,
        width: "min(100%, 760px)",
        overflow: "visible",
        padding: "2px 6px",
      }}>
        <div style={{ transform: "scale(0.72)", transformOrigin: "top center", height: 116, overflow: "visible", display: "grid", justifyItems: "center" }}>
          <PriceOrb
          candles={[...ALGOS_A.slice(0, 7)].map((a, i) => {
            const v = votes[a.id] ?? 0;
            const st = strengths[a.id] ?? 0.5;
            const base = 100 + i * 0.4;
            return { o: base, h: base + 0.6 + st, l: base - 0.6 - st, c: base + v * st };
          })}
          vwap={100 + score * 0.05}
          bid={100 + score * 0.05 - 0.03}
          ask={100 + score * 0.05 + 0.03}
          direction={direction}
          />
        </div>
        <div style={{ transform: "scale(0.72)", transformOrigin: "top center", height: 116, overflow: "visible", display: "grid", justifyItems: "center" }}>
          <RiskOrb
          pnl={Math.round(score * 20)}
          pnlMax={900}
          drawdown={Math.max(0, Math.min(1, (1 - (totalAbsVotes / 27)) * 0.8))}
          maxDrawdown={0.45}
          positionSize={Math.max(0.08, Math.min(1, totalAbsVotes / 27))}
          direction={direction}
          />
        </div>
        <div style={{ transform: "scale(0.72)", transformOrigin: "top center", height: 116, overflow: "visible", display: "grid", justifyItems: "center" }}>
          <ConfluenceOrb
          bankAScore={Math.max(-1, Math.min(1, ALGOS_A.reduce((t, a) => t + (votes[a.id] ?? 0), 0) / 9))}
          bankBScore={Math.max(-1, Math.min(1, ALGOS_B.reduce((t, a) => t + (votes[a.id] ?? 0), 0) / 9))}
          bankCScore={Math.max(-1, Math.min(1, ALGOS_C.reduce((t, a) => t + (votes[a.id] ?? 0), 0) / 9))}
          kellyFire={Math.abs(score) >= 10}
          direction={direction}
          />
        </div>
        <div style={{ transform: "scale(0.72)", transformOrigin: "top center", height: 116, overflow: "visible", display: "grid", justifyItems: "center" }}>
          <VolumeOrb
          delta={Math.max(-1, Math.min(1, score / 27))}
          cumDelta={Math.max(-1, Math.min(1, (score + Math.sin(tick * 0.25) * 4) / 27))}
          absorption={Math.max(0.05, Math.min(1, totalAbsVotes / 27))}
          tapeSpeed={0.55 + (tick % 5) * 0.08}
          direction={direction}
          />
        </div>
        <div style={{ transform: "scale(0.72)", transformOrigin: "top center", height: 116, overflow: "visible", display: "grid", justifyItems: "center" }}>
          <TVWebhookOrb
          connected
          lastFiredMs={(tick % 30) * 1000}
          latencyMs={Math.round(30 + Math.abs(score) * 6)}
          action={direction === "LONG" ? "BUY" : direction === "SHORT" ? "SELL" : "IDLE"}
          fireCount={tick}
          />
        </div>
      </div>

      {/* DETAIL PANEL */}
      {selectedAlgo && (
        <div style={{
          position:"absolute",bottom:10,right:10,width:260,zIndex:200,
          background:"#04080f",
          border:`1px solid ${selectedAlgo.color}55`,
          padding:"12px 14px",
          boxShadow:`0 0 24px ${selectedAlgo.color}22`,
        }}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <div style={{width:6,height:6,background:selectedAlgo.color,borderRadius:1}}/>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,fontWeight:700,color:selectedAlgo.color,letterSpacing:2}}>{selectedAlgo.name}</div>
            <button onClick={()=>setSelected(null)} style={{marginLeft:"auto",background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:12}}>✕</button>
          </div>
          <div style={{fontSize:9,color:"#5a8090",marginBottom:6,letterSpacing:1}}>{selectedAlgo.sub}</div>
          <div style={{fontSize:8,color:C.muted,lineHeight:1.8}}>{selectedAlgo.method}</div>
          {selectedAlgo.horizon&&<div style={{marginTop:8,fontSize:8,color:"#4ade80",letterSpacing:2}}>HORIZON: {selectedAlgo.horizon}</div>}
          <div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}>
            <div style={{fontSize:9,color:voteColor(votes[selectedAlgo.id],C.muted),letterSpacing:1}}>
              VOTE: {votes[selectedAlgo.id]===1?"▲ LONG":votes[selectedAlgo.id]===-1?"▼ SHORT":"■ FLAT"}
            </div>
            <div style={{flex:1,height:2,background:C.border}}>
              <div style={{height:"100%",width:`${(strengths[selectedAlgo.id]??0.5)*100}%`,background:selectedAlgo.color,transition:"width 0.5s"}}/>
            </div>
          </div>
        </div>
      )}

      {/* LEGEND */}
      <div style={{
        position:"absolute",bottom:10,left:10,zIndex:200,
        background:"#04080f",border:"1px solid #0a1828",padding:"8px 12px",
        display:"flex",gap:16,alignItems:"center",
      }}>
        {[["▲ LONG","#22d3ee"],["▼ SHORT","#ef4444"],["■ FLAT","#2a3a4a"],
          ["BOOM",C.boom],["STRAT",C.strat],["LEGEND",C.legend],["JEDI",C.jedi]].map(([l,c])=>(
          <div key={l} style={{fontSize:7,color:c,letterSpacing:1}}>{l}</div>
        ))}
      </div>
    </div>
  );
}

// ── JEDI ORB NODE ─────────────────────────────────────────────────
function JediOrb({ pos, vote, strength, score, direction, dirCol, tick }) {
  const pulse = 0.85 + Math.sin(tick * 0.3) * 0.15;
  const ringR = 52 + Math.sin(tick * 0.2) * 4;
  return (
    <g transform={`translate(${pos.x},${pos.y})`} style={{cursor:"pointer"}} filter="url(#bloom)">
      {/* OUTER RING PULSES */}
      <circle r={ringR+24} fill="none" stroke="#f59e0b" strokeWidth="0.4" opacity={0.08*pulse}/>
      <circle r={ringR+14} fill="none" stroke="#f59e0b" strokeWidth="0.6" opacity={0.12*pulse}/>
      <circle r={ringR+4}  fill="none" stroke="#f59e0b" strokeWidth="0.8" opacity={0.2*pulse}/>

      {/* MAIN ORB BODY */}
      <circle r={ringR} fill="#04060a" stroke="#f59e0b" strokeWidth="1.5" opacity="0.95"/>
      <circle r={ringR*0.7} fill="none" stroke="#f59e0b" strokeWidth="0.5" opacity="0.2" strokeDasharray="4,4"/>

      {/* INNER GLOW */}
      <circle r={ringR*0.85} fill="none" stroke="#f59e0b" strokeWidth="8" opacity={0.04*strength}/>

      {/* ORBIT RING */}
      <ellipse rx={ringR+8} ry={12} fill="none" stroke="#f59e0b" strokeWidth="0.5" opacity="0.15"
        transform={`rotate(${tick*1.2})`}/>
      <ellipse rx={ringR+8} ry={12} fill="none" stroke="#f59e0b" strokeWidth="0.5" opacity="0.1"
        transform={`rotate(${-tick*0.8+60})`}/>

      {/* TITLE */}
      <text y={-16} textAnchor="middle" fontSize="9" fill="#f59e0b" letterSpacing="3"
        fontFamily="Share Tech Mono" fontWeight="700">JEDI MASTER</text>
      <text y={0} textAnchor="middle" fontSize="7" fill="#a07020" letterSpacing="2"
        fontFamily="Share Tech Mono">MTF · SITE AUTHORITY</text>

      {/* SCORE */}
      <text y={20} textAnchor="middle" fontFamily="Barlow Condensed" fontSize="22"
        fontWeight="900" fill={dirCol} letterSpacing="2"
        style={{textShadow:`0 0 8px ${dirCol}`}}>
        {score>0?"+":""}{score}
      </text>
      <text y={34} textAnchor="middle" fontFamily="Barlow Condensed" fontSize="10"
        fontWeight="700" fill={dirCol} letterSpacing="4" opacity="0.8">{direction}</text>

      {/* CORNER TICKS */}
      {[0,90,180,270].map(a=>(
        <line key={a}
          x1={Math.cos(a*Math.PI/180)*(ringR-4)} y1={Math.sin(a*Math.PI/180)*(ringR-4)}
          x2={Math.cos(a*Math.PI/180)*(ringR+8)} y2={Math.sin(a*Math.PI/180)*(ringR+8)}
          stroke="#f59e0b" strokeWidth="1.5" opacity="0.6"/>
      ))}
    </g>
  );
}

// ── COUNCIL NODE ──────────────────────────────────────────────────
function CouncilNode({ council, pos, long, short }) {
  const flat = 9 - long - short;
  const barW = 160;
  return (
    <g transform={`translate(${pos.x-80},${pos.y-28})`} style={{cursor:"default"}} filter="url(#softBloom)">
      {/* BG */}
      <rect width={160} height={56} fill="#04080f" stroke={council.color} strokeWidth="1" rx="2" opacity="0.9"/>
      <rect width={160} height={2} fill={council.color} opacity="0.6"/>

      {/* TITLE */}
      <text x={80} y={16} textAnchor="middle" fontFamily="Barlow Condensed" fontSize="11"
        fontWeight="700" fill={council.color} letterSpacing="2">{council.label}</text>
      <text x={80} y={27} textAnchor="middle" fontFamily="Share Tech Mono" fontSize="7"
        fill="#1e3a50" letterSpacing="1">{council.sub}</text>

      {/* VOTE BAR */}
      <rect x={4} y={33} width={barW-8} height={8} fill="#04080f" stroke="#0a1828" strokeWidth="0.5"/>
      <rect x={4} y={33} width={(long/9)*(barW-8)} height={8} fill="#22d3ee" opacity="0.6"/>
      <rect x={4+(long/9)*(barW-8)} y={33} width={(flat/9)*(barW-8)} height={8} fill="#1e3a50" opacity="0.3"/>
      <rect x={4+((long+flat)/9)*(barW-8)} y={33} width={(short/9)*(barW-8)} height={8} fill="#ef4444" opacity="0.6"/>

      {/* COUNTS */}
      <text x={8}   y={50} fontFamily="Barlow Condensed" fontSize="9" fontWeight="700" fill="#22d3ee">{long}L</text>
      <text x={80}  y={50} textAnchor="middle" fontFamily="Barlow Condensed" fontSize="9" fill="#1e3a50">{flat}F</text>
      <text x={152} y={50} textAnchor="end" fontFamily="Barlow Condensed" fontSize="9" fontWeight="700" fill="#ef4444">{short}S</text>
    </g>
  );
}

// ── ALGO NODE ─────────────────────────────────────────────────────
function AlgoNode({ algo, vote, strength, selected, onClick, bank }) {
  const borderCol = vote===1?"#22d3ee":vote===-1?"#ef4444":"#0d1f2e";
  const glowOpacity = vote!==0 ? strength*0.35 : 0.05;
  const nodeColor = vote===1?"#22d3ee":vote===-1?"#ef4444":"#1e3a50";
  const W2=120, H2=68;

  return (
    <g transform={`translate(${algo.x},${algo.y})`}
      onClick={onClick}
      style={{cursor:"pointer"}}
      filter={vote!==0?"url(#softBloom)":"none"}
    >
      {/* GLOW BG */}
      {vote!==0&&(
        <rect x={-4} y={-4} width={W2+8} height={H2+8}
          fill={vote===1?"#22d3ee":"#ef4444"}
          opacity={glowOpacity*0.3} rx="3"/>
      )}

      {/* MAIN RECT */}
      <rect width={W2} height={H2} fill="#04080f"
        stroke={selected?algo.color:borderCol}
        strokeWidth={selected?"1.5":"0.8"} rx="2"/>

      {/* TOP ACCENT */}
      <rect width={W2} height={vote!==0?2:1}
        fill={vote!==0?nodeColor:algo.color} opacity={vote!==0?0.8:0.3} rx="1"/>

      {/* STRENGTH FILL */}
      <rect width={W2*strength} height={H2} fill={algo.color} opacity={0.04} rx="2"/>

      {/* ALGO NAME */}
      <text x={6} y={16} fontFamily="Barlow Condensed" fontSize="10" fontWeight="700"
        fill={vote!==0?nodeColor:algo.color} letterSpacing="1"
        opacity={vote!==0?1:0.6}>{algo.name}</text>

      {/* SUB */}
      <text x={6} y={27} fontFamily="Share Tech Mono" fontSize="6.5"
        fill="#1e3a50" letterSpacing="0.5">{algo.sub}</text>

      {/* VOTE ICON */}
      <text x={W2-10} y={18} textAnchor="end" fontFamily="Barlow Condensed" fontSize="18"
        fontWeight="900" fill={nodeColor}
        style={{filter:vote!==0?`drop-shadow(0 0 4px ${nodeColor})`:"none"}}>
        {vote===1?"▲":vote===-1?"▼":"■"}
      </text>

      {/* STRENGTH BAR */}
      <rect x={6} y={34} width={W2-12} height={2} fill="#0a1828"/>
      <rect x={6} y={34} width={(W2-12)*strength} height={2}
        fill={vote!==0?nodeColor:algo.color} opacity={0.7}/>

      {/* SIGNAL PILLS */}
      <text x={6} y={48} fontFamily="Share Tech Mono" fontSize="6"
        fill={vote!==0?algo.color:"#1a2e3e"} letterSpacing="0.5">
        {algo.signals?algo.signals.slice(0,2).join(" · "):""}
      </text>
      {algo.horizon&&(
        <text x={6} y={60} fontFamily="Share Tech Mono" fontSize="6"
          fill="#4ade80" letterSpacing="1">⌛ {algo.horizon}</text>
      )}

      {/* SLOT ID */}
      <text x={W2-4} y={H2-4} textAnchor="end" fontFamily="Share Tech Mono" fontSize="6"
        fill="#0d1f2e">{algo.id}</text>
    </g>
  );
}
