import { Card, Elevation, H4, H5, Tag, Spinner } from "@blueprintjs/core";
import { useSignals, useRegimeDist } from "../api/hooks";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, ReferenceLine,
} from "recharts";

const FAMILY_COLOR: Record<string, string> = {
  momentum: "#48aff0",
  mean_rev: "#3dcc91",
  value: "#ffd91e",
  quality: "#d9822b",
};

const REGIME_MULTS: Record<string, Record<string, number>> = {
  risk_on:  { momentum: 1.00, mean_rev: 0.70, value: 1.00, quality: 1.00 },
  trending: { momentum: 1.30, mean_rev: 0.30, value: 0.80, quality: 0.90 },
  mean_rev: { momentum: 0.50, mean_rev: 1.50, value: 1.00, quality: 1.00 },
  risk_off: { momentum: 0.60, mean_rev: 1.10, value: 1.10, quality: 1.20 },
  crisis:   { momentum: 0.30, mean_rev: 1.20, value: 1.30, quality: 1.10 },
};

export default function Signals() {
  const { data: signals, isLoading } = useSignals();
  const { data: regimeDist } = useRegimeDist();

  if (isLoading) return <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center" }}><Spinner /></div>;
  if (!signals) return null;

  const icirData = signals.map((s) => ({
    signal: s.signal.replace(/_/g, " "),
    icir: s.icir,
    family: s.family,
  }));

  const byFamily = ["momentum", "mean_rev", "value", "quality"].map((fam) => {
    const group = signals.filter((s) => s.family === fam);
    const avgIcir = group.reduce((a, b) => a + b.icir, 0) / (group.length || 1);
    return { family: fam, avgIcir: parseFloat(avgIcir.toFixed(3)), count: group.length };
  });

  const dominant = regimeDist
    ? Object.entries(regimeDist).reduce((a, b) => (b[1] > a[1] ? b : a), ["risk_on", 0])[0]
    : "risk_on";

  return (
    <div>
      <H4 style={{ marginBottom: 4, letterSpacing: 2 }}>SIGNAL LIBRARY</H4>
      <div style={{ color: "#738091", fontSize: 11, marginBottom: 20 }}>
        12 alpha signals · 4 families · IC-weighted ensemble with regime multipliers
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
          <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>ICIR BY SIGNAL</H5>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={icirData} layout="vertical" margin={{ left: 80, right: 20, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: "#738091" }} tickFormatter={(v) => v.toFixed(2)} />
              <YAxis type="category" dataKey="signal" tick={{ fontSize: 10, fill: "#a7b6c2" }} width={80} />
              <ReferenceLine x={0} stroke="#5c7080" />
              <Tooltip
                contentStyle={{ background: "#252a31", border: "1px solid #394b59", fontSize: 11 }}
                formatter={(v: number) => [v.toFixed(4), "ICIR"]}
              />
              <Bar dataKey="icir" radius={[0, 2, 2, 0]}>
                {icirData.map((entry, i) => (
                  <Cell key={i} fill={entry.icir > 0 ? (FAMILY_COLOR[entry.family] ?? "#48aff0") : "#ff7373"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
            <H5 style={{ margin: "0 0 10px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>FAMILY AVERAGE ICIR</H5>
            {byFamily.map((f) => (
              <div key={f.family} style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 8 }}>
                <Tag minimal style={{ fontSize: 10, background: FAMILY_COLOR[f.family] + "22", color: FAMILY_COLOR[f.family], minWidth: 70 }}>
                  {f.family}
                </Tag>
                <div style={{ flex: 1, height: 4, background: "#2d3748", borderRadius: 2 }}>
                  <div style={{
                    width: `${Math.min(Math.abs(f.avgIcir) / 0.5 * 100, 100)}%`,
                    height: "100%",
                    background: f.avgIcir > 0 ? FAMILY_COLOR[f.family] : "#ff7373",
                    borderRadius: 2,
                  }} />
                </div>
                <span style={{ fontSize: 11, color: f.avgIcir >= 0 ? "#3dcc91" : "#ff7373", minWidth: 44, textAlign: "right" }}>
                  {f.avgIcir >= 0 ? "+" : ""}{f.avgIcir.toFixed(3)}
                </span>
              </div>
            ))}
          </Card>

          <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
            <H5 style={{ margin: "0 0 10px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>
              REGIME MULTIPLIERS — {dominant.replace("_", " ").toUpperCase()}
            </H5>
            {Object.entries(REGIME_MULTS[dominant] ?? {}).map(([fam, mult]) => (
              <div key={fam} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <Tag minimal style={{ fontSize: 10, background: FAMILY_COLOR[fam] + "22", color: FAMILY_COLOR[fam] }}>
                  {fam}
                </Tag>
                <span style={{
                  fontSize: 12, fontWeight: 700,
                  color: mult > 1 ? "#3dcc91" : mult < 0.5 ? "#ff7373" : "#ffd91e",
                }}>
                  {mult.toFixed(2)}×
                </span>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
        <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>SIGNAL DETAIL TABLE</H5>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#738091", borderBottom: "1px solid #2d3748" }}>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Signal</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Family</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Mean IC</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>IC Vol</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>ICIR</th>
              <th style={{ textAlign: "right", padding: "4px 8px" }}>Obs</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((s) => (
              <tr key={s.signal} style={{ borderBottom: "1px solid #1c2127" }}>
                <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{s.signal}</td>
                <td style={{ padding: "5px 8px" }}>
                  <Tag minimal style={{ fontSize: 10, background: FAMILY_COLOR[s.family] + "22", color: FAMILY_COLOR[s.family] }}>
                    {s.family}
                  </Tag>
                </td>
                <td style={{ padding: "5px 8px", textAlign: "right", color: s.mean_ic >= 0 ? "#3dcc91" : "#ff7373" }}>
                  {s.mean_ic >= 0 ? "+" : ""}{s.mean_ic.toFixed(5)}
                </td>
                <td style={{ padding: "5px 8px", textAlign: "right", color: "#a7b6c2" }}>{s.ic_vol.toFixed(5)}</td>
                <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700, color: s.icir >= 0.5 ? "#3dcc91" : s.icir >= 0 ? "#ffd91e" : "#ff7373" }}>
                  {s.icir >= 0 ? "+" : ""}{s.icir.toFixed(4)}
                </td>
                <td style={{ padding: "5px 8px", textAlign: "right", color: "#738091" }}>{s.n_obs}</td>
                <td style={{ padding: "5px 8px" }}>
                  <Tag intent={s.icir >= 0.5 ? "success" : s.icir >= 0 ? "warning" : "danger"} minimal style={{ fontSize: 10 }}>
                    {s.icir >= 0.5 ? "STRONG" : s.icir >= 0 ? "WEAK" : "NEGATIVE"}
                  </Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
