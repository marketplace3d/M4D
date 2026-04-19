import { Card, Elevation, H4, H5, Tag, Spinner } from "@blueprintjs/core";
import { useAttribution, useRegimeDist } from "../api/hooks";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, PieChart, Pie, Legend, ReferenceLine,
} from "recharts";

const FAMILY_COLOR: Record<string, string> = {
  momentum: "#48aff0",
  mean_rev: "#3dcc91",
  value: "#ffd91e",
  quality: "#d9822b",
};

const REGIME_COLOR: Record<string, string> = {
  risk_on: "#3dcc91", trending: "#48aff0", mean_rev: "#ffd91e",
  risk_off: "#ff7373", crisis: "#c23030",
};

export default function Attribution() {
  const { data: attr, isLoading } = useAttribution();
  const { data: regDist } = useRegimeDist();

  if (isLoading) return <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center" }}><Spinner /></div>;
  if (!attr) return null;

  const bookData = [
    { name: "Long Book", value: attr.long_return_pct, fill: "#3dcc91" },
    { name: "Short Book", value: attr.short_return_pct, fill: "#ff7373" },
    { name: "TC Drag", value: attr.tc_drag_pct, fill: "#ff7373" },
  ];

  const familyData = Object.entries(attr.signal_family).map(([k, v]) => ({
    family: k.replace("_", "-"),
    contribution: parseFloat((v * 100).toFixed(3)),
    color: FAMILY_COLOR[k] ?? "#738091",
  }));

  const regimeData = Object.entries(attr.regime).map(([k, v]) => ({
    name: k.replace(/_/g, " ").toUpperCase(),
    value: parseFloat((v * 100).toFixed(2)),
    dist: regDist ? parseFloat((regDist[k] * 100).toFixed(1)) : 0,
    fill: REGIME_COLOR[k] ?? "#738091",
  }));

  return (
    <div>
      <H4 style={{ marginBottom: 4, letterSpacing: 2 }}>P&L ATTRIBUTION</H4>
      <div style={{ color: "#738091", fontSize: 11, marginBottom: 20 }}>
        Decompose returns by signal family, long/short book, regime, and transaction cost drag
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
        {[
          { label: "LONG BOOK", val: `${attr.long_return_pct >= 0 ? "+" : ""}${attr.long_return_pct.toFixed(2)}%`, color: "#3dcc91" },
          { label: "SHORT BOOK", val: `${attr.short_return_pct >= 0 ? "+" : ""}${attr.short_return_pct.toFixed(2)}%`, color: attr.short_return_pct >= 0 ? "#3dcc91" : "#ff7373" },
          { label: "TC DRAG", val: `${attr.tc_drag_pct.toFixed(2)}%`, color: "#ff7373" },
        ].map((s) => (
          <Card key={s.label} elevation={Elevation.ONE} style={{ background: "#252a31", padding: "14px 18px" }}>
            <div style={{ color: "#738091", fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.val}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
          <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>SIGNAL FAMILY CONTRIBUTION</H5>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={familyData} layout="vertical" margin={{ left: 60, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: "#738091" }} tickFormatter={(v) => `${v.toFixed(1)}%`} />
              <YAxis type="category" dataKey="family" tick={{ fontSize: 11, fill: "#a7b6c2" }} width={60} />
              <ReferenceLine x={0} stroke="#5c7080" />
              <Tooltip
                contentStyle={{ background: "#252a31", border: "1px solid #394b59", fontSize: 11 }}
                formatter={(v: number) => [`${v >= 0 ? "+" : ""}${v.toFixed(3)}%`, "Contribution"]}
              />
              <Bar dataKey="contribution" radius={[0, 2, 2, 0]}>
                {familyData.map((d, i) => (
                  <Cell key={i} fill={d.contribution >= 0 ? d.color : "#ff7373"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
          <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>REGIME DISTRIBUTION</H5>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={regimeData}
                dataKey="dist"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={75}
                innerRadius={40}
                paddingAngle={2}
              >
                {regimeData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: "#252a31", border: "1px solid #394b59", fontSize: 11 }}
                formatter={(v: number) => [`${v.toFixed(1)}%`, "Distribution"]}
              />
              <Legend
                formatter={(v) => <span style={{ fontSize: 10, color: "#a7b6c2" }}>{v}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
        <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>REGIME × ATTRIBUTION DETAIL</H5>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#738091", borderBottom: "1px solid #2d3748" }}>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Regime</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>P&L Attribution</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>History %</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}></th>
            </tr>
          </thead>
          <tbody>
            {regimeData.map((r) => (
              <tr key={r.name} style={{ borderBottom: "1px solid #1c2127" }}>
                <td style={{ padding: "5px 8px" }}>
                  <Tag minimal style={{ background: r.fill + "22", color: r.fill, fontSize: 11 }}>{r.name}</Tag>
                </td>
                <td style={{ padding: "5px 8px", textAlign: "right", color: r.value >= 0 ? "#3dcc91" : "#ff7373", fontWeight: 600 }}>
                  {r.value >= 0 ? "+" : ""}{r.value.toFixed(2)}%
                </td>
                <td style={{ padding: "5px 8px", textAlign: "right", color: "#a7b6c2" }}>{r.dist.toFixed(1)}%</td>
                <td style={{ padding: "5px 12px" }}>
                  <div style={{ width: 80, height: 4, background: "#2d3748", borderRadius: 2 }}>
                    <div style={{ width: `${r.dist}%`, height: "100%", background: r.fill, borderRadius: 2 }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
