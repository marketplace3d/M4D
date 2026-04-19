/**
 * SOLO master orb — JediMasterOrb lineage, tuned for Mission Charts.
 * - Center: combined trend arrow (flips for SHORT).
 * - Bottom: RVOL vs ~20-bar avg → small arrow: 1× = right (0°), quiet tilts down, hot → up to 90° (rescale via rvolSaturation).
 * - Later: optional xaiSentiment / jediAlign props (reserved; wire when APIs exist).
 */
import type { ReactElement } from 'react';

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const s = ((startDeg - 90) * Math.PI) / 180;
  const e = ((endDeg - 90) * Math.PI) / 180;
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx + r * Math.cos(s)} ${cy + r * Math.sin(s)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(e)} ${cy + r * Math.sin(e)}`;
}

/**
 * Maps relative volume (last bar / trailing avg) to arrow angle in degrees.
 * - 1× avg → 0° (points right).
 * - Below 1× → slight downward tilt (dry tape).
 * - Above 1× → swings toward +90° (up); hits 90° at `rvolSaturation` (e.g. 2.5×). Increase saturation to require more vol before “vertical”.
 */
export function rvolToArrowDeg(rvol: number, rvolSaturation = 2.5): number {
  if (!Number.isFinite(rvol) || rvol <= 0) return 0;
  if (rvol < 1) {
    return (rvol - 1) * 30;
  }
  const cap = Math.max(1.001, rvolSaturation);
  const t = Math.min(1, (rvol - 1) / (cap - 1));
  return t * 90;
}

const ORB_STYLES = `
  @keyframes orbBreath   { 0%,100%{opacity:0.55} 50%{opacity:1} }
  @keyframes orbSpin     { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes orbSpinRev  { from{transform:rotate(360deg)} to{transform:rotate(0deg)} }
  @keyframes orbPulseRing{ 0%{transform:scale(0.88);opacity:0.55} 100%{transform:scale(2.05);opacity:0} }
  @keyframes orbFlicker  { 0%,100%{opacity:1} 45%{opacity:0.7} 55%{opacity:0.9} }
  @keyframes orbRise     { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
  @keyframes orbFall     { 0%,100%{transform:translateY(0)} 50%{transform:translateY(3px)} }
  .solo-orb-breath  { animation: orbBreath  3.2s ease-in-out infinite; }
  .solo-orb-spin, .solo-orb-spinrev { transform-box: fill-box; transform-origin: center; }
  .solo-orb-spin    { animation: orbSpin    12s linear infinite; }
  .solo-orb-spinrev { animation: orbSpinRev 18s linear infinite; }
  .solo-orb-pulse-ring { animation: orbPulseRing 0.9s ease-out forwards; transform-box: fill-box; transform-origin: center; }
  .solo-orb-flicker { animation: orbFlicker 2.4s ease-in-out infinite; }
  .solo-orb-rise    { animation: orbRise    2s ease-in-out infinite; }
  .solo-orb-fall    { animation: orbFall    2s ease-in-out infinite; }
  .solo-orb-arrow-pulse { animation: orbBreath 1.8s ease-in-out infinite; }
`;

export type SoloOrbDirection = 'LONG' | 'SHORT' | 'FLAT';

export type SoloMasterOrbProps = {
  score?: number;
  direction?: SoloOrbDirection;
  conviction?: number;
  /** 0–100 participation / move strength — tiers neutral calm → warm → pulse; fuels “on the move” with direction. */
  strengthPct?: number;
  /** Strength at or above this with LONG/SHORT triggers MaxCogViz-style outer glow (default 50). */
  onMoveStrengthPct?: number;
  /** Last-bar volume / trailing average (~1 = baseline for horizontal RVOL arrow). */
  rvolRatio?: number;
  /** RVOL multiple at which the bottom arrow reaches 90° (up). */
  rvolSaturation?: number;
  /** `focus` = arrow-first, less chrome. `rich` = full Jedi-style decoration. */
  density?: 'rich' | 'focus';
  /** Reserved: Grok / XAI sentiment in [-1, 1] — blend into hub or inner ring when wired. */
  xaiSentiment?: number | null;
  /** Reserved: council JEDI alignment in [-1, 1] — second read vs price trend when wired. */
  jediAlign?: number | null;
};

/** SVG paint: reads CSS vars from `.tv-lw-solo-dock__orb` (override palette without TS). */
function flatNeutralColor(strengthPct: number): string {
  if (strengthPct >= 50) return 'var(--solo-neutral-pulse, #14b8a6)';
  if (strengthPct >= 35) return 'var(--solo-neutral-warm, #c2410c)';
  return 'var(--solo-neutral-calm, #38bdf8)';
}

export function SoloMasterOrb({
  score = 0,
  direction = 'FLAT',
  conviction = 0,
  strengthPct = 0,
  onMoveStrengthPct = 50,
  rvolRatio = 0,
  rvolSaturation = 2.5,
  density = 'rich',
  xaiSentiment: _xaiSentiment = null,
  jediAlign: _jediAlign = null,
}: SoloMasterOrbProps): ReactElement {
  void _xaiSentiment;
  void _jediAlign;

  const isLong = direction === 'LONG';
  const isShort = direction === 'SHORT';
  const color = isLong
    ? 'var(--solo-long, #22c55e)'
    : isShort
      ? 'var(--solo-short, #f43f5e)'
      : flatNeutralColor(strengthPct);

  const absScore = Math.abs(score);
  const gate = Math.min(1, absScore / 27);
  const kellyPct = gate * (conviction / 100);
  const kellyDeg = kellyPct * 320;

  const laneShift = isLong ? -9 : isShort ? 9 : 0;

  const cx = 68;
  const cy = 68;
  const rich = density === 'rich';
  const rvolDeg = rvolToArrowDeg(rvolRatio, rvolSaturation);
  const rvolColor = 'var(--solo-rvol, #7dd3fc)';
  const longAccent = 'var(--solo-long-accent, #4ade80)';

  const trendArrowWrap = isShort
    ? `translate(${cx},${laneShift}) scale(-1, 1) translate(${-cx},0)`
    : `translate(0,${laneShift})`;

  return (
    <div style={{ position: 'relative', width: 160, height: 160, flexShrink: 0 }}>
      <style>{ORB_STYLES}</style>
      <svg viewBox="0 0 136 136" width="160" height="160" aria-hidden>
        <defs>
          <filter id="soloJmGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="soloJmArrow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="5.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="soloJmCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={color} stopOpacity="0.15" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx={cx} cy={cy} r="63" fill="#050911" stroke="#2d2513" strokeWidth="1.2" />
        <circle cx={cx} cy={cy} r="63" fill="url(#soloJmCore)" className="solo-orb-breath" />

        <circle cx={cx} cy={cy} r="58" fill="none" stroke="#1a1208" strokeWidth="1" />
        {conviction > 0 ? (
          <path
            d={describeArc(cx, cy, 58, -10, Math.min(350, (conviction / 100) * 360) - 10)}
            stroke={color}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            opacity="0.3"
          />
        ) : null}

        {rich ? (
          <g transform={`translate(${cx},${cy})`}>
            <g className="solo-orb-spinrev">
              <circle cx={0} cy={0} r="50" fill="none" stroke={`${color}22`} strokeWidth="0.5" strokeDasharray="3 9" />
            </g>
          </g>
        ) : null}

        <circle cx={cx} cy={cy} r="44" fill="none" stroke="#1a1208" strokeWidth="0.5" />
        {kellyDeg > 0 ? (
          <path
            d={describeArc(cx, cy, 44, 20, 20 + kellyDeg)}
            stroke={color}
            strokeWidth="4"
            fill="none"
            strokeLinecap="round"
            opacity="0.55"
            filter="url(#soloJmGlow)"
          />
        ) : null}

        {rich ? (
          <>
            <line
              x1={cx}
              y1={cy - 36}
              x2={cx}
              y2={cy - 26}
              stroke="#22d3ee"
              strokeWidth="2"
              opacity={gate > 0.3 ? 0.7 : 0.2}
              strokeLinecap="round"
            />
            <line
              x1={cx + 31}
              y1={cy}
              x2={cx + 22}
              y2={cy}
              stroke="#818cf8"
              strokeWidth="1.5"
              opacity={gate > 0.3 ? 0.5 : 0.15}
              strokeLinecap="round"
            />
            <line
              x1={cx}
              y1={cy + 36}
              x2={cx}
              y2={cy + 26}
              stroke={longAccent}
              strokeWidth="2"
              opacity={gate > 0.3 ? 0.7 : 0.2}
              strokeLinecap="round"
            />
            <line
              x1={cx - 31}
              y1={cy}
              x2={cx - 22}
              y2={cy}
              stroke={color}
              strokeWidth="1.5"
              opacity={gate > 0.5 ? 0.6 : 0.15}
              strokeLinecap="round"
            />
          </>
        ) : null}

        {rich && gate > 0 ? (
          <path
            d={describeArc(cx, cy, 36, 0, gate * 359.9)}
            stroke={color}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            opacity="0.45"
          />
        ) : null}
        {rich ? <circle cx={cx} cy={cy} r="36" fill="none" stroke="#1a1208" strokeWidth="0.5" /> : null}

        <g transform={trendArrowWrap} filter="url(#soloJmArrow)" className="solo-orb-arrow-pulse">
          <path
            d={`M 22 ${cy} L 92 ${cy} M 92 ${cy} L 79 ${cy - 12} M 92 ${cy} L 79 ${cy + 12}`}
            stroke={color}
            strokeWidth="2.8"
            strokeLinecap="round"
            fill="none"
            opacity="0.9"
          />
          <circle cx="88" cy={cy} r="3" fill={color} opacity="0.5" />
          <circle cx="88" cy={cy} r="1.5" fill="#ffffff" opacity="0.6" />
        </g>
        <g transform={trendArrowWrap}>
          <path
            d={`M 26 ${cy - 14 + laneShift * 0.6} L 78 ${cy - 14 + laneShift * 0.6} M 78 ${cy - 14 + laneShift * 0.6} L 70 ${cy - 20 + laneShift * 0.6} M 78 ${cy - 14 + laneShift * 0.6} L 70 ${cy - 8 + laneShift * 0.6}`}
            stroke={color}
            strokeWidth="1.4"
            strokeLinecap="round"
            fill="none"
            opacity="0.35"
          />
          <path
            d={`M 26 ${cy + 14 + laneShift * 0.6} L 78 ${cy + 14 + laneShift * 0.6} M 78 ${cy + 14 + laneShift * 0.6} L 70 ${cy + 8 + laneShift * 0.6} M 78 ${cy + 14 + laneShift * 0.6} L 70 ${cy + 20 + laneShift * 0.6}`}
            stroke={color}
            strokeWidth="1.4"
            strokeLinecap="round"
            fill="none"
            opacity="0.35"
          />
        </g>

        <circle
          cx={cx}
          cy={cy}
          r="18"
          fill="none"
          stroke={color}
          strokeWidth={rich ? 0.5 + gate * 1.5 : 0.35 + gate * 0.9}
          opacity={rich ? 0.3 + gate * 0.45 : 0.22 + gate * 0.35}
          filter="url(#soloJmGlow)"
        />
        <circle cx={cx} cy={cy} r="5" fill={color} opacity="0.55" />
        <circle cx={cx} cy={cy} r="2" fill="#ffffff" opacity="0.5" />

        {!rich ? (
          <text
            x={cx}
            y={cy - 24}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#64748b"
            fontSize="6"
            fontWeight="800"
            fontFamily="'Barlow Condensed', sans-serif"
            letterSpacing="0.14em"
            opacity="0.85"
          >
            TREND
          </text>
        ) : null}
        <text
          x={cx}
          y={cy - (rich ? 22 : 14)}
          textAnchor="middle"
          dominantBaseline="central"
          fill={color}
          fontSize="10"
          fontWeight="900"
          fontFamily="'Barlow Condensed', sans-serif"
          opacity="0.75"
        >
          {Math.round(gate * 100)}%
        </text>

        {/* RVOL vs avg: bottom meter, arrow rotates right → up with heat */}
        <g
          transform={`translate(${cx}, 109) rotate(${rvolDeg})`}
          opacity={rvolRatio > 0 ? 0.95 : 0.35}
        >
          <line x1="-16" y1="0" x2="10" y2="0" stroke={rvolColor} strokeWidth="1.35" strokeLinecap="round" />
          <path d="M 10 0 L 4.5 -2.8 M 10 0 L 4.5 2.8" stroke={rvolColor} strokeWidth="1.35" strokeLinecap="round" fill="none" />
        </g>
        <text
          x={cx}
          y={121}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#4a6f84"
          fontSize="5.5"
          fontWeight="700"
          fontFamily="'Barlow Condensed', sans-serif"
          letterSpacing="0.18em"
          opacity="0.9"
        >
          RVOL
        </text>

        <rect
          x={cx - 18}
          y={cy + 44}
          width="36"
          height="14"
          rx="2"
          fill="#04070db0"
          stroke={`${color}44`}
          strokeWidth="0.5"
        />
        <text
          x={cx}
          y={cy + 51}
          textAnchor="middle"
          dominantBaseline="central"
          fill={color}
          fontSize="7"
          fontWeight="700"
          letterSpacing="2"
          fontFamily="'Barlow Condensed', sans-serif"
        >
          SOLO
        </text>
      </svg>
    </div>
  );
}
