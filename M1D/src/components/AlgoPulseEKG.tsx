import type { CSSProperties } from 'react';

export type PulseDirection = 'LONG' | 'SHORT' | 'FLAT';

const W = 1000;
const H = 120;

function strokeForDirection(d: PulseDirection): string {
  if (d === 'LONG') return '#22d3ee';
  if (d === 'SHORT') return '#f87171';
  return '#64748b';
}

/** Build EKG-style polyline: ensemble bias (−1…1) + short synthetic QRS-like deflections for legibility on 4K wallboards. */
function buildPoints(samples: number[], pulseIndex: number): string {
  const n = Math.max(2, samples.length);
  const mid = H * 0.52;
  const amp = 36;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * W;
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const phase = (i + pulseIndex * 3) % 24;
    let deflect = 0;
    if (phase === 0) deflect = -6;
    if (phase === 1) deflect = 20;
    if (phase === 2) deflect = -32;
    if (phase === 3) deflect = 16;
    if (phase === 4) deflect = -5;
    const y = mid - s * amp - deflect;
    out.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return out.join(' ');
}

type Props = {
  samples: number[];
  direction: PulseDirection;
  pulseIndex: number;
  className?: string;
  style?: CSSProperties;
};

/**
 * Algo pulse “EKG” — maps council ensemble pressure over time.
 * Ported in spirit from `M4D-27-ALGO-MaxCogViz_ControlRoom.jsx` drift strip; tuned for wide 4K strips.
 */
export function AlgoPulseEKG({ samples, direction, pulseIndex, className, style }: Props) {
  const stroke = strokeForDirection(direction);
  const pts = buildPoints(samples, pulseIndex);
  const last = samples.length ? samples[samples.length - 1]! : 0;

  return (
    <div className={`algo-pulse-ekg ${className ?? ''}`.trim()} style={style}>
      <div className="algo-pulse-ekg__meta">
        <span className="algo-pulse-ekg__label">ALGO PULSE · EKG</span>
        <span className="algo-pulse-ekg__bias" style={{ color: stroke }}>
          {direction} · {last >= 0 ? '+' : ''}{(last * 100).toFixed(0)}¢ bias
        </span>
      </div>
      <svg
        className="algo-pulse-ekg__svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Ensemble pulse trace"
      >
        <defs>
          <linearGradient id="algo-pulse-grid" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#0d1f2e" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0d1f2e" stopOpacity="0.08" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill="url(#algo-pulse-grid)" />
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#1e293b" strokeWidth={0.8} strokeDasharray="6 8" />
        <polyline
          points={pts}
          fill="none"
          stroke={stroke}
          strokeWidth={1.4}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${stroke}66)` }}
        />
      </svg>
    </div>
  );
}
