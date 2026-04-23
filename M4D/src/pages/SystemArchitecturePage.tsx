/**
 * SystemArchitecturePage — Multi-system MOE architecture visual
 * M4D CoTrader + M3D AlgoTrader + ICT/Liquidity + Paper Execution
 * Layered SVG build-plan doc — iterative opt roadmap baked in.
 */
import { useState } from 'react';
const SYSTEM_MAP_FILE_URL = 'file:///Volumes/AI/AI-4D/M4D/AGENT/SYSTEM-MAP.svg';
const SYSTEM_SPEC_FILE = '/Volumes/AI/AI-4D/M4D/AGENT/SYSTEM-SPEC.md';
type SurfaceStatus = 'LIVE' | 'BUILD' | 'PLANNED';
type SurfaceItem = { feature: string; page: string; hash: string; status: SurfaceStatus };

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  bg:      '#03050a',
  bg1:     '#070c14',
  bg2:     '#0d1520',
  border:  '#0f2035',
  jedi:    '#f59e0b',
  boom:    '#22d3ee',
  strat:   '#818cf8',
  legend:  '#4ade80',
  ict:     '#a78bfa',
  liq:     '#f43f5e',
  exec:    '#fb923c',
  risk:    '#fbbf24',
  ds:      '#34d399',
  muted:   '#1e3a50',
  text:    '#94a3b8',
  textHi:  '#e2e8f0',
  rust:    '#fb923c',
  paper:   '#60a5fa',
};

type Phase = 'live' | 'build' | 'planned';
const PHASE_COLOR: Record<Phase, string> = {
  live:    '#4ade80',
  build:   '#fbbf24',
  planned: '#475569',
};

// ── Node definitions ──────────────────────────────────────────────────────────

interface ArchNode {
  id: string;
  x: number; y: number; w: number; h: number;
  label: string;
  sub?: string;
  color: string;
  phase: Phase;
  detail?: string[];
}

interface ArchEdge {
  from: string; to: string;
  color?: string;
  dashed?: boolean;
  label?: string;
}

// SVG canvas
const W = 1400;
const H = 1080;

const NODES: ArchNode[] = [
  // ── ROW 0: Data sources ───────────────────────────────────
  { id:'polygon', x:60,  y:30,  w:160, h:56, label:'POLYGON.IO', sub:'REST + WS · price bars', color:C.boom, phase:'live', detail:['OHLCV 1m–1D','500 equities','Crypto pairs','FX majors'] },
  { id:'binance', x:240, y:30,  w:160, h:56, label:'BINANCE', sub:'Public OHLCV · 5m loop', color:C.boom, phase:'live', detail:['BTC/ETH/SOL…','Rust fetcher','5min cadence'] },
  { id:'tvpine',  x:420, y:30,  w:180, h:56, label:'TRADINGVIEW PINE', sub:'ICT signals · manual ref', color:C.ict, phase:'build', detail:['ICT levels export','Webhook receiver','Alert bridge (P1)'] },
  { id:'ds_data', x:620, y:30,  w:180, h:56, label:'DJANGO DS :8000', sub:'yfinance + ccxt', color:C.ds, phase:'live', detail:['Historical OHLCV','Backtest feed','Optimizer input'] },

  // ── ROW 1: Engine ─────────────────────────────────────────
  { id:'engine',  x:60,  y:140, w:380, h:64, label:'M3D RUST ENGINE', sub:'500-asset processor · 5m loop → SQLite', color:C.rust, phase:'live', detail:['fetcher.rs → Binance','processor.rs → TREND/MOM/VOL/ATR_BREAK/COMPOSITE','store.rs → algo_day.json + algo_state.db','Axum API :3030 → /v1/council /v1/algo-day /v1/assets'] },
  { id:'ds_eng',  x:460, y:140, w:340, h:64, label:'DS SIGNAL ENGINE', sub:'pandas-ta · signals.py · backtesting.py', color:C.ds, phase:'live', detail:['Signal generation per asset','Grid-search optimizer','Backtest runner (backtesting.py)','Paper reconciliation (planned)'] },

  // ── ROW 2: Signal layer ───────────────────────────────────
  { id:'heatseek',x:60,  y:268, w:200, h:80, label:'HEATSEEKER V6.3', sub:'BTC regime + alpha score', color:C.jedi, phase:'live', detail:['EMA bias (9/21)','ATR14 regime','FVG detection','RVOL filter','alphaScore 0-100','Tier S/A/B/C'] },
  { id:'ict',     x:278, y:268, w:200, h:80, label:'ICT STACK', sub:'FVG · OB · Sessions · Draw', color:C.ict, phase:'live', detail:['Fair Value Gaps','Order Blocks','Session levels (Asia/London/NY)','Liquidity Thermal','Price Targets (VP/OB/Sess/Liq)','SoloMasterOrb directional bias'] },
  { id:'council', x:496, y:268, w:200, h:80, label:'27 ALGO COUNCIL', sub:'BOOM·STRAT·LEGEND banks', color:C.boom, phase:'live', detail:['BOOM A: NS CI BQ CC WH SA HK GO EF','STRAT B: 8E VT MS DP WS RV HL AI VK','LEGEND C: SE IC WN CA TF RT MM OR DV','Per-algo vote → bank score → COMPOSITE'] },
  { id:'jedi',    x:714, y:268, w:200, h:80, label:'JEDI META', sub:'MTF alignment · quarterly draw', color:C.jedi, phase:'live', detail:['Daily/Weekly/Quarterly bias','Liquidity draw direction','Structure gate','Sum of all 27 algos'] },
  { id:'liq',     x:932, y:268, w:200, h:80, label:'LIQUIDITY THERMAL', sub:'Heatmap · sweep probability', color:C.liq, phase:'live', detail:['Session liquidity pools','Sweep probability scoring','Visual heatmap overlay','Primitive renderer (LW Chart)'] },
  { id:'targets', x:1150,y:268, w:200, h:80, label:'PRICE TARGETS', sub:'VP · OB · Sess · Liq levels', color:C.ict, phase:'live', detail:['Volume Profile clusters','OB mitigation zones','Session high/low/mid','Liquidity pool targets','ATR-based clustering','HUD overlay on chart'] },

  // ── ROW 3: MOE Aggregator ─────────────────────────────────
  { id:'moe',     x:200, y:412, w:800, h:72, label:'MOE — MIXTURE OF EXPERTS AGGREGATOR', sub:'Multi-edge confidence fusion · regime-gated · council-weighted', color:C.jedi, phase:'build', detail:['Each algo = expert with confidence weight','Council bank aggregation (BOOM/STRAT/LEGEND)','JEDI gate: MTF alignment required for signal','Heatseeker regime filter (S/A tier minimum)','ICT confluence: FVG + OB + liquidity draw alignment','Final signal: { asset, dir, entry, sl, tp, confidence, tier }','Multi-timeframe: 5m entry · 1H structure · D1 bias'] },

  // ── ROW 4: Signal quality gate + risk ────────────────────
  { id:'siggate', x:200, y:548, w:360, h:68, label:'SIGNAL QUALITY GATE', sub:'Heatseeker S/A + JEDI > 15 + ICT confluence', color:C.risk, phase:'build', detail:['Minimum tier: A (alphaScore ≥ 72)','JEDI composite > threshold','ICT: FVG or OB alignment required','Regime: not RANGING','Output: typed signal JSON to bus'] },
  { id:'risk',    x:580, y:548, w:360, h:68, label:'RISK MANAGER', sub:'Kelly / fixed frac · max 5 positions · DD cap', color:C.risk, phase:'planned', detail:['Fixed fractional: 1-2% risk/trade','Max 5 concurrent positions','Daily DD cap: 3%','Weekly DD cap: 6%','Position size = (account × risk%) / (entry - SL)'] },

  // ── ROW 5: Signal bus ─────────────────────────────────────
  { id:'sigbus',  x:200, y:680, w:740, h:56, label:'SIGNAL BUS', sub:'WS stream · typed JSON · producer/consumer', color:C.paper, phase:'build', detail:['M3D /ws/signals producer','M4D TradeBotPage subscriber','{ asset, dir, entry, sl, tp, score, tier, timestamp }','Persistent queue for OMS'] },

  // ── ROW 6: Execution ──────────────────────────────────────
  { id:'alpaca',  x:200, y:798, w:240, h:64, label:'ALPACA PAPER', sub:'Rust adapter · paper API', color:C.exec, phase:'planned', detail:['POST /v1/order → Alpaca paper','Env: ALPACA_KEY + ALPACA_SECRET','base_url = paper-api.alpaca.markets','Fill confirmation → OMS'] },
  { id:'oms',     x:460, y:798, w:280, h:64, label:'OMS STATE MACHINE', sub:'pending→filled→closed/stopped', color:C.exec, phase:'planned', detail:['SQLite: orders table','States: pending/filled/partial/closed/stopped','SL/TP monitor loop','Fill reconciliation vs signal'] },
  { id:'blotter', x:760, y:798, w:240, h:64, label:'PAPER BLOTTER UI', sub:'TradeBotPage extended', color:C.paper, phase:'planned', detail:['Open positions table','Fill log real-time','P&L per trade','Wire to /v1/orders WS'] },

  // ── ROW 7: Analytics / Visual ─────────────────────────────
  { id:'pnl',     x:60,  y:924, w:200, h:68, label:'P&L DASHBOARD', sub:'Rolling Sharpe · win rate · equity', color:C.ds, phase:'planned', detail:['Rolling Sharpe (20-trade)','Win rate · avg RR','Max DD · equity curve','Add PERF tab to M4D'] },
  { id:'backtest',x:278, y:924, w:200, h:68, label:'BACKTEST RECON', sub:'DS vs live drift analysis', color:C.ds, phase:'planned', detail:['Same signal gate params','Compare paper fills vs DS backtest','Detect slippage / live drift','Optimizer feedback loop'] },
  { id:'vizm4d',  x:496, y:924, w:200, h:68, label:'M4D VISUAL LAYER', sub:'ICT chart · orb · heatmap · targets', color:C.ict, phase:'live', detail:['BoomLwChart overlays','SoloMasterOrb','LiquidityThermal heatmap','Price Target HUD','Council Matrix 27-vote'] },
  { id:'m3d_ui',  x:714, y:924, w:200, h:68, label:'M3D BLUEPRINT UI', sub:'Dashboard · Trader · AutoTrader', color:C.strat, phase:'build', detail:['CouncilMatrix live','PulseHero JEDI score','Trader page (build)','AutoTrader page (build)'] },
  { id:'alert',   x:932, y:924, w:200, h:68, label:'ALERT / WEBHOOK', sub:'TV webhook · push notification', color:C.liq, phase:'planned', detail:['TradingView webhook receiver','Push notification on entry signal','Slack/email (optional)','Mobile alert bridge'] },
];

// Build edges as fromId→toId pairs
const EDGES: ArchEdge[] = [
  // Data → Engine
  { from:'polygon', to:'engine',  color:C.boom },
  { from:'binance', to:'engine',  color:C.boom },
  { from:'tvpine',  to:'ict',     color:C.ict,  dashed:true, label:'planned' },
  { from:'ds_data', to:'ds_eng',  color:C.ds },
  // Engine → Signal layer
  { from:'engine',  to:'council', color:C.rust },
  { from:'engine',  to:'jedi',    color:C.rust },
  { from:'engine',  to:'heatseek',color:C.jedi, dashed:true },
  { from:'ds_eng',  to:'council', color:C.ds,   dashed:true },
  // ICT stack feeds
  { from:'polygon', to:'ict',     color:C.ict },
  { from:'ict',     to:'liq',     color:C.ict },
  { from:'ict',     to:'targets', color:C.ict },
  // All signals → MOE
  { from:'heatseek',to:'moe',     color:C.jedi },
  { from:'ict',     to:'moe',     color:C.ict },
  { from:'council', to:'moe',     color:C.boom },
  { from:'jedi',    to:'moe',     color:C.jedi },
  { from:'liq',     to:'moe',     color:C.liq },
  // MOE → gate
  { from:'moe',     to:'siggate', color:C.jedi },
  { from:'moe',     to:'risk',    color:C.risk, dashed:true },
  // Gate → bus
  { from:'siggate', to:'sigbus',  color:C.paper },
  { from:'risk',    to:'sigbus',  color:C.risk },
  // Bus → execution
  { from:'sigbus',  to:'alpaca',  color:C.exec },
  { from:'sigbus',  to:'oms',     color:C.exec },
  { from:'sigbus',  to:'blotter', color:C.paper },
  // OMS → blotter
  { from:'oms',     to:'blotter', color:C.paper },
  { from:'alpaca',  to:'oms',     color:C.exec },
  // Execution → analytics
  { from:'oms',     to:'pnl',     color:C.ds },
  { from:'oms',     to:'backtest',color:C.ds },
  { from:'sigbus',  to:'vizm4d',  color:C.ict },
  { from:'sigbus',  to:'m3d_ui',  color:C.strat },
  { from:'siggate', to:'alert',   color:C.liq, dashed:true },
  // DS backtest loop
  { from:'ds_eng',  to:'backtest',color:C.ds, dashed:true },
];

// ── Node lookup ───────────────────────────────────────────────────────────────
const NODE_MAP = Object.fromEntries(NODES.map(n => [n.id, n]));

function nodeCenter(id: string): [number, number] {
  const n = NODE_MAP[id];
  if (!n) return [0, 0];
  return [n.x + n.w / 2, n.y + n.h / 2];
}

// Simple edge: straight line from border of source to border of target
function edgePath(from: string, to: string): string {
  const [x1, y1] = nodeCenter(from);
  const [x2, y2] = nodeCenter(to);
  const f = NODE_MAP[from]!;
  const t = NODE_MAP[to]!;
  // Exit from bottom of source, enter top of target if target is below
  const sy = y1 < y2 ? f.y + f.h : f.y;
  const ty = y1 < y2 ? t.y : t.y + t.h;
  const mx = (x1 + x2) / 2;
  const my = (sy + ty) / 2;
  return `M ${x1} ${sy} C ${x1} ${my}, ${x2} ${my}, ${x2} ${ty}`;
}

// ── Build phase legend ────────────────────────────────────────────────────────
const PHASES: [Phase, string, string][] = [
  ['live',    '● LIVE',    'Deployed & operational'],
  ['build',   '◑ BUILD',   'In active development'],
  ['planned', '○ PLANNED', 'Roadmap — not started'],
];

const ITER_STEPS = [
  { n:'P0', color:C.liq,  label:'Signal Gate + Bus',      detail:'Quality gate → WS stream. Foundation for everything.' },
  { n:'P0', color:C.liq,  label:'Alpaca Paper Adapter',   detail:'Rust module. Free paper API. Immediate feedback loop.' },
  { n:'P1', color:C.risk, label:'OMS + Risk Manager',     detail:'State machine + position sizing. Kelly or fixed frac.' },
  { n:'P1', color:C.risk, label:'Paper Blotter UI',       detail:'TradeBotPage extended with live fills + P&L.' },
  { n:'P1', color:C.risk, label:'MOE Aggregator (full)',   detail:'Weight each algo by rolling Sharpe. Dynamic gate.' },
  { n:'P2', color:C.paper,label:'P&L Dashboard + Sharpe', detail:'Rolling 20-trade Sharpe. Equity curve. Win rate.' },
  { n:'P2', color:C.paper,label:'Backtest Reconciliation', detail:'DS vs live drift. Optimizer feedback loop.' },
  { n:'P2', color:C.paper,label:'TV Webhook Bridge',       detail:'ICT levels from Pine alerts → signal layer.' },
];
const SURFACE_ITEMS: SurfaceItem[] = [
  { feature: 'L2-5 Signal Library + IC monitor', page: 'Trader', hash: '#trader', status: 'LIVE' },
  { feature: 'Walk-forward + regime breakdown', page: 'Trader', hash: '#trader', status: 'LIVE' },
  { feature: 'L8-11 Sharpe routing + gate vetos', page: 'Trader', hash: '#trader', status: 'LIVE' },
  { feature: 'Cross-asset dims + PCA activity gate', page: 'Trader', hash: '#trader', status: 'LIVE' },
  { feature: 'L13 Delta Ops + CIS + mode table', page: 'Trader', hash: '#trader', status: 'LIVE' },
  { feature: 'HALO mode + stealth execution visibility', page: 'Trader', hash: '#trader', status: 'LIVE' },
  { feature: 'IBKR/PAPER run cycle + position matrix', page: 'Trader', hash: '#trader', status: 'LIVE' },
  { feature: 'Action bus receipts + rescue stages + lockdown', page: 'Trader', hash: '#trader', status: 'LIVE' },
  { feature: 'System map layer narrative', page: 'System Architecture', hash: '#sysarch', status: 'LIVE' },
  { feature: 'Iter-opt pending queue (P0/P1/P2)', page: 'System Architecture', hash: '#sysarch', status: 'LIVE' },
  { feature: 'Coverage + gap visibility map', page: 'Co-Dev Map', hash: '#codev', status: 'LIVE' },
  { feature: 'Liquidity thermal + target overlays', page: 'ICT/BTC/SPX/FX pages', hash: '#ict', status: 'LIVE' },
  { feature: 'P0-D Alpaca adapter execution path', page: 'Co-Dev Map + System Architecture', hash: '#codev', status: 'BUILD' },
  { feature: 'P1-A HMM posterior regime weighting', page: 'System Architecture (iter)', hash: '#sysarch', status: 'BUILD' },
  { feature: 'Re-entry holdout validation view', page: 'System Architecture (iter)', hash: '#sysarch', status: 'PLANNED' },
  { feature: 'ICT/HALO formula fix tracking', page: 'System Architecture (iter)', hash: '#sysarch', status: 'BUILD' },
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function SystemArchitecturePage() {
  const [hovered, setHovered] = useState<string | null>(null);
  const [tab, setTab] = useState<'arch' | 'iter' | 'surface'>('arch');

  const hNode = hovered ? NODE_MAP[hovered] : null;

  return (
    <div style={{
      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      background: C.bg, minHeight: '100vh',
      color: C.textHi, overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* Topbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '10px 20px', borderBottom: `1px solid ${C.border}`,
        background: C.bg1, flexShrink: 0,
      }}>
        <span style={{ fontSize: 16, fontWeight: 900, letterSpacing: 2, color: C.jedi }}>SYSTEM ARCHITECTURE</span>
        <span style={{ fontSize: 10, color: C.text }}>M4D COTRADER · M3D ALGOTRADER · MOE · ICT/LIQ · PAPER EXEC</span>
        <button onClick={() => window.open(SYSTEM_MAP_FILE_URL, '_blank')} style={{
          background: C.bg2, border: `1px solid ${C.muted}`, color: C.text,
          borderRadius: 4, padding: '4px 8px', fontSize: 10, cursor: 'pointer',
        }}>OPEN SYSTEM MAP</button>
        <button onClick={() => navigator.clipboard?.writeText(SYSTEM_SPEC_FILE)} style={{
          background: C.bg2, border: `1px solid ${C.muted}`, color: C.text,
          borderRadius: 4, padding: '4px 8px', fontSize: 10, cursor: 'pointer',
        }}>COPY SYSTEM SPEC PATH</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {(['arch', 'iter', 'surface'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: tab === t ? C.bg2 : 'transparent',
              border: `1px solid ${tab === t ? C.jedi : C.muted}`,
              color: tab === t ? C.jedi : C.text,
              borderRadius: 4, padding: '4px 12px', fontSize: 10,
              cursor: 'pointer', fontFamily: 'inherit', letterSpacing: 1,
            }}>
              {t === 'arch' ? 'ARCHITECTURE' : t === 'iter' ? 'ITER ROADMAP' : 'SURFACE COVERAGE'}
            </button>
          ))}
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', gap: 14, paddingLeft: 12, borderLeft: `1px solid ${C.border}` }}>
          {PHASES.map(([p, label]) => (
            <span key={p} style={{ fontSize: 9, color: PHASE_COLOR[p] }}>{label}</span>
          ))}
        </div>
      </div>

      {tab === 'arch' ? (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* SVG canvas */}
          <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              width={W} height={H}
              style={{ display: 'block' }}
            >
              {/* Background grid */}
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke={C.muted} strokeWidth="0.2" opacity="0.3" />
                </pattern>
                {/* Arrow markers */}
                {Object.entries({ boom: C.boom, ict: C.ict, jedi: C.jedi, ds: C.ds, rust: C.rust,
                                  liq: C.liq, exec: C.exec, risk: C.risk, paper: C.paper }).map(([k, col]) => (
                  <marker key={k} id={`arr-${k}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill={col} opacity="0.7" />
                  </marker>
                ))}
              </defs>
              <rect width={W} height={H} fill={C.bg} />
              <rect width={W} height={H} fill="url(#grid)" />

              {/* Row labels */}
              {[
                [30, 'DATA SOURCES'],
                [140, 'PROCESSING ENGINE'],
                [268, 'SIGNAL GENERATION'],
                [412, 'MOE AGGREGATION'],
                [548, 'QUALITY GATE + RISK'],
                [680, 'SIGNAL BUS'],
                [798, 'EXECUTION LAYER'],
                [924, 'ANALYTICS + UI'],
              ].map(([y, label]) => (
                <text key={String(label)} x={W - 12} y={Number(y) + 14}
                  fontSize="8" fill={C.muted} textAnchor="end" letterSpacing="2">
                  {label}
                </text>
              ))}

              {/* Edges */}
              {EDGES.map((e, i) => {
                const colorKey = Object.entries(C).find(([, v]) => v === e.color)?.[0] ?? 'text';
                const markerId = `arr-${colorKey}`;
                return (
                  <path key={i}
                    d={edgePath(e.from, e.to)}
                    fill="none"
                    stroke={e.color ?? C.text}
                    strokeWidth={hovered === e.from || hovered === e.to ? 1.5 : 0.7}
                    strokeDasharray={e.dashed ? '4,3' : undefined}
                    markerEnd={`url(#${markerId})`}
                    opacity={hovered ? (hovered === e.from || hovered === e.to ? 0.9 : 0.15) : 0.45}
                  />
                );
              })}

              {/* Nodes */}
              {NODES.map(node => {
                const isHov = hovered === node.id;
                const isDim = hovered && hovered !== node.id &&
                  !EDGES.some(e => e.from === hovered && e.to === node.id) &&
                  !EDGES.some(e => e.to === hovered && e.from === node.id);
                return (
                  <g key={node.id}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHovered(node.id)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <rect
                      x={node.x} y={node.y} width={node.w} height={node.h}
                      rx={6}
                      fill={isHov ? `${node.color}22` : C.bg2}
                      stroke={isHov ? node.color : `${node.color}55`}
                      strokeWidth={isHov ? 1.5 : 1}
                      opacity={isDim ? 0.25 : 1}
                    />
                    {/* Phase dot */}
                    <circle
                      cx={node.x + node.w - 10} cy={node.y + 10} r={3.5}
                      fill={PHASE_COLOR[node.phase]}
                    />
                    <text x={node.x + 10} y={node.y + 16}
                      fontSize="10" fontWeight="700" fill={isHov ? node.color : C.textHi}
                      opacity={isDim ? 0.25 : 1} letterSpacing="0.5">
                      {node.label}
                    </text>
                    {node.sub && (
                      <text x={node.x + 10} y={node.y + 28}
                        fontSize="8" fill={C.text} opacity={isDim ? 0.2 : 0.8}>
                        {node.sub}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Connection count badges on MOE node */}
              <text x={600} y={458} fontSize="8" fill={C.jedi} textAnchor="middle" opacity="0.6">
                ← 5 signal sources · 7 edge types · regime-gated →
              </text>
            </svg>
          </div>

          {/* Detail panel */}
          <div style={{
            width: 260, flexShrink: 0,
            borderLeft: `1px solid ${C.border}`,
            background: C.bg1,
            padding: 16, overflowY: 'auto',
          }}>
            {hNode ? (
              <>
                <div style={{ fontSize: 11, fontWeight: 800, color: hNode.color, marginBottom: 4, letterSpacing: 1 }}>
                  {hNode.label}
                </div>
                {hNode.sub && (
                  <div style={{ fontSize: 9, color: C.text, marginBottom: 10 }}>{hNode.sub}</div>
                )}
                <div style={{
                  display: 'inline-block', fontSize: 9, padding: '2px 8px',
                  borderRadius: 3, marginBottom: 12,
                  background: `${PHASE_COLOR[hNode.phase]}18`,
                  color: PHASE_COLOR[hNode.phase], border: `1px solid ${PHASE_COLOR[hNode.phase]}44`,
                }}>
                  {hNode.phase.toUpperCase()}
                </div>
                <div style={{ height: 1, background: C.border, marginBottom: 12 }} />
                {hNode.detail?.map((d, i) => (
                  <div key={i} style={{ fontSize: 10, color: C.text, marginBottom: 5, lineHeight: 1.5 }}>
                    · {d}
                  </div>
                ))}
                <div style={{ height: 1, background: C.border, margin: '12px 0' }} />
                <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1 }}>CONNECTIONS</div>
                {EDGES.filter(e => e.from === hNode.id || e.to === hNode.id).map((e, i) => (
                  <div key={i} style={{ fontSize: 9, color: C.text, marginTop: 4 }}>
                    {e.from === hNode.id ? `→ ${e.to}` : `← ${e.from}`}
                    {e.dashed ? <span style={{ color: C.muted }}> (planned)</span> : null}
                  </div>
                ))}
              </>
            ) : (
              <div style={{ color: C.muted, fontSize: 10, marginTop: 40, textAlign: 'center', lineHeight: 2 }}>
                HOVER A NODE<br />to see detail<br />+ connections
              </div>
            )}
          </div>
        </div>
      ) : tab === 'iter' ? (
        /* ── Iterative roadmap tab ───────────────────────────────────────── */
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
          <div style={{ maxWidth: 900 }}>
            <div style={{ fontSize: 9, letterSpacing: 3, color: C.muted, marginBottom: 20 }}>
              ITERATIVE OPTIMISATION — BUILD SEQUENCE TOWARDS PAPER TRADING
            </div>

            {/* Phase blocks */}
            {(['P0', 'P1', 'P2'] as const).map(phase => {
              const phaseColor = phase === 'P0' ? C.liq : phase === 'P1' ? C.risk : C.paper;
              const phaseLabel = phase === 'P0' ? 'CRITICAL PATH — paper trading foundation'
                : phase === 'P1' ? 'CORE PAPER — OMS + risk + blotter'
                : 'ANALYTICS — performance intelligence';
              const steps = ITER_STEPS.filter(s => s.n === phase);
              return (
                <div key={phase} style={{ marginBottom: 32 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14,
                    paddingBottom: 8, borderBottom: `1px solid ${phaseColor}33`,
                  }}>
                    <span style={{
                      fontSize: 13, fontWeight: 900, color: phaseColor,
                      background: `${phaseColor}18`, border: `1px solid ${phaseColor}44`,
                      padding: '2px 10px', borderRadius: 4, letterSpacing: 1,
                    }}>{phase}</span>
                    <span style={{ fontSize: 10, color: C.text }}>{phaseLabel}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {steps.map((s, i) => (
                      <div key={i} style={{
                        display: 'flex', gap: 14, alignItems: 'flex-start',
                        background: C.bg1, border: `1px solid ${C.border}`,
                        borderLeft: `3px solid ${s.color}`, borderRadius: 8, padding: '12px 16px',
                      }}>
                        <div style={{
                          width: 22, height: 22, borderRadius: '50%',
                          background: `${s.color}22`, border: `1px solid ${s.color}`,
                          color: s.color, fontSize: 10, fontWeight: 800,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                        }}>{i + 1}</div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: C.textHi, marginBottom: 4 }}>{s.label}</div>
                          <div style={{ fontSize: 10, color: C.text, lineHeight: 1.5 }}>{s.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* MOE build-out note */}
            <div style={{
              background: `${C.jedi}0a`, border: `1px solid ${C.jedi}33`,
              borderRadius: 10, padding: 20, marginTop: 8,
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.jedi, marginBottom: 10 }}>
                MOE — MIXTURE OF EXPERTS: ITERATIVE OPT STRATEGY
              </div>
              {[
                ['Phase 1 — Equal weights', 'All 27 algos at 1/27. Baseline. Ship the gate.'],
                ['Phase 2 — Sharpe weights', 'Weight each algo by rolling 20-trade Sharpe from paper data.'],
                ['Phase 3 — Regime-conditional weights', 'BULL regime → overweight momentum (BOOM). BEAR → LEGEND. RANGING → suppress all.'],
                ['Phase 4 — Dynamic dropout', 'Remove algos with Sharpe < 0 over trailing 50 trades. Re-add after recovery.'],
                ['Phase 5 — MTF gate', 'JEDI gate: only fire when D1 + W1 bias align with 5m entry direction.'],
              ].map(([phase, desc]) => (
                <div key={phase} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: C.jedi, marginBottom: 2 }}>{phase}</div>
                  <div style={{ fontSize: 10, color: C.text, lineHeight: 1.5, paddingLeft: 12 }}>{desc}</div>
                </div>
              ))}
            </div>

            {/* ICT visual build note */}
            <div style={{
              background: `${C.ict}0a`, border: `1px solid ${C.ict}33`,
              borderRadius: 10, padding: 20, marginTop: 16,
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.ict, marginBottom: 10 }}>
                ICT / LIQUIDITY VISUAL — ITERATIVE BUILD
              </div>
              {[
                ['Now — live', 'FVG zones, OB blocks, session levels, Liquidity Thermal heatmap, Price Target HUD on all 4 chart pages.'],
                ['P1 — TV webhook', 'Pine script alert → webhook → M3D → signal layer. ICT levels from Pine as authoritative source.'],
                ['P1 — Liquidity draw viz', 'Directional draw to liquidity pool rendered as arrow overlay on LW Chart. SoloOrb direction locked to draw.'],
                ['P2 — Multi-TF ICT view', 'ICT levels from H1 + D1 overlaid on 5m chart. Confluence scoring: more TF agreement = higher weight in MOE.'],
                ['P2 — Premium / discount zones', 'Auto-compute equilibrium for each identified range. Color gradient overlay (premium=red, discount=green).'],
              ].map(([phase, desc]) => (
                <div key={phase} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: C.ict, marginBottom: 2 }}>{phase}</div>
                  <div style={{ fontSize: 10, color: C.text, lineHeight: 1.5, paddingLeft: 12 }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
          <div style={{ maxWidth: 980 }}>
            <div style={{ fontSize: 10, letterSpacing: 2, color: C.muted, marginBottom: 12 }}>
              SYSTEM-MAP FEATURE SURFACE MATRIX
            </div>
            <div style={{ marginBottom: 10, fontSize: 10, color: C.text }}>
              Every feature in `SYSTEM-MAP.svg` is mapped to a relevant M4D page and state.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.9fr 0.5fr 0.6fr', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: C.muted }}>FEATURE</div>
              <div style={{ fontSize: 9, color: C.muted }}>SURFACED PAGE</div>
              <div style={{ fontSize: 9, color: C.muted }}>NAV</div>
              <div style={{ fontSize: 9, color: C.muted }}>STATE</div>
            </div>
            {SURFACE_ITEMS.map((item) => {
              const stColor = item.status === 'LIVE' ? C.legend : item.status === 'BUILD' ? C.risk : C.muted;
              return (
                <div key={item.feature} style={{
                  display: 'grid',
                  gridTemplateColumns: '1.6fr 0.9fr 0.5fr 0.6fr',
                  gap: 8,
                  alignItems: 'center',
                  padding: '8px 10px',
                  marginBottom: 6,
                  background: C.bg1,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                }}>
                  <div style={{ fontSize: 10, color: C.textHi }}>{item.feature}</div>
                  <div style={{ fontSize: 10, color: C.text }}>{item.page}</div>
                  <button
                    onClick={() => { window.location.hash = item.hash.replace('#', ''); }}
                    style={{
                      background: 'transparent', border: `1px solid ${C.muted}`, color: C.text,
                      borderRadius: 4, padding: '3px 6px', fontSize: 9, cursor: 'pointer',
                    }}
                  >
                    open
                  </button>
                  <div style={{ fontSize: 10, color: stColor, fontWeight: 700 }}>{item.status}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
