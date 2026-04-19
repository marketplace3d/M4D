import { useRisk, RiskPoint } from "../api/hooks";
import { Spinner, ProgressBar, Tag } from "@blueprintjs/core";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

export default function RiskGauge() {
  const { data, isLoading } = useRisk();

  if (isLoading) return <Spinner size={20} />;
  if (!data || data.length === 0) return null;

  const latest = data[data.length - 1];
  const dd = Math.abs(latest.drawdown);
  const ddPct = dd * 100;
  const ddIntent = dd > 0.1 ? "danger" : dd > 0.05 ? "warning" : "success";

  const ddPoints = data
    .filter((_, i) => i % 3 === 0)
    .map((p: RiskPoint) => ({ date: p.date, dd: -(p.drawdown * 100) }));

  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: "#738091", fontSize: 10, marginBottom: 4 }}>DRAWDOWN</div>
          <ProgressBar value={dd / 0.25} intent={ddIntent} animate={false} stripes={false} />
          <div style={{ color: ddIntent === "danger" ? "#ff7373" : ddIntent === "warning" ? "#ffd91e" : "#3dcc91", fontSize: 12, marginTop: 2 }}>
            -{ddPct.toFixed(2)}%
          </div>
        </div>
        <div>
          <div style={{ color: "#738091", fontSize: 10, marginBottom: 4 }}>GROSS</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#f6f7f9" }}>{latest.gross.toFixed(2)}×</div>
        </div>
        <div>
          <div style={{ color: "#738091", fontSize: 10, marginBottom: 4 }}>POSITIONS</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#f6f7f9" }}>{latest.n_pos}</div>
        </div>
        <div>
          <div style={{ color: "#738091", fontSize: 10, marginBottom: 4 }}>VaR 99%</div>
          <div style={{ fontSize: 13, color: latest.var_99 > 0.025 ? "#ff7373" : "#a7b6c2" }}>
            {(latest.var_99 * 100).toFixed(2)}%
          </div>
        </div>
      </div>

      {latest.alerts?.length > 0 && (
        <div style={{ marginBottom: 10, display: "flex", gap: 4, flexWrap: "wrap" }}>
          {latest.alerts.map((a: string) => (
            <Tag key={a} intent="danger" minimal style={{ fontSize: 10 }}>{a}</Tag>
          ))}
        </div>
      )}

      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={ddPoints} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <XAxis dataKey="date" hide />
          <YAxis tick={{ fontSize: 9, fill: "#738091" }} tickFormatter={(v) => `${v.toFixed(0)}%`} width={32} />
          <ReferenceLine y={-10} stroke="#ff7373" strokeDasharray="3 2" />
          <Tooltip
            contentStyle={{ background: "#252a31", border: "1px solid #394b59", fontSize: 11 }}
            formatter={(v: number) => [`-${Math.abs(v).toFixed(2)}%`, "Drawdown"]}
          />
          <Line type="monotone" dataKey="dd" stroke="#ff7373" strokeWidth={1.2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
