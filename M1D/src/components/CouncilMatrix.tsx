import type { CSSProperties } from 'react';
import type { CouncilAlgo, CouncilHeader } from '../council';

type Props = {
  header: CouncilHeader;
  algos: CouncilAlgo[];
  /** Optional PCA / importance 0–1 for future heat (null = hide) */
  emphasis?: Record<string, number>;
  onCellClick?: (a: CouncilAlgo) => void;
};

/** 3×3 compact grid — one council bank */
export function CouncilMatrix({ header, algos, emphasis, onCellClick }: Props) {
  const nine = algos.slice(0, 9);
  while (nine.length < 9) {
    nine.push({
      id: `—${nine.length}`,
      tier: header.tier as CouncilAlgo['tier'],
      name: '—',
      sub: '',
      color: '#334155',
      method: '',
    });
  }

  return (
    <section className="council-matrix" style={{ borderColor: header.color }}>
      <header className="council-matrix__head">
        <span className="council-matrix__label" style={{ color: header.color }}>
          {header.label}
        </span>
        <span className="council-matrix__sub">{header.sub}</span>
      </header>
      <div className="council-matrix__grid">
        {nine.map((algo) => {
          const emp = emphasis?.[algo.id];
          const style = {
            borderColor: algo.color,
            boxShadow:
              emp != null && emp > 0.55
                ? `0 0 12px ${algo.color}55`
                : undefined,
          } as CSSProperties;
          const isPlaceholder = algo.id.startsWith('—');
          return (
            <button
              key={algo.id}
              type="button"
              className={`council-cell${isPlaceholder ? ' council-cell--placeholder' : ''}`}
              style={style}
              disabled={isPlaceholder}
              onClick={() => !isPlaceholder && onCellClick?.(algo)}
              title={algo.method || algo.name}
            >
              <span className="council-cell__id">{algo.id}</span>
              <span className="council-cell__name">{algo.name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
