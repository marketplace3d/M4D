export type RegimeLabel = 'LOW_VOL' | 'HIGH_VOL' | 'FOMC_FLAT';

const REGIME_COLOR: Record<RegimeLabel, string> = {
  LOW_VOL: '#22c55e',
  HIGH_VOL: '#f87171',
  FOMC_FLAT: '#f59e0b',
};

const LOOP_COLOR: Record<string, string> = {
  IDLE: '#64748b',
  FETCHING: '#38bdf8',
  COMPARING: '#a78bfa',
  VAMA: '#f472b6',
  WRITING: '#fbbf24',
  DONE: '#22c55e',
};

export type BankTally = { long: number; short: number; flat: number };

type Props = {
  regime: RegimeLabel;
  humHz: number;
  loopPhase: string;
  drawdownPct: number;
  bankA: BankTally;
  bankB: BankTally;
  bankC: BankTally;
  tick: number;
  className?: string;
};

function TallyRow({ label, t, color }: { label: string; t: BankTally; color: string }) {
  return (
    <div className="intel__tally">
      <span className="intel__tally-label" style={{ color }}>
        {label}
      </span>
      <span className="intel__tally-nums">
        <span style={{ color: '#22d3ee' }}>{t.long}L</span>
        <span className="intel__sep">/</span>
        <span style={{ color: '#f87171' }}>{t.short}S</span>
        <span className="intel__sep">/</span>
        <span style={{ color: '#475569' }}>{t.flat}∅</span>
      </span>
    </div>
  );
}

/** Separate intel rail: regime, execution loop, MoE doctrine, risk — holds research context off the main 3×3 boards. */
export function ControlRoomIntel({
  regime,
  humHz,
  loopPhase,
  drawdownPct,
  bankA,
  bankB,
  bankC,
  tick,
  className,
}: Props) {
  const ddOk = drawdownPct < 1.5;
  const ddWarn = drawdownPct >= 1.5 && drawdownPct < 2.5;
  const ddColor = ddOk ? '#22c55e' : ddWarn ? '#f59e0b' : '#f87171';

  return (
    <aside className={`intel ${className ?? ''}`.trim()} aria-label="Control room intel">
      <h2 className="intel__title">INTEL · MoE · RISK</h2>
      <p className="intel__doctrine">
        Single foundation: <strong>27 + Jedi</strong> roster, JSON SSOT, council pulse.{' '}
        <strong>MoE</strong> continues as gated experts (BOOM · STRAT · LEGEND) under Jedi — optimize
        routing, not sprawl.
      </p>
      <p className="intel__doctrine intel__doctrine--accent">
        Progress = <strong>max safe gain</strong> first (size, drawdown, regime fit),{' '}
        <em>then</em> bank profits — no heroics without edge + risk box.
      </p>

      <div className="intel__card">
        <div className="intel__row">
          <span className="intel__k">REGIME</span>
          <span style={{ color: REGIME_COLOR[regime], fontWeight: 700 }}>{regime}</span>
        </div>
        <div className="intel__row">
          <span className="intel__k">HUM</span>
          <span style={{ color: humHz > 600 ? '#22d3ee' : humHz > 400 ? '#f59e0b' : '#f87171' }}>
            {Math.round(humHz)} Hz
          </span>
        </div>
        <div className="intel__row">
          <span className="intel__k">23:59 LOOP</span>
          <span style={{ color: LOOP_COLOR[loopPhase] ?? '#94a3b8', fontWeight: 600 }}>{loopPhase}</span>
        </div>
        <div className="intel__row">
          <span className="intel__k">DD</span>
          <span style={{ color: ddColor }}>{drawdownPct.toFixed(2)}%</span>
        </div>
        <div className="intel__row">
          <span className="intel__k">TICK</span>
          <span className="intel__mono">#{tick}</span>
        </div>
      </div>

      <div className="intel__card">
        <div className="intel__subhead">Bank vote shape</div>
        <TallyRow label="A · BOOM" t={bankA} color="#22d3ee" />
        <TallyRow label="B · STRAT" t={bankB} color="#818cf8" />
        <TallyRow label="C · LEGEND" t={bankC} color="#4ade80" />
      </div>

      <p className="intel__foot">
        Reference UI: <code>M4D-27-ALGO-MaxCogViz_ControlRoom.jsx</code> — EKG + intel separated for 4K
        legibility.
      </p>
    </aside>
  );
}
