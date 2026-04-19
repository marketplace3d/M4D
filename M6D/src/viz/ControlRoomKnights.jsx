import { useState, useEffect, useRef, useCallback, useContext } from "react";
import { useObiStream } from "../hooks/useObiStream";
import { WarriorMobileSyncContext } from "../WarriorMobileSyncContext";
import { ALGO_BUILD_SPECS } from "../data/algoBuildSpecs";
import {
  BANK_H_W_BOOM,
  BANK_H_W_LEGEND,
  BANK_H_W_STRAT,
  DANGER_X_ENERGY_GT,
  DEAD_MARKET_CONVICTION_LT,
  DIRECTION_LONG_MIN,
  DIRECTION_SHORT_MAX,
  GO_SCORE_ABS_MIN,
} from "../constants/jediAlignment";
import { XSentinelOrb, CouncilOrb, JediMasterOrb } from "./MaxCogVizOrbs";
import { PriceOrb, RiskOrb, ConfluenceOrb, VolumeOrb, TVWebhookOrb, IntermarketOrb, PositioningOrb } from "./MaxCogVizOrbsII";
import SocialAlphaPulse from "./SocialAlphaPulse";

// ═══════════════════════════════════════════════════════════════
// M4D · 27-PANEL MAXCOGVIZ CONTROL ROOM · LIVE DATA · 4K
// ═══════════════════════════════════════════════════════════════

function panelDef(slot, id, name, sub, color, tier, method, signals, horizon) {
  return { slot, id, name, sub, role: sub, method, color, tier, signals, ...(horizon ? { horizon } : {}) };
}

const BANK_A = [
  panelDef("A0", "NS", "NIALL SPIKE", "Vol Delta Explosion", "#22d3ee", "BOOM",
    "Ask-delta σ spike on 1m/5m. Institutional absorption.",
    ["Delta σ", "1m/5m", "Absorption", "Bid/Ask"]),
  panelDef("A1", "CI", "CYBER-ICT", "OB Heatseeker", "#a78bfa", "BOOM",
    "Auto-detect OB/FVG/Breaker on 15m+1H. Return entry.",
    ["OB", "FVG", "15m+1H", "Mitigation"]),
  panelDef("A2", "BQ", "BANSHEE SQUEEZE", "TTM Momentum Release", "#f43f5e", "BOOM",
    "BB inside KC = squeeze. First expansion bar fires.",
    ["BB/KC", "Squeeze", "Histogram", "Release"]),
  panelDef("A3", "CC", "CELTIC CROSS", "EMA Ribbon Alignment", "#4ade80", "BOOM",
    "8/21/34/55/89 full bullish stack. Partial = fractional.",
    ["EMA Stack", "Ribbon", "Alignment", "Fractional"]),
  panelDef("A4", "WH", "WOLFHOUND", "Scalp Velocity", "#fb923c", "BOOM",
    "3 consecutive accel bars + expanding range.",
    ["Velocity", "Accel", "Range", "Decel"]),
  panelDef("A5", "SA", "STONE ANCHOR", "Volume Profile VP/VPOC", "#94a3b8", "BOOM",
    "40-bin OHLCV volume profile. VPOC slope + value area.",
    ["VPOC", "VAH", "VAL", "Session"]),
  panelDef("A6", "HK", "HIGH KING", "Opening Range Bias", "#fbbf24", "BOOM",
    "ORB 5/30min. PDH/PDL macro filter.",
    ["ORB", "PDH/PDL", "5/30m", "Bias"]),
  panelDef("A7", "GO", "GALLOWGLASS OB", "Aggressive OB Retest", "#c084fc", "BOOM",
    "3× vol displacement. 50% OB retrace entry.",
    ["OB Retest", "Displacement", "50%", "HTF"]),
  panelDef("A8", "EF", "EMERALD FLOW", "Money Flow MFI", "#34d399", "BOOM",
    "MFI(14) cross 50. Divergence = reversal flag.",
    ["MFI(14)", "Cross 50", "Divergence", "Flag"]),
];

const BANK_B = [
  panelDef("B0", "8E", "8-EMA RIBBON", "Trend Momentum Gate", "#67e8f9", "STRAT",
    "Price vs 8EMA. Ribbon width = momentum score 0-10.",
    ["vs 8EMA", "Width", "Score", "Gate"]),
  panelDef("B1", "VT", "VEGA TRAP", "Options Gamma Squeeze", "#818cf8", "STRAT",
    "Max pain, gamma walls, dealer hedging flow.",
    ["Max Pain", "Gamma", "Dealer", "Pin"]),
  panelDef("B2", "MS", "MARKET SHIFT", "CHoCH / BOS Detector", "#f97316", "STRAT",
    "Structure change on 15m/1H with volume confirm.",
    ["CHoCH", "BOS", "15m/1H", "Volume"]),
  panelDef("B3", "DP", "DARK POOL", "Institutional Prints", "#e879f9", "STRAT",
    "DP ratio anomaly >2× avg at key technical levels.",
    ["DP Ratio", "Prints", "2× Avg", "Tape"]),
  panelDef("B4", "WS", "WYCKOFF SPRING", "Accum Phase Detector", "#fde68a", "STRAT",
    "SC/AR/ST/Spring/LPS/LPSY phase confidence scoring.",
    ["Phase", "Spring", "LPSY", "Volume"]),
  panelDef("B5", "RV", "RENKO VAULT", "Noise-Filtered Trend", "#86efac", "STRAT",
    "1×ATR bricks. 3 consecutive bullish = long signal.",
    ["ATR Brick", "3 Bar", "Trend", "Reversal"]),
  panelDef("B6", "HL", "HARMONIC LENS", "Gartley/Bat/Butterfly PRZ", "#f0abfc", "STRAT",
    "PRZ completion ±0.5% + RSI divergence confirm.",
    ["PRZ", "Pattern", "RSI Div", "±0.5%"]),
  panelDef("B7", "AI", "ALPHA IMBALANCE", "FVG Fill Probability", "#a5f3fc", "STRAT",
    "FVG catalog by age+proximity+vol. 70th pct threshold.",
    ["FVG Age", "Proximity", "Vol", "70th"]),
  panelDef("B8", "VK", "VOLKOV KELTNER", "Keltner Breakout", "#60a5fa", "STRAT",
    "KC breakout with vol surge. ATR trail management.",
    ["KC", "Vol Surge", "ATR", "Trail"]),
];

const BANK_C = [
  panelDef("C0", "SE", "STOCKBEE EP", "Episodic Pivot 3×Vol", "#4ade80", "LEGEND",
    "Gap-up 3×avg vol + catalyst. 20-30% target 1-3M.", ["Gap", "3× Vol", "Catalyst", "EP"], "1-3M"),
  panelDef("C1", "IC", "ICT WEEKLY FVG", "Virgin FVG Displacement", "#a78bfa", "LEGEND",
    "Weekly virgin FVG never touched. Monthly draw align.", ["Virgin", "Weekly", "Monthly", "Draw"], "1-3M"),
  panelDef("C2", "WN", "WEINSTEIN STAGE", "Stage 2 Base Breakout", "#fbbf24", "LEGEND",
    "6-month base + vol expansion above 30W MA.", ["Stage 2", "30W MA", "Base", "Vol"], "3-6M"),
  panelDef("C3", "CA", "CASPER IFVG", "Inverse FVG Deep Draw", "#f9a8d4", "LEGEND",
    "Quarterly IFVG as price target. Void depth scoring.", ["IFVG", "Quarterly", "Void", "Target"], "3-6M"),
  panelDef("C4", "TF", "TTRADES FRACTAL", "MTF Fractal Swing", "#fb923c", "LEGEND",
    "HH/HL daily+weekly+monthly alignment. Fib targets.", ["HH/HL", "D/W/M", "Fib", "Swing"], "1-6M"),
  panelDef("C5", "RT", "RAYNER TREND", "200MA Pullback Entry", "#34d399", "LEGEND",
    "200MA up-slope + 50EMA pullback. Min 1:3 RR.", ["200MA", "50EMA", "Pullback", "1:3"], "1-3M"),
  panelDef("C6", "MM", "MINERVINI VCP", "Volatility Contraction", "#67e8f9", "LEGEND",
    "Progressive tighter bases 33% each. Pivot breakout.", ["VCP", "33%", "Pivot", "Vol"], "3-6M"),
  panelDef("C7", "OR", "O'NEIL BREAKOUT", "CAN SLIM Cup & Handle", "#e879f9", "LEGEND",
    "EPS accel + RS>80 + 40% vol pivot breakout.", ["EPS", "RS>80", "40% Vol", "Pivot"], "3-6M"),
  panelDef("C8", "DV", "DRAGONFLY VOL", "Sector Rotation RS", "#fde68a", "LEGEND",
    "RS line 52W high + institutional sector accumulation.", ["RS", "52W", "Sector", "Flow"], "1-6M"),
];

const ALL_PANELS = [...BANK_A, ...BANK_B, ...BANK_C];
// ── DATA FETCHING ───────────────────────────────────────────────────────────

function getApiBase() {
  const b = import.meta.env.VITE_M4D_API_URL;
  if (typeof b !== "string") return undefined;
  const t = b.trim().replace(/\/$/, "");
  if (t === "") return "";
  return t || undefined;
}

function getStaticAlgoDayUrl() {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}m4d-latest/algo_day.json`;
}

async function fetchAlgoDay() {
  const api = getApiBase();
  const url = api !== undefined ? `${api}/v1/algo-day` : getStaticAlgoDayUrl();
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

function extractVotesAndStrengths(algoDay) {
  const votes = {};
  const strengths = {};
  const payloads = {};
  const tallies = {};

  if (algoDay?.last_bar_votes) {
    for (const [id, entry] of Object.entries(algoDay.last_bar_votes)) {
      if (id === "J") continue;
      votes[id] = entry.vote ?? 0;
      strengths[id] = entry.strength ?? 0;
      payloads[id] = entry.payload ?? {};
    }
    const jEntry = algoDay.last_bar_votes["J"];
    if (jEntry) {
      votes.jedi = jEntry.vote ?? 0;
      strengths.jedi = jEntry.strength ?? 0;
      payloads.jedi = jEntry.payload ?? {};
    }
  }
  if (algoDay?.per_algo) {
    for (const [id, t] of Object.entries(algoDay.per_algo)) {
      tallies[id] = t;
    }
  }
  return { votes, strengths, payloads, tallies };
}

// ── SCORE ───────────────────────────────────────────────────────────────────

function computeJediScore(votes) {
  let sum = 0;
  ALL_PANELS.forEach(p => { sum += (votes[p.id] ?? 0); });
  return sum;
}

// ── COLORS ──────────────────────────────────────────────────────────────────
const TIER_COLORS = { JEDI: "#f59e0b", BOOM: "#22d3ee", STRAT: "#818cf8", LEGEND: "#4ade80" };

function heatColor(strength) {
  if (strength < 0.001) return "#0a0a0f";
  if (strength < 0.25) return `rgba(34,211,238,${strength * 2})`;
  if (strength < 0.5)  return `rgba(34,211,238,${0.5 + strength})`;
  if (strength < 0.75) return `rgba(245,158,11,${0.5 + strength * 0.5})`;
  return `rgba(255,${Math.round(255 * (1 - strength) * 2.5)},0,1)`;
}

function voteGlow(v) {
  if (v === 1)  return "0 0 8px #22d3ee88, 0 0 16px #22d3ee33";
  if (v === -1) return "0 0 8px #ef444488, 0 0 16px #ef444433";
  return "none";
}

function dirColor(d) {
  if (d === "LONG")  return "#22d3ee";
  if (d === "SHORT") return "#ef4444";
  return "#4b5563";
}

// ── POLL INTERVALS ──────────────────────────────────────────────────────────
const POLL_OPTIONS = [
  { label: "5s",  ms: 5000  },
  { label: "10s", ms: 10000 },
  { label: "30s", ms: 30000 },
  { label: "60s", ms: 60000 },
  { label: "OFF", ms: 0     },
];

// ── PULSE HERO — "THE PULSE OF THE MARKET" ─────────────────────────────────

function ChevronTower({ dir, litCount, color }) {
  const n = 7;
  const isUp = dir === "up";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, position: "relative", zIndex: 2, minWidth: 36 }}>
      {Array.from({ length: n }, (_, i) => {
        const idx = isUp ? n - 1 - i : i;
        const lit = idx < litCount;
        const intensity = lit ? 0.45 + (idx / n) * 0.55 : 0.1;
        return (
          <svg key={i} width={28} height={10} viewBox="0 0 28 10">
            <polygon
              points={isUp ? "14,0 28,10 0,10" : "0,0 28,0 14,10"}
              fill={lit ? color : "#0d1520"}
              opacity={intensity}
              stroke={lit ? color : "#0d1f2e"}
              strokeWidth={0.5}
            />
          </svg>
        );
      })}
      <div style={{ fontSize: 7, letterSpacing: 3, color: litCount > 0 ? color : "#1e3a4a", fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif" }}>
        {isUp ? "BULL" : "BEAR"}
      </div>
    </div>
  );
}

function PulseHero({ score, direction, votes, strengths, isNarrow, isWide, activityData, paperStatus }) {
  const totalLong = ALL_PANELS.filter(p => (votes[p.id] ?? 0) === 1).length;
  const totalShort = ALL_PANELS.filter(p => (votes[p.id] ?? 0) === -1).length;
  const conviction = Math.round(((totalLong + totalShort) / 27) * 100);
  const isLong = direction === "LONG";
  const isShort = direction === "SHORT";
  const mainColor = isLong ? "#22d3ee" : isShort ? "#ef4444" : "#4b5563";
  const absScore = Math.abs(score);
  const litCount = Math.ceil((absScore / 27) * 7);

  const bankANet = BANK_A.reduce((a, p) => a + (votes[p.id] ?? 0), 0);
  const bankBNet = BANK_B.reduce((a, p) => a + (votes[p.id] ?? 0), 0);
  const bankCNet = BANK_C.reduce((a, p) => a + (votes[p.id] ?? 0), 0);
  const xEnergyRaw =
    (Math.abs(bankANet) / 9) * BANK_H_W_BOOM +
    (Math.abs(bankBNet) / 9) * BANK_H_W_STRAT +
    (Math.abs(bankCNet) / 9) * BANK_H_W_LEGEND;
  const xEnergyScore = Math.max(0, Math.min(1, xEnergyRaw));
  const marketState =
    conviction < DEAD_MARKET_CONVICTION_LT
      ? "DEAD MARKET"
      : direction === "FLAT"
        ? xEnergyScore > DANGER_X_ENERGY_GT
          ? "DANGER"
          : "FLATTEN"
        : Math.abs(score) >= GO_SCORE_ABS_MIN
          ? "GO"
          : "SOP";
  const marketColor = marketState === "GO"
    ? "#22c55e"
    : marketState === "FLATTEN"
      ? "#f59e0b"
      : marketState === "DEAD MARKET"
        ? "#64748b"
        : "#ef4444";
  const [tradeAction, setTradeAction] = useState("IDLE");
  const [tradeStamp, setTradeStamp] = useState("");

  const fireTrade = useCallback((action) => {
    setTradeAction(action);
    setTradeStamp(new Date().toLocaleTimeString());
  }, []);

  const totalFlat = 27 - totalLong - totalShort;

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      gap: isNarrow ? 8 : 28,
      padding: isNarrow ? "6px 8px" : "6px 24px",
      background: "#04060a",
      borderBottom: "1px solid #0d1f2e",
      position: "relative", overflow: "hidden", flexShrink: 0,
    }}>
      {/* Breathing background glow */}
      <div className="m4d-pulse-bg" style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `radial-gradient(ellipse 60% 100% at 50% 50%, ${mainColor}0c 0%, transparent 70%)`,
      }} />

      {/* SCORE + DIRECTION */}
      <div style={{ textAlign: isNarrow ? "center" : "left", position: "relative", zIndex: 2, minWidth: isNarrow ? 0 : 140 }}>
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: isNarrow ? 38 : 54, fontWeight: 900, lineHeight: 1,
          color: mainColor,
          textShadow: `0 0 30px ${mainColor}66, 0 0 60px ${mainColor}22`,
          fontVariantNumeric: "tabular-nums",
          transition: "color 0.5s, text-shadow 0.8s",
        }}>
          {score > 0 ? "+" : ""}{score}
        </div>
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: isNarrow ? 14 : 20, fontWeight: 700, letterSpacing: 6,
          color: mainColor, opacity: 0.9, marginTop: 2,
          transition: "color 0.5s",
        }}>{direction}</div>
        <div style={{ fontSize: 9, color: "#3a5a6a", letterSpacing: 2, marginTop: 6 }}>
          {conviction}% CONVICTION
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4, fontSize: 8 }}>
          <span style={{ color: "#22d3ee" }}>A:{bankANet > 0 ? "+" : ""}{bankANet}</span>
          <span style={{ color: "#818cf8" }}>B:{bankBNet > 0 ? "+" : ""}{bankBNet}</span>
          <span style={{ color: "#4ade80" }}>C:{bankCNet > 0 ? "+" : ""}{bankCNet}</span>
        </div>
        <div style={{ fontSize: 8, color: "#1e3a4a", letterSpacing: 1, marginTop: 4 }}>
          {totalLong}L / {totalShort}S / {27 - totalLong - totalShort}F
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: marketColor, boxShadow: `0 0 8px ${marketColor}` }} />
          <span style={{ fontSize: 8, letterSpacing: 1.4, color: marketColor }}>{marketState}</span>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => fireTrade("BUY")}
            style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: 8,
              letterSpacing: 1.2,
              padding: "3px 8px",
              border: "1px solid #22d3ee",
              background: tradeAction === "BUY" ? "#083040" : "#04070d",
              color: "#22d3ee",
              cursor: "pointer",
            }}
          >
            BUY
          </button>
          <button
            type="button"
            onClick={() => fireTrade("SELL")}
            style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: 8,
              letterSpacing: 1.2,
              padding: "3px 8px",
              border: "1px solid #ef4444",
              background: tradeAction === "SELL" ? "#3a1111" : "#04070d",
              color: "#ef4444",
              cursor: "pointer",
            }}
          >
            SELL
          </button>
          <button
            type="button"
            onClick={() => fireTrade("CLOSE")}
            style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: 8,
              letterSpacing: 1.2,
              padding: "3px 8px",
              border: "1px solid #f59e0b",
              background: tradeAction === "CLOSE" ? "#3c2a08" : "#04070d",
              color: "#f59e0b",
              cursor: "pointer",
            }}
          >
            CLOSE
          </button>
        </div>
        <div style={{ fontSize: 7, color: "#476579", letterSpacing: 1, marginTop: 4 }}>
          TRADE: {tradeAction}{tradeStamp ? ` · ${tradeStamp}` : ""}
        </div>
      </div>

      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: isWide ? 10 : 16,
        flexWrap: "nowrap",
        marginLeft: "auto",
        minWidth: 0,
      }}>
        {!isNarrow && <ChevronTower dir="up" litCount={isLong ? litCount : 0} color="#22d3ee" />}
        {!isNarrow && (
          <XSentinelOrb
            data={{
              energy: Math.round((activityData?.current?.activity_score ?? xEnergyScore) * 100),
              direction: (() => {
                const tl = activityData?.trend?.trend_label;
                if (tl === "BUILDING" || tl === "BULLISH") return "bullish";
                if (tl === "FADING"   || tl === "BEARISH") return "bearish";
                return direction === "LONG" ? "bullish" : direction === "SHORT" ? "bearish" : "neutral";
              })(),
              velocity: activityData?.current?.tick_score ?? xEnergyScore,
              confidence: activityData?.current?.grok_score ?? Math.abs(score) / 27,
              noiseBlocked: 0,
              sentiment: activityData?.current?.activity_score ?? xEnergyScore,
              influence: (activityData?.current?.activity_score ?? xEnergyScore) * 0.8,
            }}
            direction={direction}
          />
        )}
        <CouncilOrb
          score={score}
          direction={direction}
          votes={votes}
          strengths={strengths}
          bankANet={bankANet}
          bankBNet={bankBNet}
          bankCNet={bankCNet}
          conviction={conviction}
          isNarrow={isNarrow}
          allPanels={ALL_PANELS}
        />
        {!isNarrow && (
          <JediMasterOrb score={score} direction={direction} conviction={conviction} />
        )}
        {!isNarrow && isWide && (
          <>
            <PriceOrb direction={direction} />
            <RiskOrb
              direction={direction}
              pnl={paperStatus?.account?.unrealized_pl != null ? Number(paperStatus.account.unrealized_pl) : Math.round(score * 18)}
              pnlMax={paperStatus?.account?.equity != null ? Number(paperStatus.account.equity) * 0.05 : 600}
              drawdown={Math.max(0, (7 - Math.abs(score)) / 14)}
              maxDrawdown={0.62}
              positionSize={paperStatus?.positions?.length > 0 ? Math.min(1, paperStatus.positions.length / 5) : Math.min(1, conviction / 100)}
            />
            <ConfluenceOrb
              direction={direction}
              bankAScore={bankANet / 9}
              bankBScore={bankBNet / 9}
              bankCScore={bankCNet / 9}
              kellyFire={marketState === "GO"}
            />
            <VolumeOrb
              direction={direction}
              delta={bankANet / 9}
              cumDelta={(bankANet + bankBNet + bankCNet) / 27}
              absorption={Math.min(1, totalFlat / 27)}
              tapeSpeed={Math.min(1, Math.abs(score) / 21)}
            />
            <TVWebhookOrb
              connected={true}
              latencyMs={Math.min(480, 40 + Math.round(Math.abs(score) * 7))}
              action={direction === "LONG" ? "BUY" : direction === "SHORT" ? "SELL" : "IDLE"}
              fireCount={Math.max(0, Math.round(Math.abs(score)))}
              lastFiredMs={direction === "FLAT" ? 30000 : 3000}
            />
          </>
        )}
        {!isNarrow && <ChevronTower dir="down" litCount={isShort ? litCount : 0} color="#ef4444" />}
      </div>
    </div>
  );
}

// ── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function MaxCogVizControlRoom({ useShellSync = false } = {}) {
  const shellCtx = useContext(WarriorMobileSyncContext);
  const synced = Boolean(useShellSync && shellCtx);

  // Live data state
  const [algoDay, setAlgoDay] = useState(null);
  const [dataError, setDataError] = useState(null);
  const [fetchCount, setFetchCount] = useState(0);
  const [lastFetchMs, setLastFetchMs] = useState(0);
  const [dataSource, setDataSource] = useState("");
  const [pollIdx, setPollIdx] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const pollInterval = POLL_OPTIONS[pollIdx].ms;
  const countdownRef = useRef(null);

  // VolumeOrb — live OBI stream
  const obiSymbol = algoDay?.symbol ?? "ES";
  const obi = useObiStream(obiSymbol, import.meta.env.VITE_POLYGON_IO_KEY);

  // XSentinelOrb — live activity gate from DS quant :8000
  const [activityData, setActivityData] = useState(null);
  useEffect(() => {
    const load = () =>
      fetch("http://127.0.0.1:8000/v1/ai/activity/")
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setActivityData(d); })
        .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  // IntermarketOrb — cross-asset regime from DS quant :8000
  const [crossData, setCrossData] = useState(null);
  useEffect(() => {
    const load = () =>
      fetch("http://127.0.0.1:8000/v1/cross/report/")
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.ok) setCrossData(d); })
        .catch(() => {});
    load();
    const id = setInterval(load, 300_000); // refresh every 5m
    return () => clearInterval(id);
  }, []);

  // PositioningOrb — funding signal from DS quant :8000
  const [fundingData, setFundingData] = useState(null);
  useEffect(() => {
    const load = () =>
      fetch("http://127.0.0.1:8000/v1/funding/signals/")
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setFundingData(d); })
        .catch(() => {});
    load();
    const id = setInterval(load, 240_000);
    return () => clearInterval(id);
  }, []);

  // INTEL strip — Fear&Greed, OI signals, Liquidations
  const [fngIntel, setFngIntel] = useState(null);
  const [oiIntel, setOiIntel]   = useState(null);
  const [liqIntel, setLiqIntel] = useState(null);
  useEffect(() => {
    const load = () => {
      fetch("http://127.0.0.1:8000/v1/fng/")
        .then(r => r.ok ? r.json() : null).then(d => { if (d?.ok) setFngIntel(d); }).catch(() => {});
      fetch("http://127.0.0.1:8000/v1/oi/")
        .then(r => r.ok ? r.json() : null).then(d => { if (d) setOiIntel(d); }).catch(() => {});
      fetch("http://127.0.0.1:8000/v1/liq/")
        .then(r => r.ok ? r.json() : null).then(d => { if (d?.ok) setLiqIntel(d); }).catch(() => {});
    };
    load();
    const id = setInterval(load, 300_000);
    return () => clearInterval(id);
  }, []);

  // RiskOrb — live Alpaca paper P&L
  const [paperStatus, setPaperStatus] = useState(null);
  useEffect(() => {
    const load = () =>
      fetch("http://127.0.0.1:8000/v1/paper/status/")
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setPaperStatus(d); })
        .catch(() => {});
    load();
    const id = setInterval(load, 30_000); // 30s refresh
    return () => clearInterval(id);
  }, []);

  const [activeBank, setActiveBank] = useState("ALL");
  const [hoveredPanel, setHoveredPanel] = useState(null);
  const [pinnedPanel, setPinnedPanel] = useState(null);
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches
  );
  const [isWide, setIsWide] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1700px)").matches
  );

  // Fetch data
  const doFetch = useCallback(async () => {
    const t0 = performance.now();
    try {
      const data = await fetchAlgoDay();
      setAlgoDay(data);
      setDataError(null);
      setDataSource(getApiBase() !== undefined ? "m4d-api" : "static");
    } catch (e) {
      setDataError(e.message);
    }
    setLastFetchMs(Math.round(performance.now() - t0));
    setFetchCount(c => c + 1);
    if (pollInterval > 0) setCountdown(pollInterval);
  }, [pollInterval]);

  // Initial fetch
  useEffect(() => { doFetch(); }, [doFetch]);

  // Polling timer
  useEffect(() => {
    if (pollInterval <= 0) return;
    const id = setInterval(doFetch, pollInterval);
    return () => clearInterval(id);
  }, [doFetch, pollInterval]);

  // Countdown ticker
  useEffect(() => {
    if (pollInterval <= 0) { setCountdown(0); return; }
    countdownRef.current = setInterval(() => {
      setCountdown(c => Math.max(0, c - 100));
    }, 100);
    return () => clearInterval(countdownRef.current);
  }, [pollInterval, fetchCount]);

  // Responsive
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const on = () => setIsNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1700px)");
    const on = () => setIsWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Extract votes/strengths from data
  const { votes: apiVotes, strengths: apiStrengths, payloads, tallies } =
    algoDay ? extractVotesAndStrengths(algoDay) : { votes: {}, strengths: {}, payloads: {}, tallies: {} };

  const votes = synced && shellCtx ? shellCtx.votes : apiVotes;
  const strengths = synced && shellCtx ? shellCtx.strengths : apiStrengths;

  const score = computeJediScore(votes);
  const direction =
    score >= DIRECTION_LONG_MIN
      ? "LONG"
      : score <= DIRECTION_SHORT_MAX
        ? "SHORT"
        : "FLAT";

  const bankVotes = (bank) => bank.map(p => votes[p.id] ?? 0);
  const bankAVotes = bankVotes(BANK_A);
  const bankBVotes = bankVotes(BANK_B);
  const bankCVotes = bankVotes(BANK_C);
  const bankALong  = bankAVotes.filter(v => v === 1).length;
  const bankAShort = bankAVotes.filter(v => v === -1).length;
  const bankBLong  = bankBVotes.filter(v => v === 1).length;
  const bankBShort = bankBVotes.filter(v => v === -1).length;
  const bankCLong  = bankCVotes.filter(v => v === 1).length;
  const bankCShort = bankCVotes.filter(v => v === -1).length;

  const panels = activeBank === "ALL" ? ALL_PANELS
    : activeBank === "A" ? BANK_A : activeBank === "B" ? BANK_B : BANK_C;

  const detailId = hoveredPanel || pinnedPanel;
  const hovered = detailId ? ALL_PANELS.find(p => p.id === detailId) : null;
  const [focusAlgo, setFocusAlgo] = useState("NS");
  const [intelOpen, setIntelOpen] = useState(false);
  const focusPanel = ALL_PANELS.find((p) => p.id === (hovered?.id ?? pinnedPanel ?? focusAlgo)) ?? ALL_PANELS[0];

  const togglePin = (id) => setPinnedPanel(p => p === id ? null : id);

  const countdownPct = pollInterval > 0 ? ((pollInterval - countdown) / pollInterval) * 100 : 0;
  const symbol = algoDay?.symbol ?? "---";
  const barCount = algoDay?.bar_count ?? 0;
  const lastBarTime = algoDay?.last_bar_time ? new Date(algoDay.last_bar_time * 1000).toLocaleTimeString() : "--:--";
  const genAt = algoDay?.generated_at ?? "";

  const bankANetKn = BANK_A.reduce((a, p) => a + (votes[p.id] ?? 0), 0);
  const bankBNetKn = BANK_B.reduce((a, p) => a + (votes[p.id] ?? 0), 0);
  const bankCNetKn = BANK_C.reduce((a, p) => a + (votes[p.id] ?? 0), 0);
  const xEnergyRawKn =
    (Math.abs(bankANetKn) / 9) * BANK_H_W_BOOM +
    (Math.abs(bankBNetKn) / 9) * BANK_H_W_STRAT +
    (Math.abs(bankCNetKn) / 9) * BANK_H_W_LEGEND;
  const xEnergyScoreKn = Math.max(0, Math.min(1, xEnergyRawKn));
  const totalLongKn = ALL_PANELS.filter(p => (votes[p.id] ?? 0) === 1).length;
  const totalShortKn = ALL_PANELS.filter(p => (votes[p.id] ?? 0) === -1).length;
  const totalFlatKn = 27 - totalLongKn - totalShortKn;
  const convictionKn = Math.round(((totalLongKn + totalShortKn) / 27) * 100);
  // Real activity gate values — fall back to council-derived proxy if DS unavailable
  const actScore   = activityData?.current?.activity_score ?? xEnergyScoreKn;
  const grokScore  = activityData?.current?.grok_score ?? null;
  const tickScore  = activityData?.current?.tick_score ?? xEnergyScoreKn;
  const actGate    = activityData?.current?.gate ?? null;
  const actNote    = activityData?.current?.note ?? "";
  // Sentiment direction from DS trend label
  const sentTrendLabel = activityData?.trend?.trend_label ?? null;
  const xSentDir =
    sentTrendLabel === "BUILDING" || sentTrendLabel === "BULLISH" ? "bullish" :
    sentTrendLabel === "FADING"   || sentTrendLabel === "BEARISH" ? "bearish" :
    direction === "LONG" ? "bullish" : direction === "SHORT" ? "bearish" : "neutral";

  const knightsSocialData = {
    direction: xSentDir,
    energy: Math.round(actScore * 100),
    velocity: tickScore,
    velocityAccel: 0,
    confidence: grokScore ?? Math.max(0.05, Math.min(1, Math.abs(score) / 27)),
    sentiment: actScore,
    sentimentStrength: actScore,
    influenceScore: convictionKn / 100,
    influence: actScore * 0.8,
    noiseBlocked: Math.min(18, totalFlatKn),
    noiseTypes: totalFlatKn > 12 ? ["LOWINFO"] : [],
    rawSignalCount: 27,
    cleanSignalCount: totalLongKn + totalShortKn,
    crossVerified: convictionKn > 40,
    lastUpdated: lastBarTime,
    symbol: symbol === "---" ? "SPY" : String(symbol),
    alphaItems: [
      {
        text: actNote
          ? `GATE: ${actGate ?? "—"} · ${actNote} · Council ${totalLongKn}L/${totalShortKn}S`
          : `Council ${totalLongKn}L / ${totalShortKn}S / ${totalFlatKn}F · Jedi ${score > 0 ? "+" : ""}${score}`,
        strength: Math.max(0.35, Math.min(0.95, actScore)),
        verified: grokScore != null,
        tag: grokScore != null ? "GROK" : "TECH",
      },
    ],
  };
  const topOrbCandlesKn = [...BANK_A.slice(0, 7)].map((p, i) => {
    const v = votes[p.id] ?? 0;
    const st = strengths[p.id] ?? 0.5;
    const base = 100 + i * 0.45;
    return { o: base, h: base + 0.7 + st, l: base - 0.7 - st, c: base + v * st };
  });

  return (
    <div style={{
      fontFamily: "'Share Tech Mono', 'Courier New', monospace",
      background: "#04060a",
      color: "#7a9ab0",
      height: "100%",
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      position: "relative",
      overflow: "auto",
    }}>
      <style>{`
        @keyframes m4dPulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
        @keyframes m4dBreathe { 0%,100% { opacity: 0.4; } 50% { opacity: 0.9; } }
        .m4d-pulse-bg { animation: m4dBreathe 3s ease-in-out infinite; }
        .m4d-power-arrow { animation: m4dPulse 2s ease-in-out infinite; }
      `}</style>

      {/* Full-bleed chrome — skip when embedded on COUNCIL (`useShellSync`) so panels aren’t washed / clipped by frame */}
      {!useShellSync ? (
        <>
          <div style={{
            position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0,
            background: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.06) 3px,rgba(0,0,0,0.06) 4px)",
          }}/>
          <div style={{
            position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1,
            background: `radial-gradient(ellipse 60% 40% at 50% 0%, ${direction === "LONG" ? "rgba(34,211,238,0.06)" : direction === "SHORT" ? "rgba(239,68,68,0.06)" : "rgba(75,85,99,0.03)"} 0%, transparent 70%)`,
            transition: "background 2s",
          }}/>
        </>
      ) : null}

      {/* ── TOP COMMAND BAR ── */}
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between",
        gap: isNarrow ? 8 : 12,
        padding: isNarrow ? "8px 10px" : "0 20px",
        minHeight: 48,
        background: "#070c12",
        borderBottom: "1px solid #0d1f2e",
        flexShrink: 0, position: "relative", zIndex: 10,
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: isNarrow ? 8 : 20, flex: isNarrow ? "1 1 100%" : "0 1 auto" }}>
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: isNarrow ? 15 : 18, fontWeight: 900, letterSpacing: isNarrow ? 2 : 4, color: "#22d3ee" }}>
              PULSE
            </div>
            <div style={{ fontSize: 8, letterSpacing: 2, color: "#1e3a4a", textTransform: "uppercase" }}>
              {symbol} · {barCount} BARS · {dataSource.toUpperCase()} · POLL {POLL_OPTIONS[pollIdx].label}
            </div>
          </div>
          {!isNarrow && <div style={{ width: 1, height: 28, background: "#0d1f2e" }} />}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {[["ALL","ALL"],["A","A·BOOM"],["B","B·STRAT"],["C","C·LEGEND"]].map(([k,l]) => (
              <button key={k} type="button" onClick={() => setActiveBank(k)} style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: isNarrow ? 8 : 9, letterSpacing: 1, padding: isNarrow ? "6px 10px" : "3px 10px",
                minHeight: 36, touchAction: "manipulation",
                background: activeBank === k ? (k==="A" ? "#0a2030" : k==="B" ? "#14102a" : k==="C" ? "#07200f" : "#0d1f2e") : "transparent",
                border: `1px solid ${activeBank === k ? (k==="A" ? "#22d3ee" : k==="B" ? "#818cf8" : k==="C" ? "#4ade80" : "#22d3ee") : "#0d1f2e"}`,
                color: activeBank === k ? (k==="A" ? "#22d3ee" : k==="B" ? "#818cf8" : k==="C" ? "#4ade80" : "#22d3ee") : "#3a5a6a",
                cursor: "pointer", transition: "all 0.2s",
              }}>{l}</button>
            ))}
          </div>
        </div>

        {/* CENTER SCORE */}
        {!isNarrow && (
          <div style={{ textAlign: "center", position: "absolute", left: "50%", transform: "translateX(-50%)" }}>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 42, fontWeight: 900, lineHeight: 1,
              color: dirColor(direction),
              textShadow: `0 0 20px ${dirColor(direction)}88`,
              transition: "color 0.5s, text-shadow 0.5s",
              fontVariantNumeric: "tabular-nums",
            }}>
              {score > 0 ? "+" : ""}{score}
            </div>
            <div style={{ fontSize: 9, letterSpacing: 3, color: dirColor(direction), opacity: 0.7 }}>{direction}</div>
          </div>
        )}
        {isNarrow && (
          <div style={{ flex: "1 1 100%", textAlign: "center", order: 3, padding: "4px 0" }}>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 32, fontWeight: 900, lineHeight: 1,
              color: dirColor(direction),
              textShadow: `0 0 16px ${dirColor(direction)}88`,
              fontVariantNumeric: "tabular-nums",
            }}>
              {score > 0 ? "+" : ""}{score}
            </div>
            <div style={{ fontSize: 9, letterSpacing: 3, color: dirColor(direction), opacity: 0.7 }}>{direction}</div>
          </div>
        )}

        {/* RIGHT: POLL CONTROL + LIVE STATUS */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: isNarrow ? "auto" : undefined }}>
          {/* Poll speed selector */}
          <div style={{ display: "flex", gap: 2 }}>
            {POLL_OPTIONS.map((opt, i) => (
              <button key={opt.label} type="button" onClick={() => setPollIdx(i)} style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 7, letterSpacing: 1, padding: "3px 6px",
                background: pollIdx === i ? "#0d2a3a" : "transparent",
                border: `1px solid ${pollIdx === i ? "#22d3ee" : "#0d1f2e"}`,
                color: pollIdx === i ? "#22d3ee" : "#1e3a4a",
                cursor: "pointer", touchAction: "manipulation",
              }}>{opt.label}</button>
            ))}
          </div>
          <div style={{ textAlign: "right", fontSize: 9 }}>
            <div style={{ color: dataError ? "#ef4444" : "#22c55e", letterSpacing: 1 }}>
              {dataError ? "● ERR" : "●  LIVE"}
            </div>
            <div style={{ color: "#1e3a4a", fontVariantNumeric: "tabular-nums" }}>
              #{fetchCount} · {lastFetchMs}ms
            </div>
          </div>
        </div>
      </div>

      {/* ── REAL ORBS ROW (PULSE ONLY) ── */}
      {!useShellSync ? (
        <section
          aria-label="Pulse top orbs"
          style={{
            flexShrink: 0,
            background: "#060b11",
            borderBottom: "1px solid #0d1f2e",
            padding: isNarrow ? "8px 6px" : "8px 10px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: isNarrow ? "wrap" : "nowrap",
              justifyContent: isNarrow ? "center" : "space-between",
              gap: isNarrow ? 8 : 10,
            }}
          >
            <PriceOrb
              candles={topOrbCandlesKn}
              vwap={100 + score * 0.05}
              bid={100 + score * 0.05 - 0.03}
              ask={100 + score * 0.05 + 0.03}
              direction={direction}
            />
            <RiskOrb
              pnl={paperStatus?.account?.unrealized_pl != null ? Number(paperStatus.account.unrealized_pl) : Math.round(score * 20)}
              pnlMax={paperStatus?.account?.equity != null ? Number(paperStatus.account.equity) * 0.05 : 900}
              drawdown={Math.max(0, Math.min(1, (1 - xEnergyScoreKn) * 0.85))}
              maxDrawdown={0.45}
              positionSize={paperStatus?.positions?.length > 0 ? Math.min(1, paperStatus.positions.length / 5) : Math.max(0.08, Math.min(1, convictionKn / 100))}
              direction={direction}
            />
            <ConfluenceOrb
              bankAScore={Math.max(-1, Math.min(1, bankANetKn / 9))}
              bankBScore={Math.max(-1, Math.min(1, bankBNetKn / 9))}
              bankCScore={Math.max(-1, Math.min(1, bankCNetKn / 9))}
              kellyFire={Math.abs(score) >= GO_SCORE_ABS_MIN}
              direction={direction}
            />
            <VolumeOrb
              delta={obi.status === "live" ? (obi.obiSmooth - 0.5) * 2 : Math.max(-1, Math.min(1, score / 27))}
              cumDelta={obi.status === "live" ? (obi.obiRatio - 0.5) * 2 : Math.max(-1, Math.min(1, (score + (bankANetKn - bankCNetKn) * 0.35) / 27))}
              absorption={obi.status === "live" ? Math.max(0.05, Math.min(1, Math.abs(obi.obiSmooth - 0.5) * 2.5)) : Math.max(0.05, Math.min(1, xEnergyScoreKn))}
              tapeSpeed={Math.max(0.2, Math.min(1, 0.4 + convictionKn / 100))}
              direction={direction}
            />
            <TVWebhookOrb
              connected={!dataError}
              lastFiredMs={pollInterval > 0 ? countdown : 0}
              latencyMs={Math.max(22, Math.min(320, Math.round(lastFetchMs)))}
              action={direction === "LONG" ? "BUY" : direction === "SHORT" ? "SELL" : "IDLE"}
              fireCount={fetchCount}
            />
            <IntermarketOrb
              composite={crossData?.composite ?? 0}
              regime={crossData?.regime ?? "UNKNOWN"}
              dims={crossData?.dimensions ?? {}}
            />
            <PositioningOrb
              fearIndex={(() => {
                // fear proxy: rvol rank from activity gate
                const rvol = activityData?.current?.rvol_rank ?? 0.5;
                return Math.max(0, Math.min(1, rvol));
              })()}
              fundingPressure={(() => {
                const sigs = fundingData?.signals ?? {};
                const pressures = Object.values(sigs).map(s => Math.abs(s?.pressure_score ?? 0));
                return pressures.length ? pressures.reduce((a, b) => a + b, 0) / pressures.length : 0;
              })()}
              fundingBias={(() => {
                const sigs = fundingData?.signals ?? {};
                const votes = Object.values(sigs).map(s => s?.signal ?? "NEUTRAL");
                const longs  = votes.filter(v => v === "LONG").length;
                const shorts = votes.filter(v => v === "SHORT").length;
                if (longs > shorts) return "LONG";
                if (shorts > longs) return "SHORT";
                return "NEUTRAL";
              })()}
              longBiasScore={Math.max(-1, Math.min(1, (bankANetKn + bankBNetKn + bankCNetKn) / 27))}
            />
          </div>
        </section>
      ) : null}

      {/* ── COUNTDOWN PROGRESS BAR ── */}
      {pollInterval > 0 && (
        <div style={{ height: 2, background: "#070c12", flexShrink: 0 }}>
          <div style={{
            height: "100%",
            width: `${countdownPct}%`,
            background: `linear-gradient(90deg, #22d3ee, ${direction === "LONG" ? "#4ade80" : direction === "SHORT" ? "#ef4444" : "#818cf8"})`,
            transition: "width 0.1s linear",
            boxShadow: "0 0 6px #22d3ee66",
          }} />
        </div>
      )}

      {/* ── INTEL STRIP — Fear&Greed · OI · Liquidations ── */}
      {(fngIntel || oiIntel || liqIntel) && (
        <div style={{
          display: "flex", alignItems: "center", gap: 16, padding: "5px 16px",
          background: "#040810", borderBottom: "1px solid #0d1f2e",
          flexShrink: 0, flexWrap: "wrap", minHeight: 32,
        }}>
          {/* Fear & Greed */}
          {fngIntel && (() => {
            const v = fngIntel.value;
            const col = v <= 24 ? "#22c55e" : v <= 44 ? "#86efac" : v <= 55 ? "#8899aa" : v <= 74 ? "#fb923c" : "#ef4444";
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 8, color: "#445566", letterSpacing: 1 }}>F&G</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: col, fontFamily: "Barlow Condensed, sans-serif" }}>{v}</span>
                <span style={{ fontSize: 8, color: col }}>{String(fngIntel.label ?? "").replace("_", " ")}</span>
                <span style={{ fontSize: 8, color: "#334455" }}>{fngIntel.mult}×</span>
                <div style={{ width: 40, height: 3, background: "#0d1f2e", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${v}%`, height: "100%", background: col }} />
                </div>
              </div>
            );
          })()}

          <div style={{ width: 1, height: 16, background: "#0d1f2e" }} />

          {/* OI signals */}
          {oiIntel?.signals && (() => {
            const sigs = Object.values(oiIntel.signals).slice(0, 4);
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 8, color: "#445566", letterSpacing: 1 }}>OI</span>
                {sigs.map(s => {
                  const col = s.signal === "TREND_CONFIRM" ? "#22c55e" : s.signal === "EXHAUSTION" ? "#fb923c" : s.signal === "CAPITULATION" ? "#ef4444" : "#8899aa";
                  return (
                    <div key={s.symbol} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      <span style={{ fontSize: 8, color: "#8899aa", fontFamily: "monospace" }}>{String(s.symbol).replace("USDT", "")}</span>
                      <span style={{ fontSize: 7, color: col }}>{s.mult?.toFixed(2)}×</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          <div style={{ width: 1, height: 16, background: "#0d1f2e" }} />

          {/* Liquidations */}
          {liqIntel && (() => {
            const top = (liqIntel.top_symbols ?? []).slice(0, 3);
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 8, color: "#445566", letterSpacing: 1 }}>LIQ</span>
                {top.length > 0 ? top.map(s => {
                  const ratio = s.bullish_ratio ?? 0.5;
                  const col = ratio > 0.65 ? "#22c55e" : ratio < 0.35 ? "#ef4444" : "#8899aa";
                  return (
                    <div key={s.symbol} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      <span style={{ fontSize: 8, color: "#8899aa", fontFamily: "monospace" }}>{String(s.symbol).replace("USDT", "")}</span>
                      <div style={{ width: 24, height: 3, background: "#0d1f2e", borderRadius: 1, overflow: "hidden" }}>
                        <div style={{ width: `${ratio * 100}%`, height: "100%", background: col }} />
                      </div>
                    </div>
                  );
                }) : <span style={{ fontSize: 8, color: "#334455" }}>no daemon</span>}
              </div>
            );
          })()}

          <div style={{ marginLeft: "auto", fontSize: 8, color: "#223344" }}>
            {crossData?.regime && <span style={{ color: crossData.regime === "RISK_ON" ? "#22c55e" : crossData.regime === "RISK_OFF" ? "#ef4444" : "#8899aa", fontWeight: 700 }}>{crossData.regime}</span>}
          </div>
        </div>
      )}

      {/* ── BANK HEADERS ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: activeBank === "ALL" ? (isNarrow ? "1fr" : "1fr 1fr 1fr") : "1fr",
        gap: 1, background: "#0d1520",
        borderBottom: "1px solid #0d1f2e",
        flexShrink: 0,
      }}>
        {(activeBank === "ALL" || activeBank === "A") && (
          <BankHeader label="BANK A · BOOM STRENGTH" sub="9 Algos · Entry Precision" color="#22d3ee"
            long={bankALong} short={bankAShort} total={9} tallies={tallies} bank={BANK_A} />
        )}
        {(activeBank === "ALL" || activeBank === "B") && (
          <BankHeader label="BANK B · ALGORITHM STRATEGIES" sub="9 Algos · Structural Alignment" color="#818cf8"
            long={bankBLong} short={bankBShort} total={9} tallies={tallies} bank={BANK_B} />
        )}
        {(activeBank === "ALL" || activeBank === "C") && (
          <BankHeader label="BANK C · YT LEGEND SURFACE" sub="9 Algos · 1-3-6 Month Surface" color="#4ade80"
            long={bankCLong} short={bankCShort} total={9} tallies={tallies} bank={BANK_C} />
        )}
      </div>

      {/* ── PULSE HERO — THE PULSE OF THE MARKET ── */}
      <PulseHero
        score={score}
        direction={direction}
        votes={votes}
        strengths={strengths}
        isNarrow={isNarrow}
        isWide={isWide}
        activityData={activityData}
        paperStatus={paperStatus}
      />

      {/* Social Alpha: full #warriors only — COUNCIL page already mounts it above this embed (`useShellSync`). */}
      {!useShellSync ? (
        <section aria-label="Social alpha pulse" style={{ flexShrink: 0, borderBottom: "1px solid #0d1f2e", minHeight: 0 }}>
          <div style={{ height: "clamp(300px, 40vh, 460px)", minHeight: 260 }}>
            <SocialAlphaPulse
              data={knightsSocialData}
              maAligned={direction !== "SHORT" || score > -8}
              macroAligned={convictionKn >= 20}
            />
          </div>
        </section>
      ) : null}

      {/* ── MAIN GRID ── */}
      <div style={{
        padding: isNarrow ? 6 : 8,
        display: "grid",
        gridTemplateColumns: activeBank === "ALL"
          ? (isNarrow ? "repeat(3, minmax(0, 1fr))" : "repeat(9, minmax(0, 1fr))")
          : "repeat(3, minmax(0, 1fr))",
        gap: isNarrow ? 6 : 4,
        position: "relative", zIndex: 2,
        alignContent: "start",
      }}>
        {panels.map(panel => (
          <AlgoPanel
            key={panel.id}
            panel={panel}
            vote={votes[panel.id] ?? 0}
            strength={strengths[panel.id] ?? 0}
            tally={tallies[panel.id]}
            payload={payloads[panel.id]}
            isHovered={hoveredPanel === panel.id}
            isPinned={pinnedPanel === panel.id}
            onHover={setHoveredPanel}
            onPinClick={togglePin}
            compact={activeBank === "ALL" && !isNarrow}
          />
        ))}
      </div>

      {/* ── DETAIL PANEL ── */}
      {hovered && (
        <DetailPanel
          panel={hovered}
          vote={votes[hovered.id] ?? 0}
          strength={strengths[hovered.id] ?? 0}
          tally={tallies[hovered.id]}
          payload={payloads[hovered.id]}
          isNarrow={isNarrow}
          onClose={() => { setPinnedPanel(null); setHoveredPanel(null); }}
        />
      )}

      {/* ── ALGO INFO + QUICK BUTTONS ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: 6,
        padding: isNarrow ? "8px 8px 6px" : "8px 10px 6px",
        borderBottom: "1px solid #0d1f2e",
        background: "#050911",
        flexShrink: 0,
        position: "relative",
        zIndex: 8,
      }}>
        <div style={{ border: "1px solid #0d1f2e", background: "#070c12", padding: "5px 6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={() => setIntelOpen((v) => !v)}
              style={{
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: 8,
                letterSpacing: 1.2,
                minHeight: 22,
                padding: "1px 7px",
                border: `1px solid ${intelOpen ? focusPanel.color : "#1a3343"}`,
                background: intelOpen ? `${focusPanel.color}18` : "#04070d",
                color: intelOpen ? focusPanel.color : "#6a8ba0",
                cursor: "pointer",
                touchAction: "manipulation",
                whiteSpace: "nowrap",
                flex: "0 0 auto",
              }}
            >
              {intelOpen ? "CLOSE" : "OPEN"}
            </button>
            <div style={{ display: "flex", gap: 4, overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: 2 }}>
            {ALL_PANELS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setFocusAlgo(p.id);
                  setIntelOpen(true);
                }}
                style={{
                  fontFamily: "'Share Tech Mono', monospace",
                  fontSize: 7,
                  letterSpacing: 0.9,
                  minHeight: 22,
                  padding: "1px 6px",
                  border: `1px solid ${focusPanel.id === p.id ? p.color : "#123"}`,
                  background: focusPanel.id === p.id ? `${p.color}22` : "#04070d",
                  color: focusPanel.id === p.id ? p.color : "#5a7a8a",
                  cursor: "pointer",
                  touchAction: "manipulation",
                  whiteSpace: "nowrap",
                  flex: "0 0 auto",
                }}
                title={`${p.id} · ${p.name}`}
              >
                {p.id}
              </button>
            ))}
            </div>
          </div>
        </div>
        {intelOpen ? (
        <div style={{
          border: `1px solid ${focusPanel.color}33`,
          background: "#070c12",
          boxShadow: `0 0 14px ${focusPanel.color}1f`,
          padding: "7px 8px",
          minHeight: 132,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 14, fontWeight: 900, letterSpacing: 2, color: focusPanel.color,
            }}>
              {focusPanel.id} · {focusPanel.name}
            </div>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 12, letterSpacing: 2,
              color: (votes[focusPanel.id] ?? 0) === 1 ? "#22d3ee" : (votes[focusPanel.id] ?? 0) === -1 ? "#ef4444" : "#4b5563",
            }}>
              {(votes[focusPanel.id] ?? 0) === 1 ? "LONG" : (votes[focusPanel.id] ?? 0) === -1 ? "SHORT" : "FLAT"}
            </div>
          </div>
          <div style={{ fontSize: 8, letterSpacing: 1, color: "#5a7f92", marginTop: 2 }}>{focusPanel.sub}</div>
          <div style={{ fontSize: 8, color: "#3e5f70", lineHeight: 1.7, marginTop: 6 }}>{focusPanel.method}</div>
          <div style={{ marginTop: 6, padding: "6px 7px", border: "1px solid #123", background: "#04070d" }}>
            <div style={{ fontSize: 7, letterSpacing: 1.5, color: "#35556a", marginBottom: 4 }}>FULL BUILD SPEC PSEUDOCODE</div>
            <div style={{ fontSize: 8, color: "#6f9ab1", lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 180, overflowY: "auto" }}>
              {ALGO_BUILD_SPECS[focusPanel.id] ?? "Full pseudocode section not found in source spec yet."}
            </div>
          </div>
          <div style={{ marginTop: 6, padding: "6px 7px", border: "1px solid #123", background: "#04070d" }}>
            <div style={{ fontSize: 7, letterSpacing: 1.5, color: "#35556a", marginBottom: 4 }}>LIVE PAYLOAD FIELDS</div>
            {Object.entries(payloads[focusPanel.id] ?? {}).slice(0, 12).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 8, lineHeight: 1.5 }}>
                <span style={{ color: "#4f7388", whiteSpace: "nowrap" }}>{k}</span>
                <span style={{ color: focusPanel.color, textAlign: "right", overflowWrap: "anywhere" }}>
                  {typeof v === "number" ? v.toFixed(4) : typeof v === "boolean" ? (v ? "true" : "false") : String(v)}
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
            {focusPanel.signals.map((s) => (
              <span key={s} style={{
                fontSize: 7, letterSpacing: 1, color: focusPanel.color,
                border: `1px solid ${focusPanel.color}44`, padding: "1px 5px", background: "#04070d",
              }}>{s}</span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 8 }}>
            <span style={{ color: "#1f3a4a" }}>STR <span style={{ color: focusPanel.color }}>{((strengths[focusPanel.id] ?? 0) * 100).toFixed(0)}%</span></span>
            {tallies[focusPanel.id] ? (
              <>
                <span style={{ color: "#1f3a4a" }}>L <span style={{ color: "#22d3ee" }}>{tallies[focusPanel.id].long_bars}</span></span>
                <span style={{ color: "#1f3a4a" }}>S <span style={{ color: "#ef4444" }}>{tallies[focusPanel.id].short_bars}</span></span>
                <span style={{ color: "#1f3a4a" }}>F <span style={{ color: "#475569" }}>{tallies[focusPanel.id].flat_bars}</span></span>
              </>
            ) : null}
          </div>
        </div>
        ) : null}
      </div>

      {/* ── BOTTOM STATUS BAR ── */}
      <div style={{
        display: "flex", alignItems: "center",
        flexWrap: isNarrow ? "nowrap" : "wrap",
        overflowX: isNarrow ? "auto" : "visible",
        WebkitOverflowScrolling: "touch",
        padding: isNarrow ? "8px 12px" : "0 16px",
        minHeight: 32,
        background: "#070c12",
        borderTop: "1px solid #0d1f2e",
        flexShrink: 0, gap: isNarrow ? 12 : 20, zIndex: 10,
      }}>
        <StatusItem label="JEDI" value={`${score > 0 ? "+" : ""}${score}`} color={dirColor(direction)} />
        <Div />
        <StatusItem label="DIR" value={direction} color={dirColor(direction)} />
        <Div />
        <StatusItem label="SYMBOL" value={symbol} color="#f59e0b" />
        <Div />
        <StatusItem label="BARS" value={String(barCount)} color="#818cf8" />
        <Div />
        <StatusItem label="LAST BAR" value={lastBarTime} color="#22d3ee" />
        <Div />
        <StatusItem label="BANK A" value={`${bankALong}L/${bankAShort}S`} color="#22d3ee" />
        <StatusItem label="BANK B" value={`${bankBLong}L/${bankBShort}S`} color="#818cf8" />
        <StatusItem label="BANK C" value={`${bankCLong}L/${bankCShort}S`} color="#4ade80" />
        <Div />
        {/* Long/Short bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 120 }}>
          <span style={{ fontSize: 7, letterSpacing: 1, color: "#1e3a4a" }}>L/S</span>
          <LongShortBar
            long={bankALong + bankBLong + bankCLong}
            short={bankAShort + bankBShort + bankCShort}
            total={27}
          />
        </div>
        <Div />
        <StatusItem label="FETCH" value={`${lastFetchMs}ms`} color={lastFetchMs > 500 ? "#ef4444" : "#22c55e"} />
        {pollInterval > 0 && (
          <StatusItem label="NEXT" value={`${(countdown / 1000).toFixed(1)}s`} color="#f59e0b" />
        )}
        {!isNarrow && (
          <div style={{ marginLeft: "auto", fontSize: 7, letterSpacing: 1, color: "#0d2030" }}>
            M4D MAXCOGVIZ V1.0 · LIVE · {genAt}
          </div>
        )}
      </div>
    </div>
  );
}

// ── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function BankHeader({ label, sub, color, long, short, total, tallies, bank }) {
  const flat = total - long - short;
  const totalSignals = bank.reduce((a, p) => {
    const t = tallies[p.id];
    return a + (t ? t.long_bars + t.short_bars : 0);
  }, 0);

  return (
    <div style={{ padding: "6px 14px", borderRight: "1px solid #0d1f2e" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 3, color, textTransform: "uppercase" }}>{label}</div>
          <div style={{ fontSize: 8, color: "#1e3a4a", letterSpacing: 1, marginTop: 1 }}>{sub} · {totalSignals} signals</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <TallyBox label="LONG" value={long} color="#22d3ee" />
          <TallyBox label="SHORT" value={short} color="#ef4444" />
          <TallyBox label="FLAT" value={flat} color="#2a3a4a" />
        </div>
      </div>
      <div style={{ display: "flex", height: 2, marginTop: 4, gap: 1 }}>
        {Array.from({ length: total }, (_, i) => {
          const v = i < long ? 1 : i < long + short ? -1 : 0;
          return <div key={i} style={{ flex: 1, background: v === 1 ? "#22d3ee" : v === -1 ? "#ef4444" : "#0d1f2e", borderRadius: 1 }} />;
        })}
      </div>
    </div>
  );
}

function TallyBox({ label, value, color }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 7, color: `${color}66`, letterSpacing: 1 }}>{label}</div>
    </div>
  );
}

function AlgoPanel({ panel, vote, strength, tally, payload, isHovered, isPinned, onHover, onPinClick, compact }) {
  const bg = heatColor(strength * (Math.abs(vote) * 0.4 + 0.3));
  const borderColor = vote === 1 ? "#22d3ee" : vote === -1 ? "#ef4444" : "#0d1f2e";
  const voteIcon = vote === 1 ? "▲" : vote === -1 ? "▼" : "■";
  const voteColor = vote === 1 ? "#22d3ee" : vote === -1 ? "#ef4444" : "#1e3a4a";
  const ring = isPinned ? panel.color : isHovered ? panel.color : borderColor;

  const longPct = tally ? Math.round((tally.long_bars / (tally.long_bars + tally.short_bars + tally.flat_bars)) * 100) : 0;
  const shortPct = tally ? Math.round((tally.short_bars / (tally.long_bars + tally.short_bars + tally.flat_bars)) * 100) : 0;

  return (
    <div
      role="button" tabIndex={0}
      onMouseEnter={() => onHover(panel.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onPinClick?.(panel.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPinClick?.(panel.id); } }}
      style={{
        background: "#070c12",
        border: `1px solid ${ring}`,
        padding: compact ? "6px 8px" : "10px 12px",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        transition: "border-color 0.2s, box-shadow 0.3s",
        minHeight: compact ? 80 : 112,
        touchAction: "manipulation",
        display: "flex",
        flexDirection: "column",
        boxShadow: vote !== 0 ? voteGlow(vote) : (isPinned ? `0 0 0 2px ${panel.color}44` : "none"),
      }}
    >
      <div style={{ position: "absolute", inset: 0, background: bg, opacity: 0.18, transition: "background 0.5s", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: vote !== 0 ? panel.color : "#0d1f2e", opacity: vote !== 0 ? 0.8 : 0.3, transition: "background 0.3s" }} />

      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: compact ? 4 : 6 }}>
        <div>
          <div style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: compact ? 10 : 12,
            fontWeight: 700, letterSpacing: compact ? 1 : 2,
            color: isHovered ? panel.color : (vote !== 0 ? "#c8dae8" : "#3a5a6a"),
            transition: "color 0.2s", lineHeight: 1,
          }}>{panel.name}</div>
          {!compact && (
            <div style={{ fontSize: 8, color: "#1e3a4a", letterSpacing: 1, marginTop: 2 }}>{panel.sub}</div>
          )}
        </div>
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: compact ? 22 : 28, fontWeight: 900, lineHeight: 1,
          color: voteColor,
          textShadow: vote !== 0 ? `0 0 10px ${voteColor}` : "none",
          transition: "color 0.2s, text-shadow 0.2s",
          flexShrink: 0,
        }}>{voteIcon}</div>
      </div>

      {/* TIER + STRENGTH */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: compact ? 3 : 6 }}>
        <span style={{
          fontSize: 7, letterSpacing: 2, padding: "1px 5px",
          border: `1px solid ${TIER_COLORS[panel.tier]}22`,
          color: TIER_COLORS[panel.tier], opacity: 0.7,
        }}>{panel.tier}{panel.horizon ? ` · ${panel.horizon}` : ""}</span>
        {strength > 0 && (
          <span style={{ fontSize: 8, color: voteColor, fontVariantNumeric: "tabular-nums" }}>
            {(strength * 100).toFixed(0)}%
          </span>
        )}
      </div>

      {/* L/S HISTORY BAR */}
      {tally && (longPct > 0 || shortPct > 0) && (
        <div style={{ display: "flex", height: 3, gap: 0, borderRadius: 1, overflow: "hidden", marginBottom: compact ? 2 : 4 }}>
          {longPct > 0 && <div style={{ width: `${longPct}%`, background: "#22d3ee", transition: "width 0.5s" }} />}
          {shortPct > 0 && <div style={{ width: `${shortPct}%`, background: "#ef4444", transition: "width 0.5s" }} />}
          <div style={{ flex: 1, background: "#0d1520" }} />
        </div>
      )}

      {/* STRENGTH BAR */}
      <div style={{ height: 2, background: "#0d1520", borderRadius: 1, marginTop: "auto" }}>
        <div style={{
          height: "100%",
          width: `${strength * 100}%`,
          background: vote === 1 ? "#22d3ee" : vote === -1 ? "#ef4444" : "#1e3a4a",
          borderRadius: 1,
          transition: "width 0.6s, background 0.3s",
          boxShadow: vote !== 0 ? `0 0 4px ${voteColor}` : "none",
        }} />
      </div>

      {/* SIGNAL CHIPS */}
      {!compact && (
        <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
          {panel.signals.map(s => (
            <div key={s} style={{
              fontSize: 7, letterSpacing: 0.5, padding: "1px 4px",
              background: "#04060a",
              border: `1px solid ${vote !== 0 ? panel.color + "33" : "#0d1f2e"}`,
              color: vote !== 0 ? panel.color : "#1e3a4a",
              transition: "all 0.3s",
            }}>{s}</div>
          ))}
        </div>
      )}

      <div style={{ position: "absolute", bottom: 3, right: 6, fontSize: 7, color: "#0d1f2e", letterSpacing: 1, fontVariantNumeric: "tabular-nums" }}>{panel.slot}</div>
    </div>
  );
}

function DetailPanel({ panel, vote, strength, tally, payload, isNarrow, onClose }) {
  const voteLabel = vote === 1 ? "LONG" : vote === -1 ? "SHORT" : "FLAT";
  const voteColor = vote === 1 ? "#22d3ee" : vote === -1 ? "#ef4444" : "#4b5563";

  const payloadEntries = payload && typeof payload === "object"
    ? Object.entries(payload).filter(([k]) => k !== "stub" && k !== "note" && k !== "algo_id" && k !== "reason")
    : [];

  return (
    <div style={{
      position: "fixed",
      bottom: "max(12px, env(safe-area-inset-bottom, 0px))",
      right: 12,
      left: isNarrow ? 12 : "auto",
      width: isNarrow ? "auto" : 320,
      maxWidth: "min(420px, 92vw)",
      zIndex: 4500,
      background: "#070c12", border: `1px solid ${panel.color}44`,
      padding: "12px 14px",
      boxShadow: `0 0 20px ${panel.color}22`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ width: 8, height: 8, background: panel.color, borderRadius: 1 }} />
        <div style={{ flex: 1, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 700, color: panel.color, letterSpacing: 2 }}>{panel.name}</div>
        <div style={{ fontSize: 10, fontWeight: 900, color: voteColor, letterSpacing: 2, fontFamily: "'Barlow Condensed', sans-serif" }}>
          {voteLabel}
        </div>
        <button type="button" onClick={onClose} style={{
          background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 16, padding: 4, touchAction: "manipulation",
        }} aria-label="Close">✕</button>
      </div>

      <div style={{ fontSize: 9, color: "#5a8a9a", lineHeight: 1.7, marginBottom: 6 }}>{panel.sub}</div>
      <div style={{ fontSize: 8, color: "#3a5a6a", lineHeight: 1.8, marginBottom: 8 }}>{panel.method}</div>

      {/* Strength + Vote */}
      <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 9 }}>
        <div>
          <span style={{ color: "#1e3a4a", letterSpacing: 1 }}>STR </span>
          <span style={{ color: voteColor, fontWeight: 700 }}>{(strength * 100).toFixed(1)}%</span>
        </div>
        {tally && (
          <>
            <div><span style={{ color: "#1e3a4a" }}>L </span><span style={{ color: "#22d3ee" }}>{tally.long_bars}</span></div>
            <div><span style={{ color: "#1e3a4a" }}>S </span><span style={{ color: "#ef4444" }}>{tally.short_bars}</span></div>
            <div><span style={{ color: "#1e3a4a" }}>F </span><span style={{ color: "#2a3a4a" }}>{tally.flat_bars}</span></div>
          </>
        )}
      </div>

      {/* Payload data */}
      {payloadEntries.length > 0 && (
        <div style={{ background: "#04060a", border: "1px solid #0d1f2e", padding: "6px 8px", marginBottom: 8 }}>
          <div style={{ fontSize: 7, letterSpacing: 2, color: "#1e3a4a", marginBottom: 4 }}>PAYLOAD</div>
          {payloadEntries.map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 8, lineHeight: 1.8 }}>
              <span style={{ color: "#3a5a6a" }}>{k}</span>
              <span style={{ color: panel.color, fontVariantNumeric: "tabular-nums" }}>
                {typeof v === "number" ? v.toFixed(4) : typeof v === "boolean" ? (v ? "true" : "false") : String(v)}
              </span>
            </div>
          ))}
        </div>
      )}

      {panel.horizon && (
        <div style={{ fontSize: 8, letterSpacing: 2, color: "#4ade80" }}>HORIZON: {panel.horizon}</div>
      )}
      <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
        {panel.signals.map(s => (
          <span key={s} style={{ fontSize: 7, padding: "1px 5px", border: `1px solid ${panel.color}44`, color: panel.color, letterSpacing: 1 }}>{s}</span>
        ))}
      </div>
    </div>
  );
}

function LongShortBar({ long, short, total }) {
  const w = 80;
  const lw = (long / total) * w;
  const sw = (short / total) * w;
  return (
    <svg width={w} height={8}>
      <rect x={0} y={0} width={w} height={8} fill="#0d1520" rx={1} />
      {lw > 0 && <rect x={0} y={0} width={lw} height={8} fill="#22d3ee" rx={1} />}
      {sw > 0 && <rect x={w - sw} y={0} width={sw} height={8} fill="#ef4444" rx={1} />}
    </svg>
  );
}

function StatusItem({ label, value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ fontSize: 7, letterSpacing: 1.5, color: "#0d2030", textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 700, color, letterSpacing: 1 }}>{value}</span>
    </div>
  );
}

function Div() {
  return <div style={{ width: 1, height: 14, background: "#0d1f2e" }} />;
}
