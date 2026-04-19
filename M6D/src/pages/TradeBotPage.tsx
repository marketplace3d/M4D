import { useEffect, useMemo, useState } from 'react';
import { XSentinelOrb, CouncilOrb, JediMasterOrb } from '../viz/MaxCogVizOrbs.jsx';
import { ConfluenceOrb, PriceOrb, RiskOrb, TVWebhookOrb, VolumeOrb } from '../viz/MaxCogVizOrbsII';
import '/src/pages/TradeBotPage.css';

const DS = 'http://127.0.0.1:8000';
const MRT = 'http://127.0.0.1:3340';

interface PendingSignal {
  symbol: string; alpaca_symbol?: string; regime: string; soft_score: number;
  jedi_raw: number; atr_rank: number; rvol_now: number; squeeze: boolean;
  price: number; gates_pass: boolean; killed: string[]; entry_dir: string | null;
  above_threshold: boolean; votes?: Record<string, number>; error?: string;
}
interface EquityPoint { ts: string; pnl: number }
interface PaperAccount { equity: number; cash: number; unrealized_pl: number }
interface PaperPosition { symbol: string; side: string; qty: number; unrealized_pl: number; entry_price?: number }
interface PaperTrade { symbol: string; type?: string; action?: string; side: string; qty: number; price: number; mode: string; note: string; ts: number }
interface PaperStatus { account?: PaperAccount; positions?: PaperPosition[]; recent_trades?: PaperTrade[] }
interface MrtSig { id: string; is_t: number; oos_t: number; is_r: number; oos_r: number }
interface MrtSym { symbol: string; composite: number; realized_vol_20: number; signals: MrtSig[] }

const REGIME_COLOR: Record<string, string> = {
  TRENDING: '#22c55e', BREAKOUT: '#fb923c', 'RISK-OFF': '#ef4444', RANGING: '#8899aa',
};

const ALL_PANELS = Array.from({ length: 27 }, (_, i) => ({ id: `P${i + 1}` }));

function gateColor(g: string): string {
  if (g.includes('HOUR')) return '#94a3b8';
  if (g.includes('JEDI')) return '#f59e0b';
  if (g.includes('SQUEEZE')) return '#a78bfa';
  return '#ef4444';
}

function SignalCard({
  sig, dismissed, approving,
  onApprove, onSkip,
}: {
  sig: PendingSignal; dismissed: boolean; approving: boolean;
  onApprove: () => void; onSkip: () => void;
}) {
  if (dismissed) return null;
  const borderColor = sig.above_threshold ? '#22c55e' : sig.entry_dir ? '#f59e0b' : '#1a2d3c';
  const jediSign = sig.jedi_raw >= 0 ? '+' : '';
  return (
    <div style={{
      border: `1px solid ${borderColor}`, background: '#060c14', borderRadius: 6,
      padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 16, fontWeight: 700, color: '#d0dfec', letterSpacing: 2 }}>
          {sig.symbol}
        </span>
        {sig.entry_dir && (
          <span style={{ fontSize: 11, fontWeight: 700, color: sig.entry_dir === 'LONG' ? '#22c55e' : '#ef4444', letterSpacing: 2, border: `1px solid ${sig.entry_dir === 'LONG' ? '#22c55e' : '#ef4444'}`, padding: '1px 6px', borderRadius: 3 }}>
            {sig.entry_dir}
          </span>
        )}
        <span style={{ fontSize: 10, color: REGIME_COLOR[sig.regime] ?? '#8899aa', letterSpacing: 1 }}>
          {sig.regime}
        </span>
        <span style={{ fontSize: 11, color: sig.jedi_raw >= 0 ? '#22c55e' : '#ef4444', fontFamily: 'monospace', marginLeft: 'auto' }}>
          JEDI {jediSign}{sig.jedi_raw.toFixed(1)}
        </span>
        <span style={{ fontSize: 11, color: '#7dd3fc', fontFamily: 'monospace' }}>
          ${sig.price?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[
          { l: 'SCORE', v: sig.soft_score.toFixed(3), c: sig.soft_score >= 0.35 ? '#22c55e' : '#8899aa' },
          { l: 'ATR', v: `${(sig.atr_rank * 100).toFixed(0)}%`, c: sig.atr_rank < 0.30 ? '#ef4444' : '#8899aa' },
          { l: 'RVOL', v: sig.rvol_now.toFixed(2), c: sig.rvol_now > 1.5 ? '#fb923c' : '#8899aa' },
          { l: 'SQZ', v: sig.squeeze ? 'YES' : 'no', c: sig.squeeze ? '#a78bfa' : '#445566' },
        ].map(k => (
          <div key={k.l} style={{ background: '#08121b', border: '1px solid #0d1f2e', borderRadius: 4, padding: '3px 8px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: k.c, fontWeight: 600, fontFamily: 'Barlow Condensed, sans-serif' }}>{k.v}</div>
            <div style={{ fontSize: 8, color: '#334455', letterSpacing: 1 }}>{k.l}</div>
          </div>
        ))}
      </div>

      {sig.gates_pass ? (
        <div style={{ fontSize: 9, color: '#22c55e', letterSpacing: 1 }}>✓ ALL GATES CLEAR</div>
      ) : (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {sig.killed.map(k => (
            <span key={k} style={{ fontSize: 9, color: gateColor(k), border: `1px solid ${gateColor(k)}30`, borderRadius: 3, padding: '1px 5px' }}>
              ✗ {k}
            </span>
          ))}
        </div>
      )}

      {sig.above_threshold && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            style={{
              flex: 1, background: approving ? '#0a2a0a' : '#0d2a14', border: '1px solid #22c55e',
              color: '#22c55e', borderRadius: 4, padding: '6px 0', fontSize: 11, letterSpacing: 2,
              cursor: approving ? 'not-allowed' : 'pointer', fontFamily: 'Barlow Condensed, sans-serif',
            }}
            disabled={approving}
            onClick={onApprove}
          >
            {approving ? '⟳ FIRING…' : '▶ APPROVE ORDER'}
          </button>
          <button
            style={{
              background: '#08121b', border: '1px solid #1a2d3c', color: '#445566',
              borderRadius: 4, padding: '6px 14px', fontSize: 11, cursor: 'pointer',
            }}
            onClick={onSkip}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function EquityCurve({ points }: { points: EquityPoint[] }) {
  const W = 560, H = 130, PX = 14, PY = 12;
  if (points.length < 2) {
    return (
      <div style={{ width: '100%', height: H, background: '#060c14', border: '1px solid #0d1f2e', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 10, color: '#334455', letterSpacing: 2 }}>NO TRADE HISTORY · RUN PAPER CYCLE TO BEGIN</span>
      </div>
    );
  }
  const vals = points.map(p => p.pnl);
  const minV = Math.min(0, ...vals), maxV = Math.max(0, ...vals);
  const range = maxV - minV || 1;
  const xs = (i: number) => PX + (i / (vals.length - 1)) * (W - PX * 2);
  const ys = (v: number) => PY + ((maxV - v) / range) * (H - PY * 2);
  const pts = vals.map((v, i) => `${xs(i)},${ys(v)}`).join(' ');
  const zY = ys(0);
  const last = vals[vals.length - 1];
  const lineColor = last >= 0 ? '#22c55e' : '#ef4444';
  const fillPath = `M ${xs(0)} ${ys(vals[0])} ${vals.map((v, i) => `L ${xs(i)} ${ys(v)}`).join(' ')} L ${xs(vals.length - 1)} ${zY} L ${xs(0)} ${zY} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block', background: '#040810', borderRadius: 5 }}>
      <defs>
        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.18" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <line x1={PX} y1={zY} x2={W - PX} y2={zY} stroke="#1a2d3c" strokeWidth="1" />
      <path d={fillPath} fill="url(#eqGrad)" />
      <polyline points={pts} fill="none" stroke={lineColor} strokeWidth="1.5" />
      <circle cx={xs(vals.length - 1)} cy={ys(last)} r="3" fill={lineColor} />
      <text x={W - PX} y={ys(last) - 5} textAnchor="end" fill={lineColor} fontSize="9" fontFamily="monospace">
        {last >= 0 ? '+' : ''}{last.toFixed(0)}
      </text>
      <text x={PX} y={H - 3} fill="#334455" fontSize="8" fontFamily="monospace">EQUITY CURVE</text>
    </svg>
  );
}

function DrawdownChart({ points }: { points: EquityPoint[] }) {
  const W = 560, H = 80, PX = 14, PY = 8;
  if (points.length < 2) return null;
  const vals = points.map(p => p.pnl);
  let runMax = vals[0];
  const dd = vals.map(v => { runMax = Math.max(runMax, v); return runMax > 0 ? (runMax - v) / runMax : 0; });
  const maxDD = Math.max(...dd, 0.01);
  const xs = (i: number) => PX + (i / (dd.length - 1)) * (W - PX * 2);
  const ys = (v: number) => PY + (v / maxDD) * (H - PY * 2);
  const pathD = dd.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xs(i)} ${ys(v)}`).join(' ');
  const fillD = `${pathD} L ${xs(dd.length - 1)} ${PY} L ${xs(0)} ${PY} Z`;
  const curDD = dd[dd.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block', background: '#040810', borderRadius: 5 }}>
      <path d={fillD} fill="#ef444418" />
      <path d={pathD} fill="none" stroke="#ef4444" strokeWidth="1.2" />
      <text x={PX} y={H - 3} fill="#334455" fontSize="8" fontFamily="monospace">
        DRAWDOWN · MAX {(maxDD * 100).toFixed(1)}% · NOW {(curDD * 100).toFixed(1)}%
      </text>
    </svg>
  );
}

function MonthlyHeatmap({ points }: { points: EquityPoint[] }) {
  const months = useMemo(() => {
    const map: Record<string, { start: number; end: number }> = {};
    for (const p of points) {
      if (!p.ts) continue;
      const d = new Date(p.ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!map[key]) map[key] = { start: p.pnl, end: p.pnl };
      map[key].end = p.pnl;
    }
    const now = new Date();
    const cells = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('default', { month: 'short' });
      const entry = map[key];
      const ret = entry ? entry.end - entry.start : null;
      cells.push({ key, label, ret, year: d.getFullYear() });
    }
    return cells;
  }, [points]);

  const maxAbs = Math.max(...months.map(m => Math.abs(m.ret ?? 0)), 1);

  return (
    <div>
      <div style={{ fontSize: 9, color: '#334455', letterSpacing: 2, marginBottom: 5 }}>MONTHLY P&L</div>
      <div style={{ display: 'flex', gap: 4 }}>
        {months.map(m => {
          const intensity = m.ret !== null ? Math.abs(m.ret) / maxAbs : 0;
          const bg = m.ret === null ? '#08121b' : m.ret >= 0
            ? `rgba(34, 197, 94, ${0.12 + intensity * 0.5})`
            : `rgba(239, 68, 68, ${0.12 + intensity * 0.5})`;
          const tc = m.ret === null ? '#223' : m.ret >= 0 ? '#22c55e' : '#ef4444';
          return (
            <div key={m.key} style={{
              flex: 1, background: bg, border: '1px solid #0d1f2e', borderRadius: 4,
              padding: '6px 2px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 8, color: '#445566', letterSpacing: 1 }}>{m.label}</div>
              <div style={{ fontSize: 9, color: tc, fontFamily: 'monospace', fontWeight: 600, marginTop: 2 }}>
                {m.ret !== null ? `${m.ret >= 0 ? '+' : ''}${m.ret.toFixed(0)}` : '—'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MrtPanel({ symbols }: { symbols: MrtSym[] }) {
  if (!symbols.length) return (
    <div style={{ fontSize: 9, color: '#334455', letterSpacing: 1, padding: '8px 0' }}>
      MRT offline · start: cd MRT && cargo run --release --bin mrt-api
    </div>
  );
  const top = symbols.slice(0, 5);
  return (
    <div>
      {top.map(sym => {
        const c = sym.composite;
        const dir = c > 0.02 ? '#22c55e' : c < -0.02 ? '#ef4444' : '#8899aa';
        return (
          <div key={sym.symbol} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
            <span style={{ width: 40, fontSize: 10, color: '#c8d8e8', fontFamily: 'monospace' }}>{sym.symbol}</span>
            <div style={{ flex: 1, height: 4, background: '#0d1f2e', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                width: `${Math.min(100, Math.abs(c) * 800)}%`,
                height: '100%',
                background: dir,
                marginLeft: c < 0 ? 'auto' : 0,
              }} />
            </div>
            <div style={{ display: 'flex', gap: 3, width: 160 }}>
              {sym.signals.map(s => (
                <div key={s.id} title={`IS t=${s.is_t.toFixed(2)} OOS t=${s.oos_t.toFixed(2)}`}
                  style={{
                    flex: 1, fontSize: 7, textAlign: 'center', padding: '1px 2px',
                    background: '#08121b', borderRadius: 2,
                    color: s.oos_t > 1.5 ? '#22c55e' : s.oos_t < 0 ? '#ef4444' : '#8899aa',
                    border: '1px solid #0d1f2e', letterSpacing: 0,
                  }}>
                  {s.id.replace('_', '')}<br />{s.oos_t.toFixed(1)}t
                </div>
              ))}
            </div>
            <span style={{ fontSize: 10, color: dir, fontFamily: 'monospace', width: 40, textAlign: 'right' }}>
              {c >= 0 ? '+' : ''}{c.toFixed(3)}
            </span>
          </div>
        );
      })}
      <div style={{ fontSize: 8, color: '#1a2d3c', marginTop: 6, letterSpacing: 1 }}>
        4 MRT signals: REV_1 · MOM_5v20 · RANGE20 · TREND12 · FDR validated
      </div>
    </div>
  );
}

export default function TradeBotPage() {
  const [pending, setPending] = useState<PendingSignal[]>([]);
  const [pendingMode, setPendingMode] = useState('PADAWAN');
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState<string | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());

  const [equityPoints, setEquityPoints] = useState<EquityPoint[]>([]);
  const [paperData, setPaperData] = useState<PaperStatus | null>(null);
  const [activityData, setActivityData] = useState<any>(null);
  const [fngData, setFngData] = useState<any>(null);
  const [crossData, setCrossData] = useState<any>(null);
  const [mrtSymbols, setMrtSymbols] = useState<MrtSym[]>([]);
  const [mrtRegime, setMrtRegime] = useState<string>('');
  const [ibkrData, setIbkrData] = useState<any>(null);
  const [paperRunning, setPaperRunning] = useState(false);
  const [pulse, setPulse] = useState(0);

  // Poll pending signals every 60s
  useEffect(() => {
    const load = () => {
      fetch(`${DS}/v1/paper/pending/?mode=${pendingMode}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.pending) setPending(d.pending); })
        .catch(() => {});
    };
    load();
    const id = setInterval(() => { load(); setPulse(p => p + 1); }, 60_000);
    return () => clearInterval(id);
  }, [pendingMode]);

  // Poll paper status + activity + fng + cross every 30s
  useEffect(() => {
    const load = () => {
      fetch(`${DS}/v1/paper/status/`).then(r => r.ok ? r.json() : null).then(d => { if (d) setPaperData(d); }).catch(() => {});
      fetch(`${DS}/v1/ai/activity/`).then(r => r.ok ? r.json() : null).then(d => { if (d) setActivityData(d); }).catch(() => {});
      fetch(`${DS}/v1/fng/`).then(r => r.ok ? r.json() : null).then(d => { if (d?.ok) setFngData(d); }).catch(() => {});
      fetch(`${DS}/v1/cross/report/`).then(r => r.ok ? r.json() : null).then(d => { if (d) setCrossData(d); }).catch(() => {});
      fetch(`${DS}/v1/ibkr/status/`).then(r => r.ok ? r.json() : null).then(d => { if (d) setIbkrData(d); }).catch(() => {});
    };
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  // Poll equity curve every 2min
  useEffect(() => {
    const load = () => {
      fetch(`${DS}/v1/paper/equity/`).then(r => r.ok ? r.json() : null).then(d => { if (d?.points) setEquityPoints(d.points); }).catch(() => {});
    };
    load();
    const id = setInterval(load, 120_000);
    return () => clearInterval(id);
  }, []);

  // Poll MRT snapshot every 5min
  useEffect(() => {
    const load = () => {
      fetch(`${MRT}/v1/mrt/snapshot`).then(r => r.ok ? r.json() : null).then(d => { if (d?.symbols) { setMrtSymbols(d.symbols); setMrtRegime(d.regime?.label ?? ''); } }).catch(() => {});
    };
    load();
    const id = setInterval(load, 300_000);
    return () => clearInterval(id);
  }, []);

  const handleApprove = (sym: string) => {
    setApproving(sym);
    fetch(`${DS}/v1/paper/approve/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: sym, mode: pendingMode }),
    })
      .then(() => {
        setApproved(a => new Set([...a, sym]));
        setTimeout(() => { setApproving(null); }, 3000);
      })
      .catch(() => setApproving(null));
  };

  // Orb data from primary pending signal
  const primary = pending.find(p => !p.error);
  const orbScore = primary ? Math.round(primary.jedi_raw) : 0;
  const orbDir = primary ? (primary.jedi_raw > 2 ? 'LONG' : primary.jedi_raw < -2 ? 'SHORT' : 'FLAT') : 'FLAT';
  const orbConviction = Math.min(100, Math.round(Math.abs(orbScore) / 27 * 100));

  const actGate: string = activityData?.gate_label ?? 'SLOW';
  const actEnergy = actGate === 'HOT' ? 95 : actGate === 'ALIVE' ? 65 : actGate === 'SLOW' ? 30 : 5;
  const grokScore = Number(activityData?.grok_score ?? 0.5);
  const trendDir: string = activityData?.trend_direction ?? 'neutral';

  const councilVotes = useMemo(() => {
    const votes: Record<string, number> = {};
    const strengths: Record<string, number> = {};
    for (let i = 0; i < 27; i++) {
      const key = `P${i + 1}`;
      const threshold = Math.abs(orbScore);
      const dir = orbScore >= 0 ? 1 : -1;
      votes[key] = i < threshold ? dir : 0;
      strengths[key] = i < threshold ? 0.55 + (i / 27) * 0.4 : 0.15;
    }
    return { votes, strengths };
  }, [orbScore]);

  const bankA = Math.round(orbScore * 0.40);
  const bankB = Math.round(orbScore * 0.35);
  const bankC = Math.round(orbScore * 0.25);

  const pnl = paperData?.account?.unrealized_pl ?? null;
  const equity = paperData?.account?.equity ?? 0;

  // KPI strip values
  const crossRegime: string = crossData?.regime ?? 'NEUTRAL';
  const crossColor = crossRegime === 'RISK_ON' ? '#22c55e' : crossRegime === 'RISK_OFF' ? '#ef4444' : '#8899aa';
  const fngVal = fngData?.value ?? null;
  const fngLabel: string = fngData?.label ?? '';

  const activePending = pending.filter(p => !p.error && !dismissed.has(p.symbol));
  const approvalCount = activePending.filter(p => p.above_threshold).length;

  return (
    <div className="trade-fire-page">
      {/* ── KPI STRIP ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '8px 0 10px', borderBottom: '1px solid #0d1f2e' }}>
        <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 16, letterSpacing: 3, color: '#7dd3fc', marginRight: 8 }}>
          TRADING COUNCIL
        </span>
        {[
          { l: 'EQUITY', v: equity ? `$${Number(equity).toLocaleString()}` : '—', c: '#22c55e' },
          { l: 'P&L', v: pnl !== null ? `${pnl >= 0 ? '+' : ''}$${Number(pnl).toFixed(0)}` : '—', c: pnl !== null ? (pnl >= 0 ? '#22c55e' : '#ef4444') : '#445566' },
          { l: 'MODE', v: pendingMode, c: '#8899aa' },
          { l: 'GATE', v: actGate, c: actGate === 'HOT' ? '#fb923c' : actGate === 'ALIVE' ? '#22c55e' : actGate === 'SLOW' ? '#8899aa' : '#ef4444' },
          { l: 'REGIME', v: crossRegime.replace('_', ' '), c: crossColor },
          { l: 'F&G', v: fngVal !== null ? `${fngVal} ${fngLabel.replace('_', ' ')}` : '—', c: fngVal !== null ? (fngVal <= 44 ? '#22c55e' : fngVal >= 56 ? '#ef4444' : '#8899aa') : '#445566' },
          { l: 'APPROVE', v: approvalCount > 0 ? `${approvalCount} READY` : 'watching', c: approvalCount > 0 ? '#22c55e' : '#334455' },
          { l: 'PULSE', v: String(pulse), c: '#334455' },
        ].map(k => (
          <div key={k.l} className="trade-fire-indicator" style={{ color: k.c }}>
            <span style={{ color: '#334455', marginRight: 4 }}>{k.l}</span>{k.v}
          </div>
        ))}
        {/* Mode selector */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {(['PADAWAN', 'NORMAL', 'EUPHORIA'] as const).map(m => (
            <button key={m}
              style={{
                background: pendingMode === m ? '#0d2a14' : '#08121b',
                border: `1px solid ${pendingMode === m ? '#22c55e' : '#1a2d3c'}`,
                color: pendingMode === m ? '#22c55e' : '#445566',
                fontSize: 9, padding: '2px 8px', cursor: 'pointer', letterSpacing: 1,
                fontFamily: 'Barlow Condensed, sans-serif',
              }}
              onClick={() => setPendingMode(m)}
            >{m}</button>
          ))}
        </div>
      </div>

      {/* ── BODY ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'flex-start' }}>

        {/* LEFT MAIN */}
        <div style={{ flex: '3 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* SIGNAL APPROVAL QUEUE */}
          <div>
            <div style={{ fontSize: 9, color: '#334455', letterSpacing: 2, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              SIGNAL QUEUE · HUMAN APPROVAL
              {approvalCount > 0 && (
                <span style={{ background: '#0d2a14', border: '1px solid #22c55e', color: '#22c55e', fontSize: 9, padding: '1px 6px', borderRadius: 10 }}>
                  {approvalCount} READY
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activePending.length === 0 && (
                <div style={{ fontSize: 10, color: '#334455', padding: '12px 0' }}>
                  Scanning {pendingMode} signals… (60s interval) · Set PAPER_SYMBOLS env to configure tracked symbols
                </div>
              )}
              {activePending.map(sig => (
                <SignalCard
                  key={sig.symbol}
                  sig={sig}
                  dismissed={dismissed.has(sig.symbol)}
                  approving={approving === sig.symbol}
                  onApprove={() => handleApprove(sig.symbol)}
                  onSkip={() => setDismissed(d => new Set([...d, sig.symbol]))}
                />
              ))}
              {approved.size > 0 && (
                <div style={{ fontSize: 9, color: '#22c55e', letterSpacing: 1 }}>
                  ✓ ORDERS FIRED: {[...approved].join(', ')}
                </div>
              )}
            </div>
          </div>

          {/* PERFORMANCE CHARTS */}
          <div>
            <div style={{ fontSize: 9, color: '#334455', letterSpacing: 2, marginBottom: 8 }}>PERFORMANCE</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <EquityCurve points={equityPoints} />
              <DrawdownChart points={equityPoints} />
              {equityPoints.length > 0 && <MonthlyHeatmap points={equityPoints} />}
            </div>
          </div>

          {/* PAPER BLOTTER */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: '#334455', letterSpacing: 2 }}>PAPER BLOTTER · ALPACA</div>
              <button
                style={{
                  background: '#08121b', border: '1px solid #1a2d3c', color: '#445566',
                  borderRadius: 3, padding: '2px 8px', fontSize: 9, cursor: 'pointer', letterSpacing: 1,
                }}
                disabled={paperRunning}
                onClick={() => {
                  setPaperRunning(true);
                  fetch(`${DS}/v1/paper/run/`, { method: 'POST' })
                    .then(() => setTimeout(() => {
                      fetch(`${DS}/v1/paper/status/`).then(r => r.json()).then(d => { setPaperData(d); setPaperRunning(false); }).catch(() => setPaperRunning(false));
                    }, 8000))
                    .catch(() => setPaperRunning(false));
                }}
              >
                {paperRunning ? '⟳ RUNNING' : '▶ SCAN ALL'}
              </button>
              {ibkrData?.connected && <span style={{ fontSize: 9, color: '#22c55e' }}>● IBKR</span>}
            </div>

            {paperData ? (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  {[
                    { l: 'EQUITY', v: `$${Number(paperData.account?.equity ?? 0).toLocaleString()}`, c: '#22c55e' },
                    { l: 'CASH', v: `$${Number(paperData.account?.cash ?? 0).toLocaleString()}`, c: '#8899aa' },
                    { l: 'P&L', v: `${(paperData.account?.unrealized_pl ?? 0) >= 0 ? '+' : ''}$${Number(paperData.account?.unrealized_pl ?? 0).toFixed(0)}`, c: (paperData.account?.unrealized_pl ?? 0) >= 0 ? '#22c55e' : '#ef4444' },
                  ].map(k => (
                    <div key={k.l} style={{ background: '#060c14', border: '1px solid #0d1f2e', borderRadius: 4, padding: '5px 12px', textAlign: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: k.c, fontFamily: 'Barlow Condensed, sans-serif' }}>{k.v}</div>
                      <div style={{ fontSize: 8, color: '#334455', letterSpacing: 1 }}>{k.l}</div>
                    </div>
                  ))}
                </div>

                {(paperData.positions?.length ?? 0) > 0 && (
                  <div style={{ background: '#060c14', border: '1px solid #0d1f2e', borderRadius: 4, padding: '8px 12px', marginBottom: 8 }}>
                    <div style={{ fontSize: 8, color: '#334455', letterSpacing: 1, marginBottom: 6 }}>OPEN POSITIONS</div>
                    {paperData.positions!.map(p => (
                      <div key={p.symbol} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 10, color: '#c8d8e8', fontFamily: 'monospace', width: 80 }}>{p.symbol}</span>
                        <span style={{ fontSize: 10, color: p.side === 'long' ? '#22c55e' : '#ef4444' }}>{String(p.side).toUpperCase()} {p.qty}</span>
                        <span style={{ fontSize: 10, color: (p.unrealized_pl ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                          {(p.unrealized_pl ?? 0) >= 0 ? '+' : ''}{Number(p.unrealized_pl ?? 0).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {(paperData.recent_trades?.length ?? 0) > 0 && (
                  <div style={{ background: '#060c14', border: '1px solid #0d1f2e', borderRadius: 4, padding: '8px 12px' }}>
                    <div style={{ fontSize: 8, color: '#334455', letterSpacing: 1, marginBottom: 6 }}>RECENT TRADES</div>
                    {paperData.recent_trades!.slice(0, 12).map((t, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 3, fontSize: 9, color: '#8899aa', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'monospace', color: '#c8d8e8', width: 60 }}>{t.symbol}</span>
                        <span style={{ color: (t.type ?? t.action) === 'ENTRY' ? '#22c55e' : '#fb923c', width: 50 }}>{t.type ?? t.action}</span>
                        <span style={{ color: (t.side === 'buy' || t.side === 'long') ? '#22c55e' : '#ef4444', width: 28 }}>{String(t.side).toUpperCase()}</span>
                        <span style={{ width: 60 }}>{t.mode}</span>
                        <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', color: '#445566', flex: 1 }}>{String(t.note ?? '').slice(0, 70)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 9, color: '#334455' }}>Set ALPACA_KEY + ALPACA_SECRET env vars</div>
            )}
          </div>
        </div>

        {/* RIGHT ORB COLUMN */}
        <div className="trade-fire-orbs" style={{ flex: '2 1 0', minWidth: 320, maxWidth: 420 }}>

          {/* Top 3 orbs */}
          <div className="trade-fire-orb-row trade-fire-orb-row--core">
            <XSentinelOrb
              data={{
                energy: actEnergy,
                direction: trendDir === 'up' ? 'bullish' : trendDir === 'down' ? 'bearish' : 'neutral',
                velocity: Math.min(1, actEnergy / 100),
                confidence: grokScore,
                sentiment: grokScore,
                influence: 0.72,
                noiseBlocked: 2,
              }}
              direction={orbDir}
            />
            <CouncilOrb
              score={orbScore}
              direction={orbDir}
              votes={councilVotes.votes}
              strengths={councilVotes.strengths}
              bankANet={bankA}
              bankBNet={bankB}
              bankCNet={bankC}
              conviction={orbConviction}
              allPanels={ALL_PANELS as any}
            />
            <JediMasterOrb score={orbScore} direction={orbDir} conviction={orbConviction} />
          </div>

          {/* Status indicators */}
          <div className="trade-fire-indicators">
            {primary && (
              <>
                <span className="trade-fire-indicator" style={{ color: REGIME_COLOR[primary.regime] ?? '#8899aa' }}>{primary.regime}</span>
                <span className="trade-fire-indicator" style={{ color: primary.jedi_raw >= 0 ? '#22c55e' : '#ef4444' }}>
                  JEDI {primary.jedi_raw >= 0 ? '+' : ''}{primary.jedi_raw.toFixed(1)}
                </span>
                <span className="trade-fire-indicator">{primary.symbol} ${primary.price?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </>
            )}
            {fngData && <span className="trade-fire-indicator" style={{ color: fngVal <= 44 ? '#22c55e' : fngVal >= 56 ? '#ef4444' : '#8899aa' }}>F&G {fngVal}</span>}
            <span className="trade-fire-indicator" style={{ color: crossColor }}>{crossRegime.replace('_', ' ')}</span>
          </div>

          {/* Bottom 5 orbs */}
          <div className="trade-fire-orb-row trade-fire-orb-row--new">
            <PriceOrb
              candles={primary ? [{ o: primary.price * 0.998, h: primary.price * 1.003, l: primary.price * 0.996, c: primary.price }] : []}
              vwap={primary?.price ?? 0}
              bid={(primary?.price ?? 0) * 0.9995}
              ask={(primary?.price ?? 0) * 1.0005}
              direction={orbDir}
            />
            <RiskOrb
              pnl={pnl !== null ? pnl : orbScore * 18}
              pnlMax={equity > 0 ? equity * 0.05 : 700}
              drawdown={Math.max(0, (50 - orbConviction) / 100)}
              maxDrawdown={0.42}
              positionSize={paperData?.positions?.length ? Math.min(1, paperData.positions.length / 5) : Math.min(1, orbConviction / 100)}
              direction={orbDir}
            />
            <ConfluenceOrb
              bankAScore={bankA / 9}
              bankBScore={bankB / 9}
              bankCScore={bankC / 9}
              kellyFire={orbConviction > 60}
              direction={orbDir}
            />
            <VolumeOrb
              delta={Math.max(-1, Math.min(1, orbScore / 27))}
              cumDelta={Math.max(-1, Math.min(1, orbScore / 20))}
              absorption={Math.min(1, orbConviction / 100)}
              tapeSpeed={0.5 + (pulse % 6) * 0.08}
              direction={orbDir}
            />
            <TVWebhookOrb
              connected
              lastFiredMs={(pulse % 40) * 1000}
              latencyMs={42 + (pulse % 9) * 16}
              action={orbDir === 'LONG' ? 'BUY' : orbDir === 'SHORT' ? 'SELL' : 'IDLE'}
              fireCount={pulse}
            />
          </div>

          {/* MRT SIGNAL FACTORY */}
          <div style={{ marginTop: 14, borderTop: '1px solid #0d1f2e', paddingTop: 10 }}>
            <div style={{ fontSize: 9, color: '#334455', letterSpacing: 2, marginBottom: 8 }}>
              MRT · SIGNAL FACTORY (port 3340)
            </div>
            <MrtPanel symbols={mrtSymbols} />
            {mrtSymbols.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 8, color: '#1a2d3c', letterSpacing: 1 }}>
                regime: {mrtRegime || '—'} · REV_1 · MOM_5v20 · RANGE20 · TREND12 · FDR
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
