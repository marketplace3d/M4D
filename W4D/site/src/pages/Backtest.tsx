import { Card, Elevation, H4, H5, Tag, Spinner } from "@blueprintjs/core";
import { useSummary, useMonthly, useWalkForward, useNav } from "../api/hooks";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine, Cell,
} from "recharts";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function MonthlyTable() {
  const { data, isLoading } = useMonthly();
  if (isLoading) return <Spinner size={16} />;
  if (!data) return null;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ fontSize: 11, borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ color: "#738091" }}>
            <th style={{ padding: "3px 8px", textAlign: "left" }}>Year</th>
            {MONTH_NAMES.map((m) => (
              <th key={m} style={{ padding: "3px 6px", textAlign: "right", minWidth: 40 }}>{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.year} style={{ borderBottom: "1px solid #1c2127" }}>
              <td style={{ padding: "3px 8px", color: "#a7b6c2", fontWeight: 600 }}>{row.year}</td>
              {MONTH_NAMES.map((_, i) => {
                const v = row.months[i + 1];
                const color = v === undefined ? "#3d4f5d" : v > 0 ? "#3dcc91" : v < 0 ? "#ff7373" : "#738091";
                return (
                  <td key={i} style={{ padding: "3px 6px", textAlign: "right", color }}>
                    {v !== undefined ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReturnDistribution() {
  const { data } = useNav();
  if (!data) return null;

  const returns = data.map((p) => p.ret).filter((r) => r !== 0);
  const buckets: Record<string, number> = {};
  const step = 0.2;
  returns.forEach((r) => {
    const bucket = Math.round(r / step) * step;
    const key = bucket.toFixed(1);
    buckets[key] = (buckets[key] ?? 0) + 1;
  });
  const dist = Object.entries(buckets)
    .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
    .map(([ret, count]) => ({ ret: parseFloat(ret), count }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart data={dist} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" />
        <XAxis dataKey="ret" tick={{ fontSize: 9, fill: "#738091" }} tickFormatter={(v) => `${v.toFixed(1)}%`} />
        <YAxis tick={{ fontSize: 9, fill: "#738091" }} width={28} />
        <ReferenceLine x={0} stroke="#5c7080" />
        <Tooltip
          contentStyle={{ background: "#252a31", border: "1px solid #394b59", fontSize: 11 }}
          formatter={(v: number) => [v, "Days"]}
          labelFormatter={(l) => `${parseFloat(l) >= 0 ? "+" : ""}${l}%`}
        />
        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
          {dist.map((d, i) => (
            <Cell key={i} fill={d.ret >= 0 ? "#3dcc91" : "#ff7373"} />
          ))}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function WalkForwardPanel() {
  const { data, isLoading } = useWalkForward();

  if (isLoading) return (
    <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Spinner size={20} />
      <span style={{ marginLeft: 10, color: "#738091", fontSize: 12 }}>Running walk-forward validation…</span>
    </div>
  );
  if (!data) return null;

  const pboColor = data.pbo_pct > 60 ? "#ff7373" : data.pbo_pct > 40 ? "#ffd91e" : "#3dcc91";
  const degColor = data.degradation > 1 ? "#ff7373" : data.degradation > 0.5 ? "#ffd91e" : "#3dcc91";

  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
        {[
          { label: "OOS SHARPE", val: data.oos_sharpe.toFixed(3), color: data.oos_sharpe > 0.5 ? "#3dcc91" : data.oos_sharpe > 0 ? "#ffd91e" : "#ff7373" },
          { label: "IS SHARPE", val: data.is_sharpe.toFixed(3), color: "#48aff0" },
          { label: "DEGRADATION", val: data.degradation.toFixed(3), color: degColor },
          { label: "PBO", val: `${data.pbo_pct.toFixed(0)}%`, color: pboColor },
          { label: "FOLDS", val: String(data.n_folds), color: "#a7b6c2" },
          { label: "MEAN OOS IC", val: data.mean_ic.toFixed(5), color: "#a7b6c2" },
        ].map((s) => (
          <div key={s.label} style={{ background: "#1c2127", borderRadius: 4, padding: "8px 12px", minWidth: 90 }}>
            <div style={{ color: "#738091", fontSize: 9, letterSpacing: 1 }}>{s.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "#738091", borderBottom: "1px solid #2d3748" }}>
            <th style={{ textAlign: "left", padding: "3px 6px" }}>Fold</th>
            <th style={{ textAlign: "left", padding: "3px 6px" }}>OOS Period</th>
            <th style={{ textAlign: "right", padding: "3px 6px" }}>Sharpe</th>
            <th style={{ textAlign: "right", padding: "3px 6px" }}>IC</th>
            <th style={{ textAlign: "right", padding: "3px 6px" }}>Max DD</th>
            <th style={{ textAlign: "right", padding: "3px 6px" }}>Hit%</th>
          </tr>
        </thead>
        <tbody>
          {data.folds.map((f) => (
            <tr key={f.fold} style={{ borderBottom: "1px solid #1c2127" }}>
              <td style={{ padding: "3px 6px", color: "#738091" }}>{f.fold}</td>
              <td style={{ padding: "3px 6px", fontFamily: "monospace", fontSize: 10 }}>
                {f.oos_start} → {f.oos_end}
              </td>
              <td style={{ padding: "3px 6px", textAlign: "right", color: f.oos_sharpe > 0 ? "#3dcc91" : "#ff7373", fontWeight: 600 }}>
                {f.oos_sharpe.toFixed(3)}
              </td>
              <td style={{ padding: "3px 6px", textAlign: "right", color: f.oos_ic > 0 ? "#3dcc91" : "#ff7373" }}>
                {f.oos_ic.toFixed(5)}
              </td>
              <td style={{ padding: "3px 6px", textAlign: "right", color: "#ff7373" }}>
                -{f.oos_max_dd_pct.toFixed(2)}%
              </td>
              <td style={{ padding: "3px 6px", textAlign: "right", color: f.hit_rate_pct > 50 ? "#3dcc91" : "#ffd91e" }}>
                {f.hit_rate_pct.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Backtest() {
  const { data: summary } = useSummary();

  return (
    <div>
      <H4 style={{ marginBottom: 4, letterSpacing: 2 }}>BACKTEST ENGINE</H4>
      <div style={{ color: "#738091", fontSize: 11, marginBottom: 20 }}>
        756-day simulation · 100 instruments · 5bps commission · 10bps spread · regime-switching risk
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
          <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>PERFORMANCE SUMMARY</H5>
          {summary ? (
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <tbody>
                {summary.map((r) => (
                  <tr key={r.Metric} style={{ borderBottom: "1px solid #1c2127" }}>
                    <td style={{ padding: "4px 8px", color: "#738091" }}>{r.Metric}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 600, color: "#f6f7f9", fontFamily: "monospace" }}>{r.Value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Spinner size={20} />}
        </Card>

        <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
          <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>RETURN DISTRIBUTION</H5>
          <ReturnDistribution />
        </Card>
      </div>

      <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px", marginBottom: 16 }}>
        <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>MONTHLY RETURNS</H5>
        <MonthlyTable />
      </Card>

      <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
        <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>WALK-FORWARD VALIDATION (anchored expanding · 63d OOS folds)</H5>
        <WalkForwardPanel />
      </Card>
    </div>
  );
}
