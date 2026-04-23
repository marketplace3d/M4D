// ═══════════════════════════════════════════════════════════════════════════
// M4D · SOCIAL ALPHA PULSE · MAXCOGVIZ INTELLIGENCE PANEL
// ═══════════════════════════════════════════════════════════════════════════
// Displays: X/Grok social sentiment engine output — direction, energy,
// velocity, confidence, noise shield, alpha narratives, influence meter,
// MA gate, macro filter, Kelly fire threshold.
//
// Usage:
//   import SocialAlphaPulse from "./SocialAlphaPulse";
//   <SocialAlphaPulse data={grokOutput} maAligned={true} macroAligned={true} />
//
// data shape (from your Grok API call):
// {
//   direction:    "bullish" | "bearish" | "neutral",
//   energy:       number,   // -100 to +100 signed, or 0–100 unsigned
//   velocity:     number,   // 0–1
//   velocityAccel: number,  // -1 to 1 (acceleration trend)
//   confidence:   number,   // 0–1
//   sentimentStrength: number, // 0–1
//   influenceScore: number, // 0–1
//   noiseBlocked: number,   // integer count of blocked signals
//   noiseTypes: string[],   // e.g. ["SPAM","BOT","FUD","HYPE"]
//   alphaItems: Array<{     // top alpha narratives
//     text: string,
//     strength: number,     // 0–1
//     verified: boolean,
//     tag: string,          // e.g. "CATALYST","FLOW","MACRO","TECH"
//   }>,
//   crossVerified: boolean,
//   rawSignalCount: number,
//   cleanSignalCount: number,
//   lastUpdated: string,    // ISO timestamp or time string
//   symbol: string,
// }
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";

// ── DESIGN TOKENS (match ControlRoomKnights) ─────────────────────────────────
const T = {
  bg:        "#04060a",
  bgPanel:   "#070c12",
  bgDeep:    "#04070d",
  bgCard:    "#060b10",
  border:    "#0d1f2e",
  borderMid: "#1a3a4a",
  /** Row labels / chrome — was too dark on `#04060a` (Council embed). */
  textDim:   "#6b8fa5",
  textMid:   "#8aaec2",
  textBody:  "#9cc0d4",
  textHi:    "#d8eaf5",
  cyan:      "#22d3ee",
  red:       "#ef4444",
  amber:     "#f59e0b",
  purple:    "#818cf8",
  green:     "#4ade80",
  pink:      "#f43f5e",
  fontMono:  "'Share Tech Mono', 'Courier New', monospace",
  fontCond:  "'Barlow Condensed', sans-serif",
};

// ── HELPERS ───────────────────────────────────────────────────────────────────

function dirColor(dir) {
  if (dir === "bullish") return T.cyan;
  if (dir === "bearish") return T.red;
  return T.purple;
}

function dirLabel(dir) {
  if (dir === "bullish") return "BULLISH";
  if (dir === "bearish") return "BEARISH";
  return "NEUTRAL";
}

function energySign(dir, e) {
  if (dir === "bullish") return `+${Math.abs(e)}`;
  if (dir === "bearish") return `-${Math.abs(e)}`;
  return `${e}`;
}

function polarXY(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  if (endDeg - startDeg >= 359.9) endDeg = startDeg + 359.8;
  const s = polarXY(cx, cy, r, startDeg);
  const e = polarXY(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M${s.x} ${s.y} A${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

// ── STYLES (injected once) ────────────────────────────────────────────────────
const ALPHA_CSS = `
  @keyframes sapBreath    { 0%,100%{opacity:0.5} 50%{opacity:1} }
  @keyframes sapSpin      { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes sapSpinRev   { from{transform:rotate(360deg)} to{transform:rotate(0deg)} }
  @keyframes sapPulseOut  { 0%{transform:scale(1);opacity:0.75} 100%{transform:scale(3.2);opacity:0} }
  @keyframes sapBeat      { 0%,100%{opacity:0.65} 50%{opacity:1} }
  @keyframes sapScanline  { 0%{transform:translateY(-100%)} 100%{transform:translateY(200px)} }
  @keyframes sapFadeUp    { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  @keyframes sapVelFlow   { 0%{stroke-dashoffset:20} 100%{stroke-dashoffset:0} }
  @keyframes sapNoiseSpin { from{transform:rotate(0deg)} to{transform:rotate(-360deg)} }

  .sap-breath   { animation: sapBreath  3s ease-in-out infinite; }
  .sap-beat     { animation: sapBeat    1.8s ease-in-out infinite; }
  .sap-spin     { animation: sapSpin    12s linear infinite; transform-box:fill-box; transform-origin:center; }
  .sap-spinrev  { animation: sapSpinRev 18s linear infinite; transform-box:fill-box; transform-origin:center; }
  .sap-vel      { animation: sapVelFlow 1.2s linear infinite; }
  .sap-fadein   { animation: sapFadeUp  0.4s ease-out both; }
  .sap-noise-spin { animation: sapNoiseSpin 8s linear infinite; transform-box:fill-box; transform-origin:center; }
  .sap-pulse-hub   { animation: sapPulseOut 0.9s ease-out forwards; transform-box:fill-box; transform-origin:center; }
`;

// ══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENT: Energy Orb (main signal visualiser)
// ══════════════════════════════════════════════════════════════════════════════

function EnergyOrb({ direction, energy, velocity, confidence, sentimentStrength, influenceScore, noiseBlocked }) {
  const col       = dirColor(direction);
  const energyPct = Math.min(1, Math.abs(energy) / 100);
  const [pulseKey, setPulseKey] = useState(0);
  const prevDir = useRef(direction);

  useEffect(() => {
    if (direction !== prevDir.current) {
      setPulseKey(k => k + 1);
      prevDir.current = direction;
    }
  }, [direction]);

  const cx = 68, cy = 68;
  const confDeg  = confidence * 330;
  const sentDeg  = sentimentStrength * 300;
  const infDeg   = influenceScore * 280;
  const velBars  = 6;
  const velLit   = Math.round(velocity * velBars);
  const arrowShift = direction === "bullish" ? -10 : direction === "bearish" ? 10 : 0;

  return (
    <div style={{ position: "relative", width: 148, height: 148, flexShrink: 0 }}>
      <svg viewBox="0 0 136 136" width="148" height="148">
        <defs>
          <filter id="sapOrbGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="sapArrGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="6" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id={`sapBg-${direction}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={col} stopOpacity={0.14 + energyPct * 0.08}/>
            <stop offset="100%" stopColor={col} stopOpacity="0"/>
          </radialGradient>
        </defs>

        {/* Shell */}
        <circle cx={cx} cy={cy} r="63" fill="#050911" stroke={T.border} strokeWidth="1"/>
        <circle cx={cx} cy={cy} r="63" fill={`url(#sapBg-${direction})`} className="sap-breath"/>

        {/* Noise shield — outer jagged ring */}
        {Array.from({ length: 40 }, (_, i) => {
          const deg    = i * 9;
          const blocked = i < Math.min(20, noiseBlocked * 2);
          const r1 = 59, r2 = blocked ? 53 : 56;
          const p1 = polarXY(cx, cy, r1, deg);
          const p2 = polarXY(cx, cy, r2, deg);
          return (
            <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke={blocked ? `${T.red}55` : T.border}
              strokeWidth={blocked ? 1.5 : 0.5}
            />
          );
        })}

        {/* Influence arc — outermost data ring */}
        {infDeg > 0 && (
          <g transform={`translate(${cx},${cy})`}>
            <g className="sap-spinrev">
              <path d={arcPath(0, 0, 52, -90, -90 + infDeg)}
                stroke={col} strokeWidth="1" fill="none"
                strokeLinecap="round" opacity="0.2"
              />
            </g>
          </g>
        )}

        {/* Sentiment arc — mid ring */}
        {sentDeg > 0 && (
          <path d={arcPath(cx, cy, 47, 15, 15 + sentDeg)}
            stroke={col} strokeWidth="2" fill="none"
            strokeLinecap="round" opacity="0.28"
          />
        )}

        {/* Confidence arc — strong inner ring */}
        <circle cx={cx} cy={cy} r="42" fill="none" stroke="#0d1520" strokeWidth="0.5"/>
        {confDeg > 0 && (
          <path d={arcPath(cx, cy, 42, 0, confDeg)}
            stroke={col} strokeWidth="3.5" fill="none"
            strokeLinecap="round" opacity="0.6"
            filter="url(#sapOrbGlow)"
          />
        )}

        {/* Rotating gate ring (hub translate so spin pivot = bullseye) */}
        <g transform={`translate(${cx},${cy})`}>
          <g className="sap-spin">
            <circle cx={0} cy={0} r="35" fill="none"
              stroke={`${col}18`} strokeWidth="0.5"
              strokeDasharray="3 7"
            />
          </g>
        </g>

        {/* Velocity flow bars (5 small bars, bottom interior) */}
        {Array.from({ length: velBars }, (_, i) => {
          const lit = i < velLit;
          const bx  = cx - (velBars * 8) / 2 + i * 8 + 1.5;
          const bh  = 3.5 + i * 1.2;
          return (
            <rect key={i} x={bx} y={cy + 24 - bh / 2}
              width="5.5" height={bh} rx="1"
              fill={lit ? col : T.border}
              opacity={lit ? 0.65 + i * 0.07 : 0.18}
            />
          );
        })}

        {/* Direction arrow — center */}
        <g transform={`translate(${cx},${cy + arrowShift})`}
           filter="url(#sapArrGlow)"
           className="sap-beat"
           style={{ opacity: 0.5 + energyPct * 0.5, transition: "opacity 0.5s" }}
        >
          {direction === "bullish" && (
            <path d="M 0,-20 L 13,0 L 6,0 L 6,16 L -6,16 L -6,0 L -13,0 Z" fill={col}/>
          )}
          {direction === "bearish" && (
            <path d="M 0,20 L 13,0 L 6,0 L 6,-16 L -6,-16 L -6,0 L -13,0 Z" fill={col}/>
          )}
          {direction === "neutral" && (
            <>
              <path d="M -18,0 L -5,0 L -5,-5 L 2,0 L -5,5 L -5,0" fill={col} opacity="0.5"/>
              <path d="M 18,0 L 5,0 L 5,-5 L -2,0 L 5,5 L 5,0"   fill={col} opacity="0.5"/>
            </>
          )}
          <circle cx="0" cy="0" r="3" fill={col} opacity="0.95"/>
          <circle cx="0" cy="0" r="1.2" fill="#ffffff" opacity="0.65"/>
        </g>

        {/* Pulse ring on direction change */}
        <g key={`pulse-${pulseKey}`} transform={`translate(${cx},${cy})`}>
          <circle cx={0} cy={0} r="14"
            fill="none" stroke={col} strokeWidth="2"
            className="sap-pulse-hub"
          />
        </g>

        {/* Energy score */}
        <text x={cx} y={cy - 24}
          textAnchor="middle" dominantBaseline="central"
          fill={col} fontSize="16" fontWeight="900"
          fontFamily={T.fontCond}
          opacity="0.95" filter="url(#sapOrbGlow)"
        >
          {energySign(direction, Math.abs(energy))}
        </text>

        {/* Badge */}
        <rect x={cx - 16} y={cy + 44} width="32" height="13" rx="2"
          fill="#04070db0" stroke={`${col}44`} strokeWidth="0.5"/>
        <text x={cx} y={cy + 44 + 6.5}
          textAnchor="middle" dominantBaseline="central"
          fill={col} fontSize="7" fontWeight="700" letterSpacing="2"
          fontFamily={T.fontCond}
        >X · GROK</text>
      </svg>

      {/* Noise count overlay */}
      {noiseBlocked > 0 && (
        <div style={{
          position: "absolute", top: 6, right: 4,
          background: "#04070db0",
          border: `1px solid ${T.red}33`,
          color: T.red, fontSize: 7,
          fontFamily: T.fontCond,
          fontWeight: 700, letterSpacing: 1.2,
          padding: "1px 5px", borderRadius: 2,
        }}>−{noiseBlocked} NOISE</div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENT: Velocity Bar (live signal flow rate)
// ══════════════════════════════════════════════════════════════════════════════

function VelocityBar({ velocity, velocityAccel, direction }) {
  const col      = dirColor(direction);
  const pct      = Math.round(velocity * 100);
  const accelUp  = velocityAccel > 0.05;
  const accelDn  = velocityAccel < -0.05;
  const bars     = 20;
  const litBars  = Math.round(velocity * bars);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 9, letterSpacing: 1.8, color: T.textMid, fontWeight: 700 }}>VELOCITY</span>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          {(accelUp || accelDn) && (
            <span style={{
              fontSize: 7, letterSpacing: 1, fontFamily: T.fontCond, fontWeight: 700,
              color: accelUp ? T.green : T.red,
            }}>
              {accelUp ? "▲ ACCEL" : "▼ DECEL"}
            </span>
          )}
          <span style={{ fontSize: 10, fontFamily: T.fontCond, fontWeight: 900, color: col }}>
            {pct}%
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 2, height: 6 }}>
        {Array.from({ length: bars }, (_, i) => {
          const lit = i < litBars;
          const intensity = lit ? 0.4 + (i / bars) * 0.6 : 0.06;
          return (
            <div key={i} style={{
              flex: 1, borderRadius: 1,
              background: lit ? col : T.border,
              opacity: intensity,
              transition: "background 0.3s, opacity 0.3s",
              boxShadow: (lit && i === litBars - 1) ? `0 0 4px ${col}` : "none",
            }}/>
          );
        })}
      </div>
      {/* Flow line */}
      <svg width="100%" height="4" style={{ overflow: "visible" }}>
        <line x1="0" y1="2" x2="100%" y2="2"
          stroke={`${col}22`} strokeWidth="1"
          strokeDasharray="4 4"
        />
        <line x1="0" y1="2" x2={`${pct}%`} y2="2"
          stroke={col} strokeWidth="1.5"
          strokeDasharray="4 4"
          strokeLinecap="round"
          className="sap-vel"
          style={{ opacity: 0.82 }}
        />
      </svg>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENT: Noise Shield
// ══════════════════════════════════════════════════════════════════════════════

function NoiseShield({ noiseBlocked, noiseTypes = [], rawSignalCount, cleanSignalCount }) {
  const filterRatio = rawSignalCount > 0
    ? Math.round((noiseBlocked / rawSignalCount) * 100)
    : 0;

  const TYPE_COLORS = {
    SPAM:    T.red,
    BOT:     "#f97316",
    FUD:     T.pink,
    HYPE:    T.amber,
    COORD:   "#e879f9",
    AD:      T.textMid,
    LOWINFO: T.textDim,
  };

  return (
    <div style={{
      background: T.bgDeep,
      border: `1px solid ${T.border}`,
      padding: "8px 10px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 9, letterSpacing: 1.6, color: T.textMid, fontWeight: 700 }}>NOISE SHIELD</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 7, letterSpacing: 1.5,
            color: filterRatio > 60 ? T.red : filterRatio > 30 ? T.amber : T.green,
            fontFamily: T.fontCond, fontWeight: 700,
          }}>
            {filterRatio}% FILTERED
          </span>
        </div>
      </div>

      {/* Raw → Clean funnel bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 9, color: T.textMid, minWidth: 32, fontWeight: 700 }}>RAW</span>
        <div style={{ flex: 1, height: 4, background: T.border, borderRadius: 1, overflow: "hidden" }}>
          <div style={{ height: "100%", background: T.red, width: `${filterRatio}%`,
                        transition: "width 0.6s", borderRadius: 1,
                        boxShadow: `0 0 4px ${T.red}66` }}/>
        </div>
        <span style={{ fontSize: 8, color: T.textMid, fontFamily: T.fontCond, fontWeight: 700,
                       minWidth: 28, textAlign: "right" }}>{rawSignalCount}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 9, color: T.textMid, minWidth: 32, fontWeight: 700 }}>CLEAN</span>
        <div style={{ flex: 1, height: 4, background: T.border, borderRadius: 1, overflow: "hidden" }}>
          <div style={{ height: "100%", background: T.green,
                        width: rawSignalCount > 0 ? `${(cleanSignalCount / rawSignalCount) * 100}%` : "0%",
                        transition: "width 0.6s", borderRadius: 1,
                        boxShadow: `0 0 4px ${T.green}66` }}/>
        </div>
        <span style={{ fontSize: 8, color: T.green, fontFamily: T.fontCond, fontWeight: 700,
                       minWidth: 28, textAlign: "right" }}>{cleanSignalCount}</span>
      </div>

      {/* Noise type chips */}
      {noiseTypes.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
          {noiseTypes.map(t => (
            <span key={t} style={{
              fontSize: 7, letterSpacing: 1, padding: "1px 5px",
              border: `1px solid ${TYPE_COLORS[t] ?? T.textDim}44`,
              color: TYPE_COLORS[t] ?? T.textMid,
              background: T.bgDeep,
            }}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENT: Influence Meter
// ══════════════════════════════════════════════════════════════════════════════

function InfluenceMeter({ influenceScore, direction }) {
  const col   = dirColor(direction);
  const tiers = [
    { label: "WHALE",   threshold: 0.8, color: col },
    { label: "VERIFIED",threshold: 0.55, color: T.amber },
    { label: "KNOWN",   threshold: 0.3, color: T.textBody },
    { label: "ANON",    threshold: 0,   color: T.textDim },
  ];
  const activeTier = tiers.find(t => influenceScore >= t.threshold) ?? tiers[3];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, letterSpacing: 1.6, color: T.textMid, fontWeight: 700 }}>INFLUENCE</span>
        <span style={{
          fontSize: 8, fontFamily: T.fontCond, fontWeight: 700, letterSpacing: 2,
          color: activeTier.color,
        }}>{activeTier.label}</span>
      </div>
      {/* Stacked tier bars */}
      {tiers.map((tier, i) => {
        const isActive = influenceScore >= tier.threshold;
        const fill = Math.max(0, Math.min(1,
          (influenceScore - tier.threshold) / (0.25)
        ));
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 7, width: 48, color: isActive ? tier.color : T.textDim,
                           letterSpacing: 1 }}>{tier.label}</span>
            <div style={{ flex: 1, height: 3, background: T.border, borderRadius: 1 }}>
              <div style={{
                height: "100%",
                width: `${isActive ? Math.min(100, fill * 100 + (isActive ? 20 : 0)) : 0}%`,
                background: tier.color,
                borderRadius: 1,
                transition: "width 0.6s",
                boxShadow: isActive ? `0 0 4px ${tier.color}88` : "none",
              }}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENT: Alpha Narrative Feed
// ══════════════════════════════════════════════════════════════════════════════

const TAG_COLORS = {
  CATALYST: T.cyan,
  FLOW:     T.amber,
  MACRO:    T.purple,
  TECH:     T.green,
  RISK:     T.red,
  NEWS:     T.textBody,
};

function AlphaNarrativeFeed({ alphaItems = [], direction, crossVerified }) {
  const col = dirColor(direction);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "5px 10px", background: T.bgPanel,
        borderBottom: `1px solid ${T.border}`,
      }}>
        <span style={{ fontSize: 9, letterSpacing: 1.6, color: T.textMid, fontWeight: 800 }}>ALPHA NARRATIVES</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {crossVerified && (
            <span style={{ fontSize: 8, letterSpacing: 1.2, color: T.green, fontFamily: T.fontCond, fontWeight: 800 }}>
              ✓ CROSS-VFD
            </span>
          )}
          <span style={{ fontSize: 8, color: T.textMid, fontWeight: 700 }}>{alphaItems.length} SIGNALS</span>
        </div>
      </div>

      {alphaItems.length === 0 ? (
        <div style={{ padding: "10px", fontSize: 10, color: T.textMid, textAlign: "center", fontWeight: 700 }}>
          NO ALPHA DETECTED
        </div>
      ) : (
        alphaItems.map((item, i) => (
          <div key={i} className="sap-fadein" style={{
            display: "flex", alignItems: "flex-start", gap: 7,
            padding: "6px 10px",
            borderBottom: `1px solid ${T.border}`,
            background: i % 2 === 0 ? T.bgDeep : T.bgCard,
            animationDelay: `${i * 0.06}s`,
          }}>
            {/* Strength bar (left side) */}
            <div style={{
              width: 2, alignSelf: "stretch", borderRadius: 1, flexShrink: 0,
              background: col,
              opacity: 0.3 + item.strength * 0.7,
              boxShadow: item.strength > 0.7 ? `0 0 4px ${col}88` : "none",
            }}/>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                {/* Tag */}
                <span style={{
                  fontSize: 6, letterSpacing: 1.5, padding: "1px 4px",
                  border: `1px solid ${TAG_COLORS[item.tag] ?? T.textDim}44`,
                  color: TAG_COLORS[item.tag] ?? T.textMid,
                  fontFamily: T.fontCond, fontWeight: 700,
                  flexShrink: 0,
                }}>{item.tag}</span>

                {/* Verified badge */}
                {item.verified && (
                  <span style={{ fontSize: 6, color: T.green, letterSpacing: 1 }}>✓VFD</span>
                )}

                {/* Strength meter dots */}
                <div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
                  {Array.from({ length: 5 }, (_, j) => (
                    <div key={j} style={{
                      width: 4, height: 4, borderRadius: "50%",
                      background: j < Math.round(item.strength * 5) ? col : T.border,
                      opacity: j < Math.round(item.strength * 5) ? 0.8 : 0.2,
                    }}/>
                  ))}
                </div>
              </div>

              {/* Narrative text */}
              <div style={{
                fontSize: 10, color: T.textHi, lineHeight: 1.5, fontWeight: 500,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}>{item.text}</div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENT: Gate Meters (MA + Macro + Kelly)
// ══════════════════════════════════════════════════════════════════════════════

function GateMeters({ maAligned, macroAligned, direction, energy, confidence, velocity }) {
  const col = dirColor(direction);
  const energyPct = Math.abs(energy) / 100;

  // Kelly fire: needs all three gates + high confluence
  const kellyFire = maAligned && macroAligned && energyPct > 0.65 && confidence > 0.65 && velocity > 0.5;
  const kellyPartial = (maAligned || macroAligned) && energyPct > 0.4 && confidence > 0.4;

  const gates = [
    {
      label: "MA GATE",
      sub:   "MA / EMA alignment check",
      on:    maAligned,
      onColor:  T.green,
      offColor: T.red,
      onLabel:  "ALIGNED",
      offLabel: "BLOCKED",
    },
    {
      label: "MACRO GATE",
      sub:   "Correlation + portfolio filter",
      on:    macroAligned,
      onColor:  T.green,
      offColor: T.amber,
      onLabel:  "CLEAR",
      offLabel: "PENALTY",
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {gates.map((g, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 10px",
          borderBottom: `1px solid ${T.border}`,
          background: i % 2 === 0 ? T.bgDeep : T.bgCard,
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: g.on ? g.onColor : g.offColor,
            boxShadow: `0 0 6px ${g.on ? g.onColor : g.offColor}99`,
          }}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, letterSpacing: 1.2, color: T.textHi,
                          fontFamily: T.fontCond, fontWeight: 800 }}>{g.label}</div>
            <div style={{ fontSize: 8, color: T.textMid, letterSpacing: 0.5, fontWeight: 600 }}>{g.sub}</div>
          </div>
          <span style={{
            fontSize: 8, fontFamily: T.fontCond, fontWeight: 700, letterSpacing: 2,
            color: g.on ? g.onColor : g.offColor,
          }}>{g.on ? g.onLabel : g.offLabel}</span>
        </div>
      ))}

      {/* Kelly Fire line */}
      <div style={{
        padding: "8px 10px",
        background: kellyFire ? `${col}0c` : T.bgDeep,
        border: kellyFire ? `1px solid ${col}44` : `1px solid transparent`,
        transition: "all 0.4s",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: 1, flexShrink: 0,
          background: kellyFire ? col : T.textDim,
          boxShadow: kellyFire ? `0 0 10px ${col}` : "none",
          animation: kellyFire ? "sapBeat 1.2s ease-in-out infinite" : "none",
        }}/>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 9, fontFamily: T.fontCond, fontWeight: 900, letterSpacing: 2,
            color: kellyFire ? col : T.textDim,
          }}>
            {kellyFire ? "🔥 FRACTIONAL KELLY FIRE" : kellyPartial ? "KELLY BUILDING" : "KELLY GATE — WAIT"}
          </div>
          <div style={{ fontSize: 7, color: T.textDim, letterSpacing: 1 }}>
            {kellyFire
              ? "All gates clear · High confluence · Size allowed"
              : "Needs: MA + Macro aligned · Energy >65 · Confidence >65"}
          </div>
        </div>
        {kellyFire && (
          <span style={{
            fontSize: 11, fontFamily: T.fontCond, fontWeight: 900,
            color: col, letterSpacing: 2,
            textShadow: `0 0 12px ${col}88`,
            animation: "sapBeat 0.8s ease-in-out infinite",
          }}>GO</span>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENT: Score Header Row
// ══════════════════════════════════════════════════════════════════════════════

function ScoreHeader({ direction, energy, confidence, symbol, lastUpdated }) {
  const col      = dirColor(direction);
  const energyPct = Math.abs(energy);
  const bgGlow   = direction === "bullish"
    ? "rgba(34,211,238,0.05)"
    : direction === "bearish"
    ? "rgba(239,68,68,0.05)"
    : "rgba(129,140,248,0.03)";

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 14px",
      minHeight: 48,
      background: T.bgPanel,
      borderBottom: `1px solid ${T.border}`,
      position: "relative", overflow: "visible",
    }}>
      {/* Subtle tint only under text — no full-bleed layer (was reading as cover on embed). */}
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: "min(55%, 420px)", pointerEvents: "none",
        background: `linear-gradient(90deg, ${bgGlow} 0%, transparent 100%)`,
        transition: "background 1.5s",
        zIndex: 0,
      }}/>

      <div style={{ position: "relative", zIndex: 2 }}>
        <div style={{
          fontFamily: T.fontCond, fontSize: 20, fontWeight: 900, lineHeight: 1,
          letterSpacing: 3, color: col,
          textShadow: `0 0 20px ${col}66`,
          transition: "color 0.5s, text-shadow 0.8s",
        }}>
          SOCIAL ALPHA PULSE
        </div>
        <div style={{ fontSize: 9, letterSpacing: 1.5, color: T.textMid, marginTop: 4, fontWeight: 600 }}>
          {symbol} · X/GROK INTELLIGENCE · MULTI-STAGE FILTER
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 20, position: "relative", zIndex: 2 }}>
        {/* Energy readout */}
        <div style={{ textAlign: "right" }}>
          <div style={{
            fontFamily: T.fontCond, fontSize: 40, fontWeight: 900, lineHeight: 1,
            color: col,
            textShadow: `0 0 24px ${col}77`,
            fontVariantNumeric: "tabular-nums",
            transition: "color 0.4s, text-shadow 0.6s",
          }}>
            {energySign(direction, energyPct)}
          </div>
          <div style={{
            fontSize: 11, letterSpacing: 2.5, color: col, opacity: 1, marginTop: 3,
            fontFamily: T.fontCond, fontWeight: 800,
          }}>{dirLabel(direction)}</div>
        </div>

        {/* Confidence ring mini */}
        <div style={{ position: "relative", width: 44, height: 44 }}>
          <svg viewBox="0 0 44 44" width="44" height="44">
            <circle cx="22" cy="22" r="18" fill="none" stroke={T.border} strokeWidth="1"/>
            {confidence > 0 && (
              <path d={arcPath(22, 22, 18, 0, confidence * 355)}
                stroke={col} strokeWidth="3" fill="none"
                strokeLinecap="round" opacity="0.75"/>
            )}
            <text x="22" y="22" textAnchor="middle" dominantBaseline="central"
              fill={col} fontSize="8" fontWeight="900" fontFamily={T.fontCond}>
              {Math.round(confidence * 100)}
            </text>
          </svg>
          <div style={{ position: "absolute", bottom: -1, left: 0, right: 0,
                        textAlign: "center", fontSize: 8, color: T.textMid, letterSpacing: 1.2, fontWeight: 700 }}>
            CONF
          </div>
        </div>

        {/* Last updated */}
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 8, color: T.textMid, letterSpacing: 1, fontWeight: 700 }}>UPDATED</div>
          <div style={{ fontFamily: T.fontCond, fontSize: 13, color: T.textHi, letterSpacing: 1, marginTop: 3, fontWeight: 800 }}>
            {lastUpdated ?? "--:--:--"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENT: Stat Bar Row
// ══════════════════════════════════════════════════════════════════════════════

function StatBar({ label, value, max = 1, color, fmt = v => `${Math.round(v * 100)}%` }) {
  const pct = Math.min(1, value / max);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <span style={{ fontSize: 9, letterSpacing: 1.2, color: T.textMid, minWidth: 72, fontWeight: 650 }}>{label}</span>
      <div style={{ flex: 1, height: 3, background: T.border, borderRadius: 1 }}>
        <div style={{
          height: "100%", width: `${pct * 100}%`,
          background: color, borderRadius: 1,
          transition: "width 0.6s, box-shadow 0.4s",
          boxShadow: pct > 0.6 ? `0 0 5px ${color}88` : "none",
        }}/>
      </div>
      <span style={{
        fontSize: 11, fontFamily: T.fontCond, fontWeight: 800, color,
        minWidth: 34, textAlign: "right", fontVariantNumeric: "tabular-nums",
      }}>{fmt(value)}</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT: SocialAlphaPulse
// ══════════════════════════════════════════════════════════════════════════════

const DEMO_DATA = {
  direction:       "bullish",
  energy:          72,
  velocity:        0.64,
  velocityAccel:   0.18,
  confidence:      0.78,
  sentimentStrength: 0.71,
  influenceScore:  0.62,
  noiseBlocked:    14,
  noiseTypes:      ["SPAM", "BOT", "HYPE", "FUD"],
  rawSignalCount:  87,
  cleanSignalCount: 34,
  crossVerified:   true,
  lastUpdated:     new Date().toLocaleTimeString(),
  symbol:          "SPY",
  alphaItems: [
    { text: "Unusual call sweep on SPY 560 expiring Friday, 3× avg volume, dark pool confirm.", strength: 0.91, verified: true,  tag: "FLOW" },
    { text: "Multiple large accounts citing Fed pause narrative. Consistent with macro backdrop.", strength: 0.74, verified: true,  tag: "MACRO" },
    { text: "Price holding VWAP on 5m with order book absorption. Algos agree.", strength: 0.68, verified: false, tag: "TECH" },
    { text: "Breaking: sector rotation into tech confirmed by 3 independent data sources.", strength: 0.83, verified: true,  tag: "CATALYST" },
    { text: "Risk flag: correlation to DXY inverted, watch for reversal if dollar spikes.", strength: 0.55, verified: false, tag: "RISK" },
  ],
};

export default function SocialAlphaPulse({
  data = DEMO_DATA,
  maAligned    = true,
  macroAligned = true,
}) {
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 800px)").matches
  );

  useEffect(() => {
    const mq  = window.matchMedia("(max-width: 800px)");
    const upd = () => setIsNarrow(mq.matches);
    mq.addEventListener("change", upd);
    return () => mq.removeEventListener("change", upd);
  }, []);

  const col = dirColor(data.direction);
  const energyPct = Math.abs(data.energy) / 100;

  return (
    <div style={{
      fontFamily: T.fontMono,
      background: T.bg,
      color: T.textBody,
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0,
      position: "relative",
      overflow: "hidden",
      isolation: "isolate",
    }}>
      <style>{ALPHA_CSS}</style>

      {/* Kept off full-bleed wash: on COUNCIL embed it read as a “frame” over DIR/ENERGY/MA rows. */}

      {/* ── HEADER ── */}
      <div style={{ position: "relative", zIndex: 30, flexShrink: 0 }}>
        <ScoreHeader
          direction={data.direction}
          energy={data.energy}
          confidence={data.confidence}
          symbol={data.symbol}
          lastUpdated={data.lastUpdated}
        />
      </div>

      {/* ── COUNTDOWN BAR (thin, like ControlRoom) ── */}
      <div style={{ height: 2, background: T.bgPanel, flexShrink: 0, position: "relative", zIndex: 30 }}>
        <div style={{
          height: "100%",
          width: `${energyPct * 100}%`,
          background: `linear-gradient(90deg, ${col}, ${data.direction === "bullish" ? T.green : data.direction === "bearish" ? T.pink : T.purple})`,
          transition: "width 0.8s ease",
          boxShadow: `0 0 6px ${col}66`,
        }}/>
      </div>

      {/* ── MAIN BODY ── */}
      <div style={{
        flex: 1, overflow: "auto",
        display: "flex",
        flexDirection: isNarrow ? "column" : "row",
        position: "relative", zIndex: 20,
        WebkitOverflowScrolling: "touch",
      }}>

        {/* LEFT COLUMN — Orb + core metrics */}
        <div style={{
          width: isNarrow ? "100%" : 188,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: isNarrow ? "none" : `1px solid ${T.border}`,
          borderBottom: isNarrow ? `1px solid ${T.border}` : "none",
        }}>

          {/* Orb */}
          <div style={{
            display: "flex", justifyContent: "center", alignItems: "center",
            padding: "10px 0 4px",
            background: T.bgDeep,
            borderBottom: `1px solid ${T.border}`,
          }}>
            <EnergyOrb
              direction={data.direction}
              energy={data.energy}
              velocity={data.velocity}
              confidence={data.confidence}
              sentimentStrength={data.sentimentStrength}
              influenceScore={data.influenceScore}
              noiseBlocked={data.noiseBlocked}
            />
          </div>

          {/* Core stat bars */}
          <div style={{
            padding: "10px 12px",
            display: "flex", flexDirection: "column", gap: 7,
            borderBottom: `1px solid ${T.border}`,
            background: T.bgCard,
          }}>
            <StatBar label="SENTIMENT STR"  value={data.sentimentStrength} color={col} />
            <StatBar label="CONFIDENCE"     value={data.confidence}        color={T.amber} />
            <StatBar label="INFLUENCE WT"   value={data.influenceScore}    color={T.purple} />
          </div>

          {/* Velocity */}
          <div style={{
            padding: "10px 12px",
            borderBottom: `1px solid ${T.border}`,
            background: T.bgDeep,
          }}>
            <VelocityBar
              velocity={data.velocity}
              velocityAccel={data.velocityAccel}
              direction={data.direction}
            />
          </div>

          {/* Influence meter */}
          <div style={{
            padding: "10px 12px",
            borderBottom: `1px solid ${T.border}`,
            background: T.bgCard,
          }}>
            <InfluenceMeter
              influenceScore={data.influenceScore}
              direction={data.direction}
            />
          </div>

          {/* Noise shield */}
          <div style={{ padding: "8px 0" }}>
            <NoiseShield
              noiseBlocked={data.noiseBlocked}
              noiseTypes={data.noiseTypes}
              rawSignalCount={data.rawSignalCount}
              cleanSignalCount={data.cleanSignalCount}
            />
          </div>
        </div>

        {/* RIGHT COLUMN — Alpha narratives + gates */}
        <div style={{
          flex: 1, minWidth: 0,
          display: "flex", flexDirection: "column",
        }}>

          {/* Alpha narratives */}
          <div style={{ flex: 1, overflow: "auto" }}>
            <AlphaNarrativeFeed
              alphaItems={data.alphaItems}
              direction={data.direction}
              crossVerified={data.crossVerified}
            />
          </div>

          {/* Gate meters */}
          <div style={{ flexShrink: 0, borderTop: `1px solid ${T.border}` }}>
            <div style={{ padding: "4px 10px", borderBottom: `1px solid ${T.border}`,
                          background: T.bgPanel }}>
              <span style={{ fontSize: 9, letterSpacing: 1.8, color: T.textMid, fontWeight: 800 }}>SIGNAL GATES</span>
            </div>
            <GateMeters
              maAligned={maAligned}
              macroAligned={macroAligned}
              direction={data.direction}
              energy={data.energy}
              confidence={data.confidence}
              velocity={data.velocity}
            />
          </div>
        </div>
      </div>

      {/* ── BOTTOM STATUS BAR ── */}
      <div style={{
        display: "flex", alignItems: "center",
        flexWrap: "nowrap", overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        padding: "8px 14px", minHeight: 36,
        background: T.bgPanel,
        borderTop: `1px solid ${T.border}`,
        flexShrink: 0, gap: 16, zIndex: 30, position: "relative",
      }}>
        {[
          ["DIR",      dirLabel(data.direction),                                       col],
          ["ENERGY",   energySign(data.direction, Math.abs(data.energy)),              col],
          ["VELOCITY", `${Math.round(data.velocity * 100)}%`,                         T.cyan],
          ["CONF",     `${Math.round(data.confidence * 100)}%`,                       T.amber],
          ["RAW",      String(data.rawSignalCount),                                    T.textHi],
          ["CLEAN",    String(data.cleanSignalCount),                                  T.green],
          ["NOISE",    `-${data.noiseBlocked}`,                                        T.red],
          ["MA",       maAligned ? "OK" : "BLOCK",                                    maAligned ? T.green : T.red],
          ["MACRO",    macroAligned ? "OK" : "PENALTY",                               macroAligned ? T.green : T.amber],
        ].map(([label, value, color], i, arr) => (
          <span key={label} style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 9, letterSpacing: 1.2, color: T.textMid, fontWeight: 700 }}>{label}</span>
            <span style={{
              fontFamily: T.fontCond, fontSize: 13, fontWeight: 800, color, letterSpacing: 0.5,
              textShadow: `0 0 12px ${String(color)}33`,
            }}>{value}</span>
            {i < arr.length - 1 && <span style={{ width: 1, height: 14, background: T.borderMid, marginLeft: 8 }}/>}
          </span>
        ))}
        <span style={{
          marginLeft: "auto", fontSize: 9, letterSpacing: 0.9, color: T.textHi, flexShrink: 0, fontWeight: 700,
        }}>
          M4D SOCIAL ALPHA PULSE · X/GROK · {data.lastUpdated}
        </span>
      </div>
    </div>
  );
}
