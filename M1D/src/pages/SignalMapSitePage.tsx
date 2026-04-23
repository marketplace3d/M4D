import { useState } from 'react';
import mapSvgUrl from '../assets/maxjedialpha_iteropt_map.svg';

/** Mission route wrapper for Signal Map site page (`#signalmap`, `#smap`). */
export default function SignalMapSitePage() {
  const [loadFailed, setLoadFailed] = useState(false);

  return (
    <div
      style={{
        minHeight: 'calc(100dvh - 120px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        background: '#04060a',
        padding: '0.75rem',
      }}
    >
      <div
        style={{
          fontSize: '0.72rem',
          letterSpacing: '0.08em',
          color: '#94a3b8',
          opacity: 0.9,
        }}
      >
        MAXJEDIALPHA · ALGO TRADING SYSTEM MAP
      </div>
      <div
        style={{
          flex: 1,
          border: '1px solid #0d1f2e',
          background: '#070c12',
          overflow: 'auto',
        }}
      >
        {loadFailed ? (
          <div
            style={{
              padding: '1rem',
              color: '#fca5a5',
              fontSize: '0.8rem',
              letterSpacing: '0.03em',
              lineHeight: 1.6,
            }}
          >
            Failed to load map SVG.
            <br />
            Expected URL:
            <br />
            <code style={{ color: '#cbd5e1' }}>{mapSvgUrl}</code>
          </div>
        ) : (
          <img
            src={mapSvgUrl}
            alt="MAXJEDIALPHA iter-opt signal layer map"
            onError={() => setLoadFailed(true)}
            style={{ display: 'block', width: '100%', minWidth: 680, height: 'auto' }}
          />
        )}
      </div>
    </div>
  );
}

