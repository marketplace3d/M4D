import { useSignals, SignalRow } from "../api/hooks";
import { Spinner, Tag } from "@blueprintjs/core";

const FAMILY_COLOR: Record<string, string> = {
  momentum: "#48aff0",
  mean_rev: "#3dcc91",
  value: "#ffd91e",
  quality: "#d9822b",
};

function ICBar({ icir }: { icir: number }) {
  const abs = Math.min(Math.abs(icir), 2);
  const pct = (abs / 2) * 100;
  const color = icir > 0.5 ? "#3dcc91" : icir > 0 ? "#ffd91e" : "#ff7373";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 80, height: 4, background: "#2d3748", borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, color, minWidth: 36, textAlign: "right" }}>
        {icir > 0 ? "+" : ""}{icir.toFixed(3)}
      </span>
    </div>
  );
}

export default function SignalBoard() {
  const { data, isLoading } = useSignals();

  if (isLoading) return <Spinner size={20} />;
  if (!data) return null;

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ color: "#738091", borderBottom: "1px solid #2d3748" }}>
          <th style={{ textAlign: "left", padding: "4px 8px" }}>Signal</th>
          <th style={{ textAlign: "left", padding: "4px 8px" }}>Family</th>
          <th style={{ textAlign: "right", padding: "4px 8px" }}>Mean IC</th>
          <th style={{ textAlign: "left", padding: "4px 8px 4px 16px" }}>ICIR</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row: SignalRow) => (
          <tr key={row.signal} style={{ borderBottom: "1px solid #1c2127" }}>
            <td style={{ padding: "5px 8px", fontFamily: "monospace", color: "#f6f7f9" }}>
              {row.signal}
            </td>
            <td style={{ padding: "5px 8px" }}>
              <Tag
                minimal
                style={{ fontSize: 10, background: FAMILY_COLOR[row.family] + "22", color: FAMILY_COLOR[row.family] }}
              >
                {row.family}
              </Tag>
            </td>
            <td style={{ padding: "5px 8px", textAlign: "right", color: row.mean_ic >= 0 ? "#3dcc91" : "#ff7373" }}>
              {row.mean_ic >= 0 ? "+" : ""}{row.mean_ic.toFixed(4)}
            </td>
            <td style={{ padding: "5px 8px 5px 16px" }}>
              <ICBar icir={row.icir} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
