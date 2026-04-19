import type { VoteLine } from '../m4d/m4dApi';
import './AlgoVoteSparkline.css';

type Props = {
  votes: VoteLine[];
  width?: number;
  height?: number;
};

function voteY(v: number, h: number): number {
  const pad = 4;
  const inner = h - pad * 2;
  if (v === 1) return pad;
  if (v === -1) return h - pad;
  return pad + inner / 2;
}

/** Dual sparkline: vote (−1/0/+1 as vertical bands) and strength (teal polyline, 0–1). */
export default function AlgoVoteSparkline({ votes, width = 280, height = 56 }: Props) {
  if (votes.length === 0) {
    return <div className="algo-spark algo-spark--empty">No vote rows</div>;
  }

  const n = votes.length;
  const sx = (i: number) => (n <= 1 ? width / 2 : (i / (n - 1)) * width);

  const strengthPts = votes
    .map((v, i) => {
      const x = sx(i);
      const y = height - 4 - v.strength * (height - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const dotClass = (vote: number) => {
    if (vote === 1) return 'algo-spark__dot--long';
    if (vote === -1) return 'algo-spark__dot--short';
    return 'algo-spark__dot--flat';
  };

  const voteSegs = votes.map((v, i) => {
    const x = sx(i);
    const y = voteY(v.vote, height);
    return <circle key={i} cx={x} cy={y} r={2.2} className={`algo-spark__dot ${dotClass(v.vote)}`} />;
  });

  return (
    <svg
      className="algo-spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Vote and strength over bars"
    >
      <line className="algo-spark__mid" x1={0} y1={height / 2} x2={width} y2={height / 2} />
      <polyline className="algo-spark__strength" points={strengthPts} fill="none" />
      {voteSegs}
    </svg>
  );
}
