import { Card, Elevation, H4, H5, Spinner, Tag, Button } from "@blueprintjs/core";
import { useQueryClient } from "@tanstack/react-query";
import { useSummary, useRegimeDist, useWeights, useNav } from "../api/hooks";
import EquityCurve from "../components/EquityCurve";
import RegimeGauge from "../components/RegimeGauge";
import SignalBoard from "../components/SignalBoard";
import RiskGauge from "../components/RiskGauge";

const REGIME_COLOR: Record<string, string> = {
  risk_on: "#3dcc91", trending: "#48aff0", mean_rev: "#ffd91e",
  risk_off: "#ff7373", crisis: "#c23030",
};

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "14px 18px", flex: 1, minWidth: 120 }}>
      <div style={{ color: "#738091", fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? "#f6f7f9", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ color: "#738091", fontSize: 10, marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

function KPIRow() {
  const { data: summary } = useSummary();
  const { data: nav } = useNav();

  if (!summary || !nav) return <div style={{ height: 80 }}><Spinner size={20} /></div>;

  const get = (metric: string) => summary.find((r) => r.Metric === metric)?.Value ?? "—";
  const latest = nav[nav.length - 1];
  const initial = nav[0];
  const totalRet = ((latest.nav / initial.nav) - 1) * 100;

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
      <StatCard
        label="TOTAL RETURN"
        value={`${totalRet >= 0 ? "+" : ""}${totalRet.toFixed(1)}%`}
        color={totalRet >= 0 ? "#3dcc91" : "#ff7373"}
        sub={`${nav.length} days`}
      />
      <StatCard label="SHARPE" value={get("Sharpe ratio")} color="#48aff0" sub="annualised" />
      <StatCard label="MAX DD" value={get("Max drawdown")} color="#ff7373" sub="from HWM" />
      <StatCard label="ANN VOL" value={get("Ann. volatility")} color="#ffd91e" sub="annualised" />
      <StatCard label="WIN RATE" value={get("Win rate")} color="#3dcc91" sub="daily" />
      <StatCard label="CALMAR" value={get("Calmar ratio")} color="#d9822b" sub="ret/mdd" />
    </div>
  );
}

function RegimeBar() {
  const { data } = useRegimeDist();
  if (!data) return null;

  const dominant = Object.entries(data).reduce((a, b) => (b[1] > a[1] ? b : a), ["", 0]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
      <span style={{ color: "#738091", fontSize: 11 }}>CURRENT REGIME</span>
      <Tag
        style={{
          background: REGIME_COLOR[dominant[0]] + "33",
          color: REGIME_COLOR[dominant[0]],
          fontWeight: 700, letterSpacing: 1, fontSize: 11,
        }}
      >
        {dominant[0].replace("_", " ").toUpperCase()}
      </Tag>
      <span style={{ color: "#5c7080", fontSize: 10 }}>{(dominant[1] * 100).toFixed(0)}% of history</span>
    </div>
  );
}

function WeightsTable() {
  const { data } = useWeights();
  if (!data || data.length === 0) return <div style={{ color: "#738091", fontSize: 12 }}>No positions</div>;

  return (
    <div style={{ maxHeight: 280, overflowY: "auto" }}>
      <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "#738091", position: "sticky", top: 0, background: "#252a31" }}>
            <th style={{ textAlign: "left", padding: "3px 6px" }}>Instrument</th>
            <th style={{ textAlign: "right", padding: "3px 6px" }}>Weight</th>
            <th style={{ textAlign: "left", padding: "3px 6px" }}></th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => {
            const isLong = r.weight > 0;
            const bar = Math.min(Math.abs(r.weight) / 0.05 * 100, 100);
            return (
              <tr key={r.instrument} style={{ borderBottom: "1px solid #1c2127" }}>
                <td style={{ padding: "3px 6px", fontFamily: "monospace" }}>{r.instrument}</td>
                <td style={{ padding: "3px 6px", textAlign: "right", color: isLong ? "#3dcc91" : "#ff7373" }}>
                  {r.weight >= 0 ? "+" : ""}{(r.weight * 100).toFixed(2)}%
                </td>
                <td style={{ padding: "3px 10px" }}>
                  <div style={{ width: 50, height: 3, background: "#2d3748" }}>
                    <div style={{ width: `${bar}%`, height: "100%", background: isLong ? "#3dcc91" : "#ff7373" }} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function WarRoom() {
  const qc = useQueryClient();

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <H4 style={{ margin: 0, color: "#f6f7f9", letterSpacing: 2 }}>ALPHA WAR ROOM</H4>
          <div style={{ color: "#738091", fontSize: 11, marginTop: 2 }}>WorldQuant-style systematic quant — 12 signals · 5 regimes · IC-weighted ensemble</div>
        </div>
        <Button
          minimal
          icon="refresh"
          text="Refresh"
          onClick={() => qc.invalidateQueries()}
          style={{ color: "#738091" }}
        />
      </div>

      <RegimeBar />
      <KPIRow />

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
          <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>NAV CURVE</H5>
          <EquityCurve />
        </Card>

        <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
          <H5 style={{ margin: "0 0 4px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>REGIME DISTRIBUTION</H5>
          <RegimeGauge />
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
          <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>SIGNAL BOARD</H5>
          <SignalBoard />
        </Card>

        <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
          <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>RISK MONITOR</H5>
          <RiskGauge />
        </Card>

        <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
          <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>LIVE BOOK (TOP 30)</H5>
          <WeightsTable />
        </Card>
      </div>
    </div>
  );
}
