import { useState, useEffect, useRef, useCallback } from "react";

// ── palette ──────────────────────────────────────────────────────────────────
const C = {
  bg0: "#050608",
  bg1: "#0a0c10",
  bg2: "#0f1117",
  bg3: "#161a23",
  bg4: "#1d2230",
  border: "#1e2535",
  borderHi: "#2a3550",
  dim: "#3a4560",
  muted: "#5a6888",
  text: "#c8d4e8",
  textHi: "#e8f0ff",
  textDim: "#7a8aaa",
  accent: "#00d4ff",
  accentDim: "#0088aa",
  green: "#00e676",
  greenDim: "#007740",
  red: "#ff4444",
  redDim: "#880000",
  amber: "#ffb300",
  amberDim: "#664800",
  purple: "#bb86fc",
  purpleDim: "#4a1e8a",
  teal: "#1de9b6",
  tealDim: "#007055",
};

// ── mock DB ───────────────────────────────────────────────────────────────────
const MOCK_ALGOS = [
  { id: 1, name: "Kernel Regression Breakout", source: "TradingView", type: "pine", sharpe: 2.41, sortino: 3.12, maxDD: -18.4, alpha: 0.087, status: "candidate", regime: "trend", pca_rank: 1, winRate: 0.64, totalReturn: 284.3, tags: ["trend","breakout","1D"] },
  { id: 2, name: "Gaussian Channel LS", source: "TradingView", type: "pine", sharpe: 1.89, sortino: 2.44, maxDD: -22.1, alpha: 0.071, status: "review", regime: "trend", pca_rank: 2, winRate: 0.59, totalReturn: 198.7, tags: ["trend","channel","1D"] },
  { id: 3, name: "ADX Momentum Fusion", source: "Custom", type: "python", sharpe: 2.18, sortino: 2.91, maxDD: -15.8, alpha: 0.063, status: "candidate", regime: "momentum", pca_rank: 3, winRate: 0.61, totalReturn: 241.6, tags: ["momentum","adx","1D"] },
  { id: 4, name: "VWAP Deviation Engine", source: "TradingView", type: "pine", sharpe: 1.44, sortino: 1.88, maxDD: -28.3, alpha: 0.041, status: "testing", regime: "mean-rev", pca_rank: 7, winRate: 0.53, totalReturn: 122.4, tags: ["mean-rev","vwap","intraday"] },
  { id: 5, name: "Supertrend ATR Stack", source: "TradingView", type: "rust", sharpe: 1.72, sortino: 2.21, maxDD: -19.7, alpha: 0.055, status: "candidate", regime: "trend", pca_rank: 4, winRate: 0.58, totalReturn: 167.9, tags: ["trend","atr","4H"] },
  { id: 6, name: "RSI Divergence Scalper", source: "Custom", type: "python", sharpe: 0.98, sortino: 1.12, maxDD: -35.2, alpha: 0.028, status: "rejected", regime: "momentum", pca_rank: 9, winRate: 0.49, totalReturn: 67.3, tags: ["momentum","rsi","1H"] },
  { id: 7, name: "Stochastic Flow Model", source: "GitHub", type: "python", sharpe: 1.61, sortino: 2.08, maxDD: -21.4, alpha: 0.049, status: "testing", regime: "momentum", pca_rank: 5, winRate: 0.56, totalReturn: 148.2, tags: ["momentum","stoch","4H"] },
  { id: 8, name: "Market Structure Shift", source: "TradingView", type: "pine", sharpe: 2.07, sortino: 2.77, maxDD: -16.2, alpha: 0.079, status: "candidate", regime: "structure", pca_rank: 2, winRate: 0.62, totalReturn: 219.4, tags: ["ICT","structure","1D"] },
];

const TEARSHEET_DATA = {
  monthly: [-2.1, 8.4, 12.3, -1.8, 6.7, 9.2, -3.4, 14.1, 7.8, -0.9, 5.3, 11.2,
             3.2, -1.4, 8.9, 15.3, -4.2, 7.1, 10.8, -2.3, 6.4, 8.7, 4.1, 12.6],
  equity: Array.from({length: 200}, (_, i) => {
    let v = 10000;
    const arr = [v];
    for (let j = 1; j < 200; j++) {
      v *= (1 + (Math.random() * 0.04 - 0.012));
      arr.push(Math.round(v));
    }
    return arr;
  })[0],
  drawdown: Array.from({length: 200}, (_, i) => -(Math.random() * 20 * Math.sin(i/30)**2)).map(v => +v.toFixed(2)),
};

const PCA_FACTORS = [
  { name: "Trend α", explained: 38.4, top: ["Kernel Reg", "Gaussian Ch", "Supertrend"] },
  { name: "Momentum β", explained: 22.1, top: ["ADX Fusion", "RSI Div", "Stoch Flow"] },
  { name: "Structure γ", explained: 14.7, top: ["MSS", "VWAP Dev", "CCI"] },
  { name: "Vol regime δ", explained: 9.8, top: ["ATR Stack", "BB Width", "VIX proxy"] },
];

// ── Claude API call ───────────────────────────────────────────────────────────
async function callClaude(systemPrompt, userMessage, onChunk) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      stream: true,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "content_block_delta" && data.delta?.text) {
            onChunk(data.delta.text);
          }
        } catch {}
      }
    }
  }
}

// ── tiny components ───────────────────────────────────────────────────────────
const Badge = ({ label, color = C.accent }) => (
  <span style={{
    fontSize: 9, fontFamily: "monospace", fontWeight: 700,
    letterSpacing: "0.1em", textTransform: "uppercase",
    padding: "2px 6px", borderRadius: 2,
    border: `1px solid ${color}44`, color, background: `${color}11`,
  }}>{label}</span>
);

const StatusBadge = ({ s }) => {
  const map = {
    candidate: [C.green, "CANDIDATE"],
    testing:   [C.amber, "TESTING"],
    review:    [C.purple, "REVIEW"],
    rejected:  [C.red, "REJECTED"],
  };
  const [col, label] = map[s] || [C.muted, s.toUpperCase()];
  return <Badge label={label} color={col} />;
};

const TypeBadge = ({ t }) => {
  const map = { pine: [C.teal, "PINE"], python: [C.accent, "PY"], rust: [C.amber, "RS"] };
  const [col, label] = map[t] || [C.muted, t.toUpperCase()];
  return <Badge label={label} color={col} />;
};

const Num = ({ v, unit = "", green = true, digits = 2 }) => (
  <span style={{ color: v > 0 ? (green ? C.green : C.textHi) : (v < 0 ? C.red : C.muted), fontFamily: "monospace", fontWeight: 700 }}>
    {v > 0 ? "+" : ""}{typeof v === "number" ? v.toFixed(digits) : v}{unit}
  </span>
);

const StatBox = ({ label, value, sub, color = C.text }) => (
  <div style={{ padding: "10px 14px", background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 4 }}>
    <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 20, fontFamily: "monospace", fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color: C.textDim, marginTop: 3 }}>{sub}</div>}
  </div>
);

// ── sparkline (SVG) ───────────────────────────────────────────────────────────
const Sparkline = ({ data, width = 120, height = 36, color = C.accent }) => {
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
};

// ── bar chart (SVG) ───────────────────────────────────────────────────────────
const MonthlyBarChart = ({ data }) => {
  const w = 600, h = 100, pad = 20;
  const barW = (w - pad * 2) / data.length - 2;
  const max = Math.max(...data.map(Math.abs)) || 1;
  const baseline = h / 2;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <line x1={pad} y1={baseline} x2={w - pad} y2={baseline} stroke={C.border} strokeWidth={0.5} />
      {data.map((v, i) => {
        const x = pad + i * ((w - pad * 2) / data.length) + 1;
        const barH = (Math.abs(v) / max) * (h / 2 - 4);
        const y = v >= 0 ? baseline - barH : baseline;
        return (
          <rect key={i} x={x} y={y} width={barW} height={barH}
            fill={v >= 0 ? C.green : C.red} opacity={0.85} rx={1} />
        );
      })}
    </svg>
  );
};

// ── equity curve ─────────────────────────────────────────────────────────────
const EquityCurve = ({ data }) => {
  const w = 600, h = 120, pad = { t: 10, r: 10, b: 20, l: 50 };
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const pts = data.map((v, i) => {
    const x = pad.l + (i / (data.length - 1)) * iw;
    const y = pad.t + (1 - (v - min) / range) * ih;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const fillPts = `${pad.l},${pad.t + ih} ` + pts + ` ${pad.l + iw},${pad.t + ih}`;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id="eq-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.green} stopOpacity="0.3" />
          <stop offset="100%" stopColor={C.green} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map(f => {
        const y = pad.t + f * ih;
        const v = (max - f * range).toFixed(0);
        return (
          <g key={f}>
            <line x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke={C.border} strokeWidth={0.5} strokeDasharray="3,3" />
            <text x={pad.l - 4} y={y + 3} fill={C.muted} fontSize={8} textAnchor="end" fontFamily="monospace">{Number(v).toLocaleString()}</text>
          </g>
        );
      })}
      <polygon points={fillPts} fill="url(#eq-grad)" />
      <polyline points={pts} fill="none" stroke={C.green} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
};

// ── drawdown chart ────────────────────────────────────────────────────────────
const DrawdownChart = ({ data }) => {
  const w = 600, h = 60, pad = { t: 5, r: 10, b: 15, l: 50 };
  const min = Math.min(...data);
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const pts = data.map((v, i) => {
    const x = pad.l + (i / (data.length - 1)) * iw;
    const y = pad.t + (v / min) * ih;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const fillPts = `${pad.l},${pad.t} ` + pts + ` ${pad.l + iw},${pad.t}`;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <polygon points={fillPts} fill={`${C.red}22`} />
      <polyline points={pts} fill="none" stroke={C.red} strokeWidth={1} strokeLinejoin="round" />
      <text x={pad.l - 4} y={pad.t + ih + 3} fill={C.muted} fontSize={8} textAnchor="end" fontFamily="monospace">{min.toFixed(1)}%</text>
    </svg>
  );
};

// ── PCA scatter ───────────────────────────────────────────────────────────────
const PCAScatter = ({ algos }) => {
  const w = 280, h = 200, pad = 30;
  const pts = algos.map((a, i) => ({
    x: pad + Math.cos(i * 1.3) * (a.sharpe / 2.5) * (w / 2 - pad) + w / 2,
    y: pad + Math.sin(i * 1.7) * (a.alpha / 0.09) * (h / 2 - pad) + h / 2,
    a,
  }));
  const colorMap = { trend: C.green, momentum: C.accent, "mean-rev": C.purple, structure: C.teal };
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <line x1={w/2} y1={pad/2} x2={w/2} y2={h-pad/2} stroke={C.border} strokeWidth={0.5} />
      <line x1={pad/2} y1={h/2} x2={w-pad/2} y2={h/2} stroke={C.border} strokeWidth={0.5} />
      <text x={w/2+2} y={pad/2+8} fill={C.muted} fontSize={7} fontFamily="monospace">Sharpe →</text>
      <text x={pad/2} y={h/2-4} fill={C.muted} fontSize={7} fontFamily="monospace">α ↑</text>
      {pts.map(({ x, y, a }) => (
        <g key={a.id}>
          <circle cx={x} cy={y} r={a.status === "candidate" ? 5 : 3.5}
            fill={colorMap[a.regime] || C.muted}
            opacity={a.status === "rejected" ? 0.3 : 0.85}
            stroke={a.status === "candidate" ? C.textHi : "none"}
            strokeWidth={0.5} />
          <text x={x+6} y={y+3} fill={C.textDim} fontSize={7} fontFamily="monospace">{a.name.split(" ")[0]}</text>
        </g>
      ))}
    </svg>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
export default function AlphaWorkstation() {
  const [tab, setTab] = useState("seek");
  const [algos, setAlgos] = useState(MOCK_ALGOS);
  const [selectedAlgo, setSelectedAlgo] = useState(null);
  const [councilOutput, setCouncilOutput] = useState({});
  const [councilLoading, setCouncilLoading] = useState({});
  const [optimizerOutput, setOptimizerOutput] = useState("");
  const [optimizerLoading, setOptimizerLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [seekLog, setSeekLog] = useState([]);
  const [seekRunning, setSeekRunning] = useState(false);
  const [walkForwardData, setWalkForwardData] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortBy, setSortBy] = useState("sharpe");
  const logRef = useRef(null);

  // auto-scroll seek log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [seekLog]);

  // simulate seek/download pipeline
  const runSeek = useCallback(async () => {
    setSeekRunning(true);
    setSeekLog([]);
    const steps = [
      { t: 200,  msg: "► Initializing TV scraper agent...", col: C.accent },
      { t: 600,  msg: "  Querying TradingView public library: scripts?sort=BEST&type=strategy", col: C.textDim },
      { t: 1200, msg: `  Found 847 strategy scripts. Filtering by: ${searchQuery || "Sharpe > 1.5 OR followers > 5k"}`, col: C.textDim },
      { t: 1800, msg: "  Parsing Pine Script AST for 23 candidates...", col: C.textDim },
      { t: 2400, msg: "► Running IC scorer on BTC/ETH/SOL 1D data...", col: C.accent },
      { t: 3000, msg: "  [1/23] kernel_regression_v4.pine → IC: 0.087  ICIR: 1.41  ✓", col: C.green },
      { t: 3400, msg: "  [2/23] gaussian_channel_ls.pine → IC: 0.071  ICIR: 1.28  ✓", col: C.green },
      { t: 3800, msg: "  [4/23] bb_squeeze_pro.pine → IC: 0.031  ICIR: 0.62  ✗ (below threshold)", col: C.red },
      { t: 4200, msg: "  [7/23] market_structure_shift.pine → IC: 0.079  ICIR: 1.33  ✓", col: C.green },
      { t: 4800, msg: "► FDR correction (BH) across 23 tests... 8 pass at q=0.05", col: C.accent },
      { t: 5400, msg: "► Converting Pine → Python for backtesting engine...", col: C.accent },
      { t: 5800, msg: "  Translating via Claude Code... kernel_regression.py ✓", col: C.teal },
      { t: 6200, msg: "  Compiling Rust hot-path: signal_combiner.rs → binary ✓", col: C.teal },
      { t: 6800, msg: "► Storing to SQLite: algos.db (8 new records)", col: C.accent },
      { t: 7400, msg: "► Running walk-forward validation: 3 folds × 8 algos...", col: C.accent },
      { t: 8200, msg: "  Walk-forward complete. 5/8 pass consistency gate.", col: C.green },
      { t: 8600, msg: "► PCA decomposition: 4 factors explain 85.0% variance", col: C.accent },
      { t: 9000, msg: "✓ Pipeline complete. 5 candidates queued for AI Council review.", col: C.green },
    ];
    for (const step of steps) {
      await new Promise(r => setTimeout(r, step.t));
      setSeekLog(prev => [...prev, { msg: step.msg, col: step.col }]);
    }
    setSeekRunning(false);
  }, [searchQuery]);

  // walk-forward simulation
  const runWalkForward = useCallback((algo) => {
    const folds = [
      { train: "2018–2020", test: "2021", sharpe: 2.21, maxDD: -16.2, returns: 187.4, pass: true },
      { train: "2018–2021", test: "2022", sharpe: 1.44, maxDD: -28.7, returns: -12.3, pass: false },
      { train: "2018–2022", test: "2023", sharpe: 2.67, maxDD: -14.1, returns: 341.2, pass: true },
    ];
    setWalkForwardData({ algo, folds });
    setTab("tearsheet");
  }, []);

  // AI Council review
  const runCouncilReview = useCallback(async (algo, persona) => {
    const key = `${algo.id}-${persona}`;
    setCouncilLoading(prev => ({ ...prev, [key]: true }));
    setCouncilOutput(prev => ({ ...prev, [key]: "" }));

    const personas = {
      trend: {
        name: "Paul T. (Trend Master)",
        system: `You are a legendary trend-following trader in the style of Paul Tudor Jones. Brutal, direct, data-obsessed. You speak in compressed, high-signal sentences. No fluff. Assess trading strategies with focus on: trend quality, drawdown tolerance, regime dependency, and if this is actually tradeable with conviction. Max 120 words.`
      },
      quant: {
        name: "Jim S. (Quant Oracle)",
        system: `You are a quantitative researcher in the style of Jim Simons. Cold logic, statistical rigor, brutal about overfitting. You instantly spot curve-fitting, regime bias, and selection bias. Assess strategies on: IC/ICIR quality, sample size, multiple testing, regime breadth, and whether the alpha is durable. Max 120 words.`
      },
      risk: {
        name: "Ray D. (Risk Architect)",
        system: `You are a macro risk manager in the style of Ray Dalio. All-weather mindset, correlation obsessed, drawdown intolerant. Assess strategies on: worst-case drawdown, correlation to BTC, tail risk, position sizing assumptions, and whether this belongs in a balanced portfolio. Max 120 words.`
      },
    };

    const p = personas[persona];
    const msg = `Algo: ${algo.name} | Type: ${algo.type} | Regime: ${algo.regime}
Sharpe: ${algo.sharpe} | Sortino: ${algo.sortino} | MaxDD: ${algo.maxDD}%
Alpha IC: ${algo.alpha} | Win Rate: ${algo.winRate} | Total Return: ${algo.totalReturn}%
Tags: ${algo.tags.join(", ")}

Give your assessment. Should this make it to the live candidate bench?`;

    let out = "";
    try {
      await callClaude(p.system, msg, (chunk) => {
        out += chunk;
        setCouncilOutput(prev => ({ ...prev, [key]: out }));
      });
    } catch (e) {
      setCouncilOutput(prev => ({ ...prev, [key]: `[API error: ${e.message}]` }));
    }
    setCouncilLoading(prev => ({ ...prev, [key]: false }));
  }, []);

  // Claude Code optimizer
  const runOptimizer = useCallback(async (algo) => {
    setOptimizerLoading(true);
    setOptimizerOutput("");
    const sys = `You are Master Coder Claude — an elite algorithmic trading engineer. You optimize Pine Script and Python trading strategies. You output ONLY clean, production code with brief inline comments. No prose. No markdown headers. Just code. When you see a strategy, you:
1. Identify parameter over-optimization risk and suggest robust defaults
2. Add regime filter (ADX > 20 gate)
3. Add ATR-based position sizing (Kelly fraction)
4. Add dumb-AI stop: if strategy fires > 3 signals in 5 bars, pause 5 bars
5. Add walk-forward parameter lock comment block
Output the optimized Pine Script version only. Max 80 lines.`;

    const msg = `Optimize this strategy for live trading:
Name: ${algo.name}
Type: ${algo.type}
Current Sharpe: ${algo.sharpe} | MaxDD: ${algo.maxDD}%
Regime: ${algo.regime}
Tags: ${algo.tags.join(", ")}

Apply all optimizations including: regime gate, ATR sizing, dumb-AI overtrading stop, parameter stability check. Output clean Pine Script.`;

    let out = "";
    try {
      await callClaude(sys, msg, (chunk) => {
        out += chunk;
        setOptimizerOutput(out);
      });
    } catch (e) {
      setOptimizerOutput(`// [API error: ${e.message}]`);
    }
    setOptimizerLoading(false);
  }, []);

  const filtered = algos
    .filter(a => filterStatus === "all" || a.status === filterStatus)
    .sort((a, b) => {
      if (sortBy === "sharpe") return b.sharpe - a.sharpe;
      if (sortBy === "alpha") return b.alpha - a.alpha;
      if (sortBy === "pca") return a.pca_rank - b.pca_rank;
      if (sortBy === "dd") return b.maxDD - a.maxDD;
      return 0;
    });

  const candidates = algos.filter(a => a.status === "candidate");

  // ── nav tabs ────────────────────────────────────────────────────────────────
  const TABS = [
    { id: "seek",      label: "AUTO-SEEK",  icon: "⟳" },
    { id: "library",   label: "LIBRARY",    icon: "▦" },
    { id: "tearsheet", label: "TEAR-SHEET", icon: "⬡" },
    { id: "council",   label: "AI COUNCIL", icon: "⚖" },
    { id: "optimizer", label: "OPTIMIZER",  icon: "⚙" },
    { id: "bench",     label: "BENCH",      icon: "◈" },
  ];

  return (
    <div style={{
      background: C.bg0,
      minHeight: "100vh",
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      color: C.text,
      fontSize: 12,
    }}>
      {/* ── header ── */}
      <div style={{
        borderBottom: `1px solid ${C.border}`,
        padding: "12px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: C.bg1,
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.2em",
            color: C.accent, textTransform: "uppercase",
          }}>
            ◈ ALPHA WORKSTATION
          </div>
          <div style={{ color: C.dim, fontSize: 10 }}>v2.4 — SURGE ENGINE</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 10, color: C.textDim }}>
          <span>DB: <span style={{ color: C.green }}>algos.db ✓</span></span>
          <span>ALGOS: <span style={{ color: C.textHi }}>{algos.length}</span></span>
          <span>CANDIDATES: <span style={{ color: C.green }}>{candidates.length}</span></span>
          <span style={{ color: C.greenDim, background: `${C.green}11`, padding: "2px 8px", borderRadius: 2, border: `1px solid ${C.greenDim}` }}>
            ● LIVE
          </span>
        </div>
      </div>

      {/* ── tabs ── */}
      <div style={{
        display: "flex",
        borderBottom: `1px solid ${C.border}`,
        background: C.bg1,
        overflowX: "auto",
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: "none",
            border: "none",
            borderBottom: tab === t.id ? `2px solid ${C.accent}` : "2px solid transparent",
            color: tab === t.id ? C.accent : C.muted,
            padding: "10px 20px",
            fontSize: 10,
            fontFamily: "inherit",
            fontWeight: 700,
            letterSpacing: "0.12em",
            cursor: "pointer",
            whiteSpace: "nowrap",
            transition: "color 0.15s",
          }}>{t.icon} {t.label}</button>
        ))}
      </div>

      <div style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>

        {/* ═══════════════════════════════════════════════════════════════
            TAB: AUTO-SEEK
        ═══════════════════════════════════════════════════════════════ */}
        {tab === "seek" && (
          <div>
            <div style={{ marginBottom: 16, color: C.textDim, fontSize: 11 }}>
              Automated discovery → download → score → store → validate → PCA rank
            </div>

            {/* search row */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Filter query e.g. 'kernel regression 1D sharpe > 2' or leave blank for auto..."
                style={{
                  flex: 1, padding: "8px 12px",
                  background: C.bg2, border: `1px solid ${C.border}`,
                  borderRadius: 3, color: C.text, fontFamily: "inherit", fontSize: 11,
                  outline: "none",
                }}
              />
              <button onClick={runSeek} disabled={seekRunning} style={{
                padding: "8px 20px",
                background: seekRunning ? C.bg3 : `${C.accent}22`,
                border: `1px solid ${seekRunning ? C.dim : C.accent}`,
                borderRadius: 3, color: seekRunning ? C.muted : C.accent,
                fontFamily: "inherit", fontSize: 11, fontWeight: 700,
                letterSpacing: "0.1em", cursor: seekRunning ? "not-allowed" : "pointer",
              }}>
                {seekRunning ? "⟳ RUNNING..." : "⟳ RUN SEEK"}
              </button>
            </div>

            {/* pipeline visual */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
              {["TV SCRAPE", "PINE PARSE", "IC SCORE", "FDR GATE", "PY/RS CONVERT", "SQLITE STORE", "WALK-FWD", "PCA RANK", "COUNCIL"].map((s, i) => (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{
                    padding: "3px 8px", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                    background: C.bg3, border: `1px solid ${C.border}`,
                    color: seekRunning ? C.accent : C.textDim, borderRadius: 2,
                  }}>{s}</div>
                  {i < 8 && <span style={{ color: C.dim, fontSize: 10 }}>→</span>}
                </div>
              ))}
            </div>

            {/* log */}
            <div ref={logRef} style={{
              background: C.bg1,
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              padding: 12,
              height: 280,
              overflowY: "auto",
              fontFamily: "monospace",
              fontSize: 11,
            }}>
              {seekLog.length === 0 && (
                <div style={{ color: C.dim }}>// Awaiting seek command...</div>
              )}
              {seekLog.map((l, i) => (
                <div key={i} style={{ color: l.col, lineHeight: 1.7 }}>{l.msg}</div>
              ))}
              {seekRunning && <div style={{ color: C.accent }}>█</div>}
            </div>

            {/* PCA factors summary */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 8, letterSpacing: "0.1em" }}>PCA FACTORS — LAST RUN</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                {PCA_FACTORS.map(f => (
                  <div key={f.name} style={{
                    background: C.bg2, border: `1px solid ${C.border}`,
                    borderRadius: 4, padding: "10px 12px",
                  }}>
                    <div style={{ color: C.accent, fontWeight: 700, fontSize: 11, marginBottom: 4 }}>{f.name}</div>
                    <div style={{ color: C.green, fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{f.explained}%</div>
                    <div style={{ fontSize: 9, color: C.textDim }}>explained variance</div>
                    <div style={{ marginTop: 6, fontSize: 9, color: C.muted }}>
                      {f.top.map(n => <span key={n} style={{ display: "inline-block", marginRight: 4, color: C.textDim }}>{n}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            TAB: LIBRARY
        ═══════════════════════════════════════════════════════════════ */}
        {tab === "library" && (
          <div>
            {/* controls */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: C.muted }}>STATUS:</span>
              {["all", "candidate", "testing", "review", "rejected"].map(s => (
                <button key={s} onClick={() => setFilterStatus(s)} style={{
                  padding: "3px 10px", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                  background: filterStatus === s ? `${C.accent}22` : "none",
                  border: `1px solid ${filterStatus === s ? C.accent : C.border}`,
                  color: filterStatus === s ? C.accent : C.muted,
                  borderRadius: 2, cursor: "pointer", fontFamily: "inherit",
                  textTransform: "uppercase",
                }}>{s}</button>
              ))}
              <span style={{ fontSize: 10, color: C.muted, marginLeft: 8 }}>SORT:</span>
              {["sharpe", "alpha", "pca", "dd"].map(s => (
                <button key={s} onClick={() => setSortBy(s)} style={{
                  padding: "3px 10px", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                  background: sortBy === s ? `${C.teal}22` : "none",
                  border: `1px solid ${sortBy === s ? C.teal : C.border}`,
                  color: sortBy === s ? C.teal : C.muted,
                  borderRadius: 2, cursor: "pointer", fontFamily: "inherit",
                  textTransform: "uppercase",
                }}>{s}</button>
              ))}
            </div>

            {/* table */}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["#", "NAME", "SRC", "TYPE", "SHARPE", "SORTINO", "MAX DD", "IC α", "WIN%", "REGIME", "STATUS", "ACTIONS"].map(h => (
                      <th key={h} style={{
                        padding: "6px 8px", textAlign: "left", fontSize: 9,
                        color: C.muted, fontWeight: 700, letterSpacing: "0.1em",
                        whiteSpace: "nowrap",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a, i) => (
                    <tr key={a.id}
                      onClick={() => setSelectedAlgo(a)}
                      style={{
                        borderBottom: `1px solid ${C.border}`,
                        background: selectedAlgo?.id === a.id ? C.bg3 : "transparent",
                        cursor: "pointer",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = C.bg2}
                      onMouseLeave={e => e.currentTarget.style.background = selectedAlgo?.id === a.id ? C.bg3 : "transparent"}
                    >
                      <td style={{ padding: "7px 8px", color: C.dim }}>{a.pca_rank}</td>
                      <td style={{ padding: "7px 8px", color: C.textHi, fontWeight: 600, maxWidth: 180, overflow: "hidden", whiteSpace: "nowrap" }}>{a.name}</td>
                      <td style={{ padding: "7px 8px", color: C.textDim }}>{a.source}</td>
                      <td style={{ padding: "7px 8px" }}><TypeBadge t={a.type} /></td>
                      <td style={{ padding: "7px 8px" }}><Num v={a.sharpe} green={false} /></td>
                      <td style={{ padding: "7px 8px" }}><Num v={a.sortino} green={false} /></td>
                      <td style={{ padding: "7px 8px" }}><span style={{ color: C.red, fontFamily: "monospace" }}>{a.maxDD}%</span></td>
                      <td style={{ padding: "7px 8px" }}><Num v={a.alpha} digits={3} /></td>
                      <td style={{ padding: "7px 8px", fontFamily: "monospace" }}>{(a.winRate * 100).toFixed(0)}%</td>
                      <td style={{ padding: "7px 8px" }}><Badge label={a.regime} color={C.purple} /></td>
                      <td style={{ padding: "7px 8px" }}><StatusBadge s={a.status} /></td>
                      <td style={{ padding: "7px 8px" }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={e => { e.stopPropagation(); runWalkForward(a); }} style={{
                            padding: "2px 6px", fontSize: 8, background: "none",
                            border: `1px solid ${C.teal}55`, color: C.teal,
                            borderRadius: 2, cursor: "pointer", fontFamily: "inherit",
                          }}>WF</button>
                          <button onClick={e => { e.stopPropagation(); setSelectedAlgo(a); setTab("council"); }} style={{
                            padding: "2px 6px", fontSize: 8, background: "none",
                            border: `1px solid ${C.purple}55`, color: C.purple,
                            borderRadius: 2, cursor: "pointer", fontFamily: "inherit",
                          }}>AI</button>
                          <button onClick={e => { e.stopPropagation(); setSelectedAlgo(a); setTab("optimizer"); }} style={{
                            padding: "2px 6px", fontSize: 8, background: "none",
                            border: `1px solid ${C.amber}55`, color: C.amber,
                            borderRadius: 2, cursor: "pointer", fontFamily: "inherit",
                          }}>OPT</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            TAB: TEAR-SHEET
        ═══════════════════════════════════════════════════════════════ */}
        {tab === "tearsheet" && (
          <div>
            {/* algo selector */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {algos.filter(a => a.status !== "rejected").map(a => (
                <button key={a.id} onClick={() => setSelectedAlgo(a)} style={{
                  padding: "4px 10px", fontSize: 9, background: selectedAlgo?.id === a.id ? `${C.accent}22` : "none",
                  border: `1px solid ${selectedAlgo?.id === a.id ? C.accent : C.border}`,
                  color: selectedAlgo?.id === a.id ? C.accent : C.muted,
                  borderRadius: 2, cursor: "pointer", fontFamily: "inherit",
                }}>{a.name.split(" ").slice(0, 2).join(" ")}</button>
              ))}
            </div>

            {(selectedAlgo || walkForwardData) && (() => {
              const a = selectedAlgo || walkForwardData?.algo;
              return (
                <div>
                  {/* header */}
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.textHi }}>{a.name}</span>
                    <TypeBadge t={a.type} />
                    <StatusBadge s={a.status} />
                  </div>

                  {/* stat cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 16 }}>
                    <StatBox label="Sharpe" value={a.sharpe.toFixed(2)} color={a.sharpe > 2 ? C.green : C.amber} />
                    <StatBox label="Sortino" value={a.sortino.toFixed(2)} color={C.teal} />
                    <StatBox label="Max DD" value={`${a.maxDD}%`} color={C.red} />
                    <StatBox label="Win Rate" value={`${(a.winRate*100).toFixed(0)}%`} color={C.text} />
                    <StatBox label="IC α" value={a.alpha.toFixed(3)} color={C.accent} />
                    <StatBox label="Total Ret" value={`${a.totalReturn > 0 ? "+" : ""}${a.totalReturn}%`} color={a.totalReturn > 0 ? C.green : C.red} />
                  </div>

                  {/* equity curve */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 9, color: C.muted, marginBottom: 6, letterSpacing: "0.1em" }}>EQUITY CURVE</div>
                    <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 4, padding: 8 }}>
                      <EquityCurve data={TEARSHEET_DATA.equity} />
                    </div>
                  </div>

                  {/* drawdown */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 9, color: C.muted, marginBottom: 6, letterSpacing: "0.1em" }}>DRAWDOWN</div>
                    <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 4, padding: 8 }}>
                      <DrawdownChart data={TEARSHEET_DATA.drawdown} />
                    </div>
                  </div>

                  {/* monthly returns */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 9, color: C.muted, marginBottom: 6, letterSpacing: "0.1em" }}>MONTHLY RETURNS</div>
                    <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 4, padding: 8 }}>
                      <MonthlyBarChart data={TEARSHEET_DATA.monthly} />
                    </div>
                  </div>

                  {/* walk-forward folds */}
                  {walkForwardData && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 9, color: C.muted, marginBottom: 8, letterSpacing: "0.1em" }}>WALK-FORWARD VALIDATION</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                        {walkForwardData.folds.map((f, i) => (
                          <div key={i} style={{
                            background: C.bg2,
                            border: `1px solid ${f.pass ? C.greenDim : C.redDim}`,
                            borderRadius: 4, padding: "10px 12px",
                          }}>
                            <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>FOLD {i + 1}</div>
                            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 8 }}>
                              Train: {f.train} → Test: {f.test}
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 10 }}>
                              <div style={{ color: C.muted }}>Sharpe</div>
                              <div style={{ color: f.sharpe > 1.5 ? C.green : C.amber, fontFamily: "monospace", textAlign: "right" }}>{f.sharpe}</div>
                              <div style={{ color: C.muted }}>Max DD</div>
                              <div style={{ color: C.red, fontFamily: "monospace", textAlign: "right" }}>{f.maxDD}%</div>
                              <div style={{ color: C.muted }}>Returns</div>
                              <div style={{ color: f.returns > 0 ? C.green : C.red, fontFamily: "monospace", textAlign: "right" }}>{f.returns > 0 ? "+" : ""}{f.returns}%</div>
                            </div>
                            <div style={{ marginTop: 8, textAlign: "center" }}>
                              <Badge label={f.pass ? "✓ PASS" : "✗ FAIL"} color={f.pass ? C.green : C.red} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {!selectedAlgo && !walkForwardData && (
              <div style={{ color: C.dim, padding: 40, textAlign: "center" }}>
                Select an algo from the library or run walk-forward validation
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            TAB: AI COUNCIL
        ═══════════════════════════════════════════════════════════════ */}
        {tab === "council" && (
          <div>
            <div style={{ marginBottom: 12, color: C.textDim, fontSize: 11 }}>
              Three master traders review each algo. Unanimous approval → candidate bench.
            </div>

            {/* algo selector */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {algos.filter(a => a.status !== "rejected").map(a => (
                <button key={a.id} onClick={() => setSelectedAlgo(a)} style={{
                  padding: "4px 10px", fontSize: 9, background: selectedAlgo?.id === a.id ? `${C.purple}22` : "none",
                  border: `1px solid ${selectedAlgo?.id === a.id ? C.purple : C.border}`,
                  color: selectedAlgo?.id === a.id ? C.purple : C.muted,
                  borderRadius: 2, cursor: "pointer", fontFamily: "inherit",
                }}>{a.name.split(" ").slice(0, 2).join(" ")}</button>
              ))}
            </div>

            {selectedAlgo && (
              <div>
                {/* algo summary */}
                <div style={{
                  background: C.bg2, border: `1px solid ${C.border}`,
                  borderRadius: 4, padding: "10px 14px", marginBottom: 16,
                  display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
                }}>
                  <span style={{ color: C.textHi, fontWeight: 700 }}>{selectedAlgo.name}</span>
                  <TypeBadge t={selectedAlgo.type} />
                  <span style={{ color: C.muted, fontSize: 10 }}>Sharpe: <Num v={selectedAlgo.sharpe} green={false} /></span>
                  <span style={{ color: C.muted, fontSize: 10 }}>DD: <span style={{ color: C.red }}>{selectedAlgo.maxDD}%</span></span>
                  <span style={{ color: C.muted, fontSize: 10 }}>IC α: <Num v={selectedAlgo.alpha} digits={3} /></span>
                </div>

                {/* council panels */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                  {[
                    { key: "trend",  name: "Paul T.", title: "Trend Master",   color: C.green,  icon: "▲" },
                    { key: "quant",  name: "Jim S.",  title: "Quant Oracle",   color: C.accent, icon: "∑" },
                    { key: "risk",   name: "Ray D.",  title: "Risk Architect", color: C.amber,  icon: "⬡" },
                  ].map(p => {
                    const k = `${selectedAlgo.id}-${p.key}`;
                    const out = councilOutput[k] || "";
                    const loading = councilLoading[k];
                    return (
                      <div key={p.key} style={{
                        background: C.bg2,
                        border: `1px solid ${out ? p.color + "44" : C.border}`,
                        borderRadius: 4, overflow: "hidden",
                      }}>
                        <div style={{
                          padding: "8px 12px",
                          background: `${p.color}11`,
                          borderBottom: `1px solid ${p.color}22`,
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                        }}>
                          <div>
                            <span style={{ fontSize: 14, marginRight: 6 }}>{p.icon}</span>
                            <span style={{ color: p.color, fontWeight: 700, fontSize: 11 }}>{p.name}</span>
                            <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>{p.title}</div>
                          </div>
                          <button onClick={() => runCouncilReview(selectedAlgo, p.key)}
                            disabled={loading}
                            style={{
                              padding: "3px 10px", fontSize: 9,
                              background: loading ? "none" : `${p.color}22`,
                              border: `1px solid ${loading ? C.dim : p.color}`,
                              color: loading ? C.dim : p.color,
                              borderRadius: 2, cursor: loading ? "not-allowed" : "pointer",
                              fontFamily: "inherit", fontWeight: 700,
                            }}>
                            {loading ? "⟳..." : "REVIEW"}
                          </button>
                        </div>
                        <div style={{
                          padding: "10px 12px", minHeight: 120,
                          fontSize: 11, lineHeight: 1.7, color: C.text,
                        }}>
                          {out || <span style={{ color: C.dim }}>// Awaiting review...</span>}
                          {loading && <span style={{ color: p.color }}>█</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                  <button onClick={() => {
                    setAlgos(prev => prev.map(a => a.id === selectedAlgo.id ? { ...a, status: "candidate" } : a));
                    setSelectedAlgo(prev => ({ ...prev, status: "candidate" }));
                  }} style={{
                    padding: "6px 16px", fontSize: 10, fontWeight: 700,
                    background: `${C.green}22`, border: `1px solid ${C.green}`,
                    color: C.green, borderRadius: 2, cursor: "pointer", fontFamily: "inherit",
                  }}>✓ APPROVE → BENCH</button>
                  <button onClick={() => {
                    setAlgos(prev => prev.map(a => a.id === selectedAlgo.id ? { ...a, status: "rejected" } : a));
                    setSelectedAlgo(prev => ({ ...prev, status: "rejected" }));
                  }} style={{
                    padding: "6px 16px", fontSize: 10, fontWeight: 700,
                    background: `${C.red}22`, border: `1px solid ${C.red}`,
                    color: C.red, borderRadius: 2, cursor: "pointer", fontFamily: "inherit",
                  }}>✗ REJECT</button>
                </div>
              </div>
            )}

            {!selectedAlgo && (
              <div style={{ color: C.dim, padding: 40, textAlign: "center" }}>Select an algo to review</div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            TAB: OPTIMIZER
        ═══════════════════════════════════════════════════════════════ */}
        {tab === "optimizer" && (
          <div>
            <div style={{ marginBottom: 12, color: C.textDim, fontSize: 11 }}>
              Master Coder Claude: regime gate + ATR sizing + dumb-AI stops + walk-forward locks
            </div>

            {/* algo selector */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {algos.filter(a => a.status !== "rejected").map(a => (
                <button key={a.id} onClick={() => setSelectedAlgo(a)} style={{
                  padding: "4px 10px", fontSize: 9, background: selectedAlgo?.id === a.id ? `${C.amber}22` : "none",
                  border: `1px solid ${selectedAlgo?.id === a.id ? C.amber : C.border}`,
                  color: selectedAlgo?.id === a.id ? C.amber : C.muted,
                  borderRadius: 2, cursor: "pointer", fontFamily: "inherit",
                }}>{a.name.split(" ").slice(0, 2).join(" ")}</button>
              ))}
            </div>

            {selectedAlgo && (
              <div>
                {/* gates panel */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
                  {[
                    { label: "Regime Gate", desc: "ADX > 20 filter", color: C.green },
                    { label: "ATR Sizing", desc: "Kelly fraction position", color: C.accent },
                    { label: "Dumb-AI Stop", desc: ">3 signals / 5 bars → pause", color: C.amber },
                    { label: "WF Param Lock", desc: "Freeze params post-validation", color: C.purple },
                  ].map(g => (
                    <div key={g.label} style={{
                      background: C.bg2, border: `1px solid ${g.color}33`,
                      borderRadius: 4, padding: "8px 10px",
                    }}>
                      <div style={{ color: g.color, fontWeight: 700, fontSize: 10, marginBottom: 3 }}>{g.label}</div>
                      <div style={{ color: C.textDim, fontSize: 9 }}>{g.desc}</div>
                      <div style={{ marginTop: 6, width: 6, height: 6, borderRadius: "50%", background: g.color }} />
                    </div>
                  ))}
                </div>

                <button onClick={() => runOptimizer(selectedAlgo)} disabled={optimizerLoading} style={{
                  padding: "8px 20px", fontSize: 10, fontWeight: 700,
                  background: optimizerLoading ? "none" : `${C.amber}22`,
                  border: `1px solid ${optimizerLoading ? C.dim : C.amber}`,
                  color: optimizerLoading ? C.dim : C.amber,
                  borderRadius: 3, cursor: optimizerLoading ? "not-allowed" : "pointer",
                  fontFamily: "inherit", marginBottom: 12, letterSpacing: "0.1em",
                }}>
                  {optimizerLoading ? "⟳ OPTIMIZING..." : "⚙ RUN OPTIMIZER"}
                </button>

                <div style={{
                  background: C.bg1, border: `1px solid ${C.border}`,
                  borderRadius: 4, padding: 14,
                  minHeight: 300, fontFamily: "monospace", fontSize: 11,
                  lineHeight: 1.7, color: C.text, whiteSpace: "pre-wrap",
                  overflowY: "auto", maxHeight: 500,
                }}>
                  {optimizerOutput || <span style={{ color: C.dim }}>// Optimized code will appear here...</span>}
                  {optimizerLoading && <span style={{ color: C.amber }}>█</span>}
                </div>
              </div>
            )}

            {!selectedAlgo && (
              <div style={{ color: C.dim, padding: 40, textAlign: "center" }}>Select an algo to optimize</div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            TAB: BENCH
        ═══════════════════════════════════════════════════════════════ */}
        {tab === "bench" && (
          <div>
            <div style={{ marginBottom: 16, color: C.textDim, fontSize: 11 }}>
              Approved candidates. PCA/Sharpe ranked. Ready for live trade gates.
            </div>

            {/* PCA scatter + bench table side by side */}
            <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, marginBottom: 20 }}>
              <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 4, padding: 12 }}>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 8, letterSpacing: "0.1em" }}>PCA FACTOR MAP</div>
                <PCAScatter algos={algos} />
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[["trend", C.green], ["momentum", C.accent], ["mean-rev", C.purple], ["structure", C.teal]].map(([r, c]) => (
                    <div key={r} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />
                      <span style={{ fontSize: 8, color: C.muted }}>{r}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 8, letterSpacing: "0.1em" }}>CANDIDATE BENCH — PCA/SHARPE RANKED</div>
                {candidates.length === 0 && (
                  <div style={{ color: C.dim, padding: 20 }}>No candidates yet. Approve algos in AI Council.</div>
                )}
                {candidates.sort((a, b) => b.sharpe - a.sharpe).map((a, i) => (
                  <div key={a.id} style={{
                    background: C.bg2, border: `1px solid ${C.border}`,
                    borderRadius: 4, padding: "10px 14px",
                    marginBottom: 8, display: "flex",
                    alignItems: "center", gap: 12, flexWrap: "wrap",
                  }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: 2,
                      background: i === 0 ? `${C.amber}22` : C.bg3,
                      border: `1px solid ${i === 0 ? C.amber : C.border}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700, color: i === 0 ? C.amber : C.muted,
                      flexShrink: 0,
                    }}>{i + 1}</div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: C.textHi, fontWeight: 600, fontSize: 11, overflow: "hidden", whiteSpace: "nowrap" }}>{a.name}</div>
                      <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                        <TypeBadge t={a.type} />
                        <Badge label={a.regime} color={C.purple} />
                        {a.tags.slice(0, 2).map(t => <Badge key={t} label={t} color={C.dim} />)}
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, textAlign: "center" }}>
                      {[
                        ["SHARPE", a.sharpe.toFixed(2), a.sharpe > 2 ? C.green : C.amber],
                        ["DD", `${a.maxDD}%`, C.red],
                        ["IC α", a.alpha.toFixed(3), C.accent],
                        ["WIN%", `${(a.winRate*100).toFixed(0)}%`, C.text],
                      ].map(([l, v, c]) => (
                        <div key={l}>
                          <div style={{ fontSize: 8, color: C.muted }}>{l}</div>
                          <div style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: c }}>{v}</div>
                        </div>
                      ))}
                    </div>

                    <Sparkline data={TEARSHEET_DATA.equity.slice(150)} width={80} height={28} color={C.green} />

                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => { setSelectedAlgo(a); setTab("tearsheet"); }} style={{
                        padding: "3px 8px", fontSize: 8, background: "none",
                        border: `1px solid ${C.teal}55`, color: C.teal,
                        borderRadius: 2, cursor: "pointer", fontFamily: "inherit",
                      }}>SHEET</button>
                      <button onClick={() => { setSelectedAlgo(a); setTab("optimizer"); }} style={{
                        padding: "3px 8px", fontSize: 8, background: "none",
                        border: `1px solid ${C.amber}55`, color: C.amber,
                        borderRadius: 2, cursor: "pointer", fontFamily: "inherit",
                      }}>OPT</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* trade gates summary */}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 9, color: C.muted, marginBottom: 8, letterSpacing: "0.1em" }}>TRADE GATES — ALL CANDIDATES</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                {[
                  { label: "Regime Gate", desc: "ADX > 20 on 1D", active: true },
                  { label: "Vol Gate", desc: "ATR < 3× median", active: true },
                  { label: "Corr Gate", desc: "Inter-signal align > 0.4", active: false },
                  { label: "Dumb-AI Stop", desc: ">3 signals/5 bars", active: true },
                  { label: "WF Lock", desc: "Params frozen post-OOS", active: true },
                ].map(g => (
                  <div key={g.label} style={{
                    background: C.bg2,
                    border: `1px solid ${g.active ? C.greenDim : C.redDim}`,
                    borderRadius: 4, padding: "8px 10px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: g.active ? C.green : C.red }} />
                      <span style={{ color: g.active ? C.green : C.red, fontSize: 10, fontWeight: 700 }}>{g.label}</span>
                    </div>
                    <div style={{ fontSize: 9, color: C.textDim }}>{g.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
