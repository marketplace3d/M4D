// ═══════════════════════════════════════════════════════════════════════════
// M4D · MAXCOGVIZ ORB SUITE II · TRADING INTELLIGENCE ORBS
// ═══════════════════════════════════════════════════════════════════════════
//
// Five new orbs matching the MaxCogVizOrbs visual language exactly.
// All 160×160 viewBox 136×136, same filter IDs namespaced, same glow/breath
// animations, same Barlow Condensed + Share Tech Mono fonts.
//
// EXPORTS:
//   PriceOrb        — mini candle chart, VWAP line, bid/ask spread
//   RiskOrb         — live P&L arc, drawdown gauge, position size ring
//   ConfluenceOrb   — A×B×C radial spokes, agreement heat, Kelly dot
//   VolumeOrb       — delta bar, cumDelta river, absorption shield, tape
//   TVWebhookOrb    — Pine→webhook→exec pipeline, latency pulse, fire state
//
// PROPS (all optional with sensible defaults):
//
// PriceOrb:
//   candles: Array<{ o, h, l, c }> — last 7 candles newest-last (max 7)
//   vwap: number                   — current VWAP price
//   bid: number                    — current bid
//   ask: number                    — current ask
//   direction: "LONG"|"SHORT"|"FLAT"
//
// RiskOrb:
//   pnl: number          — current unrealised P&L (signed, dollars)
//   pnlMax: number       — session max P&L (for gauge scaling)
//   drawdown: number     — current drawdown 0–1
//   maxDrawdown: number  — session max drawdown 0–1
//   positionSize: number — current notional 0–1 (fraction of max)
//   direction: "LONG"|"SHORT"|"FLAT"
//
// ConfluenceOrb:
//   bankAScore: number   — Bank A net −1…+1
//   bankBScore: number   — Bank B net −1…+1
//   bankCScore: number   — Bank C net −1…+1
//   kellyFire: boolean   — fractional Kelly threshold crossed
//   direction: "LONG"|"SHORT"|"FLAT"
//
// VolumeOrb:
//   delta: number        — current bar delta −1…+1 (signed)
//   cumDelta: number     — cumulative session delta −1…+1 (signed)
//   absorption: number   — 0–1 (how much aggression was absorbed)
//   tapeSpeed: number    — 0–1 prints-per-second normalised
//   direction: "LONG"|"SHORT"|"FLAT"
//
// TVWebhookOrb:
//   connected: boolean   — webhook endpoint reachable
//   lastFiredMs: number  — ms since last webhook fired (0 = never)
//   latencyMs: number    — last round-trip ms
//   action: "BUY"|"SELL"|"CLOSE"|"IDLE"
//   fireCount: number    — total fires this session
//
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";

// ── SHARED TOKENS ────────────────────────────────────────────────────────────
const C = {
  cyan:   "#22d3ee",
  red:    "#ef4444",
  amber:  "#f59e0b",
  purple: "#818cf8",
  green:  "#4ade80",
  pink:   "#f43f5e",
  bg:     "#050911",
  ring:   "#0d1f2e",
  font:   "'Barlow Condensed', sans-serif",
} as const;

function dirColor(dir: string) {
  if (dir === "LONG")  return C.cyan;
  if (dir === "SHORT") return C.red;
  return C.purple;
}

// ── SHARED MATH ──────────────────────────────────────────────────────────────
function arc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  if (endDeg - startDeg >= 359.9) endDeg = startDeg + 359.8;
  const toRad = (d: number) => ((d - 90) * Math.PI) / 180;
  const [s, e] = [toRad(startDeg), toRad(endDeg)];
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx + r * Math.cos(s)} ${cy + r * Math.sin(s)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(e)} ${cy + r * Math.sin(e)}`;
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function clamp(v: number, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, v)); }

// ── SHARED KEYFRAMES (injected once via a module-level flag) ─────────────────
const KF = `
@keyframes orbBreath2   { 0%,100%{opacity:0.5}  50%{opacity:1} }
@keyframes orbSpin2     { from{transform:rotate(0deg)}   to{transform:rotate(360deg)} }
@keyframes orbSpinR2    { from{transform:rotate(360deg)} to{transform:rotate(0deg)} }
@keyframes orbBeat2     { 0%,100%{opacity:0.6}  50%{opacity:1} }
@keyframes orbPulse2    { 0%{opacity:0.9;r:10} 100%{opacity:0;r:52} }
@keyframes orbFlash2    { 0%,100%{opacity:0.2} 50%{opacity:0.7} }
@keyframes orbTape2     { from{stroke-dashoffset:20} to{stroke-dashoffset:0} }
@keyframes orbLatency2  { 0%{opacity:1} 100%{opacity:0;r:30} }
.ob2-breath  { animation: orbBreath2 3.2s ease-in-out infinite; }
.ob2-spin    { animation: orbSpin2   13s  linear         infinite; transform-box:fill-box; transform-origin:center; }
.ob2-spinrev { animation: orbSpinR2  19s  linear         infinite; transform-box:fill-box; transform-origin:center; }
.ob2-beat    { animation: orbBeat2   1.8s ease-in-out    infinite; }
.ob2-flash   { animation: orbFlash2  0.9s ease-in-out    infinite; }
.ob2-tape    { animation: orbTape2   1.1s linear         infinite; stroke-dasharray:5 5; }
`;

let kfInjected = false;
function useKF() {
  useEffect(() => {
    if (kfInjected) return;
    kfInjected = true;
    const s = document.createElement("style");
    s.textContent = KF;
    document.head.appendChild(s);
  }, []);
}

// ── SHARED ORB SHELL ─────────────────────────────────────────────────────────
interface ShellProps {
  color: string;
  strokeColor?: string;
  children: React.ReactNode;
  badge: string;
  badgeColor?: string;
  pulseKey?: number;
}

function OrbShell({ color, strokeColor, children, badge, badgeColor, pulseKey = 0 }: ShellProps) {
  const sc = strokeColor ?? color;
  const bc = badgeColor ?? color;
  const id = badge.replace(/\s/g, "_").toLowerCase();
  return (
    <svg viewBox="0 0 136 136" width="160" height="160" style={{ display: "block" }}>
      <defs>
        <filter id={`glow-${id}`} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id={`aglow-${id}`} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="5.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id={`bg-${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor={color} stopOpacity="0.16" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Base shell */}
      <circle cx="68" cy="68" r="63" fill={C.bg} stroke={sc + "33"} strokeWidth="1.2" />
      <circle cx="68" cy="68" r="63" fill={`url(#bg-${id})`} className="ob2-breath" />

      {/* Spinning outer orbit rings */}
      <circle cx="68" cy="68" r="62" fill="none"
        stroke={color + "18"} strokeWidth="0.5" strokeDasharray="4 8"
        className="ob2-spin" />
      <circle cx="68" cy="68" r="60" fill="none"
        stroke={color + "0c"} strokeWidth="0.5" strokeDasharray="2 12"
        className="ob2-spinrev" />

      {/* Pulse ring */}
      <circle key={pulseKey} cx="68" cy="68" r="10"
        fill="none" stroke={color} strokeWidth="1.5"
        style={{ animation: "orbPulse2 1.1s ease-out forwards",
                 transformBox: "fill-box", transformOrigin: "center" }} />

      {children}

      {/* Badge */}
      <rect x="68" y="112" width={badge.length * 6.5 + 10} height="13" rx="2"
        fill="#04070db0" stroke={bc + "44"} strokeWidth="0.5"
        transform={`translate(${-(badge.length * 6.5 + 10) / 2}, 0)`} />
      <text x="68" y="118.5"
        textAnchor="middle" dominantBaseline="central"
        fill={bc} fontSize="7" fontWeight="700" letterSpacing="2"
        fontFamily={C.font}
      >{badge}</text>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. PRICE ORB
//    Mini candle chart (7 bars), VWAP line, bid/ask spread ring
// ═══════════════════════════════════════════════════════════════════════════

interface Candle { o: number; h: number; l: number; c: number; }

interface PriceOrbProps {
  candles?: Candle[];
  vwap?: number;
  bid?: number;
  ask?: number;
  direction?: string;
}

const DEMO_CANDLES: Candle[] = [
  { o: 100, h: 103, l: 99,  c: 102 },
  { o: 102, h: 104, l: 101, c: 103 },
  { o: 103, h: 105, l: 102, c: 102 },
  { o: 102, h: 104, l: 100, c: 101 },
  { o: 101, h: 104, l: 100, c: 103 },
  { o: 103, h: 106, l: 102, c: 105 },
  { o: 105, h: 107, l: 104, c: 106 },
];

export function PriceOrb({
  candles = DEMO_CANDLES,
  vwap = 103.2,
  bid = 105.8,
  ask = 106.1,
  direction = "LONG",
}: PriceOrbProps) {
  useKF();
  const col = dirColor(direction);
  const [pulse, setPulse] = useState(0);
  const prevC = useRef(candles[candles.length - 1]?.c ?? 0);
  useEffect(() => {
    const last = candles[candles.length - 1]?.c ?? 0;
    if (last !== prevC.current) { setPulse(k => k + 1); prevC.current = last; }
  }, [candles]);

  const cx = 68, cy = 68;
  const spread = ask - bid;
  const spreadPct = clamp(spread / (ask * 0.005)); // normalised vs 0.5% max
  const spreadDeg = spreadPct * 320;

  // Chart area: x 22–106, y 32–92 (inside the orb)
  const chartX0 = 22, chartX1 = 106, chartY0 = 32, chartY1 = 90;
  const chartW = chartX1 - chartX0, chartH = chartY1 - chartY0;

  const cSlice = candles.slice(-7);
  const allPrices = cSlice.flatMap(c => [c.h, c.l]);
  const priceMin = Math.min(...allPrices);
  const priceMax = Math.max(...allPrices);
  const priceRange = priceMax - priceMin || 1;

  const toY = (p: number) => chartY1 - ((p - priceMin) / priceRange) * chartH;
  const barW = chartW / (cSlice.length * 2 - 1);
  const vwapY = toY(vwap);

  return (
    <div style={{ position: "relative", width: 160, height: 160, flexShrink: 0 }}>
      <OrbShell color={col} badge="PRICE · VWAP" pulseKey={pulse}>

        {/* Spread ring (outer, thin) */}
        {spreadDeg > 0 && (
          <path d={arc(cx, cy, 56, -160, -160 + spreadDeg)}
            stroke={C.amber} strokeWidth="2" fill="none"
            strokeLinecap="round" opacity="0.45" />
        )}
        <text x={cx + 52} y={cy - 46}
          textAnchor="start" dominantBaseline="central"
          fill={C.amber} fontSize="7" fontWeight="700" fontFamily={C.font}
          opacity="0.6"
        >{(spread).toFixed(2)}</text>

        {/* Chart background zone */}
        <rect x={chartX0 - 2} y={chartY0 - 2} width={chartW + 4} height={chartH + 4}
          fill={col + "06"} rx="3" />

        {/* Candles */}
        {cSlice.map((c, i) => {
          const bx = chartX0 + i * (barW * 2);
          const isBull = c.c >= c.o;
          const candleCol = isBull ? C.cyan : C.red;
          const bodyTop    = toY(Math.max(c.o, c.c));
          const bodyBot    = toY(Math.min(c.o, c.c));
          const bodyH      = Math.max(1.5, bodyBot - bodyTop);
          return (
            <g key={i}>
              {/* Wick */}
              <line x1={bx + barW / 2} y1={toY(c.h)}
                    x2={bx + barW / 2} y2={toY(c.l)}
                stroke={candleCol} strokeWidth="0.8" opacity="0.7" />
              {/* Body */}
              <rect x={bx} y={bodyTop} width={barW} height={bodyH}
                fill={isBull ? candleCol : "none"}
                stroke={candleCol} strokeWidth="0.8"
                opacity={i === cSlice.length - 1 ? 1 : 0.65} />
            </g>
          );
        })}

        {/* VWAP line */}
        {vwap >= priceMin && vwap <= priceMax && (
          <line x1={chartX0} y1={vwapY} x2={chartX1} y2={vwapY}
            stroke={C.amber} strokeWidth="1" strokeDasharray="3 2" opacity="0.8" />
        )}
        <text x={chartX0} y={vwapY - 3}
          textAnchor="start" dominantBaseline="central"
          fill={C.amber} fontSize="6" fontFamily={C.font} opacity="0.7"
        >VWAP</text>

        {/* Latest price */}
        <text x={cx} y={chartY1 + 10}
          textAnchor="middle" dominantBaseline="central"
          fill={col} fontSize="12" fontWeight="900" fontFamily={C.font}
          filter="url(#aglow-price_·_vwap)"
        >{cSlice[cSlice.length - 1]?.c?.toFixed(2) ?? "--"}</text>

        {/* Bid/Ask labels */}
        <text x={chartX0} y={chartY1 + 22}
          textAnchor="start" dominantBaseline="central"
          fill={C.green} fontSize="7" fontFamily={C.font} opacity="0.7"
        >B {bid.toFixed(2)}</text>
        <text x={chartX1} y={chartY1 + 22}
          textAnchor="end" dominantBaseline="central"
          fill={C.red} fontSize="7" fontFamily={C.font} opacity="0.7"
        >A {ask.toFixed(2)}</text>

        {/* Core dot */}
        <circle cx={cx} cy={cy} r="3" fill={col} opacity="0.4" />
      </OrbShell>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. RISK ORB
//    P&L arc (outer), drawdown gauge (mid), position size ring (inner)
// ═══════════════════════════════════════════════════════════════════════════

interface RiskOrbProps {
  pnl?: number;
  pnlMax?: number;
  drawdown?: number;
  maxDrawdown?: number;
  positionSize?: number;
  direction?: string;
}

export function RiskOrb({
  pnl = 0,
  pnlMax = 500,
  drawdown = 0,
  maxDrawdown = 0,
  positionSize = 0,
  direction = "FLAT",
}: RiskOrbProps) {
  useKF();
  const isProfit = pnl >= 0;
  const pnlCol   = isProfit ? C.green : C.red;
  const ddCol    = drawdown > 0.5 ? C.red : drawdown > 0.25 ? C.amber : C.green;
  const sizeCol  = dirColor(direction);

  const [pulse, setPulse] = useState(0);
  const prevPnl = useRef(pnl);
  useEffect(() => {
    if (pnl !== prevPnl.current) { setPulse(k => k + 1); prevPnl.current = pnl; }
  }, [pnl]);

  const cx = 68, cy = 68;
  const pnlNorm = clamp(Math.abs(pnl) / (pnlMax || 1));
  const pnlDeg  = pnlNorm * 330;
  const ddDeg   = clamp(drawdown) * 310;
  const mdDeg   = clamp(maxDrawdown) * 310;
  const sizeDeg = clamp(positionSize) * 340;
  const id = "risk";

  return (
    <div style={{ position: "relative", width: 160, height: 160, flexShrink: 0 }}>
      <OrbShell color={pnlCol} badge="RISK · P&L" pulseKey={pulse}
        badgeColor={pnl >= 0 ? C.green : C.red}>

        {/* ── P&L ARC (outer, r=56) ── */}
        <circle cx={cx} cy={cy} r="56" fill="none" stroke={C.ring} strokeWidth="0.5" />
        {pnlDeg > 0 && (
          <path d={arc(cx, cy, 56, -5, -5 + pnlDeg)}
            stroke={pnlCol} strokeWidth="5" fill="none"
            strokeLinecap="round" opacity="0.7"
            filter={`url(#glow-${id})`} />
        )}

        {/* ── MAX DRAWDOWN GHOST ARC (r=48) ── */}
        <circle cx={cx} cy={cy} r="48" fill="none" stroke={C.ring} strokeWidth="0.5" />
        {mdDeg > 0 && (
          <path d={arc(cx, cy, 48, 185, 185 + mdDeg)}
            stroke={C.red} strokeWidth="2" fill="none"
            strokeLinecap="round" opacity="0.25" />
        )}
        {/* Current drawdown */}
        {ddDeg > 0 && (
          <path d={arc(cx, cy, 48, 185, 185 + ddDeg)}
            stroke={ddCol} strokeWidth="4" fill="none"
            strokeLinecap="round" opacity={0.55 + clamp(drawdown) * 0.35}
            filter={`url(#glow-${id})`} />
        )}

        {/* ── POSITION SIZE RING (inner, r=38) ── */}
        <circle cx={cx} cy={cy} r="38" fill="none" stroke={C.ring} strokeWidth="0.5" />
        {sizeDeg > 0 && (
          <path d={arc(cx, cy, 38, 0, sizeDeg)}
            stroke={sizeCol} strokeWidth="3" fill="none"
            strokeLinecap="round" opacity="0.55" />
        )}

        {/* ── CORE ── */}
        <circle cx={cx} cy={cy} r="22" fill={pnlCol + "0d"} stroke={pnlCol}
          strokeWidth={0.5 + pnlNorm * 1.5} opacity={0.25 + pnlNorm * 0.4} />
        <circle cx={cx} cy={cy} r="4" fill={pnlCol} opacity="0.65" />
        <circle cx={cx} cy={cy} r="1.8" fill="#fff" opacity="0.55" />

        {/* ── LABELS ── */}
        {/* P&L value */}
        <text x={cx} y={cy - 6}
          textAnchor="middle" dominantBaseline="central"
          fill={pnlCol} fontSize="14" fontWeight="900" fontFamily={C.font}
          filter={`url(#aglow-${id})`}
        >{pnl >= 0 ? "+" : ""}{pnl.toFixed(0)}</text>
        <text x={cx} y={cy + 10}
          textAnchor="middle" dominantBaseline="central"
          fill={pnlCol} fontSize="7" fontFamily={C.font} opacity="0.6"
        >P&amp;L</text>

        {/* Drawdown label */}
        <text x={cx - 36} y={cy + 34}
          textAnchor="middle" dominantBaseline="central"
          fill={ddCol} fontSize="8" fontWeight="700" fontFamily={C.font}
        >DD {(drawdown * 100).toFixed(1)}%</text>

        {/* Size label */}
        <text x={cx + 36} y={cy - 30}
          textAnchor="middle" dominantBaseline="central"
          fill={sizeCol} fontSize="8" fontWeight="700" fontFamily={C.font}
        >{(positionSize * 100).toFixed(0)}%</text>
        <text x={cx + 36} y={cy - 19}
          textAnchor="middle" dominantBaseline="central"
          fill={sizeCol} fontSize="6" fontFamily={C.font} opacity="0.6"
        >SIZE</text>

        {/* Alert flash when drawdown > 0.5 */}
        {drawdown > 0.5 && (
          <circle cx={cx + 48} cy={cy - 48} r="5" fill={C.red} className="ob2-flash" />
        )}
      </OrbShell>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. CONFLUENCE ORB
//    A×B×C radial spokes, agreement heat ring, Kelly fire indicator
// ═══════════════════════════════════════════════════════════════════════════

interface ConfluenceOrbProps {
  bankAScore?: number;
  bankBScore?: number;
  bankCScore?: number;
  kellyFire?: boolean;
  direction?: string;
}

export function ConfluenceOrb({
  bankAScore = 0,
  bankBScore = 0,
  bankCScore = 0,
  kellyFire = false,
  direction = "FLAT",
}: ConfluenceOrbProps) {
  useKF();
  const col   = dirColor(direction);
  const agree = (Math.sign(bankAScore) === Math.sign(bankBScore) &&
                 Math.sign(bankBScore) === Math.sign(bankCScore) &&
                 bankAScore !== 0);
  const confluencePct = (Math.abs(bankAScore) + Math.abs(bankBScore) + Math.abs(bankCScore)) / 3;
  const heatCol = confluencePct > 0.7 ? C.red : confluencePct > 0.4 ? C.amber : C.cyan;

  const [pulse, setPulse] = useState(0);
  const prevKelly = useRef(kellyFire);
  useEffect(() => {
    if (kellyFire !== prevKelly.current) { setPulse(k => k + 1); prevKelly.current = kellyFire; }
  }, [kellyFire]);

  const cx = 68, cy = 68;
  const id = "confluence";

  // Heat ring
  const heatDeg = clamp(confluencePct) * 350;

  // Spoke data: A=top(270°), B=right(30°), C=left(150°)  then mirrored for sign
  const spokes = [
    { score: bankAScore, color: C.cyan,   label: "A", anglePlus: 270, angleMinus: 90 },
    { score: bankBScore, color: C.purple, label: "B", anglePlus: 30,  angleMinus: 210 },
    { score: bankCScore, color: C.green,  label: "C", anglePlus: 150, angleMinus: 330 },
  ];

  return (
    <div style={{ position: "relative", width: 160, height: 160, flexShrink: 0 }}>
      <OrbShell color={col} badge="CONFLUENCE" pulseKey={pulse}
        badgeColor={kellyFire ? C.amber : col}>

        {/* ── HEAT RING (outer, agreement intensity) ── */}
        <circle cx={cx} cy={cy} r="56" fill="none" stroke={C.ring} strokeWidth="0.5" />
        {heatDeg > 0 && (
          <path d={arc(cx, cy, 56, 0, heatDeg)}
            stroke={heatCol} strokeWidth="5" fill="none"
            strokeLinecap="round"
            opacity={0.4 + confluencePct * 0.5}
            filter={`url(#glow-${id})`} />
        )}

        {/* ── 8 SEGMENT TICKS (like conviction ring) ── */}
        {Array.from({ length: 24 }, (_, i) => {
          const deg = i * 15;
          const p1  = polar(cx, cy, 58, deg);
          const p2  = polar(cx, cy, 61, deg);
          return (
            <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke={heatCol} strokeWidth="0.5" opacity="0.3" />
          );
        })}

        {/* ── AGREEMENT INDICATOR RING (mid) ── */}
        <circle cx={cx} cy={cy} r="46" fill="none" stroke={C.ring} strokeWidth="0.5" />
        {agree && (
          <circle cx={cx} cy={cy} r="46" fill="none"
            stroke={col} strokeWidth="2"
            strokeDasharray="4 4"
            opacity="0.5"
            className="ob2-spin" />
        )}

        {/* ── BANK SPOKES (A, B, C) ── */}
        {spokes.map(({ score, color: sc, label, anglePlus, angleMinus }) => {
          const absScore = Math.abs(score);
          const angle    = score >= 0 ? anglePlus : angleMinus;
          const r_inner  = 18;
          const r_outer  = 18 + absScore * 26;
          const p1       = polar(cx, cy, r_inner, angle);
          const p2       = polar(cx, cy, r_outer, angle);
          const lp       = polar(cx, cy, r_outer + 8, angle);
          return (
            <g key={label}>
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                stroke={sc} strokeWidth={2 + absScore * 2}
                strokeLinecap="round" opacity={0.3 + absScore * 0.65}
                filter={absScore > 0.5 ? `url(#glow-${id})` : undefined} />
              <circle cx={p2.x} cy={p2.y} r={2 + absScore * 2}
                fill={sc} opacity={0.5 + absScore * 0.4} />
              <text x={lp.x} y={lp.y}
                textAnchor="middle" dominantBaseline="central"
                fill={sc} fontSize="8" fontWeight="900" fontFamily={C.font}
                opacity={0.5 + absScore * 0.5}
              >{label}</text>
            </g>
          );
        })}

        {/* ── INNER CONSENSUS CIRCLE ── */}
        <circle cx={cx} cy={cy} r="16"
          fill={col + "0d"} stroke={col}
          strokeWidth={0.5 + confluencePct * 2}
          opacity={0.2 + confluencePct * 0.5}
          filter={`url(#glow-${id})`} />
        <circle cx={cx} cy={cy} r="4" fill={col} opacity="0.65" />
        <circle cx={cx} cy={cy} r="1.8" fill="#fff" opacity="0.55" />

        {/* ── CONFLUENCE % ── */}
        <text x={cx} y={cy - 22}
          textAnchor="middle" dominantBaseline="central"
          fill={heatCol} fontSize="11" fontWeight="900" fontFamily={C.font}
          opacity="0.85"
        >{(confluencePct * 100).toFixed(0)}%</text>

        {/* ── KELLY FIRE INDICATOR ── */}
        {kellyFire ? (
          <>
            <circle cx={cx + 44} cy={cy - 44} r="7"
              fill={C.amber + "22"} stroke={C.amber}
              strokeWidth="1.2" className="ob2-beat" />
            <text x={cx + 44} y={cy - 44}
              textAnchor="middle" dominantBaseline="central"
              fill={C.amber} fontSize="8" fontWeight="900" fontFamily={C.font}
              className="ob2-flash"
            >K</text>
          </>
        ) : (
          <circle cx={cx + 44} cy={cy - 44} r="4"
            fill="none" stroke={C.ring} strokeWidth="0.5" />
        )}
      </OrbShell>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. VOLUME ORB
//    Delta bar, cumDelta river, absorption shield ticks, tape speed
// ═══════════════════════════════════════════════════════════════════════════

interface VolumeOrbProps {
  delta?: number;
  cumDelta?: number;
  absorption?: number;
  tapeSpeed?: number;
  direction?: string;
}

export function VolumeOrb({
  delta = 0,
  cumDelta = 0,
  absorption = 0,
  tapeSpeed = 0,
  direction = "FLAT",
}: VolumeOrbProps) {
  useKF();
  const deltaCol  = delta >= 0 ? C.cyan : C.red;
  const cdCol     = cumDelta >= 0 ? C.cyan : C.red;
  const absCol    = absorption > 0.6 ? C.amber : C.green;
  const col       = dirColor(direction);

  const [pulse, setPulse] = useState(0);
  const prevD = useRef(delta);
  useEffect(() => {
    if (delta !== prevD.current) { setPulse(k => k + 1); prevD.current = delta; }
  }, [delta]);

  const cx = 68, cy = 68;
  const id = "volume";

  // Delta arc (outer, signed)
  const deltaDeg  = clamp(Math.abs(delta)) * 330;
  const deltaStart = delta >= 0 ? 0 : 180;

  // CumDelta arc (mid ring, signed)
  const cdDeg   = clamp(Math.abs(cumDelta)) * 280;
  const cdStart = cumDelta >= 0 ? 20 : 200;

  // Absorption shield ticks (30 ticks, lit by absorption)
  const tickTotal = 30;
  const tickLit   = Math.round(clamp(absorption) * tickTotal);

  // Tape speed bars (6 vertical bars, bottom)
  const tapeBars = 6;
  const tapeLit  = Math.round(clamp(tapeSpeed) * tapeBars);

  // CumDelta river path (horizontal wave across center)
  const riverY  = cy + clamp(cumDelta) * -18; // shifts up for long, down for short
  const riverX0 = 22, riverX1 = 114;

  return (
    <div style={{ position: "relative", width: 160, height: 160, flexShrink: 0 }}>
      <OrbShell color={col} badge="VOL · DELTA" pulseKey={pulse}
        badgeColor={delta >= 0 ? C.cyan : C.red}>

        {/* ── ABSORPTION SHIELD (outer ticks) ── */}
        {Array.from({ length: tickTotal }, (_, i) => {
          const deg = (i / tickTotal) * 360;
          const lit = i < tickLit;
          const p1  = polar(cx, cy, 57, deg);
          const p2  = polar(cx, cy, lit ? 51 : 54, deg);
          return (
            <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke={lit ? absCol : C.ring}
              strokeWidth={lit ? 1.5 : 0.5}
              opacity={lit ? 0.6 + (i / tickTotal) * 0.3 : 0.2} />
          );
        })}

        {/* ── DELTA ARC (r=48) ── */}
        <circle cx={cx} cy={cy} r="48" fill="none" stroke={C.ring} strokeWidth="0.5" />
        {deltaDeg > 0 && (
          <path d={arc(cx, cy, 48, deltaStart, deltaStart + deltaDeg)}
            stroke={deltaCol} strokeWidth="5.5" fill="none"
            strokeLinecap="round"
            opacity={0.5 + clamp(Math.abs(delta)) * 0.45}
            filter={`url(#glow-${id})`} />
        )}

        {/* ── CUM DELTA ARC (r=38) ── */}
        <circle cx={cx} cy={cy} r="38" fill="none" stroke={C.ring} strokeWidth="0.5" />
        {cdDeg > 0 && (
          <path d={arc(cx, cy, 38, cdStart, cdStart + cdDeg)}
            stroke={cdCol} strokeWidth="3.5" fill="none"
            strokeLinecap="round" opacity="0.55"
            className="ob2-spinrev"
          />
        )}

        {/* ── CUM DELTA RIVER LINE (horizontal, shifts with cumDelta) ── */}
        <line x1={riverX0} y1={riverY} x2={riverX1} y2={riverY}
          stroke={cdCol} strokeWidth="1.2" opacity="0.45"
          strokeDasharray="5 3"
          className="ob2-tape" />

        {/* ── TAPE SPEED BARS (bottom strip) ── */}
        {Array.from({ length: tapeBars }, (_, i) => {
          const lit  = i < tapeLit;
          const bx   = cx - (tapeBars * 7) / 2 + i * 7 + 1;
          const bh   = 5 + i * 1.5;
          return (
            <rect key={i} x={bx} y={cy + 26 - bh / 2}
              width="5" height={bh} rx="1"
              fill={lit ? col : C.ring}
              opacity={lit ? 0.55 + i * 0.08 : 0.15} />
          );
        })}

        {/* ── CORE ── */}
        <circle cx={cx} cy={cy} r="20"
          fill={deltaCol + "0a"} stroke={deltaCol}
          strokeWidth={0.5 + clamp(Math.abs(delta)) * 1.5}
          opacity={0.2 + clamp(Math.abs(delta)) * 0.45} />
        <circle cx={cx} cy={cy} r="4" fill={deltaCol} opacity="0.65" />
        <circle cx={cx} cy={cy} r="1.8" fill="#fff" opacity="0.55" />

        {/* ── DELTA VALUE ── */}
        <text x={cx} y={cy - 6}
          textAnchor="middle" dominantBaseline="central"
          fill={deltaCol} fontSize="13" fontWeight="900" fontFamily={C.font}
          filter={`url(#aglow-${id})`}
        >{delta >= 0 ? "+" : ""}{(delta * 100).toFixed(0)}</text>
        <text x={cx} y={cy + 8}
          textAnchor="middle" dominantBaseline="central"
          fill={deltaCol} fontSize="6" fontFamily={C.font} opacity="0.55"
        >Δ</text>

        {/* Absorption label */}
        <text x={cx} y={cy - 38}
          textAnchor="middle" dominantBaseline="central"
          fill={absCol} fontSize="7" fontWeight="700" fontFamily={C.font} opacity="0.7"
        >ABS {(absorption * 100).toFixed(0)}%</text>

        {/* CumDelta label */}
        <text x={cx} y={cy + 40}
          textAnchor="middle" dominantBaseline="central"
          fill={cdCol} fontSize="7" fontWeight="700" fontFamily={C.font} opacity="0.7"
        >ΣΔ {cumDelta >= 0 ? "+" : ""}{(cumDelta * 100).toFixed(0)}</text>
      </OrbShell>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. TV WEBHOOK ORB
//    Pine→webhook→exec pipeline. Latency pulse, fire counter, action state.
// ═══════════════════════════════════════════════════════════════════════════

interface TVWebhookOrbProps {
  connected?: boolean;
  lastFiredMs?: number;
  latencyMs?: number;
  action?: "BUY" | "SELL" | "CLOSE" | "IDLE";
  fireCount?: number;
}

const ACTION_COLOR: Record<string, string> = {
  BUY:   C.cyan,
  SELL:  C.red,
  CLOSE: C.amber,
  IDLE:  C.purple,
};

export function TVWebhookOrb({
  connected = false,
  lastFiredMs = 0,
  latencyMs = 0,
  action = "IDLE",
  fireCount = 0,
}: TVWebhookOrbProps) {
  useKF();
  const [latPulse, setLatPulse] = useState(0);
  const prevFire   = useRef(fireCount);

  // Pulse on new fire
  useEffect(() => {
    if (fireCount !== prevFire.current) {
      setLatPulse(k => k + 1);
      prevFire.current = fireCount;
    }
  }, [fireCount]);

  const col     = ACTION_COLOR[action] ?? C.purple;
  const connCol = connected ? C.green : C.red;
  const cx      = 68, cy = 68;
  const id      = "tvwh";

  // Latency bar (0–500ms → 0–1)
  const latNorm   = clamp(latencyMs / 500);
  const latCol    = latencyMs > 300 ? C.red : latencyMs > 100 ? C.amber : C.green;
  const latDeg    = latNorm * 320;

  // Age since last fire (seconds)
  const ageSec    = Math.floor(lastFiredMs / 1000);
  const ageLabel  = ageSec < 60 ? `${ageSec}s` : `${Math.floor(ageSec / 60)}m`;
  const ageNorm   = clamp(1 - ageSec / 120); // fades after 2min
  const ageDeg    = ageNorm * 340;

  // Pipeline stages: Pine → Webhook → Server → Exec (3 arrows at center)
  const stages = [
    { label: "PINE",    x: 28 },
    { label: "HOOK",    x: 52 },
    { label: "EXEC",    x: 76 },
    { label: "ALPACA",  x: 100 },
  ];

  return (
    <div style={{ position: "relative", width: 160, height: 160, flexShrink: 0 }}>
      <OrbShell color={connected ? col : C.ring} badge="TV · WEBHOOK"
        badgeColor={connected ? col : C.red} pulseKey={latPulse}>

        {/* ── CONNECTION STATUS (outer ring) ── */}
        <circle cx={cx} cy={cy} r="56" fill="none" stroke={C.ring} strokeWidth="0.5" />
        {connected && (
          <circle cx={cx} cy={cy} r="56" fill="none"
            stroke={connCol} strokeWidth="1.5"
            strokeDasharray="5 5" opacity="0.35"
            className="ob2-spin" />
        )}

        {/* ── LATENCY ARC (r=48) ── */}
        <circle cx={cx} cy={cy} r="48" fill="none" stroke={C.ring} strokeWidth="0.5" />
        {latDeg > 0 && connected && (
          <path d={arc(cx, cy, 48, 10, 10 + latDeg)}
            stroke={latCol} strokeWidth="3.5" fill="none"
            strokeLinecap="round" opacity="0.6"
            filter={`url(#glow-${id})`} />
        )}

        {/* ── AGE SINCE FIRE (r=38) ── */}
        <circle cx={cx} cy={cy} r="38" fill="none" stroke={C.ring} strokeWidth="0.5" />
        {ageDeg > 0 && lastFiredMs > 0 && (
          <path d={arc(cx, cy, 38, 0, ageDeg)}
            stroke={col} strokeWidth="2.5" fill="none"
            strokeLinecap="round" opacity={0.3 + ageNorm * 0.45} />
        )}

        {/* ── PIPELINE ARROWS (horizontal flow) ── */}
        {stages.map((s, i) => (
          <g key={i}>
            <text x={s.x} y={cy - 14}
              textAnchor="middle" dominantBaseline="central"
              fill={connected ? col : C.ring}
              fontSize="6" fontWeight="700" fontFamily={C.font}
              opacity={connected ? 0.65 : 0.25}
            >{s.label}</text>
            {i < stages.length - 1 && (
              <path
                d={`M ${s.x + 10} ${cy - 14} L ${stages[i + 1].x - 10} ${cy - 14}`}
                stroke={connected ? col : C.ring} strokeWidth="1"
                fill="none" opacity={connected ? 0.45 : 0.15}
                markerEnd={`url(#arr-${id})`}
              />
            )}
          </g>
        ))}

        {/* ── ACTION BADGE (center) ── */}
        <rect x={cx - 20} y={cy - 10} width="40" height="20" rx="3"
          fill={col + "1a"} stroke={col} strokeWidth="1"
          opacity={connected ? 1 : 0.3}
          className={action !== "IDLE" && connected ? "ob2-beat" : ""} />
        <text x={cx} y={cy}
          textAnchor="middle" dominantBaseline="central"
          fill={col} fontSize="11" fontWeight="900" fontFamily={C.font}
          opacity={connected ? 1 : 0.3}
          filter={connected && action !== "IDLE" ? `url(#aglow-${id})` : undefined}
        >{action}</text>

        {/* ── LATENCY PULSE on new fire ── */}
        <circle key={latPulse} cx={cx} cy={cy} r="10"
          fill="none" stroke={col} strokeWidth="1.5"
          style={{ animation: "orbLatency2 0.7s ease-out forwards",
                   transformBox: "fill-box", transformOrigin: "center" }} />

        {/* ── STATUS DOTS ── */}
        {/* Connection */}
        <circle cx={cx - 46} cy={cy + 38} r="4"
          fill={connCol} opacity="0.8"
          className={connected ? "ob2-beat" : ""} />
        <text x={cx - 38} y={cy + 38}
          textAnchor="start" dominantBaseline="central"
          fill={connCol} fontSize="7" fontFamily={C.font} opacity="0.7"
        >{connected ? "LIVE" : "OFF"}</text>

        {/* Fire count */}
        <text x={cx + 46} y={cy + 38}
          textAnchor="end" dominantBaseline="central"
          fill={col} fontSize="7" fontWeight="700" fontFamily={C.font} opacity="0.7"
        >×{fireCount}</text>

        {/* Last fired age */}
        {lastFiredMs > 0 && (
          <text x={cx} y={cy + 26}
            textAnchor="middle" dominantBaseline="central"
            fill={col} fontSize="7" fontFamily={C.font} opacity="0.5"
          >{ageLabel} ago</text>
        )}

        {/* Latency readout */}
        {connected && latencyMs > 0 && (
          <text x={cx} y={cy - 30}
            textAnchor="middle" dominantBaseline="central"
            fill={latCol} fontSize="7" fontWeight="700" fontFamily={C.font} opacity="0.75"
          >{latencyMs}ms</text>
        )}
      </OrbShell>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ORB ROW — convenience wrapper for side-by-side display
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// 6. INTERMARKET ORB (P2-D)
//    5 cross-asset dims as radial wedges + composite score.
//    Data: /v1/cross/report/  (cross_asset.py)
// ═══════════════════════════════════════════════════════════════════════════

interface CrossDim {
  score: number;       // -1..+1
  error?: string;
}

interface IntermarketOrbProps {
  composite?: number;
  regime?: "RISK_ON" | "NEUTRAL" | "RISK_OFF" | "UNKNOWN" | "STALE";
  dims?: {
    btc_eth_ratio?: CrossDim;
    alt_beta?: CrossDim;
    defi_momentum?: CrossDim;
    l1_spread?: CrossDim;
    btc_corr_break?: CrossDim;
  };
}

const DIM_LABELS = ["BTC/ETH", "ALT β", "DeFi", "L1", "CORR"];
const DIM_KEYS   = ["btc_eth_ratio", "alt_beta", "defi_momentum", "l1_spread", "btc_corr_break"] as const;
const DIM_START  = [252, 324, 36, 108, 180]; // 5 × 72° sectors, start angles

function regimeColor(regime: string) {
  if (regime === "RISK_ON")  return C.cyan;
  if (regime === "RISK_OFF") return C.red;
  return C.purple;
}

export function IntermarketOrb({
  composite = 0,
  regime = "UNKNOWN",
  dims = {},
}: IntermarketOrbProps) {
  useKF();
  const cx = 68, cy = 68;
  const id = "xmkt";
  const col = regimeColor(regime);

  const [pulse, setPulse] = useState(0);
  const prevComp = useRef(composite);
  useEffect(() => {
    if (composite !== prevComp.current) { setPulse(k => k + 1); prevComp.current = composite; }
  }, [composite]);

  // Outer ring: 5 wedge arcs (72° each, r=50..56)
  const SECTOR_DEG = 72;
  const R_OUTER = 55, R_INNER = 44;

  return (
    <div style={{ position: "relative", width: 160, height: 160, flexShrink: 0 }}>
      <OrbShell color={col} badge="XMARKET" pulseKey={pulse} badgeColor={col}>

        {/* ── SECTOR WEDGES ── */}
        {DIM_KEYS.map((key, i) => {
          const dim   = (dims as Record<string, CrossDim>)[key];
          const score = dim?.score ?? 0;
          const hasErr = !!dim?.error;
          const startDeg = DIM_START[i] + 2;
          const endDeg   = startDeg + SECTOR_DEG - 4;
          const arcR    = R_INNER + (R_OUTER - R_INNER) * 0.5;
          const fillPct = clamp(Math.abs(score));
          const dimCol  = hasErr ? C.ring : score >= 0 ? C.cyan : C.red;

          return (
            <g key={key}>
              {/* ghost track */}
              <path d={arc(cx, cy, arcR, startDeg, endDeg)}
                stroke={C.ring} strokeWidth="6" fill="none" opacity="0.4" />
              {/* active fill proportional to abs(score) */}
              {fillPct > 0.02 && (
                <path d={arc(cx, cy, arcR, startDeg, startDeg + (endDeg - startDeg) * fillPct)}
                  stroke={dimCol} strokeWidth="6" fill="none" strokeLinecap="round"
                  opacity={0.45 + fillPct * 0.45}
                  filter={`url(#glow-${id})`} />
              )}
              {/* label at midpoint */}
              {(() => {
                const midDeg = (startDeg + endDeg) / 2;
                const lp = polar(cx, cy, 62, midDeg);
                return (
                  <text x={lp.x} y={lp.y}
                    textAnchor="middle" dominantBaseline="central"
                    fill={dimCol} fontSize="4.5" fontWeight="700"
                    fontFamily={C.font} opacity={hasErr ? 0.25 : 0.7}
                  >{DIM_LABELS[i]}</text>
                );
              })()}
              {/* score tick at outer edge */}
              {(() => {
                const midDeg = (startDeg + endDeg) / 2;
                const p1 = polar(cx, cy, R_OUTER - 1, midDeg);
                const p2 = polar(cx, cy, R_OUTER + 4, midDeg);
                return (
                  <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                    stroke={dimCol} strokeWidth="1.5"
                    opacity={0.3 + fillPct * 0.55} />
                );
              })()}
            </g>
          );
        })}

        {/* ── COMPOSITE CORE ── */}
        <circle cx={cx} cy={cy} r="24"
          fill={col + "0a"} stroke={col}
          strokeWidth={0.5 + clamp(Math.abs(composite)) * 2}
          opacity={0.15 + clamp(Math.abs(composite)) * 0.5} />
        <circle cx={cx} cy={cy} r="5" fill={col} opacity="0.7" />
        <circle cx={cx} cy={cy} r="2" fill="#fff" opacity="0.6" />

        {/* composite value */}
        <text x={cx} y={cy - 7}
          textAnchor="middle" dominantBaseline="central"
          fill={col} fontSize="14" fontWeight="900" fontFamily={C.font}
          filter={`url(#aglow-${id})`}
        >{composite >= 0 ? "+" : ""}{composite.toFixed(2)}</text>

        {/* regime label */}
        <text x={cx} y={cy + 8}
          textAnchor="middle" dominantBaseline="central"
          fill={col} fontSize="5.5" fontWeight="700" fontFamily={C.font} opacity="0.6"
        >{regime}</text>

      </OrbShell>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. POSITIONING ORB (P2-E)
//    Fear index (realized vol percentile) + funding pressure + net bias.
//    Crypto analog to COT net positioning + VIX.
// ═══════════════════════════════════════════════════════════════════════════

interface PositioningOrbProps {
  fearIndex?: number;      // 0–1  (realized vol pct rank → crypto VIX)
  fundingPressure?: number; // 0–1  (from funding_signal.py, abs value)
  fundingBias?: "LONG" | "SHORT" | "NEUTRAL"; // LONG=shorts overloaded, SHORT=longs overloaded
  longBiasScore?: number;  // -1..+1 (net: +1=crowded long, -1=crowded short)
}

export function PositioningOrb({
  fearIndex = 0,
  fundingPressure = 0,
  fundingBias = "NEUTRAL",
  longBiasScore = 0,
}: PositioningOrbProps) {
  useKF();
  const cx = 68, cy = 68;
  const id = "posit";

  const fearCol    = fearIndex > 0.7 ? C.red : fearIndex > 0.4 ? C.amber : C.green;
  const fundCol    = fundingBias === "LONG" ? C.cyan : fundingBias === "SHORT" ? C.red : C.purple;
  const biasCol    = longBiasScore >= 0 ? C.cyan : C.red;
  const shellCol   = fearIndex > 0.7 ? C.red : biasCol;

  // Fear arc — outer ring, 0-330°, red=extreme fear
  const fearDeg = clamp(fearIndex) * 330;
  // Funding arc — mid ring
  const fundDeg = clamp(fundingPressure) * 280;
  // Bias needle (inner, pointing up=long, down=short)
  const needleDeg = 270 + longBiasScore * 120; // ±120° around 270° (top)

  const [pulse, setPulse] = useState(0);
  const prevFear = useRef(fearIndex);
  useEffect(() => {
    if (fearIndex !== prevFear.current) { setPulse(k => k + 1); prevFear.current = fearIndex; }
  }, [fearIndex]);

  const needleTip = polar(cx, cy, 28, needleDeg);
  const needleBase1 = polar(cx, cy, 6, needleDeg + 90);
  const needleBase2 = polar(cx, cy, 6, needleDeg - 90);

  // Fear tick ring (24 ticks)
  const TICKS = 24;
  const litTicks = Math.round(clamp(fearIndex) * TICKS);

  return (
    <div style={{ position: "relative", width: 160, height: 160, flexShrink: 0 }}>
      <OrbShell color={shellCol} badge="POSITION" pulseKey={pulse} badgeColor={fearCol}>

        {/* ── FEAR TICK RING (outer) ── */}
        {Array.from({ length: TICKS }, (_, i) => {
          const deg = (i / TICKS) * 360 - 15;
          const lit = i < litTicks;
          const p1  = polar(cx, cy, 56, deg);
          const p2  = polar(cx, cy, lit ? 50 : 53, deg);
          return (
            <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke={lit ? fearCol : C.ring}
              strokeWidth={lit ? 1.8 : 0.6}
              opacity={lit ? 0.5 + (i / TICKS) * 0.45 : 0.2} />
          );
        })}

        {/* ── FEAR ARC (r=47) ── */}
        <circle cx={cx} cy={cy} r="47" fill="none" stroke={C.ring} strokeWidth="0.5" />
        {fearDeg > 0 && (
          <path d={arc(cx, cy, 47, 15, 15 + fearDeg)}
            stroke={fearCol} strokeWidth="4.5" fill="none" strokeLinecap="round"
            opacity={0.45 + clamp(fearIndex) * 0.45}
            filter={`url(#glow-${id})`} />
        )}

        {/* ── FUNDING PRESSURE ARC (r=37) ── */}
        <circle cx={cx} cy={cy} r="37" fill="none" stroke={C.ring} strokeWidth="0.5" />
        {fundDeg > 0 && (
          <path d={arc(cx, cy, 37, 40, 40 + fundDeg)}
            stroke={fundCol} strokeWidth="3.5" fill="none" strokeLinecap="round"
            opacity="0.6" className="ob2-spinrev" />
        )}

        {/* ── BIAS NEEDLE ── */}
        <polygon
          points={`${needleTip.x},${needleTip.y} ${needleBase1.x},${needleBase1.y} ${needleBase2.x},${needleBase2.y}`}
          fill={biasCol} opacity="0.75" />
        <circle cx={cx} cy={cy} r="6" fill={C.bg} stroke={biasCol} strokeWidth="1.5" />
        <circle cx={cx} cy={cy} r="2.5" fill={biasCol} opacity="0.8" />

        {/* fear value */}
        <text x={cx} y={cy - 30}
          textAnchor="middle" dominantBaseline="central"
          fill={fearCol} fontSize="7" fontWeight="700" fontFamily={C.font} opacity="0.75"
        >FEAR {(fearIndex * 100).toFixed(0)}%</text>

        {/* funding label */}
        <text x={cx} y={cy + 32}
          textAnchor="middle" dominantBaseline="central"
          fill={fundCol} fontSize="6.5" fontWeight="700" fontFamily={C.font} opacity="0.7"
        >FUND {fundingBias}</text>

        {/* bias label */}
        <text x={cx} y={cy + 43}
          textAnchor="middle" dominantBaseline="central"
          fill={biasCol} fontSize="6" fontFamily={C.font} opacity="0.6"
        >{longBiasScore >= 0 ? "LONG" : "SHORT"} {Math.abs(longBiasScore * 100).toFixed(0)}%</text>

      </OrbShell>
    </div>
  );
}

interface OrbRowProps {
  gap?: number;
  children: React.ReactNode;
}

export function OrbRow({ gap = 12, children }: OrbRowProps) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap,
      flexWrap: "wrap",
      padding: "8px 0",
    }}>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATION GUIDE
// ═══════════════════════════════════════════════════════════════════════════
//
// 1. Drop MaxCogVizOrbsII.tsx into M4D/src/viz/
//
// 2. Import in ControlRoomKnights.jsx (or any panel):
//    import { PriceOrb, RiskOrb, ConfluenceOrb, VolumeOrb, TVWebhookOrb, OrbRow }
//      from "./MaxCogVizOrbsII";
//
// 3. Add a second PulseHero row or a dedicated orb strip below the main grid:
//
//    <OrbRow>
//      <PriceOrb
//        candles={algoDay.candles}        // [{o,h,l,c}] last 7
//        vwap={algoDay.vwap}
//        bid={algoDay.bid}
//        ask={algoDay.ask}
//        direction={direction}
//      />
//      <RiskOrb
//        pnl={position.unrealisedPnl}
//        pnlMax={session.maxPnl}
//        drawdown={session.currentDd}
//        maxDrawdown={session.maxDd}
//        positionSize={position.sizeFraction}
//        direction={direction}
//      />
//      <ConfluenceOrb
//        bankAScore={bankANet / 9}         // normalise to −1…+1
//        bankBScore={bankBNet / 9}
//        bankCScore={bankCNet / 9}
//        kellyFire={marketState === "GO" && maAligned && macroAligned}
//        direction={direction}
//      />
//      <VolumeOrb
//        delta={algoDay.delta}             // current bar delta −1…+1
//        cumDelta={algoDay.cumDelta}
//        absorption={algoDay.absorption}
//        tapeSpeed={algoDay.tapeSpeed}
//        direction={direction}
//      />
//      <TVWebhookOrb
//        connected={webhookStatus.connected}
//        lastFiredMs={webhookStatus.lastFiredMs}
//        latencyMs={webhookStatus.latencyMs}
//        action={webhookStatus.lastAction}
//        fireCount={webhookStatus.fireCount}
//      />
//    </OrbRow>
//
// 4. Wire data:
//    — candles / vwap / bid / ask → from Alpaca WS or m4d-api
//    — pnl / drawdown / positionSize → from Alpaca positions endpoint
//    — bankAScore/B/C → from computeJediScore per bank (already in ControlRoomKnights)
//    — delta / cumDelta / absorption → from m4d-engine flow layer (P1 todo)
//    — webhookStatus → from useWebhookBridge hook (wire to your express endpoint)
//
// ═══════════════════════════════════════════════════════════════════════════
