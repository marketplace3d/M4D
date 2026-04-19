"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

// ─── Types ───────────────────────────────────────────────────────────────────

interface Candle {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
}

interface Position {
  pair: string;
  entry: number;
  qty: number;
  amount: number;
  entryTime: number;
}

interface Trade {
  pair: string;
  entry: number;
  exit: number;
  pnl: number;
  pnlPct: number;
  exitTime: number;
  entryTime: number;
  reason: string;
}

type LogType = "info" | "buy" | "sell" | "warn" | "sys";

interface LogEntry {
  time: string;
  msg: string;
  type: LogType;
}

type Signal = "BUY" | "SELL" | "HOLD";
type Strategy = "rsi" | "macd" | "sma" | "breakout";
type Pair = "BTCUSDT" | "ETHUSDT" | "SOLUSDT" | "BNBUSDT" | "XRPUSDT" | "DOGEUSDT";
type Interval = "1m" | "5m" | "15m" | "1h" | "4h";

// ─── Constants ────────────────────────────────────────────────────────────────

const INIT_CASH = 10_000;
const PAIRS: Pair[] = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
const INTERVALS: Interval[] = ["1m", "5m", "15m", "1h", "4h"];
const STRATEGIES: { value: Strategy; label: string }[] = [
  { value: "rsi", label: "RSI Reversal" },
  { value: "macd", label: "MACD Crossover" },
  { value: "sma", label: "SMA Crossover" },
  { value: "breakout", label: "Breakout" },
];

const LOG_COLORS: Record<LogType, string> = {
  info: "var(--color-text-primary, #111)",
  buy: "#1a9e6e",
  sell: "#d94040",
  warn: "#f0a500",
  sys: "#888",
};

// ─── Indicator helpers ────────────────────────────────────────────────────────

function calcSMA(arr: number[], n: number): number | null {
  if (arr.length < n) return null;
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n;
}

function calcRSI(closes: number[], n = 14): number | null {
  if (closes.length < n + 1) return null;
  const sliced = closes.slice(-n - 1);
  let gains = 0,
    losses = 0;
  for (let i = 1; i < sliced.length; i++) {
    const d = sliced[i] - sliced[i - 1];
    if (d > 0) gains += d;
    else losses -= d;
  }
  const rs = gains / (losses || 0.0001);
  return 100 - 100 / (1 + rs);
}

function calcMACD(closes: number[]): { macd: number | null; signal: number | null } {
  if (closes.length < 26) return { macd: null, signal: null };
  const ema = (arr: number[], n: number): number => {
    const k = 2 / (n + 1);
    let e = arr.slice(0, n).reduce((a, b) => a + b, 0) / n;
    for (let i = n; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
    return e;
  };
  const macd = ema(closes, 12) - ema(closes, 26);
  return { macd, signal: macd * 0.9 };
}

function computeSignal(
  closes: number[],
  rsi: number | null,
  sma20: number | null,
  macd: number | null,
  last: number,
  strat: Strategy
): Signal {
  if (!rsi || !sma20) return "HOLD";
  switch (strat) {
    case "rsi":
      if (rsi < 32) return "BUY";
      if (rsi > 68) return "SELL";
      return "HOLD";
    case "macd":
      if (macd === null) return "HOLD";
      return macd > 0 ? "BUY" : "SELL";
    case "sma": {
      const sma5 = calcSMA(closes, 5);
      if (!sma5) return "HOLD";
      return sma5 > sma20 ? "BUY" : "SELL";
    }
    case "breakout": {
      const window = closes.slice(-20);
      const maxH = Math.max(...window.slice(0, -1));
      const minL = Math.min(...window.slice(0, -1));
      if (last > maxH) return "BUY";
      if (last < minL) return "SELL";
      return "HOLD";
    }
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div style={{ background: "var(--surface)", borderRadius: 8, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--color-text-secondary, #888)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 500 }} className={className}>
        {value}
      </div>
    </div>
  );
}

function SignalBadge({ signal }: { signal: Signal }) {
  const styles: Record<Signal, { bg: string; color: string }> = {
    BUY: { bg: "#1a9e6e22", color: "#1a9e6e" },
    SELL: { bg: "#d9404022", color: "#d94040" },
    HOLD: { bg: "#f0a50022", color: "#f0a500" },
  };
  return (
    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 500, ...styles[signal] }}>
      {signal}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CryptoTradingBot() {
  // State
  const [candles, setCandles] = useState<Candle[]>([]);
  const [pair, setPair] = useState<Pair>("BTCUSDT");
  const [interval, setIntervalVal] = useState<Interval>("5m");
  const [strategy, setStrategy] = useState<Strategy>("rsi");
  const [tradeSize, setTradeSize] = useState(20);
  const [stopLoss, setStopLoss] = useState(3);
  const [takeProfit, setTakeProfit] = useState(6);
  const [botRunning, setBotRunning] = useState(false);
  const [cash, setCash] = useState(INIT_CASH);
  const [position, setPosition] = useState<Position | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [winCount, setWinCount] = useState(0);
  const [lossCount, setLossCount] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: "00:00:00", msg: "System initialised. Select a strategy and press Start Bot.", type: "sys" },
  ]);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number | null>(null);

  // Indicators
  const [rsi, setRsi] = useState<number | null>(null);
  const [sma20val, setSma20val] = useState<number | null>(null);
  const [macdVal, setMacdVal] = useState<number | null>(null);
  const [signal, setSignal] = useState<Signal>("HOLD");

  const botIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const positionRef = useRef<Position | null>(null);
  const cashRef = useRef(INIT_CASH);
  const winRef = useRef(0);
  const lossRef = useRef(0);
  const tradesRef = useRef<Trade[]>([]);

  // Keep refs in sync
  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => { cashRef.current = cash; }, [cash]);
  useEffect(() => { winRef.current = winCount; }, [winCount]);
  useEffect(() => { lossRef.current = lossCount; }, [lossCount]);
  useEffect(() => { tradesRef.current = trades; }, [trades]);

  // ── Logging ──────────────────────────────────────────────────────────────

  const addLog = useCallback((msg: string, type: LogType = "info") => {
    const time = new Date().toLocaleTimeString("en", { hour12: false });
    setLogs((prev) => [{ time, msg, type }, ...prev].slice(0, 50));
  }, []);

  // ── Fetch data ───────────────────────────────────────────────────────────

  const fetchData = useCallback(
    async (overridePair?: Pair, overrideInterval?: Interval): Promise<Candle[]> => {
      const p = overridePair ?? pair;
      const iv = overrideInterval ?? interval;
      try {
        const res = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${p}&interval=${iv}&limit=80`
        );
        const data: [number, string, string, string, string, string][] = await res.json();
        const newCandles: Candle[] = data.map((k) => ({
          t: k[0],
          open: +k[1],
          high: +k[2],
          low: +k[3],
          close: +k[4],
          vol: +k[5],
        }));
        setCandles(newCandles);

        const last = newCandles[newCandles.length - 1];
        const prev = newCandles[newCandles.length - 2];
        setLivePrice(last.close);
        setPriceChange(((last.close - prev.close) / prev.close) * 100);

        // Update indicators
        const closes = newCandles.map((c) => c.close);
        const r = calcRSI(closes);
        const s20 = calcSMA(closes, 20);
        const { macd } = calcMACD(closes);
        setRsi(r);
        setSma20val(s20);
        setMacdVal(macd);
        setSignal(computeSignal(closes, r, s20, macd, last.close, strategy));

        return newCandles;
      } catch (e) {
        addLog("Failed to fetch data: " + (e as Error).message, "warn");
        return [];
      }
    },
    [pair, interval, strategy, addLog]
  );

  // ── Trade actions ─────────────────────────────────────────────────────────

  const openTrade = useCallback(
    (price: number, currentCandles: Candle[], currentCash: number, currentPair: Pair) => {
      if (positionRef.current) { addLog("Already in a position", "warn"); return; }
      const pct = tradeSize / 100;
      const amount = currentCash * pct;
      const qty = amount / price;
      const newPos: Position = {
        pair: currentPair,
        entry: price,
        qty,
        amount,
        entryTime: currentCandles[currentCandles.length - 1]?.t ?? 0,
      };
      setPosition(newPos);
      positionRef.current = newPos;
      const newCash = currentCash - amount;
      setCash(newCash);
      cashRef.current = newCash;
      addLog(
        `OPEN LONG ${currentPair} @ $${price.toFixed(2)} | Qty: ${qty.toFixed(6)} | Size: $${amount.toFixed(2)}`,
        "buy"
      );
    },
    [tradeSize, addLog]
  );

  const closeTrade = useCallback(
    (price: number, currentCandles: Candle[], reason = "", currentPos?: Position | null) => {
      const pos = currentPos ?? positionRef.current;
      if (!pos) { addLog("No position to close", "warn"); return; }
      const exitVal = pos.qty * price;
      const pnl = exitVal - pos.amount;
      const pnlPct = (pnl / pos.amount) * 100;
      const newCash = cashRef.current + exitVal;
      setCash(newCash);
      cashRef.current = newCash;

      if (pnl > 0) { setWinCount((w) => w + 1); winRef.current++; }
      else { setLossCount((l) => l + 1); lossRef.current++; }

      const trade: Trade = {
        pair: pos.pair,
        entry: pos.entry,
        exit: price,
        pnl,
        pnlPct,
        exitTime: currentCandles[currentCandles.length - 1]?.t ?? 0,
        entryTime: pos.entryTime,
        reason,
      };
      setTrades((prev) => [trade, ...prev]);
      tradesRef.current = [trade, ...tradesRef.current];
      setPosition(null);
      positionRef.current = null;
      addLog(
        `CLOSE LONG ${pos.pair} @ $${price.toFixed(2)} | PnL: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%) ${reason}`,
        pnl >= 0 ? "buy" : "sell"
      );
    },
    [addLog]
  );

  const checkSLTP = useCallback(
    (price: number, currentCandles: Candle[]) => {
      const pos = positionRef.current;
      if (!pos) return;
      const slPrice = pos.entry * (1 - stopLoss / 100);
      const tpPrice = pos.entry * (1 + takeProfit / 100);
      if (price <= slPrice) {
        addLog(`Stop loss hit @ $${price.toFixed(2)}`, "sell");
        closeTrade(price, currentCandles, "SL");
      } else if (price >= tpPrice) {
        addLog(`Take profit hit @ $${price.toFixed(2)}`, "buy");
        closeTrade(price, currentCandles, "TP");
      }
    },
    [stopLoss, takeProfit, closeTrade, addLog]
  );

  // ── Bot tick ──────────────────────────────────────────────────────────────

  const botTick = useCallback(async () => {
    const newCandles = await fetchData();
    if (!newCandles.length) return;
    const closes = newCandles.map((c) => c.close);
    const price = closes[closes.length - 1];
    const r = calcRSI(closes);
    const s20 = calcSMA(closes, 20);
    const { macd } = calcMACD(closes);
    const sig = computeSignal(closes, r, s20, macd, price, strategy);
    checkSLTP(price, newCandles);
    if (sig === "BUY" && !positionRef.current)
      openTrade(price, newCandles, cashRef.current, pair);
    else if (sig === "SELL" && positionRef.current)
      closeTrade(price, newCandles, "Signal");
  }, [fetchData, strategy, checkSLTP, openTrade, closeTrade, pair]);

  // ── Bot toggle ────────────────────────────────────────────────────────────

  const toggleBot = useCallback(() => {
    if (!botRunning) {
      setBotRunning(true);
      addLog(`Bot started — ${strategy} strategy on ${pair}`, "sys");
      fetchData();
      botIntervalRef.current = setInterval(botTick, 30_000);
    } else {
      setBotRunning(false);
      if (botIntervalRef.current) clearInterval(botIntervalRef.current);
      addLog("Bot stopped", "sys");
    }
  }, [botRunning, strategy, pair, fetchData, botTick, addLog]);

  // Cleanup on unmount
  useEffect(() => () => { if (botIntervalRef.current) clearInterval(botIntervalRef.current); }, []);

  const resetPaper = useCallback(() => {
    if (positionRef.current && candles.length)
      closeTrade(candles[candles.length - 1].close, candles, "Reset");
    setCash(INIT_CASH);
    cashRef.current = INIT_CASH;
    setTrades([]);
    tradesRef.current = [];
    setWinCount(0); winRef.current = 0;
    setLossCount(0); lossRef.current = 0;
    setPosition(null); positionRef.current = null;
    addLog(`Paper account reset to $${INIT_CASH}`, "sys");
  }, [candles, closeTrade, addLog]);

  const manualTrade = useCallback(
    (side: "BUY" | "SELL") => {
      if (!candles.length) { addLog("No data loaded. Fetch data first.", "warn"); return; }
      const price = candles[candles.length - 1].close;
      if (side === "BUY") openTrade(price, candles, cashRef.current, pair);
      else if (positionRef.current) closeTrade(price, candles, "Manual");
      else addLog("No position to sell", "warn");
    },
    [candles, pair, openTrade, closeTrade, addLog]
  );

  // ── Derived metrics ───────────────────────────────────────────────────────

  const currentPrice = livePrice ?? 0;
  const posVal = position ? position.qty * currentPrice : 0;
  const totalPortfolio = cash + posVal;
  const pnl = totalPortfolio - INIT_CASH;
  const totalTrades = winCount + lossCount;
  const winRate = totalTrades ? Math.round((winCount / totalTrades) * 100) : null;

  const unrealisedPnl = position ? (currentPrice - position.entry) * position.qty : 0;
  const unrealisedPct = position ? ((currentPrice - position.entry) / position.entry) * 100 : 0;

  // ── Chart data ────────────────────────────────────────────────────────────

  const closes = candles.map((c) => c.close);
  const labels = candles.map((c) =>
    new Date(c.t).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false })
  );
  const sma20Data = closes.map((_, i, arr) =>
    i >= 19 ? arr.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20 : null
  );

  const priceColor = closes.length && closes[closes.length - 1] >= closes[0] ? "#1a9e6e" : "#d94040";

  const chartData = {
    labels,
    datasets: [
      {
        label: "Price",
        data: closes,
        borderColor: priceColor,
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.2,
        fill: false,
      },
      {
        label: "SMA20",
        data: sma20Data,
        borderColor: "#f0a500",
        borderWidth: 1,
        pointRadius: 0,
        tension: 0.2,
        fill: false,
        borderDash: [4, 2],
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { mode: "index" as const, intersect: false } },
    scales: {
      x: {
        ticks: { color: "#888", font: { size: 9 }, maxTicksLimit: 10, maxRotation: 0 },
        grid: { color: "#00000012" },
      },
      y: {
        ticks: { color: "#888", font: { size: 9 }, callback: (v: number | string) => "$" + Number(v).toLocaleString() },
        grid: { color: "#00000012" },
      },
    },
  } as const;

  // ── Styles ────────────────────────────────────────────────────────────────

  const s = {
    root: {
      fontFamily: "'Courier New', monospace",
      color: "var(--color-text-primary, #111)",
      padding: 0,
      "--surface": "var(--color-background-secondary, #f5f5f5)",
      "--border": "var(--color-border-tertiary, rgba(0,0,0,0.1))",
    } as React.CSSProperties,
    panel: {
      background: "var(--color-background-primary, #fff)",
      border: "0.5px solid var(--border)",
      borderRadius: 10,
      padding: 14,
    } as React.CSSProperties,
    btn: {
      border: "0.5px solid var(--border)",
      borderRadius: 6,
      padding: "6px 14px",
      fontFamily: "inherit",
      fontSize: 12,
      background: "var(--surface)",
      color: "var(--color-text-primary, #111)",
      cursor: "pointer",
    } as React.CSSProperties,
    btnAccent: {
      background: "#f0a500",
      color: "#000",
      borderColor: "#f0a500",
      fontWeight: 500,
      borderRadius: 6,
      padding: "6px 14px",
      fontFamily: "inherit",
      fontSize: 12,
      cursor: "pointer",
    } as React.CSSProperties,
    btnRed: {
      background: "#d9404018",
      color: "#d94040",
      borderColor: "#d9404044",
      borderRadius: 6,
      padding: "6px 14px",
      fontFamily: "inherit",
      fontSize: 12,
      cursor: "pointer",
      border: "0.5px solid",
    } as React.CSSProperties,
    select: {
      fontFamily: "inherit",
      fontSize: 12,
      border: "0.5px solid var(--border)",
      borderRadius: 6,
      padding: "5px 10px",
      background: "var(--surface)",
      color: "var(--color-text-primary, #111)",
    } as React.CSSProperties,
    label: { fontSize: 11, color: "var(--color-text-secondary, #888)", marginBottom: 4 } as React.CSSProperties,
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18, fontWeight: 500 }}>⬡ CryptoBot</span>
          <span
            style={{
              fontSize: 11,
              color: "var(--color-text-secondary, #888)",
              background: "var(--surface)",
              padding: "2px 8px",
              borderRadius: 4,
              border: "0.5px solid var(--border)",
            }}
          >
            PAPER TRADING
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              display: "inline-block",
              marginRight: 5,
              background: botRunning ? "#1a9e6e" : "#f0a500",
              boxShadow: botRunning ? "0 0 0 2px #1a9e6e33" : "none",
            }}
          />
          <span style={{ fontSize: 12 }}>{botRunning ? "Running" : "Idle"}</span>
          <button
            style={botRunning ? s.btnRed : s.btnAccent}
            onClick={toggleBot}
          >
            {botRunning ? "Stop Bot" : "Start Bot"}
          </button>
          <button style={s.btn} onClick={resetPaper}>Reset</button>
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: 14 }}>
        <MetricCard label="Portfolio" value={"$" + totalPortfolio.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} />
        <MetricCard label="Cash" value={"$" + cash.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} />
        <MetricCard
          label="P&L"
          value={(pnl >= 0 ? "+" : "") + "$" + pnl.toFixed(2)}
          className={pnl >= 0 ? "pos" : "neg"}
        />
        <MetricCard label="Win Rate" value={winRate !== null ? winRate + "%" : "—"} />
        <MetricCard label="Trades" value={String(totalTrades)} />
      </div>

      {/* Chart + Strategy */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 12, marginBottom: 14 }}>
        {/* Chart */}
        <div style={s.panel}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                style={s.select}
                value={pair}
                onChange={(e) => setPair(e.target.value as Pair)}
              >
                {PAIRS.map((p) => (
                  <option key={p} value={p}>
                    {p.replace("USDT", "/USDT")}
                  </option>
                ))}
              </select>
              <select
                style={s.select}
                value={interval}
                onChange={(e) => setIntervalVal(e.target.value as Interval)}
              >
                {INTERVALS.map((iv) => (
                  <option key={iv} value={iv}>{iv}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18, fontWeight: 500 }}>
                {livePrice ? "$" + livePrice.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : "—"}
              </span>
              {priceChange !== null && (
                <span style={{ fontSize: 12, color: priceChange >= 0 ? "#1a9e6e" : "#d94040" }}>
                  {(priceChange >= 0 ? "+" : "") + priceChange.toFixed(2) + "%"}
                </span>
              )}
              <button style={{ ...s.btn, fontSize: 11 }} onClick={() => fetchData()}>↻ Refresh</button>
            </div>
          </div>
          <div style={{ position: "relative", height: 240 }}>
            {candles.length > 0 ? (
              <Line data={chartData} options={chartOptions} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--color-text-secondary, #888)", fontSize: 13 }}>
                Press ↻ Refresh to load chart data
              </div>
            )}
          </div>
          {/* Indicators row */}
          <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 11, color: "var(--color-text-secondary, #888)" }}>
            <span>RSI: <b style={{ color: "var(--color-text-primary, #111)" }}>{rsi ? rsi.toFixed(1) : "—"}</b></span>
            <span>SMA20: <b style={{ color: "var(--color-text-primary, #111)" }}>{sma20val ? "$" + sma20val.toFixed(2) : "—"}</b></span>
            <span>MACD: <b style={{ color: "var(--color-text-primary, #111)" }}>{macdVal ? macdVal.toFixed(2) : "—"}</b></span>
            <span>Signal: <SignalBadge signal={signal} /></span>
          </div>
        </div>

        {/* Strategy Panel */}
        <div style={{ ...s.panel, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Strategy Config</div>

          <div>
            <div style={s.label}>Strategy</div>
            <select style={{ ...s.select, width: "100%" }} value={strategy} onChange={(e) => setStrategy(e.target.value as Strategy)}>
              {STRATEGIES.map((st) => (
                <option key={st.value} value={st.value}>{st.label}</option>
              ))}
            </select>
          </div>

          <div>
            <div style={s.label}>Trade Size (% of cash)</div>
            <input type="range" min={5} max={50} value={tradeSize} style={{ width: "100%" }} onChange={(e) => setTradeSize(+e.target.value)} />
            <span style={{ fontSize: 12 }}>{tradeSize}%</span>
          </div>

          <div>
            <div style={s.label}>Stop Loss %</div>
            <input type="range" min={1} max={15} value={stopLoss} style={{ width: "100%" }} onChange={(e) => setStopLoss(+e.target.value)} />
            <span style={{ fontSize: 12 }}>{stopLoss}%</span>
          </div>

          <div>
            <div style={s.label}>Take Profit %</div>
            <input type="range" min={2} max={30} value={takeProfit} style={{ width: "100%" }} onChange={(e) => setTakeProfit(+e.target.value)} />
            <span style={{ fontSize: 12 }}>{takeProfit}%</span>
          </div>

          <div style={{ marginTop: "auto" }}>
            <button style={{ ...s.btnAccent, width: "100%", marginBottom: 6 }} onClick={() => manualTrade("BUY")}>
              Manual BUY
            </button>
            <button style={{ ...s.btnRed, width: "100%" }} onClick={() => manualTrade("SELL")}>
              Manual SELL
            </button>
          </div>
        </div>
      </div>

      {/* Open Position + Trade History */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        {/* Open Position */}
        <div style={s.panel}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 10, color: "var(--color-text-secondary, #888)" }}>
            Open Position
          </div>
          {position ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
                {[
                  ["Pair", position.pair],
                  ["Side", <span key="side" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 500, background: "#1a9e6e22", color: "#1a9e6e" }}>LONG</span>],
                  ["Entry", "$" + position.entry.toFixed(2)],
                  ["Current", "$" + currentPrice.toFixed(2)],
                  ["Unrealised P&L",
                    <b key="upnl" style={{ color: unrealisedPnl >= 0 ? "#1a9e6e" : "#d94040" }}>
                      {unrealisedPnl >= 0 ? "+" : ""}${unrealisedPnl.toFixed(2)} ({unrealisedPct.toFixed(1)}%)
                    </b>
                  ],
                  ["Qty", position.qty.toFixed(6)],
                  ["Stop Loss", <b key="sl" style={{ color: "#d94040" }}>${(position.entry * (1 - stopLoss / 100)).toFixed(2)}</b>],
                  ["Take Profit", <b key="tp" style={{ color: "#1a9e6e" }}>${(position.entry * (1 + takeProfit / 100)).toFixed(2)}</b>],
                ].map(([label, val]) => (
                  <div key={String(label)}>
                    <span style={{ color: "var(--color-text-secondary, #888)" }}>{label}</span>
                    <br />
                    <b>{val}</b>
                  </div>
                ))}
              </div>
              <button
                style={{ ...s.btnRed, width: "100%", marginTop: 10 }}
                onClick={() => { if (candles.length) closeTrade(candles[candles.length - 1].close, candles, "Manual"); }}
              >
                Close Position
              </button>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "var(--color-text-secondary, #888)", textAlign: "center", padding: "20px 0" }}>
              No open position
            </div>
          )}
        </div>

        {/* Trade History */}
        <div style={s.panel}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 10, color: "var(--color-text-secondary, #888)" }}>
            Trade History
          </div>
          <div style={{ overflowY: "auto", maxHeight: 130 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {["Pair", "Side", "Entry", "Exit", "P&L"].map((h) => (
                    <th key={h} style={{ padding: "7px 10px", borderBottom: "0.5px solid var(--border)", textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-secondary, #888)", fontWeight: 500 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "var(--color-text-secondary, #888)", padding: "12px 10px" }}>
                      No trades yet
                    </td>
                  </tr>
                ) : (
                  trades.slice(0, 20).map((t, i) => (
                    <tr key={i}>
                      <td style={{ padding: "7px 10px", borderBottom: "0.5px solid var(--border)" }}>{t.pair}</td>
                      <td style={{ padding: "7px 10px", borderBottom: "0.5px solid var(--border)" }}>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 500, background: "#1a9e6e22", color: "#1a9e6e" }}>LONG</span>
                      </td>
                      <td style={{ padding: "7px 10px", borderBottom: "0.5px solid var(--border)" }}>${t.entry.toFixed(2)}</td>
                      <td style={{ padding: "7px 10px", borderBottom: "0.5px solid var(--border)" }}>${t.exit.toFixed(2)}</td>
                      <td style={{ padding: "7px 10px", borderBottom: "0.5px solid var(--border)", color: t.pnl >= 0 ? "#1a9e6e" : "#d94040" }}>
                        {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Bot Log */}
      <div style={s.panel}>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8, color: "var(--color-text-secondary, #888)" }}>
          Bot Log
        </div>
        <div style={{ maxHeight: 120, overflowY: "auto" }}>
          {logs.map((entry, i) => (
            <div key={i} style={{ fontSize: 11, padding: "3px 0", borderBottom: "0.5px solid var(--border)", display: "flex", gap: 10 }}>
              <span style={{ color: "var(--color-text-secondary, #888)", minWidth: 60 }}>{entry.time}</span>
              <span style={{ color: LOG_COLORS[entry.type] }}>{entry.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}