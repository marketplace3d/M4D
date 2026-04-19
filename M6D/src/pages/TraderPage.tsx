import { useEffect, useState, useCallback, useRef } from 'react';
import MaxCogVizKnights from '../viz/ControlRoomKnights.jsx';

// ═══════════════════════════════════════════════════════════════════════
// M4D · TRADER — 4K MAXCOGVIZ COMMAND CENTER
// ALGO BRAIN: 4 layers matching SYSTEM-MAP.svg
//   L2-5  SIGNALS  — signal library, IC monitor, regime routing
//   L8-11 ROUTING  — ensemble Sharpe, gate vetos, cross-asset, PCA
//   L13   OPS      — Delta Ops, HALO, mode configs, EUPHORIA trigger
//   LIVE  BROKER   — IBKR TWS, positions, run cycle
// ═══════════════════════════════════════════════════════════════════════

const DS = 'http://127.0.0.1:8000';

// ── Color tokens ────────────────────────────────────────────────────────
const C = {
  bg:        '#020307',
  bg1:       '#030810',
  bg2:       '#060c14',
  border:    '#0d1f2e',
  dim:       '#1e3a4a',
  muted:     '#334455',
  text:      '#8ab0c8',
  TRENDING:  '#22c55e',
  BREAKOUT:  '#fb923c',
  'RISK-OFF':'#ef4444',
  RANGING:   '#64748b',
  PADAWAN:   '#4a9eff',
  NORMAL:    '#22c55e',
  EUPHORIA:  '#fb923c',
  MAX:       '#c084fc',
  HEALTHY:   '#22c55e',
  WATCH:     '#f59e0b',
  SLOW:      '#fb923c',
  DECLINING: '#ef4444',
  RETIRE:    '#7f1d1d',
  HOT:       '#fb923c',
  ALIVE:     '#22c55e',
  SLOW_G:    '#64748b',
  DEAD:      '#ef4444',
};

type BrainTab = 'SIGNALS' | 'ROUTING' | 'OPS' | 'BROKER';

// ── Primitives ──────────────────────────────────────────────────────────
function Row({ k, v, vc = C.text, mono = true }: { k: string; v: string | number; vc?: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, gap: 8 }}>
      <span style={{ fontSize: 9, color: C.muted, flexShrink: 0 }}>{k}</span>
      <span style={{ fontSize: 9, color: vc, fontFamily: mono ? 'monospace' : undefined, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

function Card({ title, w = 220, children, accent = '#4a9eff' }: {
  title: string; w?: number; children: React.ReactNode; accent?: string;
}) {
  return (
    <div style={{
      width: w, minWidth: w, flexShrink: 0, background: C.bg2,
      border: `1px solid ${C.border}`, borderRadius: 5,
      padding: '6px 9px', display: 'flex', flexDirection: 'column', gap: 0,
    }}>
      <div style={{
        fontSize: 8, letterSpacing: 2.5, color: accent, marginBottom: 7,
        fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Pill({ label, col = C.muted, bg = C.bg2 }: { label: string; col?: string; bg?: string }) {
  return (
    <span style={{
      fontSize: 8, color: col, background: bg, border: `1px solid ${col}40`,
      borderRadius: 3, padding: '1px 5px', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 1,
    }}>{label}</span>
  );
}

function ActionBtn({ label, onClick, running }: { label: string; onClick: () => void; running?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={running}
      style={{
        background: running ? '#0a1a2e' : 'none',
        border: `1px solid ${running ? C.PADAWAN : C.border}`,
        color: running ? C.PADAWAN : C.muted, fontSize: 8, padding: '2px 8px',
        cursor: running ? 'not-allowed' : 'pointer', borderRadius: 3,
        fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 1, flexShrink: 0,
      }}
    >
      {running ? '⟳ running…' : label}
    </button>
  );
}

function SharpeNum({ v, base = 0 }: { v: number | null; base?: number }) {
  if (v == null) return <span style={{ color: C.muted, fontFamily: 'monospace', fontSize: 10 }}>—</span>;
  const c = v > base + 0.5 ? C.HEALTHY : v > 0 ? C.PADAWAN : C.RETIRE;
  return <span style={{ color: c, fontFamily: 'monospace', fontSize: 10, fontWeight: 700 }}>{v.toFixed(3)}</span>;
}

// ── Sparkline ─────────────────────────────────────────────────────────────
function Sparkline({ data, w = 60, h = 16, pos = C.HEALTHY, neg = C.RETIRE, fill = false }: {
  data: number[]; w?: number; h?: number; pos?: string; neg?: string; fill?: boolean;
}) {
  if (!data || data.length < 2) return <span style={{ width: w, height: h, display: 'inline-block' }} />;
  const mn = Math.min(...data), mx = Math.max(...data);
  const range = mx - mn || 0.001;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (w - 3) + 1.5;
    const y = (h - 3) - ((v - mn) / range) * (h - 3) + 1.5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = data[data.length - 1];
  const lineC = last >= 0 ? pos : neg;
  const lx = parseFloat(pts[pts.length - 1].split(',')[0]);
  const ly = parseFloat(pts[pts.length - 1].split(',')[1]);
  const fillStr = `${pts[0].split(',')[0]},${h} ${pts.join(' ')} ${lx},${h}`;
  return (
    <svg width={w} height={h} style={{ display: 'block', flexShrink: 0 }}>
      {fill && <polygon points={fillStr} fill={`${lineC}22`} />}
      <polyline points={pts.join(' ')} fill="none" stroke={lineC} strokeWidth={1.3}
        strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2} fill={lineC} />
    </svg>
  );
}

// ── Traffic light ──────────────────────────────────────────────────────────
function TLight({ state }: { state: 'green' | 'yellow' | 'red' | 'off' }) {
  const dot = (lit: boolean, col: string, dim: string) => (
    <span style={{ width: 5, height: 5, borderRadius: '50%', display: 'block', flexShrink: 0,
      background: lit ? col : dim,
      boxShadow: lit ? `0 0 4px ${col}` : 'none' }} />
  );
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center', flexShrink: 0, padding: '1px 0' }}>
      {dot(state === 'red',    C.RETIRE,  '#ef444420')}
      {dot(state === 'yellow', C.WATCH,   '#f59e0b18')}
      {dot(state === 'green',  C.HEALTHY, '#22c55e18')}
    </span>
  );
}

// ── Health bar — RETIRE/SLOW/WATCH/HEALTHY proportion ─────────────────────
function HealthBar({ retire = 0, slow = 0, watch = 0, healthy = 0, w = 200 }: {
  retire?: number; slow?: number; watch?: number; healthy?: number; w?: number;
}) {
  const total = retire + slow + watch + healthy || 1;
  return (
    <div style={{ display: 'flex', width: w, height: 6, borderRadius: 3, overflow: 'hidden', gap: 1, flexShrink: 0 }}>
      {([ [retire, C.RETIRE], [slow, C.SLOW], [watch, C.WATCH], [healthy, C.HEALTHY] ] as [number,string][]).map(([n, col], i) =>
        n > 0 ? <div key={i} style={{ width: `${(n / total) * 100}%`, background: col }} /> : null
      )}
    </div>
  );
}

// ── LAYER 2-5: SIGNALS tab ──────────────────────────────────────────────
function SignalBar({ sig, info }: { sig: string; info: any }) {
  const regC   = (C as any)[info.home_regime] ?? C.muted;
  const stC    = (C as any)[info.status] ?? C.muted;
  const ic     = info.regime_ic_latest ?? 0;
  const bar    = Math.max(0, Math.min(1, Math.abs(ic) * 20));
  const wins   = (info.ic_windows ?? []) as number[];
  const tlight = info.status === 'RETIRE' ? 'red' : info.status === 'SLOW' || info.status === 'DECLINING' ? 'yellow' : info.status === 'WATCH' ? 'yellow' : 'green';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
      <TLight state={tlight as any} />
      <span style={{ width: 80, fontSize: 8, color: ic > 0 ? C.text : C.muted, fontFamily: 'monospace' }}>{sig}</span>
      <span style={{ width: 36, fontSize: 7, color: regC }}>{info.home_regime?.slice(0,6)}</span>
      <div style={{ width: 36, height: 4, background: '#0d1f2e', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ width: `${bar * 100}%`, height: '100%', background: ic > 0 ? C.HEALTHY : C.RETIRE, borderRadius: 2 }} />
      </div>
      <span style={{ width: 48, fontSize: 8, color: stC, fontFamily: 'monospace' }}>
        {ic > 0 ? '+' : ''}{ic.toFixed(4)}
      </span>
      <Sparkline data={wins} w={48} h={12} />
    </div>
  );
}

function SignalsTab({ ic, wf, onRun }: { ic: any; wf: any; onRun: (ep: string) => void }) {
  const [running, setRunning] = useState<string | null>(null);
  const run = (ep: string) => {
    setRunning(ep);
    fetch(`${DS}${ep}`, { method: 'POST' }).finally(() => setTimeout(() => setRunning(null), 8000));
    onRun(ep);
  };

  const sigs = ic?.signals ?? {};
  const retire = ic?.retire_alerts ?? [];
  const regimes = wf?.regime_summary ?? {};

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>

      {/* Signal lifecycle */}
      <Card title="L2-5 · SIGNAL LIBRARY · REGIME IC" w={400} accent="#3ae87a">
        <div style={{ display: 'flex', gap: 10, marginBottom: 6, alignItems: 'flex-end' }}>
          {[
            { l: 'RETIRE', n: retire.length,              c: C.RETIRE,  tl: 'red'    },
            { l: 'SLOW',   n: ic?.slow?.length ?? 0,      c: C.SLOW,    tl: 'yellow' },
            { l: 'WATCH',  n: ic?.watch?.length ?? 0,     c: C.WATCH,   tl: 'yellow' },
            { l: 'HEALTHY',n: ic?.healthy?.length ?? 0,   c: C.HEALTHY, tl: 'green'  },
          ].map(b => (
            <div key={b.l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <TLight state={b.tl as any} />
              <div style={{ fontSize: 16, fontWeight: 700, color: b.c, fontFamily: 'monospace', lineHeight: 1 }}>{b.n}</div>
              <div style={{ fontSize: 7, color: C.muted, letterSpacing: 1 }}>{b.l}</div>
            </div>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            <HealthBar
              retire={retire.length}
              slow={ic?.slow?.length ?? 0}
              watch={ic?.watch?.length ?? 0}
              healthy={ic?.healthy?.length ?? 0}
              w={140}
            />
            <ActionBtn label="▶ IC RUN" onClick={() => run('/v1/ic/run/')} running={running === '/v1/ic/run/'} />
          </div>
        </div>
        <div style={{ fontSize: 7.5, color: C.muted, marginBottom: 4 }}>
          ● state · sig · regime · bar · IC · sparkline (14-day windows)
        </div>
        <div style={{ maxHeight: 152, overflowY: 'auto' }}>
          {Object.entries(sigs).map(([sig, info]: [string, any]) => (
            <SignalBar key={sig} sig={sig} info={info} />
          ))}
        </div>
      </Card>

      {/* Regime IC matrix from walk-forward */}
      <Card title="WALK-FORWARD · 41 FOLDS · REGIME BREAKDOWN" w={290} accent="#3ae87a">
        {wf ? (
          <>
            {/* OOS Sharpe summary + sparkline of fold Sharpes */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', lineHeight: 1,
                  color: (wf.summary?.oos_sharpe?.mean ?? 0) > 5 ? C.HEALTHY : (wf.summary?.oos_sharpe?.mean ?? 0) > 0 ? C.PADAWAN : C.RETIRE }}>
                  {(wf.summary?.oos_sharpe?.mean ?? 0).toFixed(2)}
                </div>
                <div style={{ fontSize: 7, color: C.dim, letterSpacing: 1 }}>OOS SHARPE</div>
              </div>
              <Sparkline
                data={(wf.folds ?? []).map((f: any) => f.oos_sharpe ?? 0)}
                w={90} h={28} fill={true}
              />
              <div style={{ marginLeft: 'auto' }}>
                <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: C.text, lineHeight: 1 }}>
                  {((wf.summary?.oos_sharpe?.pct_positive ?? 0) * 100).toFixed(0)}%
                </div>
                <div style={{ fontSize: 7, color: C.dim }}>pos folds</div>
              </div>
            </div>
            <Row k="IS Sharpe mean"  v={(wf.summary?.is_sharpe?.mean ?? 0).toFixed(3)} />
            <Row k="IS/OOS ratio"   v={((wf.summary?.is_sharpe?.mean ?? 0) / Math.max(Math.abs(wf.summary?.oos_sharpe?.mean ?? 1), 0.01)).toFixed(2)} vc={C.WATCH} />
            <div style={{ borderTop: `1px solid ${C.border}`, margin: '6px 0' }} />
            {['TRENDING', 'BREAKOUT', 'RANGING', 'RISK-OFF', 'MIXED'].map(r => {
              const rv = regimes[r] ?? {};
              const sh = rv.mean_sharpe ?? 0;
              const pp = (rv.pct_positive ?? 0) * 100;
              const c  = sh > 5 ? C.HEALTHY : sh > 0 ? C.PADAWAN : sh > -8 ? C.WATCH : C.RETIRE;
              const barW = Math.min(70, Math.abs(sh) * 3.5);
              return (
                <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                  <span style={{ width: 52, fontSize: 8, color: (C as any)[r] ?? C.muted }}>{r}</span>
                  <div style={{ width: 70, height: 4, background: C.border, borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
                    <div style={{ width: barW, height: '100%', background: c, borderRadius: 2, transition: 'width 0.4s' }} />
                  </div>
                  <span style={{ fontSize: 8, color: c, fontFamily: 'monospace', minWidth: 36 }}>
                    {sh > 0 ? '+' : ''}{sh.toFixed(1)}
                  </span>
                  <span style={{ fontSize: 7, color: C.dim }}>{pp.toFixed(0)}%</span>
                </div>
              );
            })}
            <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
              <ActionBtn label="▶ WF RUN ~40s" onClick={() => run('/v1/walkforward/run/')} running={running === '/v1/walkforward/run/'} />
            </div>
          </>
        ) : <span style={{ fontSize: 9, color: C.dim }}>loading…</span>}
      </Card>

      {/* Regime routing matrix */}
      <Card title="REGIME ROUTING MATRIX · SOFT_REGIME_MULT" w={300} accent="#3ae87a">
        <div style={{ fontSize: 8, color: C.dim, marginBottom: 6 }}>
          1.5× specialist · 1.0× neutral · 0.05× wrong regime · BREAKOUT fix applied
        </div>
        {[
          { sig: 'SUPERTREND',  T: '1.5', B: '1.5✓', R: '0.05', O: '0.05', note: 'BREAKOUT IC +0.025' },
          { sig: 'SQZPOP',      T: '0.3', B: '1.5✓', R: '0.05', O: '0.1',  note: 'master BREAKOUT' },
          { sig: 'VOL_BO',      T: '1.2', B: '1.5✓', R: '0.1',  O: '0.1',  note: '' },
          { sig: 'MACD_CROSS',  T: '1.5', B: '0.05', R: '0.05', O: '0.1',  note: 'TRENDING-only' },
          { sig: 'PULLBACK',    T: '1.5', B: '0.05', R: '0.1',  O: '0.1',  note: 'TRENDING-only' },
          { sig: 'RSI_STRONG',  T: '0.1', B: '0.1',  R: '1.5',  O: '1.5',  note: 'RANGING' },
          { sig: 'ADX_TREND',   T: '1.5', B: '0.05', R: '0.3',  O: '0.3',  note: 'ALIVE globally' },
          { sig: 'GOLDEN',      T: '1.2', B: '0.05', R: '0.3',  O: '1.5',  note: 'RISK-OFF alive' },
        ].map(r => (
          <div key={r.sig} style={{ display: 'flex', gap: 5, marginBottom: 2, alignItems: 'center' }}>
            <span style={{ width: 84, fontSize: 8, color: C.text, fontFamily: 'monospace' }}>{r.sig}</span>
            {[['T', r.T, C.TRENDING], ['B', r.B, C.BREAKOUT], ['R', r.R, C.Ranging as any], ['O', r.O, C['RISK-OFF']]].map(([k, v, c]) => (
              <span key={k as string} style={{ width: 32, fontSize: 7, color: v === '0.05' || v === '0.1' ? C.dim : c as string, fontFamily: 'monospace', textAlign: 'right' }}>
                {k}:{v}
              </span>
            ))}
            <span style={{ fontSize: 7, color: C.dim }}>{r.note}</span>
          </div>
        ))}
      </Card>

    </div>
  );
}

// ── LAYER 8-11: ROUTING tab ─────────────────────────────────────────────
function RoutingTab({ ens, gate, cross, pca, onRun }: { ens: any; gate: any; cross: any; pca: any; onRun: (ep: string) => void }) {
  const [running, setRunning]   = useState<string | null>(null);
  const [session, setSession]   = useState<any>(null);
  const [drData,  setDrData]    = useState<any>(null);

  useEffect(() => {
    const load = () => {
      fetch(`${DS}/v1/session/`).then(r => r.ok ? r.json() : null).then(d => { if (d) setSession(d); }).catch(() => {});
      fetch(`${DS}/v1/dr/scan/`).then(r => r.ok ? r.json() : null).then(d => { if (d) setDrData(d); }).catch(() => {});
    };
    load();
    const id = setInterval(load, 120_000);
    return () => clearInterval(id);
  }, []);

  const run = (ep: string) => {
    setRunning(ep);
    fetch(`${DS}${ep}`, { method: 'POST' }).finally(() => setTimeout(() => setRunning(null), 30_000));
    onRun(ep);
  };

  const eq   = ens?.equal_weight ?? {};
  const sw   = ens?.sharpe_weighted ?? {};
  const hard = ens?.hard_routed ?? {};
  const soft = ens?.soft_routed ?? {};
  const gateStats = gate?.gate_stats ?? gate?.gates ?? {};

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>

      {/* Ensemble routing comparison */}
      <Card title="L8-11 · ENSEMBLE ROUTING · OOS BRANCHES" w={290} accent="#b07aff">
        <div style={{ marginBottom: 6 }}>
          {[
            { l: 'Equal weight',    d: eq,   c: C.muted,    best: false, curveKey: 'equal_equity'    },
            { l: 'Sharpe-weighted', d: sw,   c: C.PADAWAN,  best: false, curveKey: 'sw_equity'       },
            { l: 'Hard routed',     d: hard, c: C.WATCH,    best: false, curveKey: 'hard_equity'     },
            { l: 'SOFT routed ★',  d: soft, c: C.HEALTHY,  best: true,  curveKey: 'soft_equity'     },
          ].map(({ l, d, c, best, curveKey }) => {
            const curve: number[] = (ens as any)?.[curveKey] ?? d.equity_curve ?? [];
            return (
              <div key={l} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                marginBottom: 5, padding: '3px 5px', borderRadius: 3,
                background: best ? '#04140a' : 'transparent',
                border: best ? `1px solid #0d2e18` : 'none',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 8, color: c, marginBottom: 2 }}>{l}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <SharpeNum v={d.sharpe ?? null} />
                    <span style={{ fontSize: 7, color: C.dim }}>n={d.n_trades?.toLocaleString() ?? '—'}</span>
                  </div>
                </div>
                <Sparkline data={curve} w={64} h={20} pos={c} neg={C.RETIRE} fill={best} />
              </div>
            );
          })}
        </div>
        <Row k="Soft routing delta" v={ens?.soft_routing_delta != null ? `${ens.soft_routing_delta > 0 ? '+' : ''}${ens.soft_routing_delta.toFixed(3)}` : '—'} vc={ens?.soft_routing_delta > 0 ? C.HEALTHY : C.RETIRE} />
        <Row k="Bars hard-blocked"  v={ens?.bars_routed_pct != null ? `${ens.bars_routed_pct}%` : '—'} />
        <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
          <ActionBtn label="▶ ENSEMBLE RUN" onClick={() => run('/v1/ai/ensemble/run/')} running={running === '/v1/ai/ensemble/run/'} />
        </div>
      </Card>

      {/* Trade quality gate */}
      <Card title="TRADE QUALITY GATE · 5 VETOS" w={260} accent="#b07aff">
        <div style={{ fontSize: 8, color: C.muted, marginBottom: 5 }}>Any ONE fires → BLOCK entry</div>
        {Object.entries(gateStats).length > 0
          ? Object.entries(gateStats).map(([g, info]: [string, any]) => {
              const d = info.sharpe_delta ?? info.delta ?? 0;
              return (
                <div key={g} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 8, color: C.text }}>{g.replace('HOUR_KILL_', 'H').slice(0, 22)}</span>
                  <span style={{ fontSize: 8, color: d > 0 ? C.HEALTHY : C.RETIRE, fontFamily: 'monospace' }}>
                    {d > 0 ? '+' : ''}{d.toFixed(3)}
                  </span>
                </div>
              );
            })
          : [
              { g: 'HOUR_KILLS      UTC 0,1,3-5,12-13,20-23', d: '+2.571', tr: '44%' },
              { g: 'SQUEEZE_LOCK    squeeze==1',                d: '+0.934', tr: '37%' },
              { g: 'ATR_RANK_LOW    atr < 30th pct',            d: '+0.661', tr: '29%' },
              { g: 'RVOL_EXHAUSTION rvol > 90th pct',           d: '+0.435', tr: '38%' },
              { g: 'LOW_JEDI        |jedi| < 4',                d: '+0.310', tr: '25%' },
            ].map(({ g, d, tr }) => (
              <div key={g} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 7.5, color: C.text }}>{g}</span>
                <span style={{ fontSize: 8, color: C.HEALTHY, fontFamily: 'monospace' }}>{d} <span style={{ color: C.dim }}>{tr}</span></span>
              </div>
            ))
        }
        {gate?.stacked_sharpe != null && (
          <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 5, paddingTop: 5 }}>
            <Row k="Stacked Sharpe" v={gate.stacked_sharpe.toFixed(3)} vc={C.HEALTHY} />
          </div>
        )}
        <div style={{ marginTop: 5, display: 'flex', gap: 4 }}>
          <ActionBtn label="▶ GATE SEARCH ~5min" onClick={() => run('/v1/gate/run/')} running={running === '/v1/gate/run/'} />
        </div>
      </Card>

      {/* ICT Session Gate + OBI */}
      <Card title="ICT SESSION GATE · OBI" w={210} accent="#b07aff">
        {session ? (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 7 }}>
              <TLight state={session.allowed ? 'green' : 'red'} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'Barlow Condensed, sans-serif',
                  color: session.allowed ? C.HEALTHY : C.RETIRE, letterSpacing: 1.5, lineHeight: 1 }}>
                  {session.session_label}
                </div>
                <div style={{ fontSize: 7, color: C.dim }}>{session.utc_time} UTC</div>
              </div>
            </div>
            {/* ICT windows reference */}
            {[
              { l: 'London open',  t: '07:00–09:00', alive: true  },
              { l: 'NY open',      t: '14:00–16:00', alive: true  },
              { l: 'NY cont',      t: '16:00–20:30', alive: true  },
              { l: 'Asia dead',    t: '00:00–06:30', alive: false },
              { l: 'London close', t: '11:00–14:00', alive: false },
              { l: 'NY close',     t: '20:30–24:00', alive: false },
            ].map(w => (
              <div key={w.l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2, alignItems: 'center' }}>
                <span style={{ fontSize: 7.5, color: w.alive ? C.HEALTHY : C.dim }}>{w.alive ? '▶' : '✕'} {w.l}</span>
                <span style={{ fontSize: 7, color: C.muted, fontFamily: 'monospace' }}>{w.t}</span>
              </div>
            ))}
            {/* OBI snapshot */}
            {Object.keys(session.obi ?? {}).length > 0 && (
              <>
                <div style={{ borderTop: `1px solid ${C.border}`, margin: '6px 0' }} />
                <div style={{ fontSize: 7, color: C.dim, marginBottom: 4 }}>OBI HARD GATE</div>
                {Object.entries(session.obi ?? {}).map(([sym, d]: [string, any]) => {
                  const obi = d.obi ?? 0;
                  const lC = obi > 0.15 ? C.HEALTHY : obi < -0.15 ? C.RETIRE : C.muted;
                  const barW = Math.abs(obi) * 80;
                  return (
                    <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                      <span style={{ width: 30, fontSize: 8, color: C.text, fontFamily: 'monospace' }}>{sym}</span>
                      <div style={{ width: 80, height: 4, background: C.border, borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
                        <div style={{ width: barW, height: '100%', background: lC, borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 7.5, color: lC, fontFamily: 'monospace', minWidth: 44 }}>
                        {obi >= 0 ? '+' : ''}{obi.toFixed(3)}
                      </span>
                      <span style={{ fontSize: 7, color: C.dim }}>{d.label?.slice(0,3)}</span>
                    </div>
                  );
                })}
              </>
            )}
          </>
        ) : <span style={{ fontSize: 9, color: C.dim }}>loading…</span>}
      </Card>

      {/* Cumulative Significant Levels */}
      <Card title="SIGNIFICANT LEVELS · PDH/PDL · DR · IDR" w={260} accent="#b07aff">
        <div style={{ fontSize: 7.5, color: C.dim, marginBottom: 5 }}>
          PWH/PWL → PDH/PDL → DR → IDR · stacked = institutional memory
        </div>
        {drData?.levels ? (
          Object.entries(drData.levels).slice(0, 5).map(([sym, lvl]: [string, any]) => {
            const zone  = lvl?.sig_zone ?? 'CLEAR';
            const stack = lvl?.level_stack ?? 0;
            const prox  = lvl?.nearest_sig_pct;
            const ntype = lvl?.nearest_sig_type ?? '';
            const price = lvl?.price;
            const zC    = zone === 'STACKED' ? C.EUPHORIA : zone.startsWith('NEAR_PW') ? C.HEALTHY : zone.startsWith('NEAR_PD') ? C.PADAWAN : zone.startsWith('NEAR_') ? C.PADAWAN : zone === 'IDR_TRAP' ? C.RETIRE : zone === 'DR_EXTEND' ? C.BREAKOUT : C.muted;
            const tl    = zone === 'STACKED' ? 'green' : zone === 'IDR_TRAP' ? 'red' : zone.startsWith('NEAR_') ? 'green' : 'yellow';

            // Price ladder: show levels as dots above/below price
            const allLevels = [
              { k: 'PWH', v: lvl?.pwh, c: '#3aefef' },
              { k: 'PDH', v: lvl?.pdh, c: C.HEALTHY },
              { k: 'DRH', v: lvl?.dr_high, c: C.WATCH },
              { k: 'IDH', v: lvl?.idr_high, c: C.dim },
              { k: 'P',   v: price,  c: C.text, isPrice: true },
              { k: 'IDL', v: lvl?.idr_low, c: C.dim },
              { k: 'DRL', v: lvl?.dr_low, c: C.WATCH },
              { k: 'PDL', v: lvl?.pdl, c: C.RETIRE },
              { k: 'PWL', v: lvl?.pwl, c: '#c084fc' },
            ].filter(lv => lv.v != null);

            return (
              <div key={sym} style={{ marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                  <TLight state={tl as any} />
                  <span style={{ fontSize: 9, color: C.text, fontFamily: 'monospace', fontWeight: 700 }}>{sym}</span>
                  <span style={{ fontSize: 8, color: zC, fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 1 }}>{zone}</span>
                  {stack >= 2 && (
                    <span style={{ fontSize: 7, background: `${C.EUPHORIA}22`, color: C.EUPHORIA, border: `1px solid ${C.EUPHORIA}44`, borderRadius: 2, padding: '0 4px' }}>
                      ×{stack} STACK
                    </span>
                  )}
                  {prox != null && (
                    <span style={{ marginLeft: 'auto', fontSize: 7.5, color: zC, fontFamily: 'monospace' }}>
                      {ntype} {prox.toFixed(2)}%
                    </span>
                  )}
                </div>
                {/* Level ladder */}
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {allLevels.map((lv: any) => (
                    <div key={lv.k} style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                      background: lv.isPrice ? '#0a1420' : `${lv.c}12`,
                      border: `1px solid ${lv.isPrice ? C.text : lv.c}40`,
                      borderRadius: 3, padding: '2px 5px', flexShrink: 0,
                    }}>
                      <span style={{ fontSize: 6.5, color: lv.c, letterSpacing: 0.5 }}>{lv.k}</span>
                      <span style={{ fontSize: 7.5, color: lv.isPrice ? C.text : lv.c, fontFamily: 'monospace' }}>
                        {typeof lv.v === 'number' ? lv.v.toFixed(lv.v > 1000 ? 0 : lv.v > 10 ? 1 : 3) : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <span style={{ fontSize: 9, color: C.dim }}>loading…</span>
        )}
        <div style={{ fontSize: 7, color: C.dim, lineHeight: 1.7, marginTop: 2 }}>
          STACKED ≥2 within ±0.5% → ×1.20 size · IDR_TRAP → block<br />
          PDH/PDL ±0.4% → ×1.08 · PWH/PWL ±0.5% → ×1.12
        </div>
      </Card>

      {/* Cross-asset dims */}
      <Card title="CROSS-ASSET · 5 DIMS" w={220} accent="#b07aff">
        {cross ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: cross.regime === 'RISK_ON' ? C.HEALTHY : cross.regime === 'RISK_OFF' ? C.RETIRE : C.muted, fontFamily: 'monospace' }}>
                {cross.regime ?? '—'}
              </span>
              <span style={{ fontSize: 10, color: C.text, fontFamily: 'monospace' }}>
                {cross.composite != null ? (cross.composite > 0 ? '+' : '') + cross.composite.toFixed(3) : '—'}
              </span>
            </div>
            {Object.entries(cross.dimensions ?? {}).map(([dim, info]: [string, any]) => (
              <div key={dim} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 7.5, color: C.dim }}>{dim.replace('_', ' ')}</span>
                <span style={{ fontSize: 8, color: (info.z_score ?? 0) > 0 ? C.PADAWAN : C.RETIRE, fontFamily: 'monospace' }}>
                  {(info.z_score ?? 0).toFixed(3)}
                </span>
              </div>
            ))}
            <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 5, paddingTop: 5 }}>
              <Row k="RISK_ON  → +20% size" v="" />
              <Row k="RISK_OFF → −30% size" v="" />
              <ActionBtn label="▶ CROSS REFRESH" onClick={() => run('/v1/cross/run/')} running={running === '/v1/cross/run/'} />
            </div>
          </>
        ) : <span style={{ fontSize: 9, color: C.dim }}>loading…</span>}
      </Card>

      {/* PCA summary */}
      <Card title="PCA · REDUNDANCY CHECK" w={220} accent="#b07aff">
        {pca ? (
          <>
            <Row k="True dims (80%)" v={pca.dims_80 ?? '—'} vc={C.HEALTHY} />
            <Row k="True dims (90%)" v={pca.dims_90 ?? '—'} />
            <Row k="True dims (95%)" v={pca.dims_95 ?? '—'} />
            <Row k="N signals"       v={pca.n_signals ?? '—'} />
            <Row k="Verdict"         v={pca.interpretation ?? '—'} vc={C.WATCH} mono={false} />
            <div style={{ borderTop: `1px solid ${C.border}`, margin: '5px 0' }} />
            <div style={{ fontSize: 8, color: C.dim, marginBottom: 4 }}>HIGH CORR PAIRS (>0.9 = same signal)</div>
            {(pca.high_corr_pairs ?? []).slice(0, 5).map((p: any) => (
              <div key={`${p.a}-${p.b}`} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 7.5, color: C.RETIRE }}>{p.a} ↔ {p.b}</span>
                <span style={{ fontSize: 7.5, color: C.WATCH, fontFamily: 'monospace' }}>{p.corr.toFixed(3)}</span>
              </div>
            ))}
          </>
        ) : (
          <div>
            <Row k="True dims (80%)" v="9" vc={C.HEALTHY} />
            <Row k="High-corr pairs" v="47 (>0.6)" vc={C.WATCH} />
            <div style={{ fontSize: 7.5, color: C.RETIRE, marginTop: 5 }}>
              VOL_BO ↔ VOL_SURGE: 0.991 KILL<br/>
              KC_BREAK ↔ VOL_BO: 0.966 KILL<br/>
              EMA_STACK ↔ VOL_BO: 0.944 KILL
            </div>
          </div>
        )}
      </Card>

    </div>
  );
}

// ── LAYER 13: OPS tab ────────────────────────────────────────────────────
function EuphoriaTrigger({ pending }: { pending: any[] }) {
  const best = pending.reduce((b: any, s: any) => !b || (s.soft_score ?? 0) > (b.soft_score ?? 0) ? s : b, null);
  if (!best) return <div style={{ fontSize: 8, color: C.dim }}>no symbols scored yet</div>;

  const checks = [
    { l: '|jedi_raw| ≥ 18', ok: Math.abs(best.jedi_raw ?? 0) >= 18, v: Math.abs(best.jedi_raw ?? 0).toFixed(0) },
    { l: 'soft_score ≥ 0.50', ok: (best.soft_score ?? 0) >= 0.50, v: (best.soft_score ?? 0).toFixed(3) },
    { l: 'gates all clear',   ok: best.gates_pass ?? false, v: best.gates_pass ? 'YES' : 'NO' },
    { l: 'MRT mid/high vol',  ok: (best.mrt_vol_label ?? 'mid_vol') !== 'low_vol', v: best.mrt_vol_label ?? '—' },
  ];
  const allFire = checks.every(c => c.ok);

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: allFire ? C.EUPHORIA : C.muted, fontFamily: 'monospace' }}>
          {best.symbol}
        </span>
        {allFire && <Pill label="EUPHORIA ELIGIBLE" col={C.EUPHORIA} />}
      </div>
      {checks.map(ck => (
        <div key={ck.l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ fontSize: 8, color: ck.ok ? C.HEALTHY : C.RETIRE }}>
            {ck.ok ? '✓' : '✗'} {ck.l}
          </span>
          <span style={{ fontSize: 8, color: ck.ok ? C.HEALTHY : C.muted, fontFamily: 'monospace' }}>{ck.v}</span>
        </div>
      ))}
    </div>
  );
}

function OpsTab({ pending, onRun }: { pending: any[]; onRun: (ep: string) => void }) {
  const [runMode, setRunMode] = useState('PADAWAN');
  const [running, setRunning] = useState<string | null>(null);
  const run = (ep: string, method = 'POST') => {
    setRunning(ep);
    fetch(`${DS}${ep}`, { method }).finally(() => setTimeout(() => setRunning(null), 20_000));
    onRun(ep);
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>

      {/* Mode configs */}
      <Card title="L13 · MODE CONFIGS · PERFORMANCE" w={340} accent="#ffcc3a">
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 8, color: C.dim, marginRight: 4 }}>RUN MODE:</span>
          {(['PADAWAN', 'NORMAL', 'EUPHORIA', 'MAX'] as const).map(m => (
            <button key={m} onClick={() => setRunMode(m)} style={{
              background: runMode === m ? '#0a1a2e' : 'none',
              border: `1px solid ${runMode === m ? (C as any)[m] : C.border}`,
              color: runMode === m ? (C as any)[m] : C.muted,
              fontSize: 7, padding: '1px 5px', cursor: 'pointer',
              fontFamily: 'Barlow Condensed, sans-serif', borderRadius: 2,
            }}>{m}</button>
          ))}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 8 }}>
          <thead>
            <tr>
              {['MODE', 'KELLY', 'LOTS', 'ENTRY', 'CIS', 'JEDI', 'SHARPE', 'WR'].map(h => (
                <th key={h} style={{ textAlign: 'right', color: C.dim, paddingBottom: 4, fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { m: 'PADAWAN',  k: '0.25×', l: '1.5', e: '0.35', c: '2/5', j: '±4',  sh: '11.187', wr: '52.2%' },
              { m: 'NORMAL',   k: '1.0×',  l: '3.0', e: '0.35', c: '2/5', j: '±4',  sh: '11.188', wr: '52.2%' },
              { m: 'EUPHORIA', k: '2.5×',  l: '3.0', e: '0.50', c: '3/5', j: '±8',  sh: '19.833', wr: '62.4%' },
              { m: 'MAX',      k: '4.0×',  l: '4.0', e: '0.55', c: '2/5', j: '±10', sh: 'TBD',    wr: 'TBD' },
            ].map(r => (
              <tr key={r.m} style={{ background: runMode === r.m ? '#0a1420' : 'transparent' }}>
                {[r.m, r.k, r.l, r.e, r.c, r.j, r.sh, r.wr].map((v, i) => (
                  <td key={i} style={{
                    textAlign: 'right', padding: '2px 3px',
                    color: i === 0 ? (C as any)[r.m] : i === 6 ? (parseFloat(r.sh) > 15 ? C.EUPHORIA : C.PADAWAN) : C.text,
                    fontFamily: i > 0 ? 'monospace' : 'Barlow Condensed, sans-serif',
                    fontSize: i === 0 ? 9 : 8,
                  }}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 5 }}>
          <Row k="Re-entry (retest=confirm)" v="29.716 Sharpe · 87 trades" vc={C.HEALTHY} />
          <Row k="CIS exit law"              v="2+ invalidation signals → EXIT" vc={C.muted} mono={false} />
          <div style={{ marginTop: 5, display: 'flex', gap: 4 }}>
            <ActionBtn label={`▶ DELTA OPS ${runMode}`} onClick={() => run(`/v1/delta/run/?mode=${runMode}`)} running={running?.startsWith('/v1/delta/')} />
          </div>
        </div>
      </Card>

      {/* EUPHORIA trigger checklist */}
      <Card title="EUPHORIA TRIGGER · ALL MUST FIRE" w={220} accent="#ffcc3a">
        <EuphoriaTrigger pending={pending} />
        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 5, fontSize: 7.5, color: C.dim, lineHeight: 1.6 }}>
          jedi ≥ ±18 · RVOL &gt; 2.0 · Activity HOT<br />
          Cross-asset RISK_ON · score ≥ 0.50<br />
          All 5 gates clear<br />
          → 2-3× Kelly · CIS threshold = 3
        </div>
      </Card>

      {/* CIS signals reference */}
      <Card title="CIS · COMBINED INVALIDATION SCORE" w={300} accent="#ffcc3a">
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 8, color: C.PADAWAN, marginBottom: 5 }}>PADAWAN / NORMAL (2/5)</div>
            {[
              { n: '1. REGIME_DEGRADE', d: '+1.121', tr: '3.7%',  c: C.HEALTHY },
              { n: '2. JEDI_FADE',      d: '+0.486', tr: '9.5%',  c: C.HEALTHY },
              { n: '3. SCORE_DECAY',    d: '—',      tr: '',       c: C.WATCH },
              { n: '4. ATR_COLLAPSE',   d: '—',      tr: '',       c: C.WATCH },
              { n: '5. SQUEEZE_FIRED',  d: '—',      tr: '',       c: C.WATCH },
            ].map(r => (
              <div key={r.n} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 7.5, color: r.c }}>{r.n}</span>
                <span style={{ fontSize: 7.5, color: C.HEALTHY, fontFamily: 'monospace' }}>{r.d} <span style={{ color: C.dim }}>{r.tr}</span></span>
              </div>
            ))}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 8, color: C.EUPHORIA, marginBottom: 5 }}>EUPHORIA (3/5)</div>
            {[
              { n: '1. REGIME_FLIP',    c: C.WATCH },
              { n: '2. JEDI_REVERSAL',  c: C.WATCH },
              { n: '3. SCORE_DECAY',    c: C.WATCH },
              { n: '4. ATR_COLLAPSE',   c: C.WATCH },
              { n: '5. SQUEEZE_FIRED',  c: C.WATCH },
            ].map(r => (
              <div key={r.n} style={{ marginBottom: 2 }}>
                <span style={{ fontSize: 7.5, color: r.c }}>{r.n}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 5 }}>
          <div style={{ fontSize: 8, color: C.dim, marginBottom: 4 }}>EXIT OPTIMIZER (low trigger &gt; high delta law)</div>
          <Row k="regime_degrade" v="+1.121 delta · 3.7% trig" vc={C.HEALTHY} />
          <Row k="jedi_fade"      v="+0.486 delta · 9.5% trig" vc={C.HEALTHY} />
          <Row k="tape_decel"     v="−4.837 (91% fires = noise)" vc={C.RETIRE} />
        </div>
      </Card>

      {/* HALO fingerprint */}
      <Card title="HALO · STEALTH EXECUTION" w={200} accent="#3aefef">
        <div style={{ fontSize: 8, color: C.dim, marginBottom: 6, lineHeight: 1.6 }}>
          1. Timing jitter: 0–3 bars<br />
          2. Size noise: ±15% Kelly<br />
          3. Skip rate: 15% valid signals<br />
          4. Split entry: 55–65% first lot<br />
          5. Scale variance: 0.3–0.7 lot<br />
          6. Exit stagger: 1–2 bars large pos
        </div>
        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 4, paddingTop: 5 }}>
          <div style={{ fontSize: 7.5, color: C.EUPHORIA, marginBottom: 4 }}>
            ⚠ EUPHORIA: never skip/delay fat pitches
          </div>
          <Row k="Fingerprint score" v="gap_cv + size_cv + hour_entropy" mono={false} />
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <Pill label=">60 SAFE" col={C.HEALTHY} />
            <Pill label="35-60 WARN" col={C.WATCH} />
            <Pill label="<35 DANGER" col={C.RETIRE} />
          </div>
        </div>
      </Card>

    </div>
  );
}

// ── LIVE BROKER tab ─────────────────────────────────────────────────────
function BrokerTab({ ibkr, onRun }: { ibkr: any; onRun: (ep: string) => void }) {
  const [runMode,  setRunMode]  = useState('PADAWAN');
  const [runAsset, setRunAsset] = useState('FUTURES');
  const [running,  setRunning]  = useState<string | null>(null);
  const [dryRun,   setDryRun]   = useState(true);
  const [lastResult, setLastResult] = useState<any>(null);

  const run = (ep: string) => {
    setRunning(ep);
    fetch(`${DS}${ep}`, { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setLastResult(d); })
      .finally(() => setTimeout(() => setRunning(null), 30_000));
    onRun(ep);
  };

  const connected = ibkr?.connected ?? false;
  const equity    = ibkr?.account?.NetLiquidation ?? ibkr?.equity ?? null;
  const positions = ibkr?.open_positions ?? [];
  const trades    = ibkr?.recent_trades ?? [];

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>

      {/* IBKR status */}
      <Card title="IBKR · TWS LIVE CONNECTION" w={250} accent={connected ? C.HEALTHY : C.RETIRE}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <TLight state={connected ? 'green' : 'red'} />
          <span style={{ fontSize: 14, fontWeight: 700, color: connected ? C.HEALTHY : C.RETIRE, fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 2 }}>
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
          {equity != null && (
            <span style={{ fontSize: 10, color: C.PADAWAN, fontFamily: 'monospace', marginLeft: 'auto' }}>
              ${Number(equity).toLocaleString()}
            </span>
          )}
        </div>
        {!connected && (
          <div style={{ fontSize: 8, color: C.dim, lineHeight: 1.8, marginBottom: 8, background: '#080f18', borderRadius: 4, padding: '6px 8px' }}>
            TWS Paper → API Settings<br />
            ✓ Enable ActiveX/Socket client<br />
            ✓ Port 7497 (TWS) / 4002 (Gateway)<br />
            ✓ Add 127.0.0.1 to trusted IPs<br />
            <span style={{ color: C.WATCH }}>ENV: IBKR_HOST IBKR_PORT IBKR_CLIENT_ID</span>
          </div>
        )}
        {ibkr?.connection && (
          <>
            <Row k="Host"      v={ibkr.connection.host} />
            <Row k="Port"      v={ibkr.connection.port} />
            <Row k="Client ID" v={ibkr.connection.client_id} />
          </>
        )}
        <ActionBtn label="▶ TEST CONNECTION" onClick={() => run('/v1/ibkr/test/')} running={running === '/v1/ibkr/test/'} />
      </Card>

      {/* Run cycle control */}
      <Card title="IBKR · RUN CYCLE" w={240} accent={C.PADAWAN}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 8, color: C.dim, marginBottom: 4 }}>MODE</div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 8 }}>
            {(['PADAWAN', 'NORMAL', 'EUPHORIA', 'MAX'] as const).map(m => (
              <button key={m} onClick={() => setRunMode(m)} style={{
                background: runMode === m ? '#0a1420' : 'none',
                border: `1px solid ${runMode === m ? (C as any)[m] : C.border}`,
                color: runMode === m ? (C as any)[m] : C.muted,
                fontSize: 7, padding: '1px 5px', cursor: 'pointer',
                fontFamily: 'Barlow Condensed, sans-serif', borderRadius: 2,
              }}>{m}</button>
            ))}
          </div>
          <div style={{ fontSize: 8, color: C.dim, marginBottom: 4 }}>ASSET CLASS</div>
          <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
            {['FUTURES', 'STOCKS', 'CRYPTO'].map(a => (
              <button key={a} onClick={() => setRunAsset(a)} style={{
                background: runAsset === a ? '#0a1420' : 'none',
                border: `1px solid ${runAsset === a ? C.PADAWAN : C.border}`,
                color: runAsset === a ? C.PADAWAN : C.muted,
                fontSize: 7, padding: '1px 5px', cursor: 'pointer',
                fontFamily: 'Barlow Condensed, sans-serif', borderRadius: 2,
              }}>{a}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)}
                style={{ accentColor: C.PADAWAN }} />
              <span style={{ fontSize: 8, color: dryRun ? C.WATCH : C.RETIRE }}>
                {dryRun ? 'DRY RUN (no orders)' : '⚠ LIVE ORDERS'}
              </span>
            </label>
          </div>
          <ActionBtn
            label={`▶ RUN ${runMode} ${runAsset}${dryRun ? ' [DRY]' : ' [LIVE]'}`}
            onClick={() => run(`/v1/ibkr/run/?mode=${runMode}&asset=${runAsset}&dry=${dryRun ? 1 : 0}`)}
            running={running?.startsWith('/v1/ibkr/run/')}
          />
        </div>
        {lastResult && (
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 5 }}>
            <Row k="Entries"  v={lastResult.entries?.length ?? 0} vc={C.HEALTHY} />
            <Row k="Exits"    v={lastResult.exits?.length ?? 0}   vc={C.WATCH} />
            <Row k="Skips"    v={lastResult.skips?.length ?? 0}   vc={C.dim} />
            <Row k="Errors"   v={lastResult.errors?.length ?? 0}  vc={lastResult.errors?.length ? C.RETIRE : C.dim} />
          </div>
        )}
      </Card>

      {/* Open positions */}
      <Card title="POSITIONS · IBKR TWS" w={220} accent={C.PADAWAN}>
        {positions.length > 0
          ? positions.map((p: any) => (
              <div key={p.symbol} style={{
                display: 'flex', justifyContent: 'space-between',
                marginBottom: 5, padding: '3px 6px', borderRadius: 3,
                background: p.qty > 0 ? '#04140a' : '#14040a',
                border: `1px solid ${p.qty > 0 ? '#0d2e18' : '#2e0d0d'}`,
              }}>
                <span style={{ fontSize: 9, color: C.text, fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 1 }}>{p.symbol}</span>
                <span style={{ fontSize: 8, color: C.dim }}>{p.asset}</span>
                <span style={{ fontSize: 9, color: p.qty > 0 ? C.HEALTHY : C.RETIRE, fontFamily: 'monospace' }}>
                  {p.qty > 0 ? '+' : ''}{p.qty}
                </span>
                {p.avg_cost > 0 && (
                  <span style={{ fontSize: 8, color: C.dim, fontFamily: 'monospace' }}>
                    @{p.avg_cost.toFixed(2)}
                  </span>
                )}
              </div>
            ))
          : <span style={{ fontSize: 9, color: C.dim }}>no open positions</span>
        }
      </Card>

      {/* Recent trades + P&L sparkline */}
      <Card title="RECENT TRADES · IBKR" w={240} accent={C.PADAWAN}>
        {trades.length > 0 ? (
          <>
            {/* Cumulative P&L sparkline */}
            {(() => {
              const pnls = trades.filter((t: any) => t.pnl_usd != null).map((t: any) => t.pnl_usd as number);
              const cumPnl = pnls.reduce((acc: number[], v) => [...acc, (acc[acc.length - 1] ?? 0) + v], [] as number[]);
              const totalPnl = cumPnl[cumPnl.length - 1] ?? 0;
              return cumPnl.length > 1 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', lineHeight: 1,
                      color: totalPnl >= 0 ? C.HEALTHY : C.RETIRE }}>
                      {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)}
                    </div>
                    <div style={{ fontSize: 7, color: C.dim }}>cum P&L</div>
                  </div>
                  <Sparkline data={cumPnl} w={100} h={24} fill={true} />
                </div>
              ) : null;
            })()}
            {trades.slice(0, 8).map((t: any, i: number) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, alignItems: 'center' }}>
                <span style={{ fontSize: 7.5, color: C.text, width: 44 }}>{t.symbol}</span>
                <span style={{ fontSize: 7.5, color: t.action === 'ENTRY' ? C.HEALTHY : C.WATCH }}>{t.action}</span>
                <span style={{ fontSize: 7.5, color: t.side === 'buy' ? C.HEALTHY : C.RETIRE, fontFamily: 'monospace' }}>{t.side}</span>
                {t.pnl_usd != null && (
                  <span style={{ fontSize: 7.5, color: t.pnl_usd > 0 ? C.HEALTHY : C.RETIRE, fontFamily: 'monospace' }}>
                    {t.pnl_usd > 0 ? '+' : ''}${t.pnl_usd.toFixed(0)}
                  </span>
                )}
              </div>
            ))}
          </>
        ) : <span style={{ fontSize: 9, color: C.dim }}>no trade history</span>}
      </Card>

    </div>
  );
}

// ── Approval chip ────────────────────────────────────────────────────────
function ApprovalChip({ sig, approving, onApprove, onDismiss }: {
  sig: any; approving: boolean; onApprove: () => void; onDismiss: () => void;
}) {
  if (sig.error) return null;
  const ready   = sig.above_threshold;
  const dirC    = sig.entry_dir === 'LONG' ? C.HEALTHY : sig.entry_dir === 'SHORT' ? C.RETIRE : C.muted;
  const borderC = ready ? C.HEALTHY : C.border;
  const mrtC    = sig.mrt_vol_label === 'high_vol' ? C.BREAKOUT : sig.mrt_vol_label === 'low_vol' ? C.muted : C.HEALTHY;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      border: `1px solid ${borderC}`, borderRadius: 5,
      background: ready ? '#04140a' : C.bg2,
      padding: '4px 9px', flexShrink: 0, whiteSpace: 'nowrap',
    }}>
      <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 13, fontWeight: 700, color: '#d0dfec', letterSpacing: 1.5 }}>
        {sig.symbol}
      </span>
      {sig.entry_dir && <Pill label={sig.entry_dir} col={dirC} />}
      <span style={{ fontSize: 8, color: (C as any)[sig.regime] ?? C.muted }}>{sig.regime}</span>
      <span style={{ fontSize: 9, color: sig.jedi_raw >= 0 ? C.HEALTHY : C.RETIRE, fontFamily: 'monospace' }}>
        J{sig.jedi_raw >= 0 ? '+' : ''}{sig.jedi_raw?.toFixed(0)}
      </span>
      <span style={{ fontSize: 9, color: (sig.soft_score ?? 0) >= 0.35 ? C.PADAWAN : C.muted, fontFamily: 'monospace' }}>
        {(sig.soft_score ?? 0).toFixed(2)}
      </span>
      {sig.mrt_vol_label && (
        <span style={{ fontSize: 7.5, color: mrtC }}>
          {sig.mrt_vol_label === 'high_vol' ? '▲' : sig.mrt_vol_label === 'low_vol' ? '▼' : '◆'}
          {(sig.mrt_vol_mult ?? 1).toFixed(1)}×
        </span>
      )}
      {sig.gates_pass
        ? <span style={{ fontSize: 8, color: C.HEALTHY }}>✓</span>
        : <span style={{ fontSize: 8, color: C.WATCH }} title={sig.killed?.join(', ')}>
            ✗ {sig.killed?.[0]?.replace('HOUR_KILL_', 'H')?.slice(0, 8)}
          </span>
      }
      {ready && (
        <button disabled={approving} onClick={onApprove} style={{
          background: approving ? '#0a2a14' : '#0d3018',
          border: `1px solid ${C.HEALTHY}`, color: C.HEALTHY,
          borderRadius: 3, padding: '2px 8px', fontSize: 9,
          cursor: approving ? 'not-allowed' : 'pointer',
          fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 1,
        }}>
          {approving ? '⟳' : '▶ GO'}
        </button>
      )}
      <button onClick={onDismiss} style={{
        background: 'none', border: 'none', color: C.muted, fontSize: 11, cursor: 'pointer', padding: '0 2px',
      }}>✕</button>
    </div>
  );
}


// ── Main TraderPage ─────────────────────────────────────────────────────
export default function TraderPage() {
  const [pending,   setPending]   = useState<any[]>([]);
  const [mode,      setMode]      = useState('PADAWAN');
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState<string | null>(null);
  const [approved,  setApproved]  = useState<string[]>([]);
  const [actData,   setActData]   = useState<any>(null);
  const [fngData,   setFngData]   = useState<any>(null);
  const [crossData, setCrossData] = useState<any>(null);
  const [tick,      setTick]      = useState(0);

  // Brain
  const [tab,       setTab]       = useState<BrainTab>('SIGNALS');
  const [showBrain, setShowBrain] = useState(true);
  const [lastRun,   setLastRun]   = useState<string>('');

  // Brain data
  const [wf,    setWf]    = useState<any>(null);
  const [ic,    setIc]    = useState<any>(null);
  const [gate,  setGate]  = useState<any>(null);
  const [ens,   setEns]   = useState<any>(null);
  const [pca,   setPca]   = useState<any>(null);
  const [ibkr,  setIbkr]  = useState<any>(null);

  const loadBrain = useCallback(() => {
    fetch(`${DS}/v1/walkforward/`).then(r => r.ok ? r.json() : null).then(d => { if (d) setWf(d); }).catch(() => {});
    fetch(`${DS}/v1/ic/report/`).then(r => r.ok ? r.json() : null).then(d => { if (d) setIc(d); }).catch(() => {});
    fetch(`${DS}/v1/gate/report/`).then(r => r.ok ? r.json() : null).then(d => { if (d) setGate(d); }).catch(() => {});
    fetch(`${DS}/v1/ai/ensemble/`).then(r => r.ok ? r.json() : null).then(d => { if (d) setEns(d); }).catch(() => {});
    fetch(`${DS}/v1/ai/pca/`).then(r => r.ok ? r.json() : null).then(d => { if (d) setPca(d); }).catch(() => {});
    fetch(`${DS}/v1/ibkr/test/`).then(r => r.ok ? r.json() : null).then(d => { if (d) setIbkr(d); }).catch(() => {});
    fetch(`${DS}/v1/cross/report/`).then(r => r.ok ? r.json() : null).then(d => { if (d) setCrossData(d); }).catch(() => {});
  }, []);

  useEffect(() => {
    loadBrain();
    const id = setInterval(loadBrain, 120_000);
    return () => clearInterval(id);
  }, [loadBrain]);

  // Pending + activity polls
  useEffect(() => {
    const load = () => {
      fetch(`${DS}/v1/paper/pending/?mode=${mode}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.pending) setPending(d.pending); })
        .catch(() => {});
    };
    load();
    const id = setInterval(() => { load(); setTick(t => t + 1); }, 60_000);
    return () => clearInterval(id);
  }, [mode]);

  useEffect(() => {
    const load = () => {
      fetch(`${DS}/v1/ai/activity/`).then(r => r.ok ? r.json() : null).then(d => { if (d) setActData(d); }).catch(() => {});
      fetch(`${DS}/v1/fng/`).then(r => r.ok ? r.json() : null).then(d => { if (d?.ok) setFngData(d); }).catch(() => {});
    };
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  const handleApprove = (sym: string) => {
    setApproving(sym);
    fetch(`${DS}/v1/paper/approve/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: sym, mode }),
    }).then(() => {
      setApproved(a => [...a, sym]);
      setTimeout(() => setApproving(null), 3000);
    }).catch(() => setApproving(null));
  };

  const [sessionData, setSessionData] = useState<any>(null);
  useEffect(() => {
    const load = () => fetch(`${DS}/v1/session/`).then(r => r.ok ? r.json() : null).then(d => { if (d) setSessionData(d); }).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const active        = pending.filter(s => !s.error && !dismissed.has(s.symbol));
  const approvalCount = active.filter(s => s.above_threshold).length;
  const gate_label    = actData?.gate_label ?? '—';
  const gateC         = gate_label === 'HOT' ? C.BREAKOUT : gate_label === 'ALIVE' ? C.HEALTHY : gate_label === 'SLOW' ? C.muted : C.RETIRE;
  const crossRegime   = crossData?.regime ?? '—';
  const crossC        = crossRegime === 'RISK_ON' ? C.HEALTHY : crossRegime === 'RISK_OFF' ? C.RETIRE : C.muted;
  const fngVal        = fngData?.value ?? null;
  const ibkrConn      = ibkr?.connected ?? false;

  const TABS: BrainTab[] = ['SIGNALS', 'ROUTING', 'OPS', 'BROKER'];
  const TAB_C: Record<BrainTab, string> = {
    SIGNALS: '#3ae87a', ROUTING: '#b07aff', OPS: '#ffcc3a', BROKER: C.PADAWAN,
  };
  const TAB_SUB: Record<BrainTab, string> = {
    SIGNALS: 'L2-5 · sig library · IC monitor · regime routing',
    ROUTING: 'L8-11 · ensemble · gates · cross-asset · PCA',
    OPS:     'L13 · delta ops · HALO · mode configs · EUPHORIA',
    BROKER:  'LIVE · IBKR TWS · positions · run cycle',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bg, overflow: 'hidden' }}>

      {/* ── TOP STRIP ─────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
        borderBottom: `1px solid ${C.border}`, background: C.bg1,
        overflowX: 'auto', flexShrink: 0, minHeight: 38,
      }}>
        <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 11, letterSpacing: 3, color: C.muted, flexShrink: 0 }}>
          TRADER
        </span>
        <div style={{ width: 1, height: 20, background: C.border, flexShrink: 0 }} />

        {/* Status KPIs with traffic lights */}
        {[
          {
            l: 'GATE', v: gate_label, c: gateC,
            tl: gate_label === 'HOT' || gate_label === 'ALIVE' ? 'green' : gate_label === 'SLOW' ? 'yellow' : 'red',
          },
          {
            l: 'CA', v: crossRegime.replace('_', ' '), c: crossC,
            tl: crossRegime === 'RISK_ON' ? 'green' : crossRegime === 'NEUTRAL' ? 'yellow' : crossRegime === '—' ? 'off' : 'red',
          },
          {
            l: 'F&G', v: fngVal ?? '—',
            c: fngVal != null ? (fngVal <= 44 ? C.HEALTHY : fngVal >= 56 ? C.RETIRE : C.muted) : C.muted,
            tl: fngVal == null ? 'off' : fngVal <= 44 ? 'green' : fngVal >= 56 ? 'red' : 'yellow',
          },
          {
            l: 'IBKR', v: ibkrConn ? 'LIVE' : 'OFF', c: ibkrConn ? C.HEALTHY : C.RETIRE,
            tl: ibkrConn ? 'green' : 'red',
          },
          {
            l: 'MRT', v: (crossData as any)?.mrt_vol_label ?? '—', c: C.text,
            tl: 'off' as const,
          },
          {
            l: 'SESSION', v: sessionData?.session_label ?? '—',
            c: sessionData?.allowed ? C.HEALTHY : sessionData ? C.RETIRE : C.dim,
            tl: (sessionData?.allowed ? 'green' : sessionData ? 'red' : 'off') as 'green' | 'red' | 'off',
          },
        ].map(k => (
          <span key={k.l} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <TLight state={k.tl as any} />
            <span style={{ fontSize: 9 }}>
              <span style={{ color: C.dim }}>{k.l} </span>
              <span style={{ color: k.c }}>{k.v}</span>
            </span>
          </span>
        ))}

        <div style={{ width: 1, height: 20, background: C.border, flexShrink: 0 }} />

        {/* Mode selector */}
        {(['PADAWAN', 'NORMAL', 'EUPHORIA', 'MAX'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} style={{
            background: mode === m ? '#0a1a24' : 'none', flexShrink: 0,
            border: `1px solid ${mode === m ? (C as any)[m] : C.border}`,
            color: mode === m ? (C as any)[m] : C.muted,
            fontSize: 8, padding: '1px 6px', cursor: 'pointer', letterSpacing: 1,
            fontFamily: 'Barlow Condensed, sans-serif', borderRadius: 2,
          }}>{m}</button>
        ))}

        <div style={{ width: 1, height: 20, background: C.border, flexShrink: 0 }} />

        {/* Brain tabs */}
        {TABS.map(t => (
          <button key={t} onClick={() => { setTab(t); setShowBrain(true); }} style={{
            background: (showBrain && tab === t) ? '#0a1a24' : 'none',
            border: `1px solid ${(showBrain && tab === t) ? TAB_C[t] : C.border}`,
            color: (showBrain && tab === t) ? TAB_C[t] : C.muted,
            fontSize: 8, padding: '1px 7px', cursor: 'pointer', letterSpacing: 1,
            fontFamily: 'Barlow Condensed, sans-serif', borderRadius: 2, flexShrink: 0,
          }}>{t}</button>
        ))}
        <button onClick={() => setShowBrain(b => !b)} style={{
          background: 'none', border: `1px solid ${C.dim}`, color: C.dim,
          fontSize: 8, padding: '1px 5px', cursor: 'pointer', borderRadius: 2,
          fontFamily: 'Barlow Condensed, sans-serif', flexShrink: 0,
        }}>{showBrain ? '▲' : '▼'}</button>

        <div style={{ width: 1, height: 20, background: C.border, flexShrink: 0 }} />

        {/* Approval badges */}
        {approvalCount > 0 && (
          <span style={{ background: '#0d3018', border: `1px solid ${C.HEALTHY}`, color: C.HEALTHY, fontSize: 9, padding: '1px 7px', borderRadius: 10, flexShrink: 0, letterSpacing: 1 }}>
            {approvalCount} READY
          </span>
        )}
        {approved.length > 0 && (
          <span style={{ fontSize: 9, color: C.HEALTHY, flexShrink: 0 }}>✓ {approved.slice(-3).join(' ')}</span>
        )}

        {/* Signal chips */}
        {active.map(sig => (
          <ApprovalChip
            key={sig.symbol} sig={sig}
            approving={approving === sig.symbol}
            onApprove={() => handleApprove(sig.symbol)}
            onDismiss={() => setDismissed(d => new Set([...d, sig.symbol]))}
          />
        ))}
        {active.length === 0 && (
          <span style={{ fontSize: 9, color: C.dim, letterSpacing: 1 }}>
            scanning {mode}… (60s)
            {lastRun && <span> · last run: {lastRun.split('?')[0].split('/').pop()}</span>}
          </span>
        )}
      </div>

      {/* ── ALGO BRAIN ─────────────────────────────────────────────────────── */}
      {showBrain && (
        <div style={{ flexShrink: 0, background: C.bg1, borderBottom: `1px solid ${C.border}` }}>
          {/* Tab sub-header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 10px', borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 8, fontWeight: 700, color: TAB_C[tab], fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: 2 }}>
              {tab}
            </span>
            <span style={{ fontSize: 7.5, color: C.dim }}>{TAB_SUB[tab]}</span>
            <div style={{ marginLeft: 'auto' }}>
              <ActionBtn label="↺ REFRESH ALL" onClick={() => { loadBrain(); setLastRun('refresh'); }} />
            </div>
          </div>
          {/* Tab content */}
          <div style={{ overflowX: 'auto', padding: '8px 10px' }}>
            {tab === 'SIGNALS' && <SignalsTab ic={ic} wf={wf} onRun={ep => setLastRun(ep)} />}
            {tab === 'ROUTING' && <RoutingTab ens={ens} gate={gate} cross={crossData} pca={pca} onRun={ep => setLastRun(ep)} />}
            {tab === 'OPS'     && <OpsTab pending={active} onRun={ep => setLastRun(ep)} />}
            {tab === 'BROKER'  && <BrokerTab ibkr={ibkr} onRun={ep => setLastRun(ep)} />}
          </div>
        </div>
      )}

      {/* ── 4K MAXCOGVIZ ───────────────────────────────────────────────────── */}
      <div className="viz-center-page viz-center-page--control27"
        style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <MaxCogVizKnights />
      </div>
    </div>
  );
}
