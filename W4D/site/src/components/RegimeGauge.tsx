import { useRegimeDist } from "../api/hooks";
import { Spinner } from "@blueprintjs/core";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from "recharts";

const REGIME_COLOR: Record<string, string> = {
  risk_on: "#3dcc91",
  trending: "#48aff0",
  mean_rev: "#ffd91e",
  risk_off: "#ff7373",
  crisis: "#c23030",
};

const REGIME_LABEL: Record<string, string> = {
  risk_on: "RISK ON",
  trending: "TREND",
  mean_rev: "MR",
  risk_off: "RISK OFF",
  crisis: "CRISIS",
};

export default function RegimeGauge() {
  const { data, isLoading } = useRegimeDist();

  if (isLoading) return <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}><Spinner size={20} /></div>;
  if (!data) return null;

  const points = Object.entries(data).map(([k, v]) => ({
    regime: REGIME_LABEL[k] ?? k,
    pct: Math.round(v * 100),
    color: REGIME_COLOR[k] ?? "#738091",
  }));

  const dominant = points.reduce((a, b) => (b.pct > a.pct ? b : a), points[0]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 10, height: 10, borderRadius: "50%",
          background: dominant.color, boxShadow: `0 0 6px ${dominant.color}`,
        }} />
        <span style={{ fontWeight: 700, color: dominant.color, fontSize: 13, letterSpacing: 1 }}>
          {dominant.regime}
        </span>
        <span style={{ color: "#738091", fontSize: 11 }}>{dominant.pct}% of history</span>
      </div>
      <ResponsiveContainer width="100%" height={190}>
        <RadarChart data={points}>
          <PolarGrid stroke="#2d3748" />
          <PolarAngleAxis dataKey="regime" tick={{ fontSize: 10, fill: "#a7b6c2" }} />
          <Radar dataKey="pct" stroke="#48aff0" fill="#48aff0" fillOpacity={0.15} />
          <Tooltip
            contentStyle={{ background: "#252a31", border: "1px solid #394b59" }}
            formatter={(v: number) => [`${v}%`, "Distribution"]}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
