import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BOOM_SIGNALS,
  type BoomSignal,
  type SimSignalSlice,
} from '../boom/boomSignals';
import './BoomExplore.css';

function useSimulatedSignals() {
  const [values, setValues] = useState<Record<string, SimSignalSlice>>(() =>
    Object.fromEntries(
      BOOM_SIGNALS.map((s) => [
        s.id,
        {
          active: Math.random() > 0.45,
          strength: Math.floor(Math.random() * 100),
          value: (Math.random() * 3 + 0.5).toFixed(2),
        },
      ])
    )
  );

  useEffect(() => {
    const iv = window.setInterval(() => {
      setValues((prev) => {
        const next = { ...prev };
        const randomKey =
          BOOM_SIGNALS[Math.floor(Math.random() * BOOM_SIGNALS.length)]!.id;
        next[randomKey] = {
          active: Math.random() > 0.35,
          strength: Math.floor(Math.random() * 100),
          value: (Math.random() * 3 + 0.5).toFixed(2),
        };
        return next;
      });
    }, 1200);
    return () => clearInterval(iv);
  }, []);

  return values;
}

function useGrokScore(signalValues: Record<string, SimSignalSlice | undefined>) {
  const active = BOOM_SIGNALS.filter((s) => signalValues[s.id]?.active);
  const weightedSum = active.reduce((sum, s) => sum + s.weight, 0);
  const maxWeight = BOOM_SIGNALS.reduce((sum, s) => sum + s.weight, 0);
  return Math.round((weightedSum / maxWeight) * 10 * 10) / 10;
}

function MiniSpark({ color }: { color: string }) {
  const bars = useRef<number[]>(
    Array.from({ length: 12 }, () => Math.random() * 100)
  );
  return (
    <div className="boom-mini-spark" style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 20 }}>
      {bars.current.map((h, i) => (
        <div
          key={i}
          style={{
            width: 3,
            height: `${h}%`,
            background: color,
            opacity: 0.4 + (i / 12) * 0.6,
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}

function GrokMeter({ score }: { score: number }) {
  const angle = (score / 10) * 180 - 90;
  const isBoom = score >= 8;
  const color = score < 4 ? '#ff4444' : score < 7 ? '#ffd600' : '#00ff88';

  return (
    <div style={{ textAlign: 'center', position: 'relative' }}>
      <svg width={160} height={90} viewBox="0 0 160 90">
        <path
          d="M 10 85 A 70 70 0 0 1 150 85"
          fill="none"
          stroke="#1a1a2e"
          strokeWidth={14}
          strokeLinecap="round"
        />
        <path
          d="M 10 85 A 70 70 0 0 1 150 85"
          fill="none"
          stroke={color}
          strokeWidth={14}
          strokeLinecap="round"
          strokeDasharray={`${(score / 10) * 220} 220`}
          style={{
            filter: `drop-shadow(0 0 6px ${color})`,
            transition: 'stroke-dasharray 0.6s ease, stroke 0.4s',
          }}
        />
        <line
          x1={80}
          y1={85}
          x2={80 + Math.cos(((angle - 90) * Math.PI) / 180) * 55}
          y2={85 + Math.sin(((angle - 90) * Math.PI) / 180) * 55}
          stroke="#fff"
          strokeWidth={2}
          strokeLinecap="round"
          style={{ transition: 'all 0.6s ease', transformOrigin: '80px 85px' }}
        />
        <circle cx={80} cy={85} r={5} fill="#fff" />
        <text x={8} y={85} fill="#444" fontSize={9} fontFamily="monospace">
          0
        </text>
        <text x={73} y={16} fill="#444" fontSize={9} fontFamily="monospace">
          5
        </text>
        <text x={148} y={85} fill="#444" fontSize={9} fontFamily="monospace">
          10
        </text>
      </svg>
      <div
        style={{
          fontSize: 36,
          fontFamily: "'Bebas Neue', sans-serif",
          color,
          lineHeight: 1,
          letterSpacing: 2,
          textShadow: `0 0 20px ${color}`,
          transition: 'color 0.4s',
          marginTop: -8,
        }}
      >
        {score.toFixed(1)}
      </div>
      <div
        style={{
          fontSize: 10,
          fontFamily: 'monospace',
          color: isBoom ? '#00ff88' : '#666',
          letterSpacing: 3,
          marginTop: 2,
          transition: 'color 0.3s',
        }}
      >
        {isBoom ? '💥 BOOM CONFIRMED' : score >= 6 ? '⚠ BUILDING...' : '— STANDBY —'}
      </div>
    </div>
  );
}

function SignalRow({ signal, data }: { signal: BoomSignal; data: SimSignalSlice | undefined }) {
  const isActive = data?.active;
  const strength = data?.strength ?? 0;
  const [flash, setFlash] = useState(false);
  const prevActive = useRef(isActive);

  useEffect(() => {
    if (prevActive.current !== isActive) {
      setFlash(true);
      const t = window.setTimeout(() => setFlash(false), 400);
      prevActive.current = isActive;
      return () => clearTimeout(t);
    }
  }, [isActive]);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '28px 1fr 80px 90px 52px',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        marginBottom: 3,
        borderRadius: 6,
        background: flash
          ? signal.glow
          : isActive
            ? 'rgba(255,255,255,0.04)'
            : 'rgba(255,255,255,0.015)',
        border: `1px solid ${isActive ? signal.color + '44' : '#1a1a2e'}`,
        transition: 'background 0.3s, border 0.3s',
        cursor: 'default',
      }}
    >
      <div
        style={{
          fontFamily: 'monospace',
          fontSize: 10,
          color: '#333',
          textAlign: 'center',
        }}
      >
        {signal.rank}
      </div>
      <div>
        <div
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 13,
            letterSpacing: 1.5,
            color: isActive ? signal.color : '#444',
            textShadow: isActive ? `0 0 8px ${signal.color}` : 'none',
            transition: 'color 0.3s',
          }}
        >
          {signal.icon} {signal.label}
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#444', marginTop: 1 }}>
          {signal.formula}
        </div>
      </div>
      <div>
        <MiniSpark color={isActive ? signal.color : '#333'} />
      </div>
      <div style={{ position: 'relative' }}>
        <div
          style={{
            height: 4,
            background: '#111',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${strength}%`,
              background: isActive ? signal.color : '#222',
              boxShadow: isActive ? `0 0 8px ${signal.color}` : 'none',
              borderRadius: 2,
              transition: 'width 0.6s ease, background 0.3s',
            }}
          />
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#444', marginTop: 3 }}>
          {strength}%
        </div>
      </div>
      <div
        style={{
          textAlign: 'center',
          fontFamily: 'monospace',
          fontSize: 9,
          fontWeight: 'bold',
          letterSpacing: 1,
          padding: '3px 6px',
          borderRadius: 3,
          background: isActive ? signal.color + '22' : '#111',
          color: isActive ? signal.color : '#333',
          border: `1px solid ${isActive ? signal.color + '66' : '#222'}`,
          transition: 'all 0.3s',
        }}
      >
        {isActive ? 'LIVE' : 'IDLE'}
      </div>
    </div>
  );
}

function VolumeHistogram({
  signalValues,
}: {
  signalValues: Record<string, SimSignalSlice | undefined>;
}) {
  const bars = useRef<number[]>(Array.from({ length: 30 }, () => Math.random() * 60 + 10));
  const [, forceRender] = useState(0);
  const volActive = signalValues.vol_surge?.active;

  const bump = useCallback(() => {
    bars.current = [
      ...bars.current.slice(1),
      volActive ? Math.random() * 40 + 60 : Math.random() * 50 + 5,
    ];
    forceRender((n) => n + 1);
  }, [volActive]);

  useEffect(() => {
    const iv = window.setInterval(bump, 800);
    return () => clearInterval(iv);
  }, [bump]);

  const latest = bars.current[bars.current.length - 1]!;
  const avg = bars.current.reduce((a, b) => a + b, 0) / bars.current.length;

  return (
    <div style={{ padding: '12px 14px' }}>
      <div
        style={{
          fontFamily: 'monospace',
          fontSize: 10,
          color: '#555',
          letterSpacing: 2,
          marginBottom: 8,
        }}
      >
        VOLUME HISTOGRAM · SMA(20) ×2.5 THRESHOLD
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 60 }}>
        {bars.current.map((h, i) => {
          const isSurge = h > avg * 2;
          const isLast = i === bars.current.length - 1;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${h}%`,
                background: isSurge ? '#00ff88' : i > 24 ? '#00cfff' : '#1e3a4a',
                boxShadow: isSurge ? '0 0 8px #00ff88' : 'none',
                borderRadius: '2px 2px 0 0',
                transition: 'height 0.4s ease',
                position: 'relative',
              }}
            >
              {isLast && isSurge && (
                <div
                  style={{
                    position: 'absolute',
                    top: -18,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    fontSize: 12,
                  }}
                >
                  🚀
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div
        style={{
          borderTop: '1px dashed #1e3a4a',
          marginTop: 4,
          paddingTop: 6,
          display: 'flex',
          gap: 16,
          fontFamily: 'monospace',
          fontSize: 9,
          color: '#444',
        }}
      >
        <span>
          LATEST: <span style={{ color: '#00cfff' }}>{latest.toFixed(0)}</span>
        </span>
        <span>
          SMA20: <span style={{ color: '#555' }}>{avg.toFixed(0)}</span>
        </span>
        <span>
          RATIO:{' '}
          <span style={{ color: latest > avg * 2 ? '#00ff88' : '#555' }}>
            {(latest / avg).toFixed(2)}×
          </span>
        </span>
      </div>
    </div>
  );
}

function HeatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: 'monospace',
          fontSize: 9,
          color: '#555',
          marginBottom: 3,
        }}
      >
        <span>{label}</span>
        <span style={{ color }}>{value}%</span>
      </div>
      <div style={{ height: 6, background: '#111', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${value}%`,
            background: `linear-gradient(90deg, ${color}88, ${color})`,
            boxShadow: `0 0 10px ${color}`,
            borderRadius: 3,
            transition: 'width 0.8s ease',
          }}
        />
      </div>
    </div>
  );
}

/** Port of `spec-kit/M4D-boom-algo-dashboard.jsx` — mock BOOM confirmation UI. */
export default function BoomExplore() {
  const signalValues = useSimulatedSignals();
  const grokScore = useGrokScore(signalValues);
  const activeCount = BOOM_SIGNALS.filter((s) => signalValues[s.id]?.active).length;

  const [heat5m, setHeat5m] = useState(72);
  const [heat15m, setHeat15m] = useState(58);
  const [heatDaily, setHeatDaily] = useState(81);

  useEffect(() => {
    const iv = window.setInterval(() => {
      setHeat5m((v) => Math.min(100, Math.max(0, v + (Math.random() - 0.4) * 8)));
      setHeat15m((v) => Math.min(100, Math.max(0, v + (Math.random() - 0.45) * 5)));
      setHeatDaily((v) => Math.min(100, Math.max(0, v + (Math.random() - 0.48) * 3)));
    }, 1500);
    return () => clearInterval(iv);
  }, []);

  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const iv = window.setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  const isBoom = grokScore >= 8;
  const heatStack = heat5m > 70 && heat15m > 60 && heatDaily > 70;

  return (
    <div className="boom-explore">
      <div className="boom-explore__scanlines" aria-hidden />

      <div
        style={{
          background: '#07091a',
          borderBottom: '1px solid #0d1a2e',
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 22,
              letterSpacing: 4,
              color: isBoom ? '#00ff88' : '#00cfff',
              textShadow: isBoom ? '0 0 20px #00ff88' : '0 0 10px #00cfff44',
              transition: 'all 0.5s',
            }}
          >
            💥 BOOM EXPANSION · CONFIRMATION ENGINE
          </div>
          <div style={{ fontSize: 9, color: '#333', letterSpacing: 3, marginTop: 2 }}>
            DARVAS LULL BREAKOUT · COGNITIVE ALIGNMENT · GROK SCORE
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#00cfff', letterSpacing: 2 }}>
            {time.toLocaleTimeString('en-GB', { hour12: false })}
          </div>
          <div style={{ fontSize: 9, color: '#333', letterSpacing: 1 }}>
            {activeCount}/10 SIGNALS ACTIVE
          </div>
        </div>
      </div>

      <div className="boom-explore__main">
        <div style={{ overflowY: 'auto', padding: '12px 0 12px 12px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '28px 1fr 80px 90px 52px',
              gap: 10,
              padding: '4px 14px 8px',
              fontFamily: 'monospace',
              fontSize: 9,
              color: '#333',
              letterSpacing: 2,
              borderBottom: '1px solid #0d1a2e',
              marginBottom: 6,
            }}
          >
            <div>#</div>
            <div>SIGNAL</div>
            <div>SPARK</div>
            <div>STRENGTH</div>
            <div>STATUS</div>
          </div>

          {BOOM_SIGNALS.map((s) => (
            <SignalRow key={s.id} signal={s} data={signalValues[s.id]} />
          ))}

          <div
            style={{
              marginTop: 10,
              background: 'rgba(255,255,255,0.02)',
              borderRadius: 6,
              border: '1px solid #0d1a2e',
            }}
          >
            <VolumeHistogram signalValues={signalValues} />
          </div>
        </div>

        <div
          style={{
            borderLeft: '1px solid #0d1a2e',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              background: 'rgba(255,255,255,0.02)',
              borderRadius: 8,
              border: `1px solid ${isBoom ? '#00ff8833' : '#0d1a2e'}`,
              padding: '14px 10px 10px',
              textAlign: 'center',
              transition: 'border 0.5s',
            }}
          >
            <div style={{ fontSize: 9, color: '#333', letterSpacing: 3, marginBottom: 6 }}>
              GROK SCORE ⚡
            </div>
            <GrokMeter score={grokScore} />
          </div>

          <div
            style={{
              background: 'rgba(255,255,255,0.02)',
              borderRadius: 8,
              border: '1px solid #0d1a2e',
              padding: 14,
            }}
          >
            <div style={{ fontSize: 9, color: '#333', letterSpacing: 3, marginBottom: 10 }}>
              🥵 TREND HEAT · MTF
            </div>
            <HeatBar label="5M  HEAT" value={Math.round(heat5m)} color="#ff4500" />
            <HeatBar label="15M HEAT" value={Math.round(heat15m)} color="#ff8c00" />
            <HeatBar label="DAILY   " value={Math.round(heatDaily)} color="#ffd600" />
            <div
              style={{
                marginTop: 10,
                padding: '6px 8px',
                borderRadius: 4,
                background: heatStack ? 'rgba(255,69,0,0.12)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${heatStack ? '#ff450044' : '#111'}`,
                fontSize: 9,
                color: heatStack ? '#ff4500' : '#333',
                letterSpacing: 2,
                textAlign: 'center',
                transition: 'all 0.5s',
              }}
            >
              {heatStack ? '🔥 ALL TIMEFRAMES HOT' : 'WAITING FOR STACK ALIGN'}
            </div>
          </div>

          <div
            style={{
              background: 'rgba(255,255,255,0.02)',
              borderRadius: 8,
              border: '1px solid #0d1a2e',
              padding: 14,
            }}
          >
            <div style={{ fontSize: 9, color: '#333', letterSpacing: 3, marginBottom: 10 }}>
              📐 DAILY BIAS
            </div>
            {[
              { label: 'PREV DAY HIGH', val: '187.45', color: '#00ff88' },
              { label: 'PREV DAY LOW ', val: '183.20', color: '#ff4444' },
              { label: 'SESSION OPEN ', val: '185.80', color: '#00cfff' },
              { label: 'CURRENT PRICE', val: '186.92', color: '#fff' },
            ].map((row) => (
              <div
                key={row.label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: 6,
                  fontSize: 10,
                }}
              >
                <span style={{ color: '#444', letterSpacing: 1 }}>{row.label}</span>
                <span style={{ color: row.color, fontWeight: 'bold' }}>{row.val}</span>
              </div>
            ))}
            <div
              style={{
                marginTop: 8,
                padding: '5px 8px',
                borderRadius: 4,
                background: 'rgba(0,255,136,0.08)',
                border: '1px solid #00ff8833',
                fontSize: 9,
                color: '#00ff88',
                letterSpacing: 2,
                textAlign: 'center',
              }}
            >
              ↑ BULLISH BIAS · ABOVE PDH
            </div>
          </div>

          <div
            style={{
              background: 'rgba(255,255,255,0.02)',
              borderRadius: 8,
              border: '1px solid #0d1a2e',
              padding: 14,
            }}
          >
            <div style={{ fontSize: 9, color: '#333', letterSpacing: 3, marginBottom: 10 }}>
              🎯 TARGET CLUSTER
            </div>
            {[
              { label: 'FVG FILL    ', val: '189.10', type: 'FVG' },
              { label: 'WEEKLY PIVOT', val: '189.30', type: 'WPV' },
              { label: 'PREV WK HI  ', val: '189.55', type: 'PWH' },
            ].map((t) => (
              <div
                key={t.label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 5,
                  fontSize: 10,
                }}
              >
                <span style={{ color: '#444' }}>{t.label}</span>
                <span
                  style={{
                    background: '#ff980022',
                    border: '1px solid #ff980044',
                    color: '#ff9800',
                    padding: '2px 6px',
                    borderRadius: 3,
                    fontSize: 9,
                    letterSpacing: 1,
                  }}
                >
                  {t.type} {t.val}
                </span>
              </div>
            ))}
            <div
              style={{
                marginTop: 6,
                fontSize: 9,
                color: '#ff9800',
                letterSpacing: 2,
                textAlign: 'center',
                padding: '4px 0',
                borderTop: '1px solid #1a1a2e',
              }}
            >
              CLUSTER SPREAD: 0.24% ✓
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
