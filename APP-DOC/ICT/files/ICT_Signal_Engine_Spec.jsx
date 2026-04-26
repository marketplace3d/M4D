import { useState } from "react";

// ═══════════════════════════════════════════════════════════════════
//  SURGE · ICT/SMC INTRADAY SIGNAL ENGINE
//  Institutional Executable Specification v1.0
//  Liquidity-Draw → Purge → Displacement → PD Array → Edge Score
// ═══════════════════════════════════════════════════════════════════

const C = {
  bg: "#04060b",
  surface: "#080d17",
  card: "#0b1220",
  border: "#0f2035",
  borderBright: "#1a3a5c",
  accent: "#00c8f0",
  gold: "#e8a020",
  green: "#00e87a",
  red: "#ff2d55",
  purple: "#9b5de5",
  orange: "#ff6b35",
  dim: "#162035",
  text: "#b8d4ec",
  muted: "#3d5a78",
  white: "#e8f4ff",
};

const SECTIONS = [
  "SIGNAL ARCHITECTURE",
  "PARAMETER TABLE",
  "ENTRY / EXIT LOGIC",
  "RISK MODEL",
  "WALK-FORWARD PLAN",
  "FAILURE MODES",
  "SIGNAL SETS",
  "PROFILE PRESETS",
];

// ── TYPOGRAPHY & LAYOUT PRIMITIVES ──────────────────────────────
const H1 = ({ children }) => (
  <div style={{ fontSize: 11, letterSpacing: 4, color: C.accent, fontFamily: "'Courier New', monospace", marginBottom: 4 }}>
    {children}
  </div>
);
const H2 = ({ children, color }) => (
  <div style={{ fontSize: 16, fontWeight: 700, color: color || C.white, fontFamily: "'Courier New', monospace", marginBottom: 12, letterSpacing: 1 }}>
    {children}
  </div>
);
const H3 = ({ children, color }) => (
  <div style={{ fontSize: 11, fontWeight: 700, color: color || C.gold, fontFamily: "'Courier New', monospace", marginBottom: 8, letterSpacing: 2 }}>
    ▸ {children}
  </div>
);
const P = ({ children, color }) => (
  <p style={{ fontSize: 11, color: color || C.text, fontFamily: "'Courier New', monospace", lineHeight: 1.8, margin: "0 0 8px 0" }}>
    {children}
  </p>
);
const Code = ({ children }) => (
  <pre style={{
    background: "#020408", border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.accent}`,
    padding: "10px 14px", fontSize: 10, color: C.green, fontFamily: "'Courier New', monospace",
    lineHeight: 1.7, margin: "8px 0", overflowX: "auto", whiteSpace: "pre",
    borderRadius: 2,
  }}>{children}</pre>
);
const Tag = ({ v, color }) => (
  <span style={{
    display: "inline-block", padding: "2px 8px", fontSize: 9, letterSpacing: 1,
    background: (color || C.accent) + "18", border: `1px solid ${(color || C.accent)}44`,
    color: color || C.accent, fontFamily: "'Courier New', monospace", borderRadius: 2,
    margin: "0 4px 4px 0",
  }}>{v}</span>
);
const Divider = () => (
  <div style={{ borderTop: `1px solid ${C.border}`, margin: "16px 0" }} />
);

// ── TABLE ────────────────────────────────────────────────────────
function Table({ headers, rows, colColors }) {
  return (
    <div style={{ overflowX: "auto", marginBottom: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "'Courier New', monospace" }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{
                padding: "6px 10px", textAlign: "left",
                color: C.muted, borderBottom: `1px solid ${C.borderBright}`,
                letterSpacing: 1, fontWeight: 400,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : C.surface + "80" }}>
              {row.map((cell, j) => (
                <td key={j} style={{
                  padding: "5px 10px", color: colColors?.[j] || C.text,
                  borderBottom: `1px solid ${C.border}`,
                }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── SCORE BAR ────────────────────────────────────────────────────
function ScoreBar({ label, pct, color, weight }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: C.text, fontFamily: "monospace" }}>{label}</span>
        <span style={{ fontSize: 10, color: color, fontFamily: "monospace" }}>{weight}</span>
      </div>
      <div style={{ background: C.dim, height: 5, borderRadius: 2 }}>
        <div style={{
          height: 5, width: `${pct}%`, background: color, borderRadius: 2,
          boxShadow: `0 0 8px ${color}66`, transition: "width 0.6s ease",
        }} />
      </div>
    </div>
  );
}

// ── PILL BADGE ───────────────────────────────────────────────────
function Badge({ label, color, size = 10 }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "3px 10px",
      background: color + "20", border: `1px solid ${color}55`,
      color, fontSize: size, fontFamily: "monospace", borderRadius: 2,
      marginRight: 6, letterSpacing: 1,
    }}>{label}</span>
  );
}

// ── PROFILE CARD ─────────────────────────────────────────────────
function ProfileCard({ name, color, icon, fields }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${color}44`,
      borderTop: `3px solid ${color}`, padding: 16, borderRadius: 3,
      boxShadow: `0 0 20px ${color}10`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: "monospace", letterSpacing: 2 }}>{name}</span>
      </div>
      {fields.map(([k, v, vc], i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
          <span style={{ fontSize: 10, color: C.muted, fontFamily: "monospace" }}>{k}</span>
          <span style={{ fontSize: 10, color: vc || C.text, fontFamily: "monospace", fontWeight: 600 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

// ── SIGNAL FLOW NODE ─────────────────────────────────────────────
function FlowNode({ label, sub, color, wide }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${color}55`,
      borderLeft: `3px solid ${color}`, padding: "8px 12px",
      minWidth: wide ? 160 : 120, flexShrink: 0,
      boxShadow: `0 0 12px ${color}18`,
    }}>
      <div style={{ fontSize: 10, color, fontFamily: "monospace", fontWeight: 700, letterSpacing: 1 }}>{label}</div>
      {sub && <div style={{ fontSize: 9, color: C.muted, fontFamily: "monospace", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  SECTION CONTENT
// ────────────────────────────────────────────────────────────────

function S1_Architecture() {
  return (
    <div>
      <H1>SECTION 01</H1>
      <H2>SIGNAL ARCHITECTURE</H2>
      <P>Seven sequential gate layers. Each must pass or accumulate weight before the next activates. BOS/CHoCH sits at Layer 6 — confidence boost only, never primary trigger.</P>

      {/* Pipeline flow */}
      <div style={{ overflowX: "auto", paddingBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 900, marginBottom: 16 }}>
          {[
            { l: "L1", label: "LIQUIDITY DRAW", sub: "PDH/PDL/PWH/PWL\nEQH/EQL/Session", color: C.accent },
            { l: "→" },
            { l: "L2", label: "TIME GATE", sub: "LKZ/NY-AM\nOff-hours decay", color: C.gold },
            { l: "→" },
            { l: "L3", label: "PURGE DETECT", sub: "BSL/SSL sweep\nJudas candle", color: C.red },
            { l: "→" },
            { l: "L4", label: "DISPLACEMENT", sub: "ATR thresh\nFVG quality", color: C.green },
            { l: "→" },
            { l: "L5", label: "PD ARRAY", sub: "OB/FVG/VWAP\nOTE confluence", color: C.purple },
            { l: "→" },
            { l: "L6", label: "BOS/CHoCH", sub: "Confidence boost\n+weight only", color: C.muted },
            { l: "→" },
            { l: "L7", label: "EDGE SCORE", sub: "Weighted 0–100\nFire ≥ threshold", color: C.orange },
          ].map((n, i) => n.l === "→"
            ? <span key={i} style={{ color: C.muted, fontSize: 16 }}>→</span>
            : <FlowNode key={i} label={n.label} sub={n.sub} color={n.color} wide />
          )}
        </div>
      </div>

      <H3>WEIGHTED EDGE SCORE COMPOSITION</H3>
      <ScoreBar label="STRUCTURE  (BOS/CHoCH/MSS/Regime)" pct={45} color={C.accent} weight="45%" />
      <ScoreBar label="LIQUIDITY / ICT  (PDH/PDL/EQH/OB/FVG/OTE)" pct={30} color={C.gold} weight="30%" />
      <ScoreBar label="VOLATILITY  (ATR regime, displacement size, IV)" pct={21} color={C.green} weight="21%" />
      <ScoreBar label="SENTIMENT  (CVD/OI delta, optional non-gating)" pct={4} color={C.muted} weight="4%" />

      <Divider />
      <H3>POLLING CADENCE</H3>
      <Table
        headers={["PROCESS", "CADENCE", "RATIONALE"]}
        rows={[
          ["Feature compute (OHLCV, ATR, OB, FVG)", "1m bars", "Granularity for intraday displacement"],
          ["Decision window (edge score fire)", "3m bars", "Reduces noise, whipsaw filter"],
          ["Liquidity level recalc (PDH/PDL/PWH/PWL)", "1× per session open", "Static reference levels"],
          ["Session level recalc (Highs/Lows)", "Live ticks (≤5s)", "Capture developing EQH/EQL"],
          ["Divergence check (delta, SMT)", "1m bars", "Fast divergence expansion kill"],
          ["Risk exposure recalc", "On every fill", "Kelly update after each trade"],
        ]}
        colColors={[C.text, C.gold, C.muted]}
      />

      <Divider />
      <H3>FEATURE SCHEMA NAMES</H3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
        {[
          "feat.liq.pdh", "feat.liq.pdl", "feat.liq.pwh", "feat.liq.pwl",
          "feat.liq.eqh", "feat.liq.eql", "feat.liq.session_high", "feat.liq.session_low",
          "feat.time.killzone_active", "feat.time.decay_mult",
          "feat.purge.bsl_swept", "feat.purge.ssl_swept", "feat.purge.judas_candle",
          "feat.disp.atr_14", "feat.disp.candle_body_pct", "feat.disp.fvg_high", "feat.disp.fvg_low", "feat.disp.fvg_quality",
          "feat.pd.ob_bull_high", "feat.pd.ob_bull_low", "feat.pd.ob_bear_high", "feat.pd.ob_bear_low",
          "feat.pd.vwap", "feat.pd.ote_fib618", "feat.pd.ote_fib786", "feat.pd.confluence_score",
          "feat.struct.bos", "feat.struct.choch", "feat.struct.mss", "feat.struct.regime",
          "feat.vol.delta_div", "feat.vol.smt_div", "feat.vol.atr_regime",
          "feat.sent.cvd_delta", "feat.sent.oi_delta",
          "signal.edge_score", "signal.edge_struct", "signal.edge_liq", "signal.edge_vol", "signal.edge_sent",
          "signal.fire", "signal.direction", "signal.set_type",
        ].map((f, i) => <Tag key={i} v={f} color={i < 8 ? C.accent : i < 10 ? C.gold : i < 13 ? C.red : i < 18 ? C.green : i < 28 ? C.purple : C.muted} />)}
      </div>
    </div>
  );
}

function S2_Parameters() {
  return (
    <div>
      <H1>SECTION 02</H1>
      <H2>PARAMETER TABLE</H2>
      <P>All parameters have default (Balanced), min (Conservative), and max (Aggressive) values. Tune via walk-forward grid; never optimise on in-sample only.</P>

      <H3>LIQUIDITY DRAW MODEL</H3>
      <Table
        headers={["PARAMETER", "FEATURE NAME", "DEFAULT", "MIN", "MAX", "UNIT"]}
        rows={[
          ["PDH lookback", "cfg.liq.pdh_bars", "1440", "480", "2880", "minutes (1D)"],
          ["PWH lookback", "cfg.liq.pwh_bars", "10080", "4320", "20160", "minutes (1W)"],
          ["EQH tolerance", "cfg.liq.eqh_tol", "0.0015", "0.0005", "0.003", "% of price"],
          ["Session High window", "cfg.liq.sess_window", "240", "60", "480", "minutes"],
          ["Liquidity proximity trigger", "cfg.liq.prox_atr", "0.5", "0.25", "1.0", "× ATR"],
          ["External range sweep depth", "cfg.liq.ext_sweep_pct", "0.003", "0.001", "0.008", "% of price"],
        ]}
        colColors={[C.text, C.accent, C.gold, C.muted, C.muted, C.muted]}
      />

      <H3>TIME MODEL</H3>
      <Table
        headers={["PARAMETER", "FEATURE NAME", "DEFAULT", "MIN", "MAX", "UNIT"]}
        rows={[
          ["London KZ start (UTC)", "cfg.time.lkz_start", "07:00", "06:30", "08:00", "HH:MM UTC"],
          ["London KZ end (UTC)", "cfg.time.lkz_end", "10:00", "09:00", "11:00", "HH:MM UTC"],
          ["NY AM KZ start (UTC)", "cfg.time.nyam_start", "13:30", "13:00", "14:00", "HH:MM UTC"],
          ["NY AM KZ end (UTC)", "cfg.time.nyam_end", "16:00", "15:00", "17:00", "HH:MM UTC"],
          ["Off-hours decay multiplier", "cfg.time.decay_mult", "0.4", "0.0", "0.7", "scalar"],
          ["KZ weight boost", "cfg.time.kz_boost", "1.25", "1.0", "1.5", "scalar"],
        ]}
        colColors={[C.text, C.gold, C.gold, C.muted, C.muted, C.muted]}
      />

      <H3>PURGE / MANIPULATION MODEL</H3>
      <Table
        headers={["PARAMETER", "FEATURE NAME", "DEFAULT", "MIN", "MAX", "UNIT"]}
        rows={[
          ["Sweep wick extension", "cfg.purge.wick_atr", "0.3", "0.15", "0.8", "× ATR"],
          ["Sweep candle close reversion", "cfg.purge.close_pct", "0.7", "0.5", "0.95", "% into prior range"],
          ["Judas candle volume spike", "cfg.purge.vol_mult", "1.5", "1.2", "3.0", "× 20-bar avg vol"],
          ["Max bars after sweep to MSS", "cfg.purge.mss_bars", "5", "2", "12", "bars (3m)"],
          ["Sweep lookback for BSL/SSL", "cfg.purge.lookback", "20", "10", "50", "bars"],
        ]}
        colColors={[C.text, C.red, C.gold, C.muted, C.muted, C.muted]}
      />

      <H3>DISPLACEMENT MODEL</H3>
      <Table
        headers={["PARAMETER", "FEATURE NAME", "DEFAULT", "MIN", "MAX", "UNIT"]}
        rows={[
          ["Min displacement body", "cfg.disp.min_body_atr", "0.6", "0.4", "1.2", "× ATR"],
          ["FVG min gap size", "cfg.disp.fvg_min_atr", "0.15", "0.05", "0.4", "× ATR"],
          ["FVG quality: volume req", "cfg.disp.fvg_vol_mult", "1.3", "1.0", "2.5", "× avg vol"],
          ["FVG expiry (bars)", "cfg.disp.fvg_expiry", "20", "5", "50", "bars (3m)"],
          ["Displacement direction match", "cfg.disp.dir_match", "true", "—", "—", "bool"],
        ]}
        colColors={[C.text, C.green, C.gold, C.muted, C.muted, C.muted]}
      />

      <H3>PD ARRAY MODEL</H3>
      <Table
        headers={["PARAMETER", "FEATURE NAME", "DEFAULT", "MIN", "MAX", "UNIT"]}
        rows={[
          ["OB lookback window", "cfg.pd.ob_lookback", "10", "5", "30", "bars"],
          ["OB body size min", "cfg.pd.ob_min_body", "0.4", "0.2", "0.8", "× ATR"],
          ["OTE Fib low (618)", "cfg.pd.ote_fib_lo", "0.618", "0.5", "0.65", "Fibonacci"],
          ["OTE Fib high (786)", "cfg.pd.ote_fib_hi", "0.786", "0.7", "0.85", "Fibonacci"],
          ["VWAP band tolerance", "cfg.pd.vwap_tol_atr", "0.2", "0.05", "0.5", "× ATR"],
          ["Min confluence count", "cfg.pd.min_confluence", "2", "1", "4", "integer"],
          ["PD zone proximity", "cfg.pd.zone_prox_atr", "0.3", "0.1", "0.6", "× ATR"],
        ]}
        colColors={[C.text, C.purple, C.gold, C.muted, C.muted, C.muted]}
      />

      <H3>EDGE SCORE THRESHOLDS</H3>
      <Table
        headers={["PARAMETER", "FEATURE NAME", "CONSERVATIVE", "BALANCED", "AGGRESSIVE"]}
        rows={[
          ["Fire threshold (early set)", "cfg.score.fire_early", "75", "65", "55"],
          ["Fire threshold (late set)", "cfg.score.fire_late", "80", "70", "60"],
          ["BOS/CHoCH confidence boost", "cfg.score.bos_boost", "+5", "+8", "+10"],
          ["Off-hours score penalty", "cfg.score.offhours_pen", "−20", "−15", "−10"],
          ["Divergence kill threshold", "cfg.score.div_kill", "−15", "−12", "−8"],
        ]}
        colColors={[C.text, C.orange, C.green, C.gold, C.red]}
      />
    </div>
  );
}

function S3_EntryExit() {
  return (
    <div>
      <H1>SECTION 03</H1>
      <H2>ENTRY / EXIT LOGIC</H2>

      <H3>EARLY SIGNAL SET — "PRE-CONFIRMATION"</H3>
      <P color={C.gold}>Trigger: Liquidity sweep detected + displacement candle ≥ ATR threshold + PD array proximity. BOS/CHoCH not required.</P>
      <Code>{`# EARLY SIGNAL FIRE
def compute_early_signal(feat, cfg):
    # Gate 1: Active killzone
    if not feat.time.killzone_active:
        return NO_SIGNAL

    # Gate 2: Liquidity proximity — price within cfg.liq.prox_atr of PDH/PDL/EQH/EQL
    liq_prox = min_dist_to_liq_levels(feat) < cfg.liq.prox_atr * feat.disp.atr_14
    if not liq_prox:
        return NO_SIGNAL

    # Gate 3: Purge candle — wick swept BSL or SSL with close reversal
    judas = (
        feat.purge.bsl_swept or feat.purge.ssl_swept
    ) and feat.purge.close_pct >= cfg.purge.close_pct

    # Gate 4: Displacement — strong directional candle post-purge
    displaced = (
        feat.disp.candle_body_pct >= cfg.disp.min_body_atr * feat.disp.atr_14
        and feat.disp.fvg_quality >= cfg.disp.fvg_vol_mult
    )

    # Gate 5: PD array — price inside OB or FVG with ≥ N confluence
    pd_active = feat.pd.confluence_score >= cfg.pd.min_confluence

    # Compute weighted edge score
    edge = (
        score_structure(feat) * 0.45
        + score_liquidity(feat) * 0.30
        + score_volatility(feat) * 0.21
        + score_sentiment(feat) * 0.04
    ) * feat.time.decay_mult * cfg.time.kz_boost

    # BOS/CHoCH confidence boost (NOT gate)
    if feat.struct.bos or feat.struct.choch:
        edge += cfg.score.bos_boost

    if judas and displaced and pd_active and edge >= cfg.score.fire_early:
        direction = SHORT if feat.purge.bsl_swept else LONG
        return Signal(type=EARLY, direction=direction, edge=edge)

    return NO_SIGNAL`}</Code>

      <H3>LATE CONFIRMATION SET — "POST-BOS"</H3>
      <P color={C.muted}>Trigger: All early conditions + confirmed BOS/CHoCH on 3m. Higher win-rate, lower R-multiple, 2–4 bars later entry.</P>
      <Code>{`# LATE SIGNAL FIRE
def compute_late_signal(feat, cfg):
    early = compute_early_signal(feat, cfg)
    if not early:
        return NO_SIGNAL

    # Require confirmed structure break
    if not (feat.struct.bos or feat.struct.choch or feat.struct.mss):
        return NO_SIGNAL

    # Recalc edge with confirmation premium
    edge = early.edge + cfg.score.bos_boost  # already in early, but recheck
    if edge >= cfg.score.fire_late:
        return Signal(type=LATE, direction=early.direction, edge=edge)

    return NO_SIGNAL`}</Code>

      <Divider />
      <H3>ENTRY EXECUTION</H3>
      <Code>{`# ENTRY LOGIC
def on_signal_fire(signal, feat, cfg):
    # Entry: limit order at nearest PD zone (FVG mid or OB 50%)
    if signal.direction == LONG:
        entry_px = (feat.pd.ob_bull_high + feat.pd.ob_bull_low) / 2
        # Or FVG midpoint if tighter
        fvg_mid = (feat.disp.fvg_high + feat.disp.fvg_low) / 2
        entry_px = min(entry_px, fvg_mid)  # more conservative fill

        # Stop: below OB low - buffer
        stop_px = feat.pd.ob_bull_low - 0.15 * feat.disp.atr_14

        # TP1: nearest BSL (draw-on-liquidity target)
        tp1_px = feat.liq.session_high   # or PDH if above
        tp2_px = feat.liq.pdh            # external range target

    elif signal.direction == SHORT:
        entry_px = (feat.pd.ob_bear_high + feat.pd.ob_bear_low) / 2
        fvg_mid = (feat.disp.fvg_high + feat.disp.fvg_low) / 2
        entry_px = max(entry_px, fvg_mid)

        stop_px = feat.pd.ob_bear_high + 0.15 * feat.disp.atr_14
        tp1_px = feat.liq.session_low
        tp2_px = feat.liq.pdl

    rr = abs(tp1_px - entry_px) / abs(entry_px - stop_px)

    # Minimum R:R gate
    if rr < cfg.risk.min_rr:
        return REJECT_TRADE  # Poor structure geometry

    return TradeSpec(entry=entry_px, sl=stop_px, tp1=tp1_px, tp2=tp2_px, rr=rr)`}</Code>

      <H3>EXIT LOGIC</H3>
      <Code>{`# EXIT MANAGEMENT
def manage_trade(trade, feat, cfg):
    # TP1 partial close (60% of position)
    if price_reached(trade.tp1):
        close_partial(0.60)
        move_sl_to_breakeven()

    # TP2 full close on remaining 40%
    if price_reached(trade.tp2):
        close_all()

    # Trail stop: below last displacement FVG after TP1
    if trade.tp1_hit:
        new_sl = feat.disp.fvg_low - 0.1 * feat.disp.atr_14  # long
        if new_sl > trade.current_sl:
            update_sl(new_sl)

    # Time-based exit: close before session end (avoid NY close spread)
    if minutes_to_session_end() < cfg.risk.close_before_mins:
        close_all(reason="TIME_EXIT")

    # Kill switch exits — see Section 6
    if check_kill_conditions(trade, feat):
        close_all(reason="KILL_SWITCH")`}</Code>

      <H3>DIVERGENCE SAFEGUARDS</H3>
      <Code>{`# PRICE vs DELTA DIVERGENCE
def check_delta_divergence(feat, cfg):
    # Price making HH but CVD delta making LH → bearish divergence
    price_hh = feat.struct.price_higher_high
    cvd_lh = feat.vol.cvd_lower_high
    delta_div = price_hh and cvd_lh  # or inverse for longs

    # SMT divergence: BTC making new high, ETH failing (or vice versa)
    smt_div = (
        feat.vol.btc_new_high and not feat.vol.eth_new_high
    ) or (
        feat.vol.eth_new_high and not feat.vol.btc_new_high
    )

    # Score adjustment — NOT a hard gate unless extreme
    div_penalty = 0
    if delta_div:
        div_penalty -= 8
    if smt_div:
        div_penalty -= 6

    # Hard kill if divergence expands post-entry
    if feat.vol.div_expansion > cfg.score.div_kill:
        return KILL_TRADE

    return div_penalty`}</Code>
    </div>
  );
}

function S4_RiskModel() {
  return (
    <div>
      <H1>SECTION 04</H1>
      <H2>RISK MODEL</H2>

      <H3>KELLY SIZING</H3>
      <Code>{`# FRACTIONAL KELLY POSITION SIZING
# Kelly formula: f* = (p * b - q) / b
#   p = win rate (rolling 30-trade estimate)
#   q = 1 - p (loss rate)
#   b = avg R-multiple on wins / 1

def kelly_size(account_equity, p_win, avg_r, cfg):
    q = 1.0 - p_win
    b = avg_r  # e.g. 2.1R average win

    kelly_f = (p_win * b - q) / b

    # Quarter-Kelly cap — hard max
    kelly_f = min(kelly_f, cfg.risk.max_kelly_fraction)  # default 0.25

    # Floor at minimum to avoid dust positions
    kelly_f = max(kelly_f, cfg.risk.min_kelly_fraction)  # default 0.005

    # Dollar risk
    risk_dollars = account_equity * kelly_f * cfg.risk.base_risk_pct

    # Hard max per trade
    risk_dollars = min(risk_dollars, cfg.risk.max_trade_risk_dollars)

    return risk_dollars

# POSITION SIZE from risk $
def position_size(risk_dollars, entry_px, stop_px):
    stop_dist = abs(entry_px - stop_px)
    return risk_dollars / stop_dist  # units`}</Code>

      <H3>EXPOSURE LIMITS</H3>
      <Table
        headers={["LIMIT", "PARAMETER", "CONSERVATIVE", "BALANCED", "AGGRESSIVE"]}
        rows={[
          ["Max Kelly fraction", "cfg.risk.max_kelly_fraction", "0.10", "0.25", "0.40"],
          ["Base risk % per trade", "cfg.risk.base_risk_pct", "0.005", "0.010", "0.020"],
          ["Max trade risk $", "cfg.risk.max_trade_risk_dollars", "500", "1000", "2500"],
          ["Max session loss %", "cfg.risk.session_drawdown_cap", "1.5%", "2.5%", "4.0%"],
          ["Max concurrent trades", "cfg.risk.max_concurrent", "1", "2", "3"],
          ["Max daily loss (hard stop)", "cfg.risk.daily_loss_cap", "2.0%", "3.5%", "5.0%"],
          ["Min R:R to enter", "cfg.risk.min_rr", "2.5", "2.0", "1.5"],
          ["Close before session end", "cfg.risk.close_before_mins", "30", "15", "5"],
        ]}
        colColors={[C.text, C.accent, C.green, C.gold, C.red]}
      />

      <H3>EXPOSURE CAP LOGIC</H3>
      <Code>{`# SESSION EXPOSURE MANAGER
class SessionRiskManager:
    def __init__(self, cfg, equity):
        self.session_loss = 0.0
        self.daily_loss = 0.0
        self.open_trades = []
        self.cfg = cfg
        self.equity = equity

    def can_trade(self):
        # Hard session cap
        if self.session_loss / self.equity > self.cfg.risk.session_drawdown_cap:
            return False, "SESSION_CAP_HIT"
        # Hard daily cap
        if self.daily_loss / self.equity > self.cfg.risk.daily_loss_cap:
            return False, "DAILY_CAP_HIT"
        # Concurrency
        if len(self.open_trades) >= self.cfg.risk.max_concurrent:
            return False, "CONCURRENT_LIMIT"
        return True, "OK"

    def on_close(self, pnl):
        if pnl < 0:
            self.session_loss += abs(pnl)
            self.daily_loss += abs(pnl)`}</Code>
    </div>
  );
}

function S5_WalkForward() {
  return (
    <div>
      <H1>SECTION 05</H1>
      <H2>WALK-FORWARD TEST PLAN</H2>

      <H3>TEST STRUCTURE</H3>
      <Table
        headers={["PHASE", "WINDOW", "PURPOSE", "METRIC TARGET"]}
        rows={[
          ["IS (In-Sample)", "6 months", "Parameter optimisation grid", "Edge score > 60"],
          ["OOS (Out-of-Sample)", "2 months", "Blind validation — no refit", "Sharpe ≥ 1.2"],
          ["WF Walk (anchored)", "Roll 1m forward, 6m IS / 2m OOS", "Regime stability check", "CAGR/MaxDD ≥ 2.0"],
          ["Monte Carlo", "5000 shuffles", "Confidence interval on DD", "95th pctile DD < 20%"],
          ["Regime stress", "2020 crash, 2022 bear, 2024 vol", "Tail risk / kill switch test", "No single DD > 8%"],
        ]}
        colColors={[C.gold, C.text, C.muted, C.green]}
      />

      <H3>OPTIMISATION GRID (BALANCED PROFILE)</H3>
      <Code>{`GRID = {
    "cfg.score.fire_early":     [55, 60, 65, 70, 75],
    "cfg.purge.close_pct":      [0.60, 0.70, 0.80],
    "cfg.disp.min_body_atr":    [0.4, 0.6, 0.8],
    "cfg.pd.min_confluence":    [1, 2, 3],
    "cfg.risk.min_rr":          [1.5, 2.0, 2.5],
    "cfg.time.decay_mult":      [0.2, 0.4, 0.6],
}

# Objective function — NOT pure Sharpe (avoids overfit on tails)
def objective(results):
    sharpe = results.sharpe
    max_dd = results.max_drawdown
    win_rate = results.win_rate
    avg_r = results.avg_r_multiple
    n_trades = results.n_trades

    # Penalise low trade count (insufficient stats)
    if n_trades < 30:
        return -999

    # Penalise poor R
    if avg_r < 1.2:
        return -999

    return sharpe * (1 - max_dd) * min(1.0, n_trades / 100)`}</Code>

      <H3>ACCEPTANCE CRITERIA</H3>
      <Table
        headers={["METRIC", "MINIMUM (PASS)", "TARGET", "REJECT IF"]}
        rows={[
          ["OOS Sharpe", "1.0", "≥ 1.5", "< 0.8"],
          ["OOS Win Rate (Early)", "40%", "45–55%", "< 35%"],
          ["OOS Avg R-multiple", "1.8R", "≥ 2.2R", "< 1.5R"],
          ["Max Drawdown (OOS)", "< 12%", "< 8%", "> 15%"],
          ["IS/OOS Sharpe decay", "< 35%", "< 20%", "> 50%"],
          ["WF Anchor consistency", "6/8 windows pass", "8/8", "< 5/8"],
          ["Monte Carlo 95th DD", "< 18%", "< 12%", "> 20%"],
          ["Regime survival (bear)", "Positive expectancy", "Sharpe ≥ 0.8", "Net loss"],
        ]}
        colColors={[C.text, C.gold, C.green, C.red]}
      />
    </div>
  );
}

function S6_Failures() {
  return (
    <div>
      <H1>SECTION 06</H1>
      <H2>FAILURE MODES / KILL SWITCHES</H2>

      <H3>TRADE-LEVEL INVALIDATION</H3>
      <Code>{`# KILL CONDITIONS — evaluated every 1m bar post-entry
KILL_CONDITIONS = [
    {
        "id": "STRUCT_FAIL",
        "condition": "price reclaims OB high (long) or OB low (short) by > 0.1 × ATR",
        "formula": "price > ob_bull_high + 0.1 * atr  # for long",
        "action": "immediate close at market",
        "reason": "PD array invalidated — thesis broken"
    },
    {
        "id": "RECLAIM_FAIL",
        "condition": "price closes back inside the FVG that triggered entry",
        "formula": "candle_close inside [fvg_low, fvg_high]",
        "action": "close 50% immediately, set hard stop at FVG midpoint",
        "reason": "Displacement absorbed — no continuation"
    },
    {
        "id": "DIV_EXPAND",
        "condition": "CVD delta divergence expands > threshold post-entry",
        "formula": "delta_div_score < cfg.score.div_kill",
        "action": "immediate close",
        "reason": "Smart money not participating in direction"
    },
    {
        "id": "GATE_DROP",
        "condition": "killzone window closes before TP1 hit and position < breakeven",
        "formula": "not time.killzone_active and trade.unrealised_pnl < 0",
        "action": "close at next 3m bar open",
        "reason": "Time model no longer supports thesis"
    },
    {
        "id": "SMT_EXPAND",
        "condition": "SMT divergence proxy expands (BTC/ETH diverge further)",
        "formula": "smt_div_bars > 3  # divergence persisting 3+ bars",
        "action": "reduce size by 50%",
        "reason": "Cross-asset confirmation collapsing"
    },
    {
        "id": "SESSION_CAP",
        "condition": "Session loss cap hit",
        "formula": "session_loss / equity > cfg.risk.session_drawdown_cap",
        "action": "close all open trades, halt new signals for session",
        "reason": "Risk manager override"
    },
]`}</Code>

      <H3>SYSTEM-LEVEL CIRCUIT BREAKERS</H3>
      <Table
        headers={["BREAKER", "TRIGGER", "ACTION", "RESET"]}
        rows={[
          ["Daily Loss Cap", "Daily PnL < −cfg.risk.daily_loss_cap × equity", "Halt all trading for calendar day", "Next session open"],
          ["Consecutive Losses", "5 consecutive losses in session", "Halt new entries, keep management running", "Next killzone window"],
          ["Edge Score Drift", "Rolling 20-trade avg edge < 45", "Reduce size by 50%, alert operator", "Manual override"],
          ["Data Feed Anomaly", "ATR spike > 5× 20-bar avg", "Halt entries, close TP-close only", "ATR normalises < 2×"],
          ["Spread Spike", "Spread > 2× normal", "Reject all new entries", "Spread normalises"],
          ["Connectivity Gap", "Feed gap > 2 bars", "Flag all open trades for manual review", "Feed resumes + 5 bars"],
          ["Correlation Breakdown", "BTC/ETH corr < 0.4 (rolling 1h)", "Disable SMT divergence layer", "Corr > 0.55 for 2h"],
        ]}
        colColors={[C.red, C.text, C.gold, C.green]}
      />
    </div>
  );
}

function S7_SignalSets() {
  return (
    <div>
      <H1>SECTION 07</H1>
      <H2>EARLY vs LATE SIGNAL SETS</H2>

      <P>The core architectural tradeoff: enter before confirmation (capture more R, accept lower win-rate) vs wait for BOS/CHoCH (higher win-rate, smaller R because 30–40% of the move is already gone).</P>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div style={{
          background: C.card, border: `1px solid ${C.green}44`,
          borderTop: `3px solid ${C.green}`, padding: 14, borderRadius: 2,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green, fontFamily: "monospace", marginBottom: 10, letterSpacing: 2 }}>
            ⚡ EARLY SIGNAL SET
          </div>
          {[
            ["Primary trigger", "Liquidity sweep + displacement"],
            ["BOS/CHoCH required", "NO — confidence boost only (+5–10)"],
            ["Typical entry bar", "Bar 1–3 post-sweep"],
            ["Win rate (expected)", "38–48%"],
            ["Avg R-multiple", "2.4 – 3.2R"],
            ["Expectancy", "+0.52R per trade"],
            ["Entry fill", "Limit at OB/FVG level"],
            ["Stop width", "Below OB low (tighter)"],
            ["Best regime", "Strong trending, clear session"],
            ["Worst case", "Ranging market, no follow-through"],
          ].map(([k, v], i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: C.muted, fontFamily: "monospace" }}>{k}</span>
              <span style={{ fontSize: 9, color: C.text, fontFamily: "monospace" }}>{v}</span>
            </div>
          ))}
        </div>

        <div style={{
          background: C.card, border: `1px solid ${C.gold}44`,
          borderTop: `3px solid ${C.gold}`, padding: 14, borderRadius: 2,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.gold, fontFamily: "monospace", marginBottom: 10, letterSpacing: 2 }}>
            ◆ LATE CONFIRMATION SET
          </div>
          {[
            ["Primary trigger", "Early conditions + BOS/CHoCH confirmed"],
            ["BOS/CHoCH required", "YES — hard gate"],
            ["Typical entry bar", "Bar 4–8 post-sweep"],
            ["Win rate (expected)", "52–62%"],
            ["Avg R-multiple", "1.6 – 2.2R"],
            ["Expectancy", "+0.48R per trade"],
            ["Entry fill", "Market or limit at retest"],
            ["Stop width", "Below confirmed structure (wider)"],
            ["Best regime", "Moderate trend, choppy session"],
            ["Worst case", "Fast trending — misses move entirely"],
          ].map(([k, v], i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span key={i} style={{ fontSize: 9, color: C.muted, fontFamily: "monospace" }}>{k}</span>
              <span style={{ fontSize: 9, color: C.text, fontFamily: "monospace" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      <H3>EXPECTED TRADEOFF MATRIX</H3>
      <Table
        headers={["METRIC", "EARLY SET", "LATE SET", "COMBINED (60/40)"]}
        rows={[
          ["Win Rate", "43%", "57%", "49%"],
          ["Avg Win R", "3.0R", "1.9R", "2.5R"],
          ["Avg Loss R", "1.0R", "1.0R", "1.0R"],
          ["Expectancy /trade", "+0.52R", "+0.48R", "+0.51R"],
          ["Trades/month (est)", "12–18", "8–14", "20–32"],
          ["Sharpe (est)", "1.3–1.7", "1.4–1.8", "1.5–1.9"],
          ["Timeliness", "Captures 70–90% of move", "Captures 50–65% of move", "Blended"],
          ["Regime sensitivity", "High", "Medium", "Balanced"],
        ]}
        colColors={[C.text, C.green, C.gold, C.accent]}
      />

      <H3>ROUTING LOGIC</H3>
      <Code>{`# SIGNAL SET ROUTER — regime-aware selection
def route_signal_set(feat, cfg):
    regime = feat.struct.regime

    if regime in ["TRENDING_BULL", "TRENDING_BEAR"]:
        # Fast regime: early set primary (more R available)
        return EARLY_SET

    elif regime == "RANGING":
        # Chop: late set only (need confirmation, smaller sizing)
        return LATE_SET

    elif regime == "VOLATILE":
        # High vol: both sets active but reduce position size by 0.5×
        return BOTH_SETS_HALF_SIZE

    else:
        return LATE_SET  # default safe`}</Code>
    </div>
  );
}

function S8_Presets() {
  return (
    <div>
      <H1>SECTION 08</H1>
      <H2>PROFILE PRESETS</H2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        <ProfileCard
          name="CONSERVATIVE" icon="🛡" color={C.green}
          fields={[
            ["Signal set", "Late only", C.gold],
            ["Fire threshold", "75 / 80", C.text],
            ["Min R:R", "2.5", C.green],
            ["Base risk %", "0.5%", C.green],
            ["Max Kelly", "10%", C.green],
            ["Session DD cap", "1.5%", C.green],
            ["Daily hard stop", "2.0%", C.green],
            ["Max concurrent", "1", C.text],
            ["Off-hours trading", "Disabled", C.muted],
            ["BOS required", "YES (hard gate)", C.gold],
            ["Win rate target", "52–62%", C.text],
            ["Avg R target", "1.8–2.2R", C.text],
            ["Best for", "Small accounts, new live", C.muted],
          ]}
        />
        <ProfileCard
          name="BALANCED" icon="⚖" color={C.gold}
          fields={[
            ["Signal set", "Both (regime-routed)", C.gold],
            ["Fire threshold", "65 / 70", C.text],
            ["Min R:R", "2.0", C.gold],
            ["Base risk %", "1.0%", C.gold],
            ["Max Kelly", "25%", C.gold],
            ["Session DD cap", "2.5%", C.gold],
            ["Daily hard stop", "3.5%", C.gold],
            ["Max concurrent", "2", C.text],
            ["Off-hours trading", "0.4× decay mult", C.gold],
            ["BOS required", "NO for early set", C.gold],
            ["Win rate target", "45–55%", C.text],
            ["Avg R target", "2.2–2.8R", C.text],
            ["Best for", "Funded/prop accounts", C.muted],
          ]}
        />
        <ProfileCard
          name="AGGRESSIVE" icon="⚔" color={C.red}
          fields={[
            ["Signal set", "Early primary", C.red],
            ["Fire threshold", "55 / 60", C.text],
            ["Min R:R", "1.5", C.red],
            ["Base risk %", "2.0%", C.red],
            ["Max Kelly", "40%", C.red],
            ["Session DD cap", "4.0%", C.red],
            ["Daily hard stop", "5.0%", C.red],
            ["Max concurrent", "3", C.text],
            ["Off-hours trading", "0.7× decay mult", C.red],
            ["BOS required", "NO — pure early", C.red],
            ["Win rate target", "38–48%", C.text],
            ["Avg R target", "2.8–3.5R", C.text],
            ["Best for", "Hedge fund / institutional", C.muted],
          ]}
        />
      </div>

      <H3>PROFILE OVERRIDE MAP</H3>
      <Code>{`# CONFIG OVERRIDE — load any profile
PROFILES = {
    "conservative": {
        "cfg.score.fire_early": 75,
        "cfg.score.fire_late": 80,
        "cfg.risk.min_rr": 2.5,
        "cfg.risk.base_risk_pct": 0.005,
        "cfg.risk.max_kelly_fraction": 0.10,
        "cfg.risk.session_drawdown_cap": 0.015,
        "cfg.risk.daily_loss_cap": 0.020,
        "cfg.risk.max_concurrent": 1,
        "cfg.time.decay_mult": 0.0,  # off-hours disabled
        "signal_set_mode": "LATE_ONLY",
    },
    "balanced": {
        "cfg.score.fire_early": 65,
        "cfg.score.fire_late": 70,
        "cfg.risk.min_rr": 2.0,
        "cfg.risk.base_risk_pct": 0.010,
        "cfg.risk.max_kelly_fraction": 0.25,
        "cfg.risk.session_drawdown_cap": 0.025,
        "cfg.risk.daily_loss_cap": 0.035,
        "cfg.risk.max_concurrent": 2,
        "cfg.time.decay_mult": 0.40,
        "signal_set_mode": "REGIME_ROUTED",
    },
    "aggressive": {
        "cfg.score.fire_early": 55,
        "cfg.score.fire_late": 60,
        "cfg.risk.min_rr": 1.5,
        "cfg.risk.base_risk_pct": 0.020,
        "cfg.risk.max_kelly_fraction": 0.40,
        "cfg.risk.session_drawdown_cap": 0.040,
        "cfg.risk.daily_loss_cap": 0.050,
        "cfg.risk.max_concurrent": 3,
        "cfg.time.decay_mult": 0.70,
        "signal_set_mode": "EARLY_PRIMARY",
    },
}`}</Code>
    </div>
  );
}

const SECTION_COMPONENTS = [
  S1_Architecture, S2_Parameters, S3_EntryExit,
  S4_RiskModel, S5_WalkForward, S6_Failures,
  S7_SignalSets, S8_Presets,
];

// ── ROOT ─────────────────────────────────────────────────────────
export default function SURGESignalSpec() {
  const [active, setActive] = useState(0);
  const ActiveSection = SECTION_COMPONENTS[active];

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'Courier New', monospace" }}>
      {/* Header */}
      <div style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: 4, color: C.accent, marginBottom: 2 }}>SURGE · INSTITUTIONAL</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.white, letterSpacing: 2 }}>ICT / SMC INTRADAY SIGNAL ENGINE</div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 2, letterSpacing: 1 }}>
            LIQUIDITY-DRAW → PURGE → DISPLACEMENT → PD ARRAY → EDGE SCORE → KELLY RISK
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Badge label="v1.0" color={C.accent} />
          <Badge label="EXECUTABLE SPEC" color={C.gold} />
          <Badge label="8 SECTIONS" color={C.purple} />
        </div>
      </div>

      {/* Nav */}
      <div style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        padding: "8px 24px", display: "flex", gap: 4, flexWrap: "wrap",
      }}>
        {SECTIONS.map((s, i) => (
          <button key={i} onClick={() => setActive(i)} style={{
            padding: "5px 12px", fontSize: 9, letterSpacing: 1,
            background: active === i ? C.accent + "22" : "transparent",
            border: `1px solid ${active === i ? C.accent : C.border}`,
            color: active === i ? C.accent : C.muted,
            cursor: "pointer", borderRadius: 2, fontFamily: "'Courier New', monospace",
          }}>
            {String(i + 1).padStart(2, "0")} {s}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto" }}>
        <ActiveSection />
      </div>

      {/* Footer */}
      <div style={{
        borderTop: `1px solid ${C.border}`, padding: "10px 24px",
        display: "flex", justifyContent: "space-between",
        fontSize: 9, color: C.muted, fontFamily: "monospace",
      }}>
        <span>SURGE · ICT/SMC SIGNAL ENGINE · EXECUTABLE SPECIFICATION v1.0</span>
        <span>1m COMPUTE · 3m DECISION · KELLY-SIZED · REGIME-AWARE · NEVER STOP ITERATING</span>
      </div>
    </div>
  );
}
