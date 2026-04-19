import { useMemo, useState } from 'react';

type Mode = 'ops' | 'research';
type Baseline = 'buyhold' | 'random' | 'reverse';

export default function TestLabPage() {
  const [mode, setMode] = useState<Mode>('research');
  const [trainBars, setTrainBars] = useState(1500);
  const [testBars, setTestBars] = useState(300);
  const [stepBars, setStepBars] = useState(150);
  const [costBps, setCostBps] = useState(4);
  const [slippageBps, setSlippageBps] = useState(2);
  const [baseline, setBaseline] = useState<Baseline>('buyhold');
  const [adversarialOn, setAdversarialOn] = useState(true);

  const foldCount = useMemo(() => Math.max(1, Math.floor((trainBars + testBars) / stepBars) - 1), [trainBars, testBars, stepBars]);
  const robustness = useMemo(() => Math.max(0, 100 - costBps * 4 - slippageBps * 5), [costBps, slippageBps]);

  return (
    <div style={{ minHeight: 'calc(100dvh - var(--app-header-h))', background: '#060a12', color: '#d1dce7', padding: 10 }}>
      <header style={{ marginBottom: 8, border: '1px solid #173247', background: '#09111b', padding: '7px 10px' }}>
        <h2 className="mission-top-k" style={{ margin: 0, lineHeight: 1.05 }}>
          TEST LAB{' '}
          <span style={{ fontSize: 10, letterSpacing: '0.08em', color: '#89a5b8' }}>
            WALK-FORWARD HARNESS · ANTI-OVERFIT CHECKS
          </span>
        </h2>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
        <div style={{ border: '1px solid #173247', background: '#09111b', padding: 10 }}>
          <div style={{ fontSize: 11, color: '#7dd3fc', marginBottom: 8 }}>RUN CONFIG</div>
          <label style={{ display: 'block', marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: '#8ca8ba' }}>Mode</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              {(['ops', 'research'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  style={{
                    border: `1px solid ${mode === m ? '#22d3ee' : '#27485d'}`,
                    background: mode === m ? '#0b2737' : '#0c1520',
                    color: mode === m ? '#7dd3fc' : '#8ca8ba',
                    padding: '4px 8px',
                    cursor: 'pointer',
                  }}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          </label>
          <Slider label="Train Bars" min={300} max={5000} step={100} value={trainBars} onChange={setTrainBars} />
          <Slider label="Test Bars" min={100} max={1200} step={50} value={testBars} onChange={setTestBars} />
          <Slider label="Step Bars" min={50} max={600} step={25} value={stepBars} onChange={setStepBars} />
        </div>

        <div style={{ border: '1px solid #173247', background: '#09111b', padding: 10 }}>
          <div style={{ fontSize: 11, color: '#7dd3fc', marginBottom: 8 }}>FRICTION MODEL</div>
          <Slider label="Costs (bps)" min={0} max={25} step={1} value={costBps} onChange={setCostBps} />
          <Slider label="Slippage (bps)" min={0} max={20} step={1} value={slippageBps} onChange={setSlippageBps} />
          <div style={{ marginTop: 8, fontSize: 11, color: '#8ca8ba' }}>Baseline</div>
          <select
            value={baseline}
            onChange={(e) => setBaseline(e.target.value as Baseline)}
            style={{ width: '100%', marginTop: 4, background: '#0c1520', color: '#d1dce7', border: '1px solid #27485d', padding: 6 }}
          >
            <option value="buyhold">Buy & Hold</option>
            <option value="random">Random Entry</option>
            <option value="reverse">Reverse Signal</option>
          </select>
          <label style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <input type="checkbox" checked={adversarialOn} onChange={(e) => setAdversarialOn(e.target.checked)} />
            Adversarial policy (trade against our stack)
          </label>
        </div>

        <div style={{ border: '1px solid #173247', background: '#09111b', padding: 10 }}>
          <div style={{ fontSize: 11, color: '#7dd3fc', marginBottom: 8 }}>RESULT SNAPSHOT</div>
          <Metric k="Walk-forward folds" v={String(foldCount)} tone="#7dd3fc" />
          <Metric k="Robustness score" v={`${robustness}%`} tone={robustness > 65 ? '#4ade80' : '#f59e0b'} />
          <Metric k="Policy vs baseline" v={baseline === 'reverse' ? 'Likely weak' : 'Monitoring'} tone="#a78bfa" />
          <Metric k="Overfit risk" v={mode === 'research' ? 'LOWER (with holdout)' : 'MED'} tone="#f43f5e" />
          <div style={{ marginTop: 10, borderTop: '1px solid #173247', paddingTop: 8, fontSize: 11, color: '#8ca8ba' }}>
            Next: wire this panel to engine run traces + actual Sharpe/Sortino/DD per fold.
          </div>
        </div>
      </section>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: '#8ca8ba', display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span style={{ color: '#7dd3fc' }}>{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
    </label>
  );
}

function Metric({ k, v, tone }: { k: string; v: string; tone: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
      <span style={{ color: '#8ca8ba' }}>{k}</span>
      <strong style={{ color: tone }}>{v}</strong>
    </div>
  );
}
