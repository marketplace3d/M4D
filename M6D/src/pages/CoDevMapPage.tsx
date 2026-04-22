/**
 * CoDevMapPage — Visual co-development map for M4D CoTrader + M3D AlgoTrader
 * System status, gap analysis, and paper testing roadmap.
 */
const IOPT_MASTER_FILE = '/Volumes/AI/AI-4D/M4D/AGENT/I-OPT-OOO/I-OPT-OOO-MASTER.MD';
const SYSTEM_MAP_FILE_URL = 'file:///Volumes/AI/AI-4D/M4D/AGENT/SYSTEM-MAP.svg';

type Status = 'live' | 'partial' | 'missing';

interface Node {
  label: string;
  status: Status;
  note?: string;
}

interface Section {
  title: string;
  nodes: Node[];
}

interface RoadmapStep {
  n: number;
  title: string;
  detail: string;
  system: 'M4D' | 'M3D' | 'BOTH';
  priority: 'P0' | 'P1' | 'P2';
}

const S: Record<Status, { dot: string; color: string; bg: string }> = {
  live:    { dot: '●', color: '#4ade80', bg: 'rgba(74,222,128,0.08)' },
  partial: { dot: '◑', color: '#fbbf24', bg: 'rgba(251,191,36,0.08)' },
  missing: { dot: '○', color: '#f87171', bg: 'rgba(248,113,113,0.08)' },
};

const P: Record<'P0'|'P1'|'P2', string> = {
  P0: '#f87171', P1: '#fbbf24', P2: '#60a5fa',
};

const M4D_SECTIONS: Section[] = [
  {
    title: 'SIGNAL STACK',
    nodes: [
      { label: '27 Algos (BOOM / STRAT / LEGEND)', status: 'live' },
      { label: 'JEDI Meta Score', status: 'live' },
      { label: 'Heatseeker V6.3 (Pine port)', status: 'live', note: 'BTC page' },
      { label: 'ICT — FVG / OB / Sessions', status: 'live' },
      { label: 'Price Targets (VP/OB/Sess/Liq)', status: 'live' },
      { label: 'Liquidity Thermal', status: 'live' },
      { label: 'EMA Ribbon / Squeeze / SigIntel', status: 'live' },
      { label: 'Solo Master Orb (directional bias)', status: 'partial', note: 'needs signal gate' },
    ],
  },
  {
    title: 'VISUAL PAGES',
    nodes: [
      { label: 'SPX Chart (TvLwChartsPage)', status: 'live' },
      { label: 'FX Chart (FxChartsPage)', status: 'live' },
      { label: 'ICT Chart (IctChartsPage)', status: 'live' },
      { label: 'BTC / Crypto (BtcChartsPage)', status: 'live' },
      { label: 'Market Council (27-vote matrix)', status: 'live' },
      { label: 'Pulse 27 (ControlRoomKnights)', status: 'live' },
      { label: 'Trade Bot (27-panel visual)', status: 'partial', note: 'display only — no execution' },
      { label: 'Risk Gate (TradeSafetyPage)', status: 'partial', note: 'UI shell — no OMS wire' },
      { label: 'Boom Explore (scan lab)', status: 'partial' },
    ],
  },
  {
    title: 'EXECUTION LAYER',
    nodes: [
      { label: 'Broker API (Alpaca / IBKR)', status: 'missing' },
      { label: 'Signal → Order bridge', status: 'missing' },
      { label: 'Order Management System (OMS)', status: 'missing' },
      { label: 'Paper blotter / fill tracker', status: 'missing' },
      { label: 'Signal bus (typed WS stream)', status: 'missing' },
    ],
  },
];

const M3D_SECTIONS: Section[] = [
  {
    title: 'ENGINE (RUST)',
    nodes: [
      { label: 'Axum API :3030', status: 'live' },
      { label: '500-asset processor (5m loop)', status: 'live' },
      { label: 'SQLite store (algo_state.db)', status: 'live' },
      { label: 'WebSocket /ws/algo', status: 'live' },
      { label: '/v1/council · /v1/algo-day · /v1/assets', status: 'live' },
    ],
  },
  {
    title: 'FRONTEND (BLUEPRINT)',
    nodes: [
      { label: 'Dashboard (PulseHero + CouncilMatrix)', status: 'partial', note: 'early build' },
      { label: 'Trader page', status: 'missing' },
      { label: 'AutoTrader page', status: 'missing' },
      { label: 'Backtest page (→ Django DS)', status: 'missing' },
      { label: 'Mobile variants', status: 'missing' },
    ],
  },
  {
    title: 'DS / QUANT (PYTHON)',
    nodes: [
      { label: 'Django DS :8000', status: 'live' },
      { label: 'backtesting.py engine', status: 'live' },
      { label: 'Signal generation (pandas-ta)', status: 'live' },
      { label: 'Grid-search optimizer', status: 'live' },
      { label: 'Paper trade reconciliation', status: 'missing' },
    ],
  },
  {
    title: 'EXECUTION LAYER',
    nodes: [
      { label: 'Alpaca paper API adapter (Rust)', status: 'missing' },
      { label: 'OMS state machine (SQLite)', status: 'missing' },
      { label: 'Risk manager (Kelly / fixed frac)', status: 'missing' },
      { label: 'P&L tracker + Sharpe rolling', status: 'missing' },
    ],
  },
];

const ROADMAP: RoadmapStep[] = [
  {
    n: 1,
    title: 'Signal Quality Gate',
    detail: 'Heatseeker tier S/A + JEDI > threshold → structured { asset, dir, entry, sl, tp, score } JSON. Single source of truth for all downstream.',
    system: 'M4D',
    priority: 'P0',
  },
  {
    n: 2,
    title: 'Signal Bus (WS stream)',
    detail: 'M3D engine emits typed signal events on /ws/signals. M4D TradeBotPage subscribes. Decoupled producer/consumer.',
    system: 'BOTH',
    priority: 'P0',
  },
  {
    n: 3,
    title: 'Alpaca Paper Adapter',
    detail: 'Rust module in M3D API: POST /v1/order → Alpaca paper API. Env: ALPACA_KEY, ALPACA_SECRET, base_url=paper. Free, instant setup.',
    system: 'M3D',
    priority: 'P0',
  },
  {
    n: 4,
    title: 'OMS State Machine',
    detail: 'SQLite table: orders(id, asset, dir, entry, sl, tp, status, fill_px, fill_time). States: pending→filled→closed/stopped.',
    system: 'M3D',
    priority: 'P1',
  },
  {
    n: 5,
    title: 'Risk Manager',
    detail: 'Fixed fractional sizing (1–2% risk/trade). Max 5 concurrent positions. Daily DD cap. Runs before order submit.',
    system: 'M3D',
    priority: 'P1',
  },
  {
    n: 6,
    title: 'Paper Blotter UI',
    detail: 'Extend TradeBotPage: open positions table, fill log, real-time P&L per trade. Wire to /v1/orders WS.',
    system: 'M4D',
    priority: 'P1',
  },
  {
    n: 7,
    title: 'P&L Dashboard',
    detail: 'Rolling Sharpe (20-trade), win rate, avg RR, max DD, equity curve sparkline. Add to CouncilMatrix or new PERF tab.',
    system: 'BOTH',
    priority: 'P2',
  },
  {
    n: 8,
    title: 'DS Backtest Reconciliation',
    detail: 'Run Django backtesting.py against same signal gate params. Compare paper fills vs backtest to detect slippage / live drift.',
    system: 'M3D',
    priority: 'P2',
  },
];

function NodeRow({ node }: { node: Node }) {
  const s = S[node.status];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 8px', borderRadius: 4,
      background: s.bg, marginBottom: 2,
    }}>
      <span style={{ color: s.color, fontSize: 10, flexShrink: 0 }}>{s.dot}</span>
      <span style={{ fontSize: 11, color: 'var(--text, #e2e8f0)', flex: 1 }}>{node.label}</span>
      {node.note && (
        <span style={{ fontSize: 9, color: 'var(--muted, #64748b)', flexShrink: 0 }}>{node.note}</span>
      )}
    </div>
  );
}

function SectionBlock({ section }: { section: Section }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: 2,
        color: 'var(--muted, #64748b)', marginBottom: 6,
        textTransform: 'uppercase',
      }}>
        {section.title}
      </div>
      {section.nodes.map(n => <NodeRow key={n.label} node={n} />)}
    </div>
  );
}

function SystemPanel({
  title, subtitle, port, sections,
  accent,
}: {
  title: string; subtitle: string; port: string;
  sections: Section[]; accent: string;
}) {
  const live    = sections.flatMap(s => s.nodes).filter(n => n.status === 'live').length;
  const partial = sections.flatMap(s => s.nodes).filter(n => n.status === 'partial').length;
  const missing = sections.flatMap(s => s.nodes).filter(n => n.status === 'missing').length;
  const total   = live + partial + missing;

  return (
    <div style={{
      flex: 1, minWidth: 320,
      background: 'rgba(15,23,42,0.8)',
      border: `1px solid ${accent}33`,
      borderRadius: 10,
      padding: 20,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: accent, letterSpacing: 1 }}>{title}</span>
          <span style={{ fontSize: 11, color: 'var(--muted, #64748b)' }}>{subtitle}</span>
          <span style={{
            marginLeft: 'auto', fontSize: 9, color: accent,
            background: `${accent}22`, borderRadius: 4, padding: '2px 6px',
          }}>{port}</span>
        </div>
        {/* Progress bar */}
        <div style={{ display: 'flex', gap: 2, height: 4, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ flex: live, background: '#4ade80' }} />
          <div style={{ flex: partial, background: '#fbbf24' }} />
          <div style={{ flex: missing, background: '#1e293b' }} />
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
          {[
            { label: 'LIVE', val: live, color: '#4ade80' },
            { label: 'PARTIAL', val: partial, color: '#fbbf24' },
            { label: 'MISSING', val: missing, color: '#f87171' },
          ].map(x => (
            <span key={x.label} style={{ fontSize: 9, color: x.color }}>
              {x.val}/{total} {x.label}
            </span>
          ))}
        </div>
      </div>
      {sections.map(s => <SectionBlock key={s.title} section={s} />)}
    </div>
  );
}

function RoadmapCard({ step }: { step: RoadmapStep }) {
  const sysColor: Record<typeof step.system, string> = {
    M4D: '#38bdf8', M3D: '#a78bfa', BOTH: '#4ade80',
  };
  return (
    <div style={{
      background: 'rgba(15,23,42,0.8)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderLeft: `3px solid ${P[step.priority]}`,
      borderRadius: 8,
      padding: '12px 14px',
      display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: `${P[step.priority]}22`,
        border: `1px solid ${P[step.priority]}`,
        color: P[step.priority],
        fontSize: 12, fontWeight: 800,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>{step.n}</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{step.title}</span>
          <span style={{
            fontSize: 9, padding: '1px 6px', borderRadius: 3,
            background: `${sysColor[step.system]}22`,
            color: sysColor[step.system],
          }}>{step.system}</span>
          <span style={{
            fontSize: 9, padding: '1px 6px', borderRadius: 3,
            background: `${P[step.priority]}11`,
            color: P[step.priority], marginLeft: 'auto',
          }}>{step.priority}</span>
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>{step.detail}</div>
      </div>
    </div>
  );
}

export default function CoDevMapPage() {
  return (
    <div style={{
      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      background: '#0a0f1a',
      minHeight: '100vh',
      padding: '20px 24px',
      overflowY: 'auto',
      color: '#e2e8f0',
    }}>
      {/* Title */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: 2, color: '#38bdf8' }}>CO-DEV MAP</span>
          <span style={{ fontSize: 11, color: '#64748b' }}>M4D COTRADER · M3D ALGOTRADER · PAPER TESTING ROADMAP</span>
          <button onClick={() => window.open(SYSTEM_MAP_FILE_URL, '_blank')} style={{
            background: 'transparent', border: '1px solid rgba(56,189,248,0.35)', color: '#38bdf8',
            borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer',
          }}>OPEN SYSTEM MAP</button>
          <button onClick={() => navigator.clipboard?.writeText(IOPT_MASTER_FILE)} style={{
            background: 'transparent', border: '1px solid rgba(167,139,250,0.35)', color: '#a78bfa',
            borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer',
          }}>COPY IOPT MASTER</button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 16 }}>
            {([['●', '#4ade80', 'LIVE'], ['◑', '#fbbf24', 'PARTIAL'], ['○', '#f87171', 'MISSING']] as const).map(
              ([dot, color, label]) => (
                <span key={label} style={{ fontSize: 10, color }}>
                  {dot} {label}
                </span>
              )
            )}
          </div>
        </div>
        <div style={{ height: 1, background: 'rgba(56,189,248,0.15)', marginTop: 12 }} />
      </div>

      {/* System panels */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
        <SystemPanel
          title="M4D COTRADER"
          subtitle="Hedge Fund Visual Intelligence"
          port=":5650"
          sections={M4D_SECTIONS}
          accent="#38bdf8"
        />
        <SystemPanel
          title="M3D ALGOTRADER"
          subtitle="Autonomous Execution Engine"
          port=":5500 / :3030"
          sections={M3D_SECTIONS}
          accent="#a78bfa"
        />
      </div>

      {/* Roadmap */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 3, color: '#64748b', marginBottom: 4 }}>
          PAPER TESTING ROADMAP
        </div>
        <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
          {([['P0', 'CRITICAL PATH'], ['P1', 'CORE PAPER'], ['P2', 'ANALYTICS']] as const).map(([p, label]) => (
            <span key={p} style={{ fontSize: 10, color: P[p] }}>
              ● {p} — {label}
            </span>
          ))}
          <span style={{ fontSize: 10, color: '#38bdf8', marginLeft: 12 }}>■ M4D</span>
          <span style={{ fontSize: 10, color: '#a78bfa' }}>■ M3D</span>
          <span style={{ fontSize: 10, color: '#4ade80' }}>■ BOTH</span>
        </div>
        <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', marginBottom: 16 }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ROADMAP.map(step => <RoadmapCard key={step.n} step={step} />)}
      </div>
      <div style={{
        marginTop: 16, background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)',
        borderRadius: 10, padding: 14,
      }}>
        <div style={{ fontSize: 10, letterSpacing: 2, color: '#64748b', marginBottom: 8 }}>IOPT SURFACE STANDARD</div>
        {[
          'Action Bus Receipts panel',
          'Account Scope panel',
          'MT5 Position Matrix panel',
          'Rescue Stage panel',
          'Server Lockdown panel',
          'Layout Profile panel',
        ].map((item) => (
          <div key={item} style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>- {item}</div>
        ))}
      </div>
    </div>
  );
}
