/**
 * OraclePlanPage — Master plan visual doc
 * MTF voting · TV Indicator Council · Regime Awareness · Oracle HUD · TradeI · Crypto Live Table
 */
import { useState } from 'react';

const C = {
  bg: '#03050a', bg1: '#070c14', bg2: '#0d1520', border: '#0f2035',
  jedi: '#f59e0b', boom: '#22d3ee', strat: '#818cf8', legend: '#4ade80',
  ict: '#a78bfa', liq: '#f43f5e', exec: '#fb923c', risk: '#fbbf24',
  ds: '#34d399', rust: '#fb923c', paper: '#60a5fa', gold: '#fde68a',
  text: '#94a3b8', textHi: '#e2e8f0', muted: '#1e3a50', red: '#ef4444',
};

type Phase = 'live' | 'build' | 'plan';
const PC: Record<Phase, string> = { live: '#4ade80', build: '#fbbf24', plan: '#475569' };
const dot = (p: Phase) => <span style={{ color: PC[p], fontSize: 9 }}>{p === 'live' ? '●' : p === 'build' ? '◑' : '○'} {p.toUpperCase()}</span>;

// ── MTF System ────────────────────────────────────────────────────────────────
const TF_ROWS = [
  { tf: '15s',  group: 'MICRO',   weight: 0.5,  note: 'Scalp pulse · entry timing only',        phase: 'plan'  as Phase, diff: 'too fast — noise on most setups'  },
  { tf: '1m',   group: 'MICRO',   weight: 1.0,  note: 'Scalp entry · volume confirmation',       phase: 'build' as Phase, diff: 'pairs with 15s for delta ops'      },
  { tf: '5m',   group: 'INTRA',   weight: 2.0,  note: 'Primary entry TF · ICT execution',        phase: 'live'  as Phase, diff: 'CORE — all signals fire here'       },
  { tf: '15m',  group: 'INTRA',   weight: 1.5,  note: 'Structure context · OB/FVG source',       phase: 'live'  as Phase, diff: 'key — ICT 15m OBs are priority'    },
  { tf: '1H',   group: 'SESSION', weight: 2.0,  note: 'Session bias · trend direction',          phase: 'live'  as Phase, diff: 'primary bias TF'                    },
  { tf: '2H',   group: 'SESSION', weight: 1.5,  note: 'Gap between 1H and 4H — fills blind spot',phase: 'build' as Phase, diff: '★ ADD — 1H/4H too different, 2H bridges' },
  { tf: '4H',   group: 'SWING',   weight: 2.0,  note: 'Swing structure · weekly draw proxy',     phase: 'live'  as Phase, diff: 'core swing reference'               },
  { tf: '8H',   group: 'SWING',   weight: 1.5,  note: 'Gap between 4H and D1 — institutional',  phase: 'build' as Phase, diff: '★ ADD — institutional session view'  },
  { tf: '1D',   group: 'MACRO',   weight: 2.0,  note: 'Daily bias · HTF draw to liquidity',      phase: 'live'  as Phase, diff: 'JEDI MTF gate — required'           },
  { tf: '1W',   group: 'MACRO',   weight: 2.5,  note: 'Weekly structure · quarterly targets',    phase: 'live'  as Phase, diff: 'LEGEND C algos — 1-3M horizon'      },
];

const GROUP_COLOR: Record<string, string> = {
  MICRO: C.exec, INTRA: C.boom, SESSION: C.ict, SWING: C.strat, MACRO: C.legend,
};

// ── Regime Sessions ───────────────────────────────────────────────────────────
const SESSIONS = [
  { name: 'ASIA',         hours: '00:00–08:00 UTC', vol: 20, regime: 'LOW VOL · range · accumulation · trap setups',     color: C.strat  },
  { name: 'LONDON OPEN',  hours: '08:00–10:00 UTC', vol: 90, regime: 'HIGH VOL · breakout · institutional entry · FVGs', color: C.boom   },
  { name: 'LONDON MID',   hours: '10:00–12:00 UTC', vol: 70, regime: 'TREND continuation · OB retest · momentum',        color: C.legend },
  { name: 'LUNCH/DOLDRUMS',hours:'12:00–14:00 UTC', vol: 15, regime: '★ SUPPRESS SIGNALS — low conviction · chop',       color: C.muted  },
  { name: 'NY OPEN',      hours: '14:00–16:00 UTC', vol: 95, regime: 'HIGHEST VOL · ICT killzone · primary FX moves',    color: C.gold   },
  { name: 'NY MID',       hours: '16:00–18:00 UTC', vol: 60, regime: 'Trend extension or reversal · news follow-through', color: C.ict    },
  { name: 'NY CLOSE',     hours: '18:00–20:00 UTC', vol: 30, regime: 'Position management · partial exits · compression', color: C.exec   },
  { name: 'DEAD ZONE',    hours: '20:00–00:00 UTC', vol: 5,  regime: '★ SUPPRESS ALL — avoid entries',                   color: C.red    },
];

// ── TV Indicator Council ──────────────────────────────────────────────────────
const TV_INDICATORS = [
  { id: 'SQZ', name: 'SQUEEZE MOMENTUM', author: 'LazyBear/TTM', edge: 'BB inside KC compression → explosive release', impl: 'Python: pandas-ta squeezepro. Live in boomChartBuild.ts.', phase: 'live' as Phase, vote: 'BULL/BEAR/NEUTRAL on histogram cross', priority: 'P0' },
  { id: 'ST',  name: 'SUPERTREND',       author: 'Best variant', edge: 'ATR trailing stop · clean trend filter', impl: 'Python: ta.supertrend(). Add to DS signals.py.', phase: 'build' as Phase, vote: 'BULL when price above band · BEAR below', priority: 'P0' },
  { id: 'LOR', name: 'LORENTZIAN CLASS', author: 'jdehorty',     edge: 'KNN ML classifier · non-Euclidean distance · regime aware', impl: '★ Python only — sklearn KNN. Port Pine math. Key classifier.', phase: 'plan' as Phase, vote: 'BULL/BEAR with confidence 0-1', priority: 'P1' },
  { id: 'QQE', name: 'QQE MOD',          author: 'Mihkel00',     edge: 'Smoothed RSI + ATR bands · no lag', impl: 'Python: custom QQE formula. 2 inputs: RSI period + SF.', phase: 'build' as Phase, vote: 'Cross above upper band = BULL', priority: 'P0' },
  { id: 'QTR', name: 'Q-TREND',          author: 'Various',      edge: 'Quasi-trend oscillator · price channel breakout', impl: 'Python: adaptive channel. Add to DS.', phase: 'plan' as Phase, vote: 'Direction + strength score', priority: 'P1' },
  { id: 'UTB', name: 'UT BOT',           author: 'HPotter',      edge: 'ATR volatility stop + Heikin Ashi smoothing · scalp friendly', impl: 'Python: ATR trail + HA bars. Fast to implement.', phase: 'build' as Phase, vote: 'Signal cross = entry alert', priority: 'P0' },
  { id: 'RSX', name: 'RSX (JURIK RSI)',  author: 'Jurik',        edge: 'Low-lag RSI variant · smoother signal line', impl: 'Python: Jurik MA formula. Good for crypto.', phase: 'plan' as Phase, vote: 'OB/OS levels + divergence', priority: 'P2' },
  { id: 'VFI', name: 'VOLUME FLOW IND',  author: 'markplex',     edge: 'Institutional volume direction · smart money', impl: 'Python: cumulative vol-based indicator. High value.', phase: 'plan' as Phase, vote: 'Bull/bear accumulation score', priority: 'P1' },
];

// ── Oracle HUD weapons ────────────────────────────────────────────────────────
const WEAPONS = [
  { key: 'ASSET',    label: 'ASSET SELECT',  desc: 'Ranked by composite score (JEDI + ICT confluence + TV council vote). Top 3 surfaced.', color: C.boom,   phase: 'build' as Phase },
  { key: 'WEAPON',   label: 'WEAPON',        desc: 'Which algo cluster fired: BOOM (scalp) · STRAT (structure) · LEGEND (swing). Displayed as orb bank.', color: C.strat,  phase: 'live' as Phase },
  { key: 'FIRE',     label: 'FIRE MODE',     desc: 'SCALP (15s-5m) · INTRADAY (15m-1H) · SWING (4H-1W). Locked by regime + session.', color: C.ict,    phase: 'build' as Phase },
  { key: 'KELLY',    label: 'KELLY SIZE',    desc: 'f* = (bp - q) / b. Display as % of account. Hard cap at 1/2 Kelly. Small acc mode: fixed 1%.', color: C.risk,   phase: 'plan' as Phase },
  { key: 'SOUND',    label: 'SOUNDSCAPE',    desc: 'Audio cue on signal: pitch = confidence, tempo = urgency. Slowdown = exit proximity. Spatial audio.', color: C.gold,   phase: 'plan' as Phase },
  { key: 'SCALE',    label: 'AI SCALE',      desc: 'Scale-in on confirmation (2nd entry). Scale-out at 50%/75%/100% targets. AI-managed.', color: C.jedi,   phase: 'plan' as Phase },
  { key: 'DELTA',    label: 'DELTA OPS',     desc: '0+ quick entry on volume spike (small account mode). Volume > 2× avg on 1m → immediate. Auto-size.', color: C.exec,   phase: 'plan' as Phase },
  { key: 'LEGEND',   label: 'LEGEND TIP',    desc: 'Surface early: LEGEND C algos fire 1-3M horizon trades. Shown as banner. Exit levels from ICT weekly draw.', color: C.legend, phase: 'build' as Phase },
];

// ── Implementation audit (Mac / Rust limits) ──────────────────────────────────
const AUDIT = [
  { system: 'RUST ENGINE',   can: ['OHLCV fetch (Binance)', 'TREND/MOM/VOL/ATR scoring', 'algo_day.json output', 'SQLite store', 'Axum API serve'], cannot: ['Lorentzian KNN (Python only)', 'Complex ML inference', 'Pine Script logic', 'Real-time tick data (no paid feed)'] },
  { system: 'PYTHON DS',     can: ['Squeeze/QQE/UT Bot (pandas-ta)', 'Supertrend', 'Backtesting', 'Grid optimizer', 'Lorentzian port (sklearn)'], cannot: ['Sub-second latency', 'Order execution', 'Real-time WS tick feed (no paid)'] },
  { system: 'M6D FRONTEND',  can: ['All chart overlays (LW Chart)', 'ICT rects/OB/FVG', 'Liquidity Thermal heatmap', 'Price Target HUD', 'Orb viz', 'Council matrix'], cannot: ['Data direct from paid feeds (polygon free tier only)', 'Server-side compute'] },
  { system: 'TV / PINE',     can: ['All indicators natively', 'Real-time alerts', 'Webhook out', 'Replay/backtest on chart'], cannot: ['Direct API to M4D without webhook bridge', 'Custom algo scoring', 'WS stream'] },
  { system: 'GOLD (XAUUSD)', can: ['In symbol list (C:XAUUSD)', 'FX chart includes it'], cannot: ['★ NOT IN M3D RUST ENGINE 500-asset list — must add', 'No dedicated page', 'No ICT killzone for London session (key for Gold)'] },
];

// ── Live table concept ────────────────────────────────────────────────────────
const LIVE_TABLES = [
  { name: 'TRADEI — STOCK SCANNER', desc: 'Real-time scanner like TradeIdeas. Columns: asset · score · JEDI · session · vol · momentum · ICT flag. Color bars + sparkline. Sound on new top-3 entry.', color: C.boom, phase: 'plan' as Phase, mvp: 'M6D page reading /v1/algo-day, sorted by COMPOSITE desc, color coded' },
  { name: 'CRYPTO LIVE TABLE',       desc: 'BTC/ETH/SOL/BNB/XRP + alts. Columns: price · 5m change · RVOL · Heatseeker tier · squeeze state · session. 15s refresh. Audio on tier change.', color: C.gold, phase: 'build' as Phase, mvp: 'BtcChartsPage extended — table above chart, sortable, color bars' },
  { name: 'FX LIVE TABLE',           desc: 'Majors + XAUUSD. MTF alignment bar (10 TFs, 5/10 threshold). Session killzone indicator. ICT draw direction. Best setup ranked.', color: C.ict,  phase: 'plan' as Phase, mvp: 'FxChartsPage + table panel, MTF vote bar, session badge' },
  { name: 'MARKET MAP LIVE',         desc: 'Sector heatmap (TV-style). SPX/NDX/DJI regime. Correlation matrix. Session flow direction. Institutional level proximity.', color: C.strat,phase: 'plan' as Phase, mvp: 'New page: MarketMapPage. SVG grid, color by 1D change × volume' },
];

// ── Expert Trader Council ─────────────────────────────────────────────────────
const EXPERT_TRADERS = [
  {
    id: 'LANCE',
    name: 'LANCE BREITSTEIN',
    title: '$100M Market Wizard · Mean Reversion',
    bank: 'LEGEND C',
    bankColor: '#4ade80',
    style: 'Swing mean reversion · 20MA equilibrium · waterfall entries',
    universe: 'S&P 500 large caps · Liquid majors · Low boringness factor',
    entry: '"Right Side of V" — break of prev 1-2m candle HIGH after waterfall',
    stop: 'Low of the waterfall (tip of the V)',
    target: '20MA equilibrium (Bobblehead mean reversion)',
    sizing: 'A+ = HIGH SIZE · A = standard · B = reduced · C = NO TRADE. Apply 20% humility cut.',
    tally: [
      { factor: 'Price/Momentum',   weight: '30%', detail: 'ROC waterfall asymptotic · 3+ SD from 20MA · 3rd/4th leg bonus' },
      { factor: 'Market Structure', weight: '25%', detail: 'RVOL capitulation spike · stop run detection · large cap stable asset' },
      { factor: 'Context/Sentiment',weight: '25%', detail: 'Session bonus (London/NY open) · delta divergence · no-news proxy' },
      { factor: 'Order Flow',       weight: '20%', detail: 'Delta flip positive · absorption signal · right-side armed' },
    ],
    moeLane: 'Signal gate + trade sizing — EV ≥ 80 required to open gate',
    phase: 'build' as Phase,
    priority: 'P0',
  },
  {
    id: 'ANDREA',
    name: 'ANDREA (SCALPER)',
    title: 'World-Class Scalper · Order Flow',
    bank: 'BOOM A',
    bankColor: '#22d3ee',
    style: 'Order flow · Liquidity hunting · Delta divergence scalping',
    universe: 'Any liquid asset · Tick/1m timeframe · Active session only',
    entry: 'Absorption: large vol at level + price stall → reversal. Momentum: bubble spike + level break.',
    stop: 'Beyond the absorption level / bubble origin',
    target: 'Next liquidity level · VWAP · equilibrium',
    sizing: 'Absorption signal → size 1×. Delta divergence + absorption → size 2×.',
    tally: [
      { factor: 'Aggressive Bubbles', weight: '40%', detail: 'Market buy/sell volume radius — proxied by candle range×volume' },
      { factor: 'Passive Liquidity',  weight: '30%', detail: 'Price stall at heavy limit level — absorption detection' },
      { factor: 'Delta',              weight: '20%', detail: 'Aggressive buys - sells · positive delta at low = reversal' },
      { factor: 'VWAP Context',       weight: '10%', detail: 'Fair value baseline · above VWAP = bull bias' },
    ],
    moeLane: 'Entry precision override — fires BOOM A bank in Delta Ops fire mode',
    phase: 'plan' as Phase,
    priority: 'P1',
  },
];

// ── Tabs ──────────────────────────────────────────────────────────────────────
type Tab = 'mtf' | 'regime' | 'tvindicators' | 'expert' | 'oracle' | 'tables' | 'audit';
const TABS: { id: Tab; label: string; color: string }[] = [
  { id: 'mtf',          label: 'MTF VOTING',      color: C.boom   },
  { id: 'regime',       label: 'REGIME/SESSION',  color: C.ict    },
  { id: 'tvindicators', label: 'TV COUNCIL',      color: C.strat  },
  { id: 'expert',       label: 'EXPERT COUNCIL',  color: C.legend },
  { id: 'oracle',       label: 'ORACLE HUD',      color: C.jedi   },
  { id: 'tables',       label: 'LIVE TABLES',     color: C.gold   },
  { id: 'audit',        label: 'IMPL AUDIT',      color: C.risk   },
];

function Chip({ phase }: { phase: Phase }) {
  return (
    <span style={{
      fontSize: 8, padding: '1px 6px', borderRadius: 3,
      background: `${PC[phase]}18`, color: PC[phase],
      border: `1px solid ${PC[phase]}44`, letterSpacing: 1,
    }}>{phase.toUpperCase()}</span>
  );
}

function Card({ children, accent, style }: { children: React.ReactNode; accent?: string; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: C.bg1, border: `1px solid ${C.border}`,
      borderLeft: accent ? `3px solid ${accent}` : undefined,
      borderRadius: 8, padding: '14px 16px', ...style,
    }}>{children}</div>
  );
}

export default function OraclePlanPage() {
  const [tab, setTab] = useState<Tab>('mtf');

  return (
    <div style={{
      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      background: C.bg, minHeight: '100vh', color: C.textHi,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '10px 20px', borderBottom: `1px solid ${C.border}`,
        background: C.bg1, flexShrink: 0,
      }}>
        <span style={{ fontSize: 15, fontWeight: 900, letterSpacing: 2, color: C.jedi }}>ORACLE PLAN</span>
        <span style={{ fontSize: 9, color: C.text }}>MTF · REGIME · TV COUNCIL · F22 HUD · LIVE TABLES · AUDIT</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: tab === t.id ? `${t.color}18` : 'transparent',
              border: `1px solid ${tab === t.id ? t.color : C.muted}`,
              color: tab === t.id ? t.color : C.text,
              borderRadius: 4, padding: '3px 10px', fontSize: 9,
              cursor: 'pointer', fontFamily: 'inherit', letterSpacing: 1,
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

        {/* ── MTF VOTING ───────────────────────────────────────────────────── */}
        {tab === 'mtf' && (
          <div style={{ maxWidth: 900 }}>
            <div style={{ fontSize: 9, letterSpacing: 3, color: C.muted, marginBottom: 16 }}>
              10-TIMEFRAME VOTING SYSTEM · TARGET: 5/10 ALIGNMENT THRESHOLD
            </div>

            {/* Vote threshold visualizer */}
            <Card accent={C.jedi} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.jedi, marginBottom: 8 }}>VOTE MODEL</div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 10 }}>
                {Array.from({ length: 10 }, (_, i) => (
                  <div key={i} style={{
                    width: 32, height: 32, borderRadius: 4,
                    background: i < 5 ? `${C.boom}33` : `${C.muted}22`,
                    border: `1px solid ${i < 5 ? C.boom : C.muted}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, color: i < 5 ? C.boom : C.muted,
                  }}>{i < 5 ? '▲' : '·'}</div>
                ))}
                <span style={{ fontSize: 11, color: C.boom, marginLeft: 8 }}>5/10 = ENTRY</span>
              </div>
              <div style={{ fontSize: 10, color: C.text, lineHeight: 1.7 }}>
                Each TF votes BULL / BEAR / NEUTRAL with a weight.<br />
                Weighted score = Σ(weight × vote) / Σ(weights).<br />
                Threshold: weighted_score &gt; 0.5 AND raw vote count ≥ 5/10 → entry permitted.<br />
                1m/2m/4m excluded — too correlated. 2H + 8H added to fill gaps.
              </div>
            </Card>

            {/* TF table */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {['MICRO', 'INTRA', 'SESSION', 'SWING', 'MACRO'].map(group => {
                const rows = TF_ROWS.filter(r => r.group === group);
                return (
                  <div key={group}>
                    <div style={{
                      fontSize: 8, letterSpacing: 3, color: GROUP_COLOR[group],
                      marginBottom: 4, marginTop: 8,
                    }}>{group}</div>
                    {rows.map(r => (
                      <div key={r.tf} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: C.bg1, border: `1px solid ${C.border}`,
                        borderLeft: `3px solid ${GROUP_COLOR[group]}`,
                        borderRadius: 6, padding: '8px 12px', marginBottom: 4,
                      }}>
                        <span style={{
                          width: 36, fontWeight: 800, fontSize: 13,
                          color: GROUP_COLOR[group], flexShrink: 0,
                        }}>{r.tf}</span>
                        <div style={{
                          width: 28, height: 6, borderRadius: 3,
                          background: `${GROUP_COLOR[group]}22`,
                          border: `1px solid ${GROUP_COLOR[group]}55`,
                          overflow: 'hidden',
                        }}>
                          <div style={{ width: `${r.weight / 2.5 * 100}%`, height: '100%', background: GROUP_COLOR[group] }} />
                        </div>
                        <span style={{ fontSize: 9, color: C.text, flex: 1 }}>{r.note}</span>
                        <span style={{
                          fontSize: 9, color: r.diff.startsWith('★') ? C.gold : C.muted,
                          flexShrink: 0, maxWidth: 220, textAlign: 'right',
                        }}>{r.diff}</span>
                        <Chip phase={r.phase} />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            <Card accent={C.gold} style={{ marginTop: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: C.gold, marginBottom: 6 }}>OPT PATH</div>
              {[
                'Start: 6 TFs (5m/15m/1H/4H/1D/1W) → 4/6 threshold → baseline paper',
                'Add: 2H and 8H → 8 TFs → 5/8 threshold',
                'Add: 1m + 15s for scalp mode only (Delta Ops fire mode) → 10 TFs full',
                'Tune threshold per regime: BULL=4/10 (permissive), RANGING=7/10 (strict)',
                'Monitor: per-TF Sharpe contribution → drop low-value TFs dynamically',
              ].map((s, i) => (
                <div key={i} style={{ fontSize: 10, color: C.text, marginBottom: 4, lineHeight: 1.5 }}>
                  {i + 1}. {s}
                </div>
              ))}
            </Card>
          </div>
        )}

        {/* ── REGIME / SESSION ─────────────────────────────────────────────── */}
        {tab === 'regime' && (
          <div style={{ maxWidth: 900 }}>
            <div style={{ fontSize: 9, letterSpacing: 3, color: C.muted, marginBottom: 16 }}>
              SESSION REGIME AWARENESS · SIGNAL GATING BY TIME
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {SESSIONS.map(s => (
                <Card key={s.name} accent={s.color}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Volume bar */}
                    <div style={{ width: 60, flexShrink: 0 }}>
                      <div style={{ fontSize: 8, color: C.muted, marginBottom: 3 }}>{s.hours}</div>
                      <div style={{ height: 8, background: `${s.color}22`, borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${s.vol}%`, height: '100%', background: s.color }} />
                      </div>
                      <div style={{ fontSize: 8, color: s.color, marginTop: 2 }}>{s.vol}% vol</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: s.color, marginBottom: 3 }}>{s.name}</div>
                      <div style={{
                        fontSize: 10, color: s.regime.startsWith('★') ? C.gold : C.text,
                        fontWeight: s.regime.startsWith('★') ? 700 : 400,
                      }}>{s.regime}</div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
            <Card accent={C.ict} style={{ marginTop: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: C.ict, marginBottom: 8 }}>REGIME → MOE GATE RULES</div>
              {[
                ['LONDON OPEN + NY OPEN', 'Full signal pass-through. All fire modes active.'],
                ['LONDON MID + NY MID', 'Intraday + Swing only. Suppress scalp (too extended).'],
                ['LUNCH DOLDRUMS (12-14 UTC)', '★ BLOCK ALL entries. Close any scalps. MOE gate = closed.'],
                ['ASIA SESSION', 'Range-bound mode only. Suppress BOOM council. LEGEND tips only.'],
                ['DEAD ZONE (20-00 UTC)', '★ BLOCK ALL. Position monitor only.'],
                ['GOLD (XAUUSD)', 'London Open is primary session. NY Open secondary. Asia = dead.'],
              ].map(([ctx, rule]) => (
                <div key={ctx} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: C.ict, marginBottom: 2 }}>{ctx}</div>
                  <div style={{ fontSize: 10, color: C.text, paddingLeft: 12 }}>{rule}</div>
                </div>
              ))}
            </Card>
          </div>
        )}

        {/* ── TV INDICATOR COUNCIL ─────────────────────────────────────────── */}
        {tab === 'tvindicators' && (
          <div style={{ maxWidth: 960 }}>
            <div style={{ fontSize: 9, letterSpacing: 3, color: C.muted, marginBottom: 16 }}>
              TV INDICATOR COUNCIL · SENSOR FUSION LAYER 2 · PARALLEL TO 27 ALGO COUNCIL
            </div>
            <Card accent={C.strat} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: C.text, lineHeight: 1.7 }}>
                Second council: 8 top TV indicators, each votes BULL/BEAR/NEUTRAL with confidence.<br />
                Combined with 27 algo council via MOE aggregator → SENSOR FUSION total signal.<br />
                <span style={{ color: C.gold }}>Pine stays on TV for reference/alerts. Python DS implements natively.</span>
              </div>
            </Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {TV_INDICATORS.map(ind => (
                <Card key={ind.id} accent={C.strat}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 4,
                      background: `${C.strat}18`, border: `1px solid ${C.strat}44`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 900, color: C.strat, flexShrink: 0,
                    }}>{ind.id}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: C.textHi }}>{ind.name}</span>
                        <span style={{ fontSize: 9, color: C.muted }}>by {ind.author}</span>
                        <span style={{
                          marginLeft: 'auto', fontSize: 8, padding: '1px 6px', borderRadius: 3,
                          background: `${C.risk}18`, color: C.risk, border: `1px solid ${C.risk}33`,
                        }}>{ind.priority}</span>
                        <Chip phase={ind.phase} />
                      </div>
                      <div style={{ fontSize: 10, color: C.boom, marginBottom: 4 }}>Edge: {ind.edge}</div>
                      <div style={{ fontSize: 9, color: C.text, marginBottom: 3 }}>Vote: {ind.vote}</div>
                      <div style={{
                        fontSize: 9, color: ind.impl.startsWith('★') ? C.gold : C.muted,
                        fontWeight: ind.impl.startsWith('★') ? 700 : 400,
                      }}>{ind.impl}</div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
            <Card accent={C.gold} style={{ marginTop: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: C.gold, marginBottom: 8 }}>SELF-OPT PROCESS</div>
              {[
                'Start: SQZ + ST + QQE + UTBot (P0 — all have Python implementations)',
                'Paper trade: track per-indicator Sharpe contribution after 100 trades',
                'Drop indicators with Sharpe &lt; 0 over trailing 50 — dynamic dropout same as 27 council',
                'Add: Lorentzian (P1) once Python port validated — highest alpha potential',
                'Combine: TV council score + 27 algo score → FUSION_SCORE for MOE gate',
              ].map((s, i) => (
                <div key={i} style={{ fontSize: 10, color: C.text, marginBottom: 5, lineHeight: 1.5 }}>
                  {i + 1}. {s}
                </div>
              ))}
            </Card>
          </div>
        )}

        {/* ── ORACLE HUD ───────────────────────────────────────────────────── */}
        {tab === 'oracle' && (
          <div style={{ maxWidth: 960 }}>
            <div style={{ fontSize: 9, letterSpacing: 3, color: C.muted, marginBottom: 16 }}>
              F22 ORACLE HUD · ALL WEAPONS TUNED · SENSOR FUSION DISPLAY
            </div>

            {/* Orb concept banner */}
            <Card accent={C.jedi} style={{ marginBottom: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: C.jedi, letterSpacing: 3, marginBottom: 6 }}>
                JED(AI) MASTER ORB
              </div>
              <div style={{ fontSize: 10, color: C.text, lineHeight: 1.8, maxWidth: 700, margin: '0 auto' }}>
                Single visual artifact communicating pulse + state of all systems simultaneously.<br />
                Control-room needles pointing in asset direction. Each needle = distinct factor/edge.<br />
                Combined in JEDI orb = snapshot of asset + market health.<br />
                <span style={{ color: C.gold }}>Could integrate local LLM for natural language trade rationale output.</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 12 }}>
                {[['MARKET ORB', C.boom, 'SPX/NDX/DJI regime · sector flow · vol regime'],
                  ['JEDI MASTER ORB', C.jedi, 'All 27 + TV council fusion · MTF alignment · final signal'],
                  ['ASSET ORB ×N', C.ict, 'Per-asset: direction · score · entry zone · SL/TP'],
                ].map(([name, color, desc]) => (
                  <div key={String(name)} style={{ textAlign: 'center', maxWidth: 180 }}>
                    <div style={{
                      width: 56, height: 56, borderRadius: '50%', margin: '0 auto 8px',
                      background: `${color}22`, border: `2px solid ${color}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, color: String(color), fontWeight: 800,
                    }}>ORB</div>
                    <div style={{ fontSize: 10, color: String(color), fontWeight: 700 }}>{name}</div>
                    <div style={{ fontSize: 9, color: C.text, marginTop: 4 }}>{desc}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Weapons grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 10,
            }}>
              {WEAPONS.map(w => (
                <Card key={w.key} accent={w.color}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: w.color, letterSpacing: 2 }}>{w.label}</span>
                    <Chip phase={w.phase} />
                  </div>
                  <div style={{ fontSize: 10, color: C.text, lineHeight: 1.5 }}>{w.desc}</div>
                </Card>
              ))}
            </div>

            <Card accent={C.gold} style={{ marginTop: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: C.gold, marginBottom: 8 }}>ORACLE BUILD SEQUENCE</div>
              {[
                ['P0', 'Wire existing SoloMasterOrb to live signal gate output. Needle = real direction, not mock.'],
                ['P0', 'Market Orb: SPX regime (BULL/BEAR/NEUTRAL) from /v1/council JEDI score. Display on all pages.'],
                ['P1', 'ASSET SELECT: rank top 3 assets by FUSION_SCORE on every signal bus event. Surface on TradeBotPage.'],
                ['P1', 'FIRE MODE: detect session + regime → lock fire mode display. Block SCALP during doldrums.'],
                ['P1', 'LEGEND TIP banner: LEGEND C algo fires → surface early-stage 1-3M setup with ICT weekly draw.'],
                ['P2', 'KELLY SIZE: compute + display. Warn if > ½ Kelly. Small-acc mode: fixed 1%.'],
                ['P2', 'SOUNDSCAPE: tone on signal. Pitch = confidence. Low-freq pulse on exit zone proximity.'],
                ['P2', 'Local LLM: llama.cpp or Ollama on M1/M2 Mac. Feed FUSION_SCORE + context → trade rationale text.'],
              ].map(([phase, desc]) => (
                <div key={desc} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
                  <span style={{
                    fontSize: 8, padding: '2px 6px', borderRadius: 3,
                    background: phase === 'P0' ? `${C.liq}18` : phase === 'P1' ? `${C.risk}18` : `${C.paper}18`,
                    color: phase === 'P0' ? C.liq : phase === 'P1' ? C.risk : C.paper,
                    flexShrink: 0,
                  }}>{phase}</span>
                  <div style={{ fontSize: 10, color: C.text, lineHeight: 1.5 }}>{desc}</div>
                </div>
              ))}
            </Card>
          </div>
        )}

        {/* ── LIVE TABLES ──────────────────────────────────────────────────── */}
        {tab === 'tables' && (
          <div style={{ maxWidth: 900 }}>
            <div style={{ fontSize: 9, letterSpacing: 3, color: C.muted, marginBottom: 16 }}>
              LIVE DATA TABLES · COLOR BARS · SPARKLINES · AUDIO ALERTS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {LIVE_TABLES.map(t => (
                <Card key={t.name} accent={t.color}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: t.color }}>{t.name}</span>
                    <Chip phase={t.phase} />
                  </div>
                  <div style={{ fontSize: 10, color: C.text, lineHeight: 1.6, marginBottom: 10 }}>{t.desc}</div>
                  <div style={{
                    fontSize: 9, color: t.color, background: `${t.color}0a`,
                    border: `1px solid ${t.color}33`, borderRadius: 4, padding: '6px 10px',
                  }}>
                    MVP: {t.mvp}
                  </div>
                </Card>
              ))}
            </div>

            {/* Shared column design */}
            <Card accent={C.strat} style={{ marginTop: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: C.strat, marginBottom: 10 }}>SHARED COLUMN DESIGN</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[
                  ['ASSET', C.textHi, 'ticker + flag'],
                  ['PRICE', C.boom, 'last with micro-sparkline 30s'],
                  ['CHANGE', C.legend, '+/- % colored'],
                  ['RVOL', C.exec, 'relative vol bar'],
                  ['SCORE', C.jedi, 'JEDI composite 0-100'],
                  ['TIER', C.jedi, 'S/A/B/C badge'],
                  ['MTF', C.ict, '5/10 vote bar'],
                  ['SESSION', C.boom, 'killzone badge'],
                  ['SQZ', C.strat, 'squeeze state dot'],
                  ['ICT FLAG', C.ict, 'FVG/OB/LIQ icon'],
                  ['SOUND', C.gold, '🔊 on alert trigger'],
                ].map(([col, color, desc]) => (
                  <div key={String(col)} style={{
                    background: C.bg2, border: `1px solid ${C.border}`,
                    borderRadius: 4, padding: '6px 10px', minWidth: 100,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: String(color) }}>{col}</div>
                    <div style={{ fontSize: 8, color: C.muted }}>{desc}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* ── EXPERT COUNCIL ───────────────────────────────────────────────── */}
        {tab === 'expert' && (
          <div style={{ maxWidth: 960 }}>
            <div style={{ fontSize: 9, letterSpacing: 3, color: C.muted, marginBottom: 16 }}>
              EXPERT TRADER COUNCIL · DISCRETIONARY FRAMEWORKS CODIFIED AS EV ENGINES
            </div>

            {/* MOE Lane diagram */}
            <Card accent={C.legend} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.legend, marginBottom: 10 }}>
                COUNCIL LAYER ARCHITECTURE
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                {[
                  { label: '27 ALGOS', sub: 'BOOM/STRAT/LEGEND', color: C.boom },
                  { label: '→', sub: '', color: C.muted },
                  { label: 'TV COUNCIL', sub: 'SQZ/QQE/LOR/UTB', color: C.strat },
                  { label: '→', sub: '', color: C.muted },
                  { label: 'EXPERT EV', sub: 'Lance + Andrea', color: C.legend },
                  { label: '→', sub: '', color: C.muted },
                  { label: 'MOE GATE', sub: 'EV≥80 + JEDI≥60', color: C.jedi },
                  { label: '→', sub: '', color: C.muted },
                  { label: 'SIGNAL BUS', sub: '/ws/signals', color: C.exec },
                ].map((n, i) => (
                  <div key={i} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: n.label === '→' ? 16 : 10, fontWeight: 800, color: n.color }}>{n.label}</div>
                    {n.sub && <div style={{ fontSize: 7, color: C.text }}>{n.sub}</div>}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 9, color: C.text, lineHeight: 1.8 }}>
                Expert Traders are NOT separate signals — they <span style={{ color: C.legend }}>weight the gate and size the position</span>.<br />
                Lance EV ≥ 80 → gate opens for mean-reversion trades. Andrea absorption → BOOM A bank Delta Ops fire mode.<br />
                The 20% humility factor is permanently baked into Lance's EV calculation.
              </div>
            </Card>

            {/* Trader cards */}
            {EXPERT_TRADERS.map(trader => (
              <Card key={trader.id} accent={trader.bankColor} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 900, color: trader.bankColor }}>{trader.name}</span>
                  <span style={{ fontSize: 8, color: C.text }}>{trader.title}</span>
                  <span style={{
                    fontSize: 8, padding: '1px 6px', borderRadius: 3,
                    background: `${trader.bankColor}18`, color: trader.bankColor,
                    border: `1px solid ${trader.bankColor}44`, letterSpacing: 1,
                  }}>{trader.bank}</span>
                  {dot(trader.phase)}
                  <span style={{ fontSize: 8, color: C.muted, marginLeft: 'auto' }}>{trader.priority}</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  {[
                    { label: 'STYLE',    val: trader.style    },
                    { label: 'UNIVERSE', val: trader.universe },
                    { label: 'ENTRY',    val: trader.entry    },
                    { label: 'STOP',     val: trader.stop     },
                    { label: 'TARGET',   val: trader.target   },
                    { label: 'SIZING',   val: trader.sizing   },
                  ].map(row => (
                    <div key={row.label}>
                      <div style={{ fontSize: 7, color: C.muted, letterSpacing: 1, marginBottom: 2 }}>{row.label}</div>
                      <div style={{ fontSize: 9, color: C.textHi, lineHeight: 1.5 }}>{row.val}</div>
                    </div>
                  ))}
                </div>

                {/* Tally table */}
                <div style={{ fontSize: 7, color: C.muted, letterSpacing: 1, marginBottom: 6 }}>MENTAL TALLY (EV WEIGHTS)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                  {trader.tally.map(row => (
                    <div key={row.factor} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{
                        fontSize: 8, padding: '1px 6px', borderRadius: 3, flexShrink: 0,
                        background: `${trader.bankColor}18`, color: trader.bankColor,
                        border: `1px solid ${trader.bankColor}30`,
                      }}>{row.weight}</span>
                      <span style={{ fontSize: 9, fontWeight: 700, color: C.textHi, flexShrink: 0, minWidth: 130 }}>{row.factor}</span>
                      <span style={{ fontSize: 8, color: C.text, lineHeight: 1.5 }}>{row.detail}</span>
                    </div>
                  ))}
                </div>

                {/* MOE lane */}
                <div style={{
                  fontSize: 8, color: C.jedi, padding: '6px 10px',
                  background: `${C.jedi}0a`, borderRadius: 4, border: `1px solid ${C.jedi}22`,
                }}>
                  <span style={{ color: C.muted, marginRight: 6 }}>MOE LANE:</span>{trader.moeLane}
                </div>
              </Card>
            ))}

            {/* Iter opt roadmap */}
            <Card accent={C.jedi} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.jedi, marginBottom: 10 }}>
                EXPERT COUNCIL ITER OPT PATH
              </div>
              {[
                { step: '1', label: 'Lance EV engine', file: 'pwa/src/lib/lanceBreitstein.ts', status: 'live' as Phase,   note: 'computeLanceEV() — 4-category scorer, Right Side of V, grade A+/B/C' },
                { step: '2', label: 'Wire into MM Brain', file: 'pwa/src/lib/mmBrain.ts',          status: 'build' as Phase,  note: 'MMPrediction.lanceEV field + narrative merge. Lance grade gates phase entry.' },
                { step: '3', label: 'Signal gate check', file: 'M3D api/src/routes/signals.rs',   status: 'plan' as Phase,   note: 'P0: JEDI≥60 AND lanceEV≥80 → typed Signal JSON emitted to /ws/signals' },
                { step: '4', label: 'Andrea fire mode', file: 'M6D/src/pages/BtcChartsPage.tsx',  status: 'plan' as Phase,   note: 'Delta Ops mode: absorption flag triggers BOOM A visual + audio cue' },
                { step: '5', label: 'Expert Council page', file: 'M6D/src/pages (new)',            status: 'plan' as Phase,   note: 'ExpertCouncilPage: per-asset Lance EV cards, waterfall state, Andrea signal' },
                { step: '6', label: 'More traders', file: 'APP-DOC/EXPERT TRADER COUNCIL/',        status: 'plan' as Phase,   note: 'SMB composites, Minervini SEPA, Axia DOM — run extraction prompt on each' },
              ].map(row => (
                <div key={row.step} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
                  <span style={{ fontSize: 9, color: C.muted, minWidth: 14 }}>{row.step}.</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: C.textHi }}>{row.label}</span>
                      {dot(row.status)}
                    </div>
                    <div style={{ fontSize: 8, color: C.muted, fontStyle: 'italic', marginBottom: 2 }}>{row.file}</div>
                    <div style={{ fontSize: 8, color: C.text }}>{row.note}</div>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        )}

        {/* ── IMPL AUDIT ───────────────────────────────────────────────────── */}
        {tab === 'audit' && (
          <div style={{ maxWidth: 900 }}>
            <div style={{ fontSize: 9, letterSpacing: 3, color: C.muted, marginBottom: 16 }}>
              IMPLEMENTATION AUDIT · 10-CORE MAC · WHAT RUNS WHERE
            </div>
            <Card accent={C.risk} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: C.text, lineHeight: 1.7 }}>
                M1/M2/M3 Mac (10-core): sufficient for all Python DS + Rust engine + M6D frontend simultaneously.<br />
                <span style={{ color: C.gold }}>Rust engine ≠ Pine Script. Complex TV indicators must live in Python DS, not Rust.</span><br />
                Lorentzian KNN: Python sklearn — high CPU on inference, batch nightly or on signal trigger only.
              </div>
            </Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {AUDIT.map(a => (
                <Card key={a.system} accent={a.system === 'GOLD (XAUUSD)' ? C.gold : C.border}>
                  <div style={{
                    fontSize: 11, fontWeight: 800, marginBottom: 10,
                    color: a.system === 'GOLD (XAUUSD)' ? C.gold : C.textHi,
                  }}>{a.system}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 9, color: PC.live, letterSpacing: 2, marginBottom: 6 }}>● CAN DO</div>
                      {a.can.map(s => (
                        <div key={s} style={{ fontSize: 10, color: C.text, marginBottom: 4, lineHeight: 1.4 }}>· {s}</div>
                      ))}
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: PC.plan, letterSpacing: 2, marginBottom: 6 }}>○ CANNOT / BLOCKED</div>
                      {a.cannot.map(s => (
                        <div key={s} style={{
                          fontSize: 10, marginBottom: 4, lineHeight: 1.4,
                          color: s.startsWith('★') ? C.gold : C.muted,
                          fontWeight: s.startsWith('★') ? 700 : 400,
                        }}>· {s}</div>
                      ))}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
