// M4D · MAXCOGVIZ ORB TRINITY — XSentinelOrb, CouncilOrb, JediMasterOrb
// Sourced from spec-kit; CouncilOrb center matches PulseHero (cx 130, cy 68).

import { useState, useEffect, useRef } from "react";

function describeArc(cx, cy, r, startDeg, endDeg) {
  const s = ((startDeg - 90) * Math.PI) / 180;
  const e = ((endDeg - 90) * Math.PI) / 180;
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx + r * Math.cos(s)} ${cy + r * Math.sin(s)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(e)} ${cy + r * Math.sin(e)}`;
}

function polarToXY(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

const ORB_STYLES = `
  @keyframes orbBreath   { 0%,100%{opacity:0.55} 50%{opacity:1} }
  @keyframes orbSpin     { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes orbSpinRev  { from{transform:rotate(360deg)} to{transform:rotate(0deg)} }
  @keyframes orbPulseRing{ 0%{transform:scale(0.88);opacity:0.55} 100%{transform:scale(2.05);opacity:0} }
  @keyframes orbFlicker  { 0%,100%{opacity:1} 45%{opacity:0.7} 55%{opacity:0.9} }
  @keyframes orbRise     { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
  @keyframes orbFall     { 0%,100%{transform:translateY(0)} 50%{transform:translateY(3px)} }
  .orb-breath  { animation: orbBreath  3.2s ease-in-out infinite; }
  /* Pivot in *local* coords (translate hub first); never use user-space px as CSS transform-origin on SVG — it skews rings. */
  .orb-spin, .orb-spinrev { transform-box: fill-box; transform-origin: center; }
  .orb-spin    { animation: orbSpin    12s linear infinite; }
  .orb-spinrev { animation: orbSpinRev 18s linear infinite; }
  .orb-pulse-ring { animation: orbPulseRing 0.9s ease-out forwards; transform-box: fill-box; transform-origin: center; }
  .orb-flicker { animation: orbFlicker 2.4s ease-in-out infinite; }
  .orb-rise    { animation: orbRise    2s ease-in-out infinite; }
  .orb-fall    { animation: orbFall    2s ease-in-out infinite; }
  .orb-arrow-pulse { animation: orbBreath 1.8s ease-in-out infinite; }
`;

export function XSentinelOrb({ data = {}, direction = "FLAT" }) {
  const {
    energy = 0,
    velocity = 0,
    confidence = 0,
    noiseBlocked = 0,
    sentiment = 0,
    influence = 0,
  } = data;

  const xDir = data.direction ?? (energy > 50 ? "bullish" : energy < 30 ? "bearish" : "neutral");

  const isLong  = xDir === "bullish";
  const isShort = xDir === "bearish";

  const coreColor  = isLong ? "#22d3ee" : isShort ? "#ef4444" : "#818cf8";

  const cx = 68, cy = 68;

  const energyNorm = energy / 100;
  const arrowShift = isLong ? -14 : isShort ? 14 : 0;
  const arrowOpacity = 0.5 + energyNorm * 0.5;

  const velBars = 5;
  const velLit  = Math.round(velocity * velBars);

  const confDeg = confidence * 340;

  const spokesTotal = 8;
  const spokesLit   = Math.round(influence * spokesTotal);

  const sentDeg = sentiment * 340;

  return (
    <div style={{ position: "relative", width: 160, height: 160, flexShrink: 0 }}>
      <style>{ORB_STYLES}</style>
      <svg viewBox="0 0 136 136" width="160" height="160">
        <defs>
          <filter id="xsGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="xsArrowGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="xsCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor={coreColor} stopOpacity="0.18" />
            <stop offset="100%" stopColor={coreColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx={cx} cy={cy} r="63" fill="#050911" stroke="#0d1f2e" strokeWidth="1" />
        <circle cx={cx} cy={cy} r="63" fill="url(#xsCore)" className="orb-breath" />

        {Array.from({ length: 36 }, (_, i) => {
          const deg = i * 10;
          const blocked = noiseBlocked > 0 && i < Math.min(18, noiseBlocked);
          const p1 = polarToXY(cx, cy, 58, deg);
          const p2 = polarToXY(cx, cy, blocked ? 52 : 55, deg);
          return (
            <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke={blocked ? "#ef444466" : "#0d1f2e"}
              strokeWidth={blocked ? 1.5 : 0.5}
            />
          );
        })}

        {sentDeg > 0 && (
          <g transform={`translate(${cx},${cy})`}>
            <g className="orb-spinrev">
              <path
                d={describeArc(0, 0, 50, 10, 10 + sentDeg)}
                stroke={coreColor} strokeWidth="2" fill="none"
                strokeLinecap="round" opacity="0.25"
              />
            </g>
          </g>
        )}

        {confDeg > 0 && (
          <path
            d={describeArc(cx, cy, 44, 0, confDeg)}
            stroke={coreColor} strokeWidth="3" fill="none"
            strokeLinecap="round" opacity="0.55"
            filter="url(#xsGlow)"
          />
        )}
        <circle cx={cx} cy={cy} r="44" fill="none" stroke="#0d1f2e" strokeWidth="1" />

        {Array.from({ length: spokesTotal }, (_, i) => {
          const deg = (i / spokesTotal) * 360;
          const lit = i < spokesLit;
          const p1 = polarToXY(cx, cy, 30, deg);
          const p2 = polarToXY(cx, cy, lit ? 40 : 33, deg);
          return (
            <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke={lit ? coreColor : "#0d2030"}
              strokeWidth={lit ? 1.5 : 0.5}
              opacity={lit ? 0.7 : 0.3}
            />
          );
        })}

        <g
          transform={`translate(${cx}, ${cy + arrowShift})`}
          filter="url(#xsArrowGlow)"
          className="orb-arrow-pulse"
          style={{ opacity: arrowOpacity, transition: "opacity 0.6s" }}
        >
          {isLong && (
            <path
              d="M 0,-22 L 14,0 L 6,0 L 6,18 L -6,18 L -6,0 L -14,0 Z"
              fill={coreColor}
            />
          )}
          {isShort && (
            <path
              d="M 0,22 L 14,0 L 6,0 L 6,-18 L -6,-18 L -6,0 L -14,0 Z"
              fill={coreColor}
            />
          )}
          {!isLong && !isShort && (
            <>
              <path d="M -20,0 L -6,0 L -6,-6 L 0,0 L -6,6 L -6,0" fill={coreColor} opacity="0.5" />
              <path d="M 20,0 L 6,0 L 6,-6 L 0,0 L 6,6 L 6,0"   fill={coreColor} opacity="0.5" />
            </>
          )}
          <circle cx="0" cy="0" r="3.5" fill={coreColor} opacity="0.9" />
          <circle cx="0" cy="0" r="1.5" fill="#ffffff" opacity="0.6" />
        </g>

        {Array.from({ length: velBars }, (_, i) => {
          const lit = i < velLit;
          const bx  = cx - (velBars * 9) / 2 + i * 9 + 2;
          const bh  = 4 + i * 1.5;
          return (
            <rect key={i}
              x={bx} y={cy + 30 - bh / 2}
              width="6" height={bh} rx="1"
              fill={lit ? coreColor : "#0d1f2e"}
              opacity={lit ? 0.7 + i * 0.06 : 0.2}
            />
          );
        })}

        <text x={cx} y={cy - 30}
          textAnchor="middle" dominantBaseline="central"
          fill={coreColor} fontSize="13" fontWeight="900"
          fontFamily="'Barlow Condensed', sans-serif"
          opacity="0.9"
          filter="url(#xsGlow)"
        >
          {energy > 0 ? (isLong ? "+" : isShort ? "−" : "") : ""}{energy}
        </text>

        <rect x={cx - 14} y={cy + 46} width="28" height="14" rx="2"
          fill="#04070db0" stroke={`${coreColor}44`} strokeWidth="0.5" />
        <text x={cx} y={cy + 53}
          textAnchor="middle" dominantBaseline="central"
          fill={coreColor} fontSize="7" fontWeight="700" letterSpacing="2"
          fontFamily="'Barlow Condensed', sans-serif"
        >X · GROK</text>
      </svg>

      {noiseBlocked > 0 && (
        <div style={{
          position: "absolute", top: 6, right: 6,
          background: "#04070db0", border: "1px solid #ef444444",
          color: "#ef4444", fontSize: 8, fontFamily: "'Barlow Condensed', sans-serif",
          fontWeight: 700, letterSpacing: 1, padding: "1px 5px", borderRadius: 2,
        }}>
          -{noiseBlocked} NOISE
        </div>
      )}
    </div>
  );
}

export function CouncilOrb({
  score = 0, direction = "FLAT",
  votes = {}, strengths = {},
  bankANet = 0, bankBNet = 0, bankCNet = 0,
  conviction = 0,
  isNarrow = false,
  allPanels = [],
}) {
  const isLong  = direction === "LONG";
  const isShort = direction === "SHORT";
  const mainColor = isLong ? "#22d3ee" : isShort ? "#ef4444" : "#4b5563";
  const mainAngle = -(score / 27) * 75;

  // Match legacy PulseHero: 260×136 viewBox, hub at (130, 68) — keeps the ring circular
  // (148px tall viewport + cy=68 was off-center; mismatched w/h also warped layout on some flex rows).
  const VB_W = 260;
  const VB_H = 136;
  const cx = 130, cy = 68;
  const outerR = 56, innerR = 45, coreR = 32;
  // Wide: same height as XSentinelOrb / JediMasterOrb (160px) so the hub doesn’t look flattened vs flanks.
  // Narrow: cap width (190) and derive height from viewBox aspect.
  const SIDE_ORB_PX = 160;
  let finalW;
  let finalH;
  if (isNarrow) {
    finalW = 190;
    finalH = Math.round((finalW * VB_H) / VB_W);
  } else {
    finalH = SIDE_ORB_PX;
    finalW = Math.round((finalH * VB_W) / VB_H);
  }

  const [pulseKey, setPulseKey] = useState(0);
  const prevScore = useRef(score);
  useEffect(() => {
    if (score !== prevScore.current) {
      setPulseKey(k => k + 1);
      prevScore.current = score;
    }
  }, [score]);

  return (
    <div style={{ position: "relative", flexShrink: 0, alignSelf: "center", lineHeight: 0 }}>
      <style>{ORB_STYLES}</style>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width={finalW}
        height={finalH}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", width: finalW, height: finalH, flexShrink: 0, overflow: "visible" }}
      >
        <defs>
          <filter id="coArrow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="coRing" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="coCore" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="coBg" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor={mainColor} stopOpacity="0.08" />
            <stop offset="100%" stopColor={mainColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx={cx} cy={cy} r="62"
          fill="url(#coBg)" className="orb-breath" />

        <circle cx={cx} cy={cy} r={outerR + 6} fill="none" stroke="#0d1f2e" strokeWidth="0.5" />

        <g transform={`translate(${cx},${cy})`}>
          <g className="orb-spin">
            <circle cx={0} cy={0} r={outerR + 8} fill="none"
              stroke={`${mainColor}18`} strokeWidth="0.5"
              strokeDasharray="4 8"
            />
          </g>
        </g>
        <g transform={`translate(${cx},${cy})`}>
          <g className="orb-spinrev">
            <circle cx={0} cy={0} r={outerR + 11} fill="none"
              stroke={`${mainColor}0c`} strokeWidth="0.5"
              strokeDasharray="2 12"
            />
          </g>
        </g>

        {allPanels.map((p, i) => {
          const span = 360 / 27;
          const s = i * span + 1.2;
          const e = (i + 1) * span - 1.2;
          const v   = votes[p.id] ?? 0;
          const str = strengths[p.id] ?? 0;
          const clr = v === 1 ? "#22d3ee" : v === -1 ? "#ef4444" : "#111820";
          return (
            <path key={p.id}
              d={describeArc(cx, cy, outerR, s, e)}
              stroke={clr}
              strokeWidth={v !== 0 ? 6 : 1.5}
              fill="none"
              strokeLinecap="round"
              opacity={v !== 0 ? 0.45 + str * 0.55 : 0.15}
              filter={v !== 0 ? "url(#coRing)" : undefined}
            />
          );
        })}

        {conviction > 0 && (
          <path
            d={describeArc(cx, cy, innerR, -5, Math.min(355, (conviction / 100) * 360) - 5)}
            stroke={mainColor} strokeWidth="2.5" fill="none"
            strokeLinecap="round" opacity="0.4"
          />
        )}
        <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="#0d1f2e" strokeWidth="0.5" />

        <g transform={`translate(${cx},${cy - 22}) rotate(${-(bankANet / 9) * 55})`}
           opacity="0.65" filter="url(#coRing)">
          <path d="M -11,-1.5 L 7,-1.5 L 7,-5 L 17,0 L 7,5 L 7,1.5 L -11,1.5 Z"
            fill="#22d3ee" />
        </g>
        <g transform={`translate(${cx + 1},${cy}) rotate(${-(bankBNet / 9) * 55})`}
           opacity="0.4">
          <path d="M -8,-1.2 L 5,-1.2 L 5,-3.5 L 13,0 L 5,3.5 L 5,1.2 L -8,1.2 Z"
            fill="#818cf8" />
        </g>
        <g transform={`translate(${cx},${cy + 22}) rotate(${-(bankCNet / 9) * 55})`}
           opacity="0.65" filter="url(#coRing)">
          <path d="M -11,-1.5 L 7,-1.5 L 7,-5 L 17,0 L 7,5 L 7,1.5 L -11,1.5 Z"
            fill="#4ade80" />
        </g>

        <circle cx={cx} cy={cy} r={coreR}
          fill="none" stroke={mainColor} strokeWidth="0.5" opacity="0.12" />
        <circle cx={cx} cy={cy} r={coreR}
          fill={`${mainColor}08`} filter="url(#coCore)"
          className="orb-breath"
        />
        <circle cx={cx} cy={cy} r="5" fill={mainColor} opacity="0.65" filter="url(#coCore)" />
        <circle cx={cx} cy={cy} r="2" fill="#ffffff" opacity="0.55" />

        <g key={pulseKey} transform={`translate(${cx},${cy})`}>
          <circle cx={0} cy={0} r="28"
            fill="none" stroke={mainColor} strokeWidth="2"
            className="orb-pulse-ring"
          />
        </g>

        <g
          transform={`translate(${cx},${cy}) rotate(${mainAngle})`}
          className="orb-arrow-pulse"
          style={{ transition: "transform 0.8s cubic-bezier(.4,0,.2,1)" }}
        >
          <path d="M -42,-10 L 14,-10 L 14,-22 L 52,0 L 14,22 L 14,10 L -42,10 Z"
            fill={mainColor} opacity="0.07" />
          <path d="M -36,-5.5 L 18,-5.5 L 18,-15 L 47,0 L 18,15 L 18,5.5 L -36,5.5 Z"
            fill={mainColor} opacity="0.88"
            filter="url(#coArrow)"
          />
          <line x1="-32" y1="0" x2="38" y2="0"
            stroke="#ffffff" strokeWidth="2" opacity="0.32" strokeLinecap="round" />
          <circle cx="43" cy="0" r="2.5" fill="#ffffff" opacity="0.5" />
          <circle cx="43" cy="0" r="5"   fill={mainColor} opacity="0.25" />
        </g>

        {[-75, -50, -25, 0, 25, 50, 75].map(deg => {
          const rad = ((-deg - 90) * Math.PI) / 180;
          const r1 = outerR + 6, r2 = outerR + 11;
          const isMid = deg === 0;
          return (
            <line key={deg}
              x1={cx + r1 * Math.cos(rad)} y1={cy + r1 * Math.sin(rad)}
              x2={cx + r2 * Math.cos(rad)} y2={cy + r2 * Math.sin(rad)}
              stroke={isMid ? "#3a5a6a" : "#0d1f2e"}
              strokeWidth={isMid ? 1 : 0.5}
            />
          );
        })}

        <rect x={cx - 16} y={cy + 37} width="32" height="14" rx="2"
          fill="#04070db0" stroke="#f59e0b44" strokeWidth="0.5" />
        <text x={cx} y={cy + 44}
          textAnchor="middle" dominantBaseline="central"
          fill="#f59e0b" fontSize="7" fontWeight="700" letterSpacing="2"
          fontFamily="'Barlow Condensed', sans-serif"
        >COUNCIL</text>
      </svg>
    </div>
  );
}

export function JediMasterOrb({ score = 0, direction = "FLAT", conviction = 0 }) {
  const isLong  = direction === "LONG";
  const isShort = direction === "SHORT";
  const color   = isLong ? "#22d3ee" : isShort ? "#ef4444" : "#f59e0b";

  const absScore = Math.abs(score);
  const gate     = Math.min(1, absScore / 27);
  const kellyPct = gate * conviction / 100;
  const kellyDeg = kellyPct * 320;

  const laneShift = isLong ? -9 : isShort ? 9 : 0;

  const cx = 68, cy = 68;

  return (
    <div style={{ position: "relative", width: 160, height: 160, flexShrink: 0 }}>
      <style>{ORB_STYLES}</style>
      <svg viewBox="0 0 136 136" width="160" height="160">
        <defs>
          <filter id="jmGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="jmArrow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="5.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="jmCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor={color} stopOpacity="0.15" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx={cx} cy={cy} r="63" fill="#050911" stroke="#2d2513" strokeWidth="1.2" />
        <circle cx={cx} cy={cy} r="63" fill="url(#jmCore)" className="orb-breath" />

        <circle cx={cx} cy={cy} r="58" fill="none" stroke="#1a1208" strokeWidth="1" />
        {conviction > 0 && (
          <path
            d={describeArc(cx, cy, 58, -10, Math.min(350, (conviction / 100) * 360) - 10)}
            stroke={color} strokeWidth="1.5" fill="none"
            strokeLinecap="round" opacity="0.3"
          />
        )}

        <g transform={`translate(${cx},${cy})`}>
          <g className="orb-spinrev">
            <circle cx={0} cy={0} r="50" fill="none"
              stroke={`${color}22`} strokeWidth="0.5"
              strokeDasharray="3 9"
            />
          </g>
        </g>

        <circle cx={cx} cy={cy} r="44" fill="none" stroke="#1a1208" strokeWidth="0.5" />
        {kellyDeg > 0 && (
          <path
            d={describeArc(cx, cy, 44, 20, 20 + kellyDeg)}
            stroke={color} strokeWidth="4" fill="none"
            strokeLinecap="round" opacity="0.55"
            filter="url(#jmGlow)"
          />
        )}

        <line x1={cx} y1={cy - 36} x2={cx} y2={cy - 26}
          stroke="#22d3ee" strokeWidth="2" opacity={gate > 0.3 ? 0.7 : 0.2}
          strokeLinecap="round" />
        <line x1={cx + 31} y1={cy} x2={cx + 22} y2={cy}
          stroke="#818cf8" strokeWidth="1.5" opacity={gate > 0.3 ? 0.5 : 0.15}
          strokeLinecap="round" />
        <line x1={cx} y1={cy + 36} x2={cx} y2={cy + 26}
          stroke="#4ade80" strokeWidth="2" opacity={gate > 0.3 ? 0.7 : 0.2}
          strokeLinecap="round" />
        <line x1={cx - 31} y1={cy} x2={cx - 22} y2={cy}
          stroke={color} strokeWidth="1.5" opacity={gate > 0.5 ? 0.6 : 0.15}
          strokeLinecap="round" />

        {gate > 0 && (
          <path
            d={describeArc(cx, cy, 36, 0, gate * 359.9)}
            stroke={color} strokeWidth="1.5" fill="none"
            strokeLinecap="round" opacity="0.45"
          />
        )}
        <circle cx={cx} cy={cy} r="36" fill="none" stroke="#1a1208" strokeWidth="0.5" />

        <g transform={`translate(0,${laneShift})`} filter="url(#jmArrow)" className="orb-arrow-pulse">
          <path
            d={`M 22 ${cy} L 92 ${cy} M 92 ${cy} L 79 ${cy - 12} M 92 ${cy} L 79 ${cy + 12}`}
            stroke={color} strokeWidth="2.8"
            strokeLinecap="round" fill="none" opacity="0.9"
          />
          <circle cx="88" cy={cy} r="3" fill={color} opacity="0.5" />
          <circle cx="88" cy={cy} r="1.5" fill="#ffffff" opacity="0.6" />
        </g>
        <path
          d={`M 26 ${cy - 14 + laneShift * 0.6} L 78 ${cy - 14 + laneShift * 0.6} M 78 ${cy - 14 + laneShift * 0.6} L 70 ${cy - 20 + laneShift * 0.6} M 78 ${cy - 14 + laneShift * 0.6} L 70 ${cy - 8 + laneShift * 0.6}`}
          stroke={color} strokeWidth="1.4"
          strokeLinecap="round" fill="none" opacity="0.35"
        />
        <path
          d={`M 26 ${cy + 14 + laneShift * 0.6} L 78 ${cy + 14 + laneShift * 0.6} M 78 ${cy + 14 + laneShift * 0.6} L 70 ${cy + 8 + laneShift * 0.6} M 78 ${cy + 14 + laneShift * 0.6} L 70 ${cy + 20 + laneShift * 0.6}`}
          stroke={color} strokeWidth="1.4"
          strokeLinecap="round" fill="none" opacity="0.35"
        />

        <circle cx={cx} cy={cy} r="18"
          fill="none" stroke={color} strokeWidth={0.5 + gate * 1.5}
          opacity={0.3 + gate * 0.45}
          filter="url(#jmGlow)"
        />
        <circle cx={cx} cy={cy} r="5" fill={color} opacity="0.55" />
        <circle cx={cx} cy={cy} r="2" fill="#ffffff" opacity="0.5" />

        <text x={cx} y={cy - 22}
          textAnchor="middle" dominantBaseline="central"
          fill={color} fontSize="10" fontWeight="900"
          fontFamily="'Barlow Condensed', sans-serif"
          opacity="0.75"
        >{Math.round(gate * 100)}%</text>

        <rect x={cx - 18} y={cy + 44} width="36" height="14" rx="2"
          fill="#04070db0" stroke={`${color}44`} strokeWidth="0.5" />
        <text x={cx} y={cy + 51}
          textAnchor="middle" dominantBaseline="central"
          fill={color} fontSize="7" fontWeight="700" letterSpacing="2"
          fontFamily="'Barlow Condensed', sans-serif"
        >JEDI M.</text>
      </svg>
    </div>
  );
}
