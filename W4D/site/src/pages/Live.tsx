import { useState } from "react";
import { Card, Elevation, H4, H5, Button, Tag, Spinner, InputGroup, FormGroup, HTMLSelect } from "@blueprintjs/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from "recharts";

const BASE = "/v1/live";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

type DbInfo = Record<string, Array<{ symbol: string; bars: number; start: string; end: string }>>;
type LiveRunResult = { status: string; days: number; symbols: string[]; total_return_pct: number; elapsed_s?: number };
type NavPoint = { date: string; nav: number; ret: number };
type SummaryRow = { Metric: string; Value: string };
type SignalRow = { signal: string; family: string; mean_ic: number; icir: number };

const PRESET_GROUPS = {
  "Crypto Top 10": "BTC,ETH,SOL,XRP,BNB,ADA,AVAX,DOT,LINK,UNI",
  "Crypto Full 19": "BNB,ADA,ARB,ATOM,AVAX,BTC,DOGE,DOT,ETH,FIL,INJ,LINK,LTC,OP,SOL,SUI,TIA,UNI,XRP",
  "Futures (ES NQ RTY CL 6E)": "ES,NQ,RTY,CL,6E",
  "BTC+ETH+ES+NQ": "BTC,ETH,ES,NQ",
};

function DbInfoPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["live/info"],
    queryFn: () => get<DbInfo>("/info"),
    staleTime: 300_000,
  });
  if (isLoading) return <Spinner size={16} />;
  if (!data) return null;

  return (
    <div>
      {Object.entries(data).map(([tbl, rows]) => (
        <div key={tbl} style={{ marginBottom: 12 }}>
          <div style={{ color: "#738091", fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>{tbl.toUpperCase()}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {rows.map((r) => (
              <Tag key={r.symbol} minimal style={{ fontSize: 10, fontFamily: "monospace" }}>
                {r.symbol} {(r.bars / 1000).toFixed(0)}K
              </Tag>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LiveEquityCurve({ navKey }: { navKey: string }) {
  const params = new URLSearchParams(navKey);
  const { data, isLoading } = useQuery({
    queryKey: ["live/nav", navKey],
    queryFn: () => get<NavPoint[]>(`/nav?${navKey}`),
    staleTime: 60_000,
    enabled: !!navKey,
  });

  if (isLoading) return <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}><Spinner size={20} /></div>;
  if (!data || data.length === 0) return <div style={{ color: "#738091", fontSize: 12 }}>No data</div>;

  const initial = data[0]?.nav ?? 1;
  const points = data.filter((_, i) => i % 2 === 0).map((p) => ({
    date: p.date,
    pct: ((p.nav / initial) - 1) * 100,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="liveGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3dcc91" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#3dcc91" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" />
        <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#738091" }} interval={60} />
        <YAxis tick={{ fontSize: 9, fill: "#738091" }} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`} width={44} />
        <ReferenceLine y={0} stroke="#5c7080" strokeDasharray="4 2" />
        <Tooltip
          contentStyle={{ background: "#252a31", border: "1px solid #394b59", fontSize: 11 }}
          formatter={(v: number) => [`${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, "Return"]}
        />
        <Area type="monotone" dataKey="pct" stroke="#3dcc91" strokeWidth={1.5} fill="url(#liveGrad)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default function Live() {
  const qc = useQueryClient();
  const [symbols, setSymbols] = useState("BTC,ETH,SOL,XRP,BNB,ADA,AVAX,DOT,LINK,UNI");
  const [table, setTable] = useState("bars_5m");
  const [start, setStart] = useState("2024-04-01");
  const [end, setEnd] = useState("");
  const [optimizer, setOptimizer] = useState("alpha");
  const [running, setRunning] = useState(false);
  const [runKey, setRunKey] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<LiveRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const navParams = runKey
    ? `symbols=${encodeURIComponent(symbols)}&table=${table}&start=${start}${end ? `&end=${end}` : ""}&optimizer=${optimizer}`
    : "";

  const { data: summary } = useQuery({
    queryKey: ["live/summary", navParams],
    queryFn: () => get<SummaryRow[]>(`/summary?${navParams}`),
    enabled: !!runKey,
    staleTime: 60_000,
  });

  const { data: signals } = useQuery({
    queryKey: ["live/signals", navParams],
    queryFn: () => get<SignalRow[]>(`/signals?${navParams}`),
    enabled: !!runKey,
    staleTime: 60_000,
  });

  async function runLive() {
    setRunning(true);
    setError(null);
    try {
      const params = `symbols=${encodeURIComponent(symbols)}&table=${table}&start=${start}${end ? `&end=${end}` : ""}&optimizer=${optimizer}&force=true`;
      const result = await fetch(`/v1/live/run?${params}`).then((r) => r.json());
      if (result.detail) throw new Error(JSON.stringify(result.detail));
      setRunResult(result);
      setRunKey(params);
      qc.invalidateQueries({ queryKey: ["live/summary"] });
      qc.invalidateQueries({ queryKey: ["live/signals"] });
    } catch (e: any) {
      setError(String(e.message));
    } finally {
      setRunning(false);
    }
  }

  const FAMILY_COLOR: Record<string, string> = {
    momentum: "#48aff0", mean_rev: "#3dcc91", value: "#ffd91e", quality: "#d9822b",
  };

  return (
    <div>
      <H4 style={{ marginBottom: 4, letterSpacing: 2 }}>LIVE DATA ENGINE</H4>
      <div style={{ color: "#738091", fontSize: 11, marginBottom: 20 }}>
        Real 2-year bar data from <code>futures.db</code> — 8.2M 1-min bars · ES NQ RTY CL 6E GC SI + BTC ETH SOL XRP BNB + 14 alts
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
          <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>DATABASE</H5>
          <DbInfoPanel />
        </Card>

        <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
          <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>RUN CONFIG</H5>

          <FormGroup label={<span style={{ color: "#738091", fontSize: 10 }}>PRESET</span>} style={{ marginBottom: 8 }}>
            <HTMLSelect
              value=""
              onChange={(e) => { if (e.target.value) setSymbols(e.target.value); }}
              style={{ background: "#1c2127", color: "#f6f7f9", fontSize: 11, width: "100%" }}
            >
              <option value="">— pick preset —</option>
              {Object.entries(PRESET_GROUPS).map(([k, v]) => (
                <option key={k} value={v}>{k}</option>
              ))}
            </HTMLSelect>
          </FormGroup>

          <FormGroup label={<span style={{ color: "#738091", fontSize: 10 }}>SYMBOLS (comma-sep)</span>} style={{ marginBottom: 8 }}>
            <InputGroup
              value={symbols}
              onChange={(e) => setSymbols(e.target.value)}
              style={{ fontFamily: "monospace", fontSize: 11 }}
              fill
            />
          </FormGroup>

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <FormGroup label={<span style={{ color: "#738091", fontSize: 10 }}>TABLE</span>} style={{ flex: 1, marginBottom: 0 }}>
              <HTMLSelect value={table} onChange={(e) => setTable(e.target.value)} style={{ background: "#1c2127", color: "#f6f7f9", fontSize: 11, width: "100%" }}>
                <option value="bars_5m">bars_5m (crypto)</option>
                <option value="bars_1m">bars_1m (futures+crypto)</option>
              </HTMLSelect>
            </FormGroup>
            <FormGroup label={<span style={{ color: "#738091", fontSize: 10 }}>OPTIMIZER</span>} style={{ flex: 1, marginBottom: 0 }}>
              <HTMLSelect value={optimizer} onChange={(e) => setOptimizer(e.target.value)} style={{ background: "#1c2127", color: "#f6f7f9", fontSize: 11, width: "100%" }}>
                <option value="alpha">Alpha-scaled</option>
                <option value="mvo">MVO</option>
              </HTMLSelect>
            </FormGroup>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <FormGroup label={<span style={{ color: "#738091", fontSize: 10 }}>START</span>} style={{ flex: 1, marginBottom: 0 }}>
              <InputGroup value={start} onChange={(e) => setStart(e.target.value)} style={{ fontFamily: "monospace", fontSize: 11 }} />
            </FormGroup>
            <FormGroup label={<span style={{ color: "#738091", fontSize: 10 }}>END (blank = today)</span>} style={{ flex: 1, marginBottom: 0 }}>
              <InputGroup value={end} onChange={(e) => setEnd(e.target.value)} placeholder="2026-04-01" style={{ fontFamily: "monospace", fontSize: 11 }} />
            </FormGroup>
          </div>

          <Button
            intent="success"
            onClick={runLive}
            loading={running}
            icon="play"
            text="Run Live Backtest"
            fill
          />

          {error && (
            <div style={{ marginTop: 8, color: "#ff7373", fontSize: 11, fontFamily: "monospace", maxHeight: 80, overflow: "auto" }}>
              {error}
            </div>
          )}

          {runResult && (
            <div style={{ marginTop: 10, display: "flex", gap: 12 }}>
              <div>
                <div style={{ color: "#738091", fontSize: 9 }}>TOTAL RETURN</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: runResult.total_return_pct >= 0 ? "#3dcc91" : "#ff7373" }}>
                  {runResult.total_return_pct >= 0 ? "+" : ""}{runResult.total_return_pct.toFixed(2)}%
                </div>
              </div>
              <div>
                <div style={{ color: "#738091", fontSize: 9 }}>DAYS</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#f6f7f9" }}>{runResult.days}</div>
              </div>
              <div>
                <div style={{ color: "#738091", fontSize: 9 }}>SYMBOLS</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#f6f7f9" }}>{runResult.symbols?.length ?? 0}</div>
              </div>
              {runResult.elapsed_s !== undefined && (
                <div>
                  <div style={{ color: "#738091", fontSize: 9 }}>ELAPSED</div>
                  <div style={{ fontSize: 14, color: "#738091" }}>{runResult.elapsed_s}s</div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {runKey && (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 16 }}>
          <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
            <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>LIVE NAV CURVE — REAL DATA</H5>
            <LiveEquityCurve navKey={navParams} />
          </Card>

          <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
            <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>PERFORMANCE</H5>
            {summary ? (
              <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                <tbody>
                  {summary.map((r) => (
                    <tr key={r.Metric} style={{ borderBottom: "1px solid #1c2127" }}>
                      <td style={{ padding: "3px 6px", color: "#738091" }}>{r.Metric}</td>
                      <td style={{ padding: "3px 6px", textAlign: "right", fontWeight: 600, fontFamily: "monospace", color: "#f6f7f9" }}>{r.Value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Spinner size={16} />}
          </Card>
        </div>
      )}

      {runKey && signals && (
        <Card elevation={Elevation.ONE} style={{ background: "#252a31", padding: "16px 20px" }}>
          <H5 style={{ margin: "0 0 12px", color: "#a7b6c2", fontSize: 11, letterSpacing: 1 }}>SIGNAL IC ON REAL DATA</H5>
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "#738091", borderBottom: "1px solid #2d3748" }}>
                <th style={{ textAlign: "left", padding: "3px 8px" }}>Signal</th>
                <th style={{ textAlign: "left", padding: "3px 8px" }}>Family</th>
                <th style={{ textAlign: "right", padding: "3px 8px" }}>Mean IC</th>
                <th style={{ textAlign: "left", padding: "3px 8px 3px 16px" }}>ICIR</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => {
                const bar = Math.min(Math.abs(s.icir) / 2 * 100, 100);
                const color = s.icir > 0.5 ? "#3dcc91" : s.icir > 0 ? "#ffd91e" : "#ff7373";
                return (
                  <tr key={s.signal} style={{ borderBottom: "1px solid #1c2127" }}>
                    <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{s.signal}</td>
                    <td style={{ padding: "4px 8px" }}>
                      <Tag minimal style={{ fontSize: 10, background: (FAMILY_COLOR[s.family] ?? "#738091") + "22", color: FAMILY_COLOR[s.family] ?? "#738091" }}>
                        {s.family}
                      </Tag>
                    </td>
                    <td style={{ padding: "4px 8px", textAlign: "right", color: s.mean_ic >= 0 ? "#3dcc91" : "#ff7373" }}>
                      {s.mean_ic >= 0 ? "+" : ""}{s.mean_ic.toFixed(5)}
                    </td>
                    <td style={{ padding: "4px 8px 4px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 80, height: 4, background: "#2d3748", borderRadius: 2 }}>
                          <div style={{ width: `${bar}%`, height: "100%", background: color, borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 10, color, minWidth: 36, textAlign: "right" }}>
                          {s.icir >= 0 ? "+" : ""}{s.icir.toFixed(3)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
