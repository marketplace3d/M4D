import { useState, useEffect, useRef, useCallback } from "react";

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────
const T = {
  bg0: "#030810",
  bg1: "#060d1a",
  bg2: "#0a1628",
  bg3: "#0d1e35",
  bg4: "#111f38",
  blue: "#3a8fff",
  blueD: "#1a5fcc",
  blueDD: "#0d3a7a",
  green: "#1dff7a",
  greenD: "#0faa50",
  greenDD: "#082a14",
  gold: "#ffcc3a",
  goldD: "#c8940a",
  goldDD: "#2a1800",
  purple: "#b07aff",
  purpleD: "#6a3acc",
  purpleDD: "#1a0a3a",
  red: "#ff4a5a",
  redD: "#aa1a28",
  redDD: "#1a0508",
  teal: "#2ae8e8",
  tealD: "#0a8888",
  orange: "#ff8a3a",
  text: "#c8d8f0",
  text2: "#6a8aae",
  text3: "#2a4a6e",
  border: "#0d2040",
  border2: "#162a4a",
  mono: "'SF Mono','Fira Mono','JetBrains Mono','Courier New',monospace",
};

// ─── MICRO COMPONENTS ────────────────────────────────────────────────────────
const Badge = ({ color = "blue", children, size = "sm" }) => {
  const colors = {
    green: { bg: T.greenDD, border: T.greenD, text: T.green },
    gold:  { bg: T.goldDD,  border: T.goldD,  text: T.gold  },
    red:   { bg: T.redDD,   border: T.redD,   text: T.red   },
    blue:  { bg: T.blueDD,  border: T.blueD,  text: T.blue  },
    purple:{ bg: T.purpleDD,border: T.purpleD,text: T.purple },
    gray:  { bg: T.bg3,     border: T.border2,text: T.text2 },
    teal:  { bg:"#061818",  border: T.tealD,  text: T.teal  },
    orange:{ bg:"#1a0d00",  border:"#6a3a00", text: T.orange},
  };
  const c = colors[color] || colors.blue;
  const pad = size === "xs" ? "1px 4px" : size === "sm" ? "2px 6px" : "3px 10px";
  const fs = size === "xs" ? 8 : size === "sm" ? 9 : 10;
  return (
    <span style={{
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      padding: pad, fontSize: fs, fontFamily: T.mono,
      borderRadius: 2, fontWeight: 700, letterSpacing: "0.06em",
      whiteSpace: "nowrap", display: "inline-block",
    }}>{children}</span>
  );
};

const PanelHead = ({ color = "blue", children, right }) => {
  const accent = {
    blue: T.blue, green: T.green, gold: T.gold,
    purple: T.purple, red: T.red, teal: T.teal, orange: T.orange,
  }[color] || T.blue;
  return (
    <div style={{
      padding: "5px 10px", background: T.bg0,
      borderBottom: `1px solid ${T.border2}`,
      display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <span style={{
        fontSize: 9, fontFamily: T.mono, fontWeight: 700,
        color: accent, letterSpacing: "0.14em", textTransform: "uppercase",
      }}>{children}</span>
      {right && <div style={{ display: "flex", gap: 4, alignItems: "center" }}>{right}</div>}
    </div>
  );
};

const Panel = ({ color = "blue", head, right, children, style = {} }) => (
  <div style={{
    background: T.bg2, border: `1px solid ${T.border}`,
    borderRadius: 3, overflow: "hidden", display: "flex", flexDirection: "column",
    ...style,
  }}>
    <PanelHead color={color} right={right}>{head}</PanelHead>
    <div style={{ flex: 1, overflow: "hidden" }}>{children}</div>
  </div>
);

const StatRow = ({ label, value, valueColor, mono = true, border = true }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "3px 0",
    borderBottom: border ? `1px solid ${T.border}` : "none",
  }}>
    <span style={{ fontSize: 10, color: T.text2, fontFamily: mono ? T.mono : "inherit" }}>{label}</span>
    <span style={{ fontSize: 10, color: valueColor || T.text, fontFamily: mono ? T.mono : "inherit", fontWeight: 600 }}>{value}</span>
  </div>
);

const Toggle = ({ on, onToggle, label, badge, badgeColor = "green" }) => (
  <div
    onClick={onToggle}
    style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "4px 0", borderBottom: `1px solid ${T.border}`, cursor: "pointer",
    }}
  >
    <span style={{ fontSize: 10, color: T.text2, fontFamily: T.mono, flex: 1 }}>{label}</span>
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {badge && <Badge color={badgeColor} size="xs">{badge}</Badge>}
      <div style={{
        width: 30, height: 15, borderRadius: 8,
        background: on ? T.greenD : T.border2,
        border: `1px solid ${on ? T.green : T.border2}`,
        position: "relative", transition: "all 0.2s",
      }}>
        <div style={{
          position: "absolute", top: 2,
          left: on ? 15 : 2,
          width: 9, height: 9, borderRadius: "50%",
          background: on ? T.green : T.text2,
          transition: "left 0.2s",
        }} />
      </div>
    </div>
  </div>
);

const MiniBar = ({ value, max, color = T.blue, height = 4 }) => (
  <div style={{ flex: 1, height, background: T.border, borderRadius: 2, overflow: "hidden" }}>
    <div style={{
      width: `${Math.min(100, (value / max) * 100)}%`,
      height: "100%", background: color, borderRadius: 2,
      transition: "width 0.4s",
    }} />
  </div>
);

// ─── PULSE PAGE ───────────────────────────────────────────────────────────────
const SHARPE_STACK = [
  { label: "BASELINE — equal weight",         sharpe: 1.36,  delta: null,    color: T.text2 },
  { label: "+ Sharpe-weighted routing",        sharpe: 5.94,  delta: "+4.58", color: T.text  },
  { label: "+ Soft regime (thr=0.35)",         sharpe: 6.61,  delta: "+0.66", color: T.blue  },
  { label: "+ HOUR_KILLS gate",                sharpe: 9.18,  delta: "+2.57", color: T.teal  },
  { label: "+ SQZ_LOCK + ATR_RANK + RVOL + JEDI", sharpe: 15.86, delta: "+6.68", color: T.green },
  { label: "DELTA OPS (PADAWAN + CIS + scale)", sharpe: 11.19, delta: "mgmt",  color: T.purple },
  { label: "EUPHORIA MODE — fat pitches only", sharpe: 19.83, delta: "62.4% WR · 117t", color: T.gold   },
  { label: "★ RE-ENTRY after CIS exit",        sharpe: 29.72, delta: "87t",   color: T.green  },
];

const GATES_INIT = [
  { id: "regime_routing",  label: "REGIME_ROUTING",    delta: "+0.844", on: true,  deltaColor: "green" },
  { id: "hour_kills",      label: "HOUR_KILLS",         delta: "+2.57",  on: true,  deltaColor: "green" },
  { id: "day_filter",      label: "DAY_FILTER",         delta: "+0.729", on: true,  deltaColor: "green" },
  { id: "squeeze_lock",    label: "SQUEEZE_LOCK",       delta: "+edge",  on: true,  deltaColor: "green" },
  { id: "atr_rank",        label: "ATR_RANK_GATE",      delta: "+edge",  on: true,  deltaColor: "green" },
  { id: "rvol_exhaust",    label: "RVOL_EXHAUST",       delta: "+edge",  on: true,  deltaColor: "green" },
  { id: "low_jedi",        label: "LOW_JEDI_GATE",      delta: "+edge",  on: true,  deltaColor: "green" },
  { id: "rvol_gate",       label: "RVOL_GATE",          delta: "±0.000", on: false, deltaColor: "gray"  },
  { id: "scalper_mode",    label: "SCALPER_MODE",       delta: "1.896",  on: false, deltaColor: "orange"},
  { id: "euphoria",        label: "EUPHORIA_ONLY",      delta: "19.83",  on: false, deltaColor: "gold"  },
];

const HOUR_DATA = [
  "bad","bad","bad","bad","meh","meh","meh","good",
  "good","good","good","good","good","good","good","good",
  "meh","meh","bad","bad","meh","meh","bad","bad",
];

const IC_SIGNALS = [
  { name: "PULLBACK",    ic: "+0.050", slope: +0.003, regime: "TRENDING",  status: "ALIVE"   },
  { name: "ADX_TREND",   ic: "+0.045", slope: +0.002, regime: "TRENDING",  status: "ALIVE"   },
  { name: "SQZPOP",      ic: "+0.033", slope: +0.001, regime: "BREAKOUT",  status: "SPEC"    },
  { name: "SUPERTREND",  ic: "+0.025", slope: -0.0001,regime: "BREAKOUT",  status: "SPEC"    },
  { name: "EMA_STACK",   ic: "+0.018", slope: +0.001, regime: "TRENDING",  status: "SPEC"    },
  { name: "MACD_CROSS",  ic: "+0.012", slope: +0.000, regime: "TRENDING",  status: "SPEC"    },
  { name: "RSI_STRONG",  ic: "+0.009", slope: -0.0001,regime: "RANGING",   status: "SPEC"    },
  { name: "OBV_TREND",   ic: "+0.007", slope: +0.001, regime: "TRENDING",  status: "SPEC"    },
  { name: "DON_BO",      ic: "+0.006", slope: +0.000, regime: "BREAKOUT",  status: "SPEC"    },
  { name: "BB_BREAK",    ic: "+0.004", slope: -0.0001,regime: "BREAKOUT",  status: "SPEC"    },
  { name: "VOL_SURGE",   ic: "-0.002", slope: -0.0004,regime: "ANY",       status: "PROB"    },
  { name: "CONSEC_BULL", ic: "-0.004", slope: -0.0005,regime: "ANY",       status: "PROB"    },
];

const CIRCUIT_BREAKERS = [
  { label: "Daily DD limit (5%)",     value: "1.24%",   status: "ok"   },
  { label: "Max open positions (5)",  value: "3 / 5",   status: "ok"   },
  { label: "Correlation limit",       value: "ρ=0.42",  status: "ok"   },
  { label: "RVOL exhaust gate",       value: "1.47×",   status: "warn" },
  { label: "SQUEEZE lock active",     value: "CLEAR",   status: "ok"   },
  { label: "ATR rank gate",           value: "72pct ✓", status: "ok"   },
  { label: "Drawdown circuit",        value: "OFF",     status: "ok"   },
  { label: "Paper mode enforced",     value: "LIVE ✗",  status: "ok"   },
];

const OPEN_POSITIONS = [
  { sym: "BTC/USDT", side: "LONG",  entry: 64420, cur: 64882, size: 9.56, pnl: +142, pct: +0.71 },
  { sym: "ETH/USDT", side: "LONG",  entry:  3441, cur:  3479, size: 7.21, pnl:  +38, pct: +1.10 },
  { sym: "SOL/USDT", side: "SHORT", entry:  144.2, cur: 145.9, size: 4.80, pnl: -22, pct: -1.18 },
];

const DAYS = ["MON","TUE","WED","THU","FRI","SAT","SUN"];
const DAYS_INIT = [true,true,true,true,true,false,false];

function PulsePage() {
  const [gates, setGates] = useState(GATES_INIT);
  const [hours, setHours] = useState(HOUR_DATA);
  const [days, setDays] = useState(DAYS_INIT);
  const [kellyMult, setKellyMult] = useState(0.5); // 0=quarter, 0.5=half, 1=full
  const [crossAsset, setCrossAsset] = useState("RISK_ON");

  const toggleGate = (id) =>
    setGates(g => g.map(gate => gate.id === id ? { ...gate, on: !gate.on } : gate));

  const cycleHour = (i) =>
    setHours(h => {
      const next = { bad: "meh", meh: "good", good: "bad" };
      const n = [...h]; n[i] = next[n[i]]; return n;
    });

  const fullKelly = 19.12;
  const halfKelly = 9.56;
  const activeKelly = kellyMult === 1 ? fullKelly : kellyMult === 0.5 ? halfKelly : halfKelly * 0.5;
  const caAdj = crossAsset === "RISK_ON" ? 1.20 : crossAsset === "RISK_OFF" ? 0.70 : 1.0;
  const finalSize = (activeKelly * caAdj).toFixed(2);

  const hourColor = { good: T.green, meh: T.text2, bad: T.red };
  const hourBg   = { good: T.greenDD, meh: T.bg3, bad: T.redDD };

  const activeGates = gates.filter(g => g.on).length;

  return (
    <div style={{
      background: T.bg1, minHeight: "100vh", padding: 10,
      fontFamily: T.mono, color: T.text,
    }}>
      {/* Page header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "6px 10px", background: T.bg0, border: `1px solid ${T.border}`,
        borderRadius: 3, marginBottom: 10,
      }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.blue, letterSpacing: "0.16em" }}>
            ② PULSE
          </span>
          <span style={{ fontSize: 9, color: T.text2, marginLeft: 12 }}>
            ALGO SYSCONTROLS · SAFETY · KELLY · GATES · IC DECAY
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Badge color="green" size="xs">● LIVE</Badge>
          <Badge color="gray" size="xs">PAPER MODE</Badge>
          <Badge color="gold" size="xs">{activeGates}/10 GATES ON</Badge>
        </div>
      </div>

      {/* Row 1: Sharpe stack + Kelly + Circuit breakers */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8, marginBottom: 8 }}>

        {/* Sharpe Waterfall */}
        <Panel head="SHARPE STACK WATERFALL" color="green"
          right={<Badge color="green" size="xs">STACKED Σ</Badge>}>
          <div style={{ padding: "8px 10px" }}>
            {SHARPE_STACK.map((row, i) => {
              const maxSharpe = 29.72;
              const isReentry = i === 7;
              const isEuphoria = i === 6;
              const isDeltaOps = i === 5;
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  borderBottom: i < SHARPE_STACK.length - 1 ? `1px solid ${T.border}` : "none",
                  background: isReentry ? `${T.greenDD}88` : isEuphoria ? `${T.goldDD}88` : "transparent",
                  margin: isReentry ? "0 -10px" : undefined, padding: isReentry ? "5px 10px" : "4px 0",
                }}>
                  <div style={{ width: 130, fontSize: 9, color: row.color, lineHeight: 1.3, flexShrink: 0 }}>
                    {row.label}
                  </div>
                  <div style={{ flex: 1, height: 5, background: T.border, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{
                      width: isDeltaOps ? `${(row.sharpe / maxSharpe) * 100}%` : `${(row.sharpe / maxSharpe) * 100}%`,
                      height: "100%",
                      background: row.color,
                      borderRadius: 2,
                      opacity: isDeltaOps ? 0.5 : 1,
                      transition: "width 0.5s",
                    }} />
                  </div>
                  <div style={{
                    fontSize: isReentry ? 14 : isEuphoria ? 12 : 11,
                    fontWeight: 700, color: row.color,
                    width: 44, textAlign: "right", flexShrink: 0,
                  }}>{row.sharpe.toFixed(2)}</div>
                  {row.delta && (
                    <div style={{
                      fontSize: 8, color: T.text2, width: 80, textAlign: "right", flexShrink: 0,
                    }}>{row.delta}</div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>

        {/* Kelly */}
        <Panel head="KELLY SIZING" color="gold"
          right={<Badge color="gold" size="xs">HALF-K ACTIVE</Badge>}>
          <div style={{ padding: "10px" }}>
            {/* Dial */}
            <div style={{ textAlign: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: T.text2, marginBottom: 2 }}>ACTIVE SIZE</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: T.green, lineHeight: 1 }}>{finalSize}%</div>
              <div style={{ fontSize: 8, color: T.text2, marginTop: 2 }}>
                {activeKelly.toFixed(2)}% × {caAdj.toFixed(2)} CA adj
              </div>
            </div>

            {/* Kelly selector */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 8, color: T.text3, marginBottom: 4 }}>KELLY FRACTION</div>
              <div style={{ display: "flex", gap: 3 }}>
                {[["¼K", 0.25], ["½K", 0.5], ["1K", 1]].map(([label, val]) => (
                  <button key={val} onClick={() => setKellyMult(val)}
                    style={{
                      flex: 1, padding: "5px 0", fontSize: 9, fontFamily: T.mono,
                      background: kellyMult === val ? T.blueDD : T.bg3,
                      border: `1px solid ${kellyMult === val ? T.blue : T.border}`,
                      color: kellyMult === val ? T.blue : T.text2,
                      borderRadius: 2, cursor: "pointer", fontWeight: 700,
                    }}>{label}<br />
                    <span style={{ fontSize: 8, color: kellyMult === val ? T.blue : T.text3 }}>
                      {val === 0.25 ? "4.78%" : val === 0.5 ? "9.56%" : "19.12%"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Cross-asset modifier */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 8, color: T.text3, marginBottom: 4 }}>CROSS-ASSET MODIFIER</div>
              <div style={{ display: "flex", gap: 3 }}>
                {[["RISK_ON", "+20%", "green"], ["NEUTRAL", "±0%", "gray"], ["RISK_OFF", "-30%", "red"]].map(([val, pct, col]) => (
                  <button key={val} onClick={() => setCrossAsset(val)}
                    style={{
                      flex: 1, padding: "4px 2px", fontSize: 8, fontFamily: T.mono,
                      background: crossAsset === val ? (col === "green" ? T.greenDD : col === "red" ? T.redDD : T.bg3) : T.bg3,
                      border: `1px solid ${crossAsset === val ? (col === "green" ? T.green : col === "red" ? T.red : T.text2) : T.border}`,
                      color: crossAsset === val ? (col === "green" ? T.green : col === "red" ? T.red : T.text2) : T.text3,
                      borderRadius: 2, cursor: "pointer", fontWeight: 700, lineHeight: 1.4,
                    }}>{val.replace("RISK_","")}<br />{pct}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ padding: "6px 8px", background: T.bg3, border: `1px solid ${T.border2}`, borderRadius: 2 }}>
              <StatRow label="Full Kelly" value="19.12%" valueColor={T.blue} border={true} />
              <StatRow label="Half Kelly" value="9.56%"  valueColor={T.green} border={true} />
              <StatRow label="Quarter K" value="4.78%"   valueColor={T.text2} border={false} />
            </div>
          </div>
        </Panel>

        {/* Circuit Breakers */}
        <Panel head="CIRCUIT BREAKERS" color="red"
          right={<Badge color="green" size="xs">7/8 OK</Badge>}>
          <div style={{ padding: "8px 10px" }}>
            {CIRCUIT_BREAKERS.map((cb, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "4px 0", borderBottom: i < CIRCUIT_BREAKERS.length - 1 ? `1px solid ${T.border}` : "none",
              }}>
                <div style={{
                  width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                  background: cb.status === "ok" ? T.green : cb.status === "warn" ? T.gold : T.red,
                  boxShadow: cb.status === "ok"
                    ? `0 0 4px ${T.green}66`
                    : cb.status === "warn" ? `0 0 4px ${T.gold}66` : `0 0 4px ${T.red}66`,
                }} />
                <span style={{ fontSize: 9, color: T.text2, flex: 1 }}>{cb.label}</span>
                <span style={{
                  fontSize: 9, fontWeight: 700,
                  color: cb.status === "ok" ? T.green : cb.status === "warn" ? T.gold : T.red,
                }}>{cb.value}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Row 2: Gate toggles + Hour kill grid + Day filter */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 8, marginBottom: 8 }}>

        {/* Gate toggles */}
        <Panel head="GATE CONTROL PANEL" color="blue"
          right={<><Badge color="green" size="xs">{gates.filter(g=>g.on).length} ON</Badge><Badge color="gray" size="xs">{gates.filter(g=>!g.on).length} OFF</Badge></>}>
          <div style={{ padding: "6px 10px" }}>
            {gates.map(gate => (
              <Toggle
                key={gate.id}
                on={gate.on}
                onToggle={() => toggleGate(gate.id)}
                label={gate.label}
                badge={gate.delta}
                badgeColor={gate.deltaColor}
              />
            ))}
          </div>
        </Panel>

        {/* Hour kill grid */}
        <Panel head="HOUR_KILLS MAP — 24H UTC" color="red"
          right={<Badge color="red" size="xs">CLICK TO CYCLE</Badge>}>
          <div style={{ padding: "8px 10px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 3, marginBottom: 8 }}>
              {hours.map((status, i) => (
                <div
                  key={i}
                  onClick={() => cycleHour(i)}
                  title={`Hour ${i}:00 UTC — ${status.toUpperCase()}`}
                  style={{
                    padding: "5px 2px", textAlign: "center", cursor: "pointer",
                    background: hourBg[status], border: `1px solid ${hourColor[status]}33`,
                    borderRadius: 2, fontSize: 8, color: hourColor[status],
                    fontWeight: 700, transition: "all 0.15s", lineHeight: 1,
                    userSelect: "none",
                  }}
                >
                  <div style={{ fontSize: 7, opacity: 0.6, marginBottom: 1 }}>{i}</div>
                  {status === "good" ? "GO" : status === "bad" ? "KILL" : "—"}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {[["KILL", "bad", T.red], ["NEU", "meh", T.text2], ["GO", "good", T.green]].map(([label, key, color]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 8 }}>
                  <div style={{ width: 8, height: 8, background: hourBg[key], border: `1px solid ${color}44`, borderRadius: 1 }} />
                  <span style={{ color }}>{label}: {hours.filter(h => h === key).length}h</span>
                </div>
              ))}
            </div>

            {/* Day filter */}
            <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 8 }}>
              <div style={{ fontSize: 8, color: T.text3, marginBottom: 4, letterSpacing: "0.1em" }}>DAY FILTER</div>
              <div style={{ display: "flex", gap: 3 }}>
                {DAYS.map((day, i) => (
                  <div
                    key={day}
                    onClick={() => setDays(d => { const n = [...d]; n[i] = !n[i]; return n; })}
                    style={{
                      flex: 1, padding: "5px 2px", textAlign: "center", cursor: "pointer",
                      background: days[i] ? T.greenDD : T.redDD,
                      border: `1px solid ${days[i] ? T.greenD : T.redD}`,
                      borderRadius: 2, fontSize: 8,
                      color: days[i] ? T.green : T.red,
                      fontWeight: 700, userSelect: "none", lineHeight: 1,
                    }}
                  >
                    <div>{day}</div>
                    <div style={{ fontSize: 7, opacity: 0.7, marginTop: 1 }}>{days[i] ? "✓" : "✗"}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        {/* Open positions */}
        <Panel head="OPEN POSITIONS" color="purple"
          right={<Badge color={158 > 0 ? "green" : "red"} size="xs">NET +$158</Badge>}>
          <div style={{ padding: "8px 10px" }}>
            {OPEN_POSITIONS.map((pos, i) => (
              <div key={i} style={{
                padding: "6px 0", borderBottom: i < OPEN_POSITIONS.length - 1 ? `1px solid ${T.border}` : "none",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                  <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: T.blue }}>{pos.sym}</span>
                    <Badge color={pos.side === "LONG" ? "green" : "red"} size="xs">{pos.side}</Badge>
                  </div>
                  <span style={{
                    fontSize: 12, fontWeight: 700,
                    color: pos.pnl >= 0 ? T.green : T.red,
                  }}>{pos.pnl >= 0 ? "+" : ""}${pos.pnl}</span>
                </div>
                <div style={{ display: "flex", gap: 8, fontSize: 9, color: T.text2, marginBottom: 4 }}>
                  <span>Entry: <span style={{ color: T.text }}>{pos.entry.toLocaleString()}</span></span>
                  <span>Size: <span style={{ color: T.gold }}>{pos.size}%</span></span>
                  <span style={{ marginLeft: "auto", color: pos.pct >= 0 ? T.green : T.red, fontWeight: 600 }}>
                    {pos.pct >= 0 ? "+" : ""}{pos.pct.toFixed(2)}%
                  </span>
                </div>
                <div style={{ height: 3, background: T.border, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{
                    width: `${Math.min(100, Math.abs(pos.pct) * 40)}%`,
                    height: "100%",
                    background: pos.pnl >= 0 ? T.green : T.red,
                    borderRadius: 2,
                  }} />
                </div>
              </div>
            ))}
            <div style={{
              marginTop: 8, padding: "6px 8px",
              background: T.bg3, border: `1px solid ${T.border2}`,
              borderRadius: 2, display: "grid", gridTemplateColumns: "1fr 1fr",
              gap: "4px 12px",
            }}>
              <StatRow label="Net P&L"   value="+$158"    valueColor={T.green}  border={false} />
              <StatRow label="Exposure"  value="28.4%"    valueColor={T.text}   border={false} />
              <StatRow label="Slots"     value="3 / 5"    valueColor={T.gold}   border={false} />
              <StatRow label="DD today"  value="1.24%"    valueColor={T.green}  border={false} />
            </div>
          </div>
        </Panel>
      </div>

      {/* Row 3: IC Decay monitor */}
      <Panel head="IC DECAY MONITOR — 14-DAY ROLLING SLOPE PER SIGNAL" color="purple"
        right={<><Badge color="purple" size="xs">ALERT &lt; -0.0003 · 3W</Badge><Badge color="green" size="xs">OOS 5.35 · IS/OOS 1.41</Badge></>}>
        <div style={{ padding: "8px 10px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
            {IC_SIGNALS.map((sig, i) => {
              const slopeAlert = sig.slope < -0.0003;
              const statusColors = { ALIVE: T.green, SPEC: T.blue, PROB: T.gold };
              const sc = statusColors[sig.status] || T.text2;
              return (
                <div key={i} style={{
                  padding: 7, background: slopeAlert ? T.redDD : T.bg3,
                  border: `1px solid ${slopeAlert ? T.redD : T.border}`,
                  borderRadius: 3,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: sc }}>{sig.name}</span>
                    <Badge color={sig.status === "ALIVE" ? "green" : sig.status === "PROB" ? "gold" : "blue"} size="xs">
                      {sig.status}
                    </Badge>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: parseFloat(sig.ic) > 0 ? T.green : T.red, marginBottom: 2 }}>
                    {sig.ic}
                  </div>
                  <div style={{ fontSize: 8, color: T.text2, marginBottom: 4 }}>IC · {sig.regime}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 8, color: T.text3 }}>slope</span>
                    <div style={{ flex: 1, height: 3, background: T.border, borderRadius: 2 }}>
                      <div style={{
                        width: `${Math.min(100, Math.abs(sig.slope) * 100000)}%`,
                        height: "100%",
                        background: sig.slope >= 0 ? T.green : T.red,
                        borderRadius: 2,
                      }} />
                    </div>
                    <span style={{ fontSize: 7, color: sig.slope >= 0 ? T.green : T.red, fontWeight: 700 }}>
                      {sig.slope >= 0 ? "▲" : "▼"}
                    </span>
                  </div>
                  {slopeAlert && (
                    <div style={{ marginTop: 3, fontSize: 7, color: T.red, fontWeight: 700 }}>⚠ DECAY ALERT</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Walk-forward summary */}
          <div style={{
            marginTop: 8, padding: "6px 10px",
            background: T.bg0, border: `1px solid ${T.border}`,
            borderRadius: 2, display: "flex", gap: 20, flexWrap: "wrap",
          }}>
            {[
              ["41 FOLDS", "90d train / 30d test / 2d embargo", T.blue],
              ["OOS SHARPE", "+5.35", T.green],
              ["IS/OOS RATIO", "1.41 ✓", T.green],
              ["RENTECH GATES", "4/5 PROMISING", T.gold],
              ["GATE 5", "ic_not_decaying — REGIME VAR expected", T.text2],
              ["EXP LIVE SHARPE", "6–10 (40–60% haircut)", T.orange],
            ].map(([label, val, color]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 7, color: T.text3, letterSpacing: "0.1em" }}>{label}</span>
                <span style={{ fontSize: 9, color, fontWeight: 700 }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

// ─── TRADE PAGE ───────────────────────────────────────────────────────────────
const PRELOADED_VALS = {
  symbol: "BTC/USDT",
  direction: "LONG",
  entry: 64882,
  sl: 64212,
  tp1: 65420,
  tp2: 65900,
  sizeKelly: 9.56,
  sizeAdj: 11.47,
  rr: 1.52,
  atrDist: "0.82 ATR",
  mode: "PADAWAN (CIS)",
  regime: "TRENDING",
  jedi: 0.61,
  rvol: 1.47,
};

const ARB_CHECKS = [
  { label: "REGIME",     val: "TRENDING",   pass: true,  note: "assign_regimes() price-based ✓" },
  { label: "JEDI",       val: "0.61",        pass: true,  note: "Above 0.55 threshold ✓" },
  { label: "MTF",        val: "ALIGNED",     pass: true,  note: "1H bullish + 5M LONG ✓" },
  { label: "HOUR",       val: "11:00 UTC",   pass: true,  note: "Hour in ALLOW zone ✓" },
  { label: "CROSSASSET", val: "RISK_ON",     pass: true,  note: "+20% Kelly adj ✓" },
  { label: "RVOL",       val: "1.47×",       pass: null,  note: "Marginal — above avg but not strong" },
  { label: "DAY",        val: "TUESDAY",     pass: true,  note: "Day filter: ALLOW ✓" },
  { label: "SQUEEZE",    val: "CLEAR",       pass: true,  note: "No squeeze lock ✓" },
];

const CLAUDE_REASONING = `TRENDING regime confirmed via assign_regimes() price-based logic (EMA200 + ADX + SUP). NOT using _regime_labels_simple() — circular risk avoided.

Strong PULLBACK+ADX_TREND confluence (IC +0.050, +0.045 in TRENDING). SQZPOP firing post-squeeze breakout. EMA_STACK aligned. 5/6 hard gates green.

RVOL 1.47× marginal — above avg but not triggering RVOL_EXHAUST gate. Acceptable per PADAWAN doctrine.

MTF 1H confirmed bullish — full size recommended (no 50% reduction). ICT FVG at 65,420 aligns with TP1. No EQH/EQL proximity blockers.

Cross-asset RISK_ON → Kelly ×1.20. Final position: 11.47%.

RECOMMENDATION: ENTER LONG. Composite conviction 87/100.`;

const TRADE_LOG = [
  { time:"09:14", sym:"BTC", dir:"LONG",  entry:64420, exit:64980, pnl:+112, mode:"PADAWAN", score:89, notes:"CIS exit. Re-entry armed." },
  { time:"10:32", sym:"ETH", dir:"LONG",  entry: 3442, exit:null,  pnl:+38,  mode:"EUPHORIA", score:91, notes:"Scale-out armed at TP1." },
  { time:"11:08", sym:"SOL", dir:"SHORT", entry:143.2, exit:null,  pnl:-22,  mode:"MANUAL",  score:null,notes:"MTF conflict. Reduced size." },
];

function FireButton({ label, onClick, variant = "default", disabled = false }) {
  const variants = {
    primary:  { bg: "#1a0800", border: T.gold,   color: T.gold,   hoverBg: T.goldDD   },
    ai:       { bg: "#0a1a00", border: T.green,  color: T.green,  hoverBg: T.greenDD  },
    long:     { bg: "#041408", border: T.green,  color: T.green,  hoverBg: T.greenDD  },
    short:    { bg: "#160404", border: T.red,    color: T.red,    hoverBg: T.redDD    },
    exit:     { bg: T.bg3,    border: T.gold,   color: T.gold,   hoverBg: T.goldDD   },
    flat:     { bg: T.redDD,  border: T.red,    color: T.red,    hoverBg: "#200808"   },
    default:  { bg: T.bg3,    border: T.border2,color: T.text2,  hoverBg: T.bg4      },
  };
  const v = variants[variant];
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: "100%", padding: "9px 8px",
        background: disabled ? T.bg3 : hover ? v.hoverBg : v.bg,
        border: `1px solid ${disabled ? T.border : v.border}`,
        color: disabled ? T.text3 : v.color,
        fontFamily: T.mono, fontSize: 10, fontWeight: 700,
        letterSpacing: "0.1em", cursor: disabled ? "not-allowed" : "pointer",
        borderRadius: 2, transition: "all 0.12s",
        boxShadow: !disabled && hover ? `0 0 10px ${v.border}44` : "none",
      }}
    >{label}</button>
  );
}

function TradePage() {
  const [autoFire, setAutoFire] = useState(false);
  const [cisAuto, setCisAuto] = useState(true);
  const [reentryAuto, setReentryAuto] = useState(true);
  const [scaleAuto, setScaleAuto] = useState(true);
  const [fired, setFired] = useState(false);
  const [logItems, setLogItems] = useState(TRADE_LOG);
  const [claudeVisible, setClaudeVisible] = useState(false);
  const [reasoningIdx, setReasoningIdx] = useState(0);

  // Typewriter effect for Claude reasoning
  useEffect(() => {
    if (!claudeVisible) return;
    if (reasoningIdx < CLAUDE_REASONING.length) {
      const t = setTimeout(() => setReasoningIdx(i => i + 3), 12);
      return () => clearTimeout(t);
    }
  }, [claudeVisible, reasoningIdx]);

  const convScore = 87;

  const handleFire = (dir) => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
    setLogItems(prev => [{
      time, sym: "BTC", dir,
      entry: PRELOADED_VALS.entry,
      exit: null,
      pnl: 0,
      mode: "PADAWAN",
      score: convScore,
      notes: "Fired from UI. Watching.",
    }, ...prev]);
    setFired(true);
  };

  const slPct = (((PRELOADED_VALS.entry - PRELOADED_VALS.sl) / PRELOADED_VALS.entry) * 100).toFixed(2);
  const tp1Pct = (((PRELOADED_VALS.tp1 - PRELOADED_VALS.entry) / PRELOADED_VALS.entry) * 100).toFixed(2);
  const tp2Pct = (((PRELOADED_VALS.tp2 - PRELOADED_VALS.entry) / PRELOADED_VALS.entry) * 100).toFixed(2);

  return (
    <div style={{
      background: T.bg1, minHeight: "100vh", padding: 10,
      fontFamily: T.mono, color: T.text,
    }}>
      {/* Page header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "6px 10px", background: T.bg0, border: `1px solid ${T.border}`,
        borderRadius: 3, marginBottom: 10,
      }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.gold, letterSpacing: "0.16em" }}>
            ③ TRADE
          </span>
          <span style={{ fontSize: 9, color: T.text2, marginLeft: 12 }}>
            CO-TRADE SURFACE · ARB LAYER · FIRE CONTROLS · TRADE LOG
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Badge color="green" size="xs">● LIVE DATA</Badge>
          <Badge color="gold" size="xs">PAPER MODE</Badge>
          <Badge color={convScore >= 80 ? "green" : convScore >= 60 ? "gold" : "red"} size="xs">
            ARB SCORE {convScore}/100
          </Badge>
        </div>
      </div>

      {/* Row 1: ARB + Preloaded Vals + Fire */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr", gap: 8, marginBottom: 8 }}>

        {/* Claude ARB Layer */}
        <Panel head="CLAUDE ARB LAYER — COMPOSITE CONVICTION" color="purple"
          right={<><Badge color="purple" size="xs">SONNET 4.6</Badge><Badge color="green" size="xs">GEMMA4 PRE-FILTER</Badge></>}>
          <div style={{ padding: "8px 10px" }}>
            {/* Score ring */}
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
              <div style={{ position: "relative", width: 70, height: 70, flexShrink: 0 }}>
                <svg width="70" height="70" viewBox="0 0 70 70">
                  <circle cx="35" cy="35" r="28" fill="none" stroke={T.border2} strokeWidth="5" />
                  <circle cx="35" cy="35" r="28" fill="none" stroke={T.green} strokeWidth="5"
                    strokeDasharray={`${(convScore / 100) * 175.9} 175.9`}
                    strokeLinecap="round"
                    transform="rotate(-90 35 35)"
                    style={{ transition: "stroke-dasharray 1s" }}
                  />
                  <text x="35" y="38" textAnchor="middle" fill={T.green}
                    fontSize="16" fontWeight="700" fontFamily={T.mono}>{convScore}</text>
                  <text x="35" y="50" textAnchor="middle" fill={T.text3}
                    fontSize="8" fontFamily={T.mono}>/100</text>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                  {ARB_CHECKS.map((chk, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 4,
                      padding: "3px 5px",
                      background: chk.pass === true ? `${T.greenDD}88` : chk.pass === null ? `${T.goldDD}88` : T.redDD,
                      border: `1px solid ${chk.pass === true ? T.greenD+"44" : chk.pass === null ? T.goldD+"44" : T.redD}`,
                      borderRadius: 2,
                    }}>
                      <span style={{
                        fontSize: 10,
                        color: chk.pass === true ? T.green : chk.pass === null ? T.gold : T.red,
                      }}>{chk.pass === true ? "✓" : chk.pass === null ? "~" : "✗"}</span>
                      <span style={{ fontSize: 8, color: T.text2, flex: 1 }}>{chk.label}</span>
                      <span style={{ fontSize: 8, fontWeight: 700, color: T.text }}>{chk.val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Claude reasoning */}
            <div style={{
              background: T.purpleDD, border: `1px solid ${T.purpleD}44`,
              borderRadius: 2, padding: "6px 8px", marginBottom: 8,
            }}>
              <div style={{ fontSize: 8, color: T.purple, fontWeight: 700, marginBottom: 4, letterSpacing: "0.1em" }}>
                CLAUDE ARBITRATION
              </div>
              {!claudeVisible ? (
                <button onClick={() => setClaudeVisible(true)} style={{
                  background: T.purpleDD, border: `1px solid ${T.purpleD}`,
                  color: T.purple, fontFamily: T.mono, fontSize: 8, cursor: "pointer",
                  padding: "4px 8px", borderRadius: 2,
                }}>▶ RUN CLAUDE REASONING</button>
              ) : (
                <div style={{
                  fontSize: 9, color: T.text, lineHeight: 1.6, whiteSpace: "pre-wrap",
                  maxHeight: 130, overflowY: "auto",
                }}>
                  {CLAUDE_REASONING.slice(0, reasoningIdx)}
                  {reasoningIdx < CLAUDE_REASONING.length && (
                    <span style={{ color: T.purple, animation: "none" }}>▌</span>
                  )}
                </div>
              )}
            </div>

            {/* Gemma pre-filter */}
            <div style={{
              background: T.bg3, border: `1px solid ${T.border2}`,
              borderRadius: 2, padding: "5px 8px", fontSize: 8, color: T.text2,
              lineHeight: 1.5,
            }}>
              <span style={{ color: T.teal, fontWeight: 700 }}>GEMMA4 PRE-FILTER: </span>
              Pattern matches trending+breakout ensemble. 23/23 signals evaluated. JEDI above threshold. No structural blockers. Passed to Claude for final arbitration.
            </div>
          </div>
        </Panel>

        {/* Preloaded vals */}
        <Panel head="PRELOADED TRADE VALS" color="gold"
          right={<Badge color="gold" size="xs">AUTO-COMPUTED</Badge>}>
          <div style={{ padding: "8px 10px" }}>
            {/* Direction banner */}
            <div style={{
              padding: "6px 10px", marginBottom: 8,
              background: T.greenDD, border: `1px solid ${T.green}`,
              borderRadius: 2, textAlign: "center",
            }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: T.green, letterSpacing: "0.2em" }}>
                ▲ LONG
              </span>
              <span style={{ fontSize: 10, color: T.green, marginLeft: 8 }}>{PRELOADED_VALS.symbol}</span>
            </div>

            <StatRow label="ENTRY"         value={`$${PRELOADED_VALS.entry.toLocaleString()}`} valueColor={T.gold} />
            <StatRow label="STOP LOSS"     value={`$${PRELOADED_VALS.sl.toLocaleString()} (−${slPct}%)`} valueColor={T.red} />
            <StatRow label="TP1 (CIS)"     value={`$${PRELOADED_VALS.tp1.toLocaleString()} (+${tp1Pct}%)`} valueColor={T.green} />
            <StatRow label="TP2 scale 50%" value={`$${PRELOADED_VALS.tp2.toLocaleString()} (+${tp2Pct}%)`} valueColor={T.green} />
            <StatRow label="RISK:REWARD"   value={`1 : ${PRELOADED_VALS.rr}`} valueColor={T.green} />
            <StatRow label="SIZE (½ Kelly)" value={`${PRELOADED_VALS.sizeKelly}%`} valueColor={T.text} />
            <StatRow label="CA-ADJ SIZE"   value={`${PRELOADED_VALS.sizeAdj}%`} valueColor={T.green} />
            <StatRow label="ATR DIST"      value={PRELOADED_VALS.atrDist} />
            <StatRow label="MODE"          value={PRELOADED_VALS.mode} valueColor={T.gold} />
            <StatRow label="REGIME"        value={PRELOADED_VALS.regime} valueColor={T.green} />
            <StatRow label="JEDI SCORE"    value={PRELOADED_VALS.jedi.toFixed(2)} valueColor={T.purple} />
            <StatRow label="RVOL"          value={`${PRELOADED_VALS.rvol}×`} valueColor={T.blue} border={false} />

            {/* Price ladder visual */}
            <div style={{ marginTop: 8, padding: "6px 8px", background: T.bg3, borderRadius: 2 }}>
              {[
                { label: "TP2",   price: PRELOADED_VALS.tp2, color: T.green,  pct: +tp2Pct },
                { label: "TP1",   price: PRELOADED_VALS.tp1, color: T.green,  pct: +tp1Pct },
                { label: "ENTRY", price: PRELOADED_VALS.entry,color: T.gold,  pct: 0 },
                { label: "SL",    price: PRELOADED_VALS.sl,  color: T.red,   pct: -slPct },
              ].map((lvl) => (
                <div key={lvl.label} style={{
                  display: "flex", justifyContent: "space-between",
                  fontSize: 9, padding: "2px 0",
                  borderBottom: `1px solid ${T.border}`,
                }}>
                  <span style={{ color: lvl.color, fontWeight: 700, width: 36 }}>{lvl.label}</span>
                  <span style={{ color: T.text }}>{lvl.price.toLocaleString()}</span>
                  <span style={{ color: lvl.color }}>
                    {lvl.pct === 0 ? "—" : `${lvl.pct > 0 ? "+" : ""}${Number(lvl.pct).toFixed(2)}%`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        {/* Fire panel */}
        <Panel head="FIRE / LAUNCH" color="red"
          right={<Badge color={fired ? "green" : "gold"} size="xs">{fired ? "EXECUTED" : "ARMED"}</Badge>}>
          <div style={{ padding: "8px 10px" }}>
            {/* AI recommendation banner */}
            <div style={{
              padding: "8px 10px", marginBottom: 8,
              background: T.greenDD, border: `1px solid ${T.green}`,
              borderRadius: 2,
            }}>
              <div style={{ fontSize: 8, color: T.green, letterSpacing: "0.1em", marginBottom: 2 }}>
                AI RECOMMENDATION
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.green }}>
                ✓ ENTER LONG — HIGH CONVICTION
              </div>
              <div style={{ fontSize: 8, color: T.greenD, marginTop: 1 }}>
                ARB 87/100 · 5/6 checks passed
              </div>
            </div>

            {/* Fire buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
              <FireButton label="⚡ FIRE LONG — AI SUPPORTED" variant="ai" onClick={() => handleFire("LONG")} />
              <FireButton label="▲ MANUAL LONG — OVERRIDE" variant="long" onClick={() => handleFire("LONG")} />
              <FireButton label="▼ MANUAL SHORT — OVERRIDE" variant="short" onClick={() => handleFire("SHORT")} />
            </div>

            <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 8, color: T.text3, letterSpacing: "0.1em", marginBottom: 4 }}>
                EXIT CONTROLS
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                <FireButton label="CIS EXIT" variant="exit" onClick={() => {}} />
                <FireButton label="SCALE 50%" variant="default" onClick={() => {}} />
                <FireButton label="FLAT ALL" variant="flat" onClick={() => {}} />
              </div>
            </div>

            <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 8 }}>
              <div style={{ fontSize: 8, color: T.text3, letterSpacing: "0.1em", marginBottom: 2 }}>
                ALGO AUTO-CONTROLS
              </div>
              <Toggle on={autoFire} onToggle={() => setAutoFire(v=>!v)} label="AUTO-FIRE on score ≥ 80"
                badge={autoFire ? "ARMED" : "OFF"} badgeColor={autoFire ? "red" : "gray"} />
              <Toggle on={cisAuto} onToggle={() => setCisAuto(v=>!v)} label="CIS auto-exit"
                badge="+edge" badgeColor="green" />
              <Toggle on={reentryAuto} onToggle={() => setReentryAuto(v=>!v)} label="Re-entry auto-watch"
                badge="29.72" badgeColor="green" />
              <Toggle on={scaleAuto} onToggle={() => setScaleAuto(v=>!v)} label="Scale-out 50% at TP1"
                badge="+edge" badgeColor="blue" />
            </div>

            {autoFire && (
              <div style={{
                marginTop: 6, padding: "5px 8px",
                background: T.redDD, border: `1px solid ${T.red}`,
                borderRadius: 2, fontSize: 8, color: T.red, fontWeight: 700,
              }}>
                ⚠ AUTO-FIRE ARMED — CONFIRM PAPER MODE
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* Trade log */}
      <Panel head="SESSION TRADE LOG" color="blue"
        right={
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Badge color="green" size="xs">NET +$128</Badge>
            <Badge color="gray" size="xs">PAPER</Badge>
          </div>
        }>
        <div style={{ padding: "0" }}>
          {/* Header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "48px 52px 52px 80px 80px 60px 70px 50px 1fr",
            gap: 4, padding: "5px 10px",
            background: T.bg0, borderBottom: `1px solid ${T.border}`,
            fontSize: 8, color: T.text3, letterSpacing: "0.1em",
          }}>
            {["TIME","SYM","DIR","ENTRY","EXIT","P&L","MODE","SCORE","NOTES"].map(h => (
              <span key={h}>{h}</span>
            ))}
          </div>
          {/* Rows */}
          {logItems.map((tr, i) => (
            <div key={i} style={{
              display: "grid",
              gridTemplateColumns: "48px 52px 52px 80px 80px 60px 70px 50px 1fr",
              gap: 4, padding: "5px 10px",
              borderBottom: `1px solid ${T.border}`,
              background: i === 0 && tr.exit === null
                ? `${T.blueDD}88` : "transparent",
              alignItems: "center",
            }}>
              <span style={{ fontSize: 9, color: T.text2 }}>{tr.time}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.blue }}>{tr.sym}</span>
              <Badge color={tr.dir === "LONG" ? "green" : "red"} size="xs">{tr.dir}</Badge>
              <span style={{ fontSize: 9, color: T.text }}>{tr.entry.toLocaleString()}</span>
              <span style={{ fontSize: 9, color: tr.exit ? T.text : T.gold }}>
                {tr.exit ? tr.exit.toLocaleString() : "OPEN ●"}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, color: tr.pnl >= 0 ? T.green : T.red }}>
                {tr.pnl >= 0 ? "+" : ""}${tr.pnl}
              </span>
              <Badge color={tr.mode === "EUPHORIA" ? "gold" : tr.mode === "MANUAL" ? "blue" : "purple"} size="xs">
                {tr.mode}
              </Badge>
              <span style={{ fontSize: 9, color: tr.score ? T.text : T.text3 }}>
                {tr.score ? `${tr.score}/100` : "—"}
              </span>
              <span style={{ fontSize: 9, color: T.text2 }}>{tr.notes}</span>
            </div>
          ))}

          {/* Summary row */}
          <div style={{
            padding: "6px 10px", background: T.bg0,
            display: "flex", gap: 20,
          }}>
            {[
              ["TRADES", logItems.length, T.text],
              ["WIN", logItems.filter(t => t.pnl > 0).length, T.green],
              ["LOSS", logItems.filter(t => t.pnl < 0).length, T.red],
              ["OPEN", logItems.filter(t => !t.exit).length, T.gold],
              ["GROSS P&L", `$${logItems.reduce((s,t)=>s+t.pnl,0)}`, logItems.reduce((s,t)=>s+t.pnl,0)>=0 ? T.green : T.red],
            ].map(([label, val, color]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 7, color: T.text3, letterSpacing: "0.1em" }}>{label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function SurgeApp({ page = "pulse" }) {
  return (
    <div style={{ background: T.bg0, minHeight: "100vh" }}>
      {/* Pages */}
      {page === "pulse" && <PulsePage />}
      {page === "trade" && <TradePage />}
    </div>
  );
}
