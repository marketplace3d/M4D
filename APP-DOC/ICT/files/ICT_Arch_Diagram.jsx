import { useState } from "react";

const C = {
  bg: "#03050a",
  surface: "#070c14",
  card: "#0a1018",
  border: "#0d1f35",
  accent: "#00c8f0",
  gold: "#e8a020",
  green: "#00e87a",
  red: "#ff2d55",
  purple: "#9b5de5",
  orange: "#ff6b35",
  dim: "#0f1e30",
  text: "#b8d4ec",
  muted: "#3d5a78",
  white: "#e8f4ff",
};

// Pipeline data
const PIPELINE = [
  {
    id: "L1", label: "LIQUIDITY DRAW", color: C.accent,
    inputs: ["PDH / PDL", "PWH / PWL", "EQH / EQL", "Session H/L", "External Range"],
    logic: "min_dist_to_level < prox_atr × ATR14",
    output: "liq_proximity = TRUE",
    weight: null,
  },
  {
    id: "L2", label: "TIME GATE", color: C.gold,
    inputs: ["London KZ 07:00–10:00 UTC", "NY AM 13:30–16:00 UTC", "Off-hours decay ×0.4"],
    logic: "kz_active → boost ×1.25 | offhours → decay ×0.4",
    output: "time.decay_mult",
    weight: null,
  },
  {
    id: "L3", label: "PURGE / JUDAS", color: C.red,
    inputs: ["BSL sweep (wick > 0.3×ATR)", "SSL sweep (wick > 0.3×ATR)", "Close reversion ≥70% into range", "Volume spike ≥1.5×avg"],
    logic: "swept AND close_reverted → judas=TRUE",
    output: "purge.judas_candle = TRUE",
    weight: null,
  },
  {
    id: "L4", label: "DISPLACEMENT", color: C.green,
    inputs: ["Body ≥ 0.6×ATR14", "FVG gap ≥ 0.15×ATR14", "FVG vol ≥ 1.3×avg", "Direction match"],
    logic: "body_pct ≥ min_body_atr AND fvg_quality ≥ vol_mult",
    output: "disp.fvg [high, low, quality]",
    weight: null,
  },
  {
    id: "L5", label: "PD ARRAY SCORE", color: C.purple,
    inputs: ["OB zone (50% level)", "FVG midpoint", "VWAP ±0.2×ATR", "OTE 61.8–78.6%", "Confluence ≥ 2"],
    logic: "price_in_zone(ob OR fvg OR vwap OR ote)",
    output: "pd.confluence_score 0–4",
    weight: null,
  },
  {
    id: "L6", label: "BOS / CHoCH", color: C.muted,
    inputs: ["BOS confirmed on 3m", "CHoCH on 3m", "MSS on 1m"],
    logic: "CONFIDENCE BOOST ONLY — NOT a gate\n+5–10 to edge score",
    output: "score.bos_boost (optional)",
    weight: null,
    dimmed: true,
  },
  {
    id: "L7", label: "EDGE SCORE", color: C.orange,
    inputs: ["Structure ×0.45", "Liquidity ×0.30", "Volatility ×0.21", "Sentiment ×0.04"],
    logic: "Σ(weighted scores) × decay_mult × kz_boost",
    output: "signal.edge_score 0–100",
    weight: "EARLY: ≥65 | LATE: ≥70",
  },
];

const DIVERGENCES = [
  { label: "PRICE vs CVD DELTA", desc: "Price HH + CVD LH → bearish div → −8 score", color: C.red },
  { label: "SMT DIVERGENCE", desc: "BTC new high, ETH fails (or vice versa) → −6 score", color: C.orange },
  { label: "DIV EXPANSION KILL", desc: "Divergence expands 3+ bars post-entry → CLOSE ALL", color: C.red },
];

const KILL_SWITCHES = [
  { id: "STRUCT_FAIL", desc: "Price reclaims OB", action: "Close all", color: C.red },
  { id: "RECLAIM_FAIL", desc: "Close inside FVG", action: "Close 50%", color: C.red },
  { id: "DIV_EXPAND", desc: "CVD divergence", action: "Close all", color: C.red },
  { id: "GATE_DROP", desc: "KZ closes, -PnL", action: "Close all", color: C.orange },
  { id: "SESSION_CAP", desc: "DD cap hit", action: "Halt session", color: C.red },
  { id: "DAILY_CAP", desc: "Daily loss limit", action: "Halt day", color: C.red },
];

function PipelineNode({ node, active, onClick }) {
  return (
    <div
      onClick={() => onClick(node.id)}
      style={{
        cursor: "pointer",
        background: active ? node.color + "18" : C.card,
        border: `1px solid ${active ? node.color : C.border}`,
        borderLeft: `4px solid ${node.color}`,
        padding: "12px 14px",
        borderRadius: 3,
        opacity: node.dimmed ? 0.65 : 1,
        boxShadow: active ? `0 0 20px ${node.color}28` : "none",
        transition: "all 0.2s",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <span style={{ fontSize: 9, color: node.color, fontFamily: "monospace", letterSpacing: 2 }}>{node.id}</span>
        {node.dimmed && (
          <span style={{ fontSize: 8, color: C.muted, fontFamily: "monospace", letterSpacing: 1 }}>CONFIDENCE ONLY</span>
        )}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: active ? node.color : C.white, fontFamily: "monospace", marginBottom: 4 }}>
        {node.label}
      </div>
      <div style={{ fontSize: 9, color: C.muted, fontFamily: "monospace" }}>
        OUTPUT: <span style={{ color: node.color }}>{node.output}</span>
      </div>
      {node.weight && (
        <div style={{
          marginTop: 6, padding: "3px 8px",
          background: node.color + "22", border: `1px solid ${node.color}44`,
          fontSize: 9, color: node.color, fontFamily: "monospace", borderRadius: 2,
        }}>
          FIRE: {node.weight}
        </div>
      )}
    </div>
  );
}

function DetailPanel({ node }) {
  if (!node) return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      padding: 20, borderRadius: 3, height: "100%",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <span style={{ color: C.muted, fontSize: 10, fontFamily: "monospace" }}>← SELECT A LAYER</span>
    </div>
  );

  return (
    <div style={{
      background: C.surface, border: `1px solid ${node.color}44`,
      borderTop: `3px solid ${node.color}`,
      padding: 16, borderRadius: 3,
    }}>
      <div style={{ fontSize: 9, color: node.color, fontFamily: "monospace", letterSpacing: 3, marginBottom: 4 }}>{node.id}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.white, fontFamily: "monospace", marginBottom: 12 }}>{node.label}</div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: C.muted, fontFamily: "monospace", letterSpacing: 1, marginBottom: 6 }}>INPUTS</div>
        {node.inputs.map((inp, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
            <span style={{ color: node.color, fontSize: 10 }}>◆</span>
            <span style={{ color: C.text, fontSize: 10, fontFamily: "monospace" }}>{inp}</span>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: C.muted, fontFamily: "monospace", letterSpacing: 1, marginBottom: 6 }}>GATE LOGIC</div>
        <div style={{
          background: "#020408", border: `1px solid ${C.border}`,
          padding: "8px 12px", fontSize: 10, color: C.green, fontFamily: "monospace",
          lineHeight: 1.6, borderRadius: 2, whiteSpace: "pre-wrap",
        }}>{node.logic}</div>
      </div>

      <div>
        <div style={{ fontSize: 9, color: C.muted, fontFamily: "monospace", letterSpacing: 1, marginBottom: 4 }}>OUTPUT</div>
        <div style={{
          padding: "6px 10px", background: node.color + "18",
          border: `1px solid ${node.color}44`, borderRadius: 2,
          fontSize: 10, color: node.color, fontFamily: "monospace",
        }}>{node.output}</div>
      </div>
    </div>
  );
}

export default function ArchDiagram() {
  const [activeId, setActiveId] = useState("L1");
  const activeNode = PIPELINE.find(n => n.id === activeId);

  const toggle = (id) => setActiveId(prev => prev === id ? null : id);

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: 20, fontFamily: "monospace" }}>
      {/* Header */}
      <div style={{
        marginBottom: 20, borderBottom: `1px solid ${C.border}`, paddingBottom: 14,
        display: "flex", justifyContent: "space-between", alignItems: "flex-end",
      }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: 4, color: C.accent, marginBottom: 3 }}>SURGE · SIGNAL ARCHITECTURE</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.white, letterSpacing: 2 }}>
            ICT/SMC INTRADAY PIPELINE
          </div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>
            7-LAYER GATE MODEL · LIQUIDITY-FIRST · BOS/CHoCH AS CONFIDENCE ONLY
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 9 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: C.green, fontWeight: 700, fontSize: 14 }}>43%</div>
            <div style={{ color: C.muted }}>EARLY WIN%</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: C.gold, fontWeight: 700, fontSize: 14 }}>3.0R</div>
            <div style={{ color: C.muted }}>EARLY AVG-R</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: C.accent, fontWeight: 700, fontSize: 14 }}>57%</div>
            <div style={{ color: C.muted }}>LATE WIN%</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: C.purple, fontWeight: 700, fontSize: 14 }}>1.9R</div>
            <div style={{ color: C.muted }}>LATE AVG-R</div>
          </div>
        </div>
      </div>

      {/* Pipeline + Detail */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, marginBottom: 20 }}>
        {/* Pipeline grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, alignContent: "start" }}>
          {PIPELINE.map(node => (
            <PipelineNode key={node.id} node={node} active={activeId === node.id} onClick={toggle} />
          ))}
          {/* Edge score fires signal */}
          <div style={{
            gridColumn: "1 / -1",
            background: C.orange + "12", border: `1px solid ${C.orange}44`,
            borderLeft: `4px solid ${C.orange}`,
            padding: "10px 14px", borderRadius: 3,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div>
              <div style={{ fontSize: 9, color: C.orange, letterSpacing: 2 }}>SIGNAL FIRE</div>
              <div style={{ fontSize: 11, color: C.white, fontWeight: 700, marginTop: 2 }}>
                edge_score ≥ threshold → direction + entry_px + stop_px + tp1 + kelly_size
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ padding: "4px 10px", background: C.green + "20", border: `1px solid ${C.green}44`, fontSize: 9, color: C.green, borderRadius: 2 }}>LONG</div>
              <div style={{ padding: "4px 10px", background: C.red + "20", border: `1px solid ${C.red}44`, fontSize: 9, color: C.red, borderRadius: 2 }}>SHORT</div>
            </div>
          </div>
        </div>

        {/* Detail panel */}
        <DetailPanel node={activeNode} />
      </div>

      {/* Divergence + Kill row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Divergence safeguards */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 14, borderRadius: 3 }}>
          <div style={{ fontSize: 9, color: C.red, letterSpacing: 2, marginBottom: 10 }}>DIVERGENCE SAFEGUARDS</div>
          {DIVERGENCES.map((d, i) => (
            <div key={i} style={{
              display: "flex", gap: 10, marginBottom: 8,
              padding: "8px 10px", background: d.color + "0d",
              border: `1px solid ${d.color}33`, borderRadius: 2,
            }}>
              <span style={{ color: d.color, fontSize: 14, flexShrink: 0 }}>⚠</span>
              <div>
                <div style={{ fontSize: 10, color: d.color, fontWeight: 700, marginBottom: 2 }}>{d.label}</div>
                <div style={{ fontSize: 9, color: C.muted }}>{d.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Kill switches */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 14, borderRadius: 3 }}>
          <div style={{ fontSize: 9, color: C.red, letterSpacing: 2, marginBottom: 10 }}>KILL SWITCHES</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {KILL_SWITCHES.map((k, i) => (
              <div key={i} style={{
                padding: "8px 10px", background: k.color + "0d",
                border: `1px solid ${k.color}33`, borderRadius: 2,
              }}>
                <div style={{ fontSize: 10, color: k.color, fontWeight: 700, fontFamily: "monospace", marginBottom: 2 }}>{k.id}</div>
                <div style={{ fontSize: 9, color: C.text, marginBottom: 2 }}>{k.desc}</div>
                <div style={{ fontSize: 8, color: k.color, fontFamily: "monospace" }}>→ {k.action}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Weight bar */}
      <div style={{
        marginTop: 16, background: C.surface, border: `1px solid ${C.border}`,
        padding: "12px 16px", borderRadius: 3,
        display: "flex", gap: 0, overflow: "hidden",
      }}>
        {[
          { label: "STRUCTURE 45%", pct: 45, color: C.accent },
          { label: "LIQUIDITY 30%", pct: 30, color: C.gold },
          { label: "VOLATILITY 21%", pct: 21, color: C.green },
          { label: "SENTIMENT 4%", pct: 4, color: C.muted },
        ].map((w, i) => (
          <div key={i} style={{
            flex: w.pct, background: w.color + "22", borderRight: `1px solid ${C.bg}`,
            padding: "6px 10px", textAlign: "center",
          }}>
            <div style={{ fontSize: 9, color: w.color, fontFamily: "monospace", whiteSpace: "nowrap" }}>{w.label}</div>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 10, display: "flex", justifyContent: "space-between",
        fontSize: 8, color: C.muted, fontFamily: "monospace",
      }}>
        <span>1m COMPUTE · 3m DECISION WINDOW · PDH/PDL RECALC ON SESSION OPEN</span>
        <span>EARLY SET ≥65 · LATE SET ≥70 · KELLY ÷4 MAX · SESSION CAP 2.5%</span>
      </div>
    </div>
  );
}
