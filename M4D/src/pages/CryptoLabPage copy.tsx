/**
 * CryptoLabPage — Trade Ideas-style live scanner for M4D crypto council signals.
 *
 * Visual pattern: adapted from spec-kit/AI-New-Apps/MarketScanner.tsx
 * Data: polls /crypto/live/ (Django → crypto_lab.sqlite) every 10s
 * Live price ticks: useAlgoWS broadcast from Rust Binance ingest
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAlgoWS } from '../hooks/useAlgoWS';

// ─── Types ────────────────────────────────────────────────────────────────────

type CryptoTab = 'all' | 'entry' | 'intrade' | 'hot';
type SortCol = 'sym' | 'vote' | 'conviction' | 'rvol' | 'pnl' | 'brs' | 'winrate' | 'trades';

interface RecentTrade {
  entry_ts: number;
  exit_ts: number;
  entry_price: number;
  exit_price: number;
  pnl_pct: number;
  exit_reason: string;
  council_vote: number;
}

interface SymbolState {
  symbol: string;
  council_vote: number;
  conviction: number;
  jedi_entry: boolean;
  sim_state: string;
  rvol: number;
  atr_slope: number;
  close: number;
  ts: number | null;
  win_rate: number;
  trades: number;
  boom_rank_score: number;
  total_pnl_pct: number;
  recent_trades: RecentTrade[];
}

interface LivePayload {
  ok: boolean;
  symbols: SymbolState[];
  last_bar_ts: number | null;
  optuna_last_run: number | null;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcEnergy(vote: number, conviction: number, rvol: number): number {
  const s = (vote / 6) * 0.5 + conviction * 0.3 + Math.min(rvol / 5, 1) * 0.2;
  return Math.min(5, Math.max(1, Math.round(s * 5)));
}

function fmtPrice(p: number): string {
  if (p >= 10_000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 100) return p.toFixed(2);
  if (p >= 10) return p.toFixed(3);
  return p.toFixed(4);
}

function fmtTs(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleTimeString();
}

function getUtcClock(): string {
  return new Date().toLocaleTimeString('en-US', { timeZone: 'UTC', hour12: false }) + ' UTC';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LiveDot({ live }: { live: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: live ? '#22c55e' : '#6b7280', marginRight: 6,
      animation: live ? 'pulse 1.4s ease-in-out infinite' : 'none',
    }} />
  );
}

function EnergyBadge({ level }: { level: number }) {
  const map: Record<number, { label: string; bg: string; color: string }> = {
    5: { label: 'EXTREME', bg: '#052e16', color: '#4ade80' },
    4: { label: 'HIGH',    bg: '#14532d', color: '#86efac' },
    3: { label: 'MEDIUM',  bg: '#713f12', color: '#fde68a' },
    2: { label: 'LOW',     bg: '#7c2d12', color: '#fdba74' },
    1: { label: 'WEAK',    bg: '#450a0a', color: '#fca5a5' },
  };
  const m = map[level] ?? map[1];
  return (
    <span style={{
      display: 'inline-block', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 10,
      background: m.bg, color: m.color, fontFamily: "'JetBrains Mono', monospace",
    }}>
      {m.label}
    </span>
  );
}

function SignalBadge({ entry, simState }: { entry: boolean; simState: string }) {
  if (entry) return (
    <span style={{
      display: 'inline-block', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.05em', padding: '2px 8px', borderRadius: 10,
      background: '#052e16', color: '#4ade80', fontFamily: "'JetBrains Mono', monospace",
      animation: 'pulse 1.2s ease-in-out infinite',
    }}>
      ▲ JEDI GO
    </span>
  );
  if (simState === 'IN_TRADE') return (
    <span style={{
      display: 'inline-block', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.05em', padding: '2px 8px', borderRadius: 10,
      background: '#0c1a2e', color: '#60a5fa', fontFamily: "'JetBrains Mono', monospace",
    }}>
      ◈ IN TRADE
    </span>
  );
  return (
    <span style={{
      display: 'inline-block', fontSize: 10, fontWeight: 600,
      padding: '2px 8px', borderRadius: 10,
      background: '#1c1917', color: '#6b7280', fontFamily: "'JetBrains Mono', monospace",
    }}>
      — WATCH
    </span>
  );
}

function CouncilBadge({ vote }: { vote: number }) {
  const color = vote >= 5 ? '#4ade80' : vote >= 4 ? '#86efac' : vote >= 3 ? '#fde68a' : vote >= 2 ? '#fdba74' : '#6b7280';
  const bg    = vote >= 5 ? '#052e16' : vote >= 4 ? '#14532d' : vote >= 3 ? '#713f12' : vote >= 2 ? '#27272a' : '#18181b';
  return (
    <span style={{
      display: 'inline-block', fontSize: 10, fontWeight: 700,
      padding: '2px 8px', borderRadius: 10,
      background: bg, color, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.04em',
    }}>
      {'█'.repeat(Math.max(0, vote))}{'░'.repeat(Math.max(0, 6 - vote))} {vote}/6
    </span>
  );
}

function RvolBar({ rvol }: { rvol: number }) {
  const pct   = Math.min(100, (rvol / 5) * 100);
  const color = rvol >= 3 ? '#22c55e' : rvol >= 2 ? '#f59e0b' : rvol >= 1.5 ? '#f97316' : '#6b7280';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700, minWidth: 40, color }}>
        {rvol.toFixed(1)}×
      </span>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', minWidth: 50 }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: color }} />
      </div>
    </div>
  );
}

function MetricCard({ label, value, accent }: {
  label: string;
  value: string | number;
  accent?: 'green' | 'red' | 'blue' | 'amber';
}) {
  const colors: Record<string, string> = {
    green: '#4ade80', red: '#f87171', blue: '#60a5fa', amber: '#fbbf24',
  };
  return (
    <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 10, padding: '10px 14px' }}>
      <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: accent ? colors[accent] : '#e6edf3' }}>
        {value}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CryptoLabPage() {
  const [data, setData]               = useState<LivePayload | null>(null);
  const [fetchErr, setFetchErr]       = useState('');
  const [selectedSym, setSelectedSym] = useState('BTCUSDT');
  const [activeTab, setActiveTab]     = useState<CryptoTab>('all');
  const [sortCol, setSortCol]         = useState<SortCol>('vote');
  const [sortAsc, setSortAsc]         = useState(false);
  const [clock, setClock]             = useState(getUtcClock());
  const [livePrices, setLivePrices]   = useState<Record<string, number>>({});
  const [filterVote, setFilterVote]   = useState(0);
  const [filterConv, setFilterConv]   = useState(0);
  const pollRef                       = useRef<ReturnType<typeof setInterval> | null>(null);

  // UTC clock
  useEffect(() => {
    const t = setInterval(() => setClock(getUtcClock()), 1000);
    return () => clearInterval(t);
  }, []);

  // Poll Django /crypto/live/ (dev: Vite proxies /crypto → m4d-ds :8050; 503 = Django down)
  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch('/crypto/live/');
      const raw = await res.text();
      let parsed: unknown = null;
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
      }
      if (!res.ok) {
        const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
        const hint = typeof o.hint === 'string' ? o.hint : '';
        const errKey = typeof o.error === 'string' ? o.error : '';
        if (res.status === 503 && (errKey === 'django_unavailable' || hint)) {
          setFetchErr(
            hint ||
              'Django (m4d-ds) is not running. From repo root run: ./go.sh all',
          );
          return;
        }
        const backendErr = typeof o.error === 'string' ? o.error : '';
        setFetchErr(
          backendErr
            ? `HTTP ${res.status}: ${backendErr}`
            : `HTTP ${res.status}${raw && !parsed ? ` — ${raw.slice(0, 160)}` : ''}`,
        );
        return;
      }
      const json = parsed as LivePayload;
      if (!json || typeof json !== 'object') {
        setFetchErr('Invalid JSON from /crypto/live/');
        return;
      }
      setData(json);
      setFetchErr('');
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    fetchLive();
    pollRef.current = setInterval(fetchLive, 10_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchLive]);

  // Live WS price ticks from Rust Binance ingest
  const { lastPayload } = useAlgoWS({ symbol: selectedSym, timeframe: '1m' });
  useEffect(() => {
    if (!lastPayload || lastPayload.type !== 'bar') return;
    // Rust broadcasts all symbols; lastPayload.symbol carries the source symbol
    const sym = (lastPayload as { symbol?: string }).symbol ?? selectedSym;
    setLivePrices(prev => ({ ...prev, [sym]: lastPayload.bar.close }));
  }, [lastPayload, selectedSym]);

  const handleSort = useCallback((col: SortCol) => {
    setSortCol(prev => {
      if (prev === col) setSortAsc(a => !a);
      else setSortAsc(false);
      return col;
    });
  }, []);

  // ── Derived data ───────────────────────────────────────────────────────────

  const symbols = data?.symbols ?? [];

  const filtered = symbols.filter(s => {
    if (s.council_vote < filterVote) return false;
    if (s.conviction < filterConv)   return false;
    if (activeTab === 'entry'   && !s.jedi_entry)               return false;
    if (activeTab === 'intrade' && s.sim_state !== 'IN_TRADE')  return false;
    if (activeTab === 'hot'     && s.council_vote < 3)          return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let av: number, bv: number;
    switch (sortCol) {
      case 'vote':       av = a.council_vote;     bv = b.council_vote;     break;
      case 'conviction': av = a.conviction;        bv = b.conviction;       break;
      case 'rvol':       av = a.rvol;              bv = b.rvol;             break;
      case 'pnl':        av = a.total_pnl_pct;    bv = b.total_pnl_pct;   break;
      case 'brs':        av = a.boom_rank_score;   bv = b.boom_rank_score;  break;
      case 'winrate':    av = a.win_rate;           bv = b.win_rate;         break;
      case 'trades':     av = a.trades;             bv = b.trades;           break;
      default: return a.symbol.localeCompare(b.symbol) * (sortAsc ? 1 : -1);
    }
    return sortAsc ? av - bv : bv - av;
  });

  const allTrades: (RecentTrade & { symbol: string })[] = [];
  for (const s of symbols) {
    for (const t of s.recent_trades) allTrades.push({ ...t, symbol: s.symbol });
  }
  allTrades.sort((a, b) => (b.exit_ts ?? 0) - (a.exit_ts ?? 0));

  const workerLive    = !!(data?.ok && symbols.length > 0);
  const entryCount    = symbols.filter(s => s.jedi_entry).length;
  const inTradeCount  = symbols.filter(s => s.sim_state === 'IN_TRADE').length;
  const totalTrades   = symbols.reduce((s, x) => s + x.trades, 0);
  const totalWins     = symbols.reduce((s, x) => s + Math.round(x.win_rate * x.trades), 0);
  const overallWin    = totalTrades > 0 ? Math.round((totalWins / totalTrades) * 100) + '%' : '—';
  const winAccent     = totalTrades > 0 && totalWins / totalTrades >= 0.5 ? 'green' : 'amber';

  const TABS: { id: CryptoTab; label: string }[] = [
    { id: 'all',     label: 'All symbols' },
    { id: 'entry',   label: '▲ JEDI Entry' },
    { id: 'intrade', label: '◈ In Trade' },
    { id: 'hot',     label: '🔥 Hot (vote ≥ 3)' },
  ];

  const TH: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontSize: 10,
    fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase',
    color: '#6b7280', background: '#0d1117',
    borderBottom: '1px solid #21262d', cursor: 'pointer',
    whiteSpace: 'nowrap', userSelect: 'none',
  };
  const TD: React.CSSProperties = {
    padding: '8px 12px', fontSize: 12,
    borderBottom: '1px solid #161b22', whiteSpace: 'nowrap',
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{
      background: '#010409', color: '#e6edf3', minHeight: '100vh',
      fontFamily: "'IBM Plex Sans', 'Helvetica Neue', sans-serif",
      padding: '16px',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;600;700&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.25} }
        @keyframes goPulse { 0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,0.3)} 70%{box-shadow:0 0 0 6px rgba(34,197,94,0)} }
        .cr-row:hover { background: #0d1117 !important; cursor: pointer; }
        .cr-entry { background: rgba(34,197,94,0.05) !important; animation: goPulse 2s infinite; }
        .cr-intrade { background: rgba(59,130,246,0.05) !important; }
        .sort-th:hover { color: #e6edf3 !important; }
        input { background: #0d1117; color: #e6edf3; border: 1px solid #21262d; border-radius: 6px; padding: 5px 8px; font-size: 12px; font-family: 'IBM Plex Sans', sans-serif; outline: none; width: 100%; }
        input:focus { border-color: #388bfd; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #010409; }
        ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LiveDot live={workerLive} />
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>
            M4D — BTC Scanner
          </span>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 20,
            background: '#0f2027', color: '#22d3ee', fontWeight: 700,
            letterSpacing: '0.05em', border: '1px solid #164e63',
          }}>
            JEDI-00 · 5 ALGOS · BINANCE
          </span>
          {fetchErr && (
            <span style={{ fontSize: 10, color: '#f87171', background: '#450a0a', padding: '2px 8px', borderRadius: 6 }}>
              ⚠ OFFLINE
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {data?.last_bar_ts && (
            <span style={{ fontSize: 10, color: '#6b7280' }}>Last bar: {fmtTs(data.last_bar_ts)}</span>
          )}
          {data?.optuna_last_run && (
            <span style={{ fontSize: 10, color: '#6b7280' }}>Optuna: {fmtTs(data.optuna_last_run)}</span>
          )}
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#6b7280' }}>{clock}</span>
        </div>
      </div>

      {fetchErr && (
        <div style={{
          background: '#1c1208', border: '1px solid #9a3412', borderRadius: 8, padding: '12px 14px', marginBottom: 12,
          fontSize: 12, color: '#fed7aa',
        }}>
          <strong style={{ color: '#fb923c' }}>Backend disconnected.</strong>{' '}
          Crypto Lab needs <strong>Django</strong> for <code style={{ color: '#fdba74' }}>/crypto/live/</code>
          (Vite proxies to <code style={{ color: '#fdba74' }}>127.0.0.1:8050</code>). Then run{' '}
          <code style={{ color: '#fdba74' }}>crypto_worker</code> for live rows — use <code style={{ color: '#fdba74' }}>./go.sh all</code>.
          <div style={{ marginTop: 8, fontSize: 11, color: '#a8a29e' }}>{fetchErr}</div>
        </div>
      )}

      {!workerLive && !fetchErr && (
        <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 11, color: '#6b7280' }}>
          Worker not running. Start: <code style={{ color: '#58a6ff' }}>cd m4d-ds && python crypto_worker.py</code>
          {' '}— accumulates 60 bars before scoring (~60 min)
        </div>
      )}

      {/* Metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8, marginBottom: 14 }}>
        <MetricCard label="Symbols tracked"    value={symbols.length || '—'} />
        <MetricCard label="JEDI Entry signals" value={entryCount || '—'}      accent="green" />
        <MetricCard label="In trade (sim)"     value={inTradeCount || '—'}    accent="blue" />
        <MetricCard label="Overall win rate"   value={overallWin}             accent={winAccent} />
      </div>

      {/* Filters */}
      <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: '#6b7280', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
          Council signal filters
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>Min council vote (0–6)</div>
            <input type="number" min={0} max={6} step={1} value={filterVote}
              onChange={e => setFilterVote(Number(e.target.value) || 0)} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>Min conviction (0–1)</div>
            <input type="number" min={0} max={1} step={0.05} value={filterConv}
              onChange={e => setFilterConv(Number(e.target.value) || 0)} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>Selected symbol</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: '#60a5fa', paddingTop: 6 }}>
              {selectedSym.replace('USDT', '/USDT')} · click row to change
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              fontSize: 11, padding: '5px 14px', borderRadius: 20,
              border: `1px solid ${activeTab === t.id ? '#1f6feb' : '#21262d'}`,
              background: activeTab === t.id ? '#1f6feb22' : 'transparent',
              color: activeTab === t.id ? '#58a6ff' : '#6b7280',
              cursor: 'pointer', fontWeight: 600, letterSpacing: '0.04em',
            }}
          >
            {t.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6b7280' }}>
          {sorted.length} symbol{sorted.length !== 1 ? 's' : ''} · polls /crypto/live/ every 10s
        </span>
      </div>

      {/* Main scanner table */}
      <div style={{ borderRadius: 10, border: '1px solid #21262d', overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                {([
                  ['sym',        'Symbol'],
                  ['price-nd',   'Price (live)'],
                  ['vote',       'Council vote'],
                  ['conviction', 'Conviction'],
                  ['rvol',       'Rel-vol'],
                  ['energy-nd',  'Energy'],
                  ['sig-nd',     'Signal'],
                  ['winrate',    'Win%'],
                  ['pnl',        'Sim P&L'],
                  ['brs',        'BRS'],
                  ['trades',     'Trades'],
                ] as [string, string][]).map(([col, label]) => {
                  const sortable = !col.endsWith('-nd');
                  const active   = sortCol === col;
                  return (
                    <th
                      key={col}
                      className="sort-th"
                      style={{ ...TH, color: active ? '#e6edf3' : '#6b7280' }}
                      onClick={() => sortable && handleSort(col as SortCol)}
                    >
                      {label}{active ? (sortAsc ? ' ↑' : ' ↓') : ''}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map(s => {
                const livePrice  = livePrices[s.symbol] ?? s.close;
                const energy     = calcEnergy(s.council_vote, s.conviction, s.rvol);
                const rowCls     = s.jedi_entry ? 'cr-row cr-entry' : s.sim_state === 'IN_TRADE' ? 'cr-row cr-intrade' : 'cr-row';
                const pnlColor   = s.total_pnl_pct >= 0 ? '#4ade80' : '#f87171';
                const winColor   = s.win_rate >= 0.55 ? '#4ade80' : s.win_rate >= 0.45 ? '#fbbf24' : '#f87171';
                return (
                  <tr
                    key={s.symbol}
                    className={rowCls}
                    style={{ background: 'transparent' }}
                    onClick={() => setSelectedSym(s.symbol)}
                  >
                    <td style={TD}>
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 13,
                        color: s.symbol === selectedSym ? '#60a5fa' : '#e6edf3',
                      }}>
                        {s.symbol.replace('USDT', '')}
                      </span>
                    </td>
                    <td style={{ ...TD, fontFamily: "'JetBrains Mono', monospace" }}>
                      ${fmtPrice(livePrice)}
                    </td>
                    <td style={TD}><CouncilBadge vote={s.council_vote} /></td>
                    <td style={{ ...TD, fontFamily: "'JetBrains Mono', monospace", color: s.conviction >= 0.6 ? '#4ade80' : '#e6edf3' }}>
                      {(s.conviction * 100).toFixed(0)}%
                    </td>
                    <td style={{ ...TD, minWidth: 120 }}><RvolBar rvol={s.rvol} /></td>
                    <td style={TD}><EnergyBadge level={energy} /></td>
                    <td style={TD}><SignalBadge entry={s.jedi_entry} simState={s.sim_state} /></td>
                    <td style={{ ...TD, fontFamily: "'JetBrains Mono', monospace", color: s.trades > 0 ? winColor : '#6b7280' }}>
                      {s.trades > 0 ? (s.win_rate * 100).toFixed(0) + '%' : '—'}
                    </td>
                    <td style={{ ...TD, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: s.trades > 0 ? pnlColor : '#6b7280' }}>
                      {s.trades > 0 ? (s.total_pnl_pct >= 0 ? '+' : '') + s.total_pnl_pct.toFixed(2) + '%' : '—'}
                    </td>
                    <td style={{ ...TD, fontFamily: "'JetBrains Mono', monospace", color: s.boom_rank_score > 0 ? '#4ade80' : s.trades > 0 ? '#f87171' : '#6b7280' }}>
                      {s.trades > 0 ? s.boom_rank_score.toFixed(2) : '—'}
                    </td>
                    <td style={{ ...TD, fontFamily: "'JetBrains Mono', monospace", color: '#94a3b8' }}>
                      {s.trades}
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ ...TD, textAlign: 'center', color: '#6b7280', padding: '32px' }}>
                    {data?.ok === false
                      ? data.error
                      : symbols.length === 0
                        ? 'Waiting for bars… crypto_worker.py needs 60 confirmed 1m bars per symbol (~60 min)'
                        : 'No symbols match current filters'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sim Trade Log */}
      <div style={{ borderRadius: 10, border: '1px solid #21262d', overflow: 'hidden' }}>
        <div style={{
          padding: '10px 14px', background: '#0d1117', borderBottom: '1px solid #21262d',
          fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: '#6b7280',
          textTransform: 'uppercase' as const,
        }}>
          Sim Trade Log · {Math.min(15, allTrades.length)} of {allTrades.length} trades
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
            <thead>
              <tr>
                {['Symbol', 'Entry $', 'Exit $', 'P&L', 'Exit reason', 'Vote', 'Time'].map(h => (
                  <th key={h} style={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allTrades.slice(0, 15).map((t, i) => (
                <tr key={i} className="cr-row" style={{ background: 'transparent' }}>
                  <td style={{ ...TD, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
                    {t.symbol.replace('USDT', '')}
                  </td>
                  <td style={{ ...TD, fontFamily: "'JetBrains Mono', monospace" }}>${fmtPrice(t.entry_price)}</td>
                  <td style={{ ...TD, fontFamily: "'JetBrains Mono', monospace" }}>${fmtPrice(t.exit_price)}</td>
                  <td style={{ ...TD, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: t.pnl_pct >= 0 ? '#4ade80' : '#f87171' }}>
                    {t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct.toFixed(2)}%
                  </td>
                  <td style={{ ...TD, color: '#94a3b8', fontSize: 11 }}>{t.exit_reason}</td>
                  <td style={TD}><CouncilBadge vote={t.council_vote} /></td>
                  <td style={{ ...TD, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#6b7280' }}>
                    {fmtTs(t.exit_ts)}
                  </td>
                </tr>
              ))}
              {allTrades.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ ...TD, textAlign: 'center', color: '#6b7280', padding: '24px' }}>
                    No sim trades yet — worker needs 60+ bars per symbol
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: '#30363d', textAlign: 'center' }}>
        Binance public kline stream · 1m bars · 5 symbols · JEDI-00 council signal · sim P&amp;L only — not financial advice
      </div>
    </div>
  );
}
