import { useNav } from "../api/hooks";
import { Spinner, NonIdealState } from "@blueprintjs/core";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid,
} from "recharts";

const MONTH_LABELS: Record<number, string> = {
  0: "Jan", 1: "Feb", 2: "Mar", 3: "Apr", 4: "May", 5: "Jun",
  6: "Jul", 7: "Aug", 8: "Sep", 9: "Oct", 10: "Nov", 11: "Dec",
};

function formatDate(d: string) {
  const dt = new Date(d);
  return `${MONTH_LABELS[dt.getMonth()]} '${String(dt.getFullYear()).slice(2)}`;
}

export default function EquityCurve() {
  const { data, isLoading, error } = useNav();

  if (isLoading) return <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center" }}><Spinner size={24} /></div>;
  if (error || !data) return <NonIdealState icon="error" title="No data" />;

  const initial = data[0]?.nav ?? 1;
  const points = data
    .filter((_, i) => i % 3 === 0)
    .map((p) => ({
      date: p.date,
      label: formatDate(p.date),
      pct: ((p.nav / initial) - 1) * 100,
      gross: p.gross,
    }));

  const maxPct = Math.max(...points.map((p) => p.pct));
  const minPct = Math.min(...points.map((p) => p.pct));
  const domain = [Math.floor(minPct - 2), Math.ceil(maxPct + 2)];

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="navGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#48aff0" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#48aff0" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#738091" }} interval={40} />
        <YAxis
          domain={domain}
          tick={{ fontSize: 10, fill: "#738091" }}
          tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`}
          width={48}
        />
        <Tooltip
          contentStyle={{ background: "#252a31", border: "1px solid #394b59", borderRadius: 4 }}
          formatter={(v: number) => [`${v > 0 ? "+" : ""}${v.toFixed(2)}%`, "Return"]}
          labelStyle={{ color: "#a7b6c2" }}
        />
        <ReferenceLine y={0} stroke="#5c7080" strokeDasharray="4 2" />
        <Area
          type="monotone"
          dataKey="pct"
          stroke="#48aff0"
          strokeWidth={1.5}
          fill="url(#navGrad)"
          dot={false}
          activeDot={{ r: 3 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
