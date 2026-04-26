/**
 * SOLO master orb — MaxCogViz human-cognitive design.
 * Big central arrow rotates -90°→+90° (positive = BULL = up).
 * ±9° dead-zone = horizontal (neutral).
 * 6 perimeter signal arrows (WEEK·DAILY·VWAP·VOL·EMA·ORB) from signalArrows prop.
 * Williams %R → xaiSentiment arc. OBI direction → jediAlign dots.
 */
import { type CSSProperties, type ReactElement } from 'react';

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const s = ((startDeg - 90) * Math.PI) / 180;
  const e = ((endDeg - 90) * Math.PI) / 180;
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx + r * Math.cos(s)} ${cy + r * Math.sin(s)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(e)} ${cy + r * Math.sin(e)}`;
}

export function rvolToArrowDeg(rvol: number, rvolSaturation = 2.5): number {
  if (!Number.isFinite(rvol) || rvol <= 0) return 0;
  if (rvol < 1) return (rvol - 1) * 30;
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
  @keyframes orbArrowPulse { 0%,100%{opacity:0.72} 50%{opacity:1} }
  .solo-orb-breath   { animation: orbBreath  3.2s ease-in-out infinite; }
  .solo-orb-spin, .solo-orb-spinrev { transform-box: fill-box; transform-origin: center; }
  .solo-orb-spin     { animation: orbSpin    12s linear infinite; }
  .solo-orb-spinrev  { animation: orbSpinRev 18s linear infinite; }
  .solo-orb-pulse-ring { animation: orbPulseRing 0.9s ease-out forwards; transform-box: fill-box; transform-origin: center; }
  .solo-orb-arrow-pulse{ animation: orbArrowPulse 1.8s ease-in-out infinite; }
  .solo-arr-transition { transition: transform 0.55s cubic-bezier(0.34,1.56,0.64,1); }
`;

export type SoloOrbDirection = 'LONG' | 'SHORT' | 'FLAT';

export type SoloSignalArrow = { id: string; dir: 'BULL' | 'BEAR' | 'NEUTRAL' };

export type SoloMasterOrbProps = {
  score?: number;
  direction?: SoloOrbDirection;
  conviction?: number;
  strengthPct?: number;
  onMoveStrengthPct?: number;
  rvolRatio?: number;
  rvolSaturation?: number;
  density?: 'rich' | 'focus';
  xaiSentiment?: number | null;
  jediAlign?: number | null;
  /** -90 to +90 degrees. 0 = horizontal (neutral). +90 = BULL (up). -90 = BEAR (down).
   *  ±9° dead-zone treated as neutral (horizontal). */
  bigArrowAngleDeg?: number;
  /** Component signal arrows at perimeter — up to 6 rendered clockwise from top. */
  signalArrows?: SoloSignalArrow[];
};

function flatNeutralColor(strengthPct: number): string {
  if (strengthPct >= 50) return 'var(--solo-neutral-pulse, #14b8a6)';
  if (strengthPct >= 35) return 'var(--solo-neutral-warm, #c2410c)';
  return 'var(--solo-neutral-calm, #38bdf8)';
}

// Perimeter positions (r=55 from cx=68,cy=68) for up to 6 signal arrows, clockwise from top
const PERIM_ANGLES = [0, 60, 120, 180, 240, 300]
function perimPos(thetaDeg: number, r = 55): [number, number] {
  const rad = (thetaDeg - 90) * Math.PI / 180
  return [68 + r * Math.cos(rad), 68 + r * Math.sin(rad)]
}

function SignalArrow({ x, y, id, dir }: { x: number; y: number; id: string; dir: 'BULL'|'BEAR'|'NEUTRAL' }) {
  const c = dir === 'BULL' ? '#4ade80' : dir === 'BEAR' ? '#f43f5e' : '#60a5fa'
  // Same rotation language as big arrow: 0°=horizontal, -90°=up(bull), +90°=down(bear)
  const angle = dir === 'BULL' ? -90 : dir === 'BEAR' ? 90 : 0
  const lx = x + (68 - x) * 0.36
  const ly = y + (68 - y) * 0.36
  return (
    <g opacity="0.6">
      <g style={{
        transform: `translate(${x}px,${y}px) rotate(${angle}deg)`,
        transition: 'transform 0.5s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
        <line x1="-5" y1="0" x2="4.5" y2="0" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M4.5 0 L1.2 -2.4 M4.5 0 L1.2 2.4" stroke={c} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      </g>
      <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central"
        fill={c} fontSize="5" fontWeight="700" fontFamily="'Barlow Condensed', monospace"
        letterSpacing="0.05em" opacity="0.9">
        {id.slice(0, 4)}
      </text>
    </g>
  )
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
  xaiSentiment = null,
  jediAlign = null,
  bigArrowAngleDeg,
  signalArrows,
}: SoloMasterOrbProps): ReactElement {

  // Arrow angle: bigArrowAngleDeg if provided, else derive from direction
  const NEUTRAL_DEG = 9
  const rawAngle = bigArrowAngleDeg !== undefined ? bigArrowAngleDeg
    : direction === 'LONG' ? 70 : direction === 'SHORT' ? -70 : 0
  const clampedAngle = Math.max(-90, Math.min(90, rawAngle))
  // Apply dead-zone: ±NEUTRAL_DEG → horizontal
  const effectiveAngle = Math.abs(clampedAngle) < NEUTRAL_DEG ? 0 : clampedAngle

  // Big arrow color from effective angle
  const isUp     = effectiveAngle > NEUTRAL_DEG
  const isDown   = effectiveAngle < -NEUTRAL_DEG
  const arrowColor = isUp
    ? 'var(--solo-long, #22c55e)'
    : isDown
      ? 'var(--solo-short, #f43f5e)'
      : flatNeutralColor(strengthPct)

  // Legacy: orb ring color still from direction prop (score/conviction)
  const isLong  = direction === 'LONG'
  const isShort = direction === 'SHORT'
  const ringColor = isLong
    ? 'var(--solo-long, #22c55e)'
    : isShort
      ? 'var(--solo-short, #f43f5e)'
      : flatNeutralColor(strengthPct)

  const absScore   = Math.abs(score)
  const gate       = Math.min(1, absScore / 27)
  const kellyPct   = gate * (conviction / 100)
  const kellyDeg   = kellyPct * 320

  const cx = 68, cy = 68
  const rich = density === 'rich'
  const rvolDeg   = rvolToArrowDeg(rvolRatio, rvolSaturation)
  const rvolColor = 'var(--solo-rvol, #7dd3fc)'

  // SVG rotation: positive effectiveAngle = BULL = up = SVG rotate(-angle)
  // SVG rotate(deg) is clockwise, so -angle rotates counterclockwise = toward up
  const svgArrowRotate = -effectiveAngle

  const arrowStyle: CSSProperties = {
    transformBox: 'fill-box',
    transformOrigin: 'center',
    transform: `rotate(${svgArrowRotate}deg)`,
    transition: 'transform 0.55s cubic-bezier(0.34,1.56,0.64,1)',
  }

  return (
    <div style={{ position: 'relative', width: 160, height: 160, flexShrink: 0 }}>
      <style>{ORB_STYLES}</style>
      <svg viewBox="0 0 136 136" width="160" height="160" aria-hidden>
        <defs>
          <filter id="soloJmGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="soloJmArrow" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="5.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="soloJmSig" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="soloJmCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={ringColor} stopOpacity="0.15" />
            <stop offset="100%" stopColor={ringColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Background */}
        <circle cx={cx} cy={cy} r="63" fill="#050911" stroke="#2d2513" strokeWidth="1.2" />
        <circle cx={cx} cy={cy} r="63" fill="url(#soloJmCore)" className="solo-orb-breath" />

        {/* Conviction ring */}
        <circle cx={cx} cy={cy} r="58" fill="none" stroke="#1a1208" strokeWidth="1" />
        {conviction > 0 && (
          <path d={describeArc(cx, cy, 58, -10, Math.min(350, (conviction / 100) * 360) - 10)}
            stroke={ringColor} strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.3" />
        )}

        {/* Dashed spinner ring */}
        {rich && (
          <g transform={`translate(${cx},${cy})`}>
            <g className="solo-orb-spinrev">
              <circle cx={0} cy={0} r="50" fill="none" stroke={`${ringColor}22`} strokeWidth="0.5" strokeDasharray="3 9" />
            </g>
          </g>
        )}

        {/* ── Signal arrows at perimeter — hexagonal layout ─────────────────── */}
        {signalArrows && signalArrows.length > 0 && (
          <g filter="url(#soloJmSig)">
            {signalArrows.slice(0, 6).map((sa, i) => {
              const [px, py] = perimPos(PERIM_ANGLES[i]!)
              return <SignalArrow key={sa.id} x={px} y={py} id={sa.id} dir={sa.dir} />
            })}
          </g>
        )}

        {/* Kelly arc */}
        <circle cx={cx} cy={cy} r="44" fill="none" stroke="#1a1208" strokeWidth="0.5" />
        {kellyDeg > 0 && (
          <path d={describeArc(cx, cy, 44, 20, 20 + kellyDeg)}
            stroke={ringColor} strokeWidth="4" fill="none" strokeLinecap="round"
            opacity="0.55" filter="url(#soloJmGlow)" />
        )}

        {/* XAI sentiment arc (Williams %R) */}
        {xaiSentiment !== null && rich && (() => {
          const s    = Math.max(-1, Math.min(1, xaiSentiment))
          const deg  = Math.abs(s) * 140
          const col  = s >= 0 ? '#22d3ee' : '#f43f5e'
          const startD = s >= 0 ? 250 : 250 - deg
          return deg > 2 ? (
            <path d={describeArc(cx, cy, 28, startD, startD + deg)}
              stroke={col} strokeWidth="3" fill="none" strokeLinecap="round"
              opacity={0.35 + Math.abs(s) * 0.45} />
          ) : null
        })()}

        {/* JEDI align dots (OBI direction agreement) */}
        {jediAlign !== null && rich && (() => {
          const ja     = Math.max(-1, Math.min(1, jediAlign))
          const agrees = (direction === 'LONG' && ja > 0.25) || (direction === 'SHORT' && ja < -0.25)
          const dotCol = agrees ? ringColor : '#f59e0b'
          const lit    = Math.abs(ja)
          return (
            <g>
              {[-1, 0, 1].map(i => {
                const dotX = cx - 10 + i * 10
                const litI = lit >= (i + 1) / 3
                return (
                  <circle key={i} cx={dotX} cy={cy - 28} r="2.2"
                    fill={litI ? dotCol : '#1a2535'}
                    opacity={litI ? 0.8 : 0.25}
                    stroke={litI ? dotCol : 'none'} strokeWidth="0.5" />
                )
              })}
            </g>
          )
        })()}

        {/* ── BIG CENTRAL ARROW — rotates ±90° by effectiveAngle ──────────── */}
        {/* Uses CSS transition via style prop for smooth animation */}
        <g style={arrowStyle} filter="url(#soloJmArrow)" className="solo-orb-arrow-pulse">
          {/* Shaft from left to right through center, arrowhead on right */}
          <line x1={cx - 30} y1={cy} x2={cx + 24} y2={cy}
            stroke={arrowColor} strokeWidth="3.2" strokeLinecap="round" opacity="0.92" />
          {/* Arrowhead */}
          <path d={`M${cx+24} ${cy} L${cx+14} ${cy-9} M${cx+24} ${cy} L${cx+14} ${cy+9}`}
            stroke={arrowColor} strokeWidth="3.2" strokeLinecap="round" fill="none" opacity="0.92" />
          {/* Hot tip dot */}
          <circle cx={cx + 22} cy={cy} r="2.8" fill={arrowColor} opacity="0.55" />
          <circle cx={cx + 22} cy={cy} r="1.2" fill="#ffffff" opacity="0.65" />
        </g>

        {/* Secondary flanking arrows — weekly / daily bias read */}
        {rich && (() => {
          const weekArr = signalArrows?.find(s => s.id === 'WEEK')
          const dailyArr = signalArrows?.find(s => s.id === 'DAILY')
          const topDir  = weekArr?.dir  ?? (isLong ? 'BULL' : isShort ? 'BEAR' : 'NEUTRAL')
          const botDir  = dailyArr?.dir ?? topDir
          const topC    = topDir === 'BULL' ? '#4ade80' : topDir === 'BEAR' ? '#f43f5e' : '#60a5fa'
          const botC    = botDir === 'BULL' ? '#4ade80' : botDir === 'BEAR' ? '#f43f5e' : '#60a5fa'
          const topY    = cy - 16
          const botY    = cy + 16
          return (
            <>
              {/* Top flanker (weekly) */}
              {topDir === 'BULL' && <path d={`M${cx} ${topY-5} L${cx+4} ${topY+3} L${cx-4} ${topY+3} Z`} fill={topC} opacity="0.5" />}
              {topDir === 'BEAR' && <path d={`M${cx} ${topY+5} L${cx+4} ${topY-3} L${cx-4} ${topY-3} Z`} fill={topC} opacity="0.5" />}
              {topDir === 'NEUTRAL' && <line x1={cx-4} y1={topY} x2={cx+4} y2={topY} stroke={topC} strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />}
              {/* Bottom flanker (daily) */}
              {botDir === 'BULL' && <path d={`M${cx} ${botY-5} L${cx+4} ${botY+3} L${cx-4} ${botY+3} Z`} fill={botC} opacity="0.5" />}
              {botDir === 'BEAR' && <path d={`M${cx} ${botY+5} L${cx+4} ${botY-3} L${cx-4} ${botY-3} Z`} fill={botC} opacity="0.5" />}
              {botDir === 'NEUTRAL' && <line x1={cx-4} y1={botY} x2={cx+4} y2={botY} stroke={botC} strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />}
            </>
          )
        })()}

        {/* Hub */}
        <circle cx={cx} cy={cy} r="18" fill="none" stroke={ringColor}
          strokeWidth={0.5 + gate * 1.5} opacity={0.3 + gate * 0.45} filter="url(#soloJmGlow)" />
        <circle cx={cx} cy={cy} r="5" fill={arrowColor} opacity="0.55" />
        <circle cx={cx} cy={cy} r="2" fill="#ffffff" opacity="0.5" />

        {/* Angle readout (replaces old % label) */}
        <text x={cx} y={cy - (rich ? 22 : 14)} textAnchor="middle" dominantBaseline="central"
          fill={arrowColor} fontSize="9" fontWeight="900"
          fontFamily="'Barlow Condensed', sans-serif" opacity="0.75">
          {effectiveAngle === 0 ? '—' : `${effectiveAngle > 0 ? '+' : ''}${Math.round(effectiveAngle)}°`}
        </text>

        {/* RVOL bottom arrow */}
        <g transform={`translate(${cx}, 109) rotate(${rvolDeg})`}
          opacity={rvolRatio > 0 ? 0.95 : 0.35}>
          <line x1="-16" y1="0" x2="10" y2="0" stroke={rvolColor} strokeWidth="1.35" strokeLinecap="round" />
          <path d="M 10 0 L 4.5 -2.8 M 10 0 L 4.5 2.8" stroke={rvolColor} strokeWidth="1.35" strokeLinecap="round" fill="none" />
        </g>
        <text x={cx} y={121} textAnchor="middle" dominantBaseline="central"
          fill="#4a6f84" fontSize="5.5" fontWeight="700"
          fontFamily="'Barlow Condensed', sans-serif" letterSpacing="0.18em" opacity="0.9">
          RVOL
        </text>

        {/* SOLO label badge */}
        <rect x={cx-18} y={cy+44} width="36" height="14" rx="2"
          fill="#04070db0" stroke={`${ringColor}44`} strokeWidth="0.5" />
        <text x={cx} y={cy+51} textAnchor="middle" dominantBaseline="central"
          fill={arrowColor} fontSize="7" fontWeight="700" letterSpacing="2"
          fontFamily="'Barlow Condensed', sans-serif">
          SOLO
        </text>
      </svg>
    </div>
  )
}
