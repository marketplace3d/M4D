import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getAlgoExecBase } from '../lib/serviceHealthUrls';
import { AlgoPulseEKG, type PulseDirection } from '../components/AlgoPulseEKG';
import { fetchBarsForSymbol, type ChartSymbol } from '@pwa/lib/fetchBars';
import { type TimeframePreset } from '@pwa/lib/chartTimeframes';
import {
  ControlRoomIntel,
  type BankTally,
  type RegimeLabel,
} from '../components/ControlRoomIntel';
import {
  algosByTier,
  loadCouncilSpec,
  type CouncilAlgo,
  type CouncilBundle,
} from '../council';
import MaxCogVizControlRoom from '../viz/ControlRoomKnights.jsx';
import SocialAlphaPulse from '../viz/SocialAlphaPulse';
import { PriceOrb, RiskOrb, ConfluenceOrb, VolumeOrb, TVWebhookOrb } from '../viz/MaxCogVizOrbsII';
import MarketTradingViewLive from '../components/MarketTradingViewLive';
import TradingViewEconomicEvents from '../components/TradingViewEconomicEvents';
import TradingViewMarketOverview from '../components/TradingViewMarketOverview';
import TradingViewTopTickerTape from '../components/TradingViewTopTickerTape';

function randVote(): number {
  return [-1, -1, 0, 0, 0, 1, 1][Math.floor(Math.random() * 7)] ?? 0;
}

function computeEnsemble(
  votes: Record<string, number>,
  A: CouncilAlgo[],
  B: CouncilAlgo[],
  C: CouncilAlgo[]
): { sum: number; direction: PulseDirection } {
  const sum =
    (votes.jedi ?? 0) * 6 +
    A.reduce((t, a) => t + (votes[a.id] ?? 0), 0) +
    B.reduce((t, a) => t + (votes[a.id] ?? 0), 0) +
    C.reduce((t, a) => t + (votes[a.id] ?? 0), 0) * 0.5;
  const direction: PulseDirection =
    sum >= 8 ? 'LONG' : sum <= -8 ? 'SHORT' : 'FLAT';
  return { sum, direction };
}

function tallyBank(algos: CouncilAlgo[], votes: Record<string, number>): BankTally {
  let long = 0;
  let short = 0;
  let flat = 0;
  for (const a of algos) {
    const v = votes[a.id] ?? 0;
    if (v === 1) long++;
    else if (v === -1) short++;
    else flat++;
  }
  return { long, short, flat };
}

const LOOP_PHASES = ['IDLE', 'FETCHING', 'COMPARING', 'VAMA', 'WRITING', 'DONE'] as const;
const REGIME_OPTS: RegimeLabel[] = ['LOW_VOL', 'LOW_VOL', 'HIGH_VOL', 'FOMC_FLAT'];

type Props = {
  /** Jump to dedicated #warriors route (full viewport `ControlRoomKnights.jsx`). */
  onOpenWarriors?: () => void;
};

type MiniSeries = {
  symbol: ChartSymbol;
  label: string;
  points: number[];
};

type MultiSeries = {
  symbol: ChartSymbol;
  label: string;
  color: string;
  points: number[];
};

type BgPreset = 'black' | 'dark' | 'navy' | 'transparent';

const BG_SWATCHES: ReadonlyArray<{
  id: BgPreset;
  label: string;
  shell: string;
  panel: string;
  widget: string;
}> = [
  { id: 'black', label: 'Black', shell: '#000000', panel: '#000000', widget: '#000000' },
  { id: 'dark', label: 'Dark', shell: '#05080d', panel: '#0f1217', widget: '#131722' },
  { id: 'navy', label: 'Navy', shell: '#040a12', panel: '#0b1320', widget: '#131722' },
  { id: 'transparent', label: 'Transparent', shell: 'transparent', panel: 'transparent', widget: 'transparent' },
];
function MiniLine({ points, stroke }: { points: number[]; stroke: string }) {
  if (points.length < 2) {
    return <div className="mission-council__mini-empty">NO DATA</div>;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(1e-9, max - min);
  const width = 180;
  const height = 52;
  const path = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - ((v - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
      <polyline fill="none" stroke={stroke} strokeWidth="1.8" points={path} />
    </svg>
  );
}

function MultiLineChart({ series }: { series: MultiSeries[] }) {
  const valid = series.filter((s) => s.points.length > 2);
  if (valid.length === 0) {
    return <div className="mission-council__multi-empty">NO MULTI-LINE DATA</div>;
  }
  const width = 920;
  const height = 240;
  const all = valid.flatMap((s) => s.points);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = Math.max(1e-9, max - min);
  const toPath = (pts: number[]) =>
    pts
      .map((v, i) => {
        const x = (i / (pts.length - 1)) * width;
        const y = height - ((v - min) / span) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
      {[0.2, 0.4, 0.6, 0.8].map((g) => (
        <line key={g} x1={0} x2={width} y1={height * g} y2={height * g} stroke="#163040" strokeWidth="1" />
      ))}
      {valid.map((s) => (
        <polyline key={s.symbol} fill="none" stroke={s.color} strokeWidth="2" points={toPath(s.points)} />
      ))}
    </svg>
  );
}

export default function MissionCouncil({ onOpenWarriors }: Props) {
  const [data, setData] = useState<CouncilBundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [ekgHistory, setEkgHistory] = useState<number[]>([]);
  const [regime, setRegime] = useState<RegimeLabel>('LOW_VOL');
  const [humHz, setHumHz] = useState(550);
  const [loopPhase, setLoopPhase] = useState<string>('IDLE');
  const [drawdown, setDrawdown] = useState(0.85);
  const [marketMini, setMarketMini] = useState<MiniSeries[]>([]);
  const [newsQuery, setNewsQuery] = useState('market');
  const [newsInput, setNewsInput] = useState('market');
  const [newsExpanded, setNewsExpanded] = useState(false);
  const [alertExpanded, setAlertExpanded] = useState(false);
  const [headlineIdx, setHeadlineIdx] = useState(0);
  const [newsItems, setNewsItems] = useState<string[]>([
    'NEWS FEED READY — ENTER A QUERY AND PRESS SEARCH.',
  ]);
  const loopIdx = useRef(0);
  const votesRef = useRef(votes);
  votesRef.current = votes;
  const [execSummary, setExecSummary] = useState<string>(
    'MARKET EXEC · warming up (POST → algo-execution /decision)…',
  );
  const [uiLock, setUiLock] = useState(false);
  const [serverLock, setServerLock] = useState(false);
  const [haltLock, setHaltLock] = useState(false);
  const [lockUpdatedAt, setLockUpdatedAt] = useState<string | null>(null);
  const [lockSource, setLockSource] = useState('—');
  const [activityGate, setActivityGate] = useState('—');
  const [sessionAllowed, setSessionAllowed] = useState<boolean | null>(null);
  const [ibkrLive, setIbkrLive] = useState<boolean | null>(null);
  const [marketMulti, setMarketMulti] = useState<MultiSeries[]>([]);
  const [bgPreset, setBgPreset] = useState<BgPreset>('black');

  useEffect(() => {
    loadCouncilSpec()
      .then((b) => {
        setData(b);
        const v: Record<string, number> = {};
        b.algorithms.forEach((a) => {
          v[a.id] = 0;
        });
        v.jedi = 1;
        setVotes(v);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (!data) return;
    const base = getAlgoExecBase();
    if (!base) {
      setExecSummary(
        'MARKET EXEC · off — set VITE_ALGO_EXEC_DEV=1 in M4D/.env.local (proxy → :9050) or VITE_ALGO_EXEC_URL',
      );
      return;
    }
    let cancelled = false;
    const push = async () => {
      try {
        const r = await fetch(`${base}/decision`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ votes: votesRef.current, symbol: 'SPY' }),
        });
        const j = (await r.json()) as {
          ok?: boolean;
          decision?: { action?: string; reason?: string; exec?: { dryRun?: boolean } };
          error?: string;
        };
        if (cancelled) return;
        if (!r.ok || !j.ok) {
          setExecSummary(
            `MARKET EXEC · ${r.status}${j.error ? ` — ${j.error}` : ' — bad response'}`,
          );
          return;
        }
        const d = j.decision;
        const dry = d?.exec?.dryRun !== false;
        const line = `MARKET EXEC · ${d?.action ?? '?'} · ${dry ? 'DRY-RUN' : 'LIVE'} · ${d?.reason ?? ''}`;
        setExecSummary(line.length > 240 ? `${line.slice(0, 237)}…` : line);
      } catch {
        if (!cancelled) setExecSummary(`MARKET EXEC · unreachable · ${base}`);
      }
    };
    void push();
    const id = window.setInterval(() => void push(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [data]);

  useEffect(() => {
    const loadLock = () => {
      fetch('http://127.0.0.1:8000/v1/control/halt-lock/')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          if (typeof d.ui_lock === 'boolean') setUiLock(d.ui_lock);
          if (typeof d.terminal_lock === 'boolean') setServerLock(d.terminal_lock);
          if (typeof d.halt_lock === 'boolean') setHaltLock(d.halt_lock);
          setLockUpdatedAt(typeof d.updated_at === 'string' ? d.updated_at : null);
          setLockSource(typeof d.updated_source === 'string' ? d.updated_source.toUpperCase() : '—');
        })
        .catch(() => {});
    };
    loadLock();
    const id = window.setInterval(loadLock, 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const loadLiveContext = () => {
      fetch('http://127.0.0.1:8000/v1/ai/activity/')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          setActivityGate(String(d.gate_label ?? '—'));
        })
        .catch(() => {});
      fetch('http://127.0.0.1:8000/v1/session/')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          setSessionAllowed(Boolean(d.allowed));
        })
        .catch(() => {});
      fetch('http://127.0.0.1:8000/v1/ibkr/test/')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          setIbkrLive(Boolean(d.connected));
        })
        .catch(() => {});
    };
    loadLiveContext();
    const id = window.setInterval(loadLiveContext, 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const gnewsKey = (import.meta.env.VITE_GNEWS_API_KEY as string | undefined)?.trim();
    const run = async () => {
      if (!gnewsKey) {
        setNewsItems([
          'NO VITE_GNEWS_API_KEY — USING LOCAL MARKET CONTEXT HEADLINES.',
          'CPI WINDOW WATCH · RATE PATH REPRICING · POLICY HEADLINE RISK.',
          'SECTOR ROTATION: TECH VS ENERGY · VOLUME THRUST CHECK.',
        ]);
        return;
      }
      try {
        const u = new URL('https://gnews.io/api/v4/search');
        u.searchParams.set('q', newsQuery);
        u.searchParams.set('lang', 'en');
        u.searchParams.set('max', '10');
        u.searchParams.set('apikey', gnewsKey);
        const r = await fetch(u.toString());
        if (!r.ok) throw new Error(`gnews ${r.status}`);
        const j = (await r.json()) as { articles?: Array<{ title?: string }> };
        const titles = (j.articles ?? [])
          .map((a) => (a.title ?? '').trim())
          .filter(Boolean)
          .slice(0, 10);
        if (!cancelled) {
          setNewsItems(titles.length ? titles : ['NO HEADLINES RETURNED FOR QUERY.']);
        }
      } catch {
        if (!cancelled) {
          setNewsItems(['NEWS FETCH ERROR — CHECK API KEY / CORS.', 'USING INTERNAL MARKET CONTEXT FALLBACK.']);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [newsQuery]);

  useEffect(() => {
    if (newsItems.length <= 1) return;
    const id = window.setInterval(() => {
      setHeadlineIdx((i) => (i + 1) % newsItems.length);
    }, 4200);
    return () => window.clearInterval(id);
  }, [newsItems]);

  useEffect(() => {
    if (!data) return;
    const t = window.setInterval(() => {
      setPulse((p) => p + 1);
      setVotes((prev) => {
        const next = { ...prev };
        const ids = data.algorithms.map((a) => a.id);
        for (let i = 0; i < 4; i++) {
          const id = ids[Math.floor(Math.random() * ids.length)];
          if (id) next[id] = randVote();
        }
        next.jedi = Math.random() > 0.15 ? 1 : 0;
        return next;
      });

      setHumHz((h) => Math.max(220, Math.min(880, h + (Math.random() - 0.5) * 70)));
      setDrawdown((d) => Math.max(0, Math.min(3.2, d + (Math.random() - 0.52) * 0.18)));

      if (Math.random() < 0.025) {
        setRegime(REGIME_OPTS[Math.floor(Math.random() * REGIME_OPTS.length)]!);
      }

      if (Math.random() < 0.07) {
        loopIdx.current = (loopIdx.current + 1) % LOOP_PHASES.length;
        setLoopPhase(LOOP_PHASES[loopIdx.current]!);
      }
    }, 1100);
    return () => clearInterval(t);
  }, [data]);

  useEffect(() => {
    if (!data || pulse === 0) return;
    const { A, B, C } = algosByTier(data.algorithms);
    const { sum } = computeEnsemble(votes, A, B, C);
    const norm = Math.max(-1, Math.min(1, Math.tanh(sum / 12)));
    setEkgHistory((h) => [...h.slice(-199), norm]);
  }, [pulse, votes, data]);

  useEffect(() => {
    const vitePolygonKey =
      (import.meta.env.VITE_POLYGON_IO_KEY || import.meta.env.VITE_POLYGON_API_KEY) as
        | string
        | undefined;
    const tf: TimeframePreset = '1y1d';
    const targets: { symbol: ChartSymbol; label: string }[] = [
      { symbol: 'ES', label: 'ES' },
      { symbol: 'EURUSD', label: 'EURUSD' },
      { symbol: 'XAU', label: 'XAU' },
      { symbol: 'BTC', label: 'BTC' },
    ];
    let cancelled = false;
    void Promise.all(
      targets.map(async (t) => {
        try {
          const bars = await fetchBarsForSymbol(t.symbol, vitePolygonKey, tf);
          const points = bars.slice(-90).map((b) => b.close);
          return { symbol: t.symbol, label: t.label, points };
        } catch {
          return { symbol: t.symbol, label: t.label, points: [] };
        }
      }),
    ).then((rows) => {
      if (!cancelled) setMarketMini(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const vitePolygonKey =
      (import.meta.env.VITE_POLYGON_IO_KEY || import.meta.env.VITE_POLYGON_API_KEY) as
        | string
        | undefined;
    const tf: TimeframePreset = '1d1m';
    const targets: { symbol: ChartSymbol; label: string; color: string }[] = [
      { symbol: 'SPY', label: 'SPX', color: '#22c55e' },
      { symbol: 'QQQ', label: 'NQ', color: '#38bdf8' },
      { symbol: 'I:NDX', label: 'US100', color: '#a78bfa' },
      { symbol: 'XAU', label: 'XAU', color: '#f59e0b' },
    ];
    let cancelled = false;
    void Promise.all(
      targets.map(async (t) => {
        try {
          const bars = await fetchBarsForSymbol(t.symbol, vitePolygonKey, tf);
          const closes = bars.slice(-140).map((b) => b.close);
          if (closes.length < 2) return { ...t, points: [] };
          const base = closes[0] ?? 1;
          const points = closes.map((c) => ((c - base) / base) * 100);
          return { ...t, points };
        } catch {
          return { ...t, points: [] };
        }
      }),
    ).then((rows) => {
      if (!cancelled) setMarketMulti(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return (
      <div className="mission mission--error">
        <p className="muted">Could not load council spec: {err}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mission">
        <p className="muted">Loading market algos…</p>
      </div>
    );
  }

  const { A, B, C } = algosByTier(data.algorithms);
  const { sum, direction } = computeEnsemble(votes, A, B, C);
  const ekgSamples = ekgHistory.length >= 2 ? ekgHistory : [0, 0];
  const voteAbs =
    [...A, ...B, ...C].reduce((t, a) => t + Math.abs(votes[a.id] ?? 0), 0) / Math.max(1, A.length + B.length + C.length);
  const xSentiment = Math.max(0, Math.min(100, 50 + (sum / 27) * 50));
  const sectorStrength = Math.max(0, Math.min(100, ((tallyBank(C, votes).long - tallyBank(C, votes).short + 9) / 18) * 100));
  const volumeProxy = Math.max(0, Math.min(100, (humHz / 900) * 100));
  const energy = Math.max(0, Math.min(100, voteAbs * 100));
  const accel = Math.max(0, Math.min(100, Math.abs((ekgSamples[ekgSamples.length - 1] ?? 0) - (ekgSamples[ekgSamples.length - 2] ?? 0)) * 300));
  const masterContext = Math.max(0, Math.min(100, (xSentiment * 0.25 + sectorStrength * 0.25 + volumeProxy * 0.2 + energy * 0.2 + accel * 0.1)));

  const ekgTail = ekgSamples.length >= 2 ? ekgSamples.slice(-2) : [0, 0];
  const velocityAccelCouncil = Math.max(
    -1,
    Math.min(1, ((ekgTail[1] ?? 0) - (ekgTail[0] ?? 0)) * 6),
  );
  const councilAlphaTags = ['NEWS', 'MACRO', 'FLOW', 'TECH', 'CATALYST', 'RISK'] as const;
  const councilAlphaItems = newsItems.slice(0, 6).map((text, i) => ({
    text,
    strength: Math.max(0.4, Math.min(0.92, 0.52 + (i % 4) * 0.09)),
    verified: i === 0,
    tag: councilAlphaTags[i % councilAlphaTags.length] ?? 'NEWS',
  }));
  const councilSocialData = {
    direction:
      direction === 'LONG' ? 'bullish' : direction === 'SHORT' ? 'bearish' : 'neutral',
    energy: Math.round(masterContext),
    velocity: Math.max(0, Math.min(1, voteAbs)),
    velocityAccel: velocityAccelCouncil,
    confidence: masterContext / 100,
    sentimentStrength: xSentiment / 100,
    influenceScore: sectorStrength / 100,
    noiseBlocked: Math.max(0, Math.round((1 - voteAbs) * 22)),
    noiseTypes: voteAbs < 0.32 ? ['LOWINFO'] : [],
    rawSignalCount: 72 + pulse,
    cleanSignalCount: 28 + Math.round(voteAbs * 40),
    crossVerified: direction !== 'FLAT' && Math.abs(sum) > 4,
    lastUpdated: new Date().toLocaleTimeString(),
    symbol: 'SPY',
    alphaItems: councilAlphaItems,
  };
  const maAlignedCouncil = direction === 'LONG' || (direction === 'FLAT' && sum >= -2);
  const macroAlignedCouncil = regime !== 'FOMC_FLAT';
  const runGateOpen = (activityGate === 'HOT' || activityGate === 'ALIVE') && sessionAllowed === true && !haltLock;
  const utcHour = new Date().getUTCHours();
  const inAsia = utcHour >= 0 && utcHour < 8;
  const inLondon = utcHour >= 7 && utcHour < 16;
  const inNy = utcHour >= 13 && utcHour < 21;
  const miniPerf = marketMini.map((m) => {
    const first = m.points[0] ?? 0;
    const last = m.points[m.points.length - 1] ?? 0;
    const pct = first > 0 ? ((last - first) / first) * 100 : 0;
    return { ...m, pct };
  });
  const contextEdge = Math.round((masterContext * 0.55) + (Math.abs(sum) * 1.2));
  const executionQuality = Math.max(
    0,
    Math.min(
      100,
      (runGateOpen ? 32 : 8) + (ibkrLive ? 22 : 5) + (sessionAllowed ? 18 : 0) + (100 - Math.min(100, drawdown * 18)) * 0.28,
    ),
  );
  const riskPressure = Math.max(
    0,
    Math.min(100, (drawdown * 24) + (haltLock ? 28 : 0) + (serverLock ? 18 : 0) + (runGateOpen ? 0 : 16)),
  );
  const opportunityPulse = Math.max(0, Math.min(100, Math.abs(sum) * 3 + voteAbs * 45 + accel * 0.35));
  const postureLabel = runGateOpen && opportunityPulse > 62 && riskPressure < 45
    ? 'ATTACK'
    : runGateOpen && opportunityPulse > 40
      ? 'STALK'
      : 'DEFEND';
  const advCount = miniPerf.filter((m) => m.pct > 0).length;
  const decCount = miniPerf.filter((m) => m.pct < 0).length;
  const breadthRatio = decCount === 0 ? advCount : advCount / Math.max(1, decCount);
  const sectorHeat = [
    { k: 'EQUITY IDX', v: miniPerf.filter((m) => m.label === 'ES' || m.label === 'SPX' || m.label === 'NQ' || m.label === 'US100').reduce((t, m) => t + m.pct, 0) },
    { k: 'METALS', v: miniPerf.filter((m) => m.label === 'XAU').reduce((t, m) => t + m.pct, 0) },
    { k: 'CRYPTO', v: miniPerf.filter((m) => m.label === 'BTC').reduce((t, m) => t + m.pct, 0) },
    { k: 'FX', v: miniPerf.filter((m) => m.label === 'EURUSD').reduce((t, m) => t + m.pct, 0) },
  ];
  const macroEvents = [
    { k: 'CPI', t: '2026-05-13T12:30:00Z' },
    { k: 'FOMC', t: '2026-05-06T18:00:00Z' },
    { k: 'NFP', t: '2026-05-01T12:30:00Z' },
  ];
  const nextEvents = macroEvents.map((e) => {
    const now = Date.now();
    const ts = Date.parse(e.t);
    const deltaMs = Math.max(0, ts - now);
    const hh = Math.floor(deltaMs / 3600000);
    const mm = Math.floor((deltaMs % 3600000) / 60000);
    return { ...e, hh, mm, live: deltaMs <= 0 };
  });
  const tapeLatency = Math.max(15, Math.round(28 + Math.abs(sum) * 3 + (runGateOpen ? 0 : 18)));
  const slipProxyBps = Math.max(1, Math.round((drawdown * 2.2) + (runGateOpen ? 2 : 7) + (Math.abs(sum) / 5)));
  const tapeQuality = Math.max(0, Math.min(100, 100 - tapeLatency * 0.7 - slipProxyBps * 2.2));

  const bgTheme = BG_SWATCHES.find((s) => s.id === bgPreset) ?? BG_SWATCHES[0];
  const councilThemeStyle: CSSProperties = {
    ['--mission-bg-shell' as string]: bgTheme.shell,
    ['--mission-bg-panel' as string]: bgTheme.panel,
    ['--mission-bg-widget' as string]: bgTheme.widget,
  };

  return (
    <div className="mission mission--control-room" style={councilThemeStyle}>
      <header className="mission__header">
        <div className="mission-top-k">MARKET</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, color: uiLock ? '#f59e0b' : '#64748b', border: `1px solid ${uiLock ? '#f59e0b66' : '#33415566'}`, borderRadius: 8, padding: '1px 6px' }}>
            UI {uiLock ? 'ON' : 'OFF'}
          </span>
          <span style={{ fontSize: 9, color: serverLock ? '#ef4444' : '#64748b', border: `1px solid ${serverLock ? '#ef444466' : '#33415566'}`, borderRadius: 8, padding: '1px 6px' }}>
            SERVER {serverLock ? 'ON' : 'OFF'}
          </span>
          <span style={{ fontSize: 9, color: haltLock ? '#ef4444' : '#22c55e', border: `1px solid ${haltLock ? '#ef444466' : '#22c55e66'}`, borderRadius: 8, padding: '1px 6px' }}>
            HALT {haltLock ? 'ON' : 'OFF'}
          </span>
          <span style={{ fontSize: 9, color: '#64748b', border: '1px solid #33415566', borderRadius: 8, padding: '1px 6px' }}>
            SRC {lockSource}
          </span>
          <span style={{ fontSize: 9, color: '#64748b' }}>
            {(() => {
              if (!lockUpdatedAt) return 'age —';
              const ms = Date.now() - Date.parse(lockUpdatedAt);
              if (!Number.isFinite(ms) || ms < 0) return 'age —';
              return `age ${Math.floor(ms / 60000)}m`;
            })()}
          </span>
          <div className="mission-council__bg-picker" aria-label="Background palette">
            {BG_SWATCHES.map((sw) => (
              <button
                key={sw.id}
                type="button"
                className={`mission-council__bg-swatch${bgPreset === sw.id ? ' is-active' : ''}`}
                style={{
                  background:
                    sw.id === 'transparent'
                      ? 'linear-gradient(135deg, #7f1d1d 0%, #0f172a 100%)'
                      : sw.shell,
                }}
                onClick={() => setBgPreset(sw.id)}
                title={`${sw.label} backgrounds`}
                aria-label={`${sw.label} backgrounds`}
              />
            ))}
          </div>
        </div>
        <div
          className={`mission__bias mission__bias--${direction.toLowerCase()} ${
            alertExpanded ? 'mission__bias--expanded' : ''
          }`}
        >
          <div className="mission__bias-head">
            <span className="muted">ALERT</span>
            <strong>{direction}</strong>
            <button
              type="button"
              className="mission__bias-toggle"
              onClick={() => setAlertExpanded((v) => !v)}
              aria-expanded={alertExpanded}
            >
              {alertExpanded ? 'COLLAPSE' : 'EXPAND'}
            </button>
          </div>
          {alertExpanded ? (
            <div className="mission__bias-body">
              <span className="muted">Σ≈{sum.toFixed(0)}</span>
              <span className="muted">REGIME {regime}</span>
              <span className="muted">DD {drawdown.toFixed(2)}%</span>
              <span className="muted">LOOP {loopPhase}</span>
              <ControlRoomIntel
                className="mission__bias-intel"
                regime={regime}
                humHz={humHz}
                loopPhase={loopPhase}
                drawdownPct={drawdown}
                bankA={tallyBank(A, votes)}
                bankB={tallyBank(B, votes)}
                bankC={tallyBank(C, votes)}
                tick={pulse}
              />
            </div>
          ) : null}
        </div>
      </header>

      <section className="mission-council__top-orbs" aria-label="Quick market context orbs">
        <div className="mission-council__top-orbs-row">
          <div className="mission-council__top-orb-real">
            <PriceOrb
              candles={ekgSamples.slice(-7).map((v, i, arr) => {
                const prev = i > 0 ? arr[i - 1] ?? v : v;
                const base = 100 + prev * 8;
                return {
                  o: base,
                  h: base + Math.abs(v) * 6 + 1,
                  l: base - Math.abs(v) * 6 - 1,
                  c: 100 + v * 8,
                };
              })}
              vwap={101 + sum * 0.08}
              bid={101 + sum * 0.1 - 0.04}
              ask={101 + sum * 0.1 + 0.04}
              direction={direction}
            />
          </div>
          <div className="mission-council__top-orb-real">
            <RiskOrb
              pnl={Math.round(sum * 24)}
              pnlMax={900}
              drawdown={Math.max(0, Math.min(1, drawdown / 3))}
              maxDrawdown={0.42}
              positionSize={Math.max(0.05, Math.min(1, voteAbs))}
              direction={direction}
            />
          </div>
          <div className="mission-council__top-orb-real">
            <ConfluenceOrb
              bankAScore={Math.max(-1, Math.min(1, (tallyBank(A, votes).long - tallyBank(A, votes).short) / 9))}
              bankBScore={Math.max(-1, Math.min(1, (tallyBank(B, votes).long - tallyBank(B, votes).short) / 9))}
              bankCScore={Math.max(-1, Math.min(1, (tallyBank(C, votes).long - tallyBank(C, votes).short) / 9))}
              kellyFire={Math.abs(sum) >= 10}
              direction={direction}
            />
          </div>
          <div className="mission-council__top-orb-real">
            <VolumeOrb
              delta={Math.max(-1, Math.min(1, sum / 27))}
              cumDelta={Math.max(-1, Math.min(1, (sum + (ekgTail[1] ?? 0) * 8) / 27))}
              absorption={Math.max(0, Math.min(1, energy / 100))}
              tapeSpeed={Math.max(0.2, Math.min(1, humHz / 900))}
              direction={direction}
            />
          </div>
          <div className="mission-council__top-orb-real">
            <TVWebhookOrb
              connected
              lastFiredMs={(pulse % 45) * 1000}
              latencyMs={Math.round(35 + (Math.abs(sum) % 9) * 18)}
              action={direction === 'LONG' ? 'BUY' : direction === 'SHORT' ? 'SELL' : 'IDLE'}
              fireCount={pulse}
            />
          </div>
        </div>
      </section>
      <TradingViewTopTickerTape />

      <MarketTradingViewLive
        widgetBg={bgTheme.widget}
        widgetTransparent={bgPreset === 'transparent'}
      />

      <AlgoPulseEKG samples={ekgSamples} direction={direction} pulseIndex={pulse} />

      <section
        className="mission-council__triple-row"
        aria-label="Top stories, economic calendar, and social pulse"
      >
        <div className="mission-council__triple-grid mission-council__triple-grid--3">
          <section
            className="mission-council__social-alpha mission-council__social-alpha--triple mission-council__triple-social-panel"
            aria-label="Social alpha pulse"
          >
            <div className="mission-council__social-alpha-frame">
              <SocialAlphaPulse
                data={councilSocialData}
                maAligned={maAlignedCouncil}
                macroAligned={macroAlignedCouncil}
                showSignalGates={false}
              />
            </div>
          </section>
          <div className="mission-council__triple-hotlist-panel mission-council__triple-timeline-panel mission-council__triple-hotlist-panel--flush">
            <div className="mission-council__triple-timeline-inner">
              <TradingViewMarketOverview />
            </div>
          </div>
          <div className="mission-council__triple-hotlist-panel mission-council__triple-events-panel mission-council__triple-hotlist-panel--flush">
            <div className="mission-council__triple-events-inner">
              <TradingViewEconomicEvents />
            </div>
          </div>
        </div>
      </section>

      <section className="mission-council__cr27" aria-labelledby="mission-council-cr27-title">
        <div className="mission-council__cr27-head">
          <h2 id="mission-council-cr27-title" className="mission-council__cr27-title">
            PULSE · ON MARKET
          </h2>
          <p className="mission-council__cr27-note muted">
            PULSE MOBILE grid — vote arrows ▲▼■, heat, and bank colours stay{' '}
            <strong>synced</strong> with <a href="#pulse">#pulse</a>.
            {onOpenWarriors ? (
              <>
                {' '}
                <button type="button" className="mission-council__cr27-linkbtn" onClick={onOpenWarriors}>
                  FULL-PAGE PULSE
                </button>
              </>
            ) : null}{' '}
            Layout polish, sparklines, and fused LIVE arrows are next passes.
          </p>
        </div>
        <div className="mission-council__cr27-viewport">
          <MaxCogVizControlRoom useShellSync />
        </div>
      </section>

      <section className="mission-council__ticker" aria-label="News ticker search">
        <form
          className="mission-council__ticker-form"
          onSubmit={(e) => {
            e.preventDefault();
            setNewsQuery(newsInput.trim() || 'market');
            setNewsExpanded(true);
          }}
        >
          <span className="mission-council__ticker-k">NEWS</span>
          <input
            value={newsInput}
            onChange={(e) => setNewsInput(e.target.value)}
            className="mission-council__ticker-input"
            placeholder="search: market / cpi / fed / tech"
            aria-label="News query"
          />
          <button type="submit" className="mission-council__ticker-btn">
            SEARCH
          </button>
          <button
            type="button"
            className="mission-council__ticker-btn"
            onClick={() => setNewsExpanded((v) => !v)}
          >
            {newsExpanded ? 'COLLAPSE' : 'EXPAND'}
          </button>
        </form>

        <div className="mission-council__headline-top">
          <div key={`${headlineIdx}-${newsItems[headlineIdx] ?? ''}`} className="mission-council__headline-fade">
            {newsItems[headlineIdx] ?? 'NO HEADLINES YET.'}
          </div>
        </div>

        <div
          className={
            newsExpanded
              ? 'mission-council__headline-list mission-council__headline-list--open'
              : 'mission-council__headline-list'
          }
        >
          {newsItems.slice(0, 12).map((h, i) => (
            <div key={`${i}-${h}`} className="mission-council__headline-row">
              {h}
            </div>
          ))}
        </div>
      </section>

      <footer className="mission__foot">
        <p>
          EKG strip + intel rail mirror <code>M4D-27-ALGO-MaxCogViz_ControlRoom.jsx</code> — wide layout
          for 4K; PCA / MoE weights can drive the same trace.
        </p>
      </footer>
    </div>
  );
}
